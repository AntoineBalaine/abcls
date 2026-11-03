import { MAJOR_KEY_SHARPS, MODE_FIFTH_OFFSET } from "../music-theory/constants";
import { getKeyAccidentalFor } from "../music-theory/harmonization";
import {
  Tune,
  Staff,
  StaffSystem,
  VoiceElement,
  isMusicLine,
  isNoteElement,
  NoteElement,
  isBarElement,
  isKeyElement,
  isMeterElement,
  isClefElement,
  ClefType,
  BracketBracePosition,
  KeySignature,
  Meter,
  MeterType,
  AccidentalType,
  Decorations,
} from "../types/abcjs-ast";
import { IRational, createRational, findGCD, multiplyRational } from "../Visitors/fmt/rational";
import { parseChordSymbol } from "./chordSymbols";
import { ARTICULATION_MAP, ORNAMENT_MAP } from "./decorationMap";
import { ScorePartwiseIR, PartIR, PartListEntryIR, MeasureIR, NoteIR, AttributesIR, PitchIR, NotationsIR, HarmonyIR, TimeModificationIR } from "./ir";

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / findGCD(Math.abs(a), Math.abs(b));
}

/**
 * The timing of a note element in a MusicXML export.
 * Because the interpreter keeps the written length of a tuplet note and records the tuplet ratio apart,
 * the length that sounds is the written length scaled by q/p, and the tuplet itself becomes a <time-modification>.
 */
export interface NoteTiming {
  duration: IRational;
  timeModification?: TimeModificationIR;
  tupletStart?: boolean;
  tupletStop?: boolean;
}

/**
 * The tuplet in progress while walking one voice: its p and q values, and the number of notes it still covers.
 */
export interface TupletWalkState {
  p: number;
  q: number;
  notesLeft: number;
}

/**
 * Computes the timing of every note element of one voice.
 * Because ABC counts the rests of a tuplet among its r elements, a rest that follows the start of a tuplet is scaled too.
 */
export function computeNoteTimings(voiceElements: VoiceElement[]): Map<NoteElement, NoteTiming> {
  const timings = new Map<NoteElement, NoteTiming>();
  const tuplet: TupletWalkState = { p: 0, q: 0, notesLeft: 0 };
  for (const element of voiceElements) {
    if (!isNoteElement(element)) continue;
    if (element.startTriplet !== undefined && element.startTriplet > 0) {
      tuplet.p = element.startTriplet;
      tuplet.q = element.tripletMultiplier !== undefined ? Math.round(element.tripletMultiplier * element.startTriplet) : element.startTriplet;
      tuplet.notesLeft = element.tripletR ?? element.startTriplet;
      timings.set(element, timingInTuplet(element, tuplet, true));
      continue;
    }
    if (tuplet.notesLeft > 0) {
      timings.set(element, timingInTuplet(element, tuplet, false));
      continue;
    }
    timings.set(element, { duration: element.duration });
  }
  return timings;
}

/**
 * Builds the timing of a note that a tuplet covers, and counts the note against the tuplet.
 */
export function timingInTuplet(element: NoteElement, tuplet: TupletWalkState, isFirst: boolean): NoteTiming {
  tuplet.notesLeft -= 1;
  const timing: NoteTiming = {
    duration: multiplyRational(element.duration, createRational(tuplet.q, tuplet.p)),
    timeModification: { actualNotes: tuplet.p, normalNotes: tuplet.q },
  };
  if (isFirst) timing.tupletStart = true;
  if (tuplet.notesLeft === 0) timing.tupletStop = true;
  return timing;
}

export function computeDivisions(tune: Tune): number {
  const denominators: number[] = [];
  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    for (const staff of system.staff) {
      for (const voice of staff.voices) {
        for (const timing of computeNoteTimings(voice).values()) {
          if (timing.duration) denominators.push(timing.duration.denominator);
        }
      }
    }
  }
  if (denominators.length === 0) return 1;
  return denominators.reduce((acc, d) => lcm(acc, d), 1);
}

export function splitVoiceIntoMeasures(voiceElements: VoiceElement[]): VoiceElement[][] {
  const measures: VoiceElement[][] = [[]];
  let hasContent = false;
  for (const element of voiceElements) {
    if (isBarElement(element)) {
      // Because a barline that arrives while the current measure is still
      // empty (an opening repeat right after a closing barline, or at the
      // very start) does not close a measure, we skip it, which avoids
      // exporting a spurious empty measure.
      if (!hasContent) continue;
      measures.push([]);
      hasContent = false;
    } else {
      hasContent = true;
      measures[measures.length - 1].push(element);
    }
  }
  if (measures.length > 1 && measures[measures.length - 1].length === 0) {
    measures.pop();
  }
  return measures;
}

/**
 * Because splitVoiceIntoMeasures discards the system boundaries, we need a separate
 * pass to learn which measures start a new system. `systemStartElements` holds the
 * index of the first element of every system after the first one, in the joined voice.
 * A system that starts in the middle of a measure (a source line that does not end
 * with a barline) starts no new MusicXML system, because MusicXML can only break
 * between measures.
 */
export function findSystemStartMeasureIndexes(voiceElements: VoiceElement[], systemStartElements: Set<number>): Set<number> {
  const starts = new Set<number>();
  let measureIndex = 0;
  let hasContent = false;
  voiceElements.forEach((element, elementIndex) => {
    if (systemStartElements.has(elementIndex) && !hasContent && measureIndex > 0) starts.add(measureIndex);
    if (!isBarElement(element)) {
      hasContent = true;
      return;
    }
    // Mirrors splitVoiceIntoMeasures, which skips a barline that follows no content.
    if (!hasContent) return;
    hasContent = false;
    measureIndex++;
  });
  return starts;
}

interface CollectedStaff {
  representative: Staff;
  voices: VoiceElement[][];
  /** For each voice, the index in the joined voice of the first element of every system after the first one. */
  systemStartElements: Set<number>[];
}

function collectContinuousVoicesByStaff(tune: Tune): CollectedStaff[] {
  const musicSystems = tune.systems.filter(isMusicLine) as StaffSystem[];
  const staffCount = musicSystems.reduce((max, s) => Math.max(max, s.staff.length), 0);
  const result: CollectedStaff[] = [];
  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    let representative: Staff | undefined;
    let voiceCount = 0;
    for (const system of musicSystems) {
      const staff = system.staff[staffIndex];
      if (!staff) continue;
      if (!representative) representative = staff;
      voiceCount = Math.max(voiceCount, staff.voices.length);
    }
    const voices: VoiceElement[][] = Array.from({ length: voiceCount }, () => []);
    const systemStartElements: Set<number>[] = Array.from({ length: voiceCount }, () => new Set<number>());
    for (const system of musicSystems) {
      const staff = system.staff[staffIndex];
      if (!staff) continue;
      staff.voices.forEach((voiceElements, voiceIndex) => {
        // Because each line of music is its own system, the start of every system after the first one is a line break.
        if (voices[voiceIndex].length > 0) systemStartElements[voiceIndex].add(voices[voiceIndex].length);
        voices[voiceIndex].push(...voiceElements);
      });
    }
    if (representative) {
      result.push({ representative, voices, systemStartElements });
    }
  }
  return result;
}

const MODE_NAME: Record<string, string> = {
  "": "major",
  m: "minor",
  Dor: "dorian",
  Mix: "mixolydian",
  Loc: "locrian",
  Phr: "phrygian",
  Lyd: "lydian",
};

/**
 * Counts the sharps (positive) or flats (negative) of a key signature.
 * Because a mode shares its signature with the major key a fixed number of fifths away (D dorian has the signature of
 * C major), the count is the one of the tonic's major key, shifted by the mode's offset.
 */
export function keySignatureToFifths(key: KeySignature): number {
  const majorSharps = MAJOR_KEY_SHARPS[`${key.root}${key.acc}`];
  if (majorSharps === undefined) return 0;
  return majorSharps + (MODE_FIFTH_OFFSET[key.mode] ?? 0);
}

export function keySignatureToModeName(key: KeySignature): string {
  return MODE_NAME[key.mode] ?? "major";
}

export function meterToBeatsAndType(meter: Meter | undefined): { beats: string; beatType: string; symbol?: "common" | "cut" } {
  if (!meter || !meter.value || meter.value.length === 0) {
    if (meter?.type === MeterType.CutTime) return { beats: "2", beatType: "2", symbol: "cut" };
    if (meter?.type === MeterType.CommonTime) return { beats: "4", beatType: "4", symbol: "common" };
    return { beats: "4", beatType: "4" };
  }
  const total = meter.value.reduce((sum, r) => sum + r.numerator, 0);
  const denominator = meter.value[0].denominator;
  // MeterType.CommonTime/CutTime is also used for ABC mensural symbols
  // (o, c, o., c.), whose values are not 4/4 or 2/2, so the symbol is only
  // emitted when the value actually reduces to a whole note.
  // Because a fraction reduces to 1 only when its numerator equals its denominator, no reduction is needed.
  const reducesToWholeNote = total !== 0 && total === denominator;
  const isGenuineCommonTime = meter.type === MeterType.CommonTime && reducesToWholeNote;
  const isGenuineCutTime = meter.type === MeterType.CutTime && reducesToWholeNote;
  const symbol = isGenuineCommonTime ? "common" : isGenuineCutTime ? "cut" : undefined;
  return { beats: String(total), beatType: String(denominator), symbol };
}

const CLEF_SIGN: Partial<Record<ClefType, { sign: string; line: number; octaveChange?: number }>> = {
  [ClefType.Treble]: { sign: "G", line: 2 },
  [ClefType.TreblePlus8]: { sign: "G", line: 2, octaveChange: 1 },
  [ClefType.TrebleMinus8]: { sign: "G", line: 2, octaveChange: -1 },
  [ClefType.Bass]: { sign: "F", line: 4 },
  [ClefType.BassPlus8]: { sign: "F", line: 4, octaveChange: 1 },
  [ClefType.BassMinus8]: { sign: "F", line: 4, octaveChange: -1 },
  [ClefType.Alto]: { sign: "C", line: 3 },
  [ClefType.AltoPlus8]: { sign: "C", line: 3, octaveChange: 1 },
  [ClefType.AltoMinus8]: { sign: "C", line: 3, octaveChange: -1 },
  [ClefType.Tenor]: { sign: "C", line: 4 },
  [ClefType.TenorPlus8]: { sign: "C", line: 4, octaveChange: 1 },
  [ClefType.TenorMinus8]: { sign: "C", line: 4, octaveChange: -1 },
  [ClefType.Perc]: { sign: "percussion", line: 2 },
};

export function diatonicToStepOctave(pitchNumber: number): { step: string; octave: number } {
  const steps = ["C", "D", "E", "F", "G", "A", "B"];
  const stepIndex = ((pitchNumber % 7) + 7) % 7;
  const step = steps[stepIndex];
  const octave = 4 + Math.floor(pitchNumber / 7);
  return { step, octave };
}

const ACCIDENTAL_TO_ALTER: Partial<Record<AccidentalType, number>> = {
  [AccidentalType.Sharp]: 1,
  [AccidentalType.Flat]: -1,
  [AccidentalType.Natural]: 0,
  [AccidentalType.DblSharp]: 2,
  [AccidentalType.DblFlat]: -2,
  [AccidentalType.QuarterSharp]: 0.5,
  [AccidentalType.QuarterFlat]: -0.5,
};

const ACCIDENTAL_TO_XML: Partial<Record<AccidentalType, string>> = {
  [AccidentalType.Sharp]: "sharp",
  [AccidentalType.Flat]: "flat",
  [AccidentalType.Natural]: "natural",
  [AccidentalType.DblSharp]: "double-sharp",
  [AccidentalType.DblFlat]: "flat-flat",
  [AccidentalType.QuarterSharp]: "quarter-sharp",
  [AccidentalType.QuarterFlat]: "quarter-flat",
};

export function accidentalToAlter(accidental: AccidentalType | undefined): number | undefined {
  if (accidental === undefined) return undefined;
  return ACCIDENTAL_TO_ALTER[accidental];
}

/**
 * What decides the sounding pitch of the notes of one voice, beyond their written accidental.
 * Because MusicXML's <alter> gives the pitch that sounds, while an ABC note without an accidental takes its
 * alteration from the key signature, from an earlier accidental on the same pitch in the bar, or from the note it is
 * tied from, the export carries these three sources from note to note.
 */
