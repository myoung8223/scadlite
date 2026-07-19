// ---- BUILD VERSION CONTROLLER ----
const BUILD_NUMBER = "333";

import OpenSCAD from './libs/openscad.js';
import { isolateHighlights, isolateOpenSCADGhosts, splitTopLevelStatements,
         isDefinitionStatement, collectTopLevelDefinitions,
         findRootModifier } from './preview-transforms.js';
import { getPersistentLibs, savePersistentLib, deletePersistentLib, clearPersistentLibs,
         ingestLibraryZip, mountLibrariesIntoInstance, formatLibBytes } from './library-manager.js';
import { getPersistentUserFiles, savePersistentUserFile, deletePersistentUserFile, clearPersistentUserFiles,
         mountUserFilesIntoInstance, zipUserFiles, normalizeUserFileName, RESERVED_SCAD_NAMES } from './user-files.js';

// DOM Elements
const editorElement = document.getElementById('editor'); 
const consoleBox = document.getElementById('console');
const btnSave = document.getElementById('btn-save');
const fileLoad = document.getElementById('file-load');
const btnPreview = document.getElementById('btn-preview');
const btnRender = document.getElementById('btn-render');
const btnExport = document.getElementById('btn-export');
const viewer3d = document.getElementById('viewer-3d');
const btnCameraReset = document.getElementById('btn-camera-reset');
const placeholderText = document.getElementById('placeholder-text');
const btnWireframe = document.getElementById('btn-wireframe');
const btnProjection = document.getElementById('btn-projection');
const projectNameInput = document.getElementById('project-name-input');
const editorFontSizeSelect = document.getElementById('editor-font-size-select');
const modelColorInput = document.getElementById('model-color');
const btnColorTrigger = document.getElementById('btn-color-trigger');
const closeHelpBtn = document.getElementById('close-help-btn');
const helpOverlay = document.getElementById('help-overlay');
const btnSettingsCheatSheet = document.getElementById('btn-settings-cheat-sheet');
const settingsOverlay = document.getElementById('settings-overlay');
const btnExportFormat = document.getElementById('btn-export-format');

// 🌐 THREE.JS SCOPE VARIABLES
let scene, camera, renderer, controls, currentMesh = null;
// 🎛️ Viewer toolbar state (bottom-left corner buttons)
let perspCamera = null;        // the master perspective camera (framing math)
let orthoCamera = null;        // lazily created orthographic sibling
let isOrthographic = false;    // persisted view mode (openscad_projection), applied post-init
// NOTE: wireframe state lives in `wireframeMode` (declared with the Settings
// handler below) — a single source of truth shared by the Settings "Model
// View" button and the viewer-corner button. It swaps in an UNLIT
// MeshBasicMaterial for wireframe (lit materials make wire lines shimmer).
let viewerHeadlight = null;    // headlight rides the ACTIVE camera
let workspaceInitialized = false;
let gridHelper = null;
let axesGroup = null;

// 🎢 Smooth Zoom State Variables
let targetPerspDistance = 40; 
let targetOrthoZoom = 1;
// User-tunable zoom (Workspace Settings → Zoom Settings), persisted.
//   Intensity  = how far each wheel notch travels (exponential per-tick factor)
//   Smoothness = per-frame easing toward the target; 1 = instant/no glide
function readZoomSetting(key, fallback, min, max) {
    const v = parseFloat(localStorage.getItem(key));
    return (Number.isFinite(v) && v >= min && v <= max) ? v : fallback;
}
let zoomIntensity  = readZoomSetting('openscad_zoom_intensity', 0.0015, 0.0001, 0.05);
let zoomSmoothness = readZoomSetting('openscad_zoom_smoothness', 0.15, 0.01, 1);

// 📐 Parameterized grid/axes (mm). Zero semantics: grid step or range 0 =
// grid disabled; axes range 0 = axes disabled; axes step or hash 0 = axes
// drawn without hashmarks. Values persist in localStorage.
function readViewSetting(key, fallback) {
    const v = parseFloat(localStorage.getItem(key));
    return (Number.isFinite(v) && v >= 0) ? v : fallback;
}
let gridStep  = readViewSetting('openscad_grid_step', 10);
let gridRange = readViewSetting('openscad_grid_range', 300);
let axesStep  = readViewSetting('openscad_axes_step', 1);
let axesRange = readViewSetting('openscad_axes_range', 300);
let axesHash  = readViewSetting('openscad_axes_hash', 0.3);
// One-time migration from the retired Visible/Hidden toggles: a hidden grid
// becomes range 0 (step kept), hidden axes become range 0.
if (localStorage.getItem('openscad_grid_visible') === 'false' && localStorage.getItem('openscad_grid_range') === null) {
    gridRange = 0; localStorage.setItem('openscad_grid_range', '0');
}
if (localStorage.getItem('openscad_axes_visible') === 'false' && localStorage.getItem('openscad_axes_range') === null) {
    axesRange = 0; localStorage.setItem('openscad_axes_range', '0');
}
// Explicit visibility (independent of Step/Range geometry). Default on.
let gridVisible = localStorage.getItem('openscad_grid_on') !== 'false';
let axesVisible = localStorage.getItem('openscad_axes_on') !== 'false';
// Migrate the retired "range 0 = hidden" convention into the new boolean,
// then restore a sane default range so the element can actually show when
// re-enabled. (Old explicit visible flags, if present, also fold in.)
if (localStorage.getItem('openscad_grid_on') === null) {
    if (gridRange === 0 || localStorage.getItem('openscad_grid_visible') === 'false') {
        gridVisible = false;
        if (gridRange === 0) { gridRange = 400; localStorage.setItem('openscad_grid_range', '400'); }
    }
    localStorage.setItem('openscad_grid_on', gridVisible ? 'true' : 'false');
}
if (localStorage.getItem('openscad_axes_on') === null) {
    if (axesRange === 0 || localStorage.getItem('openscad_axes_visible') === 'false') {
        axesVisible = false;
        if (axesRange === 0) { axesRange = 400; localStorage.setItem('openscad_axes_range', '400'); }
    }
    localStorage.setItem('openscad_axes_on', axesVisible ? 'true' : 'false');
}
localStorage.removeItem('openscad_grid_visible');
localStorage.removeItem('openscad_axes_visible');

// Rebuild the grid from current settings (disposes any previous grid).
function rebuildGrid() {
    if (!scene) return;
    if (gridHelper) {
        scene.remove(gridHelper);
        gridHelper.geometry.dispose();
        gridHelper.material.dispose();
        gridHelper = null;
    }
    if (gridStep <= 0 || gridRange <= 0) return;
    const divisions = Math.max(1, Math.round(gridRange / gridStep));
    gridHelper = new THREE.GridHelper(gridRange, divisions, 0x444444, 0x444444);
    gridHelper.position.y = 0;
    // Z-fight fix via draw order, not position: the grid renders early
    // (renderOrder -1) and does NOT write depth, so the axis lines — drawn
    // later in the transparency pass — always paint cleanly over it at the
    // shared z=0 plane. The grid still TESTS depth, so models occlude it
    // correctly from every angle. (polygonOffset can't help here: it only
    // applies to triangle fills, not GL lines.)
    gridHelper.material.depthWrite = false;
    gridHelper.renderOrder = -1;
    gridHelper.visible = gridVisible;
    scene.add(gridHelper);
    refreshViewerToolbar();
}

function createDynamicHashmarks(axisDir, maxVal, step, hashLength, colorHex) {
    const positions = [];
    const axisDirections = [];
    const signs = [];

    for (let t = step; t <= maxVal + 1e-9; t += step) {
        for (const s of [t, -t]) {
            const anchorX = axisDir.x * s;
            const anchorY = axisDir.y * s;
            const anchorZ = axisDir.z * s;
            
            // Positive end
            positions.push(anchorX, anchorY, anchorZ);
            axisDirections.push(axisDir.x, axisDir.y, axisDir.z);
            signs.push(1.0);

            // Negative end
            positions.push(anchorX, anchorY, anchorZ);
            axisDirections.push(axisDir.x, axisDir.y, axisDir.z);
            signs.push(-1.0);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('axisDirection', new THREE.Float32BufferAttribute(axisDirections, 3));
    geometry.setAttribute('signDir', new THREE.Float32BufferAttribute(signs, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            hashLength: { value: hashLength },
            diffuseColor: { value: new THREE.Color(colorHex) }
        },
        vertexShader: `
            uniform float hashLength;
            attribute vec3 axisDirection;
            attribute float signDir;
            
            void main() {
                vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
                vec3 tickDir = normalize(cross(viewDir, axisDirection));
                vec3 finalPos = position + tickDir * (signDir * hashLength * 0.5);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 diffuseColor;
            void main() { gl_FragColor = vec4(diffuseColor, 1.0); }
        `,
        depthTest: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5
    });

    return new THREE.LineSegments(geometry, material);
}


// Rebuild the X/Y/Z axes (and hashmarks) from current settings.
// Scene mapping: OpenSCAD X = Three X (red), OpenSCAD Y = Three Z (green),
// OpenSCAD Z = Three Y (blue). Hashmarks are short perpendicular segments
// every `axesStep` mm along each axis, `axesHash` mm long, skipping origin.
const MAX_AXIS_TICKS = 20000; // per axis — guards against step=0.001-style input

// Global variable to hold the state
let axesStyle = localStorage.getItem('openscad_axes_style') || 'crosshash'; 

function rebuildAxes() {
    if (!scene) return;
    if (axesGroup) {
        scene.remove(axesGroup);
        axesGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        axesGroup = null;
    }
    if (axesRange <= 0) return;
    axesGroup = new THREE.Group();
    const half = axesRange / 2;
    const overlayConfig = (colorHex) => ({ color: colorHex, depthTest: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 });
    const COLOR_X = 0xcc5252, COLOR_Y = 0x52cc7a, COLOR_Z = 0x007acc;

    // Draw main axes lines
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0)]), new THREE.LineBasicMaterial(overlayConfig(COLOR_X))));
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half)]), new THREE.LineBasicMaterial(overlayConfig(COLOR_Y))));
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -half, 0), new THREE.Vector3(0, half, 0)]), new THREE.LineBasicMaterial(overlayConfig(COLOR_Z))));

    if (axesStep > 0 && axesHash > 0) {
        if (half / axesStep > MAX_AXIS_TICKS) {
            logToConsole(`⚠️ Axes step ${axesStep} over range ${axesRange} would draw too many hashmarks — hashmarks skipped.`);
        } else {
            
            if (axesStyle === 'billboard') {
                // '-' Style: Single Dynamic Hash
                axesGroup.add(createDynamicHashmarks(new THREE.Vector3(1, 0, 0), half, axesStep, axesHash, COLOR_X));
                axesGroup.add(createDynamicHashmarks(new THREE.Vector3(0, 0, 1), half, axesStep, axesHash, COLOR_Y));
                axesGroup.add(createDynamicHashmarks(new THREE.Vector3(0, 1, 0), half, axesStep, axesHash, COLOR_Z));
            } else {
                // '+' Style: True 3D Crosshash
                const h = axesHash / 2;
                const ptsX = [], ptsY = [], ptsZ = [];
                for (let t = axesStep; t <= half + 1e-9; t += axesStep) {
                    for (const s of [t, -t]) {
                        ptsX.push(new THREE.Vector3(s, 0, -h), new THREE.Vector3(s, 0, h));
                        ptsX.push(new THREE.Vector3(s, -h, 0), new THREE.Vector3(s, h, 0));
                        ptsY.push(new THREE.Vector3(-h, 0, s), new THREE.Vector3(h, 0, s));
                        ptsY.push(new THREE.Vector3(0, -h, s), new THREE.Vector3(0, h, s));
                        ptsZ.push(new THREE.Vector3(-h, s, 0), new THREE.Vector3(h, s, 0));
                        ptsZ.push(new THREE.Vector3(0, s, -h), new THREE.Vector3(0, s, h));
                    }
                }
                axesGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ptsX), new THREE.LineBasicMaterial(overlayConfig(COLOR_X))));
                axesGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ptsY), new THREE.LineBasicMaterial(overlayConfig(COLOR_Y))));
                axesGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ptsZ), new THREE.LineBasicMaterial(overlayConfig(COLOR_Z))));
            }
        }
    }
    axesGroup.visible = axesVisible;
    scene.add(axesGroup);
    refreshViewerToolbar();
}

let openSCADFactory = null;
let currentStlBlob = null; 
const fontCache = {}; 
const stlCache = {}; 
const svgCache = {}; // 📁 NEW: Caches SVG files in memory
const libCache = {}; // 📚 Caches uploaded OpenSCAD libraries { name: { files, fileCount, scadCount, totalBytes } }
const userFileCache = {}; // 📄 Caches user .scad files { "myutils.scad": content-string }
let lastSavedName = null;  // app-FS filename currently backing the editor buffer (null = untitled/unsaved)
let editorDirty = false;   // buffer modified since last app-FS save/open
let pendingCameraReset = false; // set when a model is loaded/opened: the next
                                // scene update frames the camera to the new
                                // model instead of retaining the old view
let rawEditorCode = "";

function updateSaveButtonState() {
    // Grab it directly from the DOM to avoid initialization order issues
    const saveBtn = document.getElementById('btn-save-appfs');
    if (saveBtn) {
        // If dirty, force green. If clean, remove inline style to let CSS handle it.
        saveBtn.style.background = editorDirty ? '#28a745' : '';
    }
}

// ==========================================================================
// 🗂️ WORKSPACES — two independent, persisted SCAD workspaces: 'main' and 'link'.
// 'main' is the user's primary work (never clobbered by shared links).
// 'link' is the link-sharing workspace (safe to clobber; holds URL-loaded models).
// ==========================================================================
const WS_MAIN_KEY = 'openscad_ws_main';
const WS_LINK_KEY = 'openscad_ws_link';
const WS_ACTIVE_KEY = 'openscad_ws_active';   // 'main' | 'link'

function getActiveWorkspace() {
    return localStorage.getItem(WS_ACTIVE_KEY) === 'link' ? 'link' : 'main';
}
function wsStorageKey(ws) { return ws === 'link' ? WS_LINK_KEY : WS_MAIN_KEY; }

// Per-workspace PROJECT NAME keys. Main keeps the historic key so existing
// stored names and pre-330 backups keep working verbatim; link gets its own.
function projectNameKey(ws) { return ws === 'link' ? 'openscad_project_name_link' : 'openscad_project_name'; }

// Read/write a workspace's stored code (independent of what's shown in the editor).
function getWorkspaceCode(ws) { return localStorage.getItem(wsStorageKey(ws)) || ""; }
function setWorkspaceCode(ws, code) {
    localStorage.setItem(wsStorageKey(ws), code);
    if (typeof sessionWsCache !== 'undefined') sessionWsCache[ws] = code;
}

// Session-scoped view of workspace contents (used for switch-reads when
// Recover Last Workspaces is disabled). localStorage keeps its two jobs
// separated: it is ALWAYS written (crash/close safeguard, per keystroke),
// but with recovery disabled it is never READ into the editor — reads come
// from this cache, which starts blank each session. null = not yet touched
// this session.
const sessionWsCache = { main: null, link: null };

// Per-workspace "last saved as" stash (session-only). `lastSavedName` always
// holds the ACTIVE workspace's value (it drives the Save overwrite prompt and
// the My Files ● marker); this map stashes the inactive workspace's value
// across switches so the marker tracks the buffer it belongs to.
const sessionLastSaved = { main: null, link: null };

// Read a workspace's code honoring the recovery setting: stored content when
// recovery is enabled, this session's content (blank if untouched) when not.
function readWorkspaceForEditor(ws) {
    if (recoverWorkspaces) return getWorkspaceCode(ws);
    return sessionWsCache[ws] ?? "";
}

// Suppresses the per-keystroke persistence while switchWorkspace() loads a
// workspace into the editor: updateCode() fires the editor's onChange, and
// without this guard, switching into a blank workspace (recovery disabled)
// would instantly overwrite its stored copy with "" — no typing involved.
let suppressWorkspaceSave = false;

// Save whatever's currently in the editor into the active workspace's store.
function saveActiveWorkspace() {
    if (suppressWorkspaceSave) return;
    if (!workspaceInitialized) return;   // guard against premature writes during init
    setWorkspaceCode(getActiveWorkspace(), jar.toString());
}

let consoleDebugging = localStorage.getItem('openscad_console_debug') === 'enabled';
let bracketMatchingEnabled = localStorage.getItem('openscad_bracket_matching') !== 'disabled';
let lineHighlightingEnabled = localStorage.getItem('openscad_line_highlight') !== 'disabled';
let recoverWorkspaces = localStorage.getItem('openscad_recover_workspaces') !== 'disabled';   // default: enabled



// ==========================================================================
// 🗄️ INDEXEDDB PERSISTENT STORAGE LAYERS
// ==========================================================================

// --- FONTS DB ---
function openFontsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OpenSCADCustomFontsDB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('fonts');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}
async function getPersistentFonts() {
    try {
        const db = await openFontsDB();
        return new Promise((resolve) => {
            const tx = db.transaction('fonts', 'readonly');
            const store = tx.objectStore('fonts');
            const fonts = [];
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    fonts.push({ filename: cursor.key, binary: cursor.value });
                    cursor.continue();
                } else resolve(fonts);
            };
        });
    } catch (err) { return []; }
}
async function savePersistentFont(filename, uint8Array) {
    try {
        const db = await openFontsDB();
        db.transaction('fonts', 'readwrite').objectStore('fonts').put(uint8Array, filename);
    } catch (err) { console.error(err); }
}
async function deletePersistentFont(filename) {
    try {
        const db = await openFontsDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('fonts', 'readwrite').objectStore('fonts').delete(filename);
            req.onsuccess = resolve; req.onerror = () => reject(req.error);
        });
    } catch (err) { console.error(err); }
}

// --- STL IMPORTS DB ---
function openStlsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OpenSCAD_STL_DB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('stls');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}
async function getPersistentStls() {
    try {
        const db = await openStlsDB();
        return new Promise((resolve) => {
            const tx = db.transaction('stls', 'readonly');
            const store = tx.objectStore('stls');
            const stls = [];
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    stls.push({ filename: cursor.key, binary: cursor.value });
                    cursor.continue();
                } else resolve(stls);
            };
        });
    } catch (err) { return []; }
}
async function savePersistentStl(filename, uint8Array) {
    try {
        const db = await openStlsDB();
        db.transaction('stls', 'readwrite').objectStore('stls').put(uint8Array, filename);
    } catch (err) { console.error(err); }
}
async function deletePersistentStl(filename) {
    try {
        const db = await openStlsDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('stls', 'readwrite').objectStore('stls').delete(filename);
            req.onsuccess = resolve; req.onerror = () => reject(req.error);
        });
    } catch (err) { console.error(err); }
}

// --- SVG IMPORTS DB ---
function openSvgsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OpenSCAD_SVG_DB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('svgs');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}
async function getPersistentSvgs() {
    try {
        const db = await openSvgsDB();
        return new Promise((resolve) => {
            const tx = db.transaction('svgs', 'readonly');
            const store = tx.objectStore('svgs');
            const svgs = [];
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    svgs.push({ filename: cursor.key, binary: cursor.value });
                    cursor.continue();
                } else resolve(svgs);
            };
        });
    } catch (err) { return []; }
}
async function savePersistentSvg(filename, uint8Array) {
    try {
        const db = await openSvgsDB();
        db.transaction('svgs', 'readwrite').objectStore('svgs').put(uint8Array, filename);
    } catch (err) { console.error(err); }
}
async function deletePersistentSvg(filename) {
    try {
        const db = await openSvgsDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction('svgs', 'readwrite').objectStore('svgs').delete(filename);
            req.onsuccess = resolve; req.onerror = () => reject(req.error);
        });
    } catch (err) { console.error(err); }
}

// 🍯 INITIALIZE CODEMIRROR 6 (custom SCADLite bundle — window.scadCM)
let cmView = null;
const jar = (() => {
    cmView = window.scadCM.newEditor(editorElement, "", {
        // onChange fires on every doc change, AFTER CM6 commits it — so
        // rawEditorCode is always current (no rAF needed anymore).
		onChange: (view) => {
            rawEditorCode = view.state.doc.toString();
            editorDirty = true; // cleared on app-FS save/open and system-FS load
			updateSaveButtonState(); // turn save button green on edit
            saveActiveWorkspace();
            if (typeof refreshUpdateLinkState === 'function') refreshUpdateLinkState();
        }
    });

    return {
        toString() {
            return cmView.state.doc.toString();
        },
        updateCode(code) {
            cmView.dispatch({
                changes: { from: 0, to: cmView.state.doc.length, insert: code }
            });
            rawEditorCode = code;
        },
        onUpdate() {}
    };
})();

// Switch the active workspace: save current editor into the old workspace,
// load the target workspace's code into the editor, persist the choice, preview.
function switchWorkspace(target) {
    if (target !== 'main' && target !== 'link') return;
    const current = getActiveWorkspace();
    if (current === target) return;
    // Save what's on screen into the workspace we're leaving — unless this is
    // an untouched blank visit (recovery disabled, never edited this session,
    // editor empty): leaving then must not clobber the stored copy with "".
    const untouchedBlankVisit = !recoverWorkspaces
        && sessionWsCache[current] === null
        && jar.toString().trim() === "";
    if (!untouchedBlankVisit) setWorkspaceCode(current, jar.toString());
    // Make target active and load its code (honors Recover Last Workspaces:
    // when disabled, an unvisited workspace loads blank this session instead
    // of recovering stored content — its localStorage copy stays intact).
    localStorage.setItem(WS_ACTIVE_KEY, target);
    suppressWorkspaceSave = true;
    try { jar.updateCode(readWorkspaceForEditor(target)); }
    finally { suppressWorkspaceSave = false; }
    // Swap document identity along with the buffer. The leaving side's name
    // is already persisted (the input listener writes per keystroke); the
    // last-saved marker is stashed/loaded per workspace so the Save overwrite
    // prompt and ● marker keep tracking the buffer they belong to.
    sessionLastSaved[current] = lastSavedName;
    lastSavedName = sessionLastSaved[target] ?? null;
    activeProjectName = localStorage.getItem(projectNameKey(target)) || '';
    if (projectNameInput) projectNameInput.value = activeProjectName;
    updateWindowTitle();
	if (typeof refreshUpdateLinkState === 'function') refreshUpdateLinkState();
    logToConsole(`🗂️ Switched to ${target === 'link' ? 'Link Sharing' : 'Main'} workspace.`);
    // Preview the newly-loaded workspace.
    const previewBtn = document.getElementById('btn-preview');
    if (previewBtn) previewBtn.click();
    if (typeof updateWorkspaceButtons === 'function') updateWorkspaceButtons();
}

