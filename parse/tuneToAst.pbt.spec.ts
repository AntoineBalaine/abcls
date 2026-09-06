import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "./analyzers/semantic-analyzer";
import { TuneInterpreter } from "./interpreter/TuneInterpreter";
import { ABCContext } from "./parsers/Context";
import { AbcErrorReporter } from "./parsers/ErrorReporter";
import { parse } from "./parsers/parse";
import { Scanner } from "./parsers/scan";
import { createRational } from "./Visitors/fmt/rational";
import { BarElement, ElementType, KeyAccidental, KeyRoot, MediaType, MeterType, Mode, NoteElement, Pitch, RestType, Tune, VoiceElement } from "./types/abcjs-ast";
import { tuneToAbcText } from "./tuneToAst";

/**
 * The same makeTune shape parse/musicxml/normalize.pbt.spec.ts already uses,
 * duplicated here rather than imported: this module lives outside
 * parse/musicxml/ (per the plan, since this serializer is not
 * MusicXML-specific) and normalize.pbt.spec.ts's makeTune is a test-only
 * helper local to that file, not something either side is meant to import
 * from the other's spec.
 */
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

function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new TuneInterpreter(analyzer, ctx, abc);
  return interpreter.interpretFile(ast).tunes[0];
}

const pitchNumberArb = fc.integer({ min: -7, max: 13 });
const denominatorArb = fc.constantFrom(1, 2, 4, 8, 16);

const noteArb: fc.Arbitrary<NoteElement> = fc
  .record({
    pitchNumber: pitchNumberArb,
    numerator: fc.integer({ min: 1, max: 3 }),
    denominator: denominatorArb,
  })
  .map(({ pitchNumber, numerator, denominator }): NoteElement => {
    const pitch: Pitch = { pitch: pitchNumber, name: "", verticalPos: pitchNumber };
    return {
      el_type: ElementType.Note,
      startChar: 0,
      endChar: 0,
      duration: createRational(numerator, denominator),
      pitches: [pitch],
    };
  });

const restArb: fc.Arbitrary<NoteElement> = fc
  .record({ numerator: fc.integer({ min: 1, max: 3 }), denominator: denominatorArb })
  .map(({ numerator, denominator }): NoteElement => ({
    el_type: ElementType.Note,
    startChar: 0,
    endChar: 0,
    duration: createRational(numerator, denominator),
    rest: { type: RestType.Rest },
  }));

const barArb: fc.Arbitrary<BarElement> = fc.constant({
  el_type: ElementType.Bar,
  startChar: 0,
  endChar: 0,
  type: "bar_thin" as never,
});

const voiceElementArb: fc.Arbitrary<VoiceElement> = fc.oneof({ arbitrary: noteArb, weight: 3 }, { arbitrary: restArb, weight: 1 }, { arbitrary: barArb, weight: 1 });

describe("tuneToAbcText property-based round trip", () => {
  it("always produces ABC text that reparses successfully and preserves pitch and duration for arbitrary well-formed Tune objects", () => {
    fc.assert(
      fc.property(fc.array(voiceElementArb, { minLength: 1, maxLength: 30 }), (elements) => {
        const tune = makeTune(elements);
        const ctx = new ABCContext(new AbcErrorReporter());
        const text = tuneToAbcText(tune, ctx);

        const reparsed = interpretABC(text);
        expect(reparsed, `failed to reparse:\n${text}`).to.not.be.undefined;

        const originalNotes = elements.filter((e): e is NoteElement => e.el_type === ElementType.Note);
        const reparsedNotes: NoteElement[] = [];
        for (const system of reparsed.systems) {
          if (!("staff" in system)) continue;
          for (const staff of system.staff) {
            for (const voice of staff.voices) {
              for (const el of voice) {
                if (el.el_type === ElementType.Note) reparsedNotes.push(el as NoteElement);
              }
            }
          }
        }

        expect(reparsedNotes.length).to.equal(originalNotes.length);
        for (let i = 0; i < originalNotes.length; i++) {
          const original = originalNotes[i];
          const reparsedNote = reparsedNotes[i];
          expect(!!reparsedNote.rest).to.equal(!!original.rest);
          if (!original.rest) {
            expect(reparsedNote.pitches?.map((p) => p.pitch)).to.deep.equal(original.pitches?.map((p) => p.pitch));
          }
          const originalDuration = original.duration.numerator / original.duration.denominator;
          const reparsedDuration = reparsedNote.duration.numerator / reparsedNote.duration.denominator;
          expect(reparsedDuration).to.be.closeTo(originalDuration, 1e-9);
        }
      }),
      { numRuns: 100 }
    );
  });
});
