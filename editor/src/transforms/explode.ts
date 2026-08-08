import { cloneSubtree, appendChild, insertAfter, remove } from "abcls-cstree";
import { ABCContext, TT } from "abcls-parser";
import { createCSNode, CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { findByTag } from "../selectors/treeWalk";
import { consolidateRests } from "./consolidateRests";
import { groupElementsBySourceLine, collectNotesFromChord, nodeOrDescendantInSet } from "./lineUtils";
import { noteToRest, chordToRest } from "./toRest";
import { unwrapSingle } from "./unwrapSingle";

/**
 * Filters a chord to keep only the note at the specified part index.
 * Part index 0 keeps the top note (last in the array), index 1 keeps the second from top, etc.
 * If the chord has fewer notes than partIndex+1, the chord is converted to a rest.
 */
function filterChordToPart(chordNode: CSNode, partIndex: number, ctx: ABCContext): void {
  const notes = collectNotesFromChord(chordNode);
  const noteIndex = notes.length - 1 - partIndex;

  if (noteIndex < 0) {
    // The chord doesn't have enough notes for this part - convert to rest
    chordToRest(chordNode, ctx);
    return;
  }

  // Remove all notes except the one at noteIndex
  let current = chordNode.firstChild;

  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Note && current !== notes[noteIndex]) {
      remove(current);
    }

    current = next;
  }
}

/**
 * Removes grace groups from the sibling chain for parts other than part 0.
 * Grace groups ornament the top voice, so they are only kept in part 0.
 *
 * @param parent - The parent node containing the sibling chain
 * @param partIndex - The voice part index (0 = top voice)
 */
function removeGraceGroupsForLowerParts(parent: CSNode, partIndex: number): void {
  if (partIndex === 0) {
    return; // Keep grace groups for top voice
  }

  let current = parent.firstChild;

  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Grace_group) {
      remove(current);
    }

    current = next;
  }
}

/**
 * Walks the sibling chain starting from the given node and filters elements
 * based on the part index. Chords are filtered to keep only the note at the
 * part index, and standalone notes are converted to rests for parts > 0.
 * Grace groups are removed for parts > 0 (they ornament the top voice only).
 * Recurses into Beam containers.
 *
 * @param treeRoot - The root of the entire CSNode tree, needed for unwrapSingle to find parents correctly
 * @param startNode - The first node in the sibling chain to process
 * @param partIndex - The voice part index (0 = top voice)
 * @param ctx - The ABC context for generating IDs
 */
function walkAndFilter(treeRoot: CSNode, startNode: CSNode | null, partIndex: number, ctx: ABCContext): void {
  // First, remove grace groups for lower parts (must be done before note-to-rest conversion)
  removeGraceGroupsForLowerParts(treeRoot, partIndex);

  let current = startNode;

  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Chord) {
      filterChordToPart(current, partIndex, ctx);
      // If the chord now has only one note, unwrap it
      const remainingNotes = collectNotesFromChord(current);
      if (remainingNotes.length === 1 && current.tag === TAGS.Chord) {
        // Use the actual tree root so unwrapSingle can find the parent correctly
        const tempSelection: Selection = {
          root: treeRoot,
          cursors: [new Set([current.id])],
        };
        unwrapSingle(tempSelection);
      }
    } else if (current.tag === TAGS.Note) {
      if (partIndex > 0) {
        noteToRest(current, ctx);
      }
    } else if (current.tag === TAGS.Beam || current.tag === TAGS.Tuplet) {
      // Recurse into container children - also remove grace groups inside
      removeGraceGroupsForLowerParts(current, partIndex);
      walkAndFilter(treeRoot, current.firstChild, partIndex, ctx);
    }

    current = next;
  }
}

/**
 * Returns true when the node is an end-of-line Token.
 */
function isEolNode(node: CSNode): boolean {
  return isTokenNode(node) && getTokenData(node).tokenType === TT.EOL;
}

/**
 * Creates an end-of-line Token node. The line and position are -1 because the
 * token has no counterpart in the source text.
 */
function createEolNode(ctx: ABCContext): CSNode {
  return createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "\n",
    tokenType: TT.EOL,
    line: -1,
    position: -1,
  });
}

/**
 * Collects all node IDs from a sibling chain, recursing into children.
 */
export function collectSiblingIds(startNode: CSNode | null): Set<number> {
  const ids = new Set<number>();
  let current = startNode;
  while (current !== null) {
    ids.add(current.id);
    if (current.firstChild) {
      for (const childId of collectSiblingIds(current.firstChild)) {
        ids.add(childId);
      }
    }
    current = current.nextSibling;
  }
  return ids;
}

/**
 * Explodes a selection into multiple voice parts.
 * Creates partCount copies of the selected line(s), where each copy contains
 * only the notes belonging to that voice part:
 * - Part 0: top notes of chords + standalone notes
 * - Part 1: second-from-top notes of chords, rests for standalone notes
 * - Part N: Nth-from-top notes of chords, rests for standalone notes
 *
 * The original line is preserved, and new lines are inserted after it.
 * Consecutive rests in each created line are consolidated.
 *
 * Because a document may contain several tunes, the selection is resolved against
 * every tune body that holds a selected node, and each such tune is exploded
 * independently. A selection spanning two tunes therefore produces created lines
 * in both of them.
 *
 * Returns a new Selection where each cursor contains all element IDs
 * from one created line (in document order).
 */
