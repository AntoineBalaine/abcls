import { ABCContext, Scanner, SemanticAnalyzer, VoicedNote, buildChord, getAvailableTensions, parse, scoreSpreadVoicing, scoreVoiceLeading, voicedNoteOctave } from "abcls-parser";
import { DocumentSnapshots, encode, getSnapshotAtPosition } from "abcls-parser/interpreter/ContextInterpreter";
import { KeySignature, MeterType } from "abcls-parser/types/abcjs-ast";
import { TUPLET_Q, getBrokenRhythmMultipliers } from "abcls-parser/interpreter/TuneInterpreter";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { interpretContext } from "../context/csContextInterpreter";
import { fromAst } from "../csTree/fromAst";
import { formatNote, voiceChord, VoicingType } from "../transforms/harmonize";
import { NoteLetter } from "../transforms/pitchHelpers";
import { WORK_VOICE_ID, assertValidVoiceIds, assertVoicesAreFree, declareVoices, findVoiceLines, rangesOfLines, relabelParts } from "./harmonizeVoices";
import { runTransform, TransformError } from "./runTransform";

export interface BlockChordsOptions {
  /** The id of the voice that carries the chord symbols. */
  chordVoice: string;
  /** The ids of the new voices, from the highest part to the lowest. There must be 4, 5 or 6 of them. */
  into: string[];
  /** The voicing of each chord. */
  voicing: VoicingType;
  /** How the top note of each chord is chosen (default "nearest"). */
  topNote?: TopNoteRule;
  /** The kinds of chord functions that the top note should preferably be (default: none, every chord tone is equal). */
  preferLead?: LeadKind[];
  /** Receives a message for every chord that could not get the requested voicing and got a close voicing instead. */
  warnings?: string[];
}

/**
 * How the top note of each chord is chosen.
 * - "nearest": the candidate closest to the previous top note, among the preferred kinds when one of them fits.
 * - "voicing": the candidate whose voicing scores best, counting the voicing itself, the motion of the top note,
 *   and a bonus for a preferred kind. It tries every candidate, so it costs more.
 */
export type TopNoteRule = "nearest" | "voicing";

/**
 * The kinds of chord functions that the top note may be asked to prefer: the guide tones (3rd and 7th, or the sixth of a
 * 6 chord) and the tensions (9th, 11th, 13th).
 */
export type LeadKind = "guide-tones" | "tensions";

/**
 * The bonus that a preferred top note receives in the "voicing" rule, in the same unit as the voicing scores (semitones).
 */
export const PREFERRED_LEAD_BONUS = 24;

/**
 * A pitch that the top note of a chord may take, with its spelling and its function in the chord.
 */
export interface LeadCandidate {
  midi: number;
  letter: NoteLetter;
  alteration: number;
  func: number;
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
  /** The length of the last note, rest or chord, which a broken rhythm marker that follows it changes. */
  lastUnits: number;
  /** The factor that a broken rhythm applies to the next note. */
  nextMultiplier: number;
  /** The factor q/p of the tuplet in progress, and the number of notes it still applies to. */
  tupletRatio: number;
  tupletNotesLeft: number;
  /** The text of the chord symbol of the current span, for the warnings. */
  chordText: string;
  /** The key signature of the current chord line, which gives the tensions of each chord. */
  key: KeySignature | null;
  voicing: VoicingType;
  voiceCount: number;
  topNote: TopNoteRule;
  preferLead: Set<LeadKind>;
  /** The pitches of the last chord that got the requested voicing, which the next chord is led from. */
  previousVoicing: number[] | null;
  warnings: string[];
  /** The number of chords that got a close voicing because no top note could carry the requested voicing. */
  fallbacks: number;
  /** The number of the current bar of the chord voice, counted from 1, and whether it holds anything yet. */
  barNumber: number;
  barHasContent: boolean;
}

// Because the chord line is read as text, the tokens that carry no time (comments, decorations, inline fields) are matched first.
// A bracket chord such as [CEG]2 lasts one duration, so it is matched as a whole.
const TOKEN =
  /(?<ignored>%[^\n]*|![^!\n]*!|\[[A-Za-z]:[^\]\n]*\])|\((?<tupletP>\d+)(?::(?<tupletQ>\d*))?(?::(?<tupletR>\d*))?|(?<broken>[<>]+)|"(?<annotation>[^"]*)"|(?<barline>\|\]|\|\||\[\||\|:|:\||::|\|)|(?<group>\[[^\]\n]*\])(?<groupRhythm>\d*\/*\d*)|(?<note>[_^=]*[A-Ga-g][,']*)(?<noteRhythm>\d*\/*\d*)|(?<rest>[zxXZ])(?<restRhythm>\d*\/*\d*)|(?<other>.)/gs;

/**
 * Adds a note, a rest or a chord to the current span, with the factors of the broken rhythm and of the tuplet it is part of.
 * The rules are those of the interpreter, so the seed line lasts exactly as long as the chord line.
 */
