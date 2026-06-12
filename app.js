// ---- BUILD VERSION CONTROLLER ----
const BUILD_NUMBER = "245"; // <-- Incremented for SVG Import Database & Grid Layout

// 🍯 Import standalone, offline-ready CodeJar framework
import { CodeJar } from './libs/codejar.min.js';
import OpenSCAD from './libs/openscad.js';

// Dom Elements
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
const projectNameInput = document.getElementById('project-name-input');
const editorFontSizeSelect = document.getElementById('editor-font-size-select');
const modelColorInput = document.getElementById('model-color');
const btnColorTrigger = document.getElementById('btn-color-trigger');
const closeHelpBtn = document.getElementById('close-help-btn');
const helpOverlay = document.getElementById('help-overlay');
const btnSettingsCheatSheet = document.getElementById('btn-settings-cheat-sheet');
const settingsOverlay = document.getElementById('settings-overlay');

// 🌐 THREE.JS SCOPE VARIABLES
let scene, camera, renderer, controls, currentMesh = null;
let workspaceInitialized = false;
let gridHelper = null;
let axesGroup = null;

let isGridVisible = localStorage.getItem('openscad_grid_visible') !== 'false';
let isAxesVisible = localStorage.getItem('openscad_axes_visible') !== 'false';

let openSCADFactory = null;
let currentStlBlob = null; 
const fontCache = {}; 
const stlCache = {}; 
const svgCache = {}; // 📁 NEW: Caches SVG files in memory
let rawEditorCode = "";
let consoleDebugging = localStorage.getItem('openscad_console_debug') === 'enabled';
let bracketMatchingEnabled = localStorage.getItem('openscad_bracket_matching') !== 'disabled';
let lineHighlightingEnabled = localStorage.getItem('openscad_line_highlight') !== 'disabled';

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

// 🍯 INITIALIZE CODEJAR INSTANCE
const jar = CodeJar(
    editorElement, 
	(el) => {
        rawEditorCode = el.textContent;  // capture raw BEFORE Prism
        if (typeof Prism !== 'undefined') {
            const code = el.textContent;
            const grammar = Prism.languages.openscad || Prism.languages.clike || Prism.languages.javascript;
            const langName = Prism.languages.openscad ? 'openscad' : (Prism.languages.clike ? 'clike' : 'javascript');
            if (grammar) el.innerHTML = Prism.highlight(code, grammar, langName);
            else Prism.highlightElement(el); 
        }
        //try { applyInlineBracketMatching(el); } catch (e) { console.error("Bracket match error:", e); }   // seeing is removing this addresses odd cursor movement in the editor
    },
    { tab: '\t', history: true, indentOn: /[(\[{]$/, addClosing: false } 
);

if (editorElement) {
    editorElement.addEventListener('click', () => {
        if (bracketMatchingEnabled) applyInlineBracketMatching(editorElement);
    });
    
    editorElement.addEventListener('keyup', (e) => {
        if (bracketMatchingEnabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            applyInlineBracketMatching(editorElement);
        }
    });

    editorElement.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            event.stopImmediatePropagation();
            const fakeRedoEvent = new KeyboardEvent('keydown', {
                key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
            });
            editorElement.dispatchEvent(fakeRedoEvent);
        }
    });
}

// ==========================================================================
// 📐 SMART MULTI-LINE BLOCK INDENTATION ENGINE
// ==========================================================================
if (editorElement) {
    editorElement.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopImmediatePropagation();

            let { start, end } = getSelectionCharacterOffsetWithin(editorElement);
            const value = jar.toString();
            const selectedText = value.substring(start, end);
            const isMultiLineSelection = selectedText.includes('\n');

            if (!isMultiLineSelection && !event.shiftKey) {
                const newCode = value.substring(0, start) + '\t' + value.substring(end);
                jar.updateCode(newCode);
                setSelectionCharacterOffsetWithin(editorElement, start + 1, start + 1);
                return;
            }

            let adjustedEnd = end;
            if (adjustedEnd > start && value[adjustedEnd - 1] === '\n') adjustedEnd--;

            const selectStartLineStart = value.lastIndexOf('\n', start - 1) + 1;
            const selectEndLineEnd = value.indexOf('\n', adjustedEnd);
            const finalEndPos = selectEndLineEnd === -1 ? value.length : selectEndLineEnd;

            const targetBlock = value.substring(selectStartLineStart, finalEndPos);
            let modifiedBlock = "";
            let newStart = start, newEnd = end;

            if (!event.shiftKey) {
                modifiedBlock = targetBlock.split('\n').map(line => '\t' + line).join('\n');
                const linesBeforeStart = value.substring(selectStartLineStart, start).split('\n').length - 1;
                const linesBeforeEnd = value.substring(selectStartLineStart, end).split('\n').length - 1;
                newStart = start + linesBeforeStart + 1;
                newEnd = end + linesBeforeEnd + 1;
            } else {
                let removedBeforeStart = 0, removedBeforeEnd = 0;
                let currentPosInBlock = 0;
                
                modifiedBlock = targetBlock.split('\n').map(line => {
                    let reduction = 0;
                    let newLine = line;
                    
                    if (line.startsWith('\t')) { reduction = 1; newLine = line.substring(1); } 
                    else if (line.startsWith('    ')) { reduction = 4; newLine = line.substring(4); } 
                    else if (line.match(/^ +/)) {
                        const spaces = line.match(/^ +/)[0].length;
                        reduction = Math.min(spaces, 4);
                        newLine = line.substring(reduction);
                    }
                    
                    const absoluteLineStart = selectStartLineStart + currentPosInBlock;
                    if (start > absoluteLineStart) removedBeforeStart += Math.min(reduction, start - absoluteLineStart);
                    if (end > absoluteLineStart) removedBeforeEnd += Math.min(reduction, end - absoluteLineStart);
                    
                    currentPosInBlock += line.length + 1;
                    return newLine;
                }).join('\n');
                
                newStart = Math.max(selectStartLineStart, start - removedBeforeStart);
                newEnd = Math.max(selectStartLineStart, end - removedBeforeEnd);
            }

            const newCode = value.substring(0, selectStartLineStart) + modifiedBlock + value.substring(finalEndPos);
            jar.updateCode(newCode);
            setSelectionCharacterOffsetWithin(editorElement, newStart, newEnd);
        }
    }, true);
}

function getSelectionCharacterOffsetWithin(element) {
    let start = 0, end = 0;
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        
        if (element.contains(range.startContainer)) {
            preCaretRange.setEnd(range.startContainer, range.startOffset);
            start = preCaretRange.toString().length;
        }
        if (element.contains(range.endContainer)) {
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            end = preCaretRange.toString().length;
        }
        if (start > end) { const temp = start; start = end; end = temp; }
    }
    return { start, end };
}

