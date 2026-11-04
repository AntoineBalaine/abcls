import { remove } from "abcls-cstree";
import { ABCContext, addRational, equalRational } from "abcls-parser";
import { CSNode, TAGS, isNote, isChord, isBarLine, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { isVoiceMarker } from "../selectors/voiceSelector";
import { isPowerOfTwoRational, nextMeaningfulSibling } from "./consolidationUtils";
import { getNodeRhythm, rationalToRhythm } from "./rhythm";
import { replaceRhythm, findTieChild, findChildByTag } from "./treeUtils";

/**
 * Extracts the pitch lexeme string from a Note node.
 * The lexeme includes the note letter, accidental, and octave markers.
 * Example outputs: "C,", "^F", "_B'".
 * Returns null if pitch cannot be extracted.
 */
function getPitchLexeme(noteNode: CSNode): string | null {
  const pitchNode = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchNode) return null;

  let lexeme = "";
  let current = pitchNode.firstChild;
  while (current !== null) {
    if (isTokenNode(current)) {
      lexeme += getTokenData(current).lexeme;
    }
    current = current.nextSibling;
  }
  return lexeme || null;
}

/**
 * Checks if a Note or Chord node has a tie token.
 */
function hasTie(node: CSNode): boolean {
  return findTieChild(node) !== null;
}

/**
 * Checks if two notes have identical pitch (same letter, accidental, octave).
 */
export function samePitch(a: CSNode, b: CSNode): boolean {
  const pitchA = getPitchLexeme(a);
  const pitchB = getPitchLexeme(b);
  return pitchA !== null && pitchB !== null && pitchA === pitchB;
}

/**
 * Extracts pitch lexemes for all notes in a chord.
 * Returns sorted array of pitch lexeme strings.
 */
function getChordPitchLexemes(chordNode: CSNode): string[] {
  const lexemes: string[] = [];
  let child = chordNode.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.Note) {
      const lexeme = getPitchLexeme(child);
      if (lexeme) {
        lexemes.push(lexeme);
      }
    }
    child = child.nextSibling;
  }
  return lexemes.sort();
}

/**
 * Checks if two chords have identical pitch content.
 */
export function sameChordPitches(a: CSNode, b: CSNode): boolean {
  const pitchesA = getChordPitchLexemes(a);
  const pitchesB = getChordPitchLexemes(b);
  if (pitchesA.length !== pitchesB.length) return false;
  for (let i = 0; i < pitchesA.length; i++) {
    if (pitchesA[i] !== pitchesB[i]) return false;
  }
  return true;
}

/**
 * Removes the tie token from a node (Note or Chord).
 */
function removeTie(node: CSNode): void {
  const tieNode = findTieChild(node);
  if (tieNode) {
    remove(tieNode);
  }
}

/**
 * Collects nodes from the tree that match the specified IDs.
 * Recursively descends into all container nodes.
 *
 * The traversal is left-to-right, depth-first, which produces document order.
 * This ordering is critical for the consolidation pass to work correctly.
 */
function collectSelectedNodes(startNode: CSNode | null, selectedIds: Set<number>, result: CSNode[]): void {
  let current = startNode;
  while (current !== null) {
    if (selectedIds.has(current.id)) {
      result.push(current);
    }
    // Descend into all container nodes to find selected children
    if (current.firstChild !== null) {
      collectSelectedNodes(current.firstChild, selectedIds, result);
    }
    current = current.nextSibling;
  }
}

/**
 * Splits nodes into groups separated by bar lines.
 */
function splitByBarLines(nodes: CSNode[]): CSNode[][] {
  const bars: CSNode[][] = [];
  let currentBar: CSNode[] = [];

  for (const node of nodes) {
    if (isBarLine(node)) {
      if (currentBar.length > 0) {
        bars.push(currentBar);
        currentBar = [];
      }
    } else {
      currentBar.push(node);
    }
  }

  if (currentBar.length > 0) {
    bars.push(currentBar);
  }

  return bars;
}

/**
 * Performs a single pass of tied note consolidation within one bar.
 * Returns true if any consolidation was performed.
 *
 * Consolidation only occurs between adjacent notes/chords in the sibling chain.
 * Grace notes and other elements between tied notes prevent consolidation because
 * `nextMeaningfulSibling` will return the grace group, not the next note.
 */
function consolidateBarPass(barNodes: CSNode[], consumedIds: Set<number>, ctx: ABCContext, root: CSNode, cursor: Set<number>): boolean {
  let changed = false;

  for (const node of barNodes) {
    if (consumedIds.has(node.id)) continue;
    if (!isNote(node) && !isChord(node)) continue;
    if (!hasTie(node)) continue;

    const rhythm1 = getNodeRhythm(node);
    const next = nextMeaningfulSibling(node);

    if (next === null) continue;
    if (isBarLine(next) || isVoiceMarker(next)) continue;

    // Check if next is the same type and has same pitch content
    if (isNote(node) && isNote(next)) {
      if (!samePitch(node, next)) continue;
    } else if (isChord(node) && isChord(next)) {
      if (!sameChordPitches(node, next)) continue;
    } else {
      continue; // Different types, cannot consolidate
    }

    const rhythm2 = getNodeRhythm(next);
    if (!equalRational(rhythm1, rhythm2)) continue;

    const summed = addRational(rhythm1, rhythm2);
    if (!isPowerOfTwoRational(summed)) continue;

    // Perform the consolidation
    const newRhythm = rationalToRhythm(summed, ctx);
    replaceRhythm(node, newRhythm);

    // Transfer tie status from second note to first:
    // - If next has a tie (C-C-), the consolidated note should keep the tie (C2-)
    // - If next has no tie (C-C), remove the tie from node (C2)
    // This ensures tie chains are preserved correctly after consolidation.
    if (hasTie(next)) {
      // Because the second note has a tie, the chain continues, so we preserve the tie on node.
    } else {
      // Because the chain ends here, we remove the tie from node.
      removeTie(node);
    }

    // Remove the next node from the tree
    remove(next);

    consumedIds.add(next.id);
    cursor.delete(next.id);
    changed = true;
  }

  return changed;
}

/**
 * Consolidates tied notes with identical pitch within each bar.
 *
 * This function finds consecutive tied notes (or chords) with the same pitch
 * and equal power-of-two durations, combining them into a single note with
 * summed duration. The consolidation respects bar boundaries: ties that cross
 * bar lines are preserved, but consolidation only happens within a bar.
 *
 * The transform is idempotent: it loops until no more consolidations are possible.
 */
export function consolidateTiedNotes(selection: Selection, ctx: ABCContext): Selection {
  const consumedIds = new Set<number>();

  for (const cursor of selection.cursors) {
    // Collect all selected nodes in document order
    const nodes: CSNode[] = [];
    collectSelectedNodes(selection.root.firstChild, cursor, nodes);

    // Split into bars
    const bars = splitByBarLines(nodes);

    // Consolidate each bar until no changes
    for (const barNodes of bars) {
      let changed = true;
      while (changed) {
        changed = consolidateBarPass(barNodes, consumedIds, ctx, selection.root, cursor);
      }
    }
  }

  return selection;
}
