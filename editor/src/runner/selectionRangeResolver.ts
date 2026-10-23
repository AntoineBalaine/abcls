import { CSNode, TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { computeNodeRange, rangesOverlap } from "../utils/rangeUtils";
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
