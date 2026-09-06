import {
  Tune,
  Staff,
  StaffSystem,
  VoiceElement,
  ElementType,
  isMusicLine,
  isNoteElement,
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
import { IRational, findGCD } from "../Visitors/fmt/rational";
import { ScorePartwiseIR, PartIR, PartListEntryIR, MeasureIR, NoteIR, AttributesIR, PitchIR, NotationsIR } from "./ir";
import { ARTICULATION_MAP, ORNAMENT_MAP } from "./decorationMap";

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / findGCD(Math.abs(a), Math.abs(b));
}

export function computeDivisions(tune: Tune): number {
  const denominators: number[] = [];
  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    for (const staff of system.staff) {
      for (const voice of staff.voices) {
        for (const element of voice) {
          if (isNoteElement(element) && element.duration) {
            denominators.push(element.duration.denominator);
          }
        }
      }
    }
  }
  if (denominators.length === 0) return 1;
  return denominators.reduce((acc, d) => lcm(acc, d), 1);
}

export function splitVoiceIntoMeasures(voiceElements: VoiceElement[]): VoiceElement[][] {
  const measures: VoiceElement[][] = [[]];
  for (const element of voiceElements) {
    if (isBarElement(element)) {
      measures.push([]);
    } else {
      measures[measures.length - 1].push(element);
    }
  }
  if (measures.length > 1 && measures[measures.length - 1].length === 0) {
    measures.pop();
  }
  return measures;
}

interface CollectedStaff {
  representative: Staff;
  voices: VoiceElement[][];
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
    for (const system of musicSystems) {
      const staff = system.staff[staffIndex];
      if (!staff) continue;
      staff.voices.forEach((voiceElements, voiceIndex) => {
        voices[voiceIndex].push(...voiceElements);
      });
    }
    if (representative) {
      result.push({ representative, voices });
    }
  }
  return result;
}

const MAJOR_FIFTHS: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  "C#": 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
};

const MINOR_FIFTHS: Record<string, number> = {
  A: 0,
  E: 1,
  B: 2,
  "F#": 3,
  "C#": 4,
  "G#": 5,
  "D#": 6,
  "A#": 7,
  D: -1,
  G: -2,
  C: -3,
  F: -4,
  Bb: -5,
  Eb: -6,
  Ab: -7,
};

const MODE_NAME: Record<string, string> = {
  "": "major",
  m: "minor",
  Dor: "dorian",
  Mix: "mixolydian",
  Loc: "locrian",
  Phr: "phrygian",
  Lyd: "lydian",
};

export function keySignatureToFifths(key: KeySignature): number {
  const rootKey = `${key.root}${key.acc}`;
  if (key.mode === "m") {
    return MINOR_FIFTHS[rootKey] ?? MAJOR_FIFTHS[rootKey] ?? 0;
  }
  return MAJOR_FIFTHS[rootKey] ?? 0;
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
  const reducesToWholeNote = total !== 0 && denominator !== 0 && (() => {
    const g = findGCD(Math.abs(total), Math.abs(denominator));
    return total / g === 1 && denominator / g === 1;
  })();
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
};

export function accidentalToAlter(accidental: AccidentalType | undefined): number | undefined {
  if (accidental === undefined) return undefined;
  return ACCIDENTAL_TO_ALTER[accidental];
}

