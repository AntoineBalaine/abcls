/**
 * Maps an opensheetmusicdisplay MusicSheet (the parsed representation of a
 * MusicXML score) into a Tune object, the reverse of normalizeForMusicXML.
 * A pure post-processing stage: no changes to TuneInterpreter or
 * InterpreterState, and no imports from OSMD's rendering/Graphical/layout
 * namespaces.
 */
import {
  MusicSheet,
  Instrument,
  Staff as OsmdStaff,
  Voice as OsmdVoice,
  Note as OsmdNote,
  VoiceEntry,
  SourceMeasure,
  Pitch as OsmdPitch,
  NoteEnum,
  AccidentalEnum,
  Fraction,
  ClefInstruction,
  ClefEnum,
  KeyInstruction,
  KeyEnum,
  RhythmInstruction,
  RhythmSymbolEnum,
  ArticulationEnum,
  OrnamentContainer,
  OrnamentEnum,
  Tuplet as OsmdTuplet,
  Beam,
} from "opensheetmusicdisplay";
import { createEmptyTune } from "../interpreter/InterpreterState";
import {
  Tune,
  Staff,
  StaffSystem,
  VoiceElement,
  NoteElement,
  BarElement,
  ClefElement,
  KeyElement,
  MeterElement,
  ElementType,
  ClefType,
  AccidentalType,
  Decorations,
  BracketBracePosition,
  KeySignature,
  Meter,
  MeterType,
  Mode,
  KeyRoot,
  KeyAccidental,
  RestType,
  Pitch as TunePitch,
  GraceNote,
  BarType,
  isBarElement,
} from "../types/abcjs-ast";
import { IRational, addRational, createRational, equalRational, greaterRational, subtractRational } from "../Visitors/fmt/rational";
import { INVERSE_ARTICULATION_MAP, INVERSE_ORNAMENT_MAP } from "./decorationMap";
import { UnsupportedMusicXmlFeatureError } from "./importErrors";

/**
 * OSMD's NoteEnum is chromatic (C=0, D=2, E=4, F=5, G=7, A=9, B=11), not a
 * diatonic step index. Confirmed by reading Common/DataObjects/Pitch.d.ts
 * directly; the plan's paraphrase assumed a 0-6 step index, which is wrong.
 */
const NOTE_ENUM_TO_STEP_INDEX: Record<number, number> = {
  [NoteEnum.C]: 0,
  [NoteEnum.D]: 1,
  [NoteEnum.E]: 2,
  [NoteEnum.F]: 3,
  [NoteEnum.G]: 4,
  [NoteEnum.A]: 5,
  [NoteEnum.B]: 6,
};

/** Exact inverse of phase 1's diatonicToStepOctave (normalize.ts). */
export function stepOctaveToDiatonic(stepIndex: number, octave: number): number {
  return stepIndex + (octave - 4) * 7;
}

/**
 * OSMD's Pitch.Octave is not the MusicXML octave value directly: OSMD stores
 * octave using its own internal convention, offset from MusicXML's by
 * Pitch.OctaveXmlDifference. Verified empirically against the installed
 * version: a MusicXML <octave>4</octave> (middle C's octave) comes back as
 * osmdPitch.Octave === 1, so the XML octave is
 * osmdPitch.Octave + OSMD_PITCH_OCTAVE_XML_DIFFERENCE.
 */
const OSMD_PITCH_OCTAVE_XML_DIFFERENCE = OsmdPitch.OctaveXmlDifference;

function fundamentalNoteToDiatonic(fundamentalNote: NoteEnum, octave: number): number {
  const stepIndex = NOTE_ENUM_TO_STEP_INDEX[fundamentalNote];
  return stepOctaveToDiatonic(stepIndex, octave + OSMD_PITCH_OCTAVE_XML_DIFFERENCE);
}

const ACCIDENTAL_ENUM_TO_TYPE: Partial<Record<AccidentalEnum, AccidentalType>> = {
  [AccidentalEnum.SHARP]: AccidentalType.Sharp,
  [AccidentalEnum.FLAT]: AccidentalType.Flat,
  [AccidentalEnum.NATURAL]: AccidentalType.Natural,
  [AccidentalEnum.DOUBLESHARP]: AccidentalType.DblSharp,
  [AccidentalEnum.DOUBLEFLAT]: AccidentalType.DblFlat,
  [AccidentalEnum.QUARTERTONESHARP]: AccidentalType.QuarterSharp,
  [AccidentalEnum.QUARTERTONEFLAT]: AccidentalType.QuarterFlat,
};

function accidentalEnumToType(accidental: AccidentalEnum): AccidentalType | undefined {
  if (accidental === AccidentalEnum.NONE) return undefined;
  const mapped = ACCIDENTAL_ENUM_TO_TYPE[accidental];
  if (mapped === undefined) {
    throw new UnsupportedMusicXmlFeatureError(`accidental enum value ${AccidentalEnum[accidental] ?? accidental}`);
  }
  return mapped;
}

