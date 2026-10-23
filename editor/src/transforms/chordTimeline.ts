import { getTokenData, isTokenNode } from "../csTree/types";
import { CSNode, TAGS } from "../csTree/types";
import { extractVoiceId, isVoiceMarker } from "../selectors/voiceSelector";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { getNodeRhythm } from "./rhythm";
import { findChild } from "abcls-cstree";
import { TT } from "abcls-parser";
import { TUPLET_Q, getBrokenRhythmMultipliers } from "abcls-parser/interpreter/TuneInterpreter";
import { findRhythmChild } from "./treeUtils";

/**
 * A point in the time of a voice: the bar index (counted from the start of the tune body)
 * and the offset inside the bar, in units of the default note length.
 */
export interface TimePoint {
  /** The index of the tune in the file, so a tune never reads the chords of another tune. */
  tune: number;
  voiceId: string;
  bar: number;
  offset: number;
}

export interface ChordEntry extends TimePoint {
  chord: ParsedChord;
}

/**
 * Chord symbols are written once, usually in a single voice, but they apply to every voice that sounds at the same time.
 * Because the interpreter keeps one chord "in effect" in text order, a voice written after the chord voice
 * would see the last chord of the chord voice instead of the chord of its own bar.
 * This timeline places each chord symbol and each note on a (bar, offset) grid, so any note can ask for the chord
 * that is sounding at its own position, whichever voice wrote the symbol.
 */
export interface ChordTimeline {
  entries: ChordEntry[];
  /** Position of every note, rest and chord node, indexed by node id. */
  positions: Map<number, TimePoint>;
}

/**
 * The mutable state that the walk over the tune body passes from node to node.
 */
export interface TimelineWalkState {
  timeline: ChordTimeline;
  currentVoiceId: string;
  /** The index of the tune that the walk is in. */
  tuneIndex: number;
  /** The bar index and the offset reached so far, for every voice. */
  clocks: Map<string, VoiceClock>;
}

/**
 * The position reached in one voice. The flag `hasContent` tells whether the current bar holds a note, a rest or a chord,
 * so a barline that opens a line (or follows another barline) is not counted as a bar.
 */
export interface VoiceClock {
  bar: number;
  offset: number;
  hasContent: boolean;
  /** The factor that a broken rhythm (">" or "<") on the previous note applies to the next note. */
  nextMultiplier: number;
  /** The factor q/p of the tuplet in progress, and the number of notes it still applies to. */
  tupletRatio: number;
  tupletNotesLeft: number;
}

const TOLERANCE = 1e-9;

export function getClock(state: TimelineWalkState): VoiceClock {
  let clock = state.clocks.get(state.currentVoiceId);
  if (clock === undefined) {
    clock = { bar: 0, offset: 0, hasContent: false, nextMultiplier: 1, tupletRatio: 1, tupletNotesLeft: 0 };
    state.clocks.set(state.currentVoiceId, clock);
  }
  return clock;
}

/**
 * Reads the text of an annotation node and parses it as a chord symbol.
 * Annotations that are not chord symbols (such as "[…]") give null.
 */
export function parseAnnotationChord(node: CSNode): ParsedChord | null {
  const tokenNode = findChild(node, (n) => isTokenNode(n));
  if (tokenNode === null || tokenNode === undefined || !isTokenNode(tokenNode)) return null;

  let text = getTokenData(tokenNode).lexeme;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }
  if (text.length > 0 && "^_<>@".includes(text[0])) {
    text = text.slice(1);
  }

  const scanResult = scanChordSymbol(text);
  if (scanResult === null) return null;
  return parseChordSymbol(scanResult.tokens);
}

/**
 * Reads the broken rhythm marker (">", ">>", "<", ...) of a note, rest or chord, or null when it has none.
 */
export function brokenRhythmLexeme(node: CSNode): string | null {
  const rhythmNode = findRhythmChild(node);
  if (rhythmNode === null) return null;
  const broken = findChild(rhythmNode, (n) => isTokenNode(n) && getTokenData(n).tokenType === TT.RHY_BRKN);
  if (broken === null || broken === undefined || !isTokenNode(broken)) return null;
  return getTokenData(broken).lexeme;
}

/**
 * Computes how long a note, a rest or a chord lasts, in units of the default note length, and updates the clock
 * for the broken rhythm and the tuplet that it is part of. The rules are those of the interpreter:
 * a broken rhythm lengthens one note of the pair and shortens the other, and a tuplet (p:q:r scales its next r notes by q/p.
 */
export function consumeDuration(node: CSNode, clock: VoiceClock): number {
  const rhythm = getNodeRhythm(node);
  let units = (rhythm.numerator / rhythm.denominator) * clock.nextMultiplier;
  clock.nextMultiplier = 1;

  const broken = brokenRhythmLexeme(node);
  if (broken !== null) {
    const [current, next] = getBrokenRhythmMultipliers(broken);
    units *= current.numerator / current.denominator;
    clock.nextMultiplier = next.numerator / next.denominator;
  }

  if (clock.tupletNotesLeft > 0) {
    units *= clock.tupletRatio;
    clock.tupletNotesLeft -= 1;
  }
  return units;
}

/**
 * Reads the p, q and r values of a tuplet node, and starts the tuplet on the clock.
 */
