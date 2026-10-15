import { expect } from "chai";
import * as fc from "fast-check";
import { BarType, ElementType, isBarElement, isMusicLine, NoteElement, StaffSystem, VoiceElement } from "../types/abcjs-ast";
import { importFromMusicSheet, stepOctaveToDiatonic } from "./importFromMusicSheet";
import { durationSum, measuresOf } from "./importFromMusicSheet.padding.spec";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

/**
 * The plan's testing strategy calls for generating MusicSheet-shaped
 * structures directly, mirroring phase 1's decision to generate at the IR
 * level rather than parsing text. That turned out to be impractical here:
 * OSMD's classes (MusicSheet, Instrument, Voice, VoiceEntry, Note, ...)
 * have private fields and constructors with real side effects, so they are
 * nominally typed, not structurally typed the way this project's own Tune
 * interface is - a hand-built object satisfying the same shape cannot be
 * cast to them without bypassing the type system entirely, which would
 * test this importer against a fake shape rather than OSMD's actual
 * invariants. Generating small, valid MusicXML text snippets and running
 * them through the real MusicSheetReader is the closest practical
 * equivalent, and is intentionally documented here as a deviation from the
 * plan's literal suggestion.
 */

const STEP_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

function buildSingleNoteMeasureXml(step: string, octave: number, durationType: "quarter" | "half" | "whole", alter: -1 | 0 | 1): string {
  const durationBeats = durationType === "quarter" ? 1 : durationType === "half" ? 2 : 4;
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : "";
  const accidentalXml = alter === 1 ? "<accidental>sharp</accidental>" : alter === -1 ? "<accidental>flat</accidental>" : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>${step}</step><octave>${octave}</octave>${alterXml}</pitch>
        <duration>${durationBeats}</duration>
        <type>${durationType}</type>
        ${accidentalXml}
      </note>
    </measure>
  </part>
</score-partwise>`;
}

describe("importFromMusicSheet property-based tests", () => {
  it("always maps a single generated note to the expected diatonic pitch number and duration", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STEP_LETTERS),
        fc.integer({ min: 2, max: 6 }),
        fc.constantFrom("quarter" as const, "half" as const, "whole" as const),
        fc.constantFrom(-1 as const, 0 as const, 1 as const),
        (step, octave, durationType, alter) => {
          const xml = buildSingleNoteMeasureXml(step, octave, durationType, alter);
          const sheet = parseMusicXmlToSheet(xml);
          const tune = importFromMusicSheet(sheet);
          const system = tune.systems[0];
          if (!isMusicLine(system)) throw new Error("expected a music line");
          const notes = system.staff[0].voices[0].filter((e): e is NoteElement => e.el_type === ElementType.Note);
          expect(notes.length).to.equal(1);
          const pitch = notes[0].pitches?.[0];
          expect(pitch).to.not.be.undefined;
          const stepIndex = STEP_LETTERS.indexOf(step);
          expect(pitch!.pitch).to.equal(stepOctaveToDiatonic(stepIndex, octave));
          const expectedDurationNumerator = durationType === "quarter" ? 1 : durationType === "half" ? 1 : 1;
          const expectedDurationDenominator = durationType === "quarter" ? 4 : durationType === "half" ? 2 : 1;
          expect(notes[0].duration).to.deep.equal({ numerator: expectedDurationNumerator, denominator: expectedDurationDenominator });
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Generated two-voice scores for the rest padding properties. Voice 1 always
 * fills its measures (so that OSMD never treats the first measure as a
 * pickup), while voice 2 mixes notes, rests and silent stretches written as
 * <forward>, and may stop before the end of the measure.
 */
const MEASURE_UNITS = 8; // divisions = 2, so one unit is an eighth note
const LENGTH_TYPES: Record<number, string> = { 1: "eighth", 2: "quarter", 4: "half" };

interface GeneratedSegment {
  kind: "note" | "rest" | "gap";
  units: number;
  step: string;
}

function fitSegments(segments: GeneratedSegment[], fill: boolean): GeneratedSegment[] {
  const out: GeneratedSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used + segment.units > MEASURE_UNITS) continue;
    out.push(segment);
    used += segment.units;
  }
  while (fill && used < MEASURE_UNITS) {
    out.push({ kind: "note", units: 1, step: "C" });
    used += 1;
  }
  return out;
}

function segmentXml(segment: GeneratedSegment, voice: number): string {
  if (segment.kind === "gap") return `<forward><duration>${segment.units}</duration><voice>${voice}</voice></forward>`;
  const type = `<type>${LENGTH_TYPES[segment.units]}</type>`;
  if (segment.kind === "rest") return `<note><rest/><duration>${segment.units}</duration><voice>${voice}</voice>${type}</note>`;
  return `<note><pitch><step>${segment.step}</step><octave>4</octave></pitch><duration>${segment.units}</duration><voice>${voice}</voice>${type}</note>`;
}

function unitsOf(segments: GeneratedSegment[]): number {
  return segments.reduce((sum, s) => sum + s.units, 0);
}

function twoVoiceScoreXml(voice1: GeneratedSegment[][], voice2: GeneratedSegment[][]): string {
  const measures = voice1.map((segments1, m) => {
    const attributes =
      m === 0
        ? `<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
        : "";
    const first = segments1.map((s) => segmentXml(s, 1)).join("");
    const segments2 = voice2[m];
    const second = segments2.length > 0 ? `<backup><duration>${unitsOf(segments1)}</duration></backup>${segments2.map((s) => segmentXml(s, 2)).join("")}` : "";
    return `<measure number="${m + 1}">${attributes}${first}${second}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures.join("")}</part>
</score-partwise>`;
}

