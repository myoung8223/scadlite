// ============================================================================
// library-manager.js — SCADLite OpenSCAD library support
// ----------------------------------------------------------------------------
// Lets users upload a zipped OpenSCAD library (e.g. MCAD.zip, BOSL2.zip),
// persists it in IndexedDB, and mounts it into every WASM instance's virtual
// filesystem so `include <MCAD/involute_gears.scad>` / `use <...>` resolve
// EXACTLY as they do in desktop OpenSCAD — directory structure preserved,
// no flattening, 100% cross-compatible source code.
//
// Follows the same architectural pattern as the app's font/STL/SVG managers:
//   - one IndexedDB database, one object store, key = library name
//   - an in-memory cache (owned by app.js) hydrated at startup
//   - a mount step run per WASM instance alongside mapExternalResources
//
// Storage record shape (key = library name, e.g. "MCAD"):
//   { files: { "involute_gears.scad": Uint8Array,
//              "bitmap/bitmap.scad": Uint8Array, ... },   // paths RELATIVE to
//     fileCount, scadCount, totalBytes, added }           // the library root
//
// Paths are stored relative (root folder stripped) so a library can be
// renamed without rewriting every key; the mount prefix is derived from the
// record's name at mount time: /<name>/<relative path>.
// ============================================================================

// ---------------------------------------------------------------------------
// IndexedDB persistence (mirrors openStlsDB / getPersistentStls / etc.)
// ---------------------------------------------------------------------------
function openLibsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OpenSCAD_LIB_DB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('libs');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getPersistentLibs() {
    try {
        const db = await openLibsDB();
        return new Promise((resolve) => {
            const tx = db.transaction('libs', 'readonly');
            const store = tx.objectStore('libs');
            const libs = [];
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    libs.push({ name: cursor.key, ...cursor.value });
                    cursor.continue();
                } else resolve(libs);
            };
        });
    } catch (err) { return []; }
}

export async function savePersistentLib(name, record) {
    try {
        const db = await openLibsDB();
        db.transaction('libs', 'readwrite').objectStore('libs').put(record, name);
    } catch (err) { console.error(err); }
}

export async function deletePersistentLib(name) {
    try {
        const db = await openLibsDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('libs', 'readwrite').objectStore('libs').delete(name);
            req.onsuccess = resolve; req.onerror = () => reject(req.error);
        });
    } catch (err) { console.error(err); }
}

// Empty the whole store in one operation (used by backup/restore's mirror
// wipe) — avoids loading multi-MB library records just to delete them.
export async function clearPersistentLibs() {
    const db = await openLibsDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('libs', 'readwrite').objectStore('libs').clear();
        req.onsuccess = resolve; req.onerror = () => reject(req.error);
    });
}

// ---------------------------------------------------------------------------
// Zip ingestion + normalization
// ---------------------------------------------------------------------------
// Takes raw zip bytes and the zip's filename; returns
//   { suggestedName, files, fileCount, scadCount, totalBytes }
// where `files` maps root-relative paths to Uint8Arrays.
//
// Normalization rules:
//   - directory entries and archive junk (__MACOSX/, .DS_Store, hidden
//     dotfiles/folders, .git/) are dropped
//   - if EVERY remaining path shares a single top-level folder (the common
//     "zipped the folder itself" and GitHub "<repo>-master/" cases), that
//     root is stripped from the stored paths
//   - suggestedName = the root folder name if one existed, else the zip's
//     basename; either way with trailing "-master"/"-main" stripped, since
//     `include <BOSL2/std.scad>` must match the mounted folder name exactly
//
// `fflateLib` is passed in (the app loads fflate as a global script); this
// keeps the module testable outside the browser.
// ---------------------------------------------------------------------------
export function ingestLibraryZip(zipBytes, zipFilename, fflateLib) {
    const raw = fflateLib.unzipSync(zipBytes);

    const files = {};
    for (const [path, data] of Object.entries(raw)) {
        if (path.endsWith('/')) continue;                          // directory entry
        const segs = path.split('/');
        if (segs.some(s => s === '__MACOSX' || s === '.git' || s.startsWith('.'))) continue;
        files[path] = data;
    }

    const paths = Object.keys(files);
    if (paths.length === 0) throw new Error('Zip contains no usable files.');

    // Detect a single common root folder (stripped from stored paths below).
    let root = null;
    const firstSeg = paths[0].split('/')[0];
    if (paths.every(p => p.split('/').length > 1 && p.split('/')[0] === firstSeg)) {
        root = firstSeg;
    }

    // The library's mount name comes from the ZIP FILENAME, by convention:
    // upload MCAD.zip -> folder /MCAD -> include <MCAD/...>. Users control the
    // name by naming the zip, exactly like naming a folder in desktop
    // OpenSCAD's library directory. GitHub-style "-master"/"-main" suffixes
    // are stripped so BOSL2-master.zip still lands as BOSL2.
    const cleanName = (s) => s
        .replace(/\.zip$/i, '')
        .replace(/[-_](master|main)$/i, '')
        .replace(/[^A-Za-z0-9._\-]/g, '_');

    const suggestedName = cleanName(zipFilename);

    const normalized = {};
    let totalBytes = 0, scadCount = 0;
    for (const [path, data] of Object.entries(files)) {
        const rel = root ? path.slice(root.length + 1) : path;
        if (!rel) continue;
        normalized[rel] = data;
        totalBytes += data.length;
        if (/\.scad$/i.test(rel)) scadCount++;
    }

    if (scadCount === 0) throw new Error('Zip contains no .scad files — not an OpenSCAD library?');

    return {
        suggestedName,
        files: normalized,
        fileCount: Object.keys(normalized).length,
        scadCount,
        totalBytes
    };
}

// ---------------------------------------------------------------------------
// WASM virtual-filesystem mounting
// ---------------------------------------------------------------------------
// Writes every stored library into the given Emscripten instance's MEMFS as
// /<LibraryName>/<relative path>, creating directories as needed. Called for
// every instance (all preview passes, render, export) alongside the STL/SVG
// mounting — MEMFS writes are in-memory copies, so this is fast even for
// multi-MB libraries.
//
// `libCache` is the app's in-memory map: { name: { files: {...} } }.
// ---------------------------------------------------------------------------
export function mountLibrariesIntoInstance(instance, libCache) {
    const made = new Set();
    const mkdirp = (dirPath) => {
        if (made.has(dirPath)) return;
        const segs = dirPath.split('/').filter(Boolean);
        let cur = '';
        for (const seg of segs) {
            cur += '/' + seg;
            if (!made.has(cur)) {
                try { instance.FS.mkdir(cur); } catch (e) { /* exists */ }
                made.add(cur);
            }
        }
    };

    for (const [name, record] of Object.entries(libCache)) {
        for (const [rel, data] of Object.entries(record.files)) {
            const full = `/${name}/${rel}`;
            const dir = full.slice(0, full.lastIndexOf('/'));
            mkdirp(dir);
            try {
                instance.FS.writeFile(full, data instanceof Uint8Array ? data : new Uint8Array(data));
            } catch (e) { /* non-fatal: one bad file shouldn't kill the mount */ }
        }
    }
}

// ---------------------------------------------------------------------------
export function formatLibBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
}