// ==========================================================================
// 🔗 UPDATE LINK BUTTON — encodes active workspace into URL, copies to clipboard.
// Purple "Update Link" = stale (active content differs from URL);
// gray "Link Updated" = fresh (URL matches active content).
// ==========================================================================
const btnUpdateLink = document.getElementById('btn-update-link');

// ==========================================================================
// 🔗 LINK SHARING — enable/disable state + Switch/Disable buttons + visibility.
// "Active" = user enabled it, OR the link workspace has data.
// ==========================================================================
const btnToggleLinkSharing = document.getElementById('btn-toggle-link-sharing');
const btnSwitchWorkspace   = document.getElementById('btn-switch-workspace');
const btnDisableLinkSharing = document.getElementById('btn-disable-link-sharing');

let linkSharingEnabled = localStorage.getItem('openscad_link_sharing') === 'enabled';

function linkWorkspaceHasData() {
    const c = getWorkspaceCode('link');
    return c && c.trim() !== "";
}
function linkSharingActive() {
    //return linkSharingEnabled || linkWorkspaceHasData();
	return linkSharingEnabled;
}

// Central function: sets every link-sharing-related button's visibility + labels.
function updateWorkspaceButtons() {
    const active = linkSharingActive();
    const hasData = linkWorkspaceHasData();
    const onLink = getActiveWorkspace() === 'link';

    // Update Link: visible when link sharing is active.
    if (btnUpdateLink) {
        btnUpdateLink.style.display = active ? 'inline-block' : 'none';
        if (active) refreshUpdateLinkState();
    }
    // Switch + Disable: visible when active AND link workspace has data.
    const showWsBtns = active;
    if (btnSwitchWorkspace) {
        btnSwitchWorkspace.style.display = showWsBtns ? 'inline-block' : 'none';
        btnSwitchWorkspace.innerHTML = onLink ? 'Switch to Main<br>Workspace' : 'Switch to Link<br>Workspace';
    }
    if (btnDisableLinkSharing) {
        btnDisableLinkSharing.style.display = showWsBtns ? 'inline-block' : 'none';
    }
    // Settings toggle label/color.
    if (btnToggleLinkSharing) {
        btnToggleLinkSharing.textContent = linkSharingEnabled ? 'Enabled' : 'Disabled';
        btnToggleLinkSharing.style.backgroundColor = linkSharingEnabled ? '#28a745' : '#dc3545';
    }
    if (typeof updateViewerWorkspaceLabel === 'function') updateViewerWorkspaceLabel();
}

const axesStyleSelect = document.getElementById('axes-style-select');
if (axesStyleSelect) {
    // 1. Set the dropdown to match the saved preference on load
    axesStyleSelect.value = axesStyle;
    
    // 2. Listen for user changes
    axesStyleSelect.addEventListener('change', (e) => {
        axesStyle = e.target.value;
        localStorage.setItem('openscad_axes_style', axesStyle);
        rebuildAxes(); // Redraw immediately
    });
}

// Settings toggle: enable/disable link sharing.
if (btnToggleLinkSharing) {
    btnToggleLinkSharing.addEventListener('click', () => {
        linkSharingEnabled = !linkSharingEnabled;
        localStorage.setItem('openscad_link_sharing', linkSharingEnabled ? 'enabled' : 'disabled');
        // Disabling while viewing the link workspace forces a switch back to main.
        if (!linkSharingEnabled && getActiveWorkspace() === 'link') {
            switchWorkspace('main');
        }
        updateWorkspaceButtons();
    });
}

// Switch button: toggle between main and link workspaces.
if (btnSwitchWorkspace) {
    btnSwitchWorkspace.addEventListener('click', () => {
        switchWorkspace(getActiveWorkspace() === 'link' ? 'main' : 'link');
        updateWorkspaceButtons();
    });
}

// Disable button (toolbar): same as disabling in settings — keep data, hide buttons.
if (btnDisableLinkSharing) {
    btnDisableLinkSharing.addEventListener('click', () => {
        linkSharingEnabled = false;
        localStorage.setItem('openscad_link_sharing', 'disabled');
        if (getActiveWorkspace() === 'link') switchWorkspace('main');
        updateWorkspaceButtons();
    });
}

// What's currently encoded in the URL hash (decoded), or null if none.
function currentUrlModel() {
    const parts = parseShareHash();
    if (!parts.scad) return null;
    try { return decodeModel(parts.scad); }
    catch (e) { return null; }
}

// The pn (shared project name) currently in the URL hash, sanitized; '' if none.
function currentUrlProjectName() {
    return sanitizeSharedProjectName(parseShareHash().pn);
}

function refreshUpdateLinkState() {
    if (!btnUpdateLink) return;
    // Fresh = BOTH the code and the project name match what the URL carries
    // (the name is part of the shared artifact). Name read from the DOM input,
    // which is safe at any point in the module lifecycle.
    const urlModel = currentUrlModel();
    const liveName = (projectNameInput ? projectNameInput.value : '').trim();
    const isFresh = (urlModel !== null) && (jar.toString() === urlModel) && (liveName === currentUrlProjectName());
    if (isFresh) {
        btnUpdateLink.innerHTML = 'Link<br>Updated';
        btnUpdateLink.style.background = '#6c757d';   // gray
    } else {
        btnUpdateLink.innerHTML = 'Update<br>Link';
        btnUpdateLink.style.background = '#8b5cf6';    // purple
    }
}

if (btnUpdateLink) {
    btnUpdateLink.addEventListener('click', async () => {
        const activeWs = getActiveWorkspace();
        const code = jar.toString();
        const name = (projectNameInput ? projectNameInput.value : activeProjectName).trim();

        // If on MAIN: mirror main's code AND name into the LINK workspace,
        // but stay on main.
        if (activeWs === 'main') {
            setWorkspaceCode('link', code);
            localStorage.setItem(projectNameKey('link'), name);
        }
        // (If on LINK, we just re-encode the link content that's already showing.)

        try {
            const encoded = encodeModel(code);
            let url = window.location.origin + window.location.pathname + '#scad=' + encoded;
            if (name) url += '&pn=' + encodeURIComponent(name);
            history.replaceState(null, '', url);   // update address bar, no navigation
            try {
                await navigator.clipboard.writeText(url);
                logToConsole('🔗 Link updated and copied to clipboard.');
            } catch (copyErr) {
                logToConsole('🔗 Link updated in address bar (clipboard unavailable).');
            }
            refreshUpdateLinkState();
			updateWorkspaceButtons();
        } catch (err) {
            logToConsole('🔗 Could not generate link: ' + (err.message || err));
        }
    });
}

// ============================================================================
// 📂 LOAD OVERLAY — one overlay, two paths: disk upload or shared link.
// Toolbar Load goes straight to the file picker while link sharing is
// disabled (zero overhead for non-sharing users) and opens this overlay once
// it's enabled. The Workspace Settings "Load Shared Link" button always opens
// the overlay with the URL field focused (entry-point-aware) and its Back
// button returns to settings. A successful load — either path — closes
// everything. Link sharing is enabled only by an actually EXECUTED link load,
// never by merely opening the overlay.
// ============================================================================
const loadOverlay = document.getElementById('load-overlay');
const btnCloseLoad = document.getElementById('btn-close-load');
const btnLoadMain = document.getElementById('btn-load-main');
const btnLoadFromDisk = document.getElementById('btn-load-from-disk');
const btnLoadSharedLink = document.getElementById('btn-load-shared-link');
const sharedLinkInput = document.getElementById('shared-link-input');
const btnPasteSharedLink = document.getElementById('btn-paste-shared-link');
const btnLoadSharedLinkExec = document.getElementById('btn-load-shared-link-exec');

let loadOverlayFromSettings = false;   // entry point, for Back's destination

function openLoadOverlay(fromSettings) {
    loadOverlayFromSettings = !!fromSettings;
    if (settingsOverlay) settingsOverlay.classList.add('hidden');
    if (sharedLinkInput) sharedLinkInput.value = '';
    if (loadOverlay) loadOverlay.classList.remove('hidden');
    if (fromSettings && sharedLinkInput) setTimeout(() => sharedLinkInput.focus(), 0);
}

function closeLoadOverlay(returnToSettings) {
    if (loadOverlay) loadOverlay.classList.add('hidden');
    if (returnToSettings && settingsOverlay) settingsOverlay.classList.remove('hidden');
}

// Ingest a pasted share link (or any text containing one). Returns true on
// success. Mirrors the boot-time arrival path, adapted for a live session.
function loadSharedLinkFromText(text) {
    const hash = extractShareHash(text);
    if (!hash) {
        logToConsole('🔗 No share link found — paste a link containing "#scad=".');
        return false;
    }
    const parts = parseShareHash(hash);
    let decoded = null;
    try { decoded = decodeModel(parts.scad || ''); } catch (e) { /* falls through */ }
    if (!decoded || decoded.trim() === '') {
        logToConsole('🔗 Could not decode that share link — it may be truncated or corrupted.');
        return false;
    }
    const pn = sanitizeSharedProjectName(parts.pn);

    // Enable link sharing only now — on an actually executed load.
    if (!linkSharingEnabled) {
        linkSharingEnabled = true;
        localStorage.setItem('openscad_link_sharing', 'enabled');
    }

    // Land content + identity in the link workspace, then show it.
    setWorkspaceCode('link', decoded);
    localStorage.setItem(projectNameKey('link'), pn);
    if (getActiveWorkspace() === 'link') {
        // Already viewing link: switchWorkspace would no-op — update in place.
        jar.updateCode(decoded);
        activeProjectName = pn;
        if (projectNameInput) projectNameInput.value = pn;
        updateWindowTitle();
    } else {
        switchWorkspace('link');
    }

    // Reflect the link in the (invisible-in-a-PWA) address bar so the Update
    // Link staleness check compares against reality and shows "Link Updated".
    const canonical = window.location.origin + window.location.pathname
        + '#scad=' + parts.scad + (parts.pn ? '&pn=' + parts.pn : '');
    history.replaceState(null, '', canonical);

    updateWorkspaceButtons();
    logToConsole('🔗 Shared model loaded into Link Sharing workspace.');
    if (btnPreview && !btnPreview.disabled) btnPreview.click();
    return true;
}

// Toolbar Load: picker directly when sharing is off; the overlay when on.
if (btnLoadMain) {
    btnLoadMain.addEventListener('click', () => {
        if (linkSharingActive()) openLoadOverlay(false);
        else if (fileLoad) fileLoad.click();
    });
}

// Settings entry point: always available — this is the bootstrap for
// first-time link recipients (sharing may still be disabled here).
if (btnLoadSharedLink) {
    btnLoadSharedLink.addEventListener('click', () => openLoadOverlay(true));
}

if (btnCloseLoad) {
    btnCloseLoad.addEventListener('click', () => closeLoadOverlay(loadOverlayFromSettings));
}

// Disk path: hand off to the existing picker; all overlays close.
if (btnLoadFromDisk) {
    btnLoadFromDisk.addEventListener('click', () => {
        closeAllMenus();
        if (fileLoad) fileLoad.click();
    });
}

// Clipboard convenience — only exists where the platform supports reading.
// The manual paste field is the universal path.
if (btnPasteSharedLink) {
    if (navigator.clipboard && navigator.clipboard.readText) {
        btnPasteSharedLink.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (sharedLinkInput) { sharedLinkInput.value = text; sharedLinkInput.focus(); }
            } catch (e) {
                logToConsole('📋 Clipboard read unavailable — paste into the field manually (Ctrl+V).');
            }
        });
    } else {
        btnPasteSharedLink.style.display = 'none';
    }
}

if (btnLoadSharedLinkExec) {
    btnLoadSharedLinkExec.addEventListener('click', () => {
        if (loadSharedLinkFromText(sharedLinkInput ? sharedLinkInput.value : '')) closeAllMenus();
    });
}
if (sharedLinkInput) {
    sharedLinkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (btnLoadSharedLinkExec) btnLoadSharedLinkExec.click();
        }
    });
}

// ==========================================================================
// 🛠️ COMPILATION ERROR HIGHLIGHTING (CM6 — via bundle's lint diagnostics)
// ==========================================================================
function highlightErrorLine(lineNumber, message) {
    if (!cmView || !lineNumber || lineNumber < 1) return;
    window.scadCM.setErrorLine(cmView, lineNumber, message || 'Compilation error');
}

function clearErrorHighlights() {
    if (cmView) window.scadCM.clearErrors(cmView);
}

// ==========================================================================
// 🪲 CONSOLE DEBUGGING TOGGLE
// ==========================================================================
const toggleDebugBtn = document.getElementById('btn-toggle-debug');
if (toggleDebugBtn) {
    const applyDebugLayout = (enabled) => {
        consoleDebugging = enabled;
        localStorage.setItem('openscad_console_debug', enabled ? 'enabled' : 'disabled');
        toggleDebugBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleDebugBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
    };
    applyDebugLayout(consoleDebugging);
    toggleDebugBtn.addEventListener('click', () => applyDebugLayout(!consoleDebugging));
}

// ==========================================================================
// 🔁 RECOVER LAST WORKSPACES TOGGLE
// Enabled (default): fresh instances load the last-saved Main/Link workspace
// contents from localStorage. Disabled: fresh instances start with a blank
// editor; the stored workspaces remain intact in localStorage until the
// user's first edit overwrites the active one. A #scad= share link still
// loads into the Link workspace regardless of this setting.
// ==========================================================================
const toggleRecoverBtn = document.getElementById('btn-toggle-recover');
if (toggleRecoverBtn) {
    const applyRecover = (enabled) => {
        recoverWorkspaces = enabled;
        localStorage.setItem('openscad_recover_workspaces', enabled ? 'enabled' : 'disabled');
        toggleRecoverBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleRecoverBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
    };
    applyRecover(recoverWorkspaces);
    toggleRecoverBtn.addEventListener('click', () => applyRecover(!recoverWorkspaces));
}

/*
// ==========================================================================
// 🪟 NEW WINDOW — opens a fresh SCADLite instance. Uses origin+pathname
// (never location.href) so a #scad= payload in this window's URL is NOT
// carried into the new instance's Link workspace.
// ==========================================================================
const btnNewWindow = document.getElementById('btn-new-window');
if (btnNewWindow) {
    btnNewWindow.addEventListener('click', () => {
        window.open(window.location.origin + window.location.pathname, '_blank');
        logToConsole('🪟 Opened a new SCADLite window.');
    });
}
*/

const btnNewWindow = document.getElementById('btn-new-window');
if (btnNewWindow) {
    btnNewWindow.addEventListener('click', () => {
        const url = window.location.origin + window.location.pathname;
        
        // 🚀 Adding window features forces PWA app wrapping instead of a browser tab
        window.open(url, '_blank', 'popup=yes,width=1200,height=800,noopener,noreferrer');
        
        logToConsole('🪟 Opened a new SCADLite window.');
    });
}

// ==========================================================================
// 💡 BRACKET MATCHING TOGGLE (CM6 — repointed to bundle's toggleBracketMatching)
// ==========================================================================
const toggleBracketBtn = document.getElementById('btn-toggle-bracket');
if (toggleBracketBtn) {
    const applyBracketLayout = (enabled) => {
        bracketMatchingEnabled = enabled;
        if (cmView) window.scadCM.toggleBracketMatching(cmView, enabled);
        localStorage.setItem('openscad_bracket_matching', enabled ? 'enabled' : 'disabled');
        toggleBracketBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleBracketBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
    };
    applyBracketLayout(bracketMatchingEnabled);
    toggleBracketBtn.addEventListener('click', () => applyBracketLayout(!bracketMatchingEnabled));
}

// ==========================================================================
// ✏️ LINE HIGHLIGHT TOGGLE (CM6 — repointed to bundle's toggleActiveLine)
// ==========================================================================
const toggleLineHighlightBtn = document.getElementById('btn-toggle-line-highlight');
if (toggleLineHighlightBtn) {
    const applyLineHighlightLayout = (enabled) => {
        lineHighlightingEnabled = enabled;
        if (cmView) window.scadCM.toggleActiveLine(cmView, enabled);
        localStorage.setItem('openscad_line_highlight', enabled ? 'enabled' : 'disabled');
        toggleLineHighlightBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleLineHighlightBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
    };
    applyLineHighlightLayout(lineHighlightingEnabled);
    toggleLineHighlightBtn.addEventListener('click', () => applyLineHighlightLayout(!lineHighlightingEnabled));
}

// ==========================================================================
// 🖥️ PERSISTENT CONSOLE TOGGLE
// ==========================================================================
const toggleConsoleBtn = document.getElementById('btn-toggle-console');
if (consoleBox && toggleConsoleBtn) {
    let isConsoleVisible = localStorage.getItem('openscad_console_visible') !== 'hidden';
    const applyConsoleLayout = (visible) => {
        if (visible) {
            consoleBox.style.display = 'block'; toggleConsoleBtn.textContent = 'Visible';
            toggleConsoleBtn.style.backgroundColor = '#28a745'; isConsoleVisible = true;
            localStorage.setItem('openscad_console_visible', 'visible');
        } else {
            consoleBox.style.display = 'none'; toggleConsoleBtn.textContent = 'Hidden';
            toggleConsoleBtn.style.backgroundColor = '#dc3545'; isConsoleVisible = false;
            localStorage.setItem('openscad_console_visible', 'hidden');
        }
    };
    applyConsoleLayout(isConsoleVisible);
    toggleConsoleBtn.addEventListener('click', () => {
        applyConsoleLayout(!isConsoleVisible);
        if (isConsoleVisible && typeof logToConsole === 'function') logToConsole("🖥️ Console restored.");
    });
}

// ==========================================================================
// 🔣 LINE NUMBERS TOGGLE (CM6 — repointed to bundle's toggleLineNumbers)
// ==========================================================================
const toggleLinesBtn = document.getElementById('btn-toggle-lines');
let triggerLineUpdate = null;   // retained as null; legacy typeof-guarded call sites safely no-op

if (toggleLinesBtn) {
    let isLinesEnabled = localStorage.getItem('openscad_lines_visible') !== 'disabled';
    const applyLinesLayout = (enabled) => {
        if (cmView) window.scadCM.toggleLineNumbers(cmView, enabled);
        toggleLinesBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleLinesBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
        localStorage.setItem('openscad_lines_visible', enabled ? 'enabled' : 'disabled');
        isLinesEnabled = enabled;
    };
    applyLinesLayout(isLinesEnabled);
    toggleLinesBtn.addEventListener('click', () => applyLinesLayout(!isLinesEnabled));
}

let activeProjectName = localStorage.getItem(projectNameKey(getActiveWorkspace())) || 'untitled';

function updateWindowTitle() { 
    // Fallback to 'untitled' if the user clears the input field entirely
    const displayTitle = activeProjectName.trim() || 'untitled';
    
    // Display "SCADLite" for clean bookmarking when no name is set
    if (displayTitle.toLowerCase() === 'untitled') {
        document.title = 'SCADLite';
    } else {
        document.title = `${displayTitle}.scad`; 
    }
    // 3D viewer corner overlay: "<name>.scad" for named projects, or a bare
    // "untitled" (no .scad) when unnamed.
    const viewerName = document.getElementById('viewer-project-name');
    if (viewerName) {
        viewerName.textContent = displayTitle.toLowerCase() === 'untitled' ? 'untitled' : `${displayTitle}.scad`;
    }
    updateViewerWorkspaceLabel();
}

// 3D viewer corner: workspace line above the filename. Only shown while link
// sharing is active — with sharing off the answer is always "Main", so the
// label would be noise. Called from updateWindowTitle (name/workspace
// changes) and updateWorkspaceButtons (sharing enable/disable repaints).
function updateViewerWorkspaceLabel() {
    const label = document.getElementById('viewer-workspace-label');
    if (!label) return;
    const show = linkSharingActive();
    label.textContent = show ? (getActiveWorkspace() === 'link' ? 'Link Workspace' : 'Main Workspace') : '';
    label.style.display = show ? 'block' : 'none';
    const viewerName = document.getElementById('viewer-project-name');
    if (viewerName) viewerName.style.top = show ? '28px' : '10px';
}

if (projectNameInput) {
    projectNameInput.value = activeProjectName;
    
    // 🔌 ADDED: Listen for live updates when the user renames the project
    projectNameInput.addEventListener('input', (event) => {
        activeProjectName = event.target.value; 
        localStorage.setItem(projectNameKey(getActiveWorkspace()), activeProjectName);
        updateWindowTitle();
    });
}

updateWindowTitle();

// ---- PERSISTENT FONT SIZE INITIALIZATION & LISTENER ----
const savedFontSizeStr = localStorage.getItem('openscad_editor_font_size') || '14px';
if (editorElement && editorFontSizeSelect) {
    editorElement.style.fontSize = savedFontSizeStr;
    editorFontSizeSelect.value = savedFontSizeStr;

    // 🔧 RESTORED: Font Size Changer Listener
    editorFontSizeSelect.addEventListener('change', (event) => {
        const newSize = event.target.value;
        editorElement.style.fontSize = newSize;
        localStorage.setItem('openscad_editor_font_size', newSize);
    });
}

/*
// 🔧 RESTORED: Camera Reset Listener
if (btnCameraReset) {
    btnCameraReset.addEventListener('click', () => {
        if (camera && controls) {
            // Check if there is an active model to center on, otherwise use default
            if (currentMesh && currentMesh.geometry && currentMesh.geometry.boundingSphere) {
                const radius = currentMesh.geometry.boundingSphere.radius; 
                const targetDistance = radius > 0 ? radius * 3.5 : 50; 
                camera.position.set(targetDistance, targetDistance * 1.2, targetDistance);
            } else {
                camera.position.set(40, 40, 40);
            }
            controls.target.set(0, 0, 0); 
            camera.lookAt(0, 0, 0);
            controls.update();
            logToConsole('📷 Camera view reset.');
        }
    });
}
*/

