// ============================================================================
// user-files.js — SCADLite "My Files" (app-filesystem .scad storage)
// ----------------------------------------------------------------------------
// Lets users Save/Open .scad files inside the app (IndexedDB), forming a flat
// virtual project folder. Every stored file is mounted into every WASM
// instance's filesystem root, next to the pass input files — so
//     include <myutils.scad>     /     use <parts.scad>
// resolve exactly as they would on desktop with files sitting beside your
// main .scad. Combined with library support this completes modular projects:
// user files can include libraries, and the main editor buffer can include
// user files.
//
// Same architectural pattern as the font/STL/SVG/library managers:
// one IndexedDB database, one object store, key = filename (always *.scad),
// an in-memory cache owned by app.js, and a per-instance mount step.
//
// Record shape (key = "myutils.scad"):
//   { content: string, modified: epoch-ms }
// ============================================================================

// Filenames the pipeline itself writes into instance roots — never allow a
// user file to shadow these.
export const RESERVED_SCAD_NAMES = new Set([
    'check.scad', 'solid_input.scad', 'ghost_input.scad',
    'highlight_input.scad', 'render_input.scad', 'export_input.scad'
]);

// Normalize a user-entered name into a safe *.scad filename, or return null
// if nothing usable remains. "my utils" -> "my_utils.scad".
export function normalizeUserFileName(raw) {
    let name = (raw || '').trim().replace(/\.scad$/i, '');
    name = name.replace(/[^A-Za-z0-9._\-]/g, '_').replace(/^\.+/, '');
    if (!name) return null;
    const full = name + '.scad';
    if (RESERVED_SCAD_NAMES.has(full.toLowerCase())) return null;
    return full;
}

// ---------------------------------------------------------------------------
// IndexedDB persistence (mirrors the STL/SVG/library pattern)
// ---------------------------------------------------------------------------
function openUserFilesDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OpenSCAD_USERFILES_DB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('files');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getPersistentUserFiles() {
    try {
        const db = await openUserFilesDB();
        return new Promise((resolve) => {
            const tx = db.transaction('files', 'readonly');
            const store = tx.objectStore('files');
            const files = [];
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    files.push({ name: cursor.key, ...cursor.value });
                    cursor.continue();
                } else resolve(files);
            };
        });
    } catch (err) { return []; }
}

export async function savePersistentUserFile(name, content) {
    try {
        const db = await openUserFilesDB();
        db.transaction('files', 'readwrite').objectStore('files')
          .put({ content, modified: Date.now() }, name);
    } catch (err) { console.error(err); }
}

export async function deletePersistentUserFile(name) {
    try {
        const db = await openUserFilesDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('files', 'readwrite').objectStore('files').delete(name);
            req.onsuccess = resolve; req.onerror = () => reject(req.error);
        });
    } catch (err) { console.error(err); }
}

// Empty the whole store in one operation (used by backup/restore's mirror wipe).
export async function clearPersistentUserFiles() {
    const db = await openUserFilesDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('files', 'readwrite').objectStore('files').clear();
        req.onsuccess = resolve; req.onerror = () => reject(req.error);
    });
}

// ---------------------------------------------------------------------------
// WASM mounting — user files live at the FS root, beside the pass inputs.
// `userFileCache` is the app's in-memory map: { "myutils.scad": content }
// ---------------------------------------------------------------------------
const _encoder = new TextEncoder();

export function mountUserFilesIntoInstance(instance, userFileCache) {
    for (const [name, content] of Object.entries(userFileCache)) {
        if (RESERVED_SCAD_NAMES.has(name.toLowerCase())) continue;
        try {
            instance.FS.writeFile(`/${name}`, _encoder.encode(content));
        } catch (e) { /* one bad file shouldn't kill the mount */ }
    }
}

// ---------------------------------------------------------------------------
// "Download all" — zip every stored file for a portable desktop project.
// `fflateLib` passed in (app loads fflate as a global script).
// Returns a Uint8Array of zip bytes.
// ---------------------------------------------------------------------------
export function zipUserFiles(userFileCache, fflateLib) {
    const entries = {};
    for (const [name, content] of Object.entries(userFileCache)) {
        entries[name] = _encoder.encode(content);
    }
    return fflateLib.zipSync(entries);
}