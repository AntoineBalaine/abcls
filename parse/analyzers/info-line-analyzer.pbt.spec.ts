import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { KeyInfo, Meter, MeterType } from "../types/abcjs-ast";
import { IRational } from "../Visitors/fmt/rational";
import * as Gen from "./info-line-analyzer.pbt.generators";
import { SemanticAnalyzer } from "./semantic-analyzer";

describe("Info Line Analyzer - Property-Based Tests", () => {
  let analyzer: SemanticAnalyzer;
  let context: ABCContext;

  beforeEach(() => {
    const errorReporter = new AbcErrorReporter();
    context = new ABCContext(errorReporter);
    analyzer = new SemanticAnalyzer(context);
  });

  // ============================================================================
  // Key Info Line Properties (K:)
  // ============================================================================

  describe("Key Info Lines (K:)", () => {
    it("should correctly parse simple key info lines (root only)", () => {
      fc.assert(
        fc.property(Gen.genKeyInfoSimple, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("key");

          const keyData = result.data as KeyInfo;
          expect(keyData.keySignature!.root).to.equal(gen.expected.root);
          expect(keyData.keySignature!.acc).to.equal(gen.expected.acc);
          expect(keyData.keySignature!.mode).to.equal(gen.expected.mode);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("should correctly parse key info lines with accidentals", () => {
      fc.assert(
        fc.property(Gen.genKeyInfoWithAccidental, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("key");

          const keyData = result.data as KeyInfo;
          expect(keyData.keySignature!.root).to.equal(gen.expected.root);
          expect(keyData.keySignature!.acc).to.equal(gen.expected.acc);
          expect(keyData.keySignature!.mode).to.equal(gen.expected.mode);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("should correctly parse key info lines with modes", () => {
      fc.assert(
        fc.property(Gen.genKeyInfoWithMode, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("key");

          const keyData = result.data as KeyInfo;
          expect(keyData.keySignature!.root).to.equal(gen.expected.root);
          expect(keyData.keySignature!.acc).to.equal(gen.expected.acc);
          expect(keyData.keySignature!.mode).to.equal(gen.expected.mode);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should correctly parse key info lines with clef", () => {
      fc.assert(
        fc.property(Gen.genKeyInfoWithClef, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("key");

          const keyData = result.data as KeyInfo;
          expect(keyData.keySignature!.root).to.equal(gen.expected.root);
          expect(keyData.keySignature!.acc).to.equal(gen.expected.acc);
          expect(keyData.keySignature!.mode).to.equal(gen.expected.mode);

          if (gen.expected.clef) {
            expect(keyData.clef).to.not.be.undefined;
            expect(keyData.clef?.type).to.equal(gen.expected.clef);
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("should have idempotent analysis (same info line = same result)", () => {
      fc.assert(
        fc.property(Gen.genKeyInfo, (gen) => {
          const context1 = new ABCContext(new AbcErrorReporter());
          const analyzer1 = new SemanticAnalyzer(context1);
          const result1 = analyzer1.visitInfoLineExpr(gen.infoLine);

          const context2 = new ABCContext(new AbcErrorReporter());
          const analyzer2 = new SemanticAnalyzer(context2);
          const result2 = analyzer2.visitInfoLineExpr(gen.infoLine);

          return JSON.stringify(result1) === JSON.stringify(result2);
        }),
        { numRuns: 50 }
      );
    });
  });

  // ============================================================================
  // Meter Info Line Properties (M:)
  // ============================================================================

  describe("Meter Info Lines (M:)", () => {
    it("should correctly parse common time (M:C)", () => {
      fc.assert(
        fc.property(Gen.genMeterInfoCommonTime, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("meter");

          const meterData = result.data as Meter;
          expect(meterData.type).to.equal(MeterType.CommonTime);
          expect(meterData.value).to.not.be.undefined;
          expect(meterData.value![0].numerator).to.equal(4);
          expect(meterData.value![0].denominator).to.equal(4);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    it("should correctly parse cut time (M:C|)", () => {
      fc.assert(
        fc.property(Gen.genMeterInfoCutTime, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("meter");

          const meterData = result.data as Meter;
          expect(meterData.type).to.equal(MeterType.CutTime);
          expect(meterData.value).to.not.be.undefined;
          expect(meterData.value![0].numerator).to.equal(2);
          expect(meterData.value![0].denominator).to.equal(2);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    it("should correctly parse numeric meters (M:3/4, M:6/8, etc.)", () => {
      fc.assert(
        fc.property(Gen.genMeterInfoNumeric, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("meter");

          const meterData = result.data as Meter;
          expect(meterData.type).to.equal(MeterType.Specified);
          expect(meterData.value).to.not.be.undefined;
          expect(meterData.value![0].numerator).to.equal(gen.expected.numerator);
          expect(meterData.value![0].denominator).to.equal(gen.expected.denominator);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should have idempotent analysis (same info line = same result)", () => {
      fc.assert(
        fc.property(Gen.genMeterInfo, (gen) => {
          const context1 = new ABCContext(new AbcErrorReporter());
          const analyzer1 = new SemanticAnalyzer(context1);
          const result1 = analyzer1.visitInfoLineExpr(gen.infoLine);

          const context2 = new ABCContext(new AbcErrorReporter());
          const analyzer2 = new SemanticAnalyzer(context2);
          const result2 = analyzer2.visitInfoLineExpr(gen.infoLine);

          return JSON.stringify(result1) === JSON.stringify(result2);
        }),
        { numRuns: 50 }
      );
    });
  });

  // ============================================================================
  // Note Length Info Line Properties (L:)
  // ============================================================================

  describe("Note Length Info Lines (L:)", () => {
    it("should correctly parse note length specifications", () => {
      fc.assert(
        fc.property(Gen.genNoteLenInfo, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (!result) return false;

          expect(result.type).to.equal("note_length");

          const noteLenData = result.data as IRational;
          expect(noteLenData.numerator).to.equal(gen.expected.numerator);
          expect(noteLenData.denominator).to.equal(gen.expected.denominator);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should have idempotent analysis (same info line = same result)", () => {
      fc.assert(
        fc.property(Gen.genNoteLenInfo, (gen) => {
          const context1 = new ABCContext(new AbcErrorReporter());
          const analyzer1 = new SemanticAnalyzer(context1);
          const result1 = analyzer1.visitInfoLineExpr(gen.infoLine);

          const context2 = new ABCContext(new AbcErrorReporter());
          const analyzer2 = new SemanticAnalyzer(context2);
          const result2 = analyzer2.visitInfoLineExpr(gen.infoLine);

          return JSON.stringify(result1) === JSON.stringify(result2);
        }),
        { numRuns: 50 }
      );
    });
  });

  // ============================================================================
  // Cross-cutting Properties
  // ============================================================================

  describe("General Properties", () => {
    it("should store all analyzed info lines in the data map", () => {
      fc.assert(
        fc.property(Gen.genAnyInfoLine, (gen) => {
          const result = analyzer.visitInfoLineExpr(gen.infoLine);

          if (result !== null) {
            expect(analyzer.data.has(gen.infoLine.id)).to.be.true;
            expect(analyzer.data.get(gen.infoLine.id)).to.deep.equal(result);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should have monotonically growing data map", () => {
      fc.assert(
        fc.property(fc.array(Gen.genAnyInfoLine, { minLength: 1, maxLength: 20 }), (infoLines) => {
          const analyzer = new SemanticAnalyzer(new ABCContext(new AbcErrorReporter()));
          let previousSize = 0;

          for (const gen of infoLines) {
            const result = analyzer.visitInfoLineExpr(gen.infoLine);

            if (result !== null) {
              expect(analyzer.data.size).to.be.at.least(previousSize);
              previousSize = analyzer.data.size;
            }
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });
  });
});