function fractionToRational(fraction: Fraction): IRational {
  return createRational(fraction.GetExpandedNumerator(), fraction.Denominator);
}

const CLEF_ENUM_TO_TYPE: Partial<Record<ClefEnum, { base: ClefType; plus8: ClefType; minus8: ClefType }>> = {
  [ClefEnum.G]: { base: ClefType.Treble, plus8: ClefType.TreblePlus8, minus8: ClefType.TrebleMinus8 },
  [ClefEnum.F]: { base: ClefType.Bass, plus8: ClefType.BassPlus8, minus8: ClefType.BassMinus8 },
  [ClefEnum.percussion]: { base: ClefType.Perc, plus8: ClefType.Perc, minus8: ClefType.Perc },
};

/**
 * ClefEnum.C alone doesn't distinguish alto (line 3) from tenor (line 4);
 * OSMD, like MusicXML, carries that distinction on ClefInstruction.Line.
 */
const C_CLEF_LINE_TO_TYPE: Partial<Record<number, { base: ClefType; plus8: ClefType; minus8: ClefType }>> = {
  3: { base: ClefType.Alto, plus8: ClefType.AltoPlus8, minus8: ClefType.AltoMinus8 },
  4: { base: ClefType.Tenor, plus8: ClefType.TenorPlus8, minus8: ClefType.TenorMinus8 },
};

/**
 * Returns the ClefType of a clef, or undefined when AbcLs has no equivalent
 * for it (TAB clefs, C clefs on lines 1, 2 and 5, ...).
 */
function representableClefType(clef: ClefInstruction): ClefType | undefined {
  if (clef.ClefType === ClefEnum.TAB) return undefined;
  const entry = clef.ClefType === ClefEnum.C ? C_CLEF_LINE_TO_TYPE[clef.Line] : CLEF_ENUM_TO_TYPE[clef.ClefType];
  if (!entry) return undefined;
  if (clef.OctaveOffset === 1) return entry.plus8;
  if (clef.OctaveOffset === -1) return entry.minus8;
  return entry.base;
}

function clefInstructionToType(clef: ClefInstruction): ClefType {
  const type = representableClefType(clef);
  if (type !== undefined) return type;
  if (clef.ClefType === ClefEnum.TAB) throw new UnsupportedMusicXmlFeatureError("TAB clef");
  const label = clef.ClefType === ClefEnum.C ? `C clef on line ${clef.Line}` : `clef enum value ${ClefEnum[clef.ClefType] ?? clef.ClefType}`;
  throw new UnsupportedMusicXmlFeatureError(label);
}

/**
 * Inverse of normalize.ts's MAJOR_FIFTHS/MINOR_FIFTHS tables, built once at
 * module load. Only major and minor are supported for this version; see
 * KNOWN_GAPS.md for the other modes.
 */
const MAJOR_FIFTHS_TO_ROOT: Record<number, { root: KeyRoot; acc: KeyAccidental }> = {
  0: { root: KeyRoot.C, acc: KeyAccidental.None },
  1: { root: KeyRoot.G, acc: KeyAccidental.None },
  2: { root: KeyRoot.D, acc: KeyAccidental.None },
  3: { root: KeyRoot.A, acc: KeyAccidental.None },
  4: { root: KeyRoot.E, acc: KeyAccidental.None },
  5: { root: KeyRoot.B, acc: KeyAccidental.None },
  6: { root: KeyRoot.F, acc: KeyAccidental.Sharp },
  7: { root: KeyRoot.C, acc: KeyAccidental.Sharp },
  [-1]: { root: KeyRoot.F, acc: KeyAccidental.None },
  [-2]: { root: KeyRoot.B, acc: KeyAccidental.Flat },
  [-3]: { root: KeyRoot.E, acc: KeyAccidental.Flat },
  [-4]: { root: KeyRoot.A, acc: KeyAccidental.Flat },
  [-5]: { root: KeyRoot.D, acc: KeyAccidental.Flat },
  [-6]: { root: KeyRoot.G, acc: KeyAccidental.Flat },
  [-7]: { root: KeyRoot.C, acc: KeyAccidental.Flat },
};

const MINOR_FIFTHS_TO_ROOT: Record<number, { root: KeyRoot; acc: KeyAccidental }> = {
  0: { root: KeyRoot.A, acc: KeyAccidental.None },
  1: { root: KeyRoot.E, acc: KeyAccidental.None },
  2: { root: KeyRoot.B, acc: KeyAccidental.None },
  3: { root: KeyRoot.F, acc: KeyAccidental.Sharp },
  4: { root: KeyRoot.C, acc: KeyAccidental.Sharp },
  5: { root: KeyRoot.G, acc: KeyAccidental.Sharp },
  6: { root: KeyRoot.D, acc: KeyAccidental.Sharp },
  7: { root: KeyRoot.A, acc: KeyAccidental.Sharp },
  [-1]: { root: KeyRoot.D, acc: KeyAccidental.None },
  [-2]: { root: KeyRoot.G, acc: KeyAccidental.None },
  [-3]: { root: KeyRoot.C, acc: KeyAccidental.None },
  [-4]: { root: KeyRoot.F, acc: KeyAccidental.None },
  [-5]: { root: KeyRoot.B, acc: KeyAccidental.Flat },
  [-6]: { root: KeyRoot.E, acc: KeyAccidental.Flat },
  [-7]: { root: KeyRoot.A, acc: KeyAccidental.Flat },
};

