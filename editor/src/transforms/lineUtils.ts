import { ABCContext, TT } from "abcls-parser";
import { createCSNode, CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { findByTag, findFirstByTag } from "../selectors/treeWalk";

/**
 * Recursively collects elements from a container node into a line number map.
 * Recurses into System nodes because tune body content is wrapped in System wrapper nodes.
 */
function collectElementsByLine(parent: CSNode, result: Map<number, CSNode[]>): void {
  let current = parent.firstChild;
  while (current !== null) {
    // Recurse into System nodes to find actual content
    if (current.tag === TAGS.System) {
      collectElementsByLine(current, result);
    } else {
      const lineNum = getSourceLineNumber(current);
      if (lineNum !== -1) {
        if (!result.has(lineNum)) {
          result.set(lineNum, []);
        }
        result.get(lineNum)!.push(current);
      }
    }
    current = current.nextSibling;
  }
}

/**
 * Groups tune body elements by their source line number.
 * Recurses into System nodes because tune body content may be wrapped in System wrapper nodes.
 */
export function groupElementsBySourceLine(tuneBody: CSNode): Map<number, CSNode[]> {
  const result = new Map<number, CSNode[]>();
  collectElementsByLine(tuneBody, result);
  return result;
}

/**
 * Gets the source line number of a node by finding the first token in its subtree.
 * Returns -1 if no token found.
 */
export function getSourceLineNumber(node: CSNode): number {
  if (isTokenNode(node)) {
    return getTokenData(node).line;
  }

  let child = node.firstChild;
  while (child !== null) {
    const lineNum = getSourceLineNumber(child);
    if (lineNum !== -1) {
      return lineNum;
    }
    child = child.nextSibling;
  }

  return -1;
}

/**
 * Recursively reassigns fresh IDs to all nodes in the subtree.
 */
export function reassignIds(node: CSNode, ctx: ABCContext): void {
  node.id = ctx.generateId();
  let child = node.firstChild;
  while (child !== null) {
    reassignIds(child, ctx);
    child = child.nextSibling;
  }
}

/**
 * Finds the Tune_Body in the tree.
 *
 * Because this returns the first Tune_Body in document order, it is only correct for a
 * document holding a single tune. A transform driven by a selection must instead resolve
 * the tune that holds the selection, using findTunesWithSelection.
 */
export function findTuneBody(root: CSNode): CSNode | null {
  return findFirstByTag(root, TAGS.Tune_Body);
}

/**
 * Returns the tunes that contain at least one of the given node IDs, in document order.
 * Because nodeOrDescendantInSet stops at the first match, a tune holding no selected node
 * is discarded without its subtree being walked in full.
 */
export function findTunesWithSelection(root: CSNode, selectedIds: Set<number>): CSNode[] {
  return findByTag(root, TAGS.Tune).filter((tune) => nodeOrDescendantInSet(tune, selectedIds));
}

/**
 * Finds the Tune_header of a single tune.
 */
export function findHeaderOfTune(tune: CSNode): CSNode | null {
  return findFirstByTag(tune, TAGS.Tune_header);
}

/**
 * Finds the Tune_Body of a single tune.
 */
export function findBodyOfTune(tune: CSNode): CSNode | null {
  return findFirstByTag(tune, TAGS.Tune_Body);
}

/**
 * Returns true when the node is an end-of-line Token.
 */
export function isEolNode(node: CSNode): boolean {
  return isTokenNode(node) && getTokenData(node).tokenType === TT.EOL;
}

/**
 * Creates an end-of-line Token node. The line and position are -1 because the token has no
 * counterpart in the source text.
 */
export function createEolNode(ctx: ABCContext): CSNode {
  return createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "\n",
    tokenType: TT.EOL,
    line: -1,
    position: -1,
  });
}

/**
 * Finds the target note/chord/rest that a grace group ornaments,
 * skipping over intermediate elements (decorations, annotations, etc.).
 */
export function findTargetNote(graceGroup: CSNode): CSNode | null {
  let current = graceGroup.nextSibling;

  while (current !== null) {
    // Found a note, chord, or rest - this is the target
    if (current.tag === TAGS.Note || current.tag === TAGS.Chord || current.tag === TAGS.Rest) {
      return current;
    }

    // Skip over intermediate elements that can appear between grace and target
    if (
      current.tag === TAGS.Decoration ||
      current.tag === TAGS.Annotation ||
      current.tag === TAGS.ChordSymbol ||
      current.tag === TAGS.Inline_field ||
      current.tag === TAGS.Token
    ) {
      current = current.nextSibling;
      continue;
    }

    // Hit a structural element (BarLine, Beam, Tuplet, etc.) - no target found
    return null;
  }

  return null;
}

/**
 * Recursively checks if a node or any of its descendants has an ID in the given set.
 */
export function nodeOrDescendantInSet(node: CSNode, ids: Set<number>): boolean {
  if (ids.has(node.id)) {
    return true;
  }
  let child = node.firstChild;
  while (child !== null) {
    if (nodeOrDescendantInSet(child, ids)) {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

/**
 * Collects all Note children from a chord node.
 */
export function collectNotesFromChord(chordNode: CSNode): CSNode[] {
  const notes: CSNode[] = [];
  let child = chordNode.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.Note) {
      notes.push(child);
    }
    child = child.nextSibling;
  }
  return notes;
}
