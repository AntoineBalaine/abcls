import { CSNode, isTokenNode, TokenData, TAGS, Selection } from "abcls-editor";
import { Range, Position } from "abcls-parser";

export function findNodeById(root: CSNode, targetId: number): CSNode | null {
  if (root.id === targetId) return root;
  if (root.firstChild) {
    const found = findNodeById(root.firstChild, targetId);
    if (found) return found;
  }
  if (root.nextSibling) {
    const found = findNodeById(root.nextSibling, targetId);
    if (found) return found;
  }
  return null;
}

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

export function resolveSelectionRanges(selection: Selection): Range[] {
  const ranges: Range[] = [];

  for (const cursor of selection.cursors) {
    const id = [...cursor][0];
    const csNode = findNodeById(selection.root, id);
    if (!csNode) continue;

    const range = computeNodeRange(csNode);
    if (range) ranges.push(range);
  }

  return ranges;
}

/**
 * Computes bounding ranges for cursors that contain multiple contiguous node IDs.
 * Each cursor produces a single range spanning from the earliest start position
 * to the latest end position across all nodes in the cursor.
 */
export function resolveContiguousRanges(selection: Selection): Range[] {
  const ranges: Range[] = [];

  for (const cursor of selection.cursors) {
    let boundingRange: Range | null = null;

    for (const id of cursor) {
      const csNode = findNodeById(selection.root, id);
      if (!csNode) continue;

      const nodeRange = computeNodeRange(csNode);
      if (!nodeRange) continue;

      if (boundingRange === null) {
        boundingRange = { start: { ...nodeRange.start }, end: { ...nodeRange.end } };
      } else {
        if (
          nodeRange.start.line < boundingRange.start.line ||
          (nodeRange.start.line === boundingRange.start.line && nodeRange.start.character < boundingRange.start.character)
        ) {
          boundingRange.start = { ...nodeRange.start };
        }
        if (
          nodeRange.end.line > boundingRange.end.line ||
          (nodeRange.end.line === boundingRange.end.line && nodeRange.end.character > boundingRange.end.character)
        ) {
          boundingRange.end = { ...nodeRange.end };
        }
      }
    }

    if (boundingRange) {
      ranges.push(boundingRange);
    }
  }

  return ranges;
}

export function resolveRanges(
  params: {
    selector: string;
  },
  newSelection: Selection
) {
  return params.selector === "selectVoices" || params.selector === "selectMeasures" || params.selector === "selectSystem"
    ? resolveContiguousRanges(newSelection)
    : resolveSelectionRanges(newSelection);
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

function collectNodesInRange(node: CSNode, editorRange: Range, tags: Set<string>, result: number[]): void {
  if (tags.has(node.tag)) {
    const nodeRange = computeNodeRange(node);
    if (nodeRange && rangesOverlap(editorRange, nodeRange)) {
      result.push(node.id);
      // Because a matched node's descendants (e.g. a Chord's inner Notes) are part of
      // that node's own scope, we must not also collect them as separate selection targets.
      return;
    }
  }

  // Recurse into children
  let child = node.firstChild;
  while (child) {
    collectNodesInRange(child, editorRange, tags, result);
    child = child.nextSibling;
  }
}

export function findNodesInRange(root: CSNode, editorRange: Range, tags: string[]): number[] {
  const result: number[] = [];
  const tagSet = new Set(tags);
  collectNodesInRange(root, editorRange, tagSet, result);
  return result;
}

// Backwards compatibility
export function findNotesAndChordsInRange(root: CSNode, editorRange: Range): number[] {
  return findNodesInRange(root, editorRange, [TAGS.Note, TAGS.Chord]);
}