function setSelectionCharacterOffsetWithin(element, start, end) {
    if (start < 0) start = 0;
    if (end < 0) end = 0;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(element, 0);
    range.collapse(true);
    
    let currentOffset = 0;
    const treeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let currentNode = treeWalker.nextNode();
    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    
    while (currentNode) {
        const nodeLength = currentNode.textContent.length;
        if (!startNode && currentOffset + nodeLength >= start) { startNode = currentNode; startOffset = start - currentOffset; }
        if (!endNode && currentOffset + nodeLength >= end) { endNode = currentNode; endOffset = end - currentOffset; break; }
        currentOffset += nodeLength;
        currentNode = treeWalker.nextNode();
    }
    
    if (!startNode) { startNode = element; startOffset = element.childNodes.length; }
    if (!endNode) { endNode = element; endOffset = element.childNodes.length; }
    
    try {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (e) { console.error("Selection recovery matrix failure:", e); }
}

// ==========================================================================
// 💡 BI-DIRECTIONAL BRACKET MATCHING
// ==========================================================================
function applyInlineBracketMatching(editorDiv) {
    const oldHighlights = editorDiv.querySelectorAll('.bracket-match-glow, .bracket-mismatch-glow');
    oldHighlights.forEach(span => span.classList.remove('bracket-match-glow', 'bracket-mismatch-glow'));

    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const textContent = editorDiv.textContent;
    let cursorIndex = 0;
    const treeWalker = document.createTreeWalker(editorDiv, NodeFilter.SHOW_TEXT);
    let currentNode = treeWalker.nextNode();
    
    while (currentNode) {
        if (currentNode === range.startContainer) { cursorIndex += range.startOffset; break; }
        cursorIndex += currentNode.textContent.length;
        currentNode = treeWalker.nextNode();
    }

    const partners = { '{': '}', '}': '{', '[': ']', ']': '[', '(': ')', ')': '(' };
    let targetIndex = cursorIndex;
    let charToMatch = textContent[targetIndex];
    
    if (!partners[charToMatch]) {
        targetIndex = cursorIndex - 1;
        charToMatch = textContent[targetIndex];
    }
    if (!partners[charToMatch]) return;

    const ignoredMap = new Array(textContent.length).fill(false);
    let inSingleComment = false, inMultiComment = false, inString = false;

    for (let i = 0; i < textContent.length; i++) {
        if (inSingleComment) {
            ignoredMap[i] = true;
            if (textContent[i] === '\n') inSingleComment = false;
        } else if (inMultiComment) {
            ignoredMap[i] = true;
            if (textContent[i] === '*' && textContent[i + 1] === '/') { ignoredMap[i + 1] = true; i++; inMultiComment = false; }
        } else if (inString) {
            ignoredMap[i] = true;
            if (textContent[i] === '\\' && textContent[i + 1] === '"') { ignoredMap[i + 1] = true; i++; } 
            else if (textContent[i] === '"') inString = false;
        } else {
            if (textContent[i] === '/' && textContent[i + 1] === '/') { ignoredMap[i] = true; ignoredMap[i + 1] = true; i++; inSingleComment = true; } 
            else if (textContent[i] === '/' && textContent[i + 1] === '*') { ignoredMap[i] = true; ignoredMap[i + 1] = true; i++; inMultiComment = true; } 
            else if (textContent[i] === '"') { ignoredMap[i] = true; inString = true; }
        }
    }

    if (ignoredMap[targetIndex]) return;
    
    const partnerChar = partners[charToMatch];
    const isForwardScan = ['{', '[', '('].includes(charToMatch);
    let matchIndex = -1, balanceCounter = 0;

    if (isForwardScan) {
        for (let i = targetIndex; i < textContent.length; i++) {
            if (ignoredMap[i]) continue; 
            if (textContent[i] === charToMatch) balanceCounter++;
            if (textContent[i] === partnerChar) balanceCounter--;
            if (balanceCounter === 0) { matchIndex = i; break; }
        }
    } else {
        for (let i = targetIndex; i >= 0; i--) {
            if (ignoredMap[i]) continue; 
            if (textContent[i] === charToMatch) balanceCounter++;
            if (textContent[i] === partnerChar) balanceCounter--;
            if (balanceCounter === 0) { matchIndex = i; break; }
        }
    }

    let absoluteOffset = 0, targetSpanNode = null, matchSpanNode = null;
    const walker = document.createTreeWalker(editorDiv, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();

    while (textNode) {
        const nodeLength = textNode.textContent.length;
        if (targetIndex >= absoluteOffset && targetIndex < absoluteOffset + nodeLength) targetSpanNode = textNode.parentNode;
        if (matchIndex !== -1 && matchIndex >= absoluteOffset && matchIndex < absoluteOffset + nodeLength) matchSpanNode = textNode.parentNode;
        absoluteOffset += nodeLength;
        textNode = walker.nextNode();
    }

    if (targetSpanNode) {
        if (matchIndex !== -1 && matchSpanNode) {
            targetSpanNode.classList.add('bracket-match-glow');
            matchSpanNode.classList.add('bracket-match-glow');
        } else {
            targetSpanNode.classList.add('bracket-mismatch-glow');
        }
    }
}

// ==========================================================================
// 🛠️ COMPILATION ERROR HIGHLIGHTING
// ==========================================================================
function highlightErrorLine(lineNumber) {
    clearErrorHighlights();
    if (!lineNumber || lineNumber < 1) return;

    const lineGutter = document.getElementById('line-numbers');
    if (lineGutter) {
        const lines = lineGutter.innerHTML.split('<br>');
        if (lineNumber <= lines.length) {
            lines[lineNumber - 1] = `<span class="gutter-error-flare">${lineNumber}</span>`;
            lineGutter.innerHTML = lines.join('<br>');
        }
    }

    const codeText = jar.toString();
    const textLines = codeText.split('\n');
    if (lineNumber > textLines.length) return;

    let targetStartCharIndex = 0;
    for (let i = 0; i < lineNumber - 1; i++) targetStartCharIndex += textLines[i].length + 1; 
    let targetEndCharIndex = targetStartCharIndex + textLines[lineNumber - 1].length;
    if (targetStartCharIndex === targetEndCharIndex) targetEndCharIndex++;

    let currentAbsoluteOffset = 0;
    const walker = document.createTreeWalker(editorElement, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();

    while (currentNode) {
        const nodeLength = currentNode.textContent.length;
        const startOfThisNode = currentAbsoluteOffset;
        const endOfThisNode = currentAbsoluteOffset + nodeLength;

        if (endOfThisNode > targetStartCharIndex && startOfThisNode < targetEndCharIndex) {
            let parentElement = currentNode.parentNode;
            if (parentElement === editorElement) {
                const spanWrap = document.createElement('span');
                parentElement.insertBefore(spanWrap, currentNode);
                spanWrap.appendChild(currentNode);
                parentElement = spanWrap;
            }
            parentElement.classList.add('editor-error-line-glow');
        }
        currentAbsoluteOffset += nodeLength;
        currentNode = walker.nextNode();
    }
}

function clearErrorHighlights() {
    editorElement.querySelectorAll('.editor-error-line-glow').forEach(el => el.classList.remove('editor-error-line-glow'));
    if (typeof triggerLineUpdate === 'function') triggerLineUpdate();
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
// 💡 BRACKET MATCHING TOGGLE
// ==========================================================================
const toggleBracketBtn = document.getElementById('btn-toggle-bracket');
if (toggleBracketBtn) {
    const applyBracketLayout = (enabled) => {
        bracketMatchingEnabled = enabled;
        localStorage.setItem('openscad_bracket_matching', enabled ? 'enabled' : 'disabled');
        toggleBracketBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleBracketBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
        if (!enabled && editorElement) {
            editorElement.querySelectorAll('.bracket-match-glow, .bracket-mismatch-glow')
                .forEach(span => span.classList.remove('bracket-match-glow', 'bracket-mismatch-glow'));
        }
    };
    applyBracketLayout(bracketMatchingEnabled);
    toggleBracketBtn.addEventListener('click', () => applyBracketLayout(!bracketMatchingEnabled));
}

// ==========================================================================
// ✏️ LINE HIGHLIGHTING TOGGLE
// ==========================================================================
const toggleLineHighlightBtn = document.getElementById('btn-toggle-line-highlight');

// Inject the active line highlight style once
const lineHighlightStyle = document.createElement('style');
lineHighlightStyle.id = 'line-highlight-style';
lineHighlightStyle.textContent = `.active-line-highlight { background-color: rgba(255, 255, 255, 0.04) !important; outline: 1px solid rgba(255,255,255,0.06); }`;
document.head.appendChild(lineHighlightStyle);

let lastHighlightedLine = null;

function applyLineHighlight() {
    if (!lineHighlightingEnabled || !editorElement) return;

    if (lastHighlightedLine) {
        lastHighlightedLine.classList.remove('active-line-highlight');
        lastHighlightedLine = null;
    }

    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    let cursorIndex = 0;
    const walker = document.createTreeWalker(editorElement, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        if (node === range.startContainer) { cursorIndex += range.startOffset; break; }
        cursorIndex += node.textContent.length;
        node = walker.nextNode();
    }

    const text = editorElement.textContent;
    const lineStart = text.lastIndexOf('\n', cursorIndex - 1) + 1;

    let absOffset = 0;
    const walker2 = document.createTreeWalker(editorElement, NodeFilter.SHOW_TEXT);
    let textNode = walker2.nextNode();
    while (textNode) {
        const nodeLen = textNode.textContent.length;
        if (lineStart >= absOffset && lineStart < absOffset + nodeLen) {
            let el = textNode.parentNode;
            while (el && el !== editorElement && el.parentNode !== editorElement) {
                el = el.parentNode;
            }
            if (el && el !== editorElement) {
                el.classList.add('active-line-highlight');
                lastHighlightedLine = el;
            }
            break;
        }
        absOffset += nodeLen;
        textNode = walker2.nextNode();
    }
}

function clearLineHighlight() {
    if (lastHighlightedLine) {
        lastHighlightedLine.classList.remove('active-line-highlight');
        lastHighlightedLine = null;
    }
}

if (editorElement) {
    editorElement.addEventListener('click', applyLineHighlight);
    editorElement.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
             'PageUp', 'PageDown'].includes(e.key)) {
            applyLineHighlight();
        }
    });
}

