import { Range } from "abcls-parser";
import type { ContainerKind } from "./containingSelectors";

/** The bar lines that close a measure, the longest first so that "|]" is not read as "|". */
const CLOSING_BAR = /^(\|\]|\|\||:\|\||::|:\||\|:|\|)/;

function lineAt(lines: string[], line: number): string {
  return lines[line] ?? "";
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** Moves the end of the range past the spaces and tabs that follow it on its last line. */
function withTrailingSpaces(range: Range, lines: string[]): Range {
  const rest = lineAt(lines, range.end.line).slice(range.end.character);
  const spaces = rest.length - rest.trimStart().length;
  return { start: range.start, end: { line: range.end.line, character: range.end.character + spaces } };
}

/** The range from the start of the line to the start of the next line, or to the end of the last line when no next line exists. */
function wholeLine(line: number, lines: string[]): Range {
  const hasNext = line + 1 < lines.length;
  const end = hasNext ? { line: line + 1, character: 0 } : { line, character: lineAt(lines, line).length };
  return { start: { line, character: 0 }, end };
}

function aroundMeasure(range: Range, lines: string[]): Range {
  const spaced = withTrailingSpaces(range, lines);
  const rest = lineAt(lines, spaced.end.line).slice(spaced.end.character);
  const bar = CLOSING_BAR.exec(rest);
  if (bar === null) return spaced;
  return { start: range.start, end: { line: spaced.end.line, character: spaced.end.character + bar[0].length } };
}

function aroundComment(range: Range, lines: string[]): Range {
  const before = lineAt(lines, range.start.line).slice(0, range.start.character);
  if (isBlank(before)) return wholeLine(range.start.line, lines);
  const kept = before.trimEnd().length;
  return { start: { line: range.start.line, character: kept }, end: range.end };
}

function aroundTune(range: Range, lines: string[]): Range {
  let line = range.end.line + 1;
  while (line < lines.length && isBlank(lineAt(lines, line))) line++;
  if (line >= lines.length) return { start: range.start, end: { line: lines.length - 1, character: lineAt(lines, lines.length - 1).length } };
  return { start: range.start, end: { line, character: 0 } };
}

/**
 * Widens the range of an element so that deleting it leaves the text tidy.
 * Because the tree keeps no whitespace, the text of the document decides how far each kind of element widens:
 * a note, a decoration, a beam or an annotation takes the spaces that follow it, a measure takes them and its closing bar line,
 * a directive and a system take their line break, a comment takes the spaces before it (or its whole line when it is alone),
 * and a tune takes the blank lines that follow it.
 *
 * @param range The range of the element, as the tree gives it
 * @param kind The kind of the element
 * @param lines The lines of the document
 */
export function extendAround(range: Range, kind: ContainerKind, lines: string[]): Range {
  if (kind === "directive") return { start: { line: range.start.line, character: 0 }, end: wholeLine(range.end.line, lines).end };
  if (kind === "system") return { start: range.start, end: wholeLine(range.end.line, lines).end };
  if (kind === "comment") return aroundComment(range, lines);
  if (kind === "measure") return aroundMeasure(range, lines);
  if (kind === "tune") return aroundTune(range, lines);
  return withTrailingSpaces(range, lines);
}