function keyInstructionToSignature(key: KeyInstruction): KeySignature {
  if (key.Mode === KeyEnum.major || key.Mode === KeyEnum.ionian || key.Mode === KeyEnum.none) {
    const found = MAJOR_FIFTHS_TO_ROOT[key.Key];
    if (!found) throw new UnsupportedMusicXmlFeatureError(`key with ${key.Key} fifths`);
    return { root: found.root, acc: found.acc, mode: Mode.Major, accidentals: [] };
  }
  if (key.Mode === KeyEnum.minor || key.Mode === KeyEnum.aeolian) {
    const found = MINOR_FIFTHS_TO_ROOT[key.Key];
    if (!found) throw new UnsupportedMusicXmlFeatureError(`key with ${key.Key} fifths`);
    return { root: found.root, acc: found.acc, mode: Mode.Minor, accidentals: [] };
  }
  throw new UnsupportedMusicXmlFeatureError(`modal key signature (${KeyEnum[key.Mode] ?? key.Mode})`);
}

function rhythmInstructionToMeter(rhythm: RhythmInstruction): Meter {
  const beats = rhythm.Rhythm.Numerator;
  const beatType = rhythm.Rhythm.Denominator;
  const type =
    rhythm.SymbolEnum === RhythmSymbolEnum.COMMON ? MeterType.CommonTime : rhythm.SymbolEnum === RhythmSymbolEnum.CUT ? MeterType.CutTime : MeterType.Specified;
  // Because a time signature is not a fraction to reduce (6/8 is not 3/4),
  // the value keeps the written numbers, as the interpreter's own meters do.
  return { type, value: [{ numerator: beats, denominator: beatType }] };
}

const ARTICULATION_ENUM_TO_NAME: Partial<Record<ArticulationEnum, string>> = {
  [ArticulationEnum.staccato]: "staccato",
  [ArticulationEnum.tenuto]: "tenuto",
  [ArticulationEnum.accent]: "accent",
  [ArticulationEnum.strongaccent]: "strong-accent",
  [ArticulationEnum.upbow]: "up-bow",
  [ArticulationEnum.downbow]: "down-bow",
  [ArticulationEnum.fermata]: "fermata",
  [ArticulationEnum.invertedfermata]: "fermata",
};

const ORNAMENT_ENUM_TO_NAME: Partial<Record<OrnamentEnum, string>> = {
  [OrnamentEnum.Trill]: "trill-mark",
  [OrnamentEnum.Mordent]: "mordent",
  [OrnamentEnum.InvertedMordent]: "inverted-mordent",
  [OrnamentEnum.Turn]: "turn",
  [OrnamentEnum.InvertedTurn]: "inverted-turn",
};

function decorationsForVoiceEntry(voiceEntry: VoiceEntry): Decorations[] | undefined {
  const decorations: Decorations[] = [];
  for (const articulation of voiceEntry.Articulations ?? []) {
    const name = ARTICULATION_ENUM_TO_NAME[articulation.articulationEnum];
    if (name) {
      const mapped = INVERSE_ARTICULATION_MAP[name] ?? INVERSE_ORNAMENT_MAP[name];
      if (mapped) decorations.push(mapped);
    }
  }
  const ornament: OrnamentContainer | undefined = voiceEntry.OrnamentContainer;
  if (ornament) {
    const name = ORNAMENT_ENUM_TO_NAME[ornament.GetOrnament];
    if (name) {
      const mapped = INVERSE_ORNAMENT_MAP[name];
      if (mapped) decorations.push(mapped);
    }
  }
  return decorations.length > 0 ? decorations : undefined;
}

class SlurLabelAllocator {
  private labels = new Map<unknown, number>();
  private next = 1;

  labelFor(slur: unknown): number {
    let label = this.labels.get(slur);
    if (label === undefined) {
      label = this.next++;
      this.labels.set(slur, label);
    }
    return label;
  }
}