export function startTuplet(node: CSNode, clock: VoiceClock): void {
  let p: number | null = null;
  let q: number | null = null;
  let r: number | null = null;
  let child = node.firstChild;
  while (child !== null) {
    if (isTokenNode(child)) {
      const data = getTokenData(child);
      const value = parseInt(data.lexeme, 10);
      if (data.tokenType === TT.TUPLET_P) p = value;
      if (data.tokenType === TT.TUPLET_Q && !Number.isNaN(value)) q = value;
      if (data.tokenType === TT.TUPLET_R && !Number.isNaN(value)) r = value;
    }
    child = child.nextSibling;
  }
  if (p === null || Number.isNaN(p) || p <= 0) return;
  const resolvedQ = q ?? TUPLET_Q[p] ?? 2;
  clock.tupletRatio = resolvedQ / p;
  clock.tupletNotesLeft = r ?? p;
}

/**
 * Walks a node and its descendants in document order, and fills the timeline.
 * Notes and chords are not entered, because their children are pitches and rhythms, which carry no timing of their own.
 * Grace groups are not entered either, because grace notes take no time.
 */
export function walkForTimeline(node: CSNode, state: TimelineWalkState): void {
  switch (node.tag) {
    case TAGS.Info_line:
    case TAGS.Inline_field: {
      if (isVoiceMarker(node)) {
        const voiceId = extractVoiceId(node);
        if (voiceId !== null && voiceId !== "") {
          state.currentVoiceId = voiceId;
        }
      }
      return;
    }
    case TAGS.BarLine: {
      const clock = getClock(state);
      // Because a barline that opens a line closes nothing, counting it would put this voice one bar ahead of the others.
      if (!clock.hasContent) return;
      clock.bar += 1;
      clock.offset = 0;
      clock.hasContent = false;
      // As in the interpreter, a broken rhythm and a tuplet do not carry over a barline.
      clock.nextMultiplier = 1;
      clock.tupletNotesLeft = 0;
      return;
    }
    case TAGS.Annotation: {
      const chord = parseAnnotationChord(node);
      if (chord !== null) {
        const clock = getClock(state);
        state.timeline.entries.push({ tune: state.tuneIndex, voiceId: state.currentVoiceId, bar: clock.bar, offset: clock.offset, chord });
      }
      return;
    }
    case TAGS.Note:
    case TAGS.Rest:
    case TAGS.Chord: {
      const clock = getClock(state);
      state.timeline.positions.set(node.id, { tune: state.tuneIndex, voiceId: state.currentVoiceId, bar: clock.bar, offset: clock.offset });
      clock.offset += consumeDuration(node, clock);
      clock.hasContent = true;
      return;
    }
    case TAGS.MultiMeasureRest: {
      // A multi-measure rest fills the bar it stands in, and the barline that follows closes it.
      const clock = getClock(state);
      state.timeline.positions.set(node.id, { tune: state.tuneIndex, voiceId: state.currentVoiceId, bar: clock.bar, offset: clock.offset });
      clock.hasContent = true;
      return;
    }
    case TAGS.Tuplet:
      startTuplet(node, getClock(state));
      return;
    case TAGS.Grace_group:
      return;
    default: {
      // Because every tune restarts its bars and its voices, a new tune body resets the clocks.
      if (node.tag === TAGS.Tune_Body) {
        state.tuneIndex += 1;
        state.currentVoiceId = "";
        state.clocks.clear();
      }
      let child = node.firstChild;
      while (child !== null) {
        walkForTimeline(child, state);
        child = child.nextSibling;
      }
    }
  }
}

export function buildChordTimeline(root: CSNode): ChordTimeline {
  const state: TimelineWalkState = {
    timeline: { entries: [], positions: new Map() },
    currentVoiceId: "",
    tuneIndex: -1,
    clocks: new Map(),
  };
  walkForTimeline(root, state);
  return state.timeline;
}

/**
 * Returns whether the point a comes before or at the point b.
 */
export function isAtOrBefore(a: TimePoint, b: TimePoint): boolean {
  if (a.bar !== b.bar) return a.bar < b.bar;
  return a.offset <= b.offset + TOLERANCE;
}

/**
 * Finds the chord that sounds at the position of a node.
 * We take the latest chord symbol at or before the node, from any voice.
 * Because a chord symbol of the node's own voice is the more specific one, it wins a tie on the exact same point.
 * The result is null when the node has no known position or when no chord symbol precedes it.
 */
export function chordAtNode(timeline: ChordTimeline, nodeId: number): ParsedChord | null {
  const position = timeline.positions.get(nodeId);
  if (position === undefined) return null;

  let best: ChordEntry | null = null;
  for (const entry of timeline.entries) {
    if (entry.tune !== position.tune) continue;
    if (!isAtOrBefore(entry, position)) continue;
    if (best === null) {
      best = entry;
      continue;
    }
    const isLater = best.bar < entry.bar || (best.bar === entry.bar && entry.offset > best.offset + TOLERANCE);
    const isTie = best.bar === entry.bar && Math.abs(entry.offset - best.offset) <= TOLERANCE;
    if (isLater || (isTie && entry.voiceId === position.voiceId)) {
      best = entry;
    }
  }
  return best === null ? null : best.chord;
}

/**
 * Finds the node that follows a node in time, in the same tune and voice, or null when it is the last one.
 * Because the voices of a score are written in alternating lines, the next note of a voice is not the next node of the tree.
 */
export function nextNodeInVoice(timeline: ChordTimeline, nodeId: number): number | null {
  const position = timeline.positions.get(nodeId);
  if (position === undefined) return null;

  let bestId: number | null = null;
  let best: TimePoint | null = null;
  for (const [id, candidate] of timeline.positions) {
    if (id === nodeId || candidate.tune !== position.tune || candidate.voiceId !== position.voiceId) continue;
    if (isAtOrBefore(candidate, position)) continue;
    if (best === null || isAtOrBefore(candidate, best)) {
      best = candidate;
      bestId = id;
    }
  }
  return bestId;
}
