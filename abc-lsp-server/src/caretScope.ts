import { Range } from "vscode-languageserver/node";

/**
 * The selectors that work on the delimiters around a position (inside and around a chord, a grace group, an inline field or a grouping).
 * Because they need a node that sits inside the delimiters, a caret that selects no text must stand for the character under it.
 */
export const CARET_AWARE_SELECTORS: ReadonlySet<string> = new Set([
  "selectInsideChord",
  "selectAroundChord",
  "selectInsideGraceGroup",
  "selectAroundGraceGroup",
  "selectInsideInlineField",
  "selectAroundInlineField",
  "selectInsideGrouping",
  "selectAroundGrouping",
]);

/**
 * Turns every empty caret into the range of the character that follows it, and keeps the ranges that hold text as they are.
 * Because VSCodeVim draws the cursor on a character, that is the character that the user means.
 */
export function expandCarets(ranges: Range[]): Range[] {
  return ranges.map((range) => {
    const isCaret = range.start.line === range.end.line && range.start.character === range.end.character;
    if (!isCaret) return range;
    return { start: range.start, end: { line: range.end.line, character: range.end.character + 1 } };
  });
}
