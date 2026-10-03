/**
 * Cleans and flattens iReal Pro grid-notation constructs that
 * gridNotation.ts's basic cell tokenizer does not understand on its
 * own: section labels, time signatures, comments, alternative chords,
 * fermata, the "small" quality annotation, hold/sustain comma padding,
 * segno/coda jumps, and simple or first/second-ending repeat sections
 * (the "{...}" / "{...N1...}...N2..." bracket forms).
 *
 * Before this module existed, a cell using any of these constructs was
 * silently dropped by textToGridTokens's "unrecognized cell" policy —
 * fine for an isolated unrecognized symbol, but when an entire bar's
 * only chord was glued to a section label (e.g. "{*AT44D9,"), dropping
 * it left that bar (and any later "repeat previous bar" cell pointing
 * at it) completely empty. This module resolves those constructs into
 * plain chord/bar/repeat text first, so textToGridTokens only ever sees
 * the reduced grammar it already handles.
 *
 * Reimplemented from understanding of the protocol gained by
 * cross-referencing multiple independent open-source iReal Pro parsers
 * (notably drs251/pyRealParser and sciurius/perl-Data-iRealPro), not
 * copied from either's source.
 */

// Section-grouping brackets carry no information our grid grammar needs
// beyond the bar boundary they also represent.
function bracketsToBars(text: string): string {
  return text.replace(/[[\]]/g, "|");
}

function removeComments(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

// "Also play" alternative chords in parentheses — out of scope here;
// the primary chord outside the parentheses is kept.
function removeAlternativeChords(text: string): string {
  return text.replace(/\([^)]*\)/g, "");
}

function removeSectionLabels(text: string): string {
  return text.replace(/\*\w/g, "");
}

// Time signature markers, e.g. "T44" for 4/4 — can appear glued to any
// chord in the chart, not just the first (gridNotation.ts used to strip
// only a leading one for this reason).
function removeTimeSignatures(text: string): string {
  return text.replace(/T\d\d/g, "");
}

function removeFermata(text: string): string {
  return text.replace(/f/g, "");
}

// A stray formatting/layout annotation letter, except when it's part of
// an altered-dominant chord's "alt" suffix.
function removeLayoutMarker(text: string): string {
  return text.replace(/(?<!a)l(?!t)/g, "");
}

// The "small" (cue-size) chord annotation, except when it's part of a
// "sus" chord quality.
function removeSmallMarker(text: string): string {
  return text.replace(/(?<!su)s(?!us)/g, "");
}

// Hold/sustain padding inside a cell (e.g. "D9,   ") — treated as
// whitespace, same as the spaces it already sits beside.
function commasToSpaces(text: string): string {
  return text.replace(/,/g, " ");
}

function removeAnnotations(text: string): string {
  let s = text;
  s = bracketsToBars(s);
  s = removeComments(s);
  s = removeAlternativeChords(s);
  s = removeFermata(s);
  s = removeLayoutMarker(s);
  s = removeSmallMarker(s);
  s = removeSectionLabels(s);
  s = removeTimeSignatures(s);
  s = commasToSpaces(s);
  return s;
}

// Part/segno/coda/ending-number markers, once any repeat or coda
// structure referencing them has already been resolved into plain text.
function removePartMarkers(text: string): string {
  return text.replace(/U|S|Q|N\d/g, "");
}

/**
 * Flattens the first "{...}" repeat section found in the text — with or
 * without first/second (or further) numbered endings — into literal
 * repeated chord text, and returns the result, or null if there is no
 * "{...}" section left to flatten.
 */
