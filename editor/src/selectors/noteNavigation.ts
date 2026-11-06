import { Range } from "abcls-parser";
import { CSNode, TAGS } from "../csTree/types";
import { computeNodeRange, rangeCovers } from "../utils/rangeUtils";
import { comparePositions, findByTag } from "./treeWalk";

export type NavigationDirection = "next" | "previous";

/**
 * Lists the range of every note of the tree, in the order of the document.
 * Because the notes of a chord are notes too, each of them is listed, after the chord's own start.
 */
export function collectNoteRanges(root: CSNode): Range[] {
  const ranges: Range[] = [];
  for (const note of findByTag(root, TAGS.Note)) {
    const range = computeNodeRange(note);
    if (range !== null) ranges.push(range);
  }
  return ranges;
}

/**
 * Lists the range of every chord of the tree, in the order of the document.
 */
export function collectChordRanges(root: CSNode): Range[] {
  const ranges: Range[] = [];
  for (const chord of findByTag(root, TAGS.Chord)) {
    const range = computeNodeRange(chord);
    if (range !== null) ranges.push(range);
  }
  return ranges;
}

/**
 * Lists the range of every music element that a player counts as one step, in the order of the document:
 * a chord, a note that is not part of a chord, and a rest. Because the notes of a chord belong to the chord, they are left out.
 */
export function collectElementRanges(root: CSNode): Range[] {
  const chords = collectChordRanges(root);
  const loneNotes = collectNoteRanges(root).filter((note) => !chords.some((chord) => rangeCovers(chord, note)));
  const rests: Range[] = [];
  for (const rest of findByTag(root, TAGS.Rest)) {
    const range = computeNodeRange(rest);
    if (range !== null) rests.push(range);
  }
  return [...chords, ...loneNotes, ...rests].sort((a, b) => comparePositions(a.start.line, a.start.character, b.start.line, b.start.character));
}

function isEmptyRange(range: Range): boolean {
  return comparePositions(range.start.line, range.start.character, range.end.line, range.end.character) === 0;
}

/**
 * Finds the first range that comes after the selection, or the last one that comes before it.
 * Because a caret that sits on a note must go to the note after it, and not stay on it, an empty selection looks for a candidate that
 * starts strictly after the caret. A selection that holds text looks for a candidate that starts where the selection ends or later.
 * Backward, a candidate must end where the selection starts or earlier, whether the selection is empty or not.
 *
 * @param candidates The ranges to choose from, in the order of the document
 * @param selection The current selection, possibly empty
 * @param direction The direction to look in
 * @returns The range found, or null when there is none in that direction
 */
export function findAdjacentRange(candidates: Range[], selection: Range, direction: NavigationDirection): Range | null {
  if (direction === "next") {
    const mustStartAfter = isEmptyRange(selection);
    for (const candidate of candidates) {
      const order = comparePositions(candidate.start.line, candidate.start.character, selection.end.line, selection.end.character);
      if (mustStartAfter ? order > 0 : order >= 0) return candidate;
    }
    return null;
  }

  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index];
    const order = comparePositions(candidate.end.line, candidate.end.character, selection.start.line, selection.start.character);
    if (order <= 0) return candidate;
  }
  return null;
}

/**
 * Moves each selection to the next or the previous note.
 * With a number of steps, each selection moves that many notes, and stops at the last note that exists in that direction.
 * A selection that has no note in that direction stays where it is, and two selections that reach the same note become one.
 * The result is in the order of the document.
 *
 * @param root The root of the tree of the document
 * @param selections The selections of the editor, empty ones included
 * @param direction The direction to move in
 * @param steps How many notes to move, 1 by default
 */
export function moveSelectionsToNote(root: CSNode, selections: Range[], direction: NavigationDirection, steps: number = 1): Range[] {
  return moveSelectionsAmong(collectNoteRanges(root), selections, direction, steps);
}

/**
 * Moves each selection to the next or the previous chord, with the same rules as moveSelectionsToNote.
 *
 * @param root The root of the tree of the document
 * @param selections The selections of the editor, empty ones included
 * @param direction The direction to move in
 * @param steps How many chords to move, 1 by default
 */
export function moveSelectionsToChord(root: CSNode, selections: Range[], direction: NavigationDirection, steps: number = 1): Range[] {
  return moveSelectionsAmong(collectChordRanges(root), selections, direction, steps);
}

/**
 * Moves each selection to the next or the previous chord, lone note or rest, with the same rules as moveSelectionsToNote.
 *
 * @param root The root of the tree of the document
 * @param selections The selections of the editor, empty ones included
 * @param direction The direction to move in
 * @param steps How many elements to move, 1 by default
 */
export function moveSelectionsToElement(root: CSNode, selections: Range[], direction: NavigationDirection, steps: number = 1): Range[] {
  return moveSelectionsAmong(collectElementRanges(root), selections, direction, steps);
}

/**
 * Moves each selection among the candidate ranges, which must be in the order of the document.
 * Because the notes and the chords move by the same rules, both of them share this function.
 */
export function moveSelectionsAmong(notes: Range[], selections: Range[], direction: NavigationDirection, steps: number): Range[] {
  const moved: Range[] = [];
  const seen = new Set<string>();

  for (const selection of selections) {
    let target = selection;
    for (let step = 0; step < steps; step++) {
      const adjacent = findAdjacentRange(notes, target, direction);
      if (adjacent === null) break;
      target = adjacent;
    }
    const key = `${target.start.line}:${target.start.character}:${target.end.line}:${target.end.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    moved.push(target);
  }

  return moved.sort((a, b) => comparePositions(a.start.line, a.start.character, b.start.line, b.start.character));
}
