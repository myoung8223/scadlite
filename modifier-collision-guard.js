// ============================================================================
// modifier-collision-guard.js
// ----------------------------------------------------------------------------
// Fixes the `%` / `#` collision in SCADLite's multi-pass preview pre-parser.
//
// THE PROBLEM
//   In OpenSCAD, `%` is BOTH the ghost/background modifier AND the modulo
//   operator, and `#` is BOTH the highlight modifier AND an ordinary character
//   that appears constantly inside string literals (hex colors like "#4DB58D",
//   font glyphs like "#" / "%", search("#", ...)). A text-based modifier
//   transform that treats every `%`/`#` as a modifier corrupts:
//     - modulo expressions:  column = (i) % 10;   ->  column = (i)
//     - hex color strings:   color("#4DB58D")     ->  mangled
//     - glyph/data strings:  ["%",9,[...]]         ->  mangled
//
// THE FIX (this module)
//   `maskCollisions(src)` scans the source once with real lexer awareness of
//   string literals and comments, and hides everything that must NOT be seen as
//   a modifier (string literals, comments, and modulo `%`) behind opaque
//   sentinels. It leaves GENUINE `%`/`#` modifiers in place. Your existing
//   solid/ghost/highlight transforms then run on the masked text and only ever
//   see real modifiers. `restore()` puts the originals back before the code is
//   handed to the WASM engine.
//
// USAGE
//   import { maskCollisions } from "./modifier-collision-guard.js";
//
//   const { masked, restore } = maskCollisions(rawSource);
//   const solidCode     = restore(buildSolidPass(masked));      // your existing
//   const ghostCode     = restore(buildGhostPass(masked));      // pass builders,
//   const highlightCode = restore(buildHighlightPass(masked));  // unchanged
//
//   // feed solidCode / ghostCode / highlightCode to WASM as before.
//
// A `%`/`#` is treated as a MODIFIER only when it sits in statement/child
// position: the previous significant character is `;`, `{`, `}`, start-of-file,
// or a control-flow header ( for(...) / if(...) / let(...) /
// intersection_for(...) / each(...), or a bare `else` ). Otherwise `%` is
// modulo. Every `#` outside a string/comment is a genuine modifier, because
// hex colors and `"#"` glyphs live inside string literals (already hidden).
// ============================================================================

const CONTROL_KEYWORDS = new Set(["for", "if", "let", "intersection_for", "each"]);
const BARE_CONTROL = new Set(["else"]); // control words that precede a child with no parens

const isWS = c => c === " " || c === "\t" || c === "\r" || c === "\n";
const isIdent = c =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") ||
  (c >= "0" && c <= "9") || c === "_" || c === "$";

// ---------------------------------------------------------------------------
// scanModifiers(src)
//   Diagnostic/inspection helper. Returns an array of
//   { index, line, ch: '%'|'#', role: 'modifier'|'operator'|'suspicious' }
//   for every `%`/`#` found in CODE (never inside strings or comments).
//   Useful for a debug overlay or logging; not required at runtime.
// ---------------------------------------------------------------------------
export function scanModifiers(src) {
  const results = [];
  const n = src.length;
  let i = 0, line = 1, lastSig = null, lastSigIdx = -1;

  const closesControlHeader = closeIdx => {
    let depth = 0, j = closeIdx;
    for (; j >= 0; j--) {
      const c = src[j];
      if (c === ")") depth++;
      else if (c === "(") { depth--; if (!depth) break; }
    }
    if (j < 0) return false;
    let k = j - 1;
    while (k >= 0 && isWS(src[k])) k--;
    const end = k;
    while (k >= 0 && isIdent(src[k])) k--;
    return CONTROL_KEYWORDS.has(src.slice(k + 1, end + 1));
  };
  const precedingWord = idx => {
    let k = idx;
    while (k >= 0 && isIdent(src[k])) k--;
    return src.slice(k + 1, idx + 1);
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === '"') {                                  // string literal
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === '"') { i++; break; }
        if (src[i] === "\n") line++;
        i++;
      }
      lastSig = '"'; lastSigIdx = i - 1; continue;
    }
    if (c === "/" && src[i + 1] === "/") {             // line comment
      i += 2; while (i < n && src[i] !== "\n") i++; continue;
    }
    if (c === "/" && src[i + 1] === "*") {             // block comment
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2; continue;
    }
    if (c === "%" || c === "#") {
      let role;
      if (lastSig === null || lastSig === ";" || lastSig === "{" || lastSig === "}") {
        role = "modifier";
      } else if (lastSig === ")") {
        role = closesControlHeader(lastSigIdx) ? "modifier" : (c === "#" ? "modifier" : "operator");
      } else if (isIdent(lastSig)) {
        role = BARE_CONTROL.has(precedingWord(lastSigIdx)) ? "modifier" : (c === "#" ? "suspicious" : "operator");
      } else {
        role = c === "#" ? "modifier" : "operator";
      }
      results.push({ index: i, line, ch: c, role });
      lastSig = c; lastSigIdx = i; i++; continue;
    }
    if (!isWS(c)) { lastSig = c; lastSigIdx = i; }
    i++;
  }
  return results;
}