export function explode(selection: Selection, partCount: number, ctx: ABCContext): Selection {
  if (partCount < 1) {
    return selection;
  }

  // Flatten all cursor sets into a single Set of selected node IDs
  const selectedIds = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      selectedIds.add(id);
    }
  }

  if (selectedIds.size === 0) {
    return selection;
  }

  // Keep only the tune bodies that contain a selected node. Because a document may hold
  // several tunes, we cannot assume the selection lives in the first one.
  // nodeOrDescendantInSet stops at the first matching ID inside a body.
  const retainedBodies = findByTag(selection.root, TAGS.Tune_Body).filter((body) => nodeOrDescendantInSet(body, selectedIds));

  if (retainedBodies.length === 0) {
    return selection;
  }

  // Accumulate cursors for each created line
  const createdLineCursors: Set<number>[] = [];

  // Process the bodies from last to first, for the same reason we process lines from last
  // to first: an insertion must not shift the position of content not yet processed.
  for (let bodyIndex = retainedBodies.length - 1; bodyIndex >= 0; bodyIndex--) {
    const tuneBody = retainedBodies[bodyIndex];

    // Group Tune_Body children by their source line number
    const elementsByLine = groupElementsBySourceLine(tuneBody);

    // Find which source lines contain selected nodes
    const linesWithSelection = new Set<number>();
    for (const [lineNum, elements] of elementsByLine) {
      for (const elem of elements) {
        if (nodeOrDescendantInSet(elem, selectedIds)) {
          linesWithSelection.add(lineNum);
          break;
        }
      }
    }

    // Sort line numbers in descending order to process from end to start
    const sortedLines = Array.from(linesWithSelection).sort((a, b) => b - a);

    // Process each line that has selections
    for (const lineNum of sortedLines) {
      const elements = elementsByLine.get(lineNum);
      if (!elements || elements.length === 0) continue;

      // In every tune but the last one, the newline that terminates the line is not part
      // of the tune body, so the line's last element is not an EOL. Each created line must
      // then open its own line, otherwise the clones are appended onto the original line.
      const lastOriginal = elements[elements.length - 1];
      const lineEndsWithEol = isEolNode(lastOriginal);

      // Create partCount copies, from last to first (so they end up in order)
      for (let partIndex = partCount - 1; partIndex >= 0; partIndex--) {
        // Clone all elements on this line using cloneSubtree to avoid stale parentRefs
        const clonedElements: CSNode[] = elements.map((e) => cloneSubtree(e, () => ctx.generateId()));

        // Create a System node to hold the cloned chain during processing.
        // This allows unwrapSingle to find the parent of chords correctly.
        const systemNode = createCSNode(TAGS.System, ctx.generateId(), null);
        for (const cloned of clonedElements) {
          appendChild(systemNode, cloned);
        }

        // Walk and filter the cloned elements
        walkAndFilter(systemNode, systemNode.firstChild, partIndex, ctx);

        // Consolidate consecutive rests in the processed chain
        const allIds = collectSiblingIds(systemNode.firstChild);
        const lineSelection: Selection = { root: systemNode, cursors: [allIds] };
        consolidateRests(lineSelection, ctx);

        // After consolidation, allIds has been updated (consumed IDs removed)
        createdLineCursors.push(allIds);

        // Insert the processed chain after the last original element on this line.
        // Detach each node from systemNode and insert after lastOriginal.
        let insertAnchor: CSNode = lastOriginal;

        // When the original line carried no EOL, the clone carries none either. We open a
        // new line ahead of the clone rather than terminating it, because the newline that
        // closes the last created line already sits outside the tune body.
        if (!lineEndsWithEol) {
          const eol = createEolNode(ctx);
          insertAfter(insertAnchor, eol);
          insertAnchor = eol;
        }

        let toMove = systemNode.firstChild;
        while (toMove !== null) {
          const next = toMove.nextSibling;
          remove(toMove);
          insertAfter(insertAnchor, toMove);
          insertAnchor = toMove;
          toMove = next;
        }
      }
    }
  }

  // Reverse cursors to match document order (we processed lines and parts in reverse)
  createdLineCursors.reverse();

  return { root: selection.root, cursors: createdLineCursors };
}

/**
 * Explodes a selection into 2 voice parts.
 */
export function explode2(selection: Selection, ctx: ABCContext): Selection {
  return explode(selection, 2, ctx);
}

/**
 * Explodes a selection into 3 voice parts.
 */
export function explode3(selection: Selection, ctx: ABCContext): Selection {
  return explode(selection, 3, ctx);
}

/**
 * Explodes a selection into 4 voice parts.
 */
export function explode4(selection: Selection, ctx: ABCContext): Selection {
  return explode(selection, 4, ctx);
}
