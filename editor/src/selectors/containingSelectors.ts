import { Range } from "abcls-parser";
import { CSNode, TAGS } from "../csTree/types";
import { resolveContiguousRanges, resolveSelectionRanges } from "../runner/selectionRangeResolver";
import { createSelection } from "../selection";
import { computeNodeRange, rangesOverlap } from "../utils/rangeUtils";
import { extendAround } from "./aroundExtension";
import { selectMeasures } from "./measureSelector";
import { selectSystem } from "./systemSelector";
import { comparePositions, findByTag } from "./treeWalk";
import { selectNotes } from "./typeSelectors";

export type ContainerKind = "note" | "annotation" | "decoration" | "beam" | "directive" | "comment" | "measure" | "system" | "tune";

/** The kinds that are one node of the tree each, with the tag of that node. */
const NODE_KIND_TAGS: Partial<Record<ContainerKind, TAGS>> = {
  tune: TAGS.Tune,
  annotation: TAGS.Annotation,
  decoration: TAGS.Decoration,
  beam: TAGS.Beam,
  directive: TAGS.Directive,
  comment: TAGS.Comment,
};

/** The kinds that run to the end of their line, where a caret at the end still belongs to them. */
const LINE_KINDS: ContainerKind[] = ["measure", "system", "directive", "comment"];

/**
 * Lists the ranges of every element of a kind in the whole document, in the order of the document.
 * A note is one range, and a measure or a system is the single range from its first element to its last one.
 */
export function collectContainerRanges(root: CSNode, kind: ContainerKind): Range[] {
  const tag = NODE_KIND_TAGS[kind];
  if (tag !== undefined) {
    const ranges: Range[] = [];
    for (const node of findByTag(root, tag)) {
      const range = computeNodeRange(node);
      if (range !== null) ranges.push(range);
    }
    return ranges;
  }
  const whole = createSelection(root);
  if (kind === "note") return resolveSelectionRanges(selectNotes(whole));
  if (kind === "measure") return resolveContiguousRanges(selectMeasures(whole));
  return resolveContiguousRanges(selectSystem(whole));
}

function isEmptyRange(range: Range): boolean {
  return comparePositions(range.start.line, range.start.character, range.end.line, range.end.character) === 0;
}

/**
 * Tells whether a range contains a point. A note ends before its last character's right edge, so a caret that sits right after a note
 * is not in it. A measure or a system, on the other hand, holds a caret that sits at its end, on the bar line that closes it.
 */
function containsPoint(range: Range, point: { line: number; character: number }, endIsInside: boolean): boolean {
  const afterStart = comparePositions(point.line, point.character, range.start.line, range.start.character) >= 0;
  const order = comparePositions(point.line, point.character, range.end.line, range.end.character);
  return afterStart && (endIsInside ? order <= 0 : order < 0);
}

/**
 * Selects the element of a kind that holds each selection.
 * A caret selects the one element that contains it, so a caret inside a chord selects the note under it, and a caret in the middle
 * of a bar selects that measure. A selection that holds text selects every element that it overlaps, in the order of the document.
 * A selection that no element holds selects nothing.
 *
 * @param root The root of the tree of the document
 * @param selections The selections of the editor, empty carets included
 * @param kind The kind of element to select
 * @param lines When given, each element widens to its "around" range, which needs the text of the document
 */
export function selectContaining(root: CSNode, selections: Range[], kind: ContainerKind, lines?: string[]): Range[] {
  const candidates = collectContainerRanges(root, kind);
  const endIsInside = LINE_KINDS.includes(kind);
  const chosen: Range[] = [];
  const seen = new Set<string>();

  for (const selection of selections) {
    for (const candidate of candidates) {
      const isHit = isEmptyRange(selection) ? containsPoint(candidate, selection.start, endIsInside) : rangesOverlap(selection, candidate);
      if (!isHit) continue;
      const key = `${candidate.start.line}:${candidate.start.character}:${candidate.end.line}:${candidate.end.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        chosen.push(candidate);
      }
      // Because a caret sits in one element, the first one that holds it is the one.
      if (isEmptyRange(selection)) break;
    }
  }

  const result = lines === undefined ? chosen : chosen.map((range) => extendAround(range, kind, lines));
  return result.sort((a, b) => comparePositions(a.start.line, a.start.character, b.start.line, b.start.character));
}
