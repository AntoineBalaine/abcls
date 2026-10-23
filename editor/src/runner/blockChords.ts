import { ABCContext, Scanner, SemanticAnalyzer, buildChord, parse, voicedNoteOctave } from "abcls-parser";
import { MeterType } from "abcls-parser/types/abcjs-ast";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { interpretContext } from "../context/csContextInterpreter";
import { fromAst } from "../csTree/fromAst";
import { formatNote, VoicingType } from "../transforms/harmonize";
import { WORK_VOICE_ID, assertValidVoiceIds, assertVoicesAreFree, declareVoices, findVoiceLines, rangesOfLines, relabelParts } from "./harmonizeVoices";
import { runTransform, TransformError } from "./runTransform";

export interface BlockChordsOptions {
  /** The id of the voice that carries the chord symbols. */
  chordVoice: string;
  /** The ids of the new voices, from the highest part to the lowest. There must be 4, 5 or 6 of them. */
  into: string[];
  /** The voicing of each chord. */
  voicing: VoicingType;
}

/**
 * The register in which the top voice of a chord moves: from E4 to G5.
 */
const LEAD_LOW = 64;
const LEAD_HIGH = 79;
const LEAD_START = 69;

/**
 * The state that the walk over a chord line passes from token to token.
 */
export interface SeedState {
  barUnits: number;
  /** The chord that sounds in the current span, or null before the first symbol of the bar. */
  chord: ParsedChord | null;
  /** The length of the current span, in units of the default note length. */
  spanUnits: number;
  /** The seed pitch of the previous chord, which the next top voice stays close to. */
  previousLead: number;
  /** The parts of the seed line, in order. */
  parts: string[];
}

// Because the chord line is read as text, the tokens that carry no time (comments, decorations, inline fields) are matched first.
// A bracket chord such as [CEG]2 lasts one duration, so it is matched as a whole.
const TOKEN =
  /(?<ignored>%[^\n]*|![^!\n]*!|\[[A-Za-z]:[^\]\n]*\])|"(?<annotation>[^"]*)"|(?<barline>\|\]|\|\||\[\||\|:|:\||::|\|)|(?<group>\[[^\]\n]*\])(?<groupRhythm>\d*\/*\d*)|(?<note>[_^=]*[A-Ga-g][,']*)(?<noteRhythm>\d*\/*\d*)|(?<rest>[zxXZ])(?<restRhythm>\d*\/*\d*)|(?<other>.)/gs;

/**
 * Reads the length of a rhythm suffix such as "3", "/", "3/2" or "" as a number of default note lengths.
 */
