import { collectChildren, getParent, insertBefore, remove } from "abcls-cstree";
import { ABCContext, BeamItem, TT, beamJoins, groupStarts } from "abcls-parser";
import { DocumentSnapshots, encode, getSnapshotAtPosition } from "abcls-parser/interpreter/ContextInterpreter";
import { CSNode, TAGS, createCSNode, getTokenData, isTokenNode } from "../csTree/types";
import { Selection } from "../selection";
import { Bar, barsOf, isSelectedBar, selectedIds, timeBar } from "./rebar";
import { getNodeLineAndChar } from "./treeUtils";

/** The elements that belong to the note that follows them, so that a space goes before them and not between them and the note. */
const PREFIX_TAGS: string[] = [TAGS.Decoration, TAGS.Annotation, TAGS.Grace_group, TAGS.Tuplet];

function isSpace(node: CSNode): boolean {
  return isTokenNode(node) && getTokenData(node).tokenType === TT.WS;
}

/**
 * Replaces every beam that holds the leaves of a bar by its children, so that the notes stand side by side and only the spaces decide the beaming.
 * Because the text of a beam is its notes with no space between them, the text does not change.
 */
function flattenBeams(bar: Bar): void {
  const beams = new Set<CSNode>();
  for (const leaf of bar.leaves) {
    const parent = getParent(leaf);
    if (parent !== null && parent.tag === TAGS.Beam) beams.add(parent);
  }
  for (const beam of beams) {
    while (beam.firstChild !== null) {
      const child = beam.firstChild;
      remove(child);
      insertBefore(beam, child);
    }
    remove(beam);
  }
}

/**
 * Finds the first node of an item: its note, rest or chord, and the decorations, annotations, grace notes and tuplet mark before it.
 */
function itemStart(node: CSNode, siblings: CSNode[]): CSNode {
  let index = siblings.indexOf(node);
  while (index > 0 && PREFIX_TAGS.includes(siblings[index - 1].tag)) index -= 1;
  return siblings[index];
}

function createSpace(ctx: ABCContext): CSNode {
  return createCSNode(TAGS.Token, ctx.generateId(), { lexeme: " ", tokenType: TT.WS, line: 0, position: 0 });
}

/**
 * Makes the text between two items agree with the beaming: no space when they are beamed together, one space when they are not.
 * Because anything else between them (a broken rhythm sign, for instance) is the composer's, such a gap is left as it is.
 */
function setGap(previous: CSNode, next: CSNode, isBeamed: boolean, ctx: ABCContext): void {
  const parent = getParent(next);
  if (parent === null || getParent(previous) !== parent) return;
  const siblings = collectChildren(parent);
  const start = itemStart(next, siblings);
  const between = siblings.slice(siblings.indexOf(previous) + 1, siblings.indexOf(start));
  if (!between.every(isSpace)) return;

  if (isBeamed) {
    for (const space of between) remove(space);
  } else if (between.length === 0) {
    insertBefore(start, createSpace(ctx));
  } else {
    for (const extra of between.slice(1)) remove(extra);
  }
}

function beamBar(bar: Bar, snapshots: DocumentSnapshots, ctx: ABCContext): void {
  flattenBeams(bar);
  const { timed } = timeBar(bar);
  if (timed.length < 2) return;

  const { line, char } = getNodeLineAndChar(bar.leaves[0]);
  const snapshot = getSnapshotAtPosition(snapshots, encode(line, char));
  const meter = snapshot.meter.value !== undefined && snapshot.meter.value.length > 0 ? snapshot.meter.value[0] : undefined;
  // Because a tune without a meter has no beats to group by, its beaming is left to the composer.
  if (meter === undefined) return;

  const unit = snapshot.noteLength.numerator / snapshot.noteLength.denominator;
  const items: BeamItem[] = timed.map((leaf) => ({ start: leaf.start * unit, end: leaf.end * unit, isNoteLike: leaf.node.tag !== TAGS.Rest }));
  const joins = beamJoins(items, groupStarts(meter, snapshot.meter.beat_division));
  for (let index = 1; index < timed.length; index++) {
    setGap(timed[index - 1].node, timed[index].node, joins[index], ctx);
  }
}

/**
 * Beams the notes of every selected bar by the meter.
 * The groups follow the meter and its groups, so that 6/8 groups by three and 6/8 (2/8+2/8+2/8) by two, and a rest, a quarter note
 * or a longer note ends a beam. The spaces between the notes of the bar are rewritten to match, and nothing else changes.
 * Because it replaces the beaming that the composer wrote in the bars that it works on, it is meant to be run on a selection.
 *
 * @param selection The selection that holds the notes of the bars to beam
 * @param ctx The context that gives the ids of new nodes
 * @param snapshots The document snapshots, which give the meter and the default note length at each bar
 */
export function autoBeam(selection: Selection, ctx: ABCContext, snapshots: DocumentSnapshots): Selection {
  const ids = selectedIds(selection);
  for (const bar of barsOf(selection.root)) {
    if (isSelectedBar(bar, ids)) beamBar(bar, snapshots, ctx);
  }
  return selection;
}
