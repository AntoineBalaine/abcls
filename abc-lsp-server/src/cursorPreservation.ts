/**
 * Cursor preservation helpers for transform operations.
 *
 * Provides functions to track cursor node IDs across transforms and
 * map them to positions in freshly-parsed trees for accurate highlighting.
 */

import { CSNode, TAGS, Selection } from "abcls-editor";
import { Range } from "vscode-languageserver";
import { computeNodeRange } from "abcls-editor";

/**
 * Collects all node IDs that exist in the given tree.
 */
function collectAllNodeIds(node: CSNode | null, ids: Set<number>): void {
  if (!node) return;
  ids.add(node.id);
  collectAllNodeIds(node.firstChild, ids);
  collectAllNodeIds(node.nextSibling, ids);
}

/**
 * Collects all cursor node IDs that still exist in the tree after a transform.
 * Because transforms mutate in place, cursor IDs remain stable for most operations.
 * For remove transforms, deleted node IDs are filtered out.
 */
export function collectSurvivingCursorIds(selection: Selection): number[] {
  const allIds = new Set<number>();
  collectAllNodeIds(selection.root, allIds);

  const surviving: number[] = [];
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      if (allIds.has(id)) {
        surviving.push(id);
      }
    }
  }
  return surviving;
}

/**
 * Collects all music elements (notes, chords, rests) in DFS order.
 */
function collectMusicElements(root: CSNode): CSNode[] {
  const elements: CSNode[] = [];
  function walk(node: CSNode | null): void {
    if (!node) return;
    if (node.tag === TAGS.Note || node.tag === TAGS.Chord || node.tag === TAGS.Rest) {
      elements.push(node);
    }
    walk(node.firstChild);
    walk(node.nextSibling);
  }
  walk(root);
  return elements;
}

/**
 * Maps cursor IDs from the modified tree to positions in the fresh tree.
 * Uses ordinal correspondence: the Nth music element in modified = Nth in fresh.
 * This is needed because the fresh tree has accurate token positions.
 */
export function computeCursorRangesFromFreshTree(cursorIds: number[], modifiedRoot: CSNode, freshRoot: CSNode): Range[] {
  // Build ordinal map: cursor ID -> ordinal position in modified tree
  const modifiedElements = collectMusicElements(modifiedRoot);
  const idToOrdinal = new Map<number, number>();
  modifiedElements.forEach((node, idx) => idToOrdinal.set(node.id, idx));

  // Get ordinal positions of cursor IDs
  const ordinals = cursorIds.map((id) => idToOrdinal.get(id)).filter((ord): ord is number => ord !== undefined);

  // Find corresponding nodes in fresh tree
  const freshElements = collectMusicElements(freshRoot);
  const ranges: Range[] = [];

  for (const ord of ordinals) {
    if (ord < freshElements.length) {
      const range = computeNodeRange(freshElements[ord]);
      if (range) {
        // Convert from abc-parser Range to vscode-languageserver Range
        ranges.push({
          start: { line: range.start.line, character: range.start.character },
          end: { line: range.end.line, character: range.end.character },
        });
      }
    }
  }

  return ranges;
}
