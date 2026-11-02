/**
 * Reads an ABC tune into an `IrealChart`.
 *
 * This is the ABC counterpart of `abcxToIrealChart.ts`, and it reuses the same walk, so repeats, endings, section
 * labels and annotations are read by the same code in both. What differs is the source: an ABC score holds
 * notes as well as chords, and often holds several voices, so we read the chords from one voice and use the
 * notes of that voice to know which bars exist.
 *
 * - A bar of the chord voice that holds notes but names no chord repeats the previous chord, because a chord sheet
 *   written as a score names a chord once and lets it ring over the following bars.
 * - A bar that names no chord in the chord voice but names one in the voice written just before it takes that chord.
 * - A chord written after the last bar line of a line, with no music after it, belongs to no bar, so we report it and skip it.
 */

import { isChordSymbolText } from "../music-theory/scanChordSymbol";
import { ParsedChord } from "../music-theory/types";
import { ABCContext } from "../parsers/Context";
import {
  Annotation as AbcAnnotation,
  BarLine,
  Beam,
  Chord,
  Comment,
  Expr,
  Info_line,
  Inline_field,
  MultiMeasureRest,
  Note,
  Rest,
  Tune,
  Tuplet,
} from "../types/Expr";
import {
  applyField,
  annotationBody,
  closeSection,
  createWalk,
  flushBar,
  navigationMarker,
  parseMeter,
  readBarLine,
  readChord,
  report,
  Walk,
} from "./abcxToIrealChart";
import { IrealChart } from "./gridAst";

export interface AbcToIrealOptions {
  /** The voice that carries the chords. Defaults to the voice with the most chord symbols. */
  voice?: string;
}

/** One line of the tune body, with the voice it belongs to. */
interface BodyLine {
  voice: string;
  nodes: Expr[];
}

function fieldKeyAndValue(node: Expr): { key: string; value: string; position: number } | null {
  if (node instanceof Inline_field) {
    return {
      key: node.field.lexeme.replace(/:$/, ""),
      value: (node.text ?? [])
        .map((token) => token.lexeme)
        .join("")
        .replace(/^[A-Za-z]:/, "")
        .trim(),
      position: node.field.position,
    };
  }
  if (node instanceof Info_line) {
    return {
      key: node.key.lexeme.replace(/:$/, ""),
      value: node.value
        .map((token) => token.lexeme)
        .join("")
        .trim(),
      position: node.key.position,
    };
  }
  return null;
}

function voiceIdOf(value: string): string {
  return value.split(/\s+/)[0] ?? "";
}

/**
 * Returns the id of the first voice that the tune header declares, or "" when it declares none.
 */
function firstHeaderVoice(tune: Tune): string {
  for (const line of tune.tune_header.info_lines) {
    const field = line instanceof Info_line ? fieldKeyAndValue(line) : null;
    if (field !== null && field.key === "V") return voiceIdOf(field.value);
  }
  return "";
}

/**
 * Splits the body into lines and tells which voice each line belongs to.
 *
 * Because the parser groups the lines of all the voices written one under the other into a single system,
 * we start a new line at each voice field, so every line holds the bars of one voice only.
 * Because the music written before any voice field belongs to the first voice of the header, the body starts in that voice.
 */
function readBodyLines(tune: Tune): BodyLine[] {
  const lines: BodyLine[] = [];
  let voice = firstHeaderVoice(tune);
  for (const system of tune.tune_body?.sequence ?? []) {
    let current: BodyLine = { voice, nodes: [] };
    for (const node of system) {
      const field = fieldKeyAndValue(node);
      if (field !== null && field.key === "V") {
        if (current.nodes.length > 0) lines.push(current);
        voice = voiceIdOf(field.value);
        current = { voice, nodes: [] };
      }
      current.nodes.push(node);
    }
    if (current.nodes.length > 0) lines.push(current);
  }
  return lines;
}

function chooseChordVoice(lines: BodyLine[], requested: string | undefined): string {
  if (requested !== undefined) return requested;
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const node of line.nodes) {
      if (node instanceof AbcAnnotation && isChordSymbolText(annotationBody(node.text.lexeme))) {
        counts.set(line.voice, (counts.get(line.voice) ?? 0) + 1);
      }
    }
  }
  let best = "";
  let bestCount = -1;
  for (const [voice, count] of counts) {
    if (count > bestCount) {
      best = voice;
      bestCount = count;
    }
  }
  return best;
}

function holdsMusic(node: Expr): boolean {
  return (
    node instanceof Note || node instanceof Rest || node instanceof MultiMeasureRest || node instanceof Chord || node instanceof Beam || node instanceof Tuplet
  );
}

