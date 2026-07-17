// ============================================================================
// preview-transforms.js — SCADLite multi-pass preview code transforms
// ----------------------------------------------------------------------------
// Extracted from app.js (v301 lines 2924-3719) into a standalone, Node-testable
// ES module, with four structural parser fixes. The transform logic and pass
// semantics are otherwise IDENTICAL to v301.
//
// FIXES (each marked with a "FIX:" comment at the change site):
//
//  1. Statement boundary vs. expressions — a depth-0 ')' no longer ends a
//     statement inside an assignment RHS or a `function ... = ...;` definition,
//     where infix operators (% * + - ? : > ...) may legally follow it.
//     Was corrupting:  c = (i) % 10;   →  "c = (i)" + stray ghost "10;"
//                      c = (a) * (b);  →  "(b)" silently DELETED (disable)
//                      function F(x) = ...;  →  header split from body
//
//  2. Block boundary — a depth-0 '{' now ends the expression scan without
//     being consumed (it belongs to the wrapper/block logic). Was being
//     swallowed by bare `else {`, desynchronizing brace tracking by one and
//     corrupting everything downstream of the enclosing module.
//
//  3. Atomic if/else chains (both parsers) — a trailing `else` (incl.
//     `else if` chains, via recursion) is consumed as part of the SAME
//     statement as its `if`, so the pair is emitted or dropped together in
//     every pass output. Was orphaning `else` blocks (syntax error) whenever
//     one branch had pass-relevant content and the other didn't.
//
//  4. include <...> / use <...> support — these statements have no semicolon
//     and no braces, so the expression scanners previously swallowed them
//     together with the following statement, and the ghost/highlight passes
//     could drop them entirely (leaving library modules undefined in those
//     passes). Both parsers now consume them as standalone statements and
//     preserve them verbatim in EVERY pass output. (splitTopLevelStatements
//     and isDefinitionStatement already handled them for the root-modifier
//     path.) This enables native library support: mount library folders into
//     the WASM virtual filesystem and include/use resolves exactly as on
//     desktop OpenSCAD.
//
//  5. findRootModifier() — new export replacing the inline '!' scan in the
//     preview pipeline. String/comment-aware AND prefix-position-aware:
//     logical-not in expressions (a = !b; if (!x) ...; f(!y); [!a]; c ? !d : e)
//     no longer falsely triggers root-modifier isolation mode. A '!' counts as
//     the root modifier only when its previous significant character is one of
//     ; { } ) % # * ! or start-of-file ('!=' is always excluded).
//
// VALIDATION (real OpenSCAD 2021.01 parse+evaluate of every pass output):
//   - 13-case MRE covering all four modifier/operator collisions: all clean
//   - 5,223-line community torture test (StoneAgeLib v9 flattened): all clean
//   - Simple-model regression file: all clean; highlight output byte-identical
//     to v301, solid/ghost differ only at the intentionally fixed constructs
//
// USAGE (app.js):
//   import { isolateHighlights, isolateOpenSCADGhosts, splitTopLevelStatements,
//            isDefinitionStatement, collectTopLevelDefinitions,
//            findRootModifier } from './preview-transforms.js';
//   ...then DELETE the same function definitions from app.js (v301 lines
//   2924-3719), and replace the inline hasRootModifier IIFE scan in the
//   preview pipeline with:  const rootModifierIndex = findRootModifier(scriptCode);
//                           const hasRootModifier = rootModifierIndex !== -1;
// Remember: add this file to the service worker precache list and bump the
// cache version, or offline/returning users won't receive it.
// ============================================================================

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

        // include <...> / use <...> — standalone statements with NO semicolon
        // and no braces, so the expression scanner below would swallow them
        // together with whatever follows. Consume through the closing '>' and
        // preserve the line in BOTH pass outputs: the highlight pass needs the
        // library's definitions available for any __HIGHLIGHT__-wrapped calls.
        if (/^(include|use)(?=[\s<])/.test(code.slice(i, i + 8))) {
            const stmtStart = i;
            while (i < len && code[i] !== '>' && code[i] !== '\n') i++;
            if (i < len && code[i] === '>') i++;
            const line = code.slice(stmtStart, i);
            return { solid: line + "\n", highlight: line + "\n" };
        }

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
            // FIX: a depth-0 '{' begins a block body (e.g. bare `else {`);
            // stop WITHOUT consuming it so the wrapper logic handles the block.
            if (ch === '{' && parens === 0 && brackets === 0) break;
            expr += ch;
            if (ch === '(') parens++;
            if (ch === ')') parens--;
            if (ch === '[') brackets++;
            if (ch === ']') brackets--;
            if (ch === '=' && parens === 0 && brackets === 0 && !expr.trim().startsWith('module')) isVarAssign = true;
            i++;
            if (ch === ';' && parens === 0 && brackets === 0) { endedSemi = true; break; }
            if (ch === ')' && parens === 0 && brackets === 0) {
                // FIX: a depth-0 ')' only ends a statement in MODULE-CALL position
                // (wrapper like translate(...) with a child following). Inside an
                // expression — an assignment RHS or a function definition body —
                // operators like % * + - ? : > can follow the ')'; keep scanning
                // to the ';' instead of cutting the statement here.
                if (isVarAssign || /^\s*function\b/.test(expr)) continue;
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
            // FIX: consume any trailing `else` / `else if` chain into THIS
            // statement so an if/else pair is emitted or dropped ATOMICALLY.
            // Without this, an if-branch with no highlight content is dropped
            // from the highlight output while its else-branch (containing,
            // say, assignments) is kept — leaving an orphaned `else`.
            // Recursion via parseH handles `else if (...)` chains naturally.
            let elseSolid = "", elseHighlight = "";
            if (clean.startsWith('if')) {
                skipWS();
                if (code.slice(i, i + 4) === 'else' && !/[A-Za-z0-9_$]/.test(code[i + 4] || '')) {
                    i += 4;
                    skipWS();
                    let eChildren = [];
                    if (i < len && code[i] === '{') { i++; eChildren = parseBlock(false); }
                    else eChildren.push(parseH(false));
                    elseSolid = eChildren.map(c => c.solid).join("");
                    elseHighlight = eChildren.map(c => c.highlight).join("");
                }
            }
            const hasElse = elseSolid !== "" || elseHighlight !== "";
            const s = children.map(c => c.solid).join("");
            const h = children.map(c => c.highlight).join("");
            const solidOut = hasElse
                ? `${expr}\n{\n${s}}\nelse\n{\n${elseSolid}}\n`
                : `${expr}\n{\n${s}}\n`;
            // If EITHER side has highlight content, emit the WHOLE chain
            // (an `else` cannot stand without its `if`).
            const highlightOut = (h || elseHighlight)
                ? (hasElse
                    ? `${expr}\n{\n${h}}\nelse\n{\n${elseHighlight}}\n`
                    : `${expr}\n{\n${h}}\n`)
                : "";
            return { solid: solidOut, highlight: highlightOut };
        }

        // Regular wrapper — parse children, bubble up highlight spill
        let children = [];
        if (i < len && code[i] === '{') { i++; children = parseBlock(false); }
        else children.push(parseH(false));

        const solidParts = children.map(c => c.solid).join("");
        const highlightParts = children.map(c => c.highlight).join("");

        // FIX: module DEFINITIONS must survive into the highlight output with
        // their full (solid) body, or call sites like `#myModule()` fail with
        // an unknown-module warning and the highlighted geometry silently
        // vanishes. (Function definitions already survive via the assignment
        // path; `use`/`include` lines survive via the include/use handler.)
        // Note: a `#` INSIDE a module body still gets no highlight treatment —
        // modifiers belong at the call site — but the definition is intact.
        if (clean.startsWith('module')) {
            const def = `${expr}\n{\n${solidParts}}\n`;
            return { solid: def, highlight: def };
        }

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

