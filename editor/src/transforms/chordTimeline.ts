import { getTokenData, isTokenNode } from "../csTree/types";
import { CSNode, TAGS } from "../csTree/types";
import { extractVoiceId, isVoiceMarker } from "../selectors/voiceSelector";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { getNodeRhythm } from "./rhythm";
import { findChild } from "abcls-cstree";

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
}

const TOLERANCE = 1e-9;

export function getClock(state: TimelineWalkState): VoiceClock {
  let clock = state.clocks.get(state.currentVoiceId);
  if (clock === undefined) {
    clock = { bar: 0, offset: 0, hasContent: false };
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
      const rhythm = getNodeRhythm(node);
      clock.offset += rhythm.numerator / rhythm.denominator;
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