// ---------------------------------------------------------------------------
// collectMaskSpans(src)
//   One source scan -> list of {start, end} spans to hide: every string
//   literal, every comment, and every modulo `%`. Genuine `%`/`#` modifiers
//   are deliberately left out of the list.
// ---------------------------------------------------------------------------
function collectMaskSpans(src) {
  const spans = [];
  const n = src.length;
  let i = 0, lastSig = null, lastSigIdx = -1;

  const closesControlHeader = closeIdx => {
    let depth = 0, j = closeIdx;
    for (; j >= 0; j--) {
      const c = src[j];
      if (c === ")") depth++;
      else if (c === "(") { depth--; if (!depth) break; }
    }
    if (j < 0) return false;
    let k = j - 1;
    while (k >= 0 && isWS(src[k])) k--;
    const end = k;
    while (k >= 0 && isIdent(src[k])) k--;
    return CONTROL_KEYWORDS.has(src.slice(k + 1, end + 1));
  };
  const precedingWord = idx => {
    let k = idx;
    while (k >= 0 && isIdent(src[k])) k--;
    return src.slice(k + 1, idx + 1);
  };

  while (i < n) {
    const c = src[i];
    if (c === '"') {                                  // string literal -> hide
      let j = i + 1;
      while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === '"') { j++; break; } j++; }
      spans.push({ start: i, end: j }); lastSig = '"'; lastSigIdx = i; i = j; continue;
    }
    if (c === "/" && src[i + 1] === "/") {             // line comment -> hide
      let j = i + 2; while (j < n && src[j] !== "\n") j++;
      spans.push({ start: i, end: j }); i = j; continue;
    }
    if (c === "/" && src[i + 1] === "*") {             // block comment -> hide
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      spans.push({ start: i, end: j }); i = j; continue;
    }
    if (c === "%") {
      let modifier;
      if (lastSig === null || lastSig === ";" || lastSig === "{" || lastSig === "}") modifier = true;
      else if (lastSig === ")") modifier = closesControlHeader(lastSigIdx);
      else if (isIdent(lastSig)) modifier = BARE_CONTROL.has(precedingWord(lastSigIdx));
      else modifier = false;
      if (!modifier) spans.push({ start: i, end: i + 1 }); // hide modulo %
      lastSig = "%"; lastSigIdx = i; i++; continue;
    }
    // '#' passes through: any '#' outside a string/comment is a real modifier.
    if (!isWS(c)) { lastSig = c; lastSigIdx = i; }
    i++;
  }
  return spans;
}

// ---------------------------------------------------------------------------
// maskCollisions(src) -> { masked, restore }
//   `masked` is `src` with all string literals, comments, and modulo `%`
//   replaced by opaque sentinels (U+FDD0..U+FDD1-delimited indices; these are
//   permanent Unicode noncharacters that never occur in real text). Genuine
//   `%`/`#` modifiers remain. `restore(text)` reverses the substitution and is
//   lossless. Run your existing passes on `masked`, then `restore()` each
//   pass's output before compiling.
// ---------------------------------------------------------------------------
export function maskCollisions(src) {
  const spans = collectMaskSpans(src);
  const stash = [];
  let out = "", cursor = 0;
  for (const { start, end } of spans) {
    out += src.slice(cursor, start);
    out += `\uFDD0${stash.length}\uFDD1`;
    stash.push(src.slice(start, end));
    cursor = end;
  }
  out += src.slice(cursor);
  const restore = text => text.replace(/\uFDD0(\d+)\uFDD1/g, (_, d) => stash[+d]);
  return { masked: out, restore };
}