function fillOneRepeat(text: string): string | null {
  const openIndex = text.indexOf("{");
  if (openIndex === -1) return null;
  const closeIndex = text.indexOf("}", openIndex);
  if (closeIndex === -1) return null;

  const inside = text.slice(openIndex + 1, closeIndex);
  const before = text.slice(0, openIndex);
  const after = text.slice(closeIndex + 1);

  // A repeat section at the very start of the chart (nothing before the
  // "{") needs no separating bar of its own — the first real bar inside
  // the brackets already is the chart's first bar; likewise if `before`
  // already ends in a bar, adding another would just create an empty one.
  const leadingBar = /^\s*$/.test(before) || /\|\s*$/.test(before) ? "" : "|";

  const firstEndingMatch = inside.match(/N\d/);
  if (!firstEndingMatch) {
    // A simple repeat section (no endings): play it, then play it again.
    const repeated = removePartMarkers(inside);
    return `${before}${leadingBar}${inside}|${repeated}${after}`;
  }

  // First/second(/third/...) ending repeat: everything up to the first
  // "N<digit>" marker is common material, played before every ending;
  // everything from that marker to "}" is the first ending's own tail.
  // Each later "N<digit>" marker found after the bracket (iReal Pro
  // writes later endings outside the original braces) marks where that
  // ending's own material begins, and needs the common material
  // reinserted immediately before it.
  const n1Index = inside.indexOf(firstEndingMatch[0]);
  const common = removePartMarkers(inside.slice(0, n1Index));
  const firstEndingTail = inside.slice(n1Index + firstEndingMatch[0].length);
  const withFirstEnding = `${before}${leadingBar}${common}${firstEndingTail}${after}`;
  return withFirstEnding.replace(/\|\s*N\d/g, (m) => `|${common}${m.slice(m.indexOf("N"))}`);
}

function fillRepeats(text: string): string {
  let current = text;
  // Each fill can reveal a subsequent "{...}" (e.g. a repeat nested
  // after another in the same chart), and a malformed/unbalanced input
  // (an unmatched "{" with no "}") must not loop forever — bounded by a
  // generous iteration count rather than real-world repeat sections,
  // which are never anywhere close to this deep.
  for (let i = 0; i < 20; i++) {
    const next = fillOneRepeat(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

/**
 * Flattens D.C./D.S.-al-Coda jump structure, marked by one or two "Q"
 * (coda) characters and an optional "S" (segno):
 *   - No "Q": nothing to do.
 *   - One "Q": marks a simple outro/tag; the marker itself carries no
 *     further structure once the chart has been read start to finish,
 *     so it's just removed.
 *   - Two "Q"s: play from the segno (or the start, if there's no "S")
 *     through the first "Q", then jump straight to whatever follows the
 *     second "Q" — the material between the two "Q"s is never played.
 */
function fillCodas(text: string): string {
  const qPositions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "Q") qPositions.push(i);
  }
  if (qPositions.length === 0) return text;
  if (qPositions.length === 1) return text.replace(/Q/g, "");

  const [q1, q2] = qPositions;
  const segnoIndex = text.indexOf("S");
  const repeat = text.slice(segnoIndex === -1 ? 0 : segnoIndex + 1, q1);
  const coda = text.slice(q2 + 1);
  const flattened = `${text.slice(0, q2)}${repeat}|${coda}`;
  return flattened.replace(/[QS]/g, "");
}

/**
 * Cleans and flattens the repeat/coda/annotation structure a chart's raw
 * (unscrambled) grid text carries beyond gridNotation.ts's basic cell
 * grammar, so textToGridTokens only ever sees chords, bar separators,
 * "n" (no chord), and "x" (repeat previous bar).
 */
export function cleanGridText(text: string): string {
  let s = removeAnnotations(text);
  s = fillRepeats(s);
  // A "{" with no matching "}" anywhere in the chart (confirmed against
  // a real chart in a user's library backup — not a hypothetical) is
  // left untouched by fillRepeats, since there's no well-formed section
  // to flatten. Left as a literal character, it glues onto whatever
  // chord follows and silently breaks that chord's parsing; treating any
  // brace fillRepeats didn't consume as a plain bar separator instead
  // (same fallback-safety idea as bracketsToBars for "[" "]") avoids
  // inventing a repeat structure that was never properly closed, while
  // still freeing the chord it was glued to.
  s = s.replace(/[{}]/g, "|");
  s = fillCodas(s);
  s = removePartMarkers(s);
  s = s.replace(/Z/g, ""); // end-of-song marker
  // Flattening a repeat/coda section can leave a run of two or more bar
  // separators with nothing but whitespace between them — collapse any
  // such run down to one real bar.
  s = s.replace(/(\|\s*){2,}/g, "|");
  return s;
}