export function rhythmUnits(text: string): number {
  const match = /^(\d*)(\/*)(\d*)$/.exec(text);
  if (match === null) return 1;
  const numerator = match[1] === "" ? 1 : parseInt(match[1], 10);
  if (match[2] === "") return numerator;
  const denominator = match[3] === "" ? Math.pow(2, match[2].length) : parseInt(match[3], 10);
  return numerator / denominator;
}

/**
 * Writes a length in units of the default note length as an ABC rhythm suffix.
 */
export function unitsToRhythm(units: number): string {
  if (units === 1) return "";
  if (Number.isInteger(units)) return String(units);
  return `${Math.round(units * 64)}/64`;
}

export function parseChordText(annotation: string): ParsedChord | null {
  let text = annotation;
  if (text.length > 0 && "^_<>@".includes(text[0])) text = text.slice(1);
  const scanResult = scanChordSymbol(text);
  if (scanResult === null) return null;
  return parseChordSymbol(scanResult.tokens);
}

/**
 * Computes the length of a full bar in units of the default note length, from the meter and the note length of the tune.
 * A tune without a meter is read as 4/4.
 */
export function barLengthInUnits(source: string): number {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const snapshots = interpretContext(fromAst(ast, ctx), analyzer.data, { snapshotAccidentals: false });
  const first = snapshots.length > 0 ? snapshots[0].snapshot : null;

  let barLength = 1;
  if (first !== null && first.meter.type === MeterType.Specified && first.meter.value !== undefined) {
    barLength = first.meter.value.reduce((sum, part) => sum + part.numerator / part.denominator, 0);
  } else if (first !== null && first.meter.type === MeterType.CutTime) {
    barLength = 1;
  }
  const unit = first !== null ? first.noteLength.numerator / first.noteLength.denominator : 1 / 8;
  return Math.round(barLength / unit);
}

/**
 * Chooses the top voice of a chord: the chord tone, in the register of the top voice, that is the closest to the previous top voice.
 * The note is written with an explicit accidental, so its pitch does not depend on the key signature.
 */
export function chooseSeedNote(chord: ParsedChord, previousLead: number): { text: string; midi: number } {
  let best: { midi: number; letter: string; alteration: number } | null = null;
  for (const tone of buildChord(chord, LEAD_START)) {
    for (const shift of [-12, 0, 12]) {
      const midi = tone.midi + shift;
      if (midi < LEAD_LOW || midi > LEAD_HIGH) continue;
      if (best === null || Math.abs(midi - previousLead) < Math.abs(best.midi - previousLead)) {
        best = { midi, letter: tone.spelling.letter, alteration: tone.spelling.alteration };
      }
    }
  }
  if (best === null) {
    throw new TransformError("No chord tone fits the register of the top voice.");
  }
  const accidental = best.alteration < 0 ? "_".repeat(-best.alteration) : best.alteration > 0 ? "^".repeat(best.alteration) : "=";
  const octave = voicedNoteOctave({ spelling: { letter: best.letter as never, alteration: best.alteration }, midi: best.midi, func: 8 });
  return { text: formatNote(accidental, best.letter, octave), midi: best.midi };
}

/**
 * Writes the span that has just ended: a seed note with the length of the span, or a rest before the first symbol.
 */
export function flushSpan(state: SeedState): void {
  if (state.spanUnits <= 0) return;
  if (state.chord === null) {
    state.parts.push(`z${unitsToRhythm(state.spanUnits)}`);
  } else {
    const seed = chooseSeedNote(state.chord, state.previousLead);
    state.previousLead = seed.midi;
    state.parts.push(`${seed.text}${unitsToRhythm(state.spanUnits)}`);
  }
  state.spanUnits = 0;
}

/**
 * Turns the text of a chord line (what follows the "[V:id]" marker) into a line of seed notes,
 * with one note per chord symbol, as long as the symbol lasts. The barlines are kept as they are,
 * so the seed line has the same bars as the chord line.
 */
export function seedLine(body: string, state: SeedState): string {
  state.parts = [];
  for (const match of body.matchAll(TOKEN)) {
    const groups = match.groups!;
    if (groups.annotation !== undefined) {
      const chord = parseChordText(groups.annotation);
      if (chord !== null) {
        flushSpan(state);
        state.chord = chord;
      }
    } else if (groups.barline !== undefined) {
      flushSpan(state);
      state.chord = null;
      state.parts.push(groups.barline);
    } else if (groups.group !== undefined) {
      state.spanUnits += rhythmUnits(groups.groupRhythm);
    } else if (groups.note !== undefined) {
      state.spanUnits += rhythmUnits(groups.noteRhythm);
    } else if (groups.rest !== undefined) {
      state.spanUnits += groups.rest === "X" || groups.rest === "Z" ? state.barUnits * rhythmUnits(groups.restRhythm) : rhythmUnits(groups.restRhythm);
    }
  }
  flushSpan(state);
  state.chord = null;
  return state.parts.join(" ");
}

/**
 * Moves each block of new voices after the other voices of its system, so that the new voices
 * are written below the melody instead of between the chord voice and the melody.
 * A system starts at a line of the chord voice, so the next line of the chord voice ends the system.
 */
export function placeBlocksAfterSystems(lines: string[], into: string[], chordVoice: string): string[] {
  const isNew = (line: string) => into.some((id) => line.startsWith(`[V:${id}]`));
  const isChordLine = (line: string) => line.startsWith(`[V:${chordVoice}]`);
  const isVoiceLine = (line: string) => line.startsWith("[V:");
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!isNew(lines[index])) {
      result.push(lines[index]);
      index += 1;
      continue;
    }
    const block: string[] = [];
    while (index < lines.length && isNew(lines[index])) {
      block.push(lines[index]);
      index += 1;
    }
    while (index < lines.length && isVoiceLine(lines[index]) && !isNew(lines[index]) && !isChordLine(lines[index])) {
      result.push(lines[index]);
      index += 1;
    }
    result.push(...block);
  }
  return result;
}

/**
 * Builds one block chord for every chord symbol of a voice, in new voices.
 * The melody is not harmonized: each symbol becomes a chord of its own tones, for as long as the symbol lasts.
 *
 * The steps are: write a line of seed notes (one per symbol), build a chord under each seed note,
 * split the chords into one line per part, and keep every part as a new voice.
 */
export function blockChords(source: string, options: BlockChordsOptions): string {
  const partCount = options.into.length;
  assertValidVoiceIds(options.into, 4, 6);
  assertVoicesAreFree(source, options.into);
  const sourceLines = source.split("\n");
  if (findVoiceLines(sourceLines, options.chordVoice).length === 0) {
    throw new TransformError(`No line starts with the inline voice marker "[V:${options.chordVoice}]".`);
  }

  const marker = `[V:${options.chordVoice}]`;
  const state: SeedState = { barUnits: barLengthInUnits(source), chord: null, spanUnits: 0, previousLead: LEAD_START, parts: [] };
  const withSeeds: string[] = [];
  const seedLines: number[] = [];
  for (const line of sourceLines) {
    withSeeds.push(line);
    if (line.startsWith(marker)) {
      seedLines.push(withSeeds.length);
      withSeeds.push(`[V:${WORK_VOICE_ID}] ${seedLine(line.slice(marker.length), state)}`);
    }
  }

  let text = withSeeds.join("\n");
  const ranges = rangesOfLines(seedLines);
  text = runTransform({ source: text, transform: "harmonizeVoicing", args: [options.voicing, partCount, null], ranges });
  text = runTransform({ source: text, transform: "explode", args: [partCount], ranges });

  const parts = relabelParts(text.split("\n"), partCount, options.into, 0);
  return declareVoices(placeBlocksAfterSystems(parts, options.into, options.chordVoice).join("\n"), options.into);
}
