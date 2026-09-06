import { expect } from "chai";
import * as fc from "fast-check";
import { ElementType, isMusicLine, NoteElement } from "../types/abcjs-ast";
import { importFromMusicSheet, stepOctaveToDiatonic } from "./importFromMusicSheet";
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
