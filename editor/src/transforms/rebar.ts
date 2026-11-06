import { cloneSubtree, insertAfter, remove } from "abcls-cstree";
import { ABCContext, TT, addRational, createRational, IRational } from "abcls-parser";
import { DocumentSnapshots, encode, getSnapshotAtPosition } from "abcls-parser/interpreter/ContextInterpreter";
import { Token } from "abcls-parser/parsers/scan";
import { BarLine } from "abcls-parser/types/Expr";
import { fromAst } from "../csTree/fromAst";
import { CSNode, TAGS, getTokenData, isBarLine, isChord, isNote, isTokenNode } from "../csTree/types";
import { Selection } from "../selection";
import { isVoiceMarker } from "../selectors/voiceSelector";
import { brokenRhythmLexeme, consumeDuration, multiMeasureRestCount, startTuplet, VoiceClock } from "./chordTimeline";
import { sameChordPitches, samePitch } from "./consolidateTiedNotes";
import { divideRhythm } from "./divideRhythm";
import { multiplyRhythm } from "./multiplyRhythm";
import { getNodeRhythm, rationalToRhythm } from "./rhythm";
import { findRhythmChild, findTieChild, getNodeLineAndChar, replaceRhythm } from "./treeUtils";

/**
 * Because the durations of a bar are computed as floating point numbers of units of the default note length,
 * two positions closer than this are the same position.
 */
const TOLERANCE = 1e-9;

/**
 * One bar of one line of music: the leaves between two separators (a bar line, the end of the line or a voice marker).
 */
export interface Bar {
  /** The notes, rests, chords, annotations and other leaves of the bar, in document order. Beams are entered, their children are listed. */
  leaves: CSNode[];
  /** The bar line that closes the bar, or null when the line ends or the voice changes first. */
  closing: CSNode | null;
  /** The index of the line of music that the bar is on, so that bars of different lines are never merged. */
  lineIndex: number;
}

/**
 * The state of the walk that cuts the tree into bars.
 */
interface BarWalk {
  bars: Bar[];
  current: CSNode[];
  lineIndex: number;
}

/**
 * A note, a rest or a chord of a bar, with the position where it starts and where it ends, in units of the default note length.
 */
export interface TimedLeaf {
  node: CSNode;
  start: number;
  end: number;
  /** True when a tuplet or a broken rhythm shapes the duration, so that the leaf cannot be cut in two. */
  shaped: boolean;
}

/**
 * Ends the bar that is being collected, because a separator was reached.
 */
function closeBar(walk: BarWalk, closing: CSNode | null): void {
  if (walk.current.length > 0 || closing !== null) {
    walk.bars.push({ leaves: walk.current, closing, lineIndex: walk.lineIndex });
  }
  walk.current = [];
}

/**
 * Cuts the tree into bars, in document order.
 * Because the header of a tune holds no music, it is skipped, and each end of line or voice marker starts a new line of music.
 */
function collectBars(node: CSNode, walk: BarWalk): void {
  switch (node.tag) {
    case TAGS.Tune_header:
    case TAGS.File_header:
      return;
    case TAGS.BarLine:
      closeBar(walk, node);
      return;
    case TAGS.Info_line:
    case TAGS.Inline_field:
      if (isVoiceMarker(node)) {
        closeBar(walk, null);
        walk.lineIndex += 1;
      } else {
        walk.current.push(node);
      }
      return;
    case TAGS.Token:
      if (getTokenData(node).tokenType === TT.EOL) {
        closeBar(walk, null);
        walk.lineIndex += 1;
      }
      return;
    case TAGS.Note:
    case TAGS.Rest:
    case TAGS.Chord:
    case TAGS.MultiMeasureRest:
    case TAGS.YSPACER:
    case TAGS.Tuplet:
    case TAGS.Annotation:
    case TAGS.Decoration:
    case TAGS.Grace_group:
      walk.current.push(node);
      return;
    default:
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        collectBars(child, walk);
      }
  }
}

export function barsOf(root: CSNode): Bar[] {
  const walk: BarWalk = { bars: [], current: [], lineIndex: 0 };
  collectBars(root, walk);
  closeBar(walk, null);
  return walk.bars;
}

/**
 * Lists the ids of every node that a selection holds, whatever its cursor.
 */
export function selectedIds(selection: Selection): Set<number> {
  const ids = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) ids.add(id);
  }
  return ids;
}