function syncSmoothZoomTargets() {
    if (perspCamera && controls) {
        targetPerspDistance = perspCamera.position.distanceTo(controls.target);
    }
    if (orthoCamera) {
        targetOrthoZoom = orthoCamera.zoom;
    }
}

// 📷 Reusable function to perfectly frame any Three.js mesh or group structure
function frameModelInCamera(mesh) {
    if (!camera || !controls) return;

    if (mesh) {
        // Create an empty bounding box
        const boundingBox = new THREE.Box3();
        // Automatically measures all components inside a Group or a Mesh
        boundingBox.setFromObject(mesh);
        
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Ensure we handle cases where the object has zero volume/hasn't rendered yet
        const validDim = maxDim > 0 ? maxDim : 50;

        // Effective half-FOV: the camera must fit the model in BOTH the
        // vertical fov and the aspect-derived horizontal fov, so use the
        // smaller. Framing math is always PERSPECTIVE-native (perspCamera);
        // orthographic mode syncs its frustum from the result afterwards.
        const halfV = (perspCamera.fov * Math.PI / 180) / 2;
        const halfH = Math.atan(Math.tan(halfV) * perspCamera.aspect);
        const halfMin = Math.min(halfV, halfH);

        // Composite framing distance: the box estimate (fit maxDim face-on)
        // under-frames COMPACT shapes seen from our corner-diagonal view —
        // a sphere/cube's silhouette there is its box DIAGONAL, up to ~1.7x
        // maxDim — while the diagonal-sphere estimate over-frames ELONGATED
        // shapes. Averaging the two behaves well at both extremes: spheres
        // gain breathing room, long parts stay framed as before.
        const dBox = (validDim / 2) / Math.tan(halfMin);
        const boundingRadius = (size.length() / 2) || (validDim / 2); // half the box diagonal
        const dSphere = boundingRadius / Math.sin(halfMin);

        const padding = 1.2;
        const cameraDistance = ((dBox + dSphere) / 2) * padding;

        // Angle the camera slightly down at the model's center bounds
        const viewDirection = new THREE.Vector3(1, 1.2, 1).normalize();
        perspCamera.position.copy(center).add(viewDirection.multiplyScalar(cameraDistance));
        
        controls.target.copy(center); 
        perspCamera.lookAt(center);
    } else {
        // Fallback default position if no model exists on screen
        perspCamera.position.set(40, 40, 40);
        controls.target.set(0, 0, 0); 
        perspCamera.lookAt(0, 0, 0);
    }
    if (isOrthographic) syncOrthoFromPerspective(); // mirror the new framing
    controls.update();
    syncSmoothZoomTargets();
}

// ---------------------------------------------------------------------------
// 🎛️ PROJECTION MODE (perspective / orthographic)
// The perspective camera stays the master: all framing math runs on it, and
// the orthographic camera derives its frustum from the perspective view so
// the model keeps the same apparent size when toggling. The headlight is
// parented to whichever camera is active.
// ---------------------------------------------------------------------------
function syncOrthoFromPerspective() {
    if (!perspCamera) return;
    const dist = perspCamera.position.distanceTo(controls.target);
    const halfH = dist * Math.tan((perspCamera.fov * Math.PI / 180) / 2);
    const halfW = halfH * perspCamera.aspect;
    if (!orthoCamera) {
        orthoCamera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 20000);
    } else {
        orthoCamera.left = -halfW; orthoCamera.right = halfW;
        orthoCamera.top = halfH; orthoCamera.bottom = -halfH;
    }
    orthoCamera.zoom = 1;
    orthoCamera.position.copy(perspCamera.position);
    orthoCamera.up.copy(perspCamera.up);
    orthoCamera.lookAt(controls.target);
    orthoCamera.updateProjectionMatrix();
}

function setProjectionMode(ortho) {
    if (!scene || !perspCamera) return;
    if (ortho === isOrthographic) return;
    if (ortho) {
        syncOrthoFromPerspective();
        if (viewerHeadlight) { perspCamera.remove(viewerHeadlight); orthoCamera.add(viewerHeadlight); }
        scene.add(orthoCamera);
        camera = orthoCamera;
    } else {
        // Preserve apparent size: fold the ortho zoom into perspective distance.
        if (orthoCamera && orthoCamera.zoom !== 1) {
            const dir = perspCamera.position.clone().sub(controls.target);
            perspCamera.position.copy(controls.target).add(dir.multiplyScalar(1 / orthoCamera.zoom));
        }
        if (viewerHeadlight && orthoCamera) { orthoCamera.remove(viewerHeadlight); perspCamera.add(viewerHeadlight); }
        camera = perspCamera;
    }
    isOrthographic = ortho;
    localStorage.setItem('openscad_projection', ortho ? 'orthogonal' : 'perspective');
    if (btnProjection) {
        btnProjection.textContent = ortho ? 'Orthogonal' : 'Perspective';
        btnProjection.style.background = ortho ? '#6c757d' : '#3b82f6';
    }
    controls.object = camera;
    controls.update();
    syncSmoothZoomTargets();
    logToConsole(ortho ? '📐 Orthogonal projection enabled.' : '📐 Perspective projection enabled.');
}

// Projection-aware viewport update used by BOTH resize paths (window resize
// and the pane splitter). Ortho keeps its current frustum height and adapts
// width to the new aspect.
function updateCameraViewport(cw, ch) {
    if (perspCamera) { perspCamera.aspect = cw / ch; perspCamera.updateProjectionMatrix(); }
    if (orthoCamera) {
        const halfH = orthoCamera.top;
        const halfW = halfH * (cw / ch);
        orthoCamera.left = -halfW; orthoCamera.right = halfW;
        orthoCamera.updateProjectionMatrix();
    }
    renderer.setSize(cw, ch, true);
}

// ---------------------------------------------------------------------------
// 🕸 WIREFRAME (persisted: openscad_wireframe_mode): applied to every material,
// and re-applied after each canvas update so new previews inherit the mode.
// ---------------------------------------------------------------------------
// Applies the current wireframe state to the mesh in the scene. Defined
// later (with the Settings handler) as applyWireframeToMesh(); this thin
// wrapper exists because the canvas-update path calls it after each preview.
function applyWireframeMode() {
    if (typeof applyWireframeToMesh === 'function') applyWireframeToMesh();
}

// 🔧 Camera Reset Listener
if (btnCameraReset) {
    btnCameraReset.addEventListener('click', () => {
        frameModelInCamera(currentMesh);
        logToConsole('📷 Camera view reset to object bounds.');
    });
}

// ===========================================================================
// 🎛️ VIEWER TOOLBAR — small square buttons at the 3D pane's bottom-left.
// Session view toggles layered ON TOP of Workspace Settings: the grid/axes
// buttons flip Three.js visibility only, never the stored step/range values.
// Expansion state persists in localStorage; the toggles themselves are
// per-session (matching desktop OpenSCAD's view menu behavior).
// ===========================================================================
const vbEllipsis  = document.getElementById('vb-ellipsis');
const vbExtra     = document.getElementById('viewer-toolbar-extra');
const vbProjection = document.getElementById('vb-projection');
const vbReset     = document.getElementById('vb-reset');
const vbAxes      = document.getElementById('vb-axes');
const vbGrid      = document.getElementById('vb-grid');
const vbWireframe = document.getElementById('vb-wireframe');

function setGridVisible(on) {
    gridVisible = on;
    localStorage.setItem('openscad_grid_on', on ? 'true' : 'false');
    if (gridHelper) gridHelper.visible = on;   // toggle live geometry if present
    else if (on) rebuildGrid();                // was off with valid step/range
    syncGridAxesButtons();
    refreshViewerToolbar();
}
function setAxesVisible(on) {
    axesVisible = on;
    localStorage.setItem('openscad_axes_on', on ? 'true' : 'false');
    if (axesGroup) axesGroup.visible = on;
    else if (on) rebuildAxes();
    syncGridAxesButtons();
    refreshViewerToolbar();
}
// Keep the Workspace Settings On/Off buttons in step with the flags.
function syncGridAxesButtons() {
    const btnG = document.getElementById('btn-toggle-grid');
    if (btnG) { btnG.textContent = gridVisible ? 'On' : 'Off'; btnG.style.background = gridVisible ? '#28a745' : '#dc3545'; }
    const btnA = document.getElementById('btn-toggle-axes');
    if (btnA) { btnA.textContent = axesVisible ? 'On' : 'Off'; btnA.style.background = axesVisible ? '#28a745' : '#dc3545'; }
}

function refreshViewerToolbar() {
    const setOn = (el, on) => { if (el) el.classList.toggle('vb-on', !!on); };
    setOn(vbProjection, isOrthographic);
    setOn(vbWireframe, typeof wireframeMode !== 'undefined' && wireframeMode);
    setOn(vbAxes, axesVisible);
    setOn(vbGrid, gridVisible);
}

if (vbEllipsis && vbExtra) {
    const applyExpanded = (expanded) => {
        vbExtra.style.display = expanded ? 'flex' : 'none';
        vbEllipsis.classList.toggle('vb-on', expanded);
        localStorage.setItem('openscad_viewbar_expanded', expanded ? 'true' : 'false');
    };
    applyExpanded(localStorage.getItem('openscad_viewbar_expanded') !== 'false');
    vbEllipsis.addEventListener('click', () => {
        applyExpanded(vbExtra.style.display === 'none');
    });
}
if (vbProjection) vbProjection.addEventListener('click', () => {
    setProjectionMode(!isOrthographic);
    refreshViewerToolbar();
});
if (vbReset) vbReset.addEventListener('click', () => {
    frameModelInCamera(currentMesh);
    logToConsole('📷 Camera view reset to object bounds.');
});
if (vbAxes) vbAxes.addEventListener('click', () => setAxesVisible(!axesVisible));
if (vbGrid) vbGrid.addEventListener('click', () => setGridVisible(!gridVisible));
if (vbWireframe) vbWireframe.addEventListener('click', () => setWireframeMode(!wireframeMode));

const savedColorHexStr = localStorage.getItem('openscad_model_color') || '#3b82f6';
if (modelColorInput) modelColorInput.value = savedColorHexStr;
if (btnColorTrigger) btnColorTrigger.style.background = savedColorHexStr;
let activeModelColor = parseInt(savedColorHexStr.replace('#', '0x'), 16);
let exportFormat = localStorage.getItem('openscad_export_format') || 'STL';

// ❌ Close Help Menu Button Listener
if (closeHelpBtn && helpOverlay) {
    closeHelpBtn.addEventListener('click', () => {
        helpOverlay.classList.add('hidden');
    });
}

function logToConsole(message) {
    let cleanMessage = message.replace(/^\[ERROR\]:\s*/gm, '');
    if (cleanMessage.includes("Could not initialize localization") || cleanMessage.includes("Fontconfig error")) return; 
    consoleBox.textContent += `\n${cleanMessage}`;
    consoleBox.scrollTop = consoleBox.scrollHeight; 
}

// ---- Model Link encode/decode: fflate gzip → base64url, for the URL hash ----
function encodeModel(text) {
    const compressed = fflate.gzipSync(fflate.strToU8(text));
    let b64 = btoa(String.fromCharCode(...compressed));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeModel(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return fflate.strFromU8(fflate.gunzipSync(bytes));
}

// Parse the share hash into its params: #scad=<blob>[&pn=<name>] -> { scad, pn }.
// Splitting on '&' is unambiguous: the blob's base64url alphabet is
// [A-Za-z0-9-_] and encodeURIComponent escapes '&' inside names.
function parseShareHash(hashStr) {
    const hash = (hashStr !== undefined) ? hashStr : window.location.hash;
    const parts = {};
    if (!hash.startsWith('#')) return parts;
    for (const seg of hash.slice(1).split('&')) {
        const eq = seg.indexOf('=');
        if (eq > 0) parts[seg.slice(0, eq)] = seg.slice(eq + 1);
    }
    return parts;
}

// Sanitize a pn value arriving from a URL: percent-decode, strip control
// characters, trim, cap length. It only ever lands in input.value /
// document.title / textContent sinks, so this is belt-and-suspenders;
// normalizeUserFileName still guards the path to an actual filename.
function sanitizeSharedProjectName(raw) {
    if (!raw) return '';
    let name;
    try { name = decodeURIComponent(raw); } catch (e) { return ''; }
    return name.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
}

// Pull the '#scad=...' fragment out of arbitrary pasted text — a full URL
// from any origin, a bare fragment, or junk-wrapped text. The domain is
// irrelevant: the hash IS the data. Returns the fragment, or null.
function extractShareHash(text) {
    const idx = (text || '').indexOf('#scad=');
    if (idx === -1) return null;
    return text.slice(idx).split(/\s/)[0];
}

// ---- FILE OPERATIONS ----
btnSave.addEventListener('click', () => {
    const blob = new Blob([jar.toString()], { type: 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    let safeFilename = activeProjectName.trim().replace(/\.scad$/i, '') || "untitled"; 
    link.download = `${safeFilename}.scad`; link.click();
    logToConsole(`⬇️ Downloaded ${safeFilename}.scad to your system.`);
});

fileLoad.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        jar.updateCode(e.target.result); 
        logToConsole(`Loaded file: ${file.name}`);
        localStorage.setItem('openscad_editor_cache', e.target.result);
        activeProjectName = file.name.replace(/\.scad$/i, '');
        localStorage.setItem(projectNameKey(getActiveWorkspace()), activeProjectName);
        if (projectNameInput) projectNameInput.value = activeProjectName;
        updateWindowTitle();
        lastSavedName = null;   // system file isn't (yet) an app-FS document
        editorDirty = false;
		updateSaveButtonState(); // turn the save button gray
        pendingCameraReset = true; // frame the camera to the newly loaded model
        if (typeof btnPreview !== 'undefined' && !btnPreview.disabled) btnPreview.click();
    };
    reader.readAsText(file);
});

let wireframeMode = false;

// Single entry point for BOTH the Settings "Model View" button and the
// viewer-corner button: updates state, both button UIs, and the mesh.
function setWireframeMode(on) {
    wireframeMode = on;
    localStorage.setItem('openscad_wireframe_mode', on ? 'enabled' : 'disabled');
    if (btnWireframe) {
        btnWireframe.textContent = on ? 'Wireframe' : 'Solid';
        btnWireframe.style.background = on ? '#6c757d' : '#3b82f6';
    }
    applyWireframeToMesh();
    if (typeof refreshViewerToolbar === 'function') refreshViewerToolbar();
}

// Swaps between the cached lit material and an UNLIT wireframe material.
// Using MeshBasicMaterial (unlit) is what keeps wire lines crisp — flipping
// .wireframe on a lit MeshStandardMaterial makes the lines shimmer as the
// lighting shades them.
function applyWireframeToMesh() {
    if (currentMesh) {
        currentMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                
                // Handle cases where a mesh has multiple materials
                if (Array.isArray(child.material)) {
                    child.material.forEach((mat, index) => {
                        // Create and cache a basic, unlit material for this specific part
                        if (!child.userData[`origMat_${index}`]) {
                            child.userData[`origMat_${index}`] = mat;
                            child.userData[`wireMat_${index}`] = new THREE.MeshBasicMaterial({
                                color: mat.color, 
                                wireframe: true
                            });
                        }
                        // Swap between the original lit material and the unlit wireframe
                        child.material[index] = wireframeMode ? child.userData[`wireMat_${index}`] : child.userData[`origMat_${index}`];
                    });
                } else {
                    // Handle standard single material
                    if (!child.userData.originalMaterial) {
                        child.userData.originalMaterial = child.material;
                        child.userData.wireframeMaterial = new THREE.MeshBasicMaterial({
                            color: child.material.color || 0x007acc, // Fallback color just in case
                            wireframe: true
                        });
                    }
                    // Swap the materials
                    child.material = wireframeMode ? child.userData.wireframeMaterial : child.userData.originalMaterial;
                }
            }
        });
    }
}

if (btnWireframe) btnWireframe.addEventListener('click', () => setWireframeMode(!wireframeMode));
if (btnProjection) btnProjection.addEventListener('click', () => setProjectionMode(!isOrthographic));

window.addEventListener('keydown', (event) => {
	
	// 🚀 Preview [F5]
    if (event.key === 'F5') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        if (!btnPreview.disabled) { 
            logToConsole('⌨️ Hotkey Triggered: [F5] (Preview)');
            btnPreview.click(); 
        }
    }

    // 🚀 Render [F6]
    if (event.key === 'F6') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        if (btnRender && !btnRender.disabled) { 
            logToConsole('⌨️ Hotkey Triggered: [F6] (Render)');
            btnRender.click(); 
        }
    }

    // 🛡️ Block [Ctrl+R] / [Cmd+R] reload — redirect to Preview instead
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!btnPreview.disabled) {
            logToConsole('⌨️ Hotkey Intercepted: [Ctrl+R] (redirected to Preview)');
            btnPreview.click();
        }
    }
	
    // 🚀 Export to STL [F7]
    if (event.key === 'F7') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        if (btnExport && !btnExport.disabled) { 
            logToConsole('⌨️ Hotkey Triggered: [F7] (Export)'); 
            btnExport.click(); 
        }
    }
	
    // Existing: [Ctrl] + [Enter]
    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        if (!btnPreview.disabled) { 
            logToConsole('⌨️ Hotkey Triggered: [Ctrl] + [Enter]'); 
            btnPreview.click(); 
        }
    }

	// 💾 Save File [Ctrl] + [S]
    if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault(); // Stops browser "Save Page As"
        event.stopImmediatePropagation();
        logToConsole('⌨️ Hotkey Triggered: [Ctrl] + [S] (Save to App Files)');
        saveCurrentToAppFS();
    }

    // 📂 Open File [Ctrl] + [O]
    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault(); // Stops browser "Open Local File"
        event.stopImmediatePropagation();
        {
            logToConsole('⌨️ Hotkey Triggered: [Ctrl] + [O] (Open from App Files)');
            openUserFilesOverlay(false);
        }
    }

    // ⚙️ Open Settings [Ctrl] + [,]
    if (event.ctrlKey && event.key === ',') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        logToConsole(`⌨️ Hotkey Triggered: Settings`); 
        
        // 👉 Grab the actual settings button by its ID and click it
        // (Change 'btn-settings' if your HTML uses a different ID for the gear icon!)
        const settingsButton = document.getElementById('btn-settings');
        if (settingsButton) {
            settingsButton.click();
        }
    }

	// ❓ Open/Close Help Cheat Sheet [F1]
    if (event.key === 'F1') {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
        
        const helpOverlay = document.getElementById('help-overlay');
        if (helpOverlay) {
            helpOverlay.classList.toggle('hidden'); // Flips it on or off!
            logToConsole(`⌨️ Hotkey Triggered: [F1] (Toggled Help)`); 
        }
    }
	
}, true);

btnColorTrigger.addEventListener('click', () => modelColorInput.click());
modelColorInput.addEventListener('input', (event) => {
    const selectedHex = event.target.value;
    localStorage.setItem('openscad_model_color', selectedHex);
    btnColorTrigger.style.background = selectedHex;
    activeModelColor = parseInt(selectedHex.replace('#', '0x'), 16);
    if (currentMesh && currentMesh.material) currentMesh.material.color.setHex(activeModelColor);
});

if (btnExportFormat) {
    const applyExportFormat = (fmt) => {
        exportFormat = fmt;
        localStorage.setItem('openscad_export_format', fmt);
        
        // Assign the emoji based on the current format
        const icon = fmt === '3MF' ? '🎨' : '🧊'; // Feel free to swap 🧊 for 🌐 or 📐!
        
        // Update the button text to include both the emoji and the format name
        btnExportFormat.textContent = `${icon} ${fmt}`;
        
        // Blue = 3MF (carries color); neutral gray = STL (geometry only)
        btnExportFormat.style.background = (fmt === '3MF') ? '#3b82f6' : '#6c757d';

        // Toolbar Export button mirrors the target format as a two-liner
        // ("Export" / "to STL"), matching the New Window button's styling.
        if (btnExport) btnExport.innerHTML = `Export<br>to ${fmt}`;
    };
    applyExportFormat(exportFormat);
    btnExportFormat.addEventListener('click', () => {
        applyExportFormat(exportFormat === 'STL' ? '3MF' : 'STL');
    });
}

// ❓ Open Cheat Sheet from Settings Menu
if (btnSettingsCheatSheet && settingsOverlay && helpOverlay) {
    btnSettingsCheatSheet.addEventListener('click', () => {
        settingsOverlay.classList.add('hidden'); // Close Settings
        helpOverlay.classList.remove('hidden');  // Open Cheat Sheet
        logToConsole('📘 Opened Cheat Sheet from Settings Menu');
    });
}

