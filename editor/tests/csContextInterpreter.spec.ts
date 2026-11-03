import { ABCContext, Scanner, parse, SemanticAnalyzer, AbcErrorReporter } from "abcls-parser";
import { SemanticData } from "abcls-parser/analyzers/semantic-analyzer";
import { encode, getRangeSnapshots, getSnapshotAtPosition } from "abcls-parser/interpreter/ContextInterpreter";
import { MeterType } from "abcls-parser/types/abcjs-ast";
import { expect } from "chai";
import * as fc from "fast-check";
import { interpretContext } from "../src/context/csContextInterpreter";
import { fromAst } from "../src/csTree/fromAst";
import { CSNode } from "../src/csTree/types";

// ============================================================================
// Test Helpers
// ============================================================================

function parseToCSTree(input: string): { csTree: CSNode; semanticData: Map<number, SemanticData>; ctx: ABCContext } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(input, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const csTree = fromAst(ast, ctx);
  return { csTree, semanticData: analyzer.data, ctx };
}

// ============================================================================
// Interpreter Tests
// ============================================================================

describe("CSTree ContextInterpreter", () => {
  describe("interpretContext()", () => {
    it("should create snapshots for M:, K: directives", () => {
      const input = "X:1\nM:4/4\nK:G\n|C D E F|";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.be.greaterThan(0);

      const lastSnapshot = result[result.length - 1].snapshot;
      expect(lastSnapshot.key.root).to.equal("G");
    });

    it("should increment measureNumber on barlines", () => {
      // We add an inline [K:C] at the end to trigger a snapshot that captures the accumulated measureNumber.
      // Without it, the only snapshot would be the initial body snapshot (measureNumber=1),
      // because barlines increment measureNumber but don't push snapshots on their own.
      const input = "X:1\nM:4/4\nK:C\n|C D E F|G A B c|d e f g|[K:C]";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      // 4 barlines -> inline field snapshot after all barlines should have measureNumber = 5 (1 + 4)
      const lastSnapshot = result[result.length - 1].snapshot;
      expect(lastSnapshot.measureNumber).to.equal(5);
    });

    it("should track meter change via inline field", () => {
      const input = "X:1\nM:4/4\nK:C\n|C D [M:3/4] E F|";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      // Should have snapshots for: initial body snapshot (with M:4/4, K:C) + [M:3/4] inline field
      expect(result.length).to.equal(2);

      // First snapshot: initial body state with 4/4 meter
      expect(result[0].snapshot.meter.value![0].numerator).to.equal(4);
      expect(result[0].snapshot.meter.value![0].denominator).to.equal(4);

      // Second snapshot: after [M:3/4] inline field
      const lastSnapshot = result[result.length - 1].snapshot;
      expect(lastSnapshot.meter.type).to.equal(MeterType.Specified);
      expect(lastSnapshot.meter.value![0].numerator).to.equal(3);
      expect(lastSnapshot.meter.value![0].denominator).to.equal(4);
    });

    it("should track tempo change via Q: directive", () => {
      const input = "X:1\nM:4/4\nQ:120\nK:C\n|C D E F|";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.equal(1);

      const snapshot = result[0].snapshot;
      expect(snapshot.tempo).to.not.be.undefined;
      expect(snapshot.tempo.bpm).to.equal(120);
    });

    it("property: measureNumber in last snapshot equals barline count + 1", () => {
      const genNote = fc.constantFrom("C", "D", "E", "F", "G", "A", "B");

      const genTuneBodyWithBarlines = fc
        .tuple(fc.array(genNote, { minLength: 1, maxLength: 20 }), fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 0, maxLength: 10 }))
        .map(([notes, barlinePositions]) => {
          const uniquePositions = [...new Set(barlinePositions)].map((p) => Math.min(p, notes.length)).sort((a, b) => b - a);

          const elements: string[] = [...notes];
          for (const pos of uniquePositions) {
            elements.splice(pos, 0, "|");
          }

          // We append an inline [K:C] to trigger a snapshot that captures the final measureNumber,
          // because barlines increment measureNumber but don't push snapshots on their own.
          return {
            tuneString: `X:1\nM:4/4\nK:C\n${elements.join(" ")}[K:C]\n`,
            expectedMeasureNumber: uniquePositions.length + 1,
          };
        });

      fc.assert(
        fc.property(genTuneBodyWithBarlines, ({ tuneString, expectedMeasureNumber }) => {
          const { csTree, semanticData } = parseToCSTree(tuneString);
          const result = interpretContext(csTree, semanticData);

          // The last snapshot (from the inline [K:C]) should have measureNumber equal to barline count + 1
          const lastSnapshot = result[result.length - 1].snapshot;
          return lastSnapshot.measureNumber === expectedMeasureNumber;
        }),
        { numRuns: 100 }
      );
    });

    it("property: initial body snapshot captures all header context", () => {
      const genMeter = fc.constantFrom("4/4", "3/4", "6/8", "2/4");
      const genKey = fc.constantFrom("C", "G", "D", "Am", "Em");

      const genTuneWithDirectives = fc
        .tuple(genMeter, genKey, fc.array(fc.constantFrom("C", "D", "E"), { minLength: 1, maxLength: 10 }))
        .map(([meter, key, notes]) => {
          const header = `X:1\nM:${meter}\nK:${key}\n`;
          const body = notes.join(" ") + "\n";

          const [num, denom] = meter.split("/").map(Number);

          return {
            tuneString: header + body,
            expectedMeterNum: num,
            expectedMeterDenom: denom,
            expectedKeyRoot: key.replace("m", ""),
          };
        });

      fc.assert(
        fc.property(genTuneWithDirectives, ({ tuneString, expectedMeterNum, expectedMeterDenom, expectedKeyRoot }) => {
          const { csTree, semanticData } = parseToCSTree(tuneString);
          const result = interpretContext(csTree, semanticData);

          if (result.length !== 1) return false;

          const snapshot = result[0].snapshot;

          if (snapshot.meter.value![0].numerator !== expectedMeterNum) return false;
          if (snapshot.meter.value![0].denominator !== expectedMeterDenom) return false;
          if (snapshot.key.root !== expectedKeyRoot) return false;

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ============================================================================
  // Query Function Tests
  // ============================================================================

  describe("getSnapshotAtPosition()", () => {
    it("should return snapshot for position after all snapshots", () => {
      const input = "X:1\nM:4/4\nK:C\n|C D E F|";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      const snapshot = getSnapshotAtPosition(result, encode(100, 0));
      expect(snapshot).to.not.be.null;
      expect(snapshot!.key.root).to.equal("C");
    });
  });

  describe("getRangeSnapshots()", () => {
    it("should return snapshots within range", () => {
      const input = `X:1
M:4/4
K:C
|C D [M:3/4] E F| [K:G] G A|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      const range = {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 30 },
      };

      const rangeSnapshots = getRangeSnapshots(result, range);

      expect(rangeSnapshots.length).to.be.greaterThan(0);
      expect(rangeSnapshots.every((s) => s.pos <= encode(range.end.line, range.end.character))).to.be.true;
    });
  });

  describe("header key and meter with voices declared in the header", () => {
    it("applies the header K: and M: to the voices declared before it", () => {
      const input = "X:1\nV:1\nV:2\nM:6/8\nK:D\n[V:1] F|\n[V:2] F|\n";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      const voice1Snapshot = getSnapshotAtPosition(result, encode(5, 7));
      expect(voice1Snapshot.voiceId).to.equal("1");
      expect(voice1Snapshot.key.root).to.equal("D");
      expect(voice1Snapshot.meter.value?.[0]).to.deep.equal({ numerator: 6, denominator: 8 });

      const voice2Snapshot = getSnapshotAtPosition(result, encode(6, 7));
      expect(voice2Snapshot.voiceId).to.equal("2");
      expect(voice2Snapshot.key.root).to.equal("D");
    });
  });

  describe("voice context in snapshots", () => {
    it("should track voice switches via voiceId field", () => {
      const input = `X:1
M:4/4
K:C
V:1
|C D|
V:2
|E F|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      const voice1Snapshots = result.filter((s) => s.snapshot.voiceId === "1");
      const voice2Snapshots = result.filter((s) => s.snapshot.voiceId === "2");

      expect(voice1Snapshots.length).to.be.greaterThan(0);
      expect(voice2Snapshots.length).to.be.greaterThan(0);
    });

    it("should allow getSnapshotAtPosition to return voice context at position", () => {
      const input = `X:1
M:4/4
K:C
V:1
|C D|
V:2
|E F|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      const posAfterV2 = encode(6, 0);
      const snapshot = getSnapshotAtPosition(result, posAfterV2);

      expect(snapshot).to.not.be.null;
      expect(snapshot!.voiceId).to.equal("2");
    });
  });

  // ============================================================================
  // Multi-Tune Tests
  // ============================================================================

  describe("multiple tunes", () => {
    it("should accumulate snapshots across multiple tunes in position order", () => {
      const input = "X:1\nK:C\nCDE|\n\nX:2\nK:G\nGAB|";
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.be.greaterThan(1);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].pos).to.be.greaterThan(result[i - 1].pos);
      }

      const keys = result.map((s) => s.snapshot.key.root);
      expect(keys).to.include("C");
      expect(keys).to.include("G");
    });

    it("should return snapshots from multiple tunes when range spans them", () => {
      const input = "X:1\nK:C\nCDE|\n\nX:2\nK:G\nGAB|";
      const { csTree, semanticData } = parseToCSTree(input);
      const snapshots = interpretContext(csTree, semanticData);

      const range = { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } };
      const rangeSnapshots = getRangeSnapshots(snapshots, range);

      const keys = rangeSnapshots.map((s) => s.snapshot.key.root);
      expect(keys).to.include("C");
      expect(keys).to.include("G");
    });

    it("should reset tune state between tunes but maintain snapshot order", () => {
      const input = `X:1
M:4/4
K:C
|C D E F|

X:5
M:3/4
K:G
|G A B|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.be.greaterThanOrEqual(2);

      const meters = result.map((s) => s.snapshot.meter.value?.[0]?.numerator);
      expect(meters).to.include(4);
      expect(meters).to.include(3);
    });
  });

  // ============================================================================
  // Flat Snapshot List Tests
  // ============================================================================

  describe("flat snapshot list", () => {
    it("should contain all snapshots from all voices in document order", () => {
      const input = `X:1
M:4/4
K:C
V:1
K:G
|C D|
V:2
K:D
|E F|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.be.greaterThanOrEqual(3);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].pos).to.be.greaterThanOrEqual(result[i - 1].pos);
      }
    });

    it("should create one initial snapshot capturing all header context", () => {
      const input = `X:1
M:4/4
K:C
|C D E F|
`;
      const { csTree, semanticData } = parseToCSTree(input);
      const result = interpretContext(csTree, semanticData);

      expect(result.length).to.equal(1);

      const snapshot = result[0].snapshot;
      expect(snapshot.meter.value![0].numerator).to.equal(4);
      expect(snapshot.meter.value![0].denominator).to.equal(4);
      expect(snapshot.key.root).to.equal("C");
    });

    it("property: snapshots array is always sorted by position", () => {
      const genMeter = fc.constantFrom("4/4", "3/4", "6/8");
      const genKey = fc.constantFrom("C", "G", "D", "Am");

      const genMultiTune = fc.array(fc.tuple(genMeter, genKey), { minLength: 1, maxLength: 3 }).map((tunes) => {
        return tunes.map(([meter, key], i) => `X:${i + 1}\nM:${meter}\nK:${key}\n|C D E|\n`).join("\n");
      });

      fc.assert(
        fc.property(genMultiTune, (tuneString) => {
          const { csTree, semanticData } = parseToCSTree(tuneString);
          const result = interpretContext(csTree, semanticData);

          for (let i = 1; i < result.length; i++) {
            if (result[i].pos < result[i - 1].pos) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