function buildTunePitch(note: OsmdNote, slurAllocator: SlurLabelAllocator): TunePitch {
  const osmdPitch: OsmdPitch = note.Pitch;
  const pitchNumber = fundamentalNoteToDiatonic(osmdPitch.FundamentalNote, osmdPitch.Octave);
  const accidental = accidentalEnumToType(osmdPitch.Accidental);
  const pitch: TunePitch = {
    pitch: pitchNumber,
    name: osmdPitch.FundamentalNote.toString(),
    verticalPos: pitchNumber,
    accidental,
  };
  const tie = note.NoteTie;
  if (tie) {
    const notes = tie.Notes;
    const index = notes.indexOf(note);
    if (index > 0) pitch.endTie = {};
    if (index >= 0 && index < notes.length - 1) pitch.startTie = {};
  }
  const slurs = note.NoteSlurs ?? [];
  for (const slur of slurs) {
    const label = slurAllocator.labelFor(slur);
    if (slur.StartNote === note) {
      pitch.startSlur = [...(pitch.startSlur ?? []), { label }];
    }
    if (slur.EndNote === note) {
      pitch.endSlur = [...(pitch.endSlur ?? []), label];
    }
  }
  return pitch;
}

function buildGraceNote(note: OsmdNote, slash: boolean): GraceNote {
  const osmdPitch: OsmdPitch = note.Pitch;
  const pitchNumber = fundamentalNoteToDiatonic(osmdPitch.FundamentalNote, osmdPitch.Octave);
  return {
    pitch: pitchNumber,
    name: osmdPitch.FundamentalNote.toString(),
    duration: 0.125,
    verticalPos: pitchNumber,
    accidental: accidentalEnumToType(osmdPitch.Accidental),
    acciaccatura: slash,
  };
}

function assertNoNestedTuplets(note: OsmdNote): void {
  if (note.NoteTuplets && note.NoteTuplets.length > 1) {
    throw new UnsupportedMusicXmlFeatureError("nested tuplets");
  }
}

function applyTupletInfo(element: NoteElement, note: OsmdNote): void {
  const tuplet: OsmdTuplet | undefined = note.NoteTuplet;
  if (!tuplet) return;
  const p = tuplet.Notes.length;
  const index = tuplet.getNoteIndex(note);
  // NormalNotes is MusicXML's <normal-notes> (q in TuneInterpreter's p:q:r
  // terms); tuplet.Fractions[0].RealValue was tried first but turned out to
  // be the note's own written duration, not the p:q ratio, confirmed by a
  // failing test against a hand-built triplet fixture.
  const q = note.NormalNotes;
  if (index === 0) {
    element.startTriplet = p;
    element.tripletR = p;
    if (q) element.tripletMultiplier = q / p;
  }
  if (index === p - 1) {
    element.endTriplet = true;
  }
}

/**
 * Splits a beam's members into the segments that ABC can write as one beam
 * group. Because ABC cannot beam across a bar line, and because a rest
 * closes a group in the ABC output, a new segment starts at a measure
 * change, after a rest member, and after a silent stretch between two
 * consecutive members (a rest that is not part of the beam, or a gap that
 * the importer pads with a rest). A beam may list every note of a chord, so
 * each voice entry is represented by its first note.
 */
function beamSegments(beam: Beam): OsmdNote[][] {
  const segments: OsmdNote[][] = [[]];
  let previousEnd: IRational | null = null;
  let previousMeasure: SourceMeasure | null = null;
  const seen = new Set<VoiceEntry>();
  for (const member of beam.Notes) {
    const entry = member.ParentVoiceEntry;
    if (!entry || seen.has(entry) || entry.IsGrace) continue;
    seen.add(entry);
    const current = segments[segments.length - 1];
    if (member.isRest()) {
      if (current.length > 0) segments.push([]);
      previousEnd = null;
      continue;
    }
    const start = fractionToRational(entry.Timestamp);
    const startsNewSegment = previousMeasure !== member.SourceMeasure || (previousEnd !== null && !equalRational(previousEnd, start));
    if (startsNewSegment && current.length > 0) segments.push([]);
    segments[segments.length - 1].push(entry.Notes[0]);
    previousEnd = addRational(start, fractionToRational(entry.Notes[0].Length));
    previousMeasure = member.SourceMeasure;
  }
  return segments;
}

/**
 * Marks the first and last element of the beam segment that contains the
 * note (see beamSegments). A segment of a single note gets no flags, since
 * a beam needs two notes.
 */
function applyBeamFlags(element: NoteElement, note: OsmdNote): void {
  const beam = note.NoteBeam;
  if (!beam || note.isRest()) return;
  const segment = beamSegments(beam).find((candidate) => candidate.includes(note));
  if (!segment || segment.length < 2) return;
  if (segment[0] === note) element.startBeam = true;
  if (segment[segment.length - 1] === note) element.endBeam = true;
}

interface StaffAccumulator {
  osmdStaff: OsmdStaff;
  instrument: Instrument;
  voices: OsmdVoice[];
  /** The ABC voice id of each voice, unique across the whole tune (see assignVoiceIds). */
  voiceIds: string[];
  elementsByVoice: VoiceElement[][];
  pendingGraceNotes: GraceNote[][];
  /**
   * Because voices can later be dropped and sliced into systems by measure,
   * each voice's elements are recorded per measure:
   * measuresByVoice[voiceIndex][measureIndex] is that measure's element list.
   * elementsByVoice is only derived from it by flattenAccumulator.
   */
  measuresByVoice: VoiceElement[][][];
  /**
   * Because MusicXML attaches clefs, keys and meters to a staff rather than
   * to a voice, they are stored per measure and inserted into the voices
   * when flattening, so that dropping a voice never loses them.
   */
  attributesByMeasure: VoiceElement[][];
}