async function initOpenSCAD() {
    logToConsole(`Build ${BUILD_NUMBER}`);
    logToConsole('System ready. Instantiating WASM...');

	// 🔗 Shared link: if the URL carries a model, load it into the LINK workspace
    // (never main), make link active, and let the normal loader show it.
    let sharedLinkLoaded = false;
    if (window.location.hash.startsWith('#scad=')) {
        try {
            const hashParts = parseShareHash();
            const decoded = decodeModel(hashParts.scad || '');
            if (decoded && decoded.trim() !== "") {
                setWorkspaceCode('link', decoded);
                sharedLinkLoaded = true;
				localStorage.setItem('openscad_link_sharing', 'enabled');
				linkSharingEnabled = true;
                localStorage.setItem(WS_ACTIVE_KEY, 'link');
                // Optional pn param -> the link workspace's project name;
                // absent pn clears it (shared content = fresh identity).
                localStorage.setItem(projectNameKey('link'), sanitizeSharedProjectName(hashParts.pn));
                logToConsole('🔗 Shared model loaded into Link Sharing workspace.');
            }
        } catch (err) {
            logToConsole('🔗 Could not decode shared model link; ignoring.');
        }
    }
	
	// One-time migration: fold any legacy single-key cache into 'main'.
    const legacy = localStorage.getItem('openscad_editor_cache');
    if (legacy && legacy.trim() !== "" && !localStorage.getItem(WS_MAIN_KEY)) {
        setWorkspaceCode('main', legacy);
    }

    const activeWs = getActiveWorkspace();
    // Recover Last Workspaces disabled -> start blank (stored workspaces stay
    // intact until the first edit). A decoded share link always loads.
    if (!recoverWorkspaces && !sharedLinkLoaded) {
        logToConsole('ℹ️ Recover Last Workspaces is disabled — starting with a blank editor.');
    }
    const activeCode = (recoverWorkspaces || sharedLinkLoaded) ? getWorkspaceCode(activeWs) : "";
    if (activeCode && activeCode.trim() !== "") {
        jar.updateCode(activeCode);
    } else if (activeWs === 'main' && recoverWorkspaces) {
        //jar.updateCode(`linear_extrude(height = 4) {\n\ttext(\n\t\ttext = "Hello, world!", \n\t\tsize = 14, \n\t\tfont = "Liberation Sans:style=Bold", \n\t\thalign = "center", \n\t\tvalign = "center"\n\t);\n}`); 

jar.updateCode(`$fn = $preview ? 20 : 100;   // set fragments number to 20 for preview and 100 for render

linear_extrude(height = 4) {   // 3D text
	text(
		text = "SCADLite", 
		size = 18, 
		font = "Liberation Sans:style=Bold", 
		halign = "center", 
		valign = "center"
	);
}

translate([-100, 10, 0])
rotate([0, 0, 270]) {
	%cube(20);          // demo transparency modifier, %
	cube(10);
}

color([0.8, 0.0, 0.0, 1])
translate([-50, 40, 0])
sphere(d=25);             // sphere

translate([0, 40, 0])
rotate_extrude(angle = 360, convexity = 10)   // torus
	translate([14, 0, 0])
		circle(r = 7);

color([0.5, 0.4, 0.8, 1])
translate([50, 40, 0])
cylinder(d=25, h=20);    // cylinder

color([0.7, 0.1, 0.7, 1])
translate([-50, -40, 0])
cube([25, 25, 25], center=true);   // cube

color([0.0, 0.8, 0.0, 1])
translate([0, -40, 0])	
cylinder(d1=25, d2=0, h=30);   // cone

color([0.8, 0.8, 0.4, 1])
translate([88, 0, 0])	
difference() {                      // conic cylinder cup
	cylinder(d1=15, d2=20, h=20);
	translate([0, 0, 0.5])
	cylinder(d1=14, d2=17, h=20);
}

color([0.8, 0.8, 0.8, 1])
translate([50, -40, 0])
hull() {                                   // hull example (D6 die)
	translate([-8, -8, -8]) sphere(d=4);
	translate([8, -8, -8]) sphere(d=4);
	*translate([-8, 8, -8]) sphere(d=4);   // demo disable modifier, *
	translate([8, 8, -8]) sphere(d=4);
	translate([-8, -8, 8]) sphere(d=4);
	#translate([8, -8, 8]) sphere(d=4);   // demo highlight modifier, #
	translate([-8, 8, 8]) sphere(d=4);
	translate([8, 8, 8]) sphere(d=4);
}`);
        
    } else {
        jar.updateCode("");   // active workspace (link) is empty → blank editor
    }

	// Project-name recovery: document identity persists across sessions
    // alongside the workspace buffers (per-workspace keys), gated by the same
    // Recover Last Workspaces setting. Also adopted when a shared link just
    // loaded (its pn/cleared name was written above) or a backup restore just
    // completed (that flag is consumed by the backup section's post-reload
    // notice at the bottom of this file — it evaluates after this synchronous
    // portion runs). With recovery disabled and no arriving link, a session
    // starts fresh: blank editor, blank names in BOTH workspaces.
    if (recoverWorkspaces || sharedLinkLoaded || sessionStorage.getItem('openscad_restore_notice')) {
        activeProjectName = localStorage.getItem(projectNameKey(getActiveWorkspace())) || '';
    } else {
        activeProjectName = '';
        localStorage.setItem(projectNameKey('main'), '');
        localStorage.setItem(projectNameKey('link'), '');
    }
    if (projectNameInput) projectNameInput.value = activeProjectName;
    lastSavedName = null;
    editorDirty = true;
    updateSaveButtonState();
    updateWindowTitle();
	
    if (typeof triggerLineUpdate === 'function') triggerLineUpdate();
    
	try {
		// 🚀 Grab the global OpenSCAD factory initialized by your HTML script tag
        openSCADFactory = OpenSCAD;
        
        const fontFiles = [
            'LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf',
            'LiberationMono-Regular.ttf', 'LiberationMono-Bold.ttf', 'LiberationMono-Italic.ttf', 'LiberationMono-BoldItalic.ttf',
            'LiberationSerif-Regular.ttf', 'LiberationSerif-Bold.ttf', 'LiberationSerif-Italic.ttf', 'LiberationSerif-BoldItalic.ttf'
        ];

        for (const fontName of fontFiles) {
            try {
                const response = await fetch(`./fonts/${fontName}`);
                if (!response.ok) continue;
                fontCache[fontName] = new Uint8Array(await response.arrayBuffer());
            } catch (err) {}
        }
        
        // Restore Custom Fonts
        try {
            const customFonts = await getPersistentFonts();
            for (const font of customFonts) fontCache[font.filename] = font.binary;
            if (customFonts.length > 0) logToConsole(`✔ Restored ${customFonts.length} custom font(s) from local DB.`);
        } catch (err) { console.error(err); }

        // Restore Custom STL files
        try {
            const customStls = await getPersistentStls();
            for (const stl of customStls) stlCache[stl.filename] = stl.binary;
            if (customStls.length > 0) logToConsole(`✔ Restored ${customStls.length} custom STL(s) from local DB.`);
        } catch (err) { console.error(err); }

        // Restore Custom SVG files
        try {
            const customSvgs = await getPersistentSvgs();
            for (const svg of customSvgs) svgCache[svg.filename] = svg.binary;
            if (customSvgs.length > 0) logToConsole(`✔ Restored ${customSvgs.length} custom SVG(s) from local DB.`);
        } catch (err) { console.error(err); }

		// Restore OpenSCAD Libraries
        try {
            const customLibs = await getPersistentLibs();
            for (const lib of customLibs) libCache[lib.name] = { files: lib.files, fileCount: lib.fileCount, scadCount: lib.scadCount, totalBytes: lib.totalBytes };
            if (customLibs.length > 0) logToConsole(`✔ Restored ${customLibs.length} OpenSCAD librar${customLibs.length === 1 ? 'y' : 'ies'} from local DB.`);
        } catch (err) { console.error(err); }

		// Restore user .scad files (My Files)
        try {
            const storedFiles = await getPersistentUserFiles();
            for (const f of storedFiles) userFileCache[f.name] = f.content;
            if (storedFiles.length > 0) logToConsole(`✔ Restored ${storedFiles.length} user file(s) from local DB.`);
        } catch (err) { console.error(err); }

		logToConsole('✅ Engine ready! Alter code and click Preview freely.');
        btnPreview.disabled = false;
        btnRender.disabled = false;
        btnPreview.click();
		if (typeof updateWorkspaceButtons === 'function') updateWorkspaceButtons();
		
    } catch (err) { logToConsole(`Failed to initialize OpenSCAD: ${err.message}`); }
}

// ---- PREVIEW PIPELINE ----
btnPreview.addEventListener('click', async () => {
    if (!openSCADFactory) return;
    
    if (placeholderText) {
        placeholderText.textContent = "🛠️ Building Preview...";
        placeholderText.style.display = 'flex';
    }

    clearErrorHighlights();
    logToConsole('--- Generating Preview ---');
    //const scriptCode = rawEditorCode || jar.toString(); 
	const scriptCode = jar.toString();
    const errorLogs = [];

    // %/# modifier detection happens AFTER root-modifier isolation below, and
    // is derived from the transform output itself (not a name whitelist): the
    // old regexes only recognized modifiers on BUILT-IN module names, so
    // %cuboid(...) (BOSL2), %gear(...) (MCAD), or %myModule(...) (user-defined)
    // never triggered the ghost/highlight passes at all.

	// Check for ! root modifier — if present, bypass parser for solid pass
    // '!' root-modifier scan now lives in preview-transforms.js —
    // string/comment-aware AND prefix-position-aware, so logical-not in
    // expressions (a = !b; if (!x) ...) no longer falsely triggers root mode.
    const rootModifierIndex = findRootModifier(scriptCode);
    const hasRootModifier = rootModifierIndex !== -1;
	if (consoleDebugging) {
		logToConsole(`🪲 [DEBUG] hasRootModifier: ${hasRootModifier}, rootModifierIndex: ${rootModifierIndex}`);
		logToConsole(`🪲 [DEBUG] scriptCode contains !: ${scriptCode.includes('!difference')}`);
		logToConsole(`🪲 [DEBUG] char at rootModifierIndex: "${scriptCode[rootModifierIndex]}" context: "${scriptCode.slice(rootModifierIndex-10, rootModifierIndex+10)}"`);
	}

	let isolatedSource = null;
	if (hasRootModifier && rootModifierIndex !== -1) {
	    // All top-level definitions from the WHOLE file: assignments (multiline / parens /
	    // comments OK), modules, functions, use/include. Order-independent in OpenSCAD scope.
	    const definitions = collectTopLevelDefinitions(scriptCode);
	
	    // Exactly one complete statement starting at the ! — the marked subtree. UNCHANGED.
	    const afterBang = scriptCode.slice(rootModifierIndex + 1).trimStart();
	    let si = 0;
	    let parenDepth = 0, braceDepth = 0, bracketDepth = 0;
	    let inStr = false, inLC = false, inBC = false;
	    let statementEnd = afterBang.length;
	    while (si < afterBang.length) {
	        const ch = afterBang[si];
	        if (inLC) { if (ch === '\n') inLC = false; si++; continue; }
	        if (inBC) { if (ch === '*' && afterBang[si+1] === '/') { inBC = false; si++; } si++; continue; }
	        if (inStr) { if (ch === '\\') si++; else if (ch === '"') inStr = false; si++; continue; }
	        if (ch === '"') { inStr = true; si++; continue; }
	        if (ch === '/' && afterBang[si+1] === '/') { inLC = true; si += 2; continue; }
	        if (ch === '/' && afterBang[si+1] === '*') { inBC = true; si += 2; continue; }
	        if (ch === '(') { parenDepth++; si++; continue; }
	        if (ch === ')') { parenDepth--; si++; continue; }
	        if (ch === '[') { bracketDepth++; si++; continue; }
	        if (ch === ']') { bracketDepth--; si++; continue; }
	        if (ch === '{') { braceDepth++; si++; continue; }
	        if (ch === '}') {
	            if (braceDepth === 0) { statementEnd = si; break; }
	            braceDepth--; si++;
	            if (braceDepth === 0 && parenDepth === 0) { statementEnd = si; break; }
	            continue;
	        }
	        if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) { statementEnd = si + 1; break; }
	        si++;
	    }
	
	    isolatedSource = definitions + '\n' + afterBang.slice(0, statementEnd);
	}

    // --- Position-aware %/# detection (single source of truth) ---
    // Run the pass transforms once, up front, and gate each pass on whether
    // its transform actually produced any wrapped geometry. This inherits all
    // of preview-transforms.js's statement/position awareness: modulo `%`,
    // hex-color `#`, and modifiers on ANY module name (built-in, library, or
    // user-defined) are all classified correctly. The pass blocks below reuse
    // these strings, so the transforms still run exactly once per preview.
    const passSource = isolatedSource ?? scriptCode;
    const cleanGhostCode = isolateOpenSCADGhosts(passSource);
    const hasGhost = /(^|\n)\s*__GHOST__\(\)/.test(cleanGhostCode);
    const cleanHighlightCode = isolateHighlights(passSource);
    const hasHighlight = /(^|\n)\s*__HIGHLIGHT__\(\)/.test(cleanHighlightCode);

    try {
        // --- INSTANCE SETTINGS BUILDER FUNCTION ---
        const createWasmInstance = async () => {
            return await openSCADFactory({
                noInitialRun: true,
                locateFile: (path) => `./libs/openscad.wasm`,
                ENV: { HOME: '/home/web_user' },
                preRun: [
                    function(Module) {
                        try { Module.FS.mkdir('/home'); } catch(e) {}
                        try { Module.FS.mkdir('/home/web_user'); } catch(e) {}
                        try { Module.FS.mkdir('/home/web_user/.fonts'); } catch(e) {}

                        for (const fontName of Object.keys(fontCache)) {
                            try { 
                                const fontData = new Uint8Array(fontCache[fontName]);
                                Module.FS.writeFile(`/home/web_user/.fonts/${fontName}`, fontData); 
                            } catch (fsErr) { console.error(`[ERROR] Failed to map font: ${fontName}`); }
                        }
                    }
                ],
                print: (text) => logToConsole(`[OpenSCAD]: ${text}`),
                printErr: (text) => {
                    errorLogs.push(text);
                    logToConsole(`[ERROR]: ${text}`);
                }
            });
        };

        // 📝 Pre-map external resources helper
        const mapExternalResources = (instance) => {
            for (const stlName of Object.keys(stlCache)) {
                try { instance.FS.writeFile(`/${stlName}`, new Uint8Array(stlCache[stlName])); } catch (e) {}
            }
            for (const svgName of Object.keys(svgCache)) {
                try { instance.FS.writeFile(`/${svgName}`, new Uint8Array(svgCache[svgName])); } catch (e) {}
            }
            mountUserFilesIntoInstance(instance, userFileCache); // 📄 user project files
            mountLibrariesIntoInstance(instance, libCache); // 📚 include/use resolution
        };

		// ---------------------------------------------------------
        // 🩺 PRE-PASS: code check (line-faithful, no geometry)
        // Raw editor code → .csg export. Evaluates the script (catching
        // syntax / undefined-var / type / missing-module errors) WITHOUT
        // meshing. Because the code is unmodified, reported line numbers
        // map 1:1 to the editor. Abort on any hard ERROR.
        // ---------------------------------------------------------
        logToConsole("🩺 Running pre-pass code check...");
        const checkInstance = await createWasmInstance();
        mapExternalResources(checkInstance);

		const previewInjection = "$preview = true;\n";
		checkInstance.FS.writeFile('/check.scad', previewInjection + scriptCode);

        try {
            checkInstance.callMain(['/check.scad', '-o', '/check.csg']);
        } catch (e) { /* nonzero exit throws; errors are in errorLogs */ }

        const hardErrors = errorLogs.filter(l => l.trim().startsWith('ERROR:'));
        if (hardErrors.length > 0) {
            let errLine = null, errMsg = hardErrors[0].trim();
            for (const l of hardErrors) {
                const m = l.match(/line\s+(\d+)/i);
                if (m) { errLine = parseInt(m[1], 10); errMsg = l.trim(); break; }
            }
            // Compensate for the injected "$preview = true;" first line in
            // /check.scad: reported lines are one below the editor's.
            if (errLine !== null && errLine > 1) errLine -= 1;
            if (errLine) highlightErrorLine(errLine, errMsg);
            if (placeholderText) {
                placeholderText.textContent = "❌ Code Error (Check Console)";
                placeholderText.style.display = 'flex';
            }
            logToConsole(`🛑 Pre-pass halted preview: ${errMsg}`);
            return; // skip the multi-pass entirely
        }

        // Clean — wipe pre-pass warnings so the real passes log fresh
        errorLogs.length = 0;
        logToConsole("✅ Pre-pass clean. Proceeding to multi-pass preview...");

        // ---------------------------------------------------------
        // 🚀 PASS 1: CORE SOLID COMPILER (INSTANCE 1)
        // ---------------------------------------------------------
        logToConsole("⚡ Initializing Solid Geometry Compiler Instance...");
        const solidInstance = await createWasmInstance();
        mapExternalResources(solidInstance);

		const solidCode = isolateOpenSCADGhosts(isolatedSource ?? scriptCode, true);
        if (consoleDebugging) {
			logToConsole("\n🪲 [DEBUG] --- PASS 1 CODE (SOLID GEOMETRY) ---");
        	logToConsole(solidCode);
        	logToConsole("🪲 -----------------------------------------\n");
		}

		solidInstance.FS.writeFile('/solid_input.scad', previewInjection + solidCode);
        
        let solidData = null;
        try {
            solidInstance.callMain(['/solid_input.scad', '--backend=manifold', '-o', '/solid.3mf']);
			if (solidInstance.FS.analyzePath('/solid.3mf').exists) {
                solidData = solidInstance.FS.readFile('/solid.3mf');
                currentStlBlob = new Blob([solidData], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
                btnExport.disabled = false;
            }
        } catch (err) {
            logToConsole("Pass 1 execution finished.");
        }

        // ---------------------------------------------------------
        // 🚀 PASS 2: ISOLATED GHOST COMPILER (INSTANCE 2)
        // ---------------------------------------------------------
        let ghostData = null;
        if (hasGhost) {   // was: if (hasGhost && !hasRootModifier)
            logToConsole("⚡ Initializing Dedicated Ghost Geometry Compiler Instance...");
            const ghostInstance = await createWasmInstance();
            mapExternalResources(ghostInstance);

            logToConsole("📥 Running structural scope parsing to isolate ghost layers...");
			
			// cleanGhostCode was computed up front (detection stage) from
			// isolatedSource ?? scriptCode — reused here, not recomputed.
			const ghostModuleHeader = `module __GHOST__() { color([0.987, 0.012, 0.876]) children(); }\n\n`;
            const ghostCode = ghostModuleHeader + cleanGhostCode;
            
            if (consoleDebugging) {
				logToConsole("\n🪲 [DEBUG] --- PASS 2 CODE (GHOST GEOMETRY) ---");
            	logToConsole(ghostCode);
            	logToConsole("🪲 -----------------------------------------\n");
			}
            
			ghostInstance.FS.writeFile('/ghost_input.scad', previewInjection + ghostCode);
            
            try {
                ghostInstance.callMain(['/ghost_input.scad', '--backend=manifold', '-o', '/ghost.3mf']);
				if (ghostInstance.FS.analyzePath('/ghost.3mf').exists) {
                    ghostData = ghostInstance.FS.readFile('/ghost.3mf');
                }
            } catch (err) {
                logToConsole("Pass 2 execution finished.");
            }
        }

        // ---------------------------------------------------------
        // 🚀 PASS 3: HIGHLIGHT COMPILER (INSTANCE 3) — # modifier
        // ---------------------------------------------------------
        let highlightData = null;
        if (hasHighlight) {
            logToConsole("⚡ Initializing Highlight Geometry Compiler Instance...");
            const highlightInstance = await createWasmInstance();
            mapExternalResources(highlightInstance);

            logToConsole("📥 Running structural scope parsing to isolate highlight layers...");

            // cleanHighlightCode was computed up front (detection stage).
            const highlightModuleHeader = `module __HIGHLIGHT__() { color([1.0, 0.3, 0.3, 0.5]) children(); }\n\n`;
            const highlightCode = highlightModuleHeader + cleanHighlightCode;

            if (consoleDebugging) {
                logToConsole("\n🪲 [DEBUG] --- PASS 3 CODE (HIGHLIGHT GEOMETRY) ---");
                logToConsole(highlightCode);
                logToConsole("🪲 -----------------------------------------\n");
            }

            highlightInstance.FS.writeFile('/highlight_input.scad', previewInjection + highlightCode);

            try {
                highlightInstance.callMain(['/highlight_input.scad', '--backend=manifold', '-o', '/highlight.3mf']);
                if (highlightInstance.FS.analyzePath('/highlight.3mf').exists) {
                    highlightData = highlightInstance.FS.readFile('/highlight.3mf');
                }
            } catch (err) {
                logToConsole("Pass 3 execution finished.");
            }
        }

        // ---------------------------------------------------------
        // 📦 ASSEMBLE & RENDER DISPATCH
        // ---------------------------------------------------------
        if (solidData || ghostData || highlightData) {
            update3DModelViewer(solidData, ghostData, highlightData);
            if (placeholderText) placeholderText.style.display = 'none';
		} else {
            if (scriptCode.trim() === '' || errorLogs.some(l => l.includes('Current top level object is empty'))) {
                update3DModelViewer(null, null, null);
                if (placeholderText) placeholderText.style.display = 'none';
            } else if (errorLogs.some(l => l.includes('not a 3D object'))) {
                // 2D top-level geometry (circle, square, MCAD 2Dshapes, etc.) —
                // valid OpenSCAD, and desktop's viewport can display it, but this
                // pipeline compiles to 3MF meshes, which require 3D geometry.
                if (placeholderText) placeholderText.textContent = "⬛ 2D Shape (Check Console)";
                logToConsole('ℹ️ Your model produces 2D geometry, which the 3D viewport cannot display.');
                logToConsole('   Wrap it in linear_extrude() to give it height, e.g.:  linear_extrude(2) yourShape();');
            } else {
                if (placeholderText) placeholderText.textContent = "❌ Preview Failed (Check Console)";
                let detectedErrorLine = null;
				let detectedErrorMsg = null;

				/*
                for (const logLine of errorLogs) {
                    const lineMatch = logLine.match(/line\s+(\d+)/i);
                    if (lineMatch) { detectedErrorLine = parseInt(lineMatch[1], 10); break; }
                }
                if (detectedErrorLine) highlightErrorLine(detectedErrorLine);
				*/

				// additional error message polish
				for (const logLine of errorLogs) {
    				const lineMatch = logLine.match(/line\s+(\d+)/i);
    				if (lineMatch) { detectedErrorLine = parseInt(lineMatch[1], 10); detectedErrorMsg = logLine.trim(); break; }
				}
				if (detectedErrorLine) highlightErrorLine(detectedErrorLine, detectedErrorMsg);
				
            }
        }
    } catch (error) {
        if (placeholderText) placeholderText.textContent = "⚠️ Engine Crash";
        logToConsole(`Execution error: ${error.message || error}`);
    }
});