export function isSelectedBar(bar: Bar, ids: Set<number>): boolean {
  return bar.leaves.some((leaf) => ids.has(leaf.id));
}

/**
 * Computes where each note, rest and chord of a bar starts and ends, with the same rules as the interpreter.
 * Because a tuplet and a broken rhythm do not carry over a bar line, each bar starts with a clean clock.
 *
 * @returns The timed leaves, and the total length of the bar
 */
export function timeBar(bar: Bar): { timed: TimedLeaf[]; total: number } {
  const clock: VoiceClock = { bar: 0, offset: 0, hasContent: false, nextMultiplier: 1, tupletRatio: 1, tupletNotesLeft: 0 };
  const timed: TimedLeaf[] = [];
  for (const leaf of bar.leaves) {
    if (leaf.tag === TAGS.Tuplet) {
      startTuplet(leaf, clock);
    } else if (leaf.tag === TAGS.Note || leaf.tag === TAGS.Rest || leaf.tag === TAGS.Chord) {
      // Because extractBrokenToken removes the token from the tree, the broken rhythm is only read here.
      const shaped = clock.tupletNotesLeft > 0 || clock.nextMultiplier !== 1 || brokenRhythmLexeme(leaf) !== null;
      const start = clock.offset;
      clock.offset += consumeDuration(leaf, clock);
      timed.push({ node: leaf, start, end: clock.offset, shaped });
    }
  }
  return { timed, total: clock.offset };
}

/**
 * Converts a number of units to a rational. Because the durations that we cut are sums of rhythms (powers of two and
 * simple fractions), a denominator up to 64 is enough.
 */
function unitsToRational(units: number): IRational {
  for (let denominator = 1; denominator <= 64; denominator *= 2) {
    const numerator = Math.round(units * denominator);
    if (Math.abs(numerator / denominator - units) < TOLERANCE) {
      return createRational(numerator, denominator);
    }
  }
  throw new Error(`Cannot write the duration ${units} as a rhythm.`);
}

/**
 * Reads the length of a bar, in units of the default note length, from the meter and the note length in effect at the bar.
 */
function barLengthInUnits(bar: Bar, snapshots: DocumentSnapshots): number {
  const { line, char } = getNodeLineAndChar(bar.leaves[0]);
  const snapshot = getSnapshotAtPosition(snapshots, encode(line, char));
  const meter = snapshot.meter.value !== undefined && snapshot.meter.value.length > 0 ? snapshot.meter.value[0] : createRational(1, 1);
  const noteLength = snapshot.noteLength;
  return meter.numerator / meter.denominator / (noteLength.numerator / noteLength.denominator);
}

function createBarLine(ctx: ABCContext): CSNode {
  const token = new Token(TT.BARLINE, "|", ctx.generateId());
  return fromAst(new BarLine(ctx.generateId(), [token]), ctx);
}

function createTie(ctx: ABCContext): CSNode {
  return fromAst(new Token(TT.TIE, "-", ctx.generateId()), ctx);
}

/**
 * Tells whether a note or a chord is tied to the next one, either by a tie after it or, for a chord, by the ties of its notes.
 */
function isTiedForward(node: CSNode): boolean {
  if (findTieChild(node) !== null) return true;
  if (!isChord(node)) return false;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (isNote(child) && findTieChild(child) !== null) return true;
  }
  return false;
}

/**
 * Finds the node after which a bar line can be inserted so that it follows the leaf.
 * Because a slur ends with a ")" that is written right after its last note, the bar line goes after that token.
 */
function anchorAfter(node: CSNode): CSNode {
  let anchor = node;
  while (anchor.nextSibling !== null) {
    const next = anchor.nextSibling;
    if (!isTokenNode(next)) break;
    const data = getTokenData(next);
    if (data.tokenType !== TT.SLUR || data.lexeme !== ")") break;
    anchor = next;
  }
  return anchor;
}

/**
 * Cuts a note, a rest or a chord in two at a bar line that falls inside it.
 * The head keeps the node and gets the tie that joins it to the tail, and the tail is a copy that keeps the original tie.
 * Because a chord whose notes carry their own ties is already tied, it gets no further tie.
 *
 * @returns The tail, which is the node that the next bar line may cut again
 */
