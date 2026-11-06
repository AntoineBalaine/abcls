import { Range, Position } from "abcls-parser/types/types";
import { CSNode, isTokenNode, TokenData } from "../csTree/types";

function tokenRange(data: TokenData): Range {
  return {
    start: { line: data.line, character: data.position },
    end: { line: data.line, character: data.position + data.lexeme.length },
  };
}

function isValidTokenData(data: TokenData): boolean {
  return data.line >= 0 && data.position >= 0;
}

function firstLeafToken(node: CSNode): TokenData | null {
  if (isTokenNode(node) && isValidTokenData(node.data)) return node.data;
  let child = node.firstChild;
  while (child) {
    const found = firstLeafToken(child);
    if (found) return found;
    child = child.nextSibling;
  }
  return null;
}

function lastLeafToken(node: CSNode): TokenData | null {
  let child = node.firstChild;
  let last: TokenData | null = null;
  while (child) {
    const found = lastLeafToken(child);
    if (found) last = found;
    child = child.nextSibling;
  }
  if (last) return last;
  if (isTokenNode(node) && isValidTokenData(node.data)) return node.data;
  return null;
}

export function computeNodeRange(node: CSNode): Range | null {
  if (isTokenNode(node)) {
    if (!isValidTokenData(node.data)) return null;
    return tokenRange(node.data);
  }
  const first = firstLeafToken(node);
  const last = lastLeafToken(node);
  if (!first || !last) return null;
  const start: Position = { line: first.line, character: first.position };
  const end: Position = { line: last.line, character: last.position + last.lexeme.length };
  return { start, end };
}

export function rangesOverlap(a: Range, b: Range): boolean {
  // Check if range a ends before range b starts (no overlap)
  if (a.end.line < b.start.line) return false;
  if (a.end.line === b.start.line && a.end.character <= b.start.character) return false;

  // Check if range b ends before range a starts (no overlap)
  if (b.end.line < a.start.line) return false;
  if (b.end.line === a.start.line && b.end.character <= a.start.character) return false;

  return true;
}

/** True when the range outer contains the whole of the range inner. */
export function rangeCovers(outer: Range, inner: Range): boolean {
  const startsBefore = outer.start.line < inner.start.line || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character);
  const endsAfter = outer.end.line > inner.end.line || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character);
  return startsBefore && endsAfter;
}