// ---------------------------------------------------------
// 🚀 RENDER PIPELINE (F6 — single pass, % ignored, clean STL)
// ---------------------------------------------------------
btnRender.addEventListener('click', async () => {
    if (!openSCADFactory) return;

    if (placeholderText) {
        placeholderText.textContent = "🛠️ Rendering...";
        placeholderText.style.display = 'flex';
    }

    clearErrorHighlights();
    logToConsole('--- Rendering (F6 — solid only, % ignored) ---');
    //const renderCode = rawEditorCode || jar.toString();
	const renderCode = jar.toString();
    const errorLogs = [];

    try {
        const createWasmInstance = async () => {
            return await openSCADFactory({
                noInitialRun: true,
                locateFile: (path) => `./libs/openscad.wasm`,
                ENV: { HOME: '/home/web_user' },
                preRun: [
                    function(Module) {
                        try { Module.FS.mkdir('/home'); } catch(e) {}
                        try { Module.FS.mkdir('/home/web_user'); } catch(e) {}
                        try { Module.FS.mkdir('/home/web_user/.fonts'); } catch(e) {}
                        for (const fontName of Object.keys(fontCache)) {
                            try {
                                const fontData = new Uint8Array(fontCache[fontName]);
                                Module.FS.writeFile(`/home/web_user/.fonts/${fontName}`, fontData);
                            } catch (fsErr) {}
                        }
                    }
                ],
                print: (text) => logToConsole(`[OpenSCAD]: ${text}`),
                printErr: (text) => {
                    errorLogs.push(text);
                    logToConsole(`[ERROR]: ${text}`);
                }
            });
        };

        logToConsole("⚡ Initializing Render Compiler Instance...");
        const renderInstance = await createWasmInstance();

        // Map external resources
        for (const stlName of Object.keys(stlCache)) {
            try { renderInstance.FS.writeFile(`/${stlName}`, new Uint8Array(stlCache[stlName])); } catch (e) {}
        }
        for (const svgName of Object.keys(svgCache)) {
            try { renderInstance.FS.writeFile(`/${svgName}`, new Uint8Array(svgCache[svgName])); } catch (e) {}
        }
        mountUserFilesIntoInstance(renderInstance, userFileCache); // 📄
        mountLibrariesIntoInstance(renderInstance, libCache); // 📚

        // Single pass — raw code straight to WASM, % handled natively (ignored)
        renderInstance.FS.writeFile('/render_input.scad', renderCode);

        let renderData = null;
        try {
            renderInstance.callMain(['/render_input.scad', '--backend=manifold', '-o', '/render.3mf']);
            if (renderInstance.FS.analyzePath('/render.3mf').exists) {
                renderData = renderInstance.FS.readFile('/render.3mf');
                currentStlBlob = new Blob([renderData], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
                btnExport.disabled = false;
            }
        } catch (err) {
            logToConsole("Render execution finished.");
        }

		if (renderData) {
            update3DModelViewer(renderData, null); // null = no ghost layer
            if (placeholderText) placeholderText.style.display = 'none';
            logToConsole("✅ Render complete. Model ready for export.");
        } else {
			if (!renderCode || renderCode.trim() === '' || errorLogs.some(l => l.includes('Current top level object is empty'))) {
                update3DModelViewer(null, null, null);
                if (placeholderText) {
                    placeholderText.textContent = "⚠️ Nothing to Render";
                    placeholderText.style.display = 'flex';
                }
            } else {
                if (errorLogs.some(l => l.includes('not a 3D object'))) {
                    logToConsole('ℹ️ Your model produces 2D geometry, which the 3D viewport cannot display.');
                    logToConsole('   Wrap it in linear_extrude() to give it height, e.g.:  linear_extrude(2) yourShape();');
                }
                if (placeholderText) placeholderText.textContent = "❌ Render Failed (Check Console)";
                let detectedErrorLine = null;
                for (const logLine of errorLogs) {
                    const lineMatch = logLine.match(/line\s+(\d+)/i);
                    if (lineMatch) { detectedErrorLine = parseInt(lineMatch[1], 10); break; }
                }
                if (detectedErrorLine) highlightErrorLine(detectedErrorLine);
            }
        }
    } catch (error) {
        if (placeholderText) placeholderText.textContent = "⚠️ Engine Crash";
        logToConsole(`Render error: ${error.message || error}`);
    }
});

// Export feature
btnExport.addEventListener('click', async () => {
    if (!openSCADFactory) return;

    const exportCode = jar.toString();
    if (!exportCode || exportCode.trim() === '') {
        logToConsole('[ERROR]: No code to export.');
        return;
    }

    logToConsole(`⚙️ Re-compiling current code for ${exportFormat} export...`);
    const errorLogs = [];

    try {
        const exportInstance = await openSCADFactory({
            noInitialRun: true,
            locateFile: (path) => `./libs/openscad.wasm`,
            ENV: { HOME: '/home/web_user' },
            preRun: [
                function(Module) {
                    try { Module.FS.mkdir('/home'); } catch(e) {}
                    try { Module.FS.mkdir('/home/web_user'); } catch(e) {}
                    try { Module.FS.mkdir('/home/web_user/.fonts'); } catch(e) {}
                    for (const fontName of Object.keys(fontCache)) {
                        try {
                            Module.FS.writeFile(`/home/web_user/.fonts/${fontName}`, new Uint8Array(fontCache[fontName]));
                        } catch (fsErr) {}
                    }
                }
            ],
            print: (text) => logToConsole(`[OpenSCAD]: ${text}`),
            printErr: (text) => { errorLogs.push(text); logToConsole(`[ERROR]: ${text}`); }
        });

        // Map imported STL/SVG resources
        for (const stlName of Object.keys(stlCache)) {
            try { exportInstance.FS.writeFile(`/${stlName}`, new Uint8Array(stlCache[stlName])); } catch (e) {}
        }
        for (const svgName of Object.keys(svgCache)) {
            try { exportInstance.FS.writeFile(`/${svgName}`, new Uint8Array(svgCache[svgName])); } catch (e) {}
        }
        mountUserFilesIntoInstance(exportInstance, userFileCache); // 📄
        mountLibrariesIntoInstance(exportInstance, libCache); // 📚

        // Single raw pass — identical semantics to Render (F6): % ignored, no ghost/highlight
        exportInstance.FS.writeFile('/export_input.scad', exportCode);

        let exportData = null;
        try {
            exportInstance.callMain(['/export_input.scad', '--backend=manifold', '-o', '/export.3mf']);
            if (exportInstance.FS.analyzePath('/export.3mf').exists) {
                exportData = exportInstance.FS.readFile('/export.3mf');
            }
        } catch (err) {
            logToConsole('Export compile finished.');
        }

        if (!exportData) {
            if (errorLogs.some(l => l.trim().startsWith('ERROR:'))) {
                logToConsole('[ERROR]: Export aborted — code has a compile error (check console).');
            } else if (errorLogs.some(l => l.includes('Current top level object is empty'))) {
                logToConsole('[ERROR]: Nothing to export — current code produced no geometry.');
            } else {
                logToConsole('[ERROR]: Export failed (check console).');
            }
            return;
        }

        const projectName = projectNameInput.value.trim() || 'openscad_model';

        if (exportFormat === '3MF') {
            // Write the freshly-compiled 3MF bytes straight to disk (native Z-up, color preserved)
            const blob = new Blob([exportData], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${projectName}.3mf`;
            link.click();
            logToConsole(`✔ Exported ${projectName}.3mf successfully!`);
        } else {
            // STL: parse the fresh 3MF to a group (already Z-up native) and serialize.
            // No rotation dance needed — we never applied the -PI/2 display correction here.
            logToConsole('📦 Packaging geometry into binary STL...');
            ensureJSZipShim();
            const loader = new THREE.ThreeMFLoader();
            const group = loader.parse(new Uint8Array(exportData).buffer);

            const exporter = new THREE.STLExporter();
            const stlResult = exporter.parse(group, { binary: true });

            const blob = new Blob([stlResult], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.href = link.href; // (kept simple; URL already set)
            link.download = `${projectName}.stl`;
            link.click();

            group.traverse((child) => { if (child.isMesh && child.geometry) child.geometry.dispose(); });
            logToConsole(`✔ Exported ${projectName}.stl successfully!`);
        }
    } catch (error) {
        logToConsole(`[ERROR]: Export failed: ${error.message || error}`);
        console.error(error);
    }
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

function init3DWorkspace() {
    if (workspaceInitialized) return; 
    workspaceInitialized = true;

    const container = document.getElementById('viewer-3d');
    const w = container.clientWidth || 500, h = container.clientHeight || 500;

    scene = new THREE.Scene(); scene.background = new THREE.Color(0x222222);
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000); camera.position.set(40, 40, 40);
    perspCamera = camera; // master camera: all framing math is perspective-native
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(w, h); renderer.setPixelRatio(window.devicePixelRatio); 
    container.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement); 
    controls.enableDamping = true; controls.dampingFactor = 0.1;
    // NOTE: native zoom stays ENABLED so touch pinch-zoom keeps working
    // (enableZoom = false would kill pinch on touchscreens, not just the
    // wheel). The wheel is intercepted below in CAPTURE phase with
    // stopPropagation, so OrbitControls never sees wheel events — mouse
    // wheel gets the custom smooth zoom, touch keeps the native pinch.

    // Suppress the smooth-zoom lerp while OrbitControls owns an active
    // gesture (pinch/rotate), and re-sync targets when the gesture ends —
    // otherwise the lerp fights a pinch with stale targets.
    let controlsInteracting = false;
    controls.addEventListener('start', () => { controlsInteracting = true; });
    controls.addEventListener('end', () => { controlsInteracting = false; syncSmoothZoomTargets(); });
    window.__scadliteControlsInteracting = () => controlsInteracting;

    // Listen for mouse wheel on the 3D container (capture: runs before, and
    // blocks, OrbitControls' own wheel handler on the canvas)
    container.addEventListener('wheel', (event) => {
        event.preventDefault();     // Stop the whole page from scrolling
        event.stopPropagation();    // Keep OrbitControls' dolly out of it

        if (isOrthographic && orthoCamera) {
            targetOrthoZoom *= Math.pow(1 + zoomIntensity, -event.deltaY);
            targetOrthoZoom = Math.max(0.1, Math.min(targetOrthoZoom, 5000));
        } else if (perspCamera) {
            targetPerspDistance *= Math.pow(1 + zoomIntensity, event.deltaY);
            targetPerspDistance = Math.max(0.5, Math.min(targetPerspDistance, 20000));
        }
    }, { passive: false, capture: true });

    syncSmoothZoomTargets(); // align targets with the STARTING camera so the
                             // first wheel tick doesn't lurch toward stale values

    rebuildGrid();
    rebuildAxes();
    
    const compassContainer = document.createElement('div');
    compassContainer.style.position = 'absolute'; compassContainer.style.top = '10px'; compassContainer.style.right = '10px'; compassContainer.style.width = '80px'; compassContainer.style.height = '80px'; compassContainer.style.zIndex = '100'; compassContainer.style.pointerEvents = 'none'; 
    container.appendChild(compassContainer);

    const compassScene = new THREE.Scene();
    const compassCamera = new THREE.PerspectiveCamera(50, 1, 1, 100);
    const compassRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); 
    compassRenderer.setSize(80, 80); compassRenderer.setPixelRatio(window.devicePixelRatio); compassContainer.appendChild(compassRenderer.domElement);

    const compassAxes = new THREE.AxesHelper(20); compassAxes.rotation.x = -Math.PI / 2;
    const colors = compassAxes.geometry.attributes.color;
    colors.setXYZ(0, 0.8, 0.32, 0.32); colors.setXYZ(1, 0.8, 0.32, 0.32); 
    colors.setXYZ(2, 0.32, 0.8, 0.48); colors.setXYZ(3, 0.32, 0.8, 0.48); 
    colors.setXYZ(4, 0.0, 0.48, 0.8);  colors.setXYZ(5, 0.0, 0.48, 0.8);  
    colors.needsUpdate = true; compassScene.add(compassAxes);

    const create2DLabel = (id, text, color) => {
        const oldEl = document.getElementById(id); if (oldEl) oldEl.remove();
        const el = document.createElement('div'); el.id = id; el.innerText = text; el.style.position = 'absolute'; el.style.color = color; el.style.fontFamily = 'Arial, sans-serif'; el.style.fontWeight = 'bold'; el.style.fontSize = '10px'; el.style.pointerEvents = 'none'; el.style.transform = 'translate(-50%, -50%)';
        compassContainer.appendChild(el); return el;
    };
    create2DLabel('compass-lbl-x', 'X', '#888888'); create2DLabel('compass-lbl-y', 'Y', '#888888'); create2DLabel('compass-lbl-z', 'Z', '#888888');

    scene.add(new THREE.AmbientLight(0xffffff, 0.55)); 
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.5); keyLight.position.set(150, 200, 100); scene.add(keyLight);
    const topLight = new THREE.DirectionalLight(0xffffff, 0.15); topLight.position.set(0, 250, 0); scene.add(topLight);
    const headlight = new THREE.DirectionalLight(0xffffff, 0.45); headlight.position.set(0, 0, 1); camera.add(headlight); scene.add(camera); 
    viewerHeadlight = headlight; // migrated between cameras on projection toggle
    
    function animate() {
        requestAnimationFrame(animate);
        const cw = container.clientWidth, ch = container.clientHeight;
        const currentSize = new THREE.Vector2(); renderer.getSize(currentSize);
        if (cw > 0 && ch > 0 && (currentSize.x !== cw || currentSize.y !== ch)) {
            updateCameraViewport(cw, ch);
        }

        // --- 🎢 EXECUTE SMOOTH ZOOM LERPING ---
        // (paused while OrbitControls owns a gesture, e.g. touch pinch)
        const zoomLerpPaused = typeof window.__scadliteControlsInteracting === 'function' && window.__scadliteControlsInteracting();
        if (zoomLerpPaused) {
            // targets re-sync on gesture end; nothing to lerp meanwhile
        } else if (isOrthographic && orthoCamera) {
            if (Math.abs(orthoCamera.zoom - targetOrthoZoom) > 0.001) {
                orthoCamera.zoom += (targetOrthoZoom - orthoCamera.zoom) * zoomSmoothness;
                orthoCamera.updateProjectionMatrix();
            }
        } else if (perspCamera) {
            const currentDist = perspCamera.position.distanceTo(controls.target);
            if (Math.abs(currentDist - targetPerspDistance) > 0.001) {
                const newDist = currentDist + (targetPerspDistance - currentDist) * zoomSmoothness;
                const dir = new THREE.Vector3().subVectors(perspCamera.position, controls.target).normalize();
                perspCamera.position.copy(controls.target).add(dir.multiplyScalar(newDist));
            }
        }

        controls.update(); 
        renderer.render(scene, camera);

        if (compassCamera && compassRenderer) {
            compassCamera.position.copy(camera.position); compassCamera.position.sub(controls.target); compassCamera.position.setLength(60); compassCamera.lookAt(0, 0, 0);
            compassRenderer.render(compassScene, compassCamera);
            const xEl = document.getElementById('compass-lbl-x'), yEl = document.getElementById('compass-lbl-y'), zEl = document.getElementById('compass-lbl-z');
            if (xEl && yEl && zEl && compassAxes) {
                const tempV = new THREE.Vector3(); compassScene.updateMatrixWorld(true);
                const updateLabelPosition = (element, x3d, y3d, z3d) => {
                    tempV.set(x3d, y3d, z3d).applyMatrix4(compassAxes.matrixWorld); tempV.project(compassCamera);
                    element.style.left = `${(tempV.x * 0.5 + 0.5) * 80}px`; element.style.top = `${(-tempV.y * 0.5 + 0.5) * 80}px`;
                };
                updateLabelPosition(xEl, 23, 0, 0); updateLabelPosition(yEl, 0, 23, 0); updateLabelPosition(zEl, 0, 0, 23);   // position axes labels past compass line segment endpoints
            }
        }
    }
    animate();
}

// ==========================================================================
// 🎨 MULTI-PASS 3MF VIEWER (Solids + Translucent Ghosts)
// ==========================================================================
function update3DModelViewer(solidData, ghostData = null, highlightData = null) {
    if (!workspaceInitialized) init3DWorkspace();

    let savedPosition = null;
    let savedTarget = null;
    if (currentMesh && camera && controls) {
        savedPosition = camera.position.clone();
        savedTarget = controls.target.clone();
    }

    // Safely remove the old mesh from the scene and free memory
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.traverse((child) => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        });
        currentMesh = null;
    }

    logToConsole("📥 Processing 3MF multi-pass graphics layout...");

    try {
        if (typeof fflate === 'undefined') {
            throw new Error("fflate.js library is missing or failed to load. Check your index.html tags!");
        }

        // THE COMPATIBILITY LAYER FOR THREE.JS 3MF LOADER
        window.JSZip = {
            loadAsync: async function(data) {
                const bytes = new Uint8Array(data);
                const unzippedFiles = fflate.unzipSync(bytes);
                return {
                    file: function(relativePath) {
                        const fileData = unzippedFiles[relativePath];
                        if (!fileData) return null;
                        return {
                            async: async function(type) {
                                if (type === 'string') return new TextDecoder().decode(fileData);
                                return fileData.buffer;
                            }
                        };
                    }
                };
            }
        };

        const loader = new THREE.ThreeMFLoader();
        const masterGroup = new THREE.Group();
        const fallbackHexColor = modelColorInput ? modelColorInput.value : "#3b82f6";

// ---------------------------------------------------------
        // 🎨 PASS 1: CORE SOLID GEOMETRY PROCESSING
        // ---------------------------------------------------------
        if (solidData) {
            const solidBytes = new Uint8Array(solidData);
            const solidGroup = loader.parse(solidBytes.buffer);
            
            if (solidGroup) {
                solidGroup.renderOrder = 1; // solid renders AFTER ghost

                solidGroup.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.computeVertexNormals();

                        const hasGeometryVertexColors = !!(child.geometry && child.geometry.attributes && child.geometry.attributes.color);
                        const materials = Array.isArray(child.material) ? child.material : [child.material];

                        materials.forEach((mat) => {
                            if (!mat) return;
                            const loaderFlaggedVertexColors = (mat.vertexColors === true || mat.vertexColors === THREE.VertexColors);
                            
                            let isDefaultOpenSCADYellow = false;
                            if (mat.color) {
                                const r = mat.color.r, g = mat.color.g, b = mat.color.b;
                                if (r > 0.70 && g > 0.55 && b < 0.50 && (r - b) > 0.15) {
                                    isDefaultOpenSCADYellow = true;
                                }
                            }
                            if (hasGeometryVertexColors) {
                                const colorAttr = child.geometry.attributes.color;
                                if (colorAttr && colorAttr.count > 0) {
                                    const vR = colorAttr.getX(0), vG = colorAttr.getY(0), vB = colorAttr.getZ(0);
                                    if (vR > 0.70 && vG > 0.55 && vB < 0.50 && (vR - vB) > 0.15) {
                                        isDefaultOpenSCADYellow = true;
                                    }
                                }
                            }

                            let isCustomColor = false;
                            if (hasGeometryVertexColors || loaderFlaggedVertexColors) {
                                if (!isDefaultOpenSCADYellow) isCustomColor = true;
                            } else if (mat.color) {
                                const isWhite = (mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1);
                                if (!isDefaultOpenSCADYellow || isWhite) isCustomColor = true;
                            }

                            if (isCustomColor) {
                                if (hasGeometryVertexColors || loaderFlaggedVertexColors) {
                                    mat.vertexColors = true;
                                    mat.color.setRGB(1, 1, 1);
                                } else {
                                    mat.vertexColors = false;
                                }
                                if (mat.opacity < 1.0) {
                                    mat.transparent = true;
                                    mat.depthWrite = mat.opacity >= 0.8;
                                    mat.side = mat.opacity < 0.8 ? THREE.DoubleSide : THREE.FrontSide;
                                } else {
                                    mat.transparent = false;
                                    mat.depthWrite = true;
                                    mat.side = THREE.FrontSide;
                                }
                            } else {
                                mat.vertexColors = false;
                                mat.color.set(fallbackHexColor);
                                mat.transparent = false;
                                mat.depthWrite = true;
                                mat.side = THREE.FrontSide;
                                mat.opacity = 1.0;
                            }

                            mat.roughness = 0.5;
                            mat.metalness = 0.1;
                            // (wireframe handled by applyWireframeMode() after load — it swaps in an UNLIT material)
                            mat.needsUpdate = true;
                        });

                        child.renderOrder = 1; // each solid mesh renders after ghost meshes
                    }
                });
                masterGroup.add(solidGroup);
            }
        }

        // ---------------------------------------------------------
        // 💎 PASS 2: GHOST GEOMETRY PROCESSING (SMOKY GLASS)
        // ---------------------------------------------------------
        if (ghostData) {
            if (consoleDebugging) {
				logToConsole("🪲 [DEBUG] Parsing Ghost Data Mesh Layer...");
			}
            const ghostBytes = new Uint8Array(ghostData);
            const ghostGroup = loader.parse(ghostBytes.buffer);
            
            if (ghostGroup) {
                let meshCount = 0;
                
                // Ghost renders FIRST (renderOrder 0) so solid geometry draws on top
                ghostGroup.renderOrder = 0;

                ghostGroup.traverse((child) => {
                    if (child.isMesh) {
                        meshCount++;
                        if (child.geometry) child.geometry.computeVertexNormals();
                        
                        const glassMaterial = new THREE.MeshStandardMaterial({
                            color: 0xa5f3fc,
                            transparent: true,
                            opacity: 0.30,
                            depthWrite: false,  // don't block solid geometry
                            depthTest: true,    // but do test against existing depth
                            side: THREE.DoubleSide,
                            roughness: 0.15,
                            metalness: 0.1
                        });


                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(() => glassMaterial.clone());
                        } else {
                            child.material = glassMaterial;
                        }
                        
                        child.renderOrder = 0; // each ghost mesh renders before solid meshes
                        child.material.needsUpdate = true;
                    }
                });

				if (consoleDebugging) {
                	logToConsole(`🪲 [DEBUG] Ghost Pass found and processed ${meshCount} glass meshes.`);
				}
                masterGroup.add(ghostGroup);
            }
        }

        // ---------------------------------------------------------
        // 🔴 PASS 3: HIGHLIGHT GEOMETRY PROCESSING (SEMI-TRANSPARENT RED)
        // ---------------------------------------------------------
        if (highlightData) {
            if (consoleDebugging) logToConsole("🪲 [DEBUG] Parsing Highlight Data Mesh Layer...");
            const highlightBytes = new Uint8Array(highlightData);
            const highlightGroup = loader.parse(highlightBytes.buffer);

            if (highlightGroup) {
                let meshCount = 0;

                // Highlight renders between ghost (0) and solid (1)
                highlightGroup.renderOrder = 0;

                highlightGroup.traverse((child) => {
                    if (child.isMesh) {
                        meshCount++;
                        if (child.geometry) child.geometry.computeVertexNormals();

						/*
						const highlightMaterial = new THREE.MeshStandardMaterial({
                            color: 0xff4444,
                            transparent: true,
                            opacity: 0.45,
                            depthWrite: false,
                            depthTest: true,
                            side: THREE.DoubleSide,
                            roughness: 0.2,
                            metalness: 0.1
                        });
						*/
						
						const highlightMaterial = new THREE.MeshStandardMaterial({
                            color: 0xff2266,
                            transparent: true,
                            opacity: 0.65,
                            depthWrite: false,
                            depthTest: true,
                            side: THREE.DoubleSide,
                            roughness: 0.1,
                            metalness: 0.3,
                            emissive: 0x440011,
                            emissiveIntensity: 0.4
                        });


                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(() => highlightMaterial.clone());
                        } else {
                            child.material = highlightMaterial;
                        }

                        child.renderOrder = 0;
                        child.material.needsUpdate = true;
                    }
                });

                if (consoleDebugging) logToConsole(`🪲 [DEBUG] Highlight Pass found and processed ${meshCount} highlight meshes.`);
                masterGroup.add(highlightGroup);
            }
        }


		/*
		// ---------------------------------------------------------
        // 💎 PASS 2: GHOST GEOMETRY PROCESSING (DEBUG OPAQUE MODE)
        // ---------------------------------------------------------
        if (ghostData) {
            logToConsole("🪲 [DEBUG] Parsing Ghost Data Mesh Layer...");
            const ghostBytes = new Uint8Array(ghostData);
            const ghostGroup = loader.parse(ghostBytes.buffer);
            
            if (ghostGroup) {
                let meshCount = 0;
                ghostGroup.traverse((child) => {
                    if (child.isMesh) {
                        meshCount++;
                        if (child.geometry) child.geometry.computeVertexNormals();
                        
                        // 🚨 FORCE OPAQUE HIGH-VISIBILITY MATERIAL
                        const debugMaterial = new THREE.MeshStandardMaterial({
                            color: 0xff00ff,          // Bright Neon Magenta / Fuchsia
                            transparent: false,       // <-- BYPASS TRANSPARENCY ENTIRELY
                            opacity: 1.0,             // Fully solid
                            depthWrite: true,         // Standard depth behavior
                            side: THREE.DoubleSide,   // Render inside and outside walls
                            roughness: 0.4,
                            metalness: 0.2
                        });


                        // Override material arrays safely
                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(() => debugMaterial.clone());
                        } else {
                            child.material = debugMaterial;
                        }
                        
                        child.material.needsUpdate = true;
                    }
                });
                
                logToConsole(`🪲 [DEBUG] Ghost Pass found and processed ${meshCount} meshes inside 3MF.`);
                masterGroup.add(ghostGroup);
            } else {
                logToConsole("🪲 [DEBUG ALERT] Ghost 3MF parsed into an empty group object.");
            }
        }
		*/

        // Complete compilation group assignment
        currentMesh = masterGroup;
        currentMesh.rotation.x = -Math.PI / 2; // Correct OpenSCAD coordinate system to Three.js space
        scene.add(currentMesh);

        // Retain view camera positions smoothly — unless a model was just
        // loaded/opened, in which case reset the camera to frame it.
        if (pendingCameraReset) {
            pendingCameraReset = false;
            frameModelInCamera(currentMesh);
        } else if (savedPosition && savedTarget) {
            camera.position.copy(savedPosition);
            controls.target.copy(savedTarget);
            controls.update();
            syncSmoothZoomTargets();
        } else {
            frameModelInCamera(currentMesh);
        }

        applyWireframeMode();          // 🕸 new meshes inherit the session mode
        refreshViewerToolbar();        // 🎛️ button active-states track the scene

        if (typeof render === 'function') render();
        logToConsole("✨ 3D Render Canvas Updated Successfully.");

    } catch (err) {
        console.error("3MF Parse Pipeline Failure via fflate:", err);
        logToConsole(`[ERROR] 3D Viewer pipeline failed: ${err.message}`);
        if (placeholderText) {
            placeholderText.textContent = "❌ Render Error (Check Console)";
            placeholderText.style.display = 'flex';
        }
    }
}

function ensureJSZipShim() {
    if (window.JSZip) return; // already set up by update3DModelViewer
    if (typeof fflate === 'undefined') throw new Error("fflate.js library is missing.");
    window.JSZip = {
        loadAsync: async function(data) {
            const bytes = new Uint8Array(data);
            const unzippedFiles = fflate.unzipSync(bytes);
            return {
                file: function(relativePath) {
                    const fileData = unzippedFiles[relativePath];
                    if (!fileData) return null;
                    return {
                        async: async function(type) {
                            if (type === 'string') return new TextDecoder().decode(fileData);
                            return fileData.buffer;
                        }
                    };
                }
            };
        }
    };
}

btnPreview.disabled = true; btnRender.disabled = true; btnExport.disabled = true;
initOpenSCAD(); init3DWorkspace();
window.switchWorkspace = switchWorkspace;   // temporary testing aid
btnWireframe.style.background = '#3b82f6'; 
if (btnProjection) btnProjection.style.background = '#3b82f6';

// 🕸📐 Apply persisted view-mode settings. Written by setWireframeMode /
// setProjectionMode, swept into backups like every other openscad_* key.
// Must run AFTER init3DWorkspace() (projection needs the cameras built) and
// after the default btnWireframe styling above. Both are no-ops when the
// stored value matches the defaults (solid / perspective / key absent).
if (localStorage.getItem('openscad_wireframe_mode') === 'enabled') setWireframeMode(true);
if (localStorage.getItem('openscad_projection') === 'orthogonal') setProjectionMode(true);

// ==========================================================================
// ⚙️ SETTINGS & MANAGER MODALS
// ==========================================================================
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
//const settingsOverlay = document.getElementById('settings-overlay');    // already declared with other Dom elements at top of source
// Grid/axes numeric inputs (replace the old Visible/Hidden toggle buttons)
const gridStepInput = document.getElementById('grid-step-input');
const gridRangeInput = document.getElementById('grid-range-input');
const axesStepInput = document.getElementById('axes-step-input');
const axesRangeInput = document.getElementById('axes-range-input');
const axesHashInput = document.getElementById('axes-hash-input');

// FONT DOM
const btnOpenFontsMenu = document.getElementById('btn-open-fonts-menu');
const fontsOverlay = document.getElementById('fonts-overlay');
const btnCloseFonts = document.getElementById('btn-close-fonts');
const fontUploadInput = document.getElementById('font-upload');

// STL DOM
const btnOpenStlsMenu = document.getElementById('btn-open-stls-menu');
const stlsOverlay = document.getElementById('stls-overlay');
const btnCloseStls = document.getElementById('btn-close-stls');
const stlUploadInput = document.getElementById('stl-upload');

// SVG DOM
const btnOpenSvgsMenu = document.getElementById('btn-open-svgs-menu');
const svgsOverlay = document.getElementById('svgs-overlay');
const btnCloseSvgs = document.getElementById('btn-close-svgs');
const svgUploadInput = document.getElementById('svg-upload');

// 📚 LIBRARIES DOM
const btnOpenLibsMenu = document.getElementById('btn-open-libs-menu');
const libsOverlay = document.getElementById('libs-overlay');
const btnCloseLibs = document.getElementById('btn-close-libs');
const libUploadInput = document.getElementById('lib-upload');

// 📄 MY FILES (APP FS) DOM
const btnOpenAppFs = document.getElementById('btn-open');
const btnSaveAppFs = document.getElementById('btn-save-appfs');
const openFilesOverlay = document.getElementById('openfiles-overlay');
const btnCloseOpenFiles = document.getElementById('btn-close-openfiles');
const userFileNameInput = document.getElementById('userfile-name-input');
const btnUserFileSave = document.getElementById('btn-userfile-save');
const btnDownloadAllZip = document.getElementById('btn-download-all-zip');

// ✅ CONFIRM OVERLAY DOM (reusable)
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmTitleEl = document.getElementById('confirm-title');
const confirmMessageEl = document.getElementById('confirm-message');
const btnConfirmYes = document.getElementById('btn-confirm-yes');
const btnConfirmNo = document.getElementById('btn-confirm-no');

// 💾 BACKUP / RESTORE DOM
const btnBackupAll = document.getElementById('btn-backup-all');
const btnRestoreAll = document.getElementById('btn-restore-all');
const backupRestoreUpload = document.getElementById('backup-restore-upload');

// 📜 LICENSES DOM (ADDED)
const btnOpenLicensesMenu = document.getElementById('btn-open-licenses-menu');
const licensesOverlay = document.getElementById('licenses-overlay');
const btnCloseLicenses = document.getElementById('btn-close-licenses');
const licensesTextContainer = document.getElementById('licenses-text-container');

// 📄 CREDITS AND LICENSE TEXT LITERAL
const THIRD_PARTY_LICENSES_TEXT = `CREDITS & THIRD-PARTY OPEN SOURCE NOTICES

SCADLite was architected, designed, and tested by Michael Young. 

The vast majority of the code syntax in this application was generated 
using Google Gemini Large Language Models (including Gemini Flash, Gemini 
Pro, and Gemini Experimental/Thinking models).

Additional work was performed with the assistance of Anthropic Claude
(Sonnet and Opus).

The author's role focused on structural engineering ideas, UI/UX steering, 
extensive behavioral testing, and orchestrating the integration of the 
third-party libraries listed below.

===========================================================================
                       SCADLite (GNU GPL v2 License)
===========================================================================
<a href="https://github.com/myoung8223/scadlite" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/myoung8223/scadlite</a>

SCADLite is Copyright (c) 2026 Michael Young.

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License.

Please see the "GNU GENERAL PUBLIC LICENSE (VERSION 2)" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
                    OpenSCAD WASM (GNU GPL v2 License)
===========================================================================
<a href="https://github.com/openscad/openscad-wasm" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/openscad/openscad-wasm</a>

OpenSCAD is Copyright (c) 2009-2026 Clifford Wolf, Marius Kintel, et al.
This port is distributed under the GNU General Public License, version 2.

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License.

Please see the "GNU GENERAL PUBLIC LICENSE (VERSION 2)" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
                         CodeMirror (MIT License)
===========================================================================
<a href="https://codemirror.net/" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://codemirror.net/</a>

Copyright (c) by Marijn Haverbeke and others

CodeMirror is a code editor component for the web. SCADLite bundles the
@codemirror/* packages (view, state, commands, language, search,
autocomplete, lint) and @lezer/highlight into a single editor module.

Please see the "MIT LICENSE" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
                           fflate (MIT License)
===========================================================================
<a href="https://github.com/101arrowz/fflate" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/101arrowz/fflate</a>

Copyright © 2026 Arjun Barrett

Please see the "MIT LICENSE" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
                           three.js (MIT License)
===========================================================================
<a href="https://github.com/mrdoob/three.js" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/mrdoob/three.js</a>

Copyright © 2010-2026 three.js authors

Please see the "MIT LICENSE" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
           Liberation Fonts (SIL Open Font License Version 1.1)
===========================================================================
<a href="https://github.com/liberationfonts/liberation-fonts" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/liberationfonts/liberation-fonts</a>

Digitized data copyright (c) 2010 Google Corporation
	with Reserved Font Arimo, Tinos and Cousine.
Copyright (c) 2012 Red Hat, Inc.
	with Reserved Font Name Liberation.

This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE The goals of the Open Font License (OFL) are to stimulate
worldwide development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to provide
a free and open framework in which fonts may be shared and improved in
partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves.
The fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works.  The fonts and derivatives,
however, cannot be released under any other type of license.  The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such.
This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components
as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting ? in part or in whole ?
any of the components of the Original Version, by changing formats or
by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer
or other person who contributed to the Font Software.


PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,in
   Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
   redistributed and/or sold with any software, provided that each copy
   contains the above copyright notice and this license. These can be
   included either as stand-alone text files, human-readable headers or
   in the appropriate machine-readable metadata fields within text or
   binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
   Name(s) unless explicit written permission is granted by the
   corresponding Copyright Holder. This restriction only applies to the
   primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
   Software shall not be used to promote, endorse or advertise any
   Modified Version, except to acknowledge the contribution(s) of the
   Copyright Holder(s) and the Author(s) or with their explicit written
   permission.

5) The Font Software, modified or unmodified, in part or in whole, must
   be distributed entirely under this license, and must not be distributed
   under any other license. The requirement for fonts to remain under
   this license does not apply to any document created using the Font
   Software.
   
TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT.  IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.

===========================================================================
                  GNU GENERAL PUBLIC LICENSE (VERSION 2)
===========================================================================
Applies to: SCADLite, OpenSCAD WASM

                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991

 Copyright (C) 1989, 1991 Free Software Foundation, Inc.,
 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The licenses for most software are designed to take away your
freedom to share and change it.  By contrast, the GNU General Public
License is intended to guarantee your freedom to share and change free
software--to make sure the software is free for all its users.  This
General Public License applies to most of the Free Software
Foundation's software and to any other program whose authors commit to
using it.  (Some other Free Software Foundation software is covered by
the GNU Lesser General Public License instead.)  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
this service if you wish), that you receive source code or can get it
if you want it, that you can change the software or use pieces of it
in new free programs; and that you know you can do these things.

  To protect your rights, we need to make restrictions that forbid
anyone to deny you these rights or to ask you to surrender the rights.
These restrictions translate to certain responsibilities for you if you
distribute copies of the software, or if you modify it.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must give the recipients all the rights that
you have.  You must make sure that they, too, receive or can get the
source code.  And you must show them these terms so they know their
rights.

  We protect your rights with two steps: (1) copyright the software, and
(2) offer you this license which gives you legal permission to copy,
distribute and/or modify the software.

  Also, for each author's protection and ours, we want to make certain
that everyone understands that there is no warranty for this free
software.  If the software is modified by someone else and passed on, we
want its recipients to know that what they have is not the original, so
that any problems introduced by others will not reflect on the original
authors' reputations.

  Finally, any free program is threatened constantly by software
patents.  We wish to avoid the danger that redistributors of a free
program will individually obtain patent licenses, in effect making the
program proprietary.  To prevent this, we have made it clear that any
patent must be licensed for everyone's free use or not licensed at all.

  The precise terms and conditions for copying, distribution and
modification follow.

                    GNU GENERAL PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. This License applies to any program or other work which contains
a notice placed by the copyright holder saying it may be distributed
under the terms of this General Public License.  The "Program", below,
refers to any such program or work, and a "work based on the Program"
means either the Program or any derivative work under copyright law:
that is to say, a work containing the Program or a portion of it,
either verbatim or with modifications and/or translated into another
language.  (Hereinafter, translation is included without limitation in
the term "modification".)  Each licensee is addressed as "you".

Activities other than copying, distribution and modification are not
covered by this License; they are outside its scope.  The act of
running the Program is not restricted, and the output from the Program
is covered only if its contents constitute a work based on the
Program (independent of having been made by running the Program).
Whether that is true depends on what the Program does.

  1. You may copy and distribute verbatim copies of the Program's
source code as you receive it, in any medium, provided that you
conspicuously and appropriately publish on each copy an appropriate
copyright notice and disclaimer of warranty; keep intact all the
notices that refer to this License and to the absence of any warranty;
and give any other recipients of the Program a copy of this License
along with the Program.

You may copy a fee for the physical act of transferring a copy, and
you may at your option offer warranty protection in exchange for a fee.

  2. You may modify your copy or copies of the Program or any portion
of it, thus forming a work based on the Program, and copy and
distribute such modifications or work under the terms of Section 1
above, provided that you also meet all of these conditions:

    a) You must cause the modified files to carry prominent notices
    stating that you changed the files and the date of any change.

    b) You must cause any work that you distribute or publish, that in
    whole or in part contains or is derived from the Program or any
    part thereof, to be licensed as a whole at no charge to all third
    parties under the terms of this License.

    c) If the modified program normally reads commands interactively
    when run, you must cause it, when started running for such
    interactive use in the most ordinary way, to print or display an
    announcement including an appropriate copyright notice and a
    notice that there is no warranty (or else, saying that you provide
    a warranty) and that users may redistribute the program under
    these conditions, and telling the user how to view a copy of this
    License.  (Exception: if the Program itself is interactive but
    does not normally print such an announcement, your work based on
    the Program is not required to print an announcement.)

These requirements apply to the modified work as a whole.  If
identifiable sections of that work are not derived from the Program,
and can be reasonably considered independent and separate works in
themselves, then this License, and its terms, do not apply to those
sections when you distribute them as separate works.  But when you
distribute the same sections as part of a whole which is a work based
on the Program, the distribution of the whole must be on the terms of
this License, whose permissions for other licensees extend to the
entire whole, and thus to each and every part regardless of who wrote it.

Thus, it is not the intent of this section to claim rights or contest
your rights to work written entirely by you; rather, the intent is to
exercise the right to control the distribution of derivative or
collective works based on the Program.

In addition, mere aggregation of another work not based on the Program
with the Program (or with a work based on the Program) on a volume of
a storage or distribution medium does not bring the other work under
the scope of this License.

  3. You may copy and distribute the Program (or a work based on it,
under Section 2) in object code or executable form under the terms of
Sections 1 and 2 above provided that you also do one of the following:

    a) Accompany it with the complete corresponding machine-readable
    source code, which must be distributed under the terms of Sections
    1 and 2 above on a medium customarily used for software interchange; or,

    b) Accompany it with a written offer, valid for at least three
    years, to give any third party, for a charge no more than your
    cost of physically performing source distribution, a complete
    machine-readable copy of the corresponding source code, to be
    distributed under the terms of Sections 1 and 2 above on a medium
    customarily used for software interchange; or,

    c) Accompany it with the information you received as to the offer
    to distribute corresponding source code.  (This alternative is
    allowed only for noncommercial distribution and only if you
    received the program in object code or executable form with such
    an offer, in accord with Subsection b above.)

The source code for a work means the preferred form of the work for
making modifications to it.  For an executable work, complete source
code means all the source code for all modules it contains, plus any
associated interface definition files, plus the scripts used to
control compilation and installation of the executable.  However, as a
special exception, the source code distributed need not include
anything that is normally distributed (in either source or binary
form) with the major components (compiler, kernel, and so on) of the
operating system on which the executable runs, unless that component
itself accompanies the executable.

If distribution of executable or object code is made by offering
access to copy from a designated place, then offering equivalent
access to copy the source code from the same place counts as
distribution of the source code, even though third parties are not
compelled to copy the source along with the object code.

  4. You may not copy, modify, sublicense, or distribute the Program
except as expressly provided under this License.  Any attempt
otherwise to copy, modify, sublicense or distribute the Program is
void, and will automatically terminate your rights under this License.
However, parties who have received copies, or rights, from you under
this License will not have their licenses terminated so long as such
parties remain in full compliance.

  5. You are not required to accept this License, since you have not
signed it.  However, nothing else grants you permission to modify or
distribute the Program or its derivative works.  These actions are
prohibited by law if you do not accept this License.  Therefore, by
modifying or distributing the Program (or any work based on the
Program), you indicate your acceptance of this License to do so, and
all its terms and conditions for copying, distributing or modifying
the Program or works based on it.

  6. Each time you redistribute the Program (or any work based on the
Program), the recipient automatically receives a license from the
original licensor to copy, distribute or modify the Program subject to
these terms and conditions.  You may not impose any further
restrictions on the recipients' exercise of the rights granted herein.
You are not responsible for enforcing compliance by third parties to
this License.

  7. If, as a consequence of a court judgment or allegation of patent
infringement or for any other reason (not limited to patent issues),
conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot
distribute so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you
may not distribute the Program at all.  For example, if a patent
license would not permit royalty-free redistribution of the Program by
all those who receive copies directly or indirectly through you, then
the only way you could satisfy both it and this License would be to
refrain entirely from distribution of the Program.

If any portion of this section is held invalid or unenforceable under
any particular circumstance, the balance of the section is intended to
apply and the section as a whole is intended to apply in other
circumstances.

It is not the purpose of this section to induce you to infringe any
patents or other property right claims or to contest validity of any
such claims; this section has the sole purpose of protecting the
integrity of the free software distribution system, which is
implemented by public license practices.  Many people have made
generous contributions to the wide range of software distributed
through that system in reliance on consistent application of that
system; it is up to the author/donor to decide if he or she is willing
to distribute software through any other system and a licensee cannot
impose that choice.

This section is intended to make thoroughly clear what is believed to
be a consequence of the rest of this License.

  8. If the distribution and/or use of the Program is restricted in
certain countries either by patents or by copyrighted interfaces, the
original copyright holder who places the Program under this License
may add an explicit geographical distribution limitation excluding
those countries, so that distribution is permitted only in or among
countries not thus excluded.  In such case, this License incorporates
the limitation as if written in the body of this License.

  9. The Free Software Foundation may publish revised and/or new versions
of the General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

Each version is given a distinguishing version number.  If the Program
specifies a version number of this License which applies to it and "any
later version", you have the option of following the terms and conditions
either of that version or of any later version published by the Free
Software Foundation.  If the Program does not specify a version number of
this License, you may choose any version ever published by the Free Software
Foundation.

  10. If you wish to incorporate parts of the Program into other free
programs whose distribution conditions are different, write to the author
to ask for permission.  For software which is copyrighted by the Free
Software Foundation, write to the Free Software Foundation; we sometimes
make exceptions for this.  Our decision will be guided by the two goals
of preserving the free status of all derivatives of our free software and
of promoting the sharing and reuse of software generally.

                            NO WARRANTY

  11. BECAUSE THE PROGRAM IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY
FOR THE PROGRAM, TO THE EXTENT PERMITTED BY APPLICABLE LAW.  EXCEPT WHEN
OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR OTHER PARTIES
PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED
OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.  THE ENTIRE RISK AS
TO THE QUALITY AND PERFORMANCE OF THE PROGRAM IS WITH YOU.  SHOULD THE
PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL NECESSARY SERVICING,
REPAIR OR CORRECTION.

  12. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR
REDISTRIBUTE THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES,
INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING
OUT OF THE USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED
TO LOSS OF DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY
YOU OR THIRD PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER
PROGRAMS), EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
convey the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along
    with this program; if not, write to the Free Software Foundation, Inc.,
    51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

Also add information on how to contact you by electronic and paper mail.

If the program is interactive, make it output a short notice like this
when it starts in an interactive mode:

    Gnomovision version 69, Copyright (C) year name of author
    Gnomovision comes with ABSOLUTELY NO WARRANTY; for details type \`show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type \`show c' for details.

The hypothetical commands \`show w' and \`show c' should show the appropriate
parts of the General Public License.  Of course, the commands you use may
be called something other than \`show w' and \`show c'; they could even be
mouse-clicks or menu items--whatever suits your program.

You should also get your employer (if you work as a programmer) or your
school, if any, to sign a "copyright disclaimer" for the program, if
necessary.  Here is a sample; alter the names:

  Yoyodyne, Inc., hereby disclaims all copyright interest in the program
  \`Gnomovision' (which makes passes at compilers) written by James Hacker.

  <signature of Ty Coon>, 1 April 1989
  Ty Coon, President of Vice

This General Public License does not permit incorporating your program into
proprietary programs.  If your program is a subroutine library, you may
consider it more useful to permit linking proprietary applications with the
library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.

===========================================================================
                                MIT LICENSE
===========================================================================
Applies to: CodeMirror, Three.js, fflate

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
`;

function closeAllMenus() {
    if (settingsOverlay) settingsOverlay.classList.add('hidden');
    if (fontsOverlay) fontsOverlay.classList.add('hidden');
    if (stlsOverlay) stlsOverlay.classList.add('hidden');
    if (svgsOverlay) svgsOverlay.classList.add('hidden');
    if (licensesOverlay) licensesOverlay.classList.add('hidden');
    if (typeof loadOverlay !== 'undefined' && loadOverlay) loadOverlay.classList.add('hidden');
    if (typeof libsOverlay !== 'undefined' && libsOverlay) libsOverlay.classList.add('hidden');
    if (typeof openFilesOverlay !== 'undefined' && openFilesOverlay) openFilesOverlay.classList.add('hidden');
	if (typeof helpOverlay !== 'undefined' && helpOverlay) helpOverlay.classList.add('hidden');
}

// Update your window click listener to include the new overlay
window.addEventListener('click', (event) => {
    if (event.target === settingsOverlay || event.target === fontsOverlay || event.target === stlsOverlay || event.target === svgsOverlay || event.target === licensesOverlay) {
        closeAllMenus();
    }
});

// Update your Escape key listener
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        // Confirm dialog first: Esc = Cancel (via the No button, so the
        // showConfirm promise resolves and its listeners clean up).
        if (confirmOverlay && !confirmOverlay.classList.contains('hidden')) {
            if (btnConfirmNo) btnConfirmNo.click();
            return;
        }
        const isAnyOpen = [settingsOverlay, fontsOverlay, stlsOverlay, svgsOverlay, licensesOverlay, helpOverlay, libsOverlay, openFilesOverlay, loadOverlay].some(el => el && !el.classList.contains('hidden'));
        if (isAnyOpen) { logToConsole('⌨️ Hotkey Triggered: [Escape] - Closing Overlays'); closeAllMenus(); }
    }
});

/*
// ---- LICENSES BRIDGES & RENDERING ----
if (btnOpenLicensesMenu) {
    btnOpenLicensesMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (licensesOverlay) {
            licensesOverlay.classList.remove('hidden');
            // Inject the string literal into the pre/code container
            if (licensesTextContainer) {
                licensesTextContainer.textContent = THIRD_PARTY_LICENSES_TEXT;
            }
        }
    });
}
*/

// ---- LICENSES BRIDGES & RENDERING ----
if (btnOpenLicensesMenu) {
    btnOpenLicensesMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (licensesOverlay) {
            licensesOverlay.classList.remove('hidden');
            // 🌐 INJECT AS HTML SO THE GITHUB URL BECOMES A CLICKABLE LINK
            if (licensesTextContainer) {
                licensesTextContainer.innerHTML = THIRD_PARTY_LICENSES_TEXT;
            }
        }
    });
}

if (btnCloseLicenses) {
    btnCloseLicenses.addEventListener('click', () => {
        if (licensesOverlay) licensesOverlay.classList.add('hidden');
        if (settingsOverlay) settingsOverlay.classList.remove('hidden'); 
    });
}

/*
function closeAllMenus() {
    if (settingsOverlay) settingsOverlay.classList.add('hidden');
    if (fontsOverlay) fontsOverlay.classList.add('hidden');
    if (stlsOverlay) stlsOverlay.classList.add('hidden');
    if (svgsOverlay) svgsOverlay.classList.add('hidden');
}
*/

if (btnSettings) btnSettings.addEventListener('click', () => settingsOverlay.classList.remove('hidden'));
if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeAllMenus);

window.addEventListener('click', (event) => {
    if (event.target === settingsOverlay || event.target === fontsOverlay || event.target === stlsOverlay || event.target === svgsOverlay || event.target === loadOverlay) closeAllMenus();
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const isAnyOpen = [settingsOverlay, fontsOverlay, stlsOverlay, svgsOverlay].some(el => el && !el.classList.contains('hidden'));
        if (isAnyOpen) { logToConsole('⌨️ Hotkey Triggered: [Escape] - Closing Overlays'); closeAllMenus(); }
    }
});

// 🔍 FONT METADATA PARSER
function extractFontMetadata(uint8Array) {
    try {
        const data = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
        const signature = data.getUint32(0, false);
        if (signature !== 0x00010000 && signature !== 0x4F54544F && signature !== 0x74727565) return null;
        const numTables = data.getUint16(4, false);
        let nameTableOffset = -1;
        for (let i = 0; i < numTables; i++) {
            const offset = 12 + i * 16;
            const tag = String.fromCharCode(data.getUint8(offset), data.getUint8(offset+1), data.getUint8(offset+2), data.getUint8(offset+3));
            if (tag === 'name') { nameTableOffset = data.getUint32(offset + 8, false); break; }
        }
        if (nameTableOffset === -1) return null;
        const count = data.getUint16(nameTableOffset + 2, false), stringOffset = data.getUint16(nameTableOffset + 4, false);
        let family = "Unknown", style = "Unknown";
        for (let i = 0; i < count; i++) {
            const recordOffset = nameTableOffset + 6 + i * 12;
            const platformID = data.getUint16(recordOffset, false), nameID = data.getUint16(recordOffset + 6, false), length = data.getUint16(recordOffset + 8, false), offset = data.getUint16(recordOffset + 10, false);
            if (nameID === 1 || nameID === 2) {
                const strOffset = nameTableOffset + stringOffset + offset; let str = "";
                if (platformID === 1) for (let j = 0; j < length; j++) str += String.fromCharCode(data.getUint8(strOffset + j));
                else if (platformID === 3) for (let j = 0; j < length; j += 2) str += String.fromCharCode(data.getUint16(strOffset + j, false));
                if (str && str.trim().length > 0) {
                    const cleanStr = str.replace(/\0/g, ''); 
                    if (nameID === 1) family = cleanStr; if (nameID === 2) style = cleanStr;
                }
            }
        }
        return { family, style };
    } catch (e) { return null; }
}

// 🎨 FONT RENDERER
async function renderCustomFontManagerList() {
    const listContainer = document.getElementById('custom-fonts-manager-list');
    if (!listContainer) return;
    const customFonts = await getPersistentFonts();
    if (customFonts.length === 0) { listContainer.innerHTML = `<div style="font-size: 0.8rem; color: #555; text-align: center; padding: 12px; font-style: italic;">No custom fonts installed</div>`; return; }
    listContainer.innerHTML = ''; 
    customFonts.forEach(font => {
        let meta = { family: 'Unknown', style: 'Unknown' };
        if (font.binary) meta = extractFontMetadata(font.binary) || meta;
        //const safeFamily = meta.family.replace(/-/g, '\\-');
        const safeFamily = meta.family.replace(/-/g, '\\\\-');   // Fontconfig requires '\-' for literal hyphens, which means we must double-escape ('\\\\-') for OpenSCAD's C-style string parser.
        let openScadSyntax = `font = "${safeFamily}"`;
        if (meta.style !== 'Unknown' && meta.style !== 'Regular') openScadSyntax = `font = "${safeFamily}:style=${meta.style}"`;

        const rowWrap = document.createElement('div'); rowWrap.style.display = 'flex'; rowWrap.style.flexDirection = 'column'; rowWrap.style.padding = '8px 10px'; rowWrap.style.borderBottom = '1px solid #222'; rowWrap.style.gap = '6px';
        const topRow = document.createElement('div'); topRow.style.display = 'flex'; topRow.style.justifyContent = 'space-between'; topRow.style.alignItems = 'center';
        const nameLabel = document.createElement('span'); nameLabel.textContent = font.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '360px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            if (!(await showConfirm('Uninstall font?', `Remove "${font.filename}" from your installed fonts?`, 'Uninstall'))) return;
                await deletePersistentFont(font.filename); delete fontCache[font.filename]; 
                logToConsole(`🗑️ Font uninstalled: ${font.filename}`); renderCustomFontManagerList();
                if (openSCADFactory && !btnPreview.disabled) btnPreview.click(); 
            //}
        });
        topRow.appendChild(nameLabel); topRow.appendChild(delBtn);

        const syntaxBox = document.createElement('div'); syntaxBox.textContent = openScadSyntax; syntaxBox.style.fontSize = '0.75rem'; syntaxBox.style.color = '#00c3ff'; syntaxBox.style.background = '#1a1a1a'; syntaxBox.style.padding = '5px 8px'; syntaxBox.style.borderRadius = '4px'; syntaxBox.style.fontFamily = 'monospace'; syntaxBox.style.cursor = 'text'; syntaxBox.style.userSelect = 'all'; syntaxBox.style.webkitUserSelect = 'all';
        rowWrap.appendChild(topRow); rowWrap.appendChild(syntaxBox); listContainer.appendChild(rowWrap);
    });
}
// ============================================================================
// ✅ REUSABLE CONFIRM OVERLAY — polished replacement for window.confirm().
// Falls back to the native dialog if the overlay markup isn't present, so the
// app degrades gracefully if index.html hasn't been updated yet.
// ============================================================================
function showConfirm(title, message, confirmLabel = 'Confirm') {
    if (!confirmOverlay || !btnConfirmYes || !btnConfirmNo) {
        return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    }
    return new Promise((resolve) => {
        if (confirmTitleEl) confirmTitleEl.textContent = title;
        if (confirmMessageEl) confirmMessageEl.textContent = message;
        btnConfirmYes.textContent = confirmLabel;
        confirmOverlay.classList.remove('hidden');
        const cleanup = (result) => {
            confirmOverlay.classList.add('hidden');
            btnConfirmYes.removeEventListener('click', onYes);
            btnConfirmNo.removeEventListener('click', onNo);
            resolve(result);
        };
        const onYes = () => cleanup(true);
        const onNo = () => cleanup(false);
        btnConfirmYes.addEventListener('click', onYes);
        btnConfirmNo.addEventListener('click', onNo);
    });
}