function cutAtBarLine(item: TimedLeaf, at: number, ctx: ABCContext): CSNode {
  if (item.shaped) {
    throw new Error("Cannot put a bar line inside a note that is part of a tuplet or of a broken rhythm.");
  }
  const node = item.node;
  const tail = cloneSubtree(node, () => ctx.generateId());
  replaceRhythm(tail, rationalToRhythm(unitsToRational(item.end - at), ctx));
  replaceRhythm(node, rationalToRhythm(unitsToRational(at - item.start), ctx));
  if (node.tag !== TAGS.Rest && !isTiedForward(node)) {
    // Because the clone was made first, the tail does not get this tie.
    const tie = createTie(ctx);
    const rhythm = findRhythmChild(node);
    if (rhythm !== null) {
      insertAfter(rhythm, tie);
    } else {
      insertAfter(lastChildOf(node), tie);
    }
  }
  const anchor = anchorAfter(node);
  const barLine = createBarLine(ctx);
  insertAfter(anchor, barLine);
  insertAfter(barLine, tail);
  return tail;
}

function lastChildOf(node: CSNode): CSNode {
  let child = node.firstChild;
  while (child !== null && child.nextSibling !== null) child = child.nextSibling;
  if (child === null) throw new Error("A note without a pitch cannot be tied.");
  return child;
}

/**
 * Splits a bar that lasts longer than the meter into bars of the meter's length.
 * A note that crosses a new bar line is cut in two with a tie.
 */
function splitBar(bar: Bar, length: number, ctx: ABCContext): void {
  const { timed, total } = timeBar(bar);
  let boundary = length;
  for (const item of timed) {
    let current: TimedLeaf = item;
    while (boundary < total - TOLERANCE) {
      if (current.end <= boundary + TOLERANCE) {
        if (Math.abs(current.end - boundary) <= TOLERANCE) {
          insertAfter(anchorAfter(current.node), createBarLine(ctx));
          boundary += length;
        }
        break;
      }
      const tail = cutAtBarLine(current, boundary, ctx);
      current = { node: tail, start: boundary, end: current.end, shaped: false };
      boundary += length;
    }
  }
}

/**
 * Replaces a one-bar multi-measure rest by the given number of them, with a bar line between each two.
 * Because the chord symbol that precedes the rest belongs to the first bar, only the first copy keeps it.
 */
function repeatRest(rest: CSNode, times: number, ctx: ABCContext): void {
  if (multiMeasureRestCount(rest) !== 1) {
    throw new Error("Cannot multiply a multi-measure rest of more than one bar.");
  }
  let anchor = rest;
  for (let copy = 1; copy < times; copy++) {
    const barLine = createBarLine(ctx);
    insertAfter(anchor, barLine);
    const clone = cloneSubtree(rest, () => ctx.generateId());
    insertAfter(barLine, clone);
    anchor = clone;
  }
}

function assertFactor(factor: number): void {
  if (!Number.isInteger(factor) || factor < 2) {
    throw new Error(`The factor of a transform that re-bars must be a whole number of at least 2 (got ${factor}).`);
  }
}

/**
 * Multiplies the length of the selected notes and re-bars them.
 * Each bar that holds a selected note is cut into bars of the length of the meter, with ties where a note crosses
 * a new bar line, and a one-bar multi-measure rest becomes as many bars of rest as the factor says.
 * Because the durations are multiples of the default note length, the meter and the default note length stay as they are.
 */
export function multiplyRhythmRebar(selection: Selection, ctx: ABCContext, snapshots: DocumentSnapshots, factor: number = 2): Selection {
  assertFactor(factor);
  multiplyRhythm(selection, factor, ctx);

  const ids = selectedIds(selection);
  for (const bar of barsOf(selection.root)) {
    if (!isSelectedBar(bar, ids)) continue;
    for (const leaf of bar.leaves) {
      if (leaf.tag === TAGS.MultiMeasureRest) repeatRest(leaf, factor, ctx);
    }
    if (bar.leaves.some((leaf) => leaf.tag === TAGS.Note || leaf.tag === TAGS.Rest || leaf.tag === TAGS.Chord)) {
      splitBar(bar, barLengthInUnits(bar, snapshots), ctx);
    }
  }
  return selection;
}

/**
 * Finds the first note, rest or chord of a bar, and the last one, or null when the bar holds none.
 */
function edgeLeaves(bar: Bar): { first: CSNode; last: CSNode } | null {
  const timed = bar.leaves.filter((leaf) => leaf.tag === TAGS.Note || leaf.tag === TAGS.Rest || leaf.tag === TAGS.Chord || leaf.tag === TAGS.MultiMeasureRest);
  if (timed.length === 0) return null;
  return { first: timed[0], last: timed[timed.length - 1] };
}