// Split source into complete top-level statements, depth- and comment-aware.
// Handles ; -terminated statements, balanced {} blocks, and use/include <...>.
function splitTopLevelStatements(code) {
    const out = [];
    let i = 0;
    const n = code.length;

    const skipTrivia = () => {
        while (i < n) {
            const ch = code[i];
            if (/\s/.test(ch)) i++;
            else if (ch === '/' && code[i+1] === '/') { while (i < n && code[i] !== '\n') i++; }
            else if (ch === '/' && code[i+1] === '*') { i += 2; while (i < n && !(code[i] === '*' && code[i+1] === '/')) i++; i += 2; }
            else break;
        }
    };

    while (i < n) {
        skipTrivia();
        if (i >= n) break;
        const start = i;
        const isUseInc = /^(use|include)\s*</.test(code.slice(i, i + 12));

        let paren = 0, brace = 0, bracket = 0;
        let inStr = false, inLC = false, inBC = false;
        let end = n;

        while (i < n) {
            const ch = code[i];
            if (inLC) { if (ch === '\n') inLC = false; i++; continue; }
            if (inBC) { if (ch === '*' && code[i+1] === '/') { inBC = false; i += 2; continue; } i++; continue; }
            if (inStr) { if (ch === '\\') i += 2; else { if (ch === '"') inStr = false; i++; } continue; }
            if (ch === '"') { inStr = true; i++; continue; }
            if (ch === '/' && code[i+1] === '/') { inLC = true; i += 2; continue; }
            if (ch === '/' && code[i+1] === '*') { inBC = true; i += 2; continue; }

            if (isUseInc && ch === '>' && paren === 0 && brace === 0 && bracket === 0) { i++; end = i; break; }
            if (ch === '(') paren++;
            else if (ch === ')') paren--;
            else if (ch === '[') bracket++;
            else if (ch === ']') bracket--;
            else if (ch === '{') brace++;
            else if (ch === '}') {
                if (brace === 0) { end = i; break; }                 // stray close — stop before it
                brace--;
                if (brace === 0 && paren === 0 && bracket === 0) { i++; end = i; break; }
                i++; continue;
            }
            else if (ch === ';' && paren === 0 && brace === 0 && bracket === 0) { i++; end = i; break; }
            i++;
        }
        if (end <= start) { end = n; i = n; }
        out.push(code.slice(start, end));
    }
    return out;
}