// ============================================================================
// 📄 MY FILES — Save / Save As / Open against the app filesystem (IndexedDB).
// Document identity rides the project-name field: Save writes the buffer to
// "<project name>.scad"; Open adopts the opened file's name as project name.
// ============================================================================
async function saveCurrentToAppFS() {
    const rawName = (projectNameInput ? projectNameInput.value : activeProjectName).trim();
    if (!rawName || rawName.toLowerCase() === 'untitled') {
        // No document identity yet — route to Save As (overlay with name focus)
        openUserFilesOverlay(true);
        return;
    }
    await saveBufferAs(rawName);
}

async function saveBufferAs(rawName) {
    const name = normalizeUserFileName(rawName);
    if (!name) {
        logToConsole('❌ Invalid file name (reserved or empty after sanitizing).');
        return false;
    }
    if (userFileCache[name] !== undefined && name !== lastSavedName) {
        const ok = await showConfirm('Overwrite file?', `"${name}" already exists in your app files. Replace it?`, 'Overwrite');
        if (!ok) return false;
    }
    const content = jar.toString();
    userFileCache[name] = content;
    await savePersistentUserFile(name, content);
    lastSavedName = name;
    editorDirty = false;
	updateSaveButtonState(); // turn the save button gray
    // Adopt the (possibly sanitized) name as the document identity
    activeProjectName = name.replace(/\.scad$/i, '');
    localStorage.setItem(projectNameKey(getActiveWorkspace()), activeProjectName);
    if (projectNameInput) projectNameInput.value = activeProjectName;
    updateWindowTitle();
    logToConsole(`💾 Saved ${name} to app files.`);
    renderUserFilesManagerList();
    return true;
}