/**
 * Per-measure timing state of one staff. Because OSMD only reports the
 * entries that exist, the cursor is what reveals the silent stretches that
 * need padding rests.
 */
interface MeasureCursorContext {
  measureLength: IRational;
  cursorByVoice: IRational[];
  hadEntryByVoice: boolean[];
}

function collectVoicesForStaff(sheet: MusicSheet, globalStaffIndex: number): OsmdVoice[] {
  const seen = new Map<number, OsmdVoice>();
  for (const measure of sheet.SourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const entry = container.StaffEntries[globalStaffIndex];
      if (!entry) continue;
      for (const voiceEntry of entry.VoiceEntries) {
        const voice = voiceEntry.ParentVoice;
        if (!seen.has(voice.VoiceId)) seen.set(voice.VoiceId, voice);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.VoiceId - b.VoiceId);
}

function convertMeasureAttributes(measure: SourceMeasure, globalStaffIndex: number): VoiceElement[] {
  const entry = measure.FirstInstructionsStaffEntries[globalStaffIndex];
  if (!entry) return [];
  const elements: VoiceElement[] = [];
  for (const instruction of entry.Instructions) {
    if (instruction instanceof ClefInstruction) {
      const type = clefInstructionToType(instruction);
      const clefElement: ClefElement = { el_type: ElementType.Clef, startChar: 0, endChar: 0, type, verticalPos: 0 };
      elements.push(clefElement);
    } else if (instruction instanceof KeyInstruction) {
      const sig = keyInstructionToSignature(instruction);
      const keyElement: KeyElement = { el_type: ElementType.Key, startChar: 0, endChar: 0, ...sig };
      elements.push(keyElement);
    } else if (instruction instanceof RhythmInstruction) {
      const meter = rhythmInstructionToMeter(instruction);
      const meterElement: MeterElement = { el_type: ElementType.Meter, startChar: 0, endChar: 0, type: meter.type, value: meter.value };
      elements.push(meterElement);
    }
  }
  return elements;
}

/**
 * Returns the clef changes that OSMD stores at the end of a measure. Because
 * OSMD moves a clef change to the end of the previous measure (where a
 * courtesy clef is drawn) instead of the start of the measure in which it
 * takes effect, these clefs belong to the start of the next measure.
 */
function convertTrailingClefs(measure: SourceMeasure, globalStaffIndex: number): VoiceElement[] {
  const entry = measure.LastInstructionsStaffEntries?.[globalStaffIndex];
  if (!entry) return [];
  const elements: VoiceElement[] = [];
  for (const instruction of entry.Instructions) {
    if (!(instruction instanceof ClefInstruction)) continue;
    // Because mid-tune clef changes used to be ignored entirely, a change to
    // a clef that AbcLs cannot represent is skipped rather than rejected, so
    // that scores which imported before still import.
    const type = representableClefType(instruction);
    if (type === undefined) continue;
    const clefElement: ClefElement = { el_type: ElementType.Clef, startChar: 0, endChar: 0, type, verticalPos: 0 };
    elements.push(clefElement);
  }
  return elements;
}

function pushNoteOrGraceForVoiceEntry(
  acc: StaffAccumulator,
  voiceIndex: number,
  target: VoiceElement[],
  voiceEntry: VoiceEntry,
  slurAllocator: SlurLabelAllocator
): void {
  if (voiceEntry.IsGrace) {
    if (voiceEntry.GraceAfterMainNote) {
      throw new UnsupportedMusicXmlFeatureError("grace notes after their main note");
    }
    const slash = !!voiceEntry.GraceNoteSlash;
    for (const note of voiceEntry.Notes) {
      acc.pendingGraceNotes[voiceIndex].push(buildGraceNote(note, slash));
    }
    return;
  }

  const notes = voiceEntry.Notes;
  if (notes.length === 0) return;
  for (const note of notes) assertNoNestedTuplets(note);

  if (notes[0].isRest()) {
    const duration = fractionToRational(notes[0].Length);
    const element: NoteElement = {
      el_type: ElementType.Note,
      startChar: 0,
      endChar: 0,
      duration,
      rest: { type: RestType.Rest },
    };
    target.push(element);
    return;
  }

  const duration = fractionToRational(notes[0].Length);
  const pitches: TunePitch[] = notes.map((note) => buildTunePitch(note, slurAllocator));
  const decoration = decorationsForVoiceEntry(voiceEntry);
  const element: NoteElement = {
    el_type: ElementType.Note,
    startChar: 0,
    endChar: 0,
    duration,
    pitches,
    decoration,
  };
  applyTupletInfo(element, notes[0]);
  applyBeamFlags(element, notes[0]);
  const pending = acc.pendingGraceNotes[voiceIndex];
  if (pending.length > 0) {
    element.gracenotes = pending;
    acc.pendingGraceNotes[voiceIndex] = [];
  }
  target.push(element);
}

/**
 * Returns the length that every voice's content must fill in this measure.
 * Because OSMD sets a measure's Duration from the position reached by the
 * last voice it read, a measure whose last voice ends early (after a
 * <backup>) reports a Duration shorter than its longest voice. The length is
 * therefore the larger of Duration and the latest end of any non-grace entry
 * across all staves, so that every staff agrees on it. A pickup (implicit)
 * measure only uses the latest end, so that it is not padded into a full
 * measure.
 */
function measureLengthFor(measure: SourceMeasure): IRational {
  const nominal = fractionToRational(measure.Duration);
  let latestEnd: IRational | null = null;
  for (const container of measure.VerticalSourceStaffEntryContainers) {
    for (const entry of container.StaffEntries) {
      if (!entry) continue;
      for (const voiceEntry of entry.VoiceEntries) {
        if (voiceEntry.IsGrace || voiceEntry.Notes.length === 0) continue;
        const end = addRational(fractionToRational(voiceEntry.Timestamp), fractionToRational(voiceEntry.Notes[0].Length));
        if (latestEnd === null || greaterRational(end, latestEnd)) latestEnd = end;
      }
    }
  }
  if (latestEnd === null) return nominal;
  if (measure.ImplicitMeasure) return latestEnd;
  return greaterRational(latestEnd, nominal) ? latestEnd : nominal;
}

function pushGapRest(target: VoiceElement[], gap: IRational, type: RestType): void {
  if (gap.numerator <= 0) return;
  const rest: NoteElement = { el_type: ElementType.Note, startChar: 0, endChar: 0, duration: gap, rest: { type } };
  target.push(rest);
}

function buildStaffAccumulator(sheet: MusicSheet, osmdStaff: OsmdStaff, instrument: Instrument, globalStaffIndex: number): StaffAccumulator {
  const voices = collectVoicesForStaff(sheet, globalStaffIndex);
  const acc: StaffAccumulator = {
    osmdStaff,
    instrument,
    voices,
    voiceIds: voices.map((v) => String(v.VoiceId)),
    elementsByVoice: voices.map(() => []),
    pendingGraceNotes: voices.map(() => []),
    measuresByVoice: voices.map(() => []),
    attributesByMeasure: [],
  };
  const slurAllocator = new SlurLabelAllocator();
  let pendingClefs: VoiceElement[] = [];

  for (const measure of sheet.SourceMeasures) {
    const measureLists: VoiceElement[][] = voices.map(() => []);
    if (measure.beginsWithLineRepetition()) {
      for (const list of measureLists) {
        const openRepeat: BarElement = { el_type: ElementType.Bar, startChar: 0, endChar: 0, type: BarType.BarLeftRepeat };
        list.push(openRepeat);
      }
    }
    acc.attributesByMeasure.push([...pendingClefs, ...convertMeasureAttributes(measure, globalStaffIndex)]);
    pendingClefs = convertTrailingClefs(measure, globalStaffIndex);

    const cursor: MeasureCursorContext = {
      measureLength: measureLengthFor(measure),
      cursorByVoice: voices.map(() => createRational(0)),
      hadEntryByVoice: voices.map(() => false),
    };
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const entry = container.StaffEntries[globalStaffIndex];
      if (!entry) continue;
      for (const voiceEntry of entry.VoiceEntries) {
        const voiceIndex = voices.findIndex((v) => v.VoiceId === voiceEntry.ParentVoice.VoiceId);
        if (voiceIndex === -1) continue;
        advanceCursorForEntry(cursor, voiceIndex, voiceEntry, measureLists[voiceIndex]);
        pushNoteOrGraceForVoiceEntry(acc, voiceIndex, measureLists[voiceIndex], voiceEntry, slurAllocator);
      }
    }

    const closeType = measure.endsWithLineRepetition() ? BarType.BarRightRepeat : BarType.BarThin;
    for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
      const list = measureLists[voiceIndex];
      if (!cursor.hadEntryByVoice[voiceIndex]) {
        pushGapRest(list, cursor.measureLength, RestType.Invisible);
      } else {
        pushGapRest(list, subtractRational(cursor.measureLength, cursor.cursorByVoice[voiceIndex]), RestType.Rest);
      }
      const barElement: BarElement = { el_type: ElementType.Bar, startChar: 0, endChar: 0, type: closeType };
      list.push(barElement);
      acc.measuresByVoice[voiceIndex].push(list);
    }
  }

  return acc;
}

