import { ParsedChord } from "../music-theory/types";
import { irealTextToParsedChord, parsedChordToIrealText } from "./chordShorthand";

/**
 * iReal Pro chord-grid plain text, reduced scope.
 *
 * Covers: chord cells, "|" bar separators, "n" for N.C. (no chord), and
 * "x" for repeat-previous-bar. Section labels (*A, *B, *V), segno/coda,
 * first/second endings, and the "r" repeat-previous-two-bars shorthand
 * are not implemented in this version; see the implementation report for
 * why (grid-notation detail beyond these cases was not confirmed against
 * enough real sample data during implementation to build with confidence).
 */

export type GridToken = { type: "chord"; chord: ParsedChord } | { type: "noChord" } | { type: "repeatBar" } | { type: "bar" };

const NO_CHORD_TOKEN = "n";
const REPEAT_BAR_TOKEN = "x";

export function gridTokensToText(tokens: GridToken[]): string {
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.type === "bar") {
      parts.push("|");
    } else if (t.type === "noChord") {
      parts.push(NO_CHORD_TOKEN);
    } else if (t.type === "repeatBar") {
      parts.push(REPEAT_BAR_TOKEN);
    } else {
      parts.push(parsedChordToIrealText(t.chord));
    }
  }
  return parts.join(" ");
}

export function textToGridTokens(text: string): GridToken[] {
  const tokens: GridToken[] = [];
  // Real charts commonly open with a "[T44"-style time-signature marker
  // (the digits are the meter, e.g. "44" for 4/4, "34" for 3/4) glued
  // directly to the first chord with no separating space, e.g.
  // "[T44A-   |Bh7 E7b9 |...". Section-label handling in general is out
  // of scope for this reduced grid grammar (see the module doc comment
  // above), but silently dropping the very first chord of a chart because
  // it's glued to this marker is a real data-loss bug, not an
  // intentionally-skipped unrecognized cell, so this specific marker is
  // stripped before tokenizing rather than left to fuse with and destroy
  // the chord that follows it.
  const withoutLeadingTimeSig = text.replace(/^\[T\d{2}/, "");
  // "|" may be glued directly to an adjacent chord in real chart text
  // (e.g. "|C-7|G7|"); padding it with spaces first guarantees it always
  // splits out as its own cell below, rather than needing ad hoc
  // leading/trailing-run stripping per cell.
  const cells = withoutLeadingTimeSig
    .split("|")
    .join(" | ")
    .split(/\s+/)
    .filter((c) => c.length > 0);
  for (const cell of cells) {
    if (cell === "|") {
      tokens.push({ type: "bar" });
    } else if (cell === NO_CHORD_TOKEN) {
      tokens.push({ type: "noChord" });
    } else if (cell === REPEAT_BAR_TOKEN) {
      tokens.push({ type: "repeatBar" });
    } else {
      const chord = irealTextToParsedChord(cell);
      if (chord) {
        tokens.push({ type: "chord", chord });
      }
      // An unrecognized cell is silently skipped rather than throwing,
      // since the reduced grid grammar here does not cover every real
      // iReal Pro symbol (section labels, endings, and so on); a genuinely
      // unrecognized cell is a known scope gap, not a crash-worthy error.
    }
  }
  return tokens;
}