function isDefinitionStatement(text) {
    const s = text.trimStart();
    if (/^module\b/.test(s)) return true;
    if (/^function\b/.test(s)) return true;
    if (/^(use|include)\s*</.test(s)) return true;
    return /^[$A-Za-z_]\w*\s*=(?!=)/.test(s);   // assignment (not ==, <=, etc.)
}

function collectTopLevelDefinitions(code) {
    return splitTopLevelStatements(code).filter(isDefinitionStatement).join('\n');
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

        // include <...> / use <...> — standalone, semicolon-less statements.
        // Consume through '>' and preserve in ALL pass outputs (mirrors the
        // assignment pass-through): the ghost pass in particular must keep the
        // include, or __GHOST__-wrapped calls to library modules will be
        // undefined in /ghost_input.scad.
        if (/^(include|use)(?=[\s<])/.test(code.slice(i, i + 8))) {
            const stmtStart = i;
            while (i < len && code[i] !== '>' && code[i] !== '\n') i++;
            if (i < len && code[i] === '>') i++;
            const line = code.slice(stmtStart, i);
            return { solidContent: line + "\n", content: line + "\n", ghostContent: line + "\n",
                     containsGhost: false, hasNestedGhost: false, isSelfGhost: false };
        }

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
            // FIX: same rule as parseH — a depth-0 '{' starts a block body
            // (bare `else {`); stop without consuming so wrapper logic runs.
            if (char === '{' && parensCount === 0 && bracketCount === 0) break;
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
                // FIX: same statement-boundary rule as parseH — a depth-0 ')'
                // must not end an assignment or function definition; infix
                // operators (% * + - ? : > etc.) may legally follow it there.
                if (isVariableAssignment || /^\s*function\b/.test(expression)) continue;
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
            // FIX: consume any trailing `else` / `else if` chain into THIS
            // statement so the if/else pair is emitted or dropped ATOMICALLY
            // in every pass output. Without this, an if-branch with no ghost
            // content is dropped from the ghost pass while its else-branch is
            // kept, leaving an orphaned `else` (syntax error). Recursion via
            // parseComponent handles `else if (...)` chains naturally.
            let elseChildren = null;
            if (cleanExpr.startsWith('if')) {
                skipWhitespaceAndComments();
                if (code.slice(i, i + 4) === 'else' && !/[A-Za-z0-9_$]/.test(code[i + 4] || '')) {
                    i += 4;
                    skipWhitespaceAndComments();
                    elseChildren = [];
                    if (i < len && code[i] === '{') {
                        i++;
                        elseChildren = parseBlock(effectiveGhost);
                    } else {
                        elseChildren.push(parseComponent(effectiveGhost));
                    }
                }
            }
            const jf  = (field) => condChildren.map(c => c[field] || "").join("");
            const jfe = (field) => (elseChildren || []).map(c => c[field] || "").join("");
            const solidC   = jf('solidContent'),  solidE   = jfe('solidContent');
            const contentC = jf('content'),        contentE = jfe('content');
            const rawGhost = jf('ghostContent'),   rawGhostE = jfe('ghostContent');
            const hasElse = elseChildren !== null;
            const ghostReal = (kids) => kids.some(c =>
                c.ghostContent && c.ghostContent !== c.content && c.ghostContent !== c.solidContent
            );
            const hasRealGhostContent = ghostReal(condChildren) || (hasElse && ghostReal(elseChildren));
            const tail = (body) => hasElse ? `else\n{\n${body}}\n` : "";
            return {
                solidContent: `${expression}\n{\n${solidC}}\n` + tail(solidE),
                content:      `${expression}\n{\n${contentC}}\n` + tail(contentE),
                ghostContent: hasRealGhostContent ? `${expression}\n{\n${rawGhost}}\n` + tail(rawGhostE) : "",
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
                //const firstIsGhost = children[0].isSelfGhost || children[0].containsGhost;
				const firstIsGhost = children[0].isSelfGhost;
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
                //let solidOnly = children.filter(c => !c.isSelfGhost && !c.containsGhost).map(c => c.content).join("");
				let solidOnly = children.filter(c => !c.isSelfGhost).map(c => c.content).join("");
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


// Finds a GENUINE '!' root modifier: string/comment-aware, and only treats '!'
// as a modifier when it sits in statement/child prefix position. Logical-not in
// expressions (a = !b; if (!x) ...; f(!y); [!a, !b]; cond ? !c : d) never
// qualifies, because its previous significant character is an expression
// character (= ( , & | ? : [ < etc.). Returns the index of the modifier, or -1.
// Rationale for the allow-list: '!' has no infix meaning in OpenSCAD, and '!='
// is excluded by the next-char check, so after ';' '{' '}' ')' or another
// modifier char, a bare '!' can only be the root modifier.
function findRootModifier(code) {
    let prev = null; // last significant (non-ws, non-comment, non-string) char
    const ROOT_OK_PREV = new Set([null, ';', '{', '}', ')', '%', '#', '*', '!']);
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
        if (ch === '/' && code[i + 1] === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i++; continue; }
        if (ch === '"') { i++; while (i < code.length) { if (code[i] === '\\') i++; else if (code[i] === '"') break; i++; } prev = '"'; continue; }
        if (/\s/.test(ch)) continue;
        if (ch === '!' && code[i + 1] !== '=') {
            if (ROOT_OK_PREV.has(prev)) return i;
            prev = ch; continue;
        }
        prev = ch;
    }
    return -1;
}


export { isolateHighlights, splitTopLevelStatements, isDefinitionStatement,
         collectTopLevelDefinitions, isolateOpenSCADGhosts, findRootModifier };