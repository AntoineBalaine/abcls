import { expect } from "chai";
import * as fc from "fast-check";
import { ElementType, MediaType, Tune, NoteElement, BarElement, VoiceElement, Pitch, KeyRoot, KeyAccidental, Mode, MeterType } from "../types/abcjs-ast";
import { createRational } from "../Visitors/fmt/rational";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

function makeTune(voiceElements: VoiceElement[]): Tune {
  return {
    version: "1.1.0",
    media: MediaType.Screen,
    metaText: {},
    metaTextInfo: {},
    formatting: {},
    systems: [
      {
        staff: [
          {
            clef: { verticalPos: 0 },
            key: { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] },
            meter: { type: MeterType.Specified, value: [createRational(4, 4)] },
            workingClef: { verticalPos: 0 },
            voices: [voiceElements],
          },
        ],
      },
    ],
    staffNum: 1,
    voiceNum: 1,
    lineNum: 1,
    getBeatLength: () => 0.25,
    getPickupLength: () => 0,
    getBarLength: () => 1,
    getTotalTime: () => 0,
    getTotalBeats: () => 0,
    millisecondsPerMeasure: () => 1000,
    getBeatsPerMeasure: () => 4,
    getMeter: () => ({ type: MeterType.Specified }),
    getMeterFraction: () => createRational(4, 4),
    getKeySignature: () => ({ root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] }),
    getElementFromChar: () => null,
    getBpm: () => 120,
    setTiming: () => [],
    setUpAudio: () => null,
    deline: () => null,
    findSelectableElement: () => null,
    getSelectableArray: () => [],
  };
}

const pitchNumberArb = fc.integer({ min: -7, max: 13 });
const denominatorArb = fc.constantFrom(1, 2, 4, 8, 16);

const noteArb: fc.Arbitrary<NoteElement> = fc.record({
  pitchNumber: pitchNumberArb,
  numerator: fc.integer({ min: 1, max: 3 }),
  denominator: denominatorArb,
}).map(({ pitchNumber, numerator, denominator }): NoteElement => {
  const pitch: Pitch = { pitch: pitchNumber, name: "", verticalPos: pitchNumber };
  return {
    el_type: ElementType.Note,
    startChar: 0,
    endChar: 0,
    duration: createRational(numerator, denominator),
    pitches: [pitch],
  };
});

const barArb: fc.Arbitrary<BarElement> = fc.constant({
  el_type: ElementType.Bar,
  startChar: 0,
  endChar: 0,
  type: "bar_thin" as never,
});

const voiceElementArb: fc.Arbitrary<VoiceElement> = fc.oneof({ arbitrary: noteArb, weight: 4 }, { arbitrary: barArb, weight: 1 });

describe("Tune to MusicXML property-based round trip", () => {
  it("always produces XSD-valid MusicXML for arbitrary well-formed Tune objects", () => {
    fc.assert(
      fc.property(fc.array(voiceElementArb, { minLength: 1, maxLength: 30 }), (elements) => {
        const tune = makeTune(elements);
        const xml = serializeScorePartwise(normalizeForMusicXML(tune));
        const result = validateAgainstMusicXmlSchema(xml);
        expect(result.valid, result.errors.join("\n")).to.equal(true);
      }),
      { numRuns: 100 }
    );
  });
});