/**
 * Tells whether something other than whitespace stands in a bar before its first note, rest or chord:
 * an annotation, a decoration, a grace group or a field. Joining the bar to the one before would then lose the meaning of that leaf.
 */
function hasLeavesBefore(bar: Bar, first: CSNode): boolean {
  for (const leaf of bar.leaves) {
    if (leaf === first) return false;
    if (
      leaf.tag === TAGS.Annotation ||
      leaf.tag === TAGS.Decoration ||
      leaf.tag === TAGS.Grace_group ||
      leaf.tag === TAGS.Inline_field ||
      leaf.tag === TAGS.Info_line
    )
      return true;
  }
  return false;
}

/**
 * Tells whether two notes (or two chords) are the same pitches, so that a tie between them can be one longer note.
 */
function sameTiedPitches(a: CSNode, b: CSNode): boolean {
  if (isNote(a) && isNote(b)) return samePitch(a, b);
  if (isChord(a) && isChord(b)) return sameChordPitches(a, b);
  return false;
}

function isShaped(node: CSNode): boolean {
  return brokenRhythmLexeme(node) !== null;
}

/**
 * Joins two tied notes (or chords) that a removed bar line used to separate into one longer note.
 * Because the later note carries the tie that leaves the pair, the later note is kept, with the sum of the two rhythms.
 *
 * @returns True when the two notes were joined
 */
function joinTied(previous: CSNode, next: CSNode, ctx: ABCContext): boolean {
  if (!isTiedForward(previous) || !sameTiedPitches(previous, next)) return false;
  if (isShaped(previous) || isShaped(next)) return false;
  const sum = addRational(getNodeRhythm(previous), getNodeRhythm(next));
  replaceRhythm(next, rationalToRhythm(sum, ctx));
  remove(previous);
  return true;
}

/**
 * Merges a group of bars into the first one, by removing the bar lines between them.
 * Notes that the removed bar lines left tied become one longer note, and consecutive one-bar rests become one.
 */
function mergeGroup(group: Bar[], ctx: ABCContext): void {
  for (let index = 1; index < group.length; index++) {
    const before = edgeLeaves(group[index - 1]);
    const after = edgeLeaves(group[index]);
    const barLine = group[index - 1].closing;
    if (barLine === null) continue;
    remove(barLine);
    if (before === null || after === null) continue;

    const isRestPair = before.last.tag === TAGS.MultiMeasureRest && after.first.tag === TAGS.MultiMeasureRest;
    if (isRestPair) {
      if (hasLeavesBefore(group[index], after.first)) {
        throw new Error("Cannot merge two bars of rest that carry different annotations.");
      }
      remove(after.first);
      continue;
    }
    if (!hasLeavesBefore(group[index], after.first)) {
      joinTied(before.last, after.first, ctx);
    }
  }
}

/**
 * Tells whether the bar line that closes a bar is a plain one, which can be removed without losing a repeat or an ending.
 */
function hasPlainClosing(bar: Bar): boolean {
  if (bar.closing === null || !isBarLine(bar.closing)) return false;
  let text = "";
  for (let child = bar.closing.firstChild; child !== null; child = child.nextSibling) {
    if (isTokenNode(child)) text += getTokenData(child).lexeme;
  }
  return text === "|";
}

/**
 * Divides the length of the selected notes and re-bars them: every group of as many bars as the factor says,
 * on the same line and separated by plain bar lines, becomes one bar.
 * A group that is shorter than the factor, or that holds a repeat sign or an ending, is left as it is.
 */
export function divideRhythmRebar(selection: Selection, ctx: ABCContext, factor: number = 2): Selection {
  assertFactor(factor);
  divideRhythm(selection, factor, ctx);

  const ids = selectedIds(selection);
  const bars = barsOf(selection.root);
  let index = 0;
  while (index < bars.length) {
    const group = bars.slice(index, index + factor);
    const canMerge =
      group.length === factor &&
      group.every((bar) => isSelectedBar(bar, ids) && bar.lineIndex === group[0].lineIndex) &&
      group.slice(0, -1).every((bar) => hasPlainClosing(bar));
    if (canMerge) {
      mergeGroup(group, ctx);
      index += factor;
    } else {
      index += 1;
    }
  }
  return selection;
}