export function addTimedElement(state: SeedState, baseUnits: number): void {
  state.barHasContent = true;
  let units = baseUnits * state.nextMultiplier;
  state.nextMultiplier = 1;
  if (state.tupletNotesLeft > 0) {
    units *= state.tupletRatio;
    state.tupletNotesLeft -= 1;
  }
  state.spanUnits += units;
  state.lastUnits = units;
}

/**
 * Applies a broken rhythm marker to the element that precedes it, and keeps the factor for the element that follows it.
 * Because the preceding element is still in the current span (a chord symbol between the two would end the span first),
 * we correct the span by the difference.
 */
export function applyBrokenRhythm(state: SeedState, lexeme: string): void {
  const [current, next] = getBrokenRhythmMultipliers(lexeme);
  state.spanUnits += state.lastUnits * (current.numerator / current.denominator - 1);
  state.nextMultiplier = next.numerator / next.denominator;
}

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
  return barLengthOf(interpretSource(source));
}

export function interpretSource(source: string): DocumentSnapshots {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return interpretContext(fromAst(ast, ctx), analyzer.data, { snapshotAccidentals: false });
}

export function barLengthOf(snapshots: DocumentSnapshots): number {
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
 * Returns the key signature in effect at the start of a line, or the first key of the document before any snapshot.
 */
export function keyAtLine(snapshots: DocumentSnapshots, line: number): KeySignature {
  const snapshot = getSnapshotAtPosition(snapshots, encode(line, 0)) ?? (snapshots.length > 0 ? snapshots[0].snapshot : null);
  if (snapshot === null) {
    throw new TransformError("The file has no key signature that the harmonizer can read.");
  }
  return snapshot.key;
}

/**
 * Lists the pitches that the top note of a chord may take: its chord tones and its available tensions, in the register
 * of the top voice (E4 to G5).
 */
export function leadCandidates(chord: ParsedChord, key: KeySignature): LeadCandidate[] {
  const rootPosChord = buildChord(chord, LEAD_START);
  const tones: VoicedNote[] = [...rootPosChord, ...getAvailableTensions(rootPosChord, chord, key).values()];
  const candidates: LeadCandidate[] = [];
  for (const tone of tones) {
    for (let midi = tone.midi - 24; midi <= tone.midi + 24; midi += 12) {
      if (midi < LEAD_LOW || midi > LEAD_HIGH) continue;
      candidates.push({ midi, letter: tone.spelling.letter as NoteLetter, alteration: tone.spelling.alteration, func: tone.func });
    }
  }
  return candidates.sort((a, b) => a.midi - b.midi);
}

export function isPreferredLead(candidate: LeadCandidate, preferLead: Set<LeadKind>): boolean {
  const isGuideTone = candidate.func === 3 || candidate.func === 7;
  const isTension = candidate.func === 9 || candidate.func === 11 || candidate.func === 13;
  return (isGuideTone && preferLead.has("guide-tones")) || (isTension && preferLead.has("tensions"));
}

/**
 * Scores a voicing for the choice of the top note: the spread score (which includes the voice leading) for a spread voicing,
 * and the voice leading alone for the mechanical voicings.
 */
export function scoreVoicingForLead(voicing: VoicedNote[], state: SeedState): number {
  if (state.voicing === "spread") return scoreSpreadVoicing(voicing, state.previousVoicing);
  return state.previousVoicing === null ? 0 : scoreVoiceLeading(voicing, state.previousVoicing);
}

/**
 * Writes a seed note with an explicit accidental, so its pitch does not depend on the key signature.
 */
export function seedText(candidate: LeadCandidate): string {
  const accidental = candidate.alteration < 0 ? "_".repeat(-candidate.alteration) : candidate.alteration > 0 ? "^".repeat(candidate.alteration) : "=";
  const octave = voicedNoteOctave({ spelling: { letter: candidate.letter, alteration: candidate.alteration }, midi: candidate.midi, func: 8 });
  return formatNote(accidental, candidate.letter, octave);
}

/**
 * Chooses the top note of a chord. Only the candidates that can carry the requested voicing are kept, so the choice never
 * leaves a chord without a voicing. When none can, we take the chord tone closest to the previous top note,
 * count the chord as a fallback (it gets a close voicing later) and record a warning.
 */
export function chooseSeedNote(chord: ParsedChord, state: SeedState): LeadCandidate {
  const key = state.key!;
  const candidates = leadCandidates(chord, key);
  const viable: { candidate: LeadCandidate; voicing: VoicedNote[] }[] = [];
  for (const candidate of candidates) {
    const voicing = voiceChord(chord, candidate, state.voicing, state.voiceCount, key, state.previousVoicing);
    if (voicing !== null) viable.push({ candidate, voicing });
  }

  if (viable.length === 0) {
    const chordTones = candidates.filter((c) => c.func === 8 || c.func === 3 || c.func === 5 || c.func === 7);
    const fallback = nearestCandidate(chordTones, state.previousLead);
    state.fallbacks += 1;
    state.warnings.push(`bar ${state.barNumber}: no ${state.voicing} voicing fits "${state.chordText}", so it gets a close voicing`);
    return fallback;
  }

  let chosen: { candidate: LeadCandidate; voicing: VoicedNote[] };
  if (state.topNote === "voicing") {
    chosen = viable[0];
    let bestScore = -Infinity;
    for (const option of viable) {
      let score = scoreVoicingForLead(option.voicing, state) - Math.abs(option.candidate.midi - state.previousLead);
      if (isPreferredLead(option.candidate, state.preferLead)) score += PREFERRED_LEAD_BONUS;
      if (score > bestScore) {
        bestScore = score;
        chosen = option;
      }
    }
  } else {
    const preferred = viable.filter((option) => isPreferredLead(option.candidate, state.preferLead));
    const pool = preferred.length > 0 ? preferred : viable;
    const nearest = nearestCandidate(
      pool.map((option) => option.candidate),
      state.previousLead
    );
    chosen = pool.find((option) => option.candidate === nearest)!;
  }

  state.previousVoicing = chosen.voicing.map((note) => note.midi);
  return chosen.candidate;
}

export function nearestCandidate(candidates: LeadCandidate[], previousLead: number): LeadCandidate {
  let best = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(candidate.midi - previousLead) < Math.abs(best.midi - previousLead)) best = candidate;
  }
  return best;
}