if (toggleLineHighlightBtn) {
    const applyLineHighlightLayout = (enabled) => {
        lineHighlightingEnabled = enabled;
        localStorage.setItem('openscad_line_highlight', enabled ? 'enabled' : 'disabled');
        toggleLineHighlightBtn.textContent = enabled ? 'Enabled' : 'Disabled';
        toggleLineHighlightBtn.style.backgroundColor = enabled ? '#28a745' : '#dc3545';
        if (!enabled) clearLineHighlight();
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
// 🔣 LINE NUMBERS TOGGLE
// ==========================================================================
const toggleLinesBtn = document.getElementById('btn-toggle-lines');
const lineNumbersDiv = document.getElementById('line-numbers');
let triggerLineUpdate = null;

if (editorElement && lineNumbersDiv && toggleLinesBtn) {
    const updateLineNumbers = (codeText) => {
        let currentCode = (typeof codeText === 'string') ? codeText : jar.toString();
        if (currentCode.endsWith('\n')) currentCode = currentCode.slice(0, -1);
        lineNumbersDiv.innerHTML = Array.from({ length: currentCode.split('\n').length }, (_, i) => i + 1).join('<br>');
    };
    triggerLineUpdate = updateLineNumbers;

    jar.onUpdate((code) => {
		rawEditorCode = code;  // keep in sync with editor changes
        if (editorElement.querySelectorAll('.editor-error-line-glow').length > 0 && lineNumbersDiv.innerHTML.includes('gutter-error-flare')) {
            editorElement.querySelectorAll('.editor-error-line-glow').forEach(el => el.classList.remove('editor-error-line-glow'));
        }
        updateLineNumbers(code);
        localStorage.setItem('openscad_editor_cache', code);
    });

    editorElement.addEventListener('scroll', () => lineNumbersDiv.scrollTop = editorElement.scrollTop);

    let isLinesEnabled = localStorage.getItem('openscad_lines_visible') !== 'disabled';
    const applyLinesLayout = (enabled) => {
        if (enabled) {
            lineNumbersDiv.style.display = 'block'; toggleLinesBtn.textContent = 'Enabled';
            toggleLinesBtn.style.backgroundColor = '#28a745'; isLinesEnabled = true;
            localStorage.setItem('openscad_lines_visible', 'enabled'); updateLineNumbers();
            lineNumbersDiv.scrollTop = editorElement.scrollTop;
        } else {
            lineNumbersDiv.style.display = 'none'; toggleLinesBtn.textContent = 'Disabled';
            toggleLinesBtn.style.backgroundColor = '#dc3545'; isLinesEnabled = false;
            localStorage.setItem('openscad_lines_visible', 'disabled');
        }
    };
    updateLineNumbers();
    applyLinesLayout(isLinesEnabled);
    toggleLinesBtn.addEventListener('click', () => applyLinesLayout(!isLinesEnabled));
}

let activeProjectName = localStorage.getItem('openscad_project_name') || 'untitled';

function updateWindowTitle() { 
    // Fallback to 'untitled' if the user clears the input field entirely
    const displayTitle = activeProjectName.trim() || 'untitled';
    document.title = `${displayTitle}.scad`; 
}

if (projectNameInput) {
    projectNameInput.value = activeProjectName;
    
    // 🔌 ADDED: Listen for live updates when the user renames the project
    projectNameInput.addEventListener('input', (event) => {
        activeProjectName = event.target.value; 
        localStorage.setItem('openscad_project_name', activeProjectName);
        updateWindowTitle();
    });
}

updateWindowTitle();

// ---- PERSISTENT FONT SIZE INITIALIZATION & LISTENER ----
const savedFontSizeStr = localStorage.getItem('openscad_editor_font_size') || '14px';
if (editorElement && editorFontSizeSelect) {
    editorElement.style.fontSize = savedFontSizeStr;
    if (lineNumbersDiv) lineNumbersDiv.style.fontSize = savedFontSizeStr; 
    editorFontSizeSelect.value = savedFontSizeStr;

    // 🔧 RESTORED: Font Size Changer Listener
    editorFontSizeSelect.addEventListener('change', (event) => {
        const newSize = event.target.value;
        editorElement.style.fontSize = newSize;
        if (lineNumbersDiv) lineNumbersDiv.style.fontSize = newSize;
        localStorage.setItem('openscad_editor_font_size', newSize);
        if (typeof triggerLineUpdate === 'function') triggerLineUpdate();
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

/*
// 📷 Reusable function to perfectly frame any Three.js mesh
function frameModelInCamera(mesh) {
    if (!camera || !controls) return;

    if (mesh && mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        const boundingBox = mesh.geometry.boundingBox;
        
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const padding = 1.2; 
        const fov = camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * padding;
        
        if (camera.aspect < 1) cameraDistance /= camera.aspect;

        const viewDirection = new THREE.Vector3(1, 1.2, 1).normalize();
        camera.position.copy(center).add(viewDirection.multiplyScalar(cameraDistance));
        
        controls.target.copy(center); 
        camera.lookAt(center);
    } else {
        camera.position.set(40, 40, 40);
        controls.target.set(0, 0, 0); 
        camera.lookAt(0, 0, 0);
    }
    controls.update();
}
*/

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
        
        const padding = 1.2; 
        const fov = camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(validDim / 2 / Math.tan(fov / 2)) * padding;
        
        if (camera.aspect < 1) cameraDistance /= camera.aspect;

        // Angle the camera slightly down at the model's center bounds
        const viewDirection = new THREE.Vector3(1, 1.2, 1).normalize();
        camera.position.copy(center).add(viewDirection.multiplyScalar(cameraDistance));
        
        controls.target.copy(center); 
        camera.lookAt(center);
    } else {
        // Fallback default position if no model exists on screen
        camera.position.set(40, 40, 40);
        controls.target.set(0, 0, 0); 
        camera.lookAt(0, 0, 0);
    }
    controls.update();
}

// 🔧 Camera Reset Listener
if (btnCameraReset) {
    btnCameraReset.addEventListener('click', () => {
        frameModelInCamera(currentMesh);
        logToConsole('📷 Camera view reset to object bounds.');
    });
}

const savedColorHexStr = localStorage.getItem('openscad_model_color') || '#3b82f6';
if (modelColorInput) modelColorInput.value = savedColorHexStr;
if (btnColorTrigger) btnColorTrigger.style.background = savedColorHexStr;
let activeModelColor = parseInt(savedColorHexStr.replace('#', '0x'), 16);

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

// ---- FILE OPERATIONS ----
btnSave.addEventListener('click', () => {
    const blob = new Blob([jar.toString()], { type: 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    let safeFilename = activeProjectName.trim().replace(/\.scad$/i, '') || "untitled"; 
    link.download = `${safeFilename}.scad`; link.click();
    logToConsole(`Saved ${safeFilename}.scad successfully.`);
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
        localStorage.setItem('openscad_project_name', activeProjectName);
        if (projectNameInput) projectNameInput.value = activeProjectName;
        updateWindowTitle();
        if (typeof btnPreview !== 'undefined' && !btnPreview.disabled) btnPreview.click();
    };
    reader.readAsText(file);
});

let wireframeMode = false;
btnWireframe.addEventListener('click', () => {
    wireframeMode = !wireframeMode; 
    btnWireframe.textContent = wireframeMode ? 'Wireframe' : 'Solid';
    btnWireframe.style.background = wireframeMode ? '#444' : '#007acc';  
    
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
});

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
        if (btnSave && !btnSave.disabled) {
            logToConsole('⌨️ Hotkey Triggered: [Ctrl] + [S] (Save)');
            btnSave.click();
        }
    }

    // 📂 Open File [Ctrl] + [O]
    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault(); // Stops browser "Open Local File"
        event.stopImmediatePropagation();
        if (fileLoad) {
            logToConsole('⌨️ Hotkey Triggered: [Ctrl] + [O] (Open)');
            fileLoad.click();
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

// ❓ Open Cheat Sheet from Settings Menu
if (btnSettingsCheatSheet && settingsOverlay && helpOverlay) {
    btnSettingsCheatSheet.addEventListener('click', () => {
        settingsOverlay.classList.add('hidden'); // Close Settings
        helpOverlay.classList.remove('hidden');  // Open Cheat Sheet
        logToConsole('📘 Opened Cheat Sheet from Settings Menu');
    });
}

async function initOpenSCAD() {
    logToConsole(`Build ${BUILD_NUMBER} - OpenSCAD PWA Environment`);
    logToConsole('System ready. Instantiating WASM...');
    
    const savedCode = localStorage.getItem('openscad_editor_cache');
    if (savedCode && savedCode.trim() !== "") {
        jar.updateCode(savedCode); 
    } else {
        //jar.updateCode(`linear_extrude(height = 4) {\n\ttext(\n\t\ttext = "Hello, world!", \n\t\tsize = 14, \n\t\tfont = "Liberation Sans:style=Bold", \n\t\thalign = "center", \n\t\tvalign = "center"\n\t);\n}`); 

jar.updateCode(`$fn = 25;   // number of segments set to 25

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
rotate_extrude(convexity = 10)   // torus
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
cylinder(d1=25, d2=0, h=30);   // conic cylinder

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
	translate([-8, 8, -8]) sphere(d=4);
	translate([8, 8, -8]) sphere(d=4);
	translate([-8, -8, 8]) sphere(d=4);
	#translate([8, -8, 8]) sphere(d=4);   // demo highlight modifier, #
	translate([-8, 8, 8]) sphere(d=4);
	translate([8, 8, 8]) sphere(d=4);
}`);
        
    }
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

		logToConsole('✅ Engine ready! Alter code and click Preview freely.');
        btnPreview.disabled = false;
        btnRender.disabled = false;
        btnPreview.click();
		
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
    const scriptCode = rawEditorCode || jar.toString(); 
    const errorLogs = [];

    // Isolate % modifiers (ignoring math modulo operations)
    const ghostRegex = /%(?=\s*(cube|sphere|cylinder|polyhedron|square|circle|polygon|translate|rotate|scale|resize|mirror|multmatrix|color|offset|hull|minkowski|union|difference|intersection|for|intersection_for|if|linear_extrude|rotate_extrude|surface|projection|render|text|import)\b)/g;
    const hasGhost = ghostRegex.test(scriptCode);
    ghostRegex.lastIndex = 0;

    // Detect # highlight modifiers
    const highlightRegex = /#(?=\s*(cube|sphere|cylinder|polyhedron|square|circle|polygon|translate|rotate|scale|resize|mirror|multmatrix|color|offset|hull|minkowski|union|difference|intersection|for|intersection_for|if|linear_extrude|rotate_extrude|surface|projection|render|text|import)\b)/g;
    const hasHighlight = highlightRegex.test(scriptCode);
    highlightRegex.lastIndex = 0;

	// Check for ! root modifier — if present, bypass parser for solid pass
    let rootModifierIndex = -1;
    const hasRootModifier = (() => {
        let inLineComment = false, inBlockComment = false, inString = false;
        for (let i = 0; i < scriptCode.length; i++) {
            const ch = scriptCode[i];
            if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
            if (inBlockComment) { if (ch === '*' && scriptCode[i+1] === '/') { inBlockComment = false; i++; } continue; }
            if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
            if (ch === '"') { inString = true; continue; }
            if (ch === '/' && scriptCode[i+1] === '/') { inLineComment = true; i++; continue; }
            if (ch === '/' && scriptCode[i+1] === '*') { inBlockComment = true; i++; continue; }
            if (ch === '!' && scriptCode[i+1] !== '=') { rootModifierIndex = i; return true; }
        }
        return false;
    })();
	if (consoleDebugging) {
		logToConsole(`🪲 [DEBUG] hasRootModifier: ${hasRootModifier}, rootModifierIndex: ${rootModifierIndex}`);
		logToConsole(`🪲 [DEBUG] scriptCode contains !: ${scriptCode.includes('!difference')}`);
		logToConsole(`🪲 [DEBUG] char at rootModifierIndex: "${scriptCode[rootModifierIndex]}" context: "${scriptCode.slice(rootModifierIndex-10, rootModifierIndex+10)}"`);
	}

	// Extract ! subtree for both passes when root modifier is present
    let isolatedSource = null;
	if (hasRootModifier && rootModifierIndex !== -1) {
        const preamble = scriptCode.slice(0, rootModifierIndex)
            .split('\n')
			.filter(line => {
			    const t = line.trim();
			    return t === '' || 
			           t.startsWith('//') || 
			           t.startsWith('/*') || 
			           t.startsWith('*') ||
			           (/^[\$a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(t) && 
			            t.endsWith(';') && 
			            !t.includes('(') &&
			            !t.includes(')'));
			})
            .join('\n');

        // Use a mini-parser to extract exactly one complete statement after !
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
                if (braceDepth === 0) { statementEnd = si; break; } // unmatched } = end
                braceDepth--; si++;
                if (braceDepth === 0 && parenDepth === 0) { statementEnd = si; break; } // closed block
                continue;
            }
            if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
                statementEnd = si + 1; break; // semicolon at top level = end of statement
            }
            si++;
        }

        isolatedSource = preamble + '\n' + afterBang.slice(0, statementEnd);
    }
	
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
        };

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

        solidInstance.FS.writeFile('/solid_input.scad', solidCode);
        
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
			
			// Use isolated ! subtree for ghost pass if present, otherwise full source
            const ghostSource = isolatedSource ?? scriptCode;
            const cleanGhostCode = isolateOpenSCADGhosts(ghostSource);
			const ghostModuleHeader = `module __GHOST__() { color([0.987, 0.012, 0.876]) children(); }\n\n`;
            const ghostCode = ghostModuleHeader + cleanGhostCode;
            
            if (consoleDebugging) {
				logToConsole("\n🪲 [DEBUG] --- PASS 2 CODE (GHOST GEOMETRY) ---");
            	logToConsole(ghostCode);
            	logToConsole("🪲 -----------------------------------------\n");
			}
            
            ghostInstance.FS.writeFile('/ghost_input.scad', ghostCode);
            
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

            const highlightSource = isolatedSource ?? scriptCode;
            const cleanHighlightCode = isolateHighlights(highlightSource);
            const highlightModuleHeader = `module __HIGHLIGHT__() { color([1.0, 0.3, 0.3, 0.5]) children(); }\n\n`;
            const highlightCode = highlightModuleHeader + cleanHighlightCode;

            if (consoleDebugging) {
                logToConsole("\n🪲 [DEBUG] --- PASS 3 CODE (HIGHLIGHT GEOMETRY) ---");
                logToConsole(highlightCode);
                logToConsole("🪲 -----------------------------------------\n");
            }

            highlightInstance.FS.writeFile('/highlight_input.scad', highlightCode);

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
            } else {
                if (placeholderText) placeholderText.textContent = "❌ Preview Failed (Check Console)";
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
    const renderCode = rawEditorCode || jar.toString();
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

// STL export feature
btnExport.addEventListener('click', () => {
    if (!currentMesh) {
        logToConsole(`[ERROR]: No model loaded to export.`);
        return;
    }
    
	try {
        logToConsole(`⚙️ Preparing geometry for STL export...`);
        
        const exporter = new THREE.STLExporter();
        
        // Clone the mesh group
        const exportClone = currentMesh.clone();
        
        // Deep clone geometries to avoid modifying the live preview
        exportClone.traverse((child) => {
            if (child.isMesh && child.geometry) {
                child.geometry = child.geometry.clone();
            }
        });

        // The live mesh has rotation.x = -PI/2 applied to correct OpenSCAD→Three.js axes.
        // For STL export we need to undo that and apply the correct OpenSCAD→slicer transform.
        // OpenSCAD uses Z-up, slicers use Z-up, so we just need to undo the Three.js display rotation.
        exportClone.rotation.set(0, 0, 0);
        exportClone.updateMatrix();
        exportClone.updateMatrixWorld(true);

        logToConsole(`📦 Packaging geometry into binary STL...`);
        
        const stlResult = exporter.parse(exportClone, { binary: true });
        
        const stlBlob = new Blob([stlResult], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(stlBlob);
        
        const projectName = projectNameInput.value.trim() || "openscad_model";
        link.download = `${projectName}.stl`;
        link.click();
        
        exportClone.traverse((child) => {
            if (child.isMesh && child.geometry) child.geometry.dispose();
        });
        
        logToConsole(`✔ Exported ${projectName}.stl successfully!`);
    } catch (exportErr) {
        logToConsole(`[ERROR]: Failed to export STL geometry: ${exportErr.message}`);
        console.error(exportErr);
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
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(w, h); renderer.setPixelRatio(window.devicePixelRatio); 
    container.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.1;

    gridHelper = new THREE.GridHelper(400, 40, 0x444444, 0x444444);
    gridHelper.position.y = 0; gridHelper.material.polygonOffset = true; gridHelper.material.polygonOffsetFactor = 1; gridHelper.material.polygonOffsetUnits = 1;
    scene.add(gridHelper);

    axesGroup = new THREE.Group();
    const gridHalfSize = 200;
    const overlayConfig = (colorHex) => ({ color: colorHex, depthTest: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 });
    
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-gridHalfSize, 0, 0), new THREE.Vector3(gridHalfSize, 0, 0)]), new THREE.LineBasicMaterial(overlayConfig(0xcc5252))));
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -gridHalfSize), new THREE.Vector3(0, 0, gridHalfSize)]), new THREE.LineBasicMaterial(overlayConfig(0x52cc7a))));
    axesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -gridHalfSize, 0), new THREE.Vector3(0, gridHalfSize, 0)]), new THREE.LineBasicMaterial(overlayConfig(0x007acc))));
    scene.add(axesGroup);
    
    gridHelper.visible = isGridVisible; axesGroup.visible = isAxesVisible;
    
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
    
    function animate() {
        requestAnimationFrame(animate);
        const cw = container.clientWidth, ch = container.clientHeight;
        const currentSize = new THREE.Vector2(); renderer.getSize(currentSize);
        if (cw > 0 && ch > 0 && (currentSize.x !== cw || currentSize.y !== ch)) {
            camera.aspect = cw / ch; camera.updateProjectionMatrix(); renderer.setSize(cw, ch, true);
        }
        controls.update(); renderer.render(scene, camera);

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
                            if (typeof wireframeMode !== 'undefined') mat.wireframe = wireframeMode;
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

                        if (typeof wireframeMode !== 'undefined') {
                            glassMaterial.wireframe = wireframeMode;
                        }

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

                        if (typeof wireframeMode !== 'undefined') {
                            highlightMaterial.wireframe = wireframeMode;
                        }

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

                        if (typeof wireframeMode !== 'undefined') {
                            debugMaterial.wireframe = wireframeMode;
                        }

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

        // Retain view camera positions smoothly
        if (savedPosition && savedTarget) {
            camera.position.copy(savedPosition);
            controls.target.copy(savedTarget);
            controls.update();
        } else {
            frameModelInCamera(currentMesh);
        }

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

btnPreview.disabled = true; btnRender.disabled = true; btnExport.disabled = true;
initOpenSCAD(); init3DWorkspace();
btnWireframe.style.background = '#007acc'; 

// ==========================================================================
// ⚙️ SETTINGS & MANAGER MODALS
// ==========================================================================
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
//const settingsOverlay = document.getElementById('settings-overlay');    // already declared with other Dom elements at top of source
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const btnToggleAxes = document.getElementById('btn-toggle-axes');

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
(Sonnet 4.6 High).

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
                           CodeJar (MIT License)
===========================================================================
<a href="https://github.com/antonmedv/codejar" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/antonmedv/codejar</a>

Copyright (c) 2020 Anton Medvedev

Please see the "MIT LICENSE" section at the 
bottom of this document for the full licensing terms and conditions.

===========================================================================
                            prism (MIT License)
===========================================================================
<a href="https://github.com/PrismJS/prism" target="_blank" style="color: #52b1ff; text-decoration: underline; font-weight: bold;">https://github.com/PrismJS/prism</a>

Copyright (c) 2012 Lea Verou

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
Applies to: CodeJar, Three.js, Prism.js, fflate

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
        const isAnyOpen = [settingsOverlay, fontsOverlay, stlsOverlay, svgsOverlay, licensesOverlay, helpOverlay].some(el => el && !el.classList.contains('hidden'));
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
    if (event.target === settingsOverlay || event.target === fontsOverlay || event.target === stlsOverlay || event.target === svgsOverlay) closeAllMenus();
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
        const nameLabel = document.createElement('span'); nameLabel.textContent = font.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '210px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            //if (confirm(`Uninstall "${font.filename}"?`)) {   // remove confirmation
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
        
        const nameLabel = document.createElement('span'); nameLabel.textContent = stl.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '210px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            //if (confirm(`Remove STL "${stl.filename}"?`)) {   remove confirmation
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
        
        const nameLabel = document.createElement('span'); nameLabel.textContent = svg.filename; nameLabel.style.overflow = 'hidden'; nameLabel.style.textOverflow = 'ellipsis'; nameLabel.style.whiteSpace = 'nowrap'; nameLabel.style.maxWidth = '210px'; nameLabel.style.color = '#ddd'; nameLabel.style.fontWeight = 'bold';
        
        const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.style.background = '#dc3545'; delBtn.style.color = '#fff'; delBtn.style.padding = '2px 7px'; delBtn.style.fontSize = '0.75rem'; delBtn.style.borderRadius = '3px'; delBtn.style.cursor = 'pointer'; delBtn.style.fontWeight = 'bold';
        delBtn.addEventListener('click', async () => {
            //if (confirm(`Remove SVG "${svg.filename}"?`)) {   // remove confirmation
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

const applyGridLayout = (visible) => {
    isGridVisible = visible; localStorage.setItem('openscad_grid_visible', visible);
    if (gridHelper) gridHelper.visible = visible;
    if (btnToggleGrid) { btnToggleGrid.innerText = visible ? 'Visible' : 'Hidden'; btnToggleGrid.style.backgroundColor = visible ? '#28a745' : '#dc3545'; }
};
const applyAxesLayout = (visible) => {
    isAxesVisible = visible; localStorage.setItem('openscad_axes_visible', visible);
    if (axesGroup) axesGroup.visible = visible;
    if (btnToggleAxes) { btnToggleAxes.innerText = visible ? 'Visible' : 'Hidden'; btnToggleAxes.style.backgroundColor = visible ? '#28a745' : '#dc3545'; }
};

applyGridLayout(isGridVisible); applyAxesLayout(isAxesVisible);
if (btnToggleGrid) btnToggleGrid.addEventListener('click', () => applyGridLayout(!isGridVisible));
if (btnToggleAxes) btnToggleAxes.addEventListener('click', () => applyAxesLayout(!isAxesVisible));

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
                    if (cw > 0 && ch > 0) { camera.aspect = cw / ch; camera.updateProjectionMatrix(); renderer.setSize(cw, ch, true); }
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
// 🔴 HIGHLIGHT EXTRACTOR — isolates # marked geometry for red overlay pass
// Mirrors isolateOpenSCADGhosts but targets # instead of %
// # geometry renders solid in Pass 1, red overlay in Pass 3
// # does NOT propagate to children (unlike % which propagates via isInsideGhostScope)
// ==========================================================================
function isolateHighlights(code) {
    let i = 0;
    const len = code.length;

    function skipWS() {
        while (i < len) {
            const ch = code[i];
            if (/\s/.test(ch)) { i++; }
            else if (ch === '/' && code[i+1] === '/') { while (i < len && code[i] !== '\n') i++; }
            else if (ch === '/' && code[i+1] === '*') {
                i += 2;
                while (i < len && !(code[i] === '*' && code[i+1] === '/')) i++;
                i += 2;
            } else if (ch === '"') {
                i++;
                while (i < len) {
                    if (code[i] === '\\') i += 2;
                    else if (code[i] === '"') { i++; break; }
                    else i++;
                }
            } else break;
        }
    }

    function skipBody() {
        skipWS();
        if (i >= len) return;
        if (code[i] === '{') {
            let depth = 1; i++;
            while (i < len && depth > 0) {
                const ch = code[i];
                if (ch === '"') { i++; while (i < len) { if (code[i] === '\\') i += 2; else if (code[i] === '"') { i++; break; } else i++; } }
                else if (ch === '/' && code[i+1] === '/') { while (i < len && code[i] !== '\n') i++; }
                else if (ch === '/' && code[i+1] === '*') { i += 2; while (i < len && !(code[i] === '*' && code[i+1] === '/')) i++; if (i < len) i += 2; }
                else if (ch === '{') { depth++; i++; }
                else if (ch === '}') { depth--; i++; }
                else i++;
            }
        } else {
            parseH(false);
        }
    }

    function parseBlock(inHighlight) {
        const children = [];
        while (i < len) {
            skipWS();
            if (i >= len || code[i] === '}') break;
            children.push(parseH(inHighlight));
        }
        if (i < len && code[i] === '}') i++;
        return children;
    }

    // Returns { solid, highlight } strings
    function parseH(inHighlight) {
        skipWS();
        if (i >= len) return { solid: "", highlight: "" };

        let isHighlight = false;
        let isDisable   = false;
        let isGhost     = false;
        while (i < len) {
            const ch = code[i];
            if (ch === '#') { isHighlight = true; i++; }
            else if (ch === '*') { isDisable = true; i++; }
            else if (ch === '%') { isGhost = true; i++; }
            else if (ch === '!') { i++; }
            else break;
            skipWS();
        }

        // * — disabled, produce nothing
        if (isDisable) { skipBody(); return { solid: "", highlight: "" }; }

        // % — ghost, skip for highlight pass (no solid, no highlight)
        if (isGhost) { skipBody(); return { solid: "", highlight: "" }; }

        if (i >= len) return { solid: "", highlight: "" };

        // Bare brace block
        if (code[i] === '{') {
            i++;
            const children = parseBlock(isHighlight);
            const s = children.map(c => c.solid).join("");
            const h = children.map(c => c.highlight).join("");
            return { solid: `{\n${s}}\n`, highlight: h };
        }

        // Read expression
        let expr = "";
        let parens = 0, brackets = 0;
        let endedSemi = false;
        let isVarAssign = false;

        while (i < len) {
            const ch = code[i];
            if (ch === '"') {
                expr += ch; i++;
                while (i < len) {
                    const sc = code[i]; expr += sc;
                    if (sc === '\\') { i++; if (i < len) { expr += code[i]; i++; } }
                    else if (sc === '"') { i++; break; }
                    else i++;
                }
                continue;
            }
            if (ch === '/' && code[i+1] === '/') { while (i < len && code[i] !== '\n') { expr += code[i]; i++; } continue; }
            if (ch === '/' && code[i+1] === '*') {
                expr += '/*'; i += 2;
                while (i < len && !(code[i] === '*' && code[i+1] === '/')) { expr += code[i]; i++; }
                if (i < len) { expr += '*/'; i += 2; }
                continue;
            }
            expr += ch;
            if (ch === '(') parens++;
            if (ch === ')') parens--;
            if (ch === '[') brackets++;
            if (ch === ']') brackets--;
            if (ch === '=' && parens === 0 && brackets === 0 && !expr.trim().startsWith('module')) isVarAssign = true;
            i++;
            if (ch === ';' && parens === 0 && brackets === 0) { endedSemi = true; break; }
            if (ch === ')' && parens === 0 && brackets === 0) {
                let peek = i;
                while (peek < len && /\s/.test(code[peek])) peek++;
                if (peek < len && code[peek] === ';') {
                    while (i < peek) { expr += code[i]; i++; }
                    expr += code[i]; i++;
                    endedSemi = true;
                }
                break;
            }
        }

        skipWS();

        // Variable assignment — pass through, no highlight
        if (isVarAssign) return { solid: `${expr}\n`, highlight: `${expr}\n` };

        const isWrapper = !endedSemi && i < len &&
            (code[i] === '{' || code[i] === '(' || code[i] === '%' || code[i] === '#' ||
             code[i] === '*' || /[a-zA-Z0-9_$]/.test(code[i]));

        // Leaf primitive
        if (!isWrapper) {
            if (isHighlight) {
                return {
                    solid:     `${expr}\n`,
                    highlight: `__HIGHLIGHT__() ${expr}\n`
                };
            }
            return { solid: `${expr}\n`, highlight: "" };
        }

        // Classify wrapper
        const clean = expr.trim().toLowerCase();
        const isConditional = clean.startsWith('if') || clean.startsWith('for') ||
                              clean.startsWith('let') || clean.startsWith('each');

        // # on a wrapper — wrap children in __HIGHLIGHT__(), children parsed normally
        if (isHighlight) {
            let children = [];
            if (i < len && code[i] === '{') { i++; children = parseBlock(false); }
            else children.push(parseH(false));
            const solidParts = children.map(c => c.solid).join("");
            return {
                solid:     `${expr}\n{\n${solidParts}}\n`,
                highlight: `__HIGHLIGHT__() ${expr}\n{\n${solidParts}}\n`
            };
        }

        // Conditional — transparent pass-through
        if (isConditional) {
            let children = [];
            if (i < len && code[i] === '{') { i++; children = parseBlock(false); }
            else children.push(parseH(false));
            const s = children.map(c => c.solid).join("");
            const h = children.map(c => c.highlight).join("");
            return {
                solid:     `${expr}\n{\n${s}}\n`,
                highlight: h ? `${expr}\n{\n${h}}\n` : ""
            };
        }

        // Regular wrapper — parse children, bubble up highlight spill
        let children = [];
        if (i < len && code[i] === '{') { i++; children = parseBlock(false); }
        else children.push(parseH(false));

        const solidParts = children.map(c => c.solid).join("");
        const highlightParts = children.map(c => c.highlight).join("");

        return {
            solid:     `${expr}\n{\n${solidParts}}\n`,
            highlight: highlightParts ? `${expr}\n{\n${highlightParts}}\n` : ""
        };
    }

    let output = "";
    while (i < len) {
        const res = parseH(false);
        output += res.highlight;
        skipWS();
    }
    return output;
}

function isolateOpenSCADGhosts(code, stripAllGhostsMode = false) {
    let i = 0;
    const len = code.length;

    function skipWhitespaceAndComments() {
        while (i < len) {
            let ch = code[i];
            if (/\s/.test(ch)) {
                i++;
            } else if (ch === '/' && code[i+1] === '/') {
                while (i < len && code[i] !== '\n') i++;
            } else if (ch === '/' && code[i+1] === '*') {
                i += 2;
                while (i < len && !(code[i] === '*' && code[i+1] === '/')) i++;
                i += 2;
            } else if (ch === '"') {
                i++;
                while (i < len) {
                    if (code[i] === '\\') i += 2;
                    else if (code[i] === '"') { i++; break; }
                    else i++;
                }
            } else {
                break;
            }
        }
    }

    function parseBlock(isInsideGhostScope) {
        let children = [];
        while (i < len) {
            skipWhitespaceAndComments();
            if (i >= len || code[i] === '}') break;
            children.push(parseComponent(isInsideGhostScope));
        }
        if (i < len && code[i] === '}') i++;
        return children;
    }

	function skipChildBody() {
        skipWhitespaceAndComments();
        if (i >= len) return;
        if (code[i] === '{') {
            let depth = 1; i++;
            while (i < len && depth > 0) {
                const ch = code[i];
                if (ch === '"') {
                    i++;
                    while (i < len) {
                        if (code[i] === '\\') i += 2;
                        else if (code[i] === '"') { i++; break; }
                        else i++;
                    }
                } else if (ch === '/' && code[i+1] === '/') {
                    while (i < len && code[i] !== '\n') i++;
                } else if (ch === '/' && code[i+1] === '*') {
                    i += 2;
                    while (i < len && !(code[i] === '*' && code[i+1] === '/')) i++;
                    if (i < len) i += 2;
                } else if (ch === '{') { depth++; i++; }
                else if (ch === '}') { depth--; i++; }
                else i++;
            }
        } else {
            parseComponent(false); // parse and discard
        }
    }
	
    function parseComponent(isInsideGhostScope) {
        skipWhitespaceAndComments();
        if (i >= len) return { solidContent: "", content: "", ghostContent: "", containsGhost: false, hasNestedGhost: false, isSelfGhost: false };

		let hasGhostModifier   = false;
        let hasDisableModifier = false;
		while (i < len) {
            let ch = code[i];
            if (ch === '%') { hasGhostModifier = true; i++; }
            else if (ch === '*') { hasDisableModifier = true; i++; }
            else if (ch === '!') { i++; } // root modifier — consumed, handled at pipeline level
            else if (ch === '#') { i++; } // highlight — consumed silently, handled by isolateHighlights()
            else break;
            skipWhitespaceAndComments();
        }

        const effectiveGhost = isInsideGhostScope || hasGhostModifier;

        skipWhitespaceAndComments();

		// * modifier — disable entirely, skip body and produce nothing in either pass
        if (hasDisableModifier) {
            skipChildBody();
            return { solidContent: "", content: "", ghostContent: "", containsGhost: false, hasNestedGhost: false, isSelfGhost: false };
        }
		
        if (i >= len) return { solidContent: "", content: "", ghostContent: "", containsGhost: false, hasNestedGhost: false, isSelfGhost: effectiveGhost };

        // --- Bare brace block ---
        if (code[i] === '{') {
            i++;
            let children = parseBlock(effectiveGhost);
            let solidParts = "", visibleParts = "", ghostParts = "";
            let blockContainsGhost = false;
            for (let child of children) {
                if (child.isSelfGhost || child.containsGhost || child.hasNestedGhost) blockContainsGhost = true;
                solidParts   += child.solidContent;
                visibleParts += child.content;
                ghostParts   += child.ghostContent;
            }
            return {
                solidContent:  `{\n${solidParts}}\n`,
                content:       `{\n${visibleParts}}\n`,
                ghostContent:  `{\n${ghostParts}}\n`,
                containsGhost:  effectiveGhost,
                hasNestedGhost: blockContainsGhost,
                isSelfGhost:    effectiveGhost
            };
        }

        // --- Read expression ---
        let expression = "";
        let parensCount = 0;
        let bracketCount = 0;
        let endedWithSemicolon = false;
        let isVariableAssignment = false;

        while (i < len) {
            let char = code[i];
            if (char === '"') {
                expression += char; i++;
                while (i < len) {
                    let sc = code[i]; expression += sc;
                    if (sc === '\\') { i++; if (i < len) { expression += code[i]; i++; } }
                    else if (sc === '"') { i++; break; }
                    else i++;
                }
                continue;
            }
            if (char === '/' && code[i+1] === '/') {
                while (i < len && code[i] !== '\n') { expression += code[i]; i++; }
                continue;
            }
            if (char === '/' && code[i+1] === '*') {
                expression += '/*'; i += 2;
                while (i < len && !(code[i] === '*' && code[i+1] === '/')) { expression += code[i]; i++; }
                if (i < len) { expression += '*/'; i += 2; }
                continue;
            }
            expression += char;
            if (char === '(') parensCount++;
            if (char === ')') parensCount--;
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;
            if (char === '=' && parensCount === 0 && bracketCount === 0 && !expression.trim().startsWith('module')) {
                isVariableAssignment = true;
            }
            i++;
            if (char === ';' && parensCount === 0 && bracketCount === 0) {
                endedWithSemicolon = true; break;
            }
            if (char === ')' && parensCount === 0 && bracketCount === 0) {
                let peek = i;
                while (peek < len && /\s/.test(code[peek])) peek++;
                if (peek < len && code[peek] === ';') {
                    while (i < peek) { expression += code[i]; i++; }
                    expression += code[i]; i++;
                    endedWithSemicolon = true;
                }
                break;
            }
        }

        skipWhitespaceAndComments();

        // Variable/function assignment — pass through unchanged
        if (isVariableAssignment) {
            return { solidContent: `${expression}\n`, content: `${expression}\n`, ghostContent: `${expression}\n`, containsGhost: false, hasNestedGhost: false, isSelfGhost: false };
        }

        let isWrapper = false;
        if (!endedWithSemicolon && i < len) {
            let nc = code[i];
            if (nc === '{' || nc === '(' || nc === '%' || nc === '*' || nc === '#' || /[a-zA-Z0-9_$]/.test(nc)) {
                isWrapper = true;
            }
        }

        // --- Leaf primitive ---
        if (!isWrapper) {
            if (effectiveGhost) {
                return {
                    solidContent: `${expression}\n`,
                    content:      "",
                    ghostContent: `__GHOST__() ${expression}\n`,
                    containsGhost: true, hasNestedGhost: false, isSelfGhost: true
                };
            }
            return {
                solidContent: `${expression}\n`,
                content:      `${expression}\n`,
                ghostContent: `${expression}\n`,
                containsGhost: false, hasNestedGhost: false, isSelfGhost: false
            };
        }

        // --- Classify the wrapper ---
        const cleanExpr = expression.trim().toLowerCase();
        const isDifference   = cleanExpr.startsWith('difference');
        const isIntersection = cleanExpr.startsWith('intersection');
        const isBooleanOp    = isDifference || isIntersection;
        const isHullOp       = cleanExpr.startsWith('hull') || cleanExpr.startsWith('minkowski');
		const isConditional  = cleanExpr.startsWith('if') || cleanExpr.startsWith('for') || cleanExpr.startsWith('let') || cleanExpr.startsWith('each');

		// --- Conditional/loop — transparent pass-through, never aggregate ghost flags upward ---
        if (isConditional) {
            let condChildren = [];
            if (i < len && code[i] === '{') {
                i++;
                condChildren = parseBlock(effectiveGhost);
            } else {
                condChildren.push(parseComponent(effectiveGhost));
            }
            const jf = (field) => condChildren.map(c => c[field] || "").join("");
            const solidC  = jf('solidContent');
            const contentC = jf('content');
            const rawGhost = jf('ghostContent');
            const hasRealGhostContent = condChildren.some(c =>
                c.ghostContent && c.ghostContent !== c.content && c.ghostContent !== c.solidContent
            );
            return {
                solidContent: `${expression}\n{\n${solidC}}\n`,
                content:      `${expression}\n{\n${contentC}}\n`,
                ghostContent: hasRealGhostContent ? `${expression}\n{\n${rawGhost}}\n` : "",
                containsGhost:  false,
                hasNestedGhost: false,
                isSelfGhost:    false
            };
        }

		// --- Ghost wrapper (non-boolean, non-hull) ---
        if (effectiveGhost && !isBooleanOp && !isHullOp) {
            let children = [];
            if (i < len && code[i] === '{') {
                i++;
                children = parseBlock(true);
            } else {
                children.push(parseComponent(true));
            }
            let solidParts = "", ghostParts = "";
            for (let child of children) {
                solidParts += child.solidContent;
                ghostParts += child.ghostContent || child.solidContent;
            }
            return {
                solidContent: `${expression}\n{\n${solidParts}}\n`,
                content:      "",
                ghostContent: `__GHOST__() ${expression}\n{\n${ghostParts}}\n`,
                containsGhost: true, hasNestedGhost: false, isSelfGhost: true
            };
        }

        // --- Parse children ---
        let children = [];
        if (i < len && code[i] === '{') {
            i++;
            children = parseBlock((isBooleanOp || isHullOp) ? false : effectiveGhost);
        } else {
            children.push(parseComponent(isBooleanOp ? false : effectiveGhost));
        }

        const anyChildGhost    = children.some(c => c.isSelfGhost || c.containsGhost || c.hasNestedGhost);
        const allChildrenGhost = children.length > 0 && children.every(c => c.isSelfGhost || c.containsGhost || c.hasNestedGhost);
        const hasMixedChildren = anyChildGhost && !allChildrenGhost;

        function joinField(field) {
            return children.map(c => c[field] || "").join("");
        }

        // -----------------------------------------------------------------------
        // SOLID PASS (stripAllGhostsMode = true)
        // -----------------------------------------------------------------------
		if (stripAllGhostsMode) {
            if (hasGhostModifier) {
                let solidParts = joinField('solidContent');
                return {
                    solidContent: `${expression}\n{\n${solidParts}}\n`,
                    content:      "",
                    ghostContent: "",
                    containsGhost: true, hasNestedGhost: false, isSelfGhost: true
                };
            }

            if (isBooleanOp && anyChildGhost) {
                const firstIsGhost = children[0].isSelfGhost || children[0].containsGhost;
                let allSolid = joinField('solidContent');
				if (firstIsGhost) {
                    let subtractorContent = children.slice(1).map(c => c.solidContent).join("");
                    return {
                        solidContent: `union()\n{\n${subtractorContent}}\n`,
                        content:      `union()\n{\n${subtractorContent}}\n`,
                        ghostContent: "",
                        containsGhost: true, hasNestedGhost: false, isSelfGhost: false
                    };
                }
                // Positive volume is solid — keep original op, drop ghost subtractors
                let solidOnly = children.filter(c => !c.isSelfGhost && !c.containsGhost).map(c => c.content).join("");
                return {
                    solidContent: `${expression}\n{\n${allSolid}}\n`,
                    content:      `${expression}\n{\n${solidOnly}}\n`,
                    ghostContent: "",
                    containsGhost: false, hasNestedGhost: false, isSelfGhost: false
                };
            }

			if (isHullOp && anyChildGhost) {
                // Ghost children excluded from hull computation in solid pass
                const solidChildren = children.filter(c => !c.isSelfGhost && !c.containsGhost && !c.hasNestedGhost);
                const solidHullParts = solidChildren.map(c => c.solidContent).join("");
                const solidHull = allChildrenGhost ? "" : `${expression}\n{\n${solidHullParts}}\n`;
                return {
                    solidContent: solidHull,
                    content:      solidHull,
                    ghostContent: "",
                    containsGhost: false, hasNestedGhost: false, isSelfGhost: false
                };
            }

			// Pass through — use content for visible output, solidContent for CSG
            let allSolidContent = joinField('solidContent');
            let allContent = joinField('content');
            return {
                solidContent: `${expression}\n{\n${allSolidContent}}\n`,
                content:      `${expression}\n{\n${allContent}}\n`,
                ghostContent: "",
                containsGhost: anyChildGhost, hasNestedGhost: anyChildGhost, isSelfGhost: false
            };
        }

        // -----------------------------------------------------------------------
        // GHOST PASS (stripAllGhostsMode = false)
        // -----------------------------------------------------------------------

        // Boolean op with mixed ghost/solid children
        if (isBooleanOp && hasMixedChildren) {
            const firstIsGhost = children[0].isSelfGhost || children[0].containsGhost;
            let allSolid = joinField('solidContent');

			if (firstIsGhost) {
                let subtractorContent = children.slice(1).map(c => c.solidContent).join("");
                let ghostOnlyContent = "";
                for (let child of children) {
                    if (child.isSelfGhost || child.containsGhost || child.hasNestedGhost) {
                        ghostOnlyContent += child.ghostContent || `__GHOST__() {\n${child.solidContent}}\n`;
                    }
                }
                return {
                    solidContent: `union()\n{\n${subtractorContent}}\n`,
                    content:      `union()\n{\n${subtractorContent}}\n`,
                    ghostContent: ghostOnlyContent,
                    containsGhost: true, hasNestedGhost: true, isSelfGhost: false
                };
            } else {
                // Positive volume is solid, some subtractors are explicitly ghost.
                // Solid pass: original op with only solid subtractors.
                // Ghost pass: only ghost subtractors in ghost 3MF.
                let solidSubtractorsOnly = children.map(c =>
                    (c.isSelfGhost || c.containsGhost || c.hasNestedGhost) ? "" : c.content
                ).join("");
                let ghostOnlyContent = "";
                for (let child of children) {
                    if (child.isSelfGhost || child.containsGhost || child.hasNestedGhost) {
                        ghostOnlyContent += child.ghostContent || `__GHOST__() {\n${child.solidContent}}\n`;
                    }
                }
                return {
                    solidContent: `${expression}\n{\n${allSolid}}\n`,
                    content:      `${expression}\n{\n${solidSubtractorsOnly}}\n`,
                    ghostContent: ghostOnlyContent,
                    containsGhost: true, hasNestedGhost: true, isSelfGhost: false
                };
            }
        }

		// Boolean op that is itself ghost (%difference, %intersection) with fully solid children
        if (isBooleanOp && effectiveGhost && !hasMixedChildren) {
            let solidParts = joinField('solidContent');
            let ghostParts = joinField('ghostContent') || joinField('solidContent');
            return {
                solidContent: `${expression}\n{\n${solidParts}}\n`,
                content:      "",
                ghostContent: `__GHOST__() ${expression}\n{\n${ghostParts}}\n`,
                containsGhost: true, hasNestedGhost: false, isSelfGhost: true
            };
        }

		// Hull/minkowski op — ghost children excluded from hull computation,
        // rendered separately. If hull itself is ghost (%hull), hull result
        // is also ghost.
        if (isHullOp) {
            const solidChildren = children.filter(c => !c.isSelfGhost && !c.containsGhost && !c.hasNestedGhost);
            const ghostChildren = children.filter(c =>  c.isSelfGhost ||  c.containsGhost ||  c.hasNestedGhost);

            // Collect separately-rendered ghost children
            let ghostSeparateParts = "";
            for (let child of ghostChildren) {
                ghostSeparateParts += child.ghostContent || `__GHOST__() {\n${child.solidContent}}\n`;
            }

            // All children ghost — hull produces nothing, all rendered separately
            if (allChildrenGhost) {
                return {
                    solidContent: "",
                    content:      "",
                    ghostContent: ghostSeparateParts,
                    containsGhost: false, hasNestedGhost: false, isSelfGhost: false
                };
            }

            // Build the hull from solid children only
            const solidHullParts = solidChildren.map(c => c.solidContent).join("");
            const solidHull = `${expression}\n{\n${solidHullParts}}\n`;

            // No ghost children — hull is fully solid (or fully ghost if %hull)
            if (!anyChildGhost) {
                return {
                    solidContent: solidHull,
                    content:      effectiveGhost ? "" : solidHull,
                    ghostContent: effectiveGhost ? `__GHOST__() ${solidHull}` : "",
                    containsGhost: effectiveGhost, hasNestedGhost: false, isSelfGhost: effectiveGhost
                };
            }

            // Mixed children — ghost children excluded from hull, rendered separately.
            // If hull itself is %ghost, the hull result is also ghost.
            return {
                solidContent: solidHull,
                content:      effectiveGhost ? "" : solidHull,
                ghostContent: effectiveGhost
                    ? `__GHOST__() ${solidHull}${ghostSeparateParts}`
                    : ghostSeparateParts,
                containsGhost: effectiveGhost, hasNestedGhost: !effectiveGhost, isSelfGhost: effectiveGhost
            };
        }
		
        // Non-boolean wrapper with mixed children (translate, color, rotate, etc.)
		if (hasMixedChildren) {
            let solidParts   = joinField('solidContent');
            let visibleParts = joinField('content');
            // Ghost pass: only emit children that have actual ghost content.
            // Solid children emit nothing to ghost 3MF.
            let ghostParts = children.map(c => {
                const hasRealGhost = c.ghostContent && 
                                     c.ghostContent !== c.content && 
                                     c.ghostContent !== c.solidContent;
                return hasRealGhost ? c.ghostContent : "";
            }).join("");
            //if (expression.trim().startsWith('rotate')) {
            //    console.log("ROTATE hasMixedChildren ghostParts length:", ghostParts.length, "preview:", JSON.stringify(ghostParts.substring(0, 80)));
            //}			
            return {
                solidContent: `${expression}\n{\n${solidParts}}\n`,
                content:      `${expression}\n{\n${visibleParts}}\n`,
                ghostContent: ghostParts ? `${expression}\n{\n${ghostParts}}\n` : ghostParts,
                containsGhost: false, hasNestedGhost: true, isSelfGhost: false
            };
        }

        // All children ghost (wrapper itself not explicitly ghosted)
        if (allChildrenGhost) {
            let solidParts = joinField('solidContent');
            let ghostParts = joinField('ghostContent');
            return {
                solidContent: `${expression}\n{\n${solidParts}}\n`,
                content:      "",
                ghostContent: `${expression}\n{\n${ghostParts}}\n`,
                containsGhost: true, hasNestedGhost: false, isSelfGhost: false
            };
        }

		// Fully solid — only propagate hull ghost spillover if present, nothing otherwise
        let solidParts = joinField('solidContent');
		let ghostSpill = children
            .filter(c => c.ghostContent && c.ghostContent !== c.content && c.ghostContent !== c.solidContent &&
                         !c.isSelfGhost && !c.containsGhost)
            .map(c => c.ghostContent).join("");
		const fullSolidBlock = `${expression}\n{\n${solidParts}}\n`;
		return {
            solidContent: fullSolidBlock,
            content:      fullSolidBlock,
            ghostContent: ghostSpill ? `${expression}\n{\n${ghostSpill}}\n` : "",
            containsGhost: false, hasNestedGhost: false, isSelfGhost: false
        };
    }

	let solidOutput = "";
    let ghostOutput = "";
    let rootSolid = null;
    let rootGhost = null;

    while (i < len) {
        let res = parseComponent(false);
        if (res.isRootNode) {
            rootSolid = res.content;
            rootGhost = res.ghostContent;
        } else {
            solidOutput += res.content;
            ghostOutput += res.ghostContent;
        }
        skipWhitespaceAndComments();
    }

    // ! modifier — if a root node was found, it overrides everything else
    if (rootSolid !== null) {
        solidOutput = rootSolid;
        ghostOutput = rootGhost || "";
    }

    return stripAllGhostsMode ? solidOutput : ghostOutput;
}
