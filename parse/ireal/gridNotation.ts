import { ParsedChord } from "../music-theory/types";
import { irealTextToParsedChord, parsedChordToIrealText } from "./chordShorthand";
import { cleanGridText } from "./gridAnnotations";

/**
 * iReal Pro chord-grid plain text.
 *
 * textToGridTokens's own cell grammar covers only chord cells, "|" bar
 * separators, "n" for N.C. (no chord), and "x" for repeat-previous-bar —
 * but it runs the input through gridAnnotations.ts's cleanGridText first,
 * which resolves everything else real charts commonly carry (section
 * labels, time signatures, comments, alternative chords, fermata, the
 * "small" annotation, hold/sustain comma padding, segno/coda jumps, and
 * simple or first/second-ending repeat sections) down into that reduced
 * grammar. The "r" repeat-previous-two-bars shorthand is still not
 * implemented.
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
  const cleaned = cleanGridText(text);
  // "|" may be glued directly to an adjacent chord in real chart text
  // (e.g. "|C-7|G7|"); padding it with spaces first guarantees it always
  // splits out as its own cell below, rather than needing ad hoc
  // leading/trailing-run stripping per cell.
  const cells = cleaned
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
