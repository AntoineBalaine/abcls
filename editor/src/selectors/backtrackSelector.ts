import { TT } from "abcls-parser";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { isChordSymbolText, scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { buildIdMap } from "./treeWalk";

export interface ChordSymbolMatch {
  node: CSNode;
  parsed: ParsedChord;
}

/**
 * Collects all nodes before the target node in depth-first traversal order.
 */
function collectNodesBefore(root: CSNode, target: CSNode): CSNode[] {
  const result: CSNode[] = [];
  walkAndCollect(root, target, result);
  return result;
}

function walkAndCollect(node: CSNode | null, target: CSNode, result: CSNode[]): boolean {
  let current = node;
  while (current !== null) {
    if (current === target) return true; // Found target, stop collecting

    result.push(current);

    // Recurse into children (depth-first)
    if (current.firstChild && walkAndCollect(current.firstChild, target, result)) {
      return true;
    }
    current = current.nextSibling;
  }
  return false;
}

/**
 * Extracts chord text from an Annotation or ChordSymbol node.
 * Returns null if the node does not contain valid text.
 */
function extractChordText(node: CSNode): string | null {
  if (node.tag === TAGS.ChordSymbol) {
    const firstChild = node.firstChild;
    if (firstChild === null) return null;
    if (!isTokenNode(firstChild)) return null;
    return getTokenData(firstChild).lexeme;
  }

  if (node.tag === TAGS.Annotation) {
    const firstChild = node.firstChild;
    if (firstChild === null) return null;
    if (!isTokenNode(firstChild)) return null;
    let text = getTokenData(firstChild).lexeme;
    // Strip surrounding double quotes
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1);
    }
    return text;
  }

  return null;
}

/**
 * Checks if a node is an EOL token.
 */
function isEOL(node: CSNode): boolean {
  if (!isTokenNode(node)) return false;
  const data = getTokenData(node);
  return data.tokenType === TT.EOL;
}

/**
 * Finds the first cursor's target node from the selection.
 */
function findTargetNode(selection: Selection): CSNode | null {
  if (selection.cursors.length === 0) return null;
  const cursor = selection.cursors[0];
  if (cursor.size === 0) return null;

  const idMap = buildIdMap(selection.root);
  const firstId = cursor.values().next().value as number;
  if (firstId === undefined) return null;
  return idMap.get(firstId) ?? null;
}

/**
 * Searches backward from the current selection to find the most recent
 * chord symbol (Annotation or ChordSymbol node with valid chord notation).
 *
 * @param selection The current selection
 * @param samePhysicalLine If true, stop at EOL tokens (physical line breaks)
 * @returns The chord match or null if not found
 */
export function selectPreviousChordSymbol(selection: Selection, samePhysicalLine: boolean = true): ChordSymbolMatch | null {
  const targetNode = findTargetNode(selection);
  if (targetNode === null) return null;

  // Collect all nodes before target in depth-first traversal order
  const nodesBeforeTarget = collectNodesBefore(selection.root, targetNode);

  // Reverse iterate to find chord symbol
  for (let i = nodesBeforeTarget.length - 1; i >= 0; i--) {
    const node = nodesBeforeTarget[i];

    // If samePhysicalLine is true, stop at line boundaries
    if (samePhysicalLine && isEOL(node)) {
      return null;
    }

    // Check if node is an Annotation or ChordSymbol
    if (node.tag === TAGS.Annotation || node.tag === TAGS.ChordSymbol) {
      const text = extractChordText(node);
      if (text === null) continue;

      if (!isChordSymbolText(text)) continue;

      const scanResult = scanChordSymbol(text);
      if (scanResult === null) continue;

      const parsed = parseChordSymbol(scanResult.tokens);
      if (parsed !== null) {
        return { node, parsed };
      }
    }
  }

  return null;
}