function openUserFilesOverlay(saveAsMode) {
    if (!openFilesOverlay) return;
    openFilesOverlay.classList.remove('hidden');
    renderUserFilesManagerList();
    if (userFileNameInput) {
        userFileNameInput.value = (projectNameInput ? projectNameInput.value : activeProjectName).trim().replace(/^untitled$/i, '');
        if (saveAsMode) { userFileNameInput.focus(); userFileNameInput.select(); }
    }
}

if (btnOpenAppFs) {
    btnOpenAppFs.addEventListener('click', () => openUserFilesOverlay(false));
}
if (btnSaveAppFs) {
    btnSaveAppFs.addEventListener('click', () => saveCurrentToAppFS());
}
if (btnCloseOpenFiles) {
    btnCloseOpenFiles.addEventListener('click', () => openFilesOverlay.classList.add('hidden'));
}
if (btnUserFileSave) {
    btnUserFileSave.addEventListener('click', async () => {
        const ok = await saveBufferAs(userFileNameInput ? userFileNameInput.value : '');
        if (ok && openFilesOverlay) openFilesOverlay.classList.add('hidden');
    });
}
if (userFileNameInput) {
    userFileNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && btnUserFileSave) btnUserFileSave.click();
    });
}
if (btnDownloadAllZip) {
    btnDownloadAllZip.addEventListener('click', () => {
        const names = Object.keys(userFileCache);
        if (names.length === 0) { logToConsole('ℹ️ No app files to download.'); return; }
        const zipBytes = zipUserFiles(userFileCache, fflate);
        const blob = new Blob([zipBytes], { type: 'application/zip' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'scadlite_files.zip';
        link.click();
        logToConsole(`⬇️ Downloaded ${names.length} file(s) as scadlite_files.zip.`);
    });
}

async function renderUserFilesManagerList() {
    const listContainer = document.getElementById('custom-userfiles-manager-list');
    if (!listContainer) return;
    const files = await getPersistentUserFiles();
    if (files.length === 0) { listContainer.innerHTML = `<div style="font-size: 0.8rem; color: #555; text-align: center; padding: 12px; font-style: italic;">No saved files</div>`; return; }
    files.sort((a, b) => b.modified - a.modified);
    listContainer.innerHTML = '';
    files.forEach(f => {
        const row = document.createElement('div'); row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.padding = '7px 10px'; row.style.borderBottom = '1px solid #222'; row.style.gap = '8px';

        const nameLabel = document.createElement('span');
        nameLabel.textContent = f.name + (f.name === lastSavedName ? '  ●' : '');
        nameLabel.title = new Date(f.modified).toLocaleString();
        nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.flex = '1'; nameLabel.style.color = '#ddd';

        const openBtn = document.createElement('button'); openBtn.textContent = 'Open'; openBtn.style.background = '#3b82f6'; openBtn.style.color = '#fff'; openBtn.style.padding = '2px 9px'; openBtn.style.fontSize = '0.75rem'; openBtn.style.borderRadius = '3px'; openBtn.style.cursor = 'pointer'; openBtn.style.fontWeight = 'bold';
        openBtn.addEventListener('click', async () => {
            if (editorDirty) {
                const ok = await showConfirm('Open file?', `Opening "${f.name}" replaces the editor contents. Unsaved buffer changes will be lost.`, 'Open');
                if (!ok) return;
            }
            jar.updateCode(f.content);
            editorDirty = false; // updateCode fires onChange; clear after
			updateSaveButtonState(); // turn save button gray
            lastSavedName = f.name;
            activeProjectName = f.name.replace(/\.scad$/i, '');
            localStorage.setItem(projectNameKey(getActiveWorkspace()), activeProjectName);
            if (projectNameInput) projectNameInput.value = activeProjectName;
            updateWindowTitle();
            openFilesOverlay.classList.add('hidden');
            logToConsole(`📂 Opened ${f.name} from app files.`);
            pendingCameraReset = true; // frame the camera to the newly opened model
            if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
        });

        const dlBtn = document.createElement('button'); dlBtn.textContent = '⬇'; dlBtn.title = 'Download to your system'; dlBtn.style.background = '#444'; dlBtn.style.color = '#fff'; dlBtn.style.padding = '2px 8px'; dlBtn.style.fontSize = '0.75rem'; dlBtn.style.borderRadius = '3px'; dlBtn.style.cursor = 'pointer';
        dlBtn.addEventListener('click', () => {
            const blob = new Blob([f.content], { type: 'text/plain' });
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
            link.download = f.name; link.click();
        });

        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            const ok = await showConfirm('Delete file?', `Permanently delete "${f.name}" from your app files?`, 'Delete');
            if (!ok) return;
            await deletePersistentUserFile(f.name); delete userFileCache[f.name];
            if (lastSavedName === f.name) lastSavedName = null;
            if (sessionLastSaved.main === f.name) sessionLastSaved.main = null;
            if (sessionLastSaved.link === f.name) sessionLastSaved.link = null;
            logToConsole(`🗑️ File deleted: ${f.name}`);
            renderUserFilesManagerList();
        });

        row.appendChild(nameLabel); row.appendChild(openBtn); row.appendChild(dlBtn); row.appendChild(delBtn);
        listContainer.appendChild(row);
    });
}


// 📁 STL RENDERER
async function renderCustomStlManagerList() {
    const listContainer = document.getElementById('custom-stls-manager-list');
    if (!listContainer) return;
    const customStls = await getPersistentStls();
    if (customStls.length === 0) { listContainer.innerHTML = `<div style="font-size: 0.8rem; color: #555; text-align: center; padding: 12px; font-style: italic;">No custom STLs imported</div>`; return; }
    listContainer.innerHTML = ''; 
    customStls.forEach(stl => {
        const rowWrap = document.createElement('div'); rowWrap.style.display = 'flex'; rowWrap.style.flexDirection = 'column'; rowWrap.style.padding = '8px 10px'; rowWrap.style.borderBottom = '1px solid #222'; rowWrap.style.gap = '6px';
        const topRow = document.createElement('div'); topRow.style.display = 'flex'; topRow.style.justifyContent = 'space-between'; topRow.style.alignItems = 'center';
        
        const nameLabel = document.createElement('span'); nameLabel.textContent = stl.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '360px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            if (!(await showConfirm('Remove STL?', `Remove "${stl.filename}" from your STL imports?`, 'Remove'))) return;
                await deletePersistentStl(stl.filename); delete stlCache[stl.filename]; 
                logToConsole(`🗑️ STL removed: ${stl.filename}`); renderCustomStlManagerList();
                if (openSCADFactory && !btnPreview.disabled) btnPreview.click(); 
            //}
        });
        topRow.appendChild(nameLabel); topRow.appendChild(delBtn);

        const syntaxBox = document.createElement('div'); syntaxBox.textContent = `import("${stl.filename}");`; syntaxBox.style.fontSize = '0.75rem'; syntaxBox.style.color = '#00c3ff'; syntaxBox.style.background = '#1a1a1a'; syntaxBox.style.padding = '5px 8px'; syntaxBox.style.borderRadius = '4px'; syntaxBox.style.fontFamily = 'monospace'; syntaxBox.style.cursor = 'text'; syntaxBox.style.userSelect = 'all'; syntaxBox.style.webkitUserSelect = 'all';
        rowWrap.appendChild(topRow); rowWrap.appendChild(syntaxBox); listContainer.appendChild(rowWrap);
    });
}

// 📊 SVG RENDERER
async function renderCustomSvgManagerList() {
    const listContainer = document.getElementById('custom-svgs-manager-list');
    if (!listContainer) return;
    const customSvgs = await getPersistentSvgs();
    if (customSvgs.length === 0) { listContainer.innerHTML = `<div style="font-size: 0.8rem; color: #555; text-align: center; padding: 12px; font-style: italic;">No custom SVGs imported</div>`; return; }
    listContainer.innerHTML = ''; 
    customSvgs.forEach(svg => {
        const rowWrap = document.createElement('div'); rowWrap.style.display = 'flex'; rowWrap.style.flexDirection = 'column'; rowWrap.style.padding = '8px 10px'; rowWrap.style.borderBottom = '1px solid #222'; rowWrap.style.gap = '6px';
        const topRow = document.createElement('div'); topRow.style.display = 'flex'; topRow.style.justifyContent = 'space-between'; topRow.style.alignItems = 'center';
        
        const nameLabel = document.createElement('span'); nameLabel.textContent = svg.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '360px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            if (!(await showConfirm('Remove SVG?', `Remove "${svg.filename}" from your SVG imports?`, 'Remove'))) return;
                await deletePersistentSvg(svg.filename); delete svgCache[svg.filename]; 
                logToConsole(`🗑️ SVG removed: ${svg.filename}`); renderCustomSvgManagerList();
                if (openSCADFactory && !btnPreview.disabled) btnPreview.click(); 
            //}
        });
        topRow.appendChild(nameLabel); topRow.appendChild(delBtn);

        const syntaxBox = document.createElement('div'); syntaxBox.textContent = `import("${svg.filename}");`; syntaxBox.style.fontSize = '0.75rem'; syntaxBox.style.color = '#00c3ff'; syntaxBox.style.background = '#1a1a1a'; syntaxBox.style.padding = '5px 8px'; syntaxBox.style.borderRadius = '4px'; syntaxBox.style.fontFamily = 'monospace'; syntaxBox.style.cursor = 'text'; syntaxBox.style.userSelect = 'all'; syntaxBox.style.webkitUserSelect = 'all';
        rowWrap.appendChild(topRow); rowWrap.appendChild(syntaxBox); listContainer.appendChild(rowWrap);
    });
}