/** The chords each bar of a line names, bar by bar. */
function chordsByBar(line: BodyLine, ctx: ABCContext): ParsedChord[][] {
  const bars: ParsedChord[][] = [[]];
  for (const node of line.nodes) {
    if (node instanceof BarLine) {
      bars.push([]);
    } else if (node instanceof AbcAnnotation) {
      const text = annotationBody(node.text.lexeme);
      if (isChordSymbolText(text)) {
        const chord = readChord(text, ctx, node.text.position);
        if (chord !== null) bars[bars.length - 1].push(chord);
      }
    }
  }
  return bars;
}

/** State that follows the chord voice from line to line. */
interface VoiceState {
  lastChords: ParsedChord[];
  neighbourBars: ParsedChord[][] | null;
}

function pushChordCells(walk: Walk, chords: ParsedChord[]): void {
  for (const chord of chords) walk.cells.push({ kind: "chord", chord, small: false, slot: walk.cells.length });
}

function readChordLine(line: BodyLine, walk: Walk, state: VoiceState, ctx: ABCContext): void {
  let barIndex = 0;
  let hasMusic = false;

  for (const node of line.nodes) {
    if (node instanceof AbcAnnotation) {
      const text = annotationBody(node.text.lexeme);
      if (isChordSymbolText(text)) {
        const chord = readChord(text, ctx, node.text.position);
        if (chord !== null) {
          walk.cells.push({ kind: "chord", chord, small: false, slot: walk.cells.length });
          state.lastChords = [chord];
        }
        continue;
      }
      const marker = navigationMarker(text);
      if (marker === "segno") walk.navigation.segnoSectionIndex = walk.sections.length;
      else if (marker === "coda") walk.navigation.codaSectionIndex = walk.sections.length;
      else walk.annotations.push({ text, position: node.text.position });
    } else if (node instanceof BarLine) {
      if (walk.cells.length === 0 && hasMusic) {
        const neighbour = state.neighbourBars?.[barIndex] ?? [];
        if (neighbour.length > 0) {
          pushChordCells(walk, neighbour);
          state.lastChords = [neighbour[neighbour.length - 1]];
        } else if (state.lastChords.length > 0) {
          pushChordCells(walk, state.lastChords);
        } else {
          walk.cells.push({ kind: "noChord", small: false, slot: 0 });
        }
      }
      readBarLine(node, walk);
      barIndex++;
      hasMusic = false;
    } else if (!(node instanceof Comment)) {
      const field = fieldKeyAndValue(node);
      if (field !== null) {
        if (field.key === "P" || field.key === "M") applyField(field.key, meterAsFraction(field.key, field.value), field.position, walk, ctx);
      } else if (holdsMusic(node)) {
        hasMusic = true;
      }
    }
  }

  if (walk.cells.length > 0 && !hasMusic) {
    report(ctx, "A chord with no music after the last bar line of its line is left out of the iReal Pro chart", "chord", 0);
    walk.cells = [];
    walk.annotations = [];
  }
}

/** Reads the part and meter fields of a line that is not the chord voice. */
function readOtherLine(line: BodyLine, walk: Walk, ctx: ABCContext): void {
  for (const node of line.nodes) {
    const field = fieldKeyAndValue(node);
    if (field !== null && (field.key === "P" || field.key === "M")) applyField(field.key, meterAsFraction(field.key, field.value), field.position, walk, ctx);
  }
}

/**
 * Writes the common time and cut time symbols ("C" and "C|") of a meter field as the fractions they stand for.
 * Because the iReal Pro grid only reads fractions, every M: field (in the header, in the body or inline) goes through it.
 */
function meterAsFraction(key: string, value: string): string {
  if (key !== "M") return value;
  return value === "C" ? "4/4" : value === "C|" ? "2/2" : value;
}

/** The meter the header gives, as a time signature, with "C" and "C|" read as common and cut time. */
function headerMeter(tune: Tune, walk: Walk, ctx: ABCContext): void {
  for (const line of tune.tune_header.info_lines) {
    if (!(line instanceof Info_line) || line.key.lexeme !== "M:") continue;
    const value = meterAsFraction(
      "M",
      line.value
        .map((token) => token.lexeme)
        .join("")
        .trim()
    );
    if (parseMeter(value, ctx, line.key.position) !== null) applyField("M", value, line.key.position, walk, ctx);
    return;
  }
}

export function abcTuneToIrealChart(tune: Tune, ctx: ABCContext, options: AbcToIrealOptions = {}): IrealChart {
  const walk = createWalk();
  headerMeter(tune, walk, ctx);

  const lines = readBodyLines(tune);
  const chordVoice = chooseChordVoice(lines, options.voice);
  const state: VoiceState = { lastChords: [], neighbourBars: null };

  for (const line of lines) {
    if (line.voice !== chordVoice) {
      readOtherLine(line, walk, ctx);
      state.neighbourBars = chordsByBar(line, ctx);
    } else {
      readChordLine(line, walk, state, ctx);
      state.neighbourBars = null;
    }
  }

  flushBar(walk);
  closeSection(walk);
  return { sections: walk.sections, navigation: walk.navigation, annotations: walk.chartAnnotations };
}