export interface VoicePitchState {
  key: KeySignature;
  /** The alterations written earlier in the current bar, by diatonic pitch number. Cleared at each new measure. */
  barAlters: Map<number, number>;
  /** The alteration of each note whose tie continues into the next note, by diatonic pitch number. */
  tiedAlters: Map<number, number>;
}

export function createVoicePitchState(key: KeySignature): VoicePitchState {
  return { key, barAlters: new Map(), tiedAlters: new Map() };
}

/**
 * Computes the alteration that a pitch sounds with, and records it for the notes that follow.
 * A written accidental wins; otherwise a tie carries the alteration of the note it comes from, then an accidental
 * written earlier in the bar on the same pitch, and finally the key signature.
 */
export function soundingAlter(pitchNumber: number, accidental: AccidentalType | undefined, endTie: boolean, startTie: boolean, state: VoicePitchState): number {
  const written = accidentalToAlter(accidental);
  let alter: number;
  if (written !== undefined) {
    alter = written;
    state.barAlters.set(pitchNumber, written);
  } else if (endTie && state.tiedAlters.has(pitchNumber)) {
    alter = state.tiedAlters.get(pitchNumber)!;
  } else if (state.barAlters.has(pitchNumber)) {
    alter = state.barAlters.get(pitchNumber)!;
  } else {
    alter = getKeyAccidentalFor(diatonicToStepOctave(pitchNumber).step, state.key);
  }
  if (startTie) state.tiedAlters.set(pitchNumber, alter);
  else state.tiedAlters.delete(pitchNumber);
  return alter;
}

function buildPitchIR(pitchNumber: number, alter: number): PitchIR {
  const { step, octave } = diatonicToStepOctave(pitchNumber);
  return alter === 0 ? { step, octave } : { step, octave, alter };
}

function accidentalToXml(accidental: AccidentalType | undefined): string | undefined {
  return accidental === undefined ? undefined : ACCIDENTAL_TO_XML[accidental];
}

// <fermata> is a direct child of <notations>; up-bow/down-bow belong under
// <technical>, not <articulations>.
const FERMATA_TYPE: Partial<Record<Decorations, "upright" | "inverted">> = {
  [Decorations.Fermata]: "upright",
  [Decorations.InvertedFermata]: "inverted",
};
const TECHNICAL_DECORATIONS = new Set<Decorations>([Decorations.Upbow, Decorations.Downbow]);

function buildNotationsIR(decoration: Decorations[] | undefined, startSlurs: number[], endSlurs: number[]): NotationsIR | undefined {
  const notations: NotationsIR = {};
  if (startSlurs.length > 0) notations.slurStarts = startSlurs;
  if (endSlurs.length > 0) notations.slurStops = endSlurs;
  if (decoration) {
    for (const d of decoration) {
      const fermataType = FERMATA_TYPE[d];
      if (fermataType) {
        notations.fermata = fermataType;
        continue;
      }
      if (TECHNICAL_DECORATIONS.has(d)) {
        notations.technical = [...(notations.technical ?? []), ARTICULATION_MAP[d]!];
        continue;
      }
      const articulation = ARTICULATION_MAP[d];
      const ornament = ORNAMENT_MAP[d];
      if (articulation) {
        notations.articulations = [...(notations.articulations ?? []), articulation];
      }
      if (ornament) {
        notations.ornaments = [...(notations.ornaments ?? []), ornament];
      }
    }
  }
  const hasContent = notations.slurStarts || notations.slurStops || notations.articulations || notations.ornaments || notations.technical || notations.fermata;
  return hasContent ? notations : undefined;
}

function rationalToDivisions(duration: IRational, divisions: number): number {
  return Math.round((duration.numerator * divisions * 4) / duration.denominator);
}

function buildMeasureAttributes(elements: VoiceElement[], divisions: number | undefined): AttributesIR | undefined {
  const attrs: AttributesIR = {};
  let has = false;
  if (divisions !== undefined) {
    attrs.divisions = divisions;
    has = true;
  }
  for (const element of elements) {
    if (isKeyElement(element)) {
      attrs.keyFifths = keySignatureToFifths({ root: element.root, acc: element.acc, mode: element.mode, accidentals: element.accidentals });
      attrs.keyMode = keySignatureToModeName({ root: element.root, acc: element.acc, mode: element.mode, accidentals: element.accidentals });
      has = true;
    }
    if (isMeterElement(element)) {
      const { beats, beatType, symbol } = meterToBeatsAndType({ type: element.type, value: element.value, beat_division: element.beat_division });
      attrs.timeBeats = beats;
      attrs.timeBeatType = beatType;
      attrs.timeSymbol = symbol;
      has = true;
    }
    if (isClefElement(element)) {
      const mapped = CLEF_SIGN[element.type];
      if (mapped) {
        attrs.clefSign = mapped.sign;
        attrs.clefLine = mapped.line;
        if (mapped.octaveChange) attrs.clefOctaveChange = mapped.octaveChange;
        has = true;
      }
    }
  }
  return has ? attrs : undefined;
}