/**
 * Writes the span that has just ended: a seed note with the length of the span, or a rest before the first symbol.
 */
export function flushSpan(state: SeedState): void {
  if (state.spanUnits <= 0) return;
  if (state.chord === null) {
    state.parts.push(`z${unitsToRhythm(state.spanUnits)}`);
  } else {
    const seed = chooseSeedNote(state.chord, state);
    state.previousLead = seed.midi;
    state.parts.push(`${seedText(seed)}${unitsToRhythm(state.spanUnits)}`);
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
        state.chordText = groups.annotation;
      }
    } else if (groups.barline !== undefined) {
      flushSpan(state);
      state.chord = null;
      state.nextMultiplier = 1;
      state.tupletNotesLeft = 0;
      if (state.barHasContent) state.barNumber += 1;
      state.barHasContent = false;
      state.parts.push(groups.barline);
    } else if (groups.tupletP !== undefined) {
      const p = parseInt(groups.tupletP, 10);
      const q = groups.tupletQ ? parseInt(groups.tupletQ, 10) : TUPLET_Q[p] ?? 2;
      state.tupletRatio = q / p;
      state.tupletNotesLeft = groups.tupletR ? parseInt(groups.tupletR, 10) : p;
    } else if (groups.broken !== undefined) {
      applyBrokenRhythm(state, groups.broken);
    } else if (groups.group !== undefined) {
      addTimedElement(state, rhythmUnits(groups.groupRhythm));
    } else if (groups.note !== undefined) {
      addTimedElement(state, rhythmUnits(groups.noteRhythm));
    } else if (groups.rest !== undefined) {
      if (groups.rest === "X" || groups.rest === "Z") {
        state.barHasContent = true;
        state.spanUnits += state.barUnits * rhythmUnits(groups.restRhythm);
      } else {
        addTimedElement(state, rhythmUnits(groups.restRhythm));
      }
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
  const snapshots = interpretSource(source);
  const state: SeedState = {
    barUnits: barLengthOf(snapshots),
    chord: null,
    spanUnits: 0,
    previousLead: LEAD_START,
    parts: [],
    lastUnits: 0,
    nextMultiplier: 1,
    tupletRatio: 1,
    tupletNotesLeft: 0,
    chordText: "",
    key: null,
    voicing: options.voicing,
    voiceCount: partCount,
    topNote: options.topNote ?? "nearest",
    preferLead: new Set(options.preferLead ?? []),
    previousVoicing: null,
    warnings: options.warnings ?? [],
    fallbacks: 0,
    barNumber: 1,
    barHasContent: false,
  };
  const withSeeds: string[] = [];
  const seedLines: number[] = [];
  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    withSeeds.push(line);
    if (line.startsWith(marker)) {
      state.key = keyAtLine(snapshots, index);
      seedLines.push(withSeeds.length);
      withSeeds.push(`[V:${WORK_VOICE_ID}] ${seedLine(line.slice(marker.length), state)}`);
    }
  }

  let text = withSeeds.join("\n");
  const ranges = rangesOfLines(seedLines);
  text = runTransform({ source: text, transform: "harmonizeVoicing", args: [options.voicing, partCount, null], ranges });
  // The chords that no top note could carry in the requested voicing get a close voicing, which every chord tone can carry.
  if (state.fallbacks > 0) {
    text = runTransform({ source: text, transform: "harmonizeVoicing", args: ["close", partCount, null], ranges });
  }
  text = runTransform({ source: text, transform: "explode", args: [partCount], ranges });

  const parts = relabelParts(text.split("\n"), partCount, options.into, 0);
  return declareVoices(placeBlocksAfterSystems(parts, options.into, options.chordVoice).join("\n"), options.into);
}