/**
 * Pads the silent stretch before a voice entry with a visible rest, then
 * moves the voice's cursor to the end of the entry. Grace entries take no
 * time, so they leave the cursor untouched. An entry that starts before the
 * cursor (overlapping content, which OMR output can produce) is left as is.
 */
function advanceCursorForEntry(cursor: MeasureCursorContext, voiceIndex: number, voiceEntry: VoiceEntry, target: VoiceElement[]): void {
  if (voiceEntry.IsGrace || voiceEntry.Notes.length === 0) return;
  const start = fractionToRational(voiceEntry.Timestamp);
  const current = cursor.cursorByVoice[voiceIndex];
  if (greaterRational(start, current)) {
    pushGapRest(target, subtractRational(start, current), RestType.Rest);
  }
  const end = addRational(start, fractionToRational(voiceEntry.Notes[0].Length));
  cursor.cursorByVoice[voiceIndex] = greaterRational(end, current) ? end : current;
  cursor.hadEntryByVoice[voiceIndex] = true;
}

function hasPitchedNote(measures: VoiceElement[][]): boolean {
  for (const measure of measures) {
    for (const element of measure) {
      if (element.el_type === ElementType.Note && ((element as NoteElement).pitches?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

/**
 * Makes every voice id unique across the tune. Because OSMD numbers voices
 * per instrument, two parts both have a voice 1, and the serializer would
 * merge them into a single ABC voice. A colliding id gets the staff's
 * 1-based number appended (1 becomes 1_2 on the second staff).
 */
function assignVoiceIds(accumulators: StaffAccumulator[]): void {
  const used = new Set<string>();
  accumulators.forEach((acc, staffIndex) => {
    acc.voiceIds = acc.voices.map((voice) => {
      let id = String(voice.VoiceId);
      if (used.has(id)) id = `${voice.VoiceId}_${staffIndex + 1}`;
      let suffix = 2;
      while (used.has(id)) id = `${voice.VoiceId}_${staffIndex + 1}_${suffix++}`;
      used.add(id);
      return id;
    });
  });
}

/** Returns the indices of the voices that contain at least one pitched note. */
function pitchedVoiceIndices(acc: StaffAccumulator): number[] {
  const keep: number[] = [];
  acc.measuresByVoice.forEach((measures, voiceIndex) => {
    if (hasPitchedNote(measures)) keep.push(voiceIndex);
  });
  return keep;
}

/** Keeps only the voices whose indices are listed in `keep`. */
function filterVoices(acc: StaffAccumulator, keep: number[]): void {
  acc.voices = keep.map((i) => acc.voices[i]);
  acc.voiceIds = keep.map((i) => acc.voiceIds[i]);
  acc.measuresByVoice = keep.map((i) => acc.measuresByVoice[i]);
  acc.pendingGraceNotes = keep.map((i) => acc.pendingGraceNotes[i]);
  acc.elementsByVoice = keep.map(() => []);
}

/**
 * Builds one voice's element list for the measures in [fromMeasure, toMeasure).
 * Because MusicXML attaches clefs, keys and meters to the staff, every voice
 * of the staff receives its own copy of the measure's attribute elements,
 * right after a leading left-repeat bar: the left repeat belongs to the
 * boundary before the measure, while the attributes belong to the measure.
 */
function flattenMeasureRange(acc: StaffAccumulator, voiceIndex: number, fromMeasure: number, toMeasure: number): VoiceElement[] {
  const out: VoiceElement[] = [];
  const measures = acc.measuresByVoice[voiceIndex];
  for (let m = fromMeasure; m < toMeasure && m < measures.length; m++) {
    const list = measures[m];
    const attributes = (acc.attributesByMeasure[m] ?? []).map((element) => ({ ...element }));
    const startsWithLeftRepeat = list.length > 0 && isBarElement(list[0]) && (list[0] as BarElement).type === BarType.BarLeftRepeat;
    if (startsWithLeftRepeat) {
      out.push(list[0], ...attributes, ...list.slice(1));
    } else {
      out.push(...attributes, ...list);
    }
  }
  return out;
}

function flattenAccumulator(acc: StaffAccumulator): void {
  acc.elementsByVoice = acc.measuresByVoice.map((_, voiceIndex) => flattenMeasureRange(acc, voiceIndex, 0, acc.attributesByMeasure.length));
}

interface FlatStaffEntry {
  osmdStaff: OsmdStaff;
  instrument: Instrument;
}

function flattenStaves(sheet: MusicSheet): FlatStaffEntry[] {
  const result: FlatStaffEntry[] = [];
  for (const instrument of sheet.Instruments) {
    for (const osmdStaff of instrument.Staves) {
      if (osmdStaff.isTab) {
        throw new UnsupportedMusicXmlFeatureError("tablature staff", `instrument ${instrument.Name}`);
      }
      result.push({ osmdStaff, instrument });
    }
  }
  return result;
}

function findFirstAttributes(elements: VoiceElement[]): { clef?: ClefType; key?: KeySignature; meter?: Meter } {
  let clef: ClefType | undefined;
  let key: KeySignature | undefined;
  let meter: Meter | undefined;
  for (const element of elements) {
    if (element.el_type === ElementType.Clef && clef === undefined) clef = element.type;
    if (element.el_type === ElementType.Key && key === undefined) {
      key = { root: element.root, acc: element.acc, mode: element.mode, accidentals: element.accidentals };
    }
    if (element.el_type === ElementType.Meter && meter === undefined) meter = { type: element.type, value: element.value };
    if (clef !== undefined && key !== undefined && meter !== undefined) break;
  }
  return { clef, key, meter };
}

/**
 * Builds the staff of one system, holding the measures in
 * [fromMeasure, toMeasure). Because every system must start with the same
 * staff metadata, the clef, key and meter come from the first ones found in
 * the whole of voice 0; changes in the middle of the tune remain elements.
 */
function buildTuneStaffForRange(acc: StaffAccumulator, fromMeasure: number, toMeasure: number): Staff {
  const { clef, key, meter } = findFirstAttributes(acc.elementsByVoice[0] ?? []);
  const clefProperties = { type: clef ?? ClefType.Treble };
  const staff: Staff = {
    clef: clefProperties,
    workingClef: clefProperties,
    key: key ?? { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] },
    meter,
    voices: acc.measuresByVoice.map((_, voiceIndex) => flattenMeasureRange(acc, voiceIndex, fromMeasure, toMeasure)),
    voiceIds: acc.voiceIds,
    title: acc.instrument.Name ? [acc.instrument.Name] : undefined,
  };
  return staff;
}

/**
 * Returns the indices of the measures that start a system: the first
 * measure, plus every measure for which the MusicXML says
 * <print new-system="yes"/> (exposed by OSMD as printNewSystemXml).
 */
function computeSystemStarts(sheet: MusicSheet): number[] {
  const starts = [0];
  sheet.SourceMeasures.forEach((measure, index) => {
    if (index > 0 && measure.printNewSystemXml) starts.push(index);
  });
  return starts;
}

/**
 * Maps InstrumentalGroup membership onto the bracket/brace/connectBarLines
 * fields, the direct reverse of phase 1's buildPartList grouping. A run of
 * consecutive staves sharing the same Instrument (a piano grand staff, for
 * instance) gets a brace with Start/Continue/End markers.
 */
function applyInstrumentGrouping(staves: Staff[], flat: FlatStaffEntry[]): void {
  let i = 0;
  while (i < flat.length) {
    let j = i;
    while (j + 1 < flat.length && flat[j + 1].instrument === flat[i].instrument) j++;
    if (j > i) {
      for (let k = i; k <= j; k++) {
        staves[k].brace = k === i ? BracketBracePosition.Start : k === j ? BracketBracePosition.End : BracketBracePosition.Continue;
        staves[k].connectBarLines = true;
      }
    }
    i = j + 1;
  }
}

export function importFromMusicSheet(sheet: MusicSheet): Tune {
  const allFlat = flattenStaves(sheet);
  const allAccumulators = allFlat.map((entry, index) => buildStaffAccumulator(sheet, entry.osmdStaff, entry.instrument, index));

  // Because a staff whose voices all lack pitched notes would render as an
  // empty staff, it is removed together with its voices. An all-rest score
  // still keeps the first voice of its first staff, so that the result
  // remains a valid tune.
  const keptByStaff = allAccumulators.map(pitchedVoiceIndices);
  let accumulators = allAccumulators.filter((_, i) => keptByStaff[i].length > 0);
  let flat = allFlat.filter((_, i) => keptByStaff[i].length > 0);
  if (accumulators.length === 0 && allAccumulators.length > 0) {
    accumulators = [allAccumulators[0]];
    flat = [allFlat[0]];
    if (allAccumulators[0].voices.length > 0) filterVoices(allAccumulators[0], [0]);
  } else {
    allAccumulators.forEach((acc, i) => {
      if (keptByStaff[i].length > 0) filterVoices(acc, keptByStaff[i]);
    });
  }
  accumulators.forEach(flattenAccumulator);
  assignVoiceIds(accumulators);

  // Because the source's system breaks are recorded by splitting
  // tune.systems, a caller that concatenates the systems per voice (as
  // tuneToAst does without options) still sees each voice's full content.
  const measureCount = sheet.SourceMeasures.length;
  const starts = computeSystemStarts(sheet);
  const systems: StaffSystem[] = starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : measureCount;
    const staves = accumulators.map((acc) => buildTuneStaffForRange(acc, start, end));
    applyInstrumentGrouping(staves, flat);
    return { staff: staves };
  });

  const tune = createEmptyTune();
  tune.systems = systems;
  tune.staffNum = accumulators.length;
  tune.voiceNum = accumulators.reduce((sum, acc) => sum + acc.voices.length, 0);
  tune.lineNum = systems.length;
  return tune;
}