function buildPitchIR(pitchNumber: number, accidental: AccidentalType | undefined): PitchIR {
  const { step, octave } = diatonicToStepOctave(pitchNumber);
  const alter = accidentalToAlter(accidental);
  return alter === undefined ? { step, octave } : { step, octave, alter };
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
  const hasContent =
    notations.slurStarts || notations.slurStops || notations.articulations || notations.ornaments || notations.technical || notations.fermata;
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

class SlurNumberAllocator {
  private available: number[] = Array.from({ length: 16 }, (_, i) => 16 - i);
  private assigned = new Map<string, number>();

  start(voiceNumber: number, abcjsLabel: number): number {
    const key = `${voiceNumber}:${abcjsLabel}`;
    let num = this.assigned.get(key);
    if (num === undefined) {
      if (this.available.length === 0) {
        throw new Error(`Cannot export voice ${voiceNumber}: more than 16 slurs are open at once, which MusicXML's slur numbering cannot represent.`);
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

function buildVoiceMeasureNotes(measureElements: VoiceElement[], voiceNumber: number, divisions: number, slurAllocator: SlurNumberAllocator): NoteIR[] {
  const notes: NoteIR[] = [];
  for (const element of measureElements) {
    if (!isNoteElement(element)) continue;
    const durationInDivisions = rationalToDivisions(element.duration, divisions);
    if (element.rest) {
      notes.push({ kind: "note", voice: voiceNumber, duration: durationInDivisions, rest: true });
      continue;
    }
    if (!element.pitches || element.pitches.length === 0) {
      notes.push({ kind: "note", voice: voiceNumber, duration: durationInDivisions, rest: true });
      continue;
    }
    if (element.gracenotes) {
      for (const g of element.gracenotes) {
        notes.push({
          kind: "note",
          voice: voiceNumber,
          pitch: buildPitchIR(g.pitch, g.accidental),
          grace: { slash: !!g.acciaccatura },
        });
      }
    }
    element.pitches.forEach((pitch, i) => {
      const startLabels = (pitch.startSlur ?? []).map((s) => s.label).filter((label): label is number => label !== undefined);
      const endLabels = pitch.endSlur ?? [];
      const startSlurs = startLabels.map((label) => slurAllocator.start(voiceNumber, label));
      const endSlurs = endLabels.map((label) => slurAllocator.stop(voiceNumber, label));
      notes.push({
        kind: "note",
        voice: voiceNumber,
        duration: durationInDivisions,
        pitch: buildPitchIR(pitch.pitch, pitch.accidental),
        chord: i > 0 ? true : undefined,
        tieStart: pitch.startTie ? true : undefined,
        tieStop: pitch.endTie ? true : undefined,
        notations: buildNotationsIR(element.decoration, startSlurs, endSlurs),
      });
    });
  }
  return notes;
}

function buildPart(collected: CollectedStaff, partId: string, divisions: number): PartIR {
  const voiceMeasures = collected.voices.map((v) => splitVoiceIntoMeasures(v));
  // MusicXML's <part> requires minOccurs="1" on <measure>.
  const measureCount = Math.max(1, voiceMeasures.reduce((max, m) => Math.max(max, m.length), 0));
  const slurAllocator = new SlurNumberAllocator();
  const measures: MeasureIR[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const content: NoteIR[] = [];
    let cursor = 0;
    voiceMeasures.forEach((voiceMeasureList, voiceIndex) => {
      const measureElements = voiceMeasureList[measureIndex];
      if (!measureElements) return;
      if (cursor !== 0) {
        content.push({ kind: "backup", duration: cursor });
        cursor = 0;
      }
      const voiceNotes = buildVoiceMeasureNotes(measureElements, voiceIndex + 1, divisions, slurAllocator);
      content.push(...voiceNotes);
      cursor = voiceNotes.reduce((sum, n) => sum + (n.grace || n.chord ? 0 : n.duration ?? 0), 0);
    });
    const attributeSourceElements = voiceMeasures.flatMap((vm) => vm[measureIndex] ?? []);
    const attributes = measureIndex === 0 ? buildMeasureAttributes(attributeSourceElements, divisions) : buildMeasureAttributes(attributeSourceElements, undefined);
    measures.push({ number: measureIndex + 1, attributes, content });
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

export function normalizeForMusicXML(tune: Tune): ScorePartwiseIR {
  const divisions = computeDivisions(tune);
  const collected = collectContinuousVoicesByStaff(tune);
  const partIds = collected.map((_, i) => `P${i + 1}`);
  const parts = collected.map((c, i) => buildPart(c, partIds[i], divisions));
  const partList = buildPartList(
    collected.map((c) => c.representative),
    partIds
  );
  return { partList, parts };
}