/**
 * Gives each open slur one of MusicXML's slur numbers (1 to 16).
 * Because MusicXML cannot number more than 16 slurs that are open at once, an overflow is recorded in `errors`,
 * and the export fails with it rather than reusing a number that is still open.
 */
export class SlurNumberAllocator {
  available: number[] = Array.from({ length: 16 }, (_, i) => 16 - i);
  assigned = new Map<string, number>();
  errors: string[];

  constructor(errors: string[]) {
    this.errors = errors;
  }

  start(voiceNumber: number, abcjsLabel: number): number {
    const key = `${voiceNumber}:${abcjsLabel}`;
    let num = this.assigned.get(key);
    if (num === undefined) {
      if (this.available.length === 0) {
        this.errors.push(`Cannot export voice ${voiceNumber}: more than 16 slurs are open at once, which MusicXML's slur numbering cannot represent.`);
        return 16;
      }
      num = this.available.pop()!;
      this.assigned.set(key, num);
    }
    return num;
  }

  stop(voiceNumber: number, abcjsLabel: number): number {
    const key = `${voiceNumber}:${abcjsLabel}`;
    const num = this.assigned.get(key);
    if (num === undefined) return abcjsLabel;
    this.assigned.delete(key);
    this.available.push(num);
    return num;
  }
}

/**
 * Converts the chord symbols of a note or rest into harmonies. Text that is
 * not a chord symbol (a positioned annotation such as "^allegro") is
 * skipped, because a <harmony> cannot carry it.
 */
function buildHarmoniesIR(element: NoteElement): HarmonyIR[] | undefined {
  const harmonies: HarmonyIR[] = [];
  for (const chord of element.chord ?? []) {
    const harmony = parseChordSymbol(chord.name);
    if (harmony) harmonies.push(harmony);
  }
  return harmonies.length > 0 ? harmonies : undefined;
}

/**
 * What buildVoiceMeasureNotes needs from the voice beyond the measure itself.
 */
export interface VoiceMeasureContext {
  voiceNumber: number;
  divisions: number;
  slurAllocator: SlurNumberAllocator;
  pitchState: VoicePitchState;
  timings: Map<NoteElement, NoteTiming>;
}

function buildVoiceMeasureNotes(measureElements: VoiceElement[], context: VoiceMeasureContext): NoteIR[] {
  const notes: NoteIR[] = [];
  const { voiceNumber, divisions, slurAllocator, pitchState } = context;
  // Because an accidental lasts until the end of its bar, each measure starts without any.
  pitchState.barAlters.clear();
  for (const element of measureElements) {
    if (isKeyElement(element)) {
      pitchState.key = { root: element.root, acc: element.acc, mode: element.mode, accidentals: element.accidentals };
      continue;
    }
    if (!isNoteElement(element)) continue;
    // Because a harmony sounds with the first <note> of its element (a grace
    // note when there is one), it is attached to the first IR pushed for it.
    const firstIndexOfElement = notes.length;
    const timing = context.timings.get(element) ?? { duration: element.duration };
    const durationInDivisions = rationalToDivisions(timing.duration, divisions);
    if (element.rest || !element.pitches || element.pitches.length === 0) {
      notes.push({
        kind: "note",
        voice: voiceNumber,
        duration: durationInDivisions,
        rest: true,
        timeModification: timing.timeModification,
        notations: addTupletNotations(undefined, timing),
      });
      attachHarmonies(notes, firstIndexOfElement, element);
      continue;
    }
    for (const g of element.gracenotes ?? []) {
      const alter = soundingAlter(g.pitch, g.accidental, false, false, pitchState);
      notes.push({
        kind: "note",
        voice: voiceNumber,
        pitch: buildPitchIR(g.pitch, alter),
        accidental: accidentalToXml(g.accidental),
        grace: { slash: !!g.acciaccatura },
      });
    }
    for (let i = 0; i < element.pitches.length; i++) {
      const pitch = element.pitches[i];
      const startLabels = (pitch.startSlur ?? []).map((s) => s.label).filter((label): label is number => label !== undefined);
      const endLabels = pitch.endSlur ?? [];
      const startSlurs = startLabels.map((label) => slurAllocator.start(voiceNumber, label));
      const endSlurs = endLabels.map((label) => slurAllocator.stop(voiceNumber, label));
      const alter = soundingAlter(pitch.pitch, pitch.accidental, pitch.endTie !== undefined, pitch.startTie !== undefined, pitchState);
      const notations = buildNotationsIR(element.decoration, startSlurs, endSlurs);
      const withTuplet = i === 0 ? addTupletNotations(notations, timing) : notations;
      notes.push({
        kind: "note",
        voice: voiceNumber,
        duration: durationInDivisions,
        pitch: buildPitchIR(pitch.pitch, alter),
        accidental: accidentalToXml(pitch.accidental),
        timeModification: timing.timeModification,
        chord: i > 0 ? true : undefined,
        tieStart: pitch.startTie ? true : undefined,
        tieStop: pitch.endTie ? true : undefined,
        notations: withTuplet,
      });
    }
    attachHarmonies(notes, firstIndexOfElement, element);
  }
  return notes;
}

/**
 * Adds the <tuplet> start and stop marks of a note's timing to its notations, so that readers draw the bracket.
 */
function addTupletNotations(notations: NotationsIR | undefined, timing: NoteTiming): NotationsIR | undefined {
  if (!timing.tupletStart && !timing.tupletStop) return notations;
  const result: NotationsIR = { ...(notations ?? {}) };
  if (timing.tupletStart) result.tupletStart = true;
  if (timing.tupletStop) result.tupletStop = true;
  return result;
}

/**
 * Completes the attributes of the first measure with the clef, key and meter of the staff.
 * Because the interpreter stores the header's K:, M: and clef on the staff rather than as elements of the voices,
 * the first measure would otherwise carry no key, time or clef, and every reader would assume C major in 4/4.
 */
export function addStaffStartAttributes(attributes: AttributesIR, staff: Staff): AttributesIR {
  const result = { ...attributes };
  if (result.keyFifths === undefined) {
    result.keyFifths = keySignatureToFifths(staff.key);
    result.keyMode = keySignatureToModeName(staff.key);
  }
  if (result.timeBeats === undefined && staff.meter !== undefined) {
    const { beats, beatType, symbol } = meterToBeatsAndType(staff.meter);
    result.timeBeats = beats;
    result.timeBeatType = beatType;
    result.timeSymbol = symbol;
  }
  const clef = staff.clef?.type !== undefined ? CLEF_SIGN[staff.clef.type] : undefined;
  if (result.clefSign === undefined && clef !== undefined) {
    result.clefSign = clef.sign;
    result.clefLine = clef.line;
    if (clef.octaveChange) result.clefOctaveChange = clef.octaveChange;
  }
  return result;
}

function attachHarmonies(notes: NoteIR[], firstIndexOfElement: number, element: NoteElement): void {
  const harmonies = buildHarmoniesIR(element);
  if (harmonies && notes[firstIndexOfElement]) notes[firstIndexOfElement].harmonies = harmonies;
}

