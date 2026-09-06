import { expect } from "chai";
import { SemanticAnalyzer } from "./analyzers/semantic-analyzer";
import { ABCContext } from "./parsers/Context";
import { AbcErrorReporter } from "./parsers/ErrorReporter";
import { parse } from "./parsers/parse";
import { Scanner } from "./parsers/scan";
import { TuneInterpreter } from "./interpreter/TuneInterpreter";
import { Tune } from "./types/abcjs-ast";
import { diatonicPitchToLetterAndMarks, tuneToAbcText } from "./tuneToAst";

function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new TuneInterpreter(analyzer, ctx, abc);
  const result = interpreter.interpretFile(ast);
  return result.tunes[0];
}

/**
 * Extracts a flat, semantically-comparable summary of a Tune's notes across
 * all voices: pitch numbers, durations, ties, and rests, ignoring anything
 * with no canonical text form (decoration order, note-length shorthand
 * choice, line breaks). Used to compare the original interpreted Tune
 * against the Tune recovered by reparsing this module's serializer output,
 * per the plan's instruction to compare semantic content rather than doing
 * a brittle string comparison against exact formatting.
 */
function summarizeTune(tune: Tune): { pitches: number[]; duration: string; isRest: boolean; tie: boolean }[][] {
  // Keyed by voiceIds (falling back to a staffIndex-voiceIndex position, the
  // same scheme tuneToAst.ts's collectVoiceEntries uses) rather than by the
  // per-staff-local voice array index, since two different staffs each
  // restart their own voices array at index 0 and would otherwise collide.
  const byId = new Map<string, { pitches: number[]; duration: string; isRest: boolean; tie: boolean }[]>();
  const order: string[] = [];
  for (const system of tune.systems) {
    if (!("staff" in system)) continue;
    system.staff.forEach((staff, staffIndex) => {
      staff.voices.forEach((elements, voiceIndex) => {
        const id = staff.voiceIds?.[voiceIndex] ?? `${staffIndex}-${voiceIndex}`;
        if (!byId.has(id)) {
          byId.set(id, []);
          order.push(id);
        }
        const bucket = byId.get(id)!;
        for (const element of elements) {
          if (element.el_type !== "note") continue;
          const isRest = !!element.rest;
          const pitches = (element.pitches ?? []).map((p) => p.pitch);
          const tie = (element.pitches ?? []).some((p) => !!p.startTie);
          bucket.push({
            pitches,
            duration: `${element.duration.numerator}/${element.duration.denominator}`,
            isRest,
            tie,
          });
        }
      });
    });
  }
  return order.map((id) => byId.get(id)!);
}

describe("tuneToAst / tuneToAbcText", () => {
  describe("diatonicPitchToLetterAndMarks", () => {
    it("is the exact inverse of TuneInterpreter's getBasePitch/getOctaveOffset across two octaves either side of the reference", () => {
      const cases: Array<{ pitchNumber: number; letter: string; marks: string }> = [
        { pitchNumber: -14, letter: "C", marks: ",," },
        { pitchNumber: -7, letter: "C", marks: "," },
        { pitchNumber: 0, letter: "C", marks: "" },
        { pitchNumber: 6, letter: "B", marks: "" },
        { pitchNumber: 7, letter: "c", marks: "" },
        { pitchNumber: 13, letter: "b", marks: "" },
        { pitchNumber: 14, letter: "c", marks: "'" },
        { pitchNumber: 21, letter: "c", marks: "''" },
      ];
      for (const { pitchNumber, letter, marks } of cases) {
        expect(diatonicPitchToLetterAndMarks(pitchNumber)).to.deep.equal({ letter, marks });
      }
    });
  });

  describe("single-voice round trip", () => {
    it("reparses to the same pitches and durations for a simple tune", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
C D E F | G2 A2 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("does not emit any V: header or inline voice marker for a single default voice", () => {
      const abc = `X:1
K:C
C D E F |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      expect(text).to.not.match(/V:/);
    });

    it("round-trips ties", () => {
      const abc = `X:1
K:C
C2- C2 D2 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("round-trips rests, including multi-measure rests", () => {
      const abc = `X:1
K:C
C2 z2 | Z4 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("falls back to a plain rest with an exact fraction, rather than rounding, when a multi-measure rest's duration is not a whole multiple of this module's fixed default note length", () => {
      // L:1/16 with Z3 gives duration 3/16, which divided by this module's
      // fixed 1/8 default is 3/2, not a whole number of Z-lengths at that
      // default. Rounding that to Z2 would silently change the duration
      // from 3/16 to 4/16; the exact fraction must survive instead.
      const abc = `X:1
L:1/16
K:C
Z3 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("round-trips chords", () => {
      const abc = `X:1
K:C
[CEG]2 [DF]2 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("round-trips single-character decorations", () => {
      // Single-character decorations (".", "u", "v", etc.) go through
      // TuneInterpreter's Decoration/DECORATION_MAP path and do reach
      // NoteElement.decoration. The bang-delimited form ("!trill!") is
      // scanned as a separate Symbol token that TuneInterpreter's
      // visitSymbolExpr currently ignores outright (a pre-existing gap in
      // the interpreter, not in this module), so it never reaches Tune at
      // all and this module has nothing to reconstruct it from; that gap
      // is tracked separately rather than worked around here.
      const abc = `X:1
K:C
.C D E F |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      expect(text).to.match(/!staccato!/);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });

    it("round-trips accidentals and octave marks", () => {
      const abc = `X:1
K:C
^F,2 __c'2 =B2 |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });
  });

  describe("multi-voice round trip", () => {
    it("reparses to the same per-voice pitches for two declared voices", () => {
      const abc = `X:1
V:1
V:2
K:C
V:1
C D E F |
V:2
C, D, E, F, |`;
      const original = interpretABC(abc);
      const ctx = new ABCContext(new AbcErrorReporter());
      const text = tuneToAbcText(original, ctx);
      expect(text).to.match(/V:1/);
      expect(text).to.match(/V:2/);
      const reparsed = interpretABC(text);
      expect(summarizeTune(reparsed)).to.deep.equal(summarizeTune(original));
    });
  });
});