// ---- BRIDGES ----
if (btnOpenFontsMenu) {
    btnOpenFontsMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (fontsOverlay) { fontsOverlay.classList.remove('hidden'); renderCustomFontManagerList(); }
    });
}
if (btnCloseFonts) {
    btnCloseFonts.addEventListener('click', () => {
        if (fontsOverlay) fontsOverlay.classList.add('hidden');
        if (settingsOverlay) settingsOverlay.classList.remove('hidden'); 
    });
}

if (btnOpenStlsMenu) {
    btnOpenStlsMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (stlsOverlay) { stlsOverlay.classList.remove('hidden'); renderCustomStlManagerList(); }
    });
}
if (btnCloseStls) {
    btnCloseStls.addEventListener('click', () => {
        if (stlsOverlay) stlsOverlay.classList.add('hidden');
        if (settingsOverlay) settingsOverlay.classList.remove('hidden'); 
    });
}

if (btnOpenSvgsMenu) {
    btnOpenSvgsMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (svgsOverlay) { svgsOverlay.classList.remove('hidden'); renderCustomSvgManagerList(); }
    });
}
if (btnCloseSvgs) {
    btnCloseSvgs.addEventListener('click', () => {
        if (svgsOverlay) svgsOverlay.classList.add('hidden');
        if (settingsOverlay) settingsOverlay.classList.remove('hidden'); 
    });
}

// ---- UPLOAD HANDLERS ----
if (fontUploadInput) {
    fontUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const fontData = new Uint8Array(e.target.result);
            fontCache[file.name] = fontData; await savePersistentFont(file.name, fontData);
            logToConsole(`📁 Font "${file.name}" saved permanently.`); renderCustomFontManagerList();
            if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
        };
        reader.readAsArrayBuffer(file); event.target.value = '';
    });
}

if (stlUploadInput) {
    stlUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        let safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-]/g, '_');
        const reader = new FileReader();
        reader.onload = async (e) => {
            const stlData = new Uint8Array(e.target.result);
            stlCache[safeName] = stlData; await savePersistentStl(safeName, stlData);
            logToConsole(`📁 STL "${safeName}" saved for import.`); renderCustomStlManagerList();
            if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
        };
        reader.readAsArrayBuffer(file); event.target.value = '';
    });
}

if (svgUploadInput) {
    svgUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        let safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-]/g, '_');
        const reader = new FileReader();
        reader.onload = async (e) => {
            const svgData = new Uint8Array(e.target.result);
            svgCache[safeName] = svgData; await savePersistentSvg(safeName, svgData);
            logToConsole(`📁 SVG "${safeName}" saved for import.`); renderCustomSvgManagerList();
            if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
        };
        reader.readAsArrayBuffer(file); event.target.value = '';
    });
}

// 📚 LIBRARY MANAGER — mirrors the STL/SVG manager pattern
if (btnOpenLibsMenu) {
    btnOpenLibsMenu.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
        if (libsOverlay) { libsOverlay.classList.remove('hidden'); renderCustomLibsManagerList(); }
    });
}
if (btnCloseLibs) {
    btnCloseLibs.addEventListener('click', () => {
        if (libsOverlay) libsOverlay.classList.add('hidden');
        if (settingsOverlay) settingsOverlay.classList.remove('hidden');
    });
}
if (libUploadInput) {
    libUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const zipBytes = new Uint8Array(e.target.result);
                const ingest = ingestLibraryZip(zipBytes, file.name, fflate);
                // Folder name = zip filename (minus .zip). The user names the
                // zip to match their include paths: MCAD.zip -> include <MCAD/...>.
                const name = ingest.suggestedName;
                const record = { files: ingest.files, fileCount: ingest.fileCount, scadCount: ingest.scadCount, totalBytes: ingest.totalBytes, added: Date.now() };
                libCache[name] = record;
                await savePersistentLib(name, record);
                logToConsole(`📚 Library "${name}" installed: ${ingest.scadCount} .scad file(s), ${formatLibBytes(ingest.totalBytes)}.`);
                renderCustomLibsManagerList();
                if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
            } catch (err) {
                logToConsole(`❌ Library install failed: ${err.message}`);
            }
        };
        reader.readAsArrayBuffer(file); event.target.value = '';
    });
}

async function renderCustomLibsManagerList() {
    const listContainer = document.getElementById('custom-libs-manager-list');
    if (!listContainer) return;
    const customLibs = await getPersistentLibs();
    if (customLibs.length === 0) { listContainer.innerHTML = `<div style="font-size: 0.8rem; color: #555; text-align: center; padding: 12px; font-style: italic;">No libraries installed</div>`; return; }
    listContainer.innerHTML = '';
    customLibs.forEach(lib => {
        const rowWrap = document.createElement('div'); rowWrap.style.display = 'flex'; rowWrap.style.flexDirection = 'column'; rowWrap.style.padding = '8px 10px'; rowWrap.style.borderBottom = '1px solid #222'; rowWrap.style.gap = '6px';
        const topRow = document.createElement('div'); topRow.style.display = 'flex'; topRow.style.justifyContent = 'space-between'; topRow.style.alignItems = 'center';

        const nameLabel = document.createElement('span'); nameLabel.textContent = `${lib.name}  (${lib.scadCount} .scad, ${formatLibBytes(lib.totalBytes)})`; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '360px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';

        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            if (!(await showConfirm('Remove library?', `Remove the "${lib.name}" library? Code using include <${lib.name}/...> will stop compiling.`, 'Remove'))) return;
            await deletePersistentLib(lib.name); delete libCache[lib.name];
            logToConsole(`🗑️ Library removed: ${lib.name}`); renderCustomLibsManagerList();
            if (openSCADFactory && !btnPreview.disabled) btnPreview.click();
        });
        topRow.appendChild(nameLabel); topRow.appendChild(delBtn);

        const firstScad = Object.keys(lib.files).filter(f => /\.scad$/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
        const syntaxBox = document.createElement('div'); syntaxBox.textContent = `include <${lib.name}/${firstScad}>`; syntaxBox.style.fontSize = '0.75rem'; syntaxBox.style.color = '#00c3ff'; syntaxBox.style.background = '#1a1a1a'; syntaxBox.style.padding = '5px 8px'; syntaxBox.style.borderRadius = '4px'; syntaxBox.style.fontFamily = 'monospace'; syntaxBox.style.cursor = 'text'; syntaxBox.style.userSelect = 'all'; syntaxBox.style.webkitUserSelect = 'all';
        rowWrap.appendChild(topRow); rowWrap.appendChild(syntaxBox); listContainer.appendChild(rowWrap);
    });
}

// ============================================================================
// 💾 BACKUP & RESTORE — export/import ALL app data as a single zip.
// Zip layout:
//   settings.json            { format, build, created, settings: {openscad_*} }
//   AppFiles/<name>.scad     user .scad files (My Files)
//   Libraries/<lib>/<path>   installed libraries, nested paths preserved
//   Fonts/<file>             uploaded TTF/OTF fonts
//   STLs/<file>              uploaded STL imports
//   SVGs/<file>              uploaded SVG imports
// settings.json sweeps EVERY openscad_* localStorage key verbatim — including
// the Main/Link workspace buffers and project name — so future settings ride
// along with zero backup-code changes, and old backups restored into newer
// builds simply leave missing keys at their defaults.
// Restore is MIRROR semantics: validate the whole zip in memory FIRST, then
// wipe all five stores + openscad_* keys, write the backup's contents, and
// location.reload() so the app boots exactly like a fresh start.
// ============================================================================
const BACKUP_FORMAT = 1;

// Local-time stamp for the download name: SCADLite_YYYY-MM-DD-HH-MM-SS.zip
function backupTimestamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Normalize stored blobs for fflate (IndexedDB values may round-trip as
// ArrayBuffer; library .scad entries could conceivably be strings).
function backupToU8(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return fflate.strToU8(data);
    return new Uint8Array(0);
}

// Sweep every openscad_* localStorage key — the future-proofing core.
function sweepBackupSettings() {
    const settings = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('openscad_')) settings[key] = localStorage.getItem(key);
    }
    return settings;
}

async function buildBackupZip() {
    const settings = sweepBackupSettings();
    // Capture the LIVE editor buffer into the active workspace's key: the
    // demo model (and any content loaded before per-keystroke persistence
    // arms) never hits localStorage, so sweeping alone can miss what's
    // visibly in the editor. Only when non-blank, though — with Recover Last
    // Workspaces disabled the editor starts blank while localStorage holds
    // the safeguard copy, and a blank override would clobber it.
    const liveBuffer = jar.toString();
    if (liveBuffer.trim() !== '') settings[wsStorageKey(getActiveWorkspace())] = liveBuffer;
    const tree = {};
    tree['settings.json'] = fflate.strToU8(JSON.stringify({
        format: BACKUP_FORMAT,
        build: BUILD_NUMBER,
        created: new Date().toISOString(),
        settings
    }, null, 2));
    for (const f of await getPersistentUserFiles()) tree['AppFiles/' + f.name] = fflate.strToU8(f.content);
    for (const f of await getPersistentFonts())     tree['Fonts/' + f.filename] = backupToU8(f.binary);
    for (const f of await getPersistentStls())      tree['STLs/'  + f.filename] = backupToU8(f.binary);
    for (const f of await getPersistentSvgs())      tree['SVGs/'  + f.filename] = backupToU8(f.binary);
    for (const lib of await getPersistentLibs())
        for (const [path, data] of Object.entries(lib.files))
            tree[`Libraries/${lib.name}/${path}`] = backupToU8(data);
    return fflate.zipSync(tree);
}

if (btnBackupAll) {
    btnBackupAll.addEventListener('click', async () => {
        try {
            logToConsole('💾 Building backup zip (large libraries/STLs are zipped in memory — this may take a moment)…');
            const zipBytes = await buildBackupZip();
            const filename = `SCADLite_${backupTimestamp()}.zip`;
            const blob = new Blob([zipBytes], { type: 'application/zip' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            logToConsole(`✅ Backup downloaded: ${filename} (${formatLibBytes(zipBytes.length)}).`);
        } catch (err) {
            logToConsole(`❌ Backup failed: ${err.message}`);
        }
    });
}

// Parse + validate a backup zip ENTIRELY in memory. Throws on anything
// unusable — nothing is deleted until this returns successfully.
function parseBackupZip(zipBytes) {
    let entries;
    try { entries = fflate.unzipSync(zipBytes); }
    catch { throw new Error('File is not a readable zip archive.'); }
    if (!entries['settings.json']) throw new Error('Not a SCADLite backup (settings.json missing at zip root).');
    let manifest;
    try { manifest = JSON.parse(fflate.strFromU8(entries['settings.json'])); }
    catch { throw new Error('settings.json is not valid JSON.'); }
    if (manifest.format !== BACKUP_FORMAT) throw new Error(`Unsupported backup format "${manifest.format}" (this build reads format ${BACKUP_FORMAT}).`);
    if (typeof manifest.settings !== 'object' || manifest.settings === null) throw new Error('settings.json has no settings object.');

    const data = { manifest, appFiles: {}, fonts: {}, stls: {}, svgs: {}, libs: {} };
    for (const [path, bytes] of Object.entries(entries)) {
        if (path.endsWith('/')) continue;                 // folder placeholder entries
        const slash = path.indexOf('/');
        if (slash === -1) continue;                       // root files besides settings.json: ignore
        const top = path.slice(0, slash), rest = path.slice(slash + 1);
        if (!rest) continue;
        if      (top === 'AppFiles') {
            if (rest.includes('/')) continue;             // user-files store is flat
            data.appFiles[rest] = fflate.strFromU8(bytes);
        }
        else if (top === 'Fonts')    data.fonts[rest] = bytes;
        else if (top === 'STLs')     data.stls[rest] = bytes;
        else if (top === 'SVGs')     data.svgs[rest] = bytes;
        else if (top === 'Libraries') {
            const slash2 = rest.indexOf('/');
            if (slash2 === -1) continue;                  // stray file directly under Libraries/
            const libName = rest.slice(0, slash2), inner = rest.slice(slash2 + 1);
            if (!libName || !inner) continue;
            if (!data.libs[libName]) data.libs[libName] = {};
            data.libs[libName][inner] = bytes;            // nested paths preserved verbatim
        }
        // Unknown top-level folders: ignored (forward compatibility).
    }
    return data;
}

// MIRROR WIPE: empty all five stores and remove every openscad_* key, so the
// app ends up matching the backup exactly — no mystery leftovers.
async function wipeAllPersistentData() {
    const clearStore = (openFn, storeName) => openFn().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
        req.onsuccess = resolve; req.onerror = () => reject(req.error);
    }));
    await clearStore(openFontsDB, 'fonts');
    await clearStore(openStlsDB, 'stls');
    await clearStore(openSvgsDB, 'svgs');
    // Module-owned stores clear through their own exported helpers (a single
    // store.clear() each — no loading multi-MB libraries just to delete them).
    await clearPersistentLibs();
    await clearPersistentUserFiles();
    for (const key of Object.keys(sweepBackupSettings())) localStorage.removeItem(key);
}

async function writeRestoredData(data) {
    for (const [key, value] of Object.entries(data.manifest.settings))
        if (key.startsWith('openscad_') && typeof value === 'string') localStorage.setItem(key, value);
    for (const [name, content] of Object.entries(data.appFiles)) {
        // Never let a (hand-edited) backup shadow the pipeline's own inputs.
        if (RESERVED_SCAD_NAMES.has(name.toLowerCase())) continue;
        await savePersistentUserFile(name, content);
    }
    for (const [name, bytes] of Object.entries(data.fonts)) await savePersistentFont(name, bytes);
    for (const [name, bytes] of Object.entries(data.stls))  await savePersistentStl(name, bytes);
    for (const [name, bytes] of Object.entries(data.svgs))  await savePersistentSvg(name, bytes);
    for (const [name, files] of Object.entries(data.libs)) {
        const paths = Object.keys(files);
        await savePersistentLib(name, {
            files,
            fileCount: paths.length,
            scadCount: paths.filter(p => /\.scad$/i.test(p)).length,
            totalBytes: paths.reduce((sum, p) => sum + files[p].length, 0),
            added: Date.now()
        });
    }
    // COMMIT BARRIER: the save helpers fire-and-forget their readwrite
    // transactions; a readonly transaction on the same store queues behind
    // them, so awaiting these reads guarantees every write committed BEFORE
    // we reload (otherwise the reload could abort in-flight transactions).
    await getPersistentFonts(); await getPersistentStls(); await getPersistentSvgs();
    await getPersistentLibs();  await getPersistentUserFiles();
}

if (btnRestoreAll) {
    btnRestoreAll.addEventListener('click', () => {
        if (backupRestoreUpload) backupRestoreUpload.click();
    });
}
if (backupRestoreUpload) {
    backupRestoreUpload.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            // 1) VALIDATE FIRST — a corrupt/wrong zip aborts with everything intact.
            let data;
            try { data = parseBackupZip(new Uint8Array(e.target.result)); }
            catch (err) { logToConsole(`❌ Restore aborted — ${err.message} Nothing was changed.`); return; }

            const n = (o) => Object.keys(o).length;
            const created = data.manifest.created ? ` from ${new Date(data.manifest.created).toLocaleString()}` : '';
            const summary = `${n(data.appFiles)} app file(s), ${n(data.libs)} librar${n(data.libs) === 1 ? 'y' : 'ies'}, ${n(data.fonts)} font(s), ${n(data.stls)} STL(s), ${n(data.svgs)} SVG(s)`;
            const ok = await showConfirm(
                'Erase everything and restore?',
                `Restoring data erases all current data, including: app files, libraries, fonts, STLs, SVGs, all settings, and the editor workspaces. It replaces everything with this backup${created} (${summary}). Anything not in the backup will be lost. The app reloads when finished.`,
                'Erase & Restore'
            );
            if (!ok) { logToConsole('ℹ️ Restore cancelled. Nothing was changed.'); return; }

            // 2) WIPE + WRITE — only after the replacement data is confirmed readable.
            try {
                logToConsole('♻️ Restoring backup — do not close this tab…');
                await wipeAllPersistentData();
                await writeRestoredData(data);
                sessionStorage.setItem('openscad_restore_notice', '1');
                location.reload();
            } catch (err) {
                logToConsole(`❌ Restore failed mid-write: ${err.message}. Local data may be incomplete — restoring the same backup again is safe to retry.`);
            }
        };
        reader.readAsArrayBuffer(file);
        event.target.value = '';
    });
}

// Post-reload notice: sessionStorage survives location.reload(), so the fresh
// boot can confirm the restore in the console.
if (sessionStorage.getItem('openscad_restore_notice')) {
    sessionStorage.removeItem('openscad_restore_notice');
    logToConsole('✅ Backup restored — all data and settings were loaded from your backup zip.');
}

// Wire a numeric view-setting input: shows the stored value, and on commit
// (Enter/blur) validates, persists, and rebuilds the affected scene object.
// Invalid input (non-numeric) reverts to the current value; negatives clamp
// to 0 (which carries the documented "disabled" semantics).
function wireViewSettingInput(inputEl, storageKey, getVal, setVal, rebuild, min = 0, max = Infinity) {
    if (!inputEl) return;
    inputEl.value = getVal();
    inputEl.addEventListener('change', () => {
        let v = parseFloat(inputEl.value);
        if (!Number.isFinite(v)) { inputEl.value = getVal(); return; } // revert
        v = Math.min(Math.max(v, min), max);   // clamp into the valid range
        setVal(v);
        localStorage.setItem(storageKey, String(v));
        inputEl.value = v;
        if (rebuild) rebuild();
    });
}
wireViewSettingInput(gridStepInput,  'openscad_grid_step',  () => gridStep,  v => gridStep = v,  rebuildGrid);
wireViewSettingInput(gridRangeInput, 'openscad_grid_range', () => gridRange, v => gridRange = v, rebuildGrid);
wireViewSettingInput(axesStepInput,  'openscad_axes_step',  () => axesStep,  v => axesStep = v,  rebuildAxes);
wireViewSettingInput(axesRangeInput, 'openscad_axes_range', () => axesRange, v => axesRange = v, rebuildAxes);
wireViewSettingInput(axesHashInput,  'openscad_axes_hash',  () => axesHash,  v => axesHash = v,  rebuildAxes);

// Zoom Settings — no rebuild needed; the wheel handler and animate loop read
// these live. Bounds keep them usable: intensity 0 would deaden the wheel,
// smoothness 0 would freeze the camera mid-glide.
const zoomIntensityInput = document.getElementById('zoom-intensity-input');
const zoomSmoothnessInput = document.getElementById('zoom-smoothness-input');
wireViewSettingInput(zoomIntensityInput,  'openscad_zoom_intensity',  () => zoomIntensity,  v => zoomIntensity = v,  null, 0.0001, 0.05);
wireViewSettingInput(zoomSmoothnessInput, 'openscad_zoom_smoothness', () => zoomSmoothness, v => zoomSmoothness = v, null, 0.01, 1);

// Grid / Axes On-Off buttons in Workspace Settings — share the same setters
// (and thus the same persisted flags) as the viewer-corner toolbar buttons.
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const btnToggleAxes = document.getElementById('btn-toggle-axes');
if (btnToggleGrid) btnToggleGrid.addEventListener('click', () => setGridVisible(!gridVisible));
if (btnToggleAxes) btnToggleAxes.addEventListener('click', () => setAxesVisible(!axesVisible));
syncGridAxesButtons(); // reflect restored state on load

const leftPaneContainer = document.getElementById('left-pane-container');
const panelSplitGutter = document.getElementById('panel-split-gutter');
if (leftPaneContainer && panelSplitGutter) {
    leftPaneContainer.style.width = `${localStorage.getItem('openscad_layout_split') || '50'}%`;
    panelSplitGutter.addEventListener('mousedown', (e) => {
        e.preventDefault(); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
        function onMouseMove(moveEvent) {
            let pct = (moveEvent.clientX / window.innerWidth) * 100;
            if (pct < 15) pct = 15; if (pct > 85) pct = 85;
            leftPaneContainer.style.width = `${pct}%`; localStorage.setItem('openscad_layout_split', Math.round(pct).toString());
            if (typeof renderer !== 'undefined' && renderer && typeof camera !== 'undefined' && camera) {
                const container3d = document.getElementById('viewer-3d');
                if (container3d) {
                    const cw = container3d.clientWidth, ch = container3d.clientHeight;
                    if (cw > 0 && ch > 0) updateCameraViewport(cw, ch);
                }
            }
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default'; document.body.style.userSelect = 'text';
            logToConsole(`📐 Split layout updated and cached to: ${localStorage.getItem('openscad_layout_split')}%`);
        }
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    });
}

// ==========================================================================
// 🖥️ VERTICAL CONSOLE SPLITTER
// ==========================================================================
const consoleGutter = document.getElementById('console-gutter');
const leftPanel = document.querySelector('.left-panel');
if (consoleGutter && consoleBox && leftPanel) {
    // Restore saved console height
    const savedConsoleHeight = localStorage.getItem('openscad_console_height');
    if (savedConsoleHeight) consoleBox.style.height = savedConsoleHeight + 'px';

    consoleGutter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const startY = e.clientY;
        const startHeight = consoleBox.getBoundingClientRect().height;

        function onMouseMove(moveEvent) {
            const delta = startY - moveEvent.clientY;
            const newHeight = Math.min(
                Math.max(startHeight + delta, 60),               // min 60px
                leftPanel.getBoundingClientRect().height * 0.8   // max 80% of panel
            );
            consoleBox.style.height = newHeight + 'px';
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'text';
            const finalHeight = Math.round(consoleBox.getBoundingClientRect().height);
            localStorage.setItem('openscad_console_height', finalHeight);
            logToConsole(`🖥️ Console height saved: ${finalHeight}px`);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// ==========================================================================
// Preview transform functions (isolateHighlights, isolateOpenSCADGhosts,
// splitTopLevelStatements, isDefinitionStatement, collectTopLevelDefinitions,
// findRootModifier) now live in ./preview-transforms.js — imported at top.
// ==========================================================================