function buildPart(collected: CollectedStaff, partId: string, divisions: number, errors: string[]): PartIR {
  const voiceMeasures = collected.voices.map((v) => splitVoiceIntoMeasures(v));
  const systemStarts = new Set<number>();
  collected.voices.forEach((voice, voiceIndex) => {
    for (const index of findSystemStartMeasureIndexes(voice, collected.systemStartElements[voiceIndex])) systemStarts.add(index);
  });
  // MusicXML's <part> requires minOccurs="1" on <measure>.
  const measureCount = Math.max(
    1,
    voiceMeasures.reduce((max, m) => Math.max(max, m.length), 0)
  );
  const slurAllocator = new SlurNumberAllocator(errors);
  const voiceContexts: VoiceMeasureContext[] = collected.voices.map((voice, voiceIndex) => ({
    voiceNumber: voiceIndex + 1,
    divisions,
    slurAllocator,
    pitchState: createVoicePitchState(collected.representative.key),
    timings: computeNoteTimings(voice),
  }));
  const measures: MeasureIR[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const content: NoteIR[] = [];
    let cursor = 0;
    for (let voiceIndex = 0; voiceIndex < voiceMeasures.length; voiceIndex++) {
      const measureElements = voiceMeasures[voiceIndex][measureIndex];
      if (!measureElements) continue;
      if (cursor !== 0) {
        content.push({ kind: "backup", duration: cursor });
        cursor = 0;
      }
      const voiceNotes = buildVoiceMeasureNotes(measureElements, voiceContexts[voiceIndex]);
      content.push(...voiceNotes);
      cursor = voiceNotes.reduce((sum, n) => sum + (n.grace || n.chord ? 0 : (n.duration ?? 0)), 0);
    }
    const attributeSourceElements = voiceMeasures.flatMap((vm) => vm[measureIndex] ?? []);
    const attributes =
      measureIndex === 0
        ? addStaffStartAttributes(buildMeasureAttributes(attributeSourceElements, divisions) ?? {}, collected.representative)
        : buildMeasureAttributes(attributeSourceElements, undefined);
    measures.push({ number: measureIndex + 1, attributes, content, ...(systemStarts.has(measureIndex) ? { newSystem: true } : {}) });
  }
  return { id: partId, measures };
}

interface GroupSpan {
  startStaff: number;
  endStaff: number;
  symbol: "brace" | "bracket";
  barlineGroup: boolean;
}

function collectGroupSpans(staves: Staff[], accessor: (s: Staff) => BracketBracePosition | undefined, symbol: "brace" | "bracket"): GroupSpan[] {
  const spans: GroupSpan[] = [];
  let openStart: number | null = null;
  staves.forEach((staff, i) => {
    const pos = accessor(staff);
    if (pos === BracketBracePosition.Start) {
      openStart = i;
    }
    if (pos === BracketBracePosition.End && openStart !== null) {
      spans.push({ startStaff: openStart, endStaff: i, symbol, barlineGroup: !!staff.connectBarLines });
      openStart = null;
    }
  });
  return spans;
}

function buildPartList(staves: Staff[], partIds: string[]): PartListEntryIR[] {
  const braceSpans = collectGroupSpans(staves, (s) => s.brace, "brace");
  const bracketSpans = collectGroupSpans(staves, (s) => s.bracket, "bracket");
  const allSpans = [...braceSpans, ...bracketSpans];
  const spanNumbers = new Map<GroupSpan, number>();
  let groupNumberCounter = 1;
  const entries: PartListEntryIR[] = [];
  for (let i = 0; i < staves.length; i++) {
    const startingHere = allSpans.filter((s) => s.startStaff === i);
    for (const span of startingHere) {
      const num = groupNumberCounter++;
      spanNumbers.set(span, num);
      entries.push({ kind: "part-group", boundary: { kind: "start", number: num, symbol: span.symbol, barlineGroup: span.barlineGroup } });
    }
    entries.push({ kind: "score-part", part: { id: partIds[i], name: staves[i].title?.[0] ?? "" } });
    const endingHere = allSpans.filter((s) => s.endStaff === i).sort((a, b) => b.startStaff - a.startStaff);
    for (const span of endingHere) {
      entries.push({ kind: "part-group", boundary: { kind: "stop", number: spanNumbers.get(span)! } });
    }
  }
  return entries;
}

/**
 * The result of normalizeForMusicXML: the score, or the reasons why it cannot be written as MusicXML.
 */
export type NormalizeResult = { ok: true; ir: ScorePartwiseIR } | { ok: false; errors: string[] };

export function normalizeForMusicXML(tune: Tune): NormalizeResult {
  const errors: string[] = [];
  const divisions = computeDivisions(tune);
  const collected = collectContinuousVoicesByStaff(tune);
  const partIds = collected.map((_, i) => `P${i + 1}`);
  const parts = collected.map((c, i) => buildPart(c, partIds[i], divisions, errors));
  const partList = buildPartList(
    collected.map((c) => c.representative),
    partIds
  );
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, ir: { partList, parts } };
}
