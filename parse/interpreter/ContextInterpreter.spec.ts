import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer, SemanticData } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { MeterType } from "../types/abcjs-ast";
import { File_structure } from "../types/Expr";
import { encode, binarySearchFloor, ContextInterpreter, getRangeSnapshots, getSnapshotAtPosition } from "./ContextInterpreter";

// ============================================================================
// Test Helpers
// ============================================================================

function parseWithSemantics(input: string): { ast: File_structure; semanticData: Map<number, SemanticData>; ctx: ABCContext } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(input, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return { ast, semanticData: analyzer.data, ctx };
}

// ============================================================================
// Phase 1: Utility Function Tests
// ============================================================================

describe("ContextInterpreter", () => {
  describe("encode()", () => {
    it("should encode (0, 0) as 0", () => {
      expect(encode(0, 0)).to.equal(0);
    });

    it("should encode (1, 0) as 1_000_000", () => {
      expect(encode(1, 0)).to.equal(1_000_000);
    });

    it("should encode (0, 5) as 5", () => {
      expect(encode(0, 5)).to.equal(5);
    });

    it("should encode (2, 10) as 2_000_010", () => {
      expect(encode(2, 10)).to.equal(2_000_010);
    });

    it("property: encode() preserves lexicographic ordering", () => {
      fc.assert(
        fc.property(fc.nat(100000), fc.nat(999999), fc.nat(100000), fc.nat(999999), (line1, char1, line2, char2) => {
          // Compare (line1, char1) with (line2, char2) lexicographically
          const cmp1 = line1 < line2 || (line1 === line2 && char1 < char2);
          const cmp2 = encode(line1, char1) < encode(line2, char2);

          // If (line1, char1) < (line2, char2), then encode(line1, char1) < encode(line2, char2)
          if (cmp1) {
            return cmp2 === true;
          }
          // If (line1, char1) > (line2, char2), then encode(line1, char1) > encode(line2, char2)
          const cmp3 = line1 > line2 || (line1 === line2 && char1 > char2);
          if (cmp3) {
            return encode(line1, char1) > encode(line2, char2);
          }
          // If equal, encoded values should be equal
          return encode(line1, char1) === encode(line2, char2);
        }),
        { numRuns: 1000 }
      );
    });
  });

  describe("binarySearchFloor()", () => {
    it("should return -1 for empty array", () => {
      expect(binarySearchFloor([], 10)).to.equal(-1);
    });

    it("should return -1 when target is less than all positions", () => {
      const snapshots = [{ pos: 10 }, { pos: 20 }, { pos: 30 }];
      expect(binarySearchFloor(snapshots, 5)).to.equal(-1);
    });

    it("should return 0 when target equals first position", () => {
      const snapshots = [{ pos: 10 }, { pos: 20 }, { pos: 30 }];
      expect(binarySearchFloor(snapshots, 10)).to.equal(0);
    });

    it("should return last index when target is greater than all positions", () => {
      const snapshots = [{ pos: 10 }, { pos: 20 }, { pos: 30 }];
      expect(binarySearchFloor(snapshots, 100)).to.equal(2);
    });

    it("should return correct index for intermediate target", () => {
      const snapshots = [{ pos: 10 }, { pos: 20 }, { pos: 30 }];
      expect(binarySearchFloor(snapshots, 25)).to.equal(1);
    });

    it("should return correct index for exact match", () => {
      const snapshots = [{ pos: 10 }, { pos: 20 }, { pos: 30 }];
      expect(binarySearchFloor(snapshots, 20)).to.equal(1);
    });

    it("property: binarySearchFloor returns the largest index where pos <= target", () => {
      fc.assert(
        fc.property(
          // Generate sorted array of positions
          fc.array(fc.nat(1000000), { minLength: 1, maxLength: 50 }).map((arr) => [...new Set(arr)].sort((a, b) => a - b)),
          fc.nat(1000000),
          (positions, target) => {
            const snapshots = positions.map((p) => ({ pos: p }));
            const result = binarySearchFloor(snapshots, target);

            if (result === -1) {
              // All positions should be greater than target
              return positions.every((p) => p > target);
            } else {
              // snapshots[result].pos <= target
              if (snapshots[result].pos > target) return false;
              // If there's a next element, it should be > target
              if (result + 1 < snapshots.length) {
                return snapshots[result + 1].pos > target;
              }
              return true;
            }
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  // ============================================================================
  // Phase 2: Interpreter Tests
  // ============================================================================

  describe("ContextInterpreter.interpret()", () => {
    it("should create snapshots for M:, K: directives", () => {
      const input = "X:1\nM:4/4\nK:G\n|C D E F|";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const interpreter = new ContextInterpreter();
      const result = interpreter.interpret(ast, semanticData, ctx);

      expect(result.length).to.be.greaterThan(0);

      // Check that we have a snapshot with the key signature
      const lastSnapshot = result[result.length - 1].snapshot;
      expect(lastSnapshot.key.root).to.equal("G");
    });

    it("should increment measureNumber on barlines", () => {
      const input = "X:1\nM:4/4\nK:C\n|C D E F|G A B c|d e f g|";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const interpreter = new ContextInterpreter();
      interpreter.interpret(ast, semanticData, ctx);

      // We have 4 barlines (including leading barline), so measureNumber should be 5 (1 + 4)
      expect(interpreter.state.measureNumber).to.equal(5);
    });

    it("should track meter change via inline field", () => {
      const input = "X:1\nM:4/4\nK:C\n|C D [M:3/4] E F|";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Should have snapshots for: initial body snapshot (with M:4/4, K:C) + [M:3/4] inline field
      // Header directives (M:4/4, K:C) are accumulated into one initial snapshot at body start
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Should have 1 snapshot: initial body snapshot (with M:4/4, Q:120, K:C accumulated)
      // Header directives don't create individual snapshots; they're captured at body start
      expect(result.length).to.equal(1);

      // Check that the initial body snapshot has the accumulated tempo
      const snapshot = result[0].snapshot;
      expect(snapshot.tempo).to.not.be.undefined;
      expect(snapshot.tempo.bpm).to.equal(120);
    });

    it("property: measureNumber equals barline count + 1", () => {
      const genNote = fc.constantFrom("C", "D", "E", "F", "G", "A", "B");

      const genTuneBodyWithBarlines = fc
        .tuple(fc.array(genNote, { minLength: 1, maxLength: 20 }), fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 0, maxLength: 10 }))
        .map(([notes, barlinePositions]) => {
          // Deduplicate and sort positions, then clamp to valid range
          const uniquePositions = [...new Set(barlinePositions)].map((p) => Math.min(p, notes.length)).sort((a, b) => b - a); // Sort descending to insert from right to left

          const elements: string[] = [...notes];
          for (const pos of uniquePositions) {
            elements.splice(pos, 0, "|");
          }

          return {
            tuneString: `X:1\nM:4/4\nK:C\n${elements.join(" ")}\n`,
            expectedMeasureNumber: uniquePositions.length + 1,
          };
        });

      fc.assert(
        fc.property(genTuneBodyWithBarlines, ({ tuneString, expectedMeasureNumber }) => {
          const { ast, semanticData, ctx } = parseWithSemantics(tuneString);
          const interpreter = new ContextInterpreter();
          interpreter.interpret(ast, semanticData, ctx);
          return interpreter.state.measureNumber === expectedMeasureNumber;
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
            expectedKeyRoot: key.replace("m", ""), // "Am" -> "A"
          };
        });

      fc.assert(
        fc.property(genTuneWithDirectives, ({ tuneString, expectedMeterNum, expectedMeterDenom, expectedKeyRoot }) => {
          const { ast, semanticData, ctx } = parseWithSemantics(tuneString);
          const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

          // Should have exactly 1 snapshot (initial body snapshot)
          if (result.length !== 1) return false;

          const snapshot = result[0].snapshot;

          // Verify header context was captured
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
  // Phase 3: Query Function Tests
  // ============================================================================

  describe("getSnapshotAtPosition()", () => {
    it("should return snapshot for position after all snapshots", () => {
      const input = "X:1\nM:4/4\nK:C\n|C D E F|";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

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
    it("applies the header K: to the voices declared before it", () => {
      const input = "X:1\nV:1\nV:2\nM:6/8\nK:D\n[V:1] F|\n[V:2] F|\n";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Find snapshots for each voice by filtering
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Query at a position after V:2 (line 6, 0-indexed)
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Verify snapshots exist for both tunes
      expect(result.length).to.be.greaterThan(1);

      // Verify position ordering
      for (let i = 1; i < result.length; i++) {
        expect(result[i].pos).to.be.greaterThan(result[i - 1].pos);
      }

      // Verify we have snapshots from both keys
      const keys = result.map((s) => s.snapshot.key.root);
      expect(keys).to.include("C");
      expect(keys).to.include("G");
    });

    it("should return snapshots from multiple tunes when range spans them", () => {
      const input = "X:1\nK:C\nCDE|\n\nX:2\nK:G\nGAB|";
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const snapshots = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Query a range spanning the entire document
      const range = { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } };
      const rangeSnapshots = getRangeSnapshots(snapshots, range);

      // Verify snapshots from both tunes are present
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Should have at least 2 snapshots (one per tune body start)
      expect(result.length).to.be.greaterThanOrEqual(2);

      // Verify both meters are present
      const meters = result.map((s) => s.snapshot.meter.value?.[0]?.numerator);
      expect(meters).to.include(4); // 4/4 from tune 1
      expect(meters).to.include(3); // 3/4 from tune 2
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Should have entries for initial + V:1/K:G + V:2/K:D
      expect(result.length).to.be.greaterThanOrEqual(3);

      // Should be sorted by position
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
      const { ast, semanticData, ctx } = parseWithSemantics(input);
      const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

      // Should have exactly 1 snapshot: initial body snapshot capturing M: and K: context
      // Header directives don't create individual snapshots; they're accumulated into body start
      expect(result.length).to.equal(1);

      // Verify it captured the header context
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
          const { ast, semanticData, ctx } = parseWithSemantics(tuneString);
          const result = new ContextInterpreter().interpret(ast, semanticData, ctx);

          // Verify monotonically increasing positions
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
