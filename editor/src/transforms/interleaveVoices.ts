import { appendChild, collectChildren, remove } from "abcls-cstree";
import { ABCContext, BarLine, Comment, Directive, Expr, Info_line, Inline_field, Lyric_line, Token, TT, extractVoiceIdFromMarker } from "abcls-parser";
import { Position } from "abcls-parser/types/types";
import { CSNode, TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { findByPos, firstTokenNode } from "../selectors/treeWalk";
import { prependVoiceMarker, systemNodeToAst, toCSTreeSystem } from "./splitSystem";

type Element = Expr | Token;

/** A line of the tune that is not music (a `P:` line, a `%%text` directive, a comment) and the bar that it comes before. */
interface NoteLine {
  element: Element;
  /** The number of bars of the voice that were closed before the line. */
  barsBefore: number;
}

/** What is known of one voice while the body is read. */
interface VoiceStream {
  id: string;
  /** The elements of the music of the voice, without line ends and without voice markers. */
  music: Element[];
  /** For each closed bar, the index in `music` that follows its bar line. */
  boundaries: number[];
  /** True when music was read since the last bar line. */
  contentSinceBar: boolean;
  noteLines: NoteLine[];
}

const NO_VOICE = "";

function isBlankToken(element: Element): boolean {
  return element instanceof Token && (element.type === TT.WS || element.type === TT.EOL);
}

function isVoiceMarker(element: Element): element is Info_line | Inline_field {
  return (element instanceof Info_line || element instanceof Inline_field) && extractVoiceIdFromMarker(element) !== null;
}

/** Tells whether an element is a line that does not belong to the music: an info line, a directive or a comment. */
function isNoteLine(element: Element): boolean {
  return element instanceof Info_line || element instanceof Directive || element instanceof Comment;
}

/**
 * Tells whether an element is an empty comment (a lone `%`), which is how a system is separated from the next one.
 * Because the formatter writes its own separators between the systems, the ones that the source has are dropped,
 * and keeping them would double the separator.
 */
function isSeparator(element: Element): boolean {
  return element instanceof Comment && element.token.lexeme.replace(/^%/, "").trim() === "";
}

function streamFor(streams: Map<string, VoiceStream>, id: string): VoiceStream {
  let stream = streams.get(id);
  if (stream === undefined) {
    stream = { id, music: [], boundaries: [], contentSinceBar: false, noteLines: [] };
    streams.set(id, stream);
  }
  return stream;
}

/** Gives the position of the first element that follows `index` and is not a blank token. */
function skipBlanks(elements: readonly Element[], index: number): number {
  let next = index;
  while (next < elements.length && isBlankToken(elements[next])) next++;
  return next;
}

/**
 * Reads the elements of a tune body into one stream of music for each voice.
 *
 * Because a voice may be written in several blocks, its music is read as one stream: the voice markers only tell which
 * stream the following elements belong to. A bar is closed by a bar line that follows music, so that a bar line at the
 * start of a section (`|:`) or a doubled bar line does not count as a bar.
 * Because the line end that separated two blocks of a voice is dropped, a space takes its place, so that the music of the two
 * blocks does not touch.
 * Returns null when the body holds something that this transform does not move safely: lines of lyrics.
 */
function readStreams(flat: readonly Element[], ctx: ABCContext): Map<string, VoiceStream> | null {
  const streams = new Map<string, VoiceStream>();
  let current = NO_VOICE;

  let i = 0;
  while (i < flat.length) {
    const element = flat[i];

    if (element instanceof Lyric_line) return null;

    if (isVoiceMarker(element)) {
      current = extractVoiceIdFromMarker(element) as string;
      streamFor(streams, current);
      // The blanks and the line end that follow the marker belong to the marker.
      i = skipBlanks(flat, i + 1);
      continue;
    }

    if (element instanceof Token && element.type === TT.EOL) {
      const music = streams.get(current)?.music;
      if (music !== undefined && music.length > 0 && !isBlankToken(music[music.length - 1])) {
        music.push(new Token(TT.WS, " ", ctx.generateId()));
      }
      i++;
      continue;
    }

    if (isSeparator(element)) {
      i++;
      continue;
    }

    const stream = streamFor(streams, current);
    if (isNoteLine(element)) {
      stream.noteLines.push({ element, barsBefore: stream.boundaries.length });
    } else {
      stream.music.push(element);
      if (element instanceof BarLine) {
        if (stream.contentSinceBar) {
          stream.boundaries.push(stream.music.length);
          stream.contentSinceBar = false;
        }
      } else if (!isBlankToken(element)) {
        stream.contentSinceBar = true;
      }
    }
    i++;
  }

  // Elements that were read before any voice marker only make a voice when no other voice exists.
  const implicit = streams.get(NO_VOICE);
  if (implicit !== undefined && implicit.music.every(isBlankToken) && implicit.noteLines.length === 0) {
    streams.delete(NO_VOICE);
  }
  return streams;
}

/** Counts the bars of a voice: the closed ones, and the last one when music follows the last bar line. */
function countBars(stream: VoiceStream): number {
  const lastBoundary = stream.boundaries.length > 0 ? stream.boundaries[stream.boundaries.length - 1] : 0;
  const trailing = stream.music.slice(lastBoundary).some((element) => !isBlankToken(element) && !(element instanceof BarLine));
  return stream.boundaries.length + (trailing ? 1 : 0);
}

/** Drops the blanks at both ends of a list of elements. */
function trimBlanks(elements: readonly Element[]): Element[] {
  let start = 0;
  let end = elements.length;
  while (start < end && isBlankToken(elements[start])) start++;
  while (end > start && isBlankToken(elements[end - 1])) end--;
  return elements.slice(start, end);
}

/** Cuts the music of a voice into segments of `barsPerSystem` bars. The last segment has what is left. */
function cutIntoSegments(stream: VoiceStream, barsPerSystem: number): Element[][] {
  const bars = countBars(stream);
  const segments: Element[][] = [];
  let start = 0;
  for (let first = 0; first < bars; first += barsPerSystem) {
    const lastBar = first + barsPerSystem;
    const end = lastBar <= stream.boundaries.length ? stream.boundaries[lastBar - 1] : stream.music.length;
    segments.push(trimBlanks(stream.music.slice(start, end)));
    start = end;
  }
  return segments;
}

/** Builds the line of a voice in a system: its marker, a space, its music, and the end of the line. */
function buildVoiceLine(voiceId: string, segment: readonly Element[], ctx: ABCContext): Element[] {
  const line: Element[] = [];
  if (voiceId !== NO_VOICE) {
    prependVoiceMarker(line, voiceId, ctx);
    line.push(new Token(TT.WS, " ", ctx.generateId()));
  }
  line.push(...segment, new Token(TT.EOL, "\n", ctx.generateId()));
  return line;
}

/**
 * Interleaves the voices of a tune that is written voice by voice.
 *
 * Every voice is cut every `barsPerSystem` bars, and the n-th pieces of all the voices make the n-th system, one line for
 * each voice, in the order in which the voices first appear. Because the cuts are made at bar numbers, the lines of a
 * system have the same number of bars, whatever the lines were in the source. A voice that has fewer bars stops
 * appearing in the last systems.
 *
 * Returns null when the tune cannot be interleaved: it has fewer than two voices with music, or it holds lines of lyrics.
 */
export function interleaveBody(flat: readonly Element[], barsPerSystem: number, ctx: ABCContext): Element[][] | null {
  const streams = readStreams(flat, ctx);
  if (streams === null) return null;

  const voices = [...streams.values()].filter((stream) => countBars(stream) > 0);
  if (voices.length < 2) return null;

  const segmentsByVoice = new Map<string, Element[][]>();
  let systemCount = 0;
  for (const voice of voices) {
    const segments = cutIntoSegments(voice, barsPerSystem);
    segmentsByVoice.set(voice.id, segments);
    systemCount = Math.max(systemCount, segments.length);
  }

  const systems: Element[][] = [];
  for (let s = 0; s < systemCount; s++) {
    const system: Element[] = [];

    // The lines that are not music come first, in the order of the voices, before the system that holds the bar they were before.
    for (const voice of streams.values()) {
      const segmentCount = segmentsByVoice.get(voice.id)?.length ?? 1;
      for (const line of voice.noteLines) {
        const target = Math.min(Math.floor(line.barsBefore / barsPerSystem), Math.max(segmentCount - 1, 0));
        if (target === s) {
          system.push(line.element, new Token(TT.EOL, "\n", ctx.generateId()));
        }
      }
    }

    for (const voice of voices) {
      const segment = segmentsByVoice.get(voice.id)?.[s];
      if (segment !== undefined && segment.length > 0) {
        system.push(...buildVoiceLine(voice.id, segment, ctx));
      }
    }
    systems.push(system);
  }
  return systems;
}

/** Gives the node of a kind among the children of a node. */
function childWithTag(node: CSNode, tag: string): CSNode | null {
  return collectChildren(node).find((child) => child.tag === tag) ?? null;
}

/**
 * Interleaves the voices of the tune under each cursor, `barsPerSystem` bars to a system.
 * See `interleaveBody`. A tune that is in linear mode is left alone, because its voices are interleaved already.
 *
 * The cursor of the result is on the first token of the first system of the first tune that was changed.
 */
export function interleaveVoices(selection: Selection, cursors: Position[], barsPerSystem: number, ctx: ABCContext): Selection {
  const unchanged: Selection = { root: selection.root, cursors: [] };
  if (!Number.isInteger(barsPerSystem) || barsPerSystem < 1) return unchanged;

  const interleavedTunes = new Set<number>();
  const resultCursors: Set<number>[] = [];

  for (const cursor of cursors) {
    const tune = findByPos(selection.root, TAGS.Tune, cursor, null, null);
    if (!tune || interleavedTunes.has(tune.node.id)) continue;
    interleavedTunes.add(tune.node.id);

    const body = childWithTag(tune.node, TAGS.Tune_Body);
    if (body === null || (tune.node.data as { linear: boolean }).linear) continue;

    const oldSystems = collectChildren(body).filter((child) => child.tag === TAGS.System);
    const flat = oldSystems.flatMap((system) => systemNodeToAst(system));
    const interleaved = interleaveBody(flat, barsPerSystem, ctx);
    if (interleaved === null) continue;

    for (const system of oldSystems) remove(system);
    let firstToken: CSNode | null = null;
    for (const system of interleaved) {
      const node = toCSTreeSystem(system, ctx);
      appendChild(body, node);
      firstToken ??= firstTokenNode(node);
    }
    if (firstToken) resultCursors.push(new Set([firstToken.id]));
  }

  return { root: selection.root, cursors: resultCursors };
}