const genSegment = (kinds: Array<"note" | "rest" | "gap">) =>
  fc.record({
    kind: fc.constantFrom(...kinds),
    units: fc.constantFrom(1, 2, 4),
    step: fc.constantFrom(...STEP_LETTERS),
  });

const genPaddingScore = fc.integer({ min: 1, max: 4 }).chain((measureCount) =>
  fc.record({
    voice1: fc.array(
      fc.array(genSegment(["note", "rest"]), { maxLength: 8 }).map((s) => fitSegments(s, true)),
      { minLength: measureCount, maxLength: measureCount }
    ),
    voice2: fc.array(
      fc.array(genSegment(["note", "rest", "gap"]), { maxLength: 8 }).map((s) => fitSegments(s, false)),
      { minLength: measureCount, maxLength: measureCount }
    ),
  })
);

function closingBarCount(voice: VoiceElement[]): number {
  return voice.filter((e) => isBarElement(e) && e.type !== BarType.BarLeftRepeat).length;
}

function pitchedSequence(voice: VoiceElement[]): string[] {
  return voice
    .filter((e): e is NoteElement => e.el_type === ElementType.Note && !!(e as NoteElement).pitches?.length)
    .map((n) => `${n.pitches![0].pitch}:${n.duration.numerator}/${n.duration.denominator}`);
}

function expectedPitchedSequence(measures: GeneratedSegment[][]): string[] {
  return measures.flatMap((segments) =>
    segments
      .filter((s) => s.kind === "note")
      .map((s) => {
        const duration = { numerator: s.units, denominator: MEASURE_UNITS };
        const divisor = s.units === 2 ? 2 : s.units === 4 ? 4 : 1;
        return `${stepOctaveToDiatonic(STEP_LETTERS.indexOf(s.step), 4)}:${duration.numerator / divisor}/${duration.denominator / divisor}`;
      })
  );
}

describe("importFromMusicSheet rest padding properties", () => {
  it("fills every measure of every voice to the measure's length", () => {
    fc.assert(
      fc.property(genPaddingScore, ({ voice1, voice2 }) => {
        const tune = importFromMusicSheet(parseMusicXmlToSheet(twoVoiceScoreXml(voice1, voice2)));
        const system = tune.systems[0] as StaffSystem;
        for (const voice of system.staff[0].voices) {
          for (const measure of measuresOf(voice)) {
            expect(durationSum(measure)).to.be.closeTo(1, 1e-9);
          }
        }
      }),
      { numRuns: 60 }
    );
  });

  it("never outputs a voice without pitched notes, and keeps every voice that has one", () => {
    fc.assert(
      fc.property(genPaddingScore, ({ voice1, voice2 }) => {
        const tune = importFromMusicSheet(parseMusicXmlToSheet(twoVoiceScoreXml(voice1, voice2)));
        const voices = (tune.systems[0] as StaffSystem).staff.flatMap((s) => s.voices);
        const voice1HasNotes = voice1.some((m) => m.some((s) => s.kind === "note"));
        const voice2HasNotes = voice2.some((m) => m.some((s) => s.kind === "note"));
        const expectedCount = (voice1HasNotes ? 1 : 0) + (voice2HasNotes ? 1 : 0);
        expect(voices.length).to.equal(Math.max(expectedCount, 1));
        if (expectedCount > 0) {
          for (const voice of voices) expect(pitchedSequence(voice).length).to.be.greaterThan(0);
        }
      }),
      { numRuns: 60 }
    );
  });

  it("gives every voice the same number of closing bars", () => {
    fc.assert(
      fc.property(genPaddingScore, ({ voice1, voice2 }) => {
        const tune = importFromMusicSheet(parseMusicXmlToSheet(twoVoiceScoreXml(voice1, voice2)));
        const counts = (tune.systems[0] as StaffSystem).staff.flatMap((s) => s.voices).map(closingBarCount);
        expect(new Set(counts).size).to.equal(1);
        expect(counts[0]).to.equal(voice1.length);
      }),
      { numRuns: 60 }
    );
  });

  it("preserves each surviving voice's pitched sequence once the padding rests are ignored", () => {
    fc.assert(
      fc.property(genPaddingScore, ({ voice1, voice2 }) => {
        const tune = importFromMusicSheet(parseMusicXmlToSheet(twoVoiceScoreXml(voice1, voice2)));
        const voices = (tune.systems[0] as StaffSystem).staff[0].voices;
        const expected = [expectedPitchedSequence(voice1), expectedPitchedSequence(voice2)].filter((seq) => seq.length > 0);
        if (expected.length === 0) return;
        expect(voices.map(pitchedSequence)).to.deep.equal(expected);
      }),
      { numRuns: 60 }
    );
  });
});
