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
} from "opensheetmusicdisplay";
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
} from "../types/abcjs-ast";
import { IRational, createRational } from "../Visitors/fmt/rational";
import { createEmptyTune } from "../interpreter/InterpreterState";
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

function clefInstructionToType(clef: ClefInstruction): ClefType {
  if (clef.ClefType === ClefEnum.TAB) {
    throw new UnsupportedMusicXmlFeatureError("TAB clef");
  }
  const entry = clef.ClefType === ClefEnum.C ? C_CLEF_LINE_TO_TYPE[clef.Line] : CLEF_ENUM_TO_TYPE[clef.ClefType];
  if (!entry) {
    const label = clef.ClefType === ClefEnum.C ? `C clef on line ${clef.Line}` : `clef enum value ${ClefEnum[clef.ClefType] ?? clef.ClefType}`;
    throw new UnsupportedMusicXmlFeatureError(label);
  }
  if (clef.OctaveOffset === 1) return entry.plus8;
  if (clef.OctaveOffset === -1) return entry.minus8;
  return entry.base;
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
  const type = rhythm.SymbolEnum === RhythmSymbolEnum.COMMON ? MeterType.CommonTime : rhythm.SymbolEnum === RhythmSymbolEnum.CUT ? MeterType.CutTime : MeterType.Specified;
  return { type, value: [createRational(beats, beatType)] };
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

interface StaffAccumulator {
  osmdStaff: OsmdStaff;
  instrument: Instrument;
  voices: OsmdVoice[];
  elementsByVoice: VoiceElement[][];
  pendingGraceNotes: GraceNote[][];
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

function pushNoteOrGraceForVoiceEntry(
  acc: StaffAccumulator,
  voiceIndex: number,
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
    acc.elementsByVoice[voiceIndex].push(element);
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
  const pending = acc.pendingGraceNotes[voiceIndex];
  if (pending.length > 0) {
    element.gracenotes = pending;
    acc.pendingGraceNotes[voiceIndex] = [];
  }
  acc.elementsByVoice[voiceIndex].push(element);
}

function buildStaffAccumulator(sheet: MusicSheet, osmdStaff: OsmdStaff, instrument: Instrument, globalStaffIndex: number): StaffAccumulator {
  const voices = collectVoicesForStaff(sheet, globalStaffIndex);
  const acc: StaffAccumulator = {
    osmdStaff,
    instrument,
    voices,
    elementsByVoice: voices.map(() => []),
    pendingGraceNotes: voices.map(() => []),
  };
  const slurAllocator = new SlurLabelAllocator();

  for (const measure of sheet.SourceMeasures) {
    if (measure.beginsWithLineRepetition()) {
      for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
        const openRepeat: BarElement = { el_type: ElementType.Bar, startChar: 0, endChar: 0, type: BarType.BarLeftRepeat };
        acc.elementsByVoice[voiceIndex].push(openRepeat);
      }
    }
    const attributeElements = convertMeasureAttributes(measure, globalStaffIndex);
    if (attributeElements.length > 0 && acc.elementsByVoice.length > 0) {
      acc.elementsByVoice[0].push(...attributeElements);
    }
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const entry = container.StaffEntries[globalStaffIndex];
      if (!entry) continue;
      for (const voiceEntry of entry.VoiceEntries) {
        const voiceIndex = voices.findIndex((v) => v.VoiceId === voiceEntry.ParentVoice.VoiceId);
        if (voiceIndex === -1) continue;
        pushNoteOrGraceForVoiceEntry(acc, voiceIndex, voiceEntry, slurAllocator);
      }
    }
    const closeType = measure.endsWithLineRepetition() ? BarType.BarRightRepeat : BarType.BarThin;
    for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
      const barElement: BarElement = { el_type: ElementType.Bar, startChar: 0, endChar: 0, type: closeType };
      acc.elementsByVoice[voiceIndex].push(barElement);
    }
  }

  return acc;
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

function findFirstClefAndKey(elements: VoiceElement[]): { clef?: ClefType; key?: KeySignature } {
  let clef: ClefType | undefined;
  let key: KeySignature | undefined;
  for (const element of elements) {
    if (element.el_type === ElementType.Clef && clef === undefined) clef = element.type;
    if (element.el_type === ElementType.Key && key === undefined) {
      key = { root: element.root, acc: element.acc, mode: element.mode, accidentals: element.accidentals };
    }
    if (clef !== undefined && key !== undefined) break;
  }
  return { clef, key };
}

function buildTuneStaff(acc: StaffAccumulator): Staff {
  const { clef, key } = findFirstClefAndKey(acc.elementsByVoice[0] ?? []);
  const clefProperties = { type: clef ?? ClefType.Treble };
  const staff: Staff = {
    clef: clefProperties,
    workingClef: clefProperties,
    key: key ?? { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] },
    voices: acc.elementsByVoice,
    voiceIds: acc.voices.map((v) => String(v.VoiceId)),
    title: acc.instrument.Name ? [acc.instrument.Name] : undefined,
  };
  return staff;
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
  const flat = flattenStaves(sheet);
  const accumulators = flat.map((entry, index) => buildStaffAccumulator(sheet, entry.osmdStaff, entry.instrument, index));
  const staves = accumulators.map(buildTuneStaff);
  applyInstrumentGrouping(staves, flat);

  const system: StaffSystem = { staff: staves };
  const tune = createEmptyTune();
  tune.systems = [system];
  tune.staffNum = staves.length;
  tune.voiceNum = accumulators.reduce((sum, acc) => sum + acc.voices.length, 0);
  tune.lineNum = 1;
  return tune;
}
