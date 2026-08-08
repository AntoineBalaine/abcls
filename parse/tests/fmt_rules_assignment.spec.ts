import { assert } from "chai";
import { isNote } from "../helpers";
import { ABCContext } from "../parsers/Context";
import { ParseCtx, parseTune } from "../parsers/parse";
import { Scanner, TT } from "../parsers/scan";
import { BarLine, Beam, Decoration, Grace_group, MultiMeasureRest, YSPACER } from "../types/Expr";
import { assignTuneBodyRules, expandMultiMeasureRests, preprocessTune, SpcRul } from "../Visitors/fmt/fmt_rules_assignment";
import { isBarLine, isToken } from "../Visitors/fmt/fmt_timeMapHelpers";

function buildTune(input: string, ctx: ABCContext) {
  const tokens = Scanner(input, ctx);
  const parseCtx = new ParseCtx(tokens, ctx);
  return parseTune(parseCtx);
}

describe("Rules Assignment (fmt2)", () => {
  let ctx: ABCContext;

  beforeEach(() => {
    ctx = new ABCContext();
  });

  describe("assignTuneBodyRules", () => {
    it("assigns PRECEDE_SPC to notes and barlines in single voice", () => {
      let tune = buildTune(`X:1\n.C D E|F G A|`, ctx);
      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      tune.tune_body!.sequence[0].forEach((node) => {
        if (isNote(node) || isBarLine(node)) {
          const rules = ruleMap.get(node);
          assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
        }
      });
    });

    it("handles multi-measure rests in multi-voice context", () => {
      let tune = buildTune(
        `X:1
V:RH clef=treble
V:LH clef=bass
V:RH
Z4|
V:LH
CDEF|GABC|CDEF|GABC|
            `,
        ctx
      );

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      // Find expanded multi-measure rest
      const firstSystem = tune.tune_body!.sequence[0];
      const rests = firstSystem.filter((node): node is MultiMeasureRest => node instanceof MultiMeasureRest);

      assert.isAbove(rests.length, 1, "Multi-measure rest should be expanded");
      rests.forEach((rest) => {
        const rules = ruleMap.get(rest);
        assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
      });
    });

    it("assigns NO_SPC to slurs (parentheses)", () => {
      let tune = buildTune(`X:1\n(3ABC)|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      tune.tune_body!.sequence[0].forEach((node) => {
        if (isToken(node) && node.type === TT.SLUR) {
          const rules = ruleMap.get(node);
          assert.isTrue(rules !== undefined && rules === SpcRul.NO_SPC);
        }
      });
    });

    it("assigns PRECEDE_SPC to decorations", () => {
      let tune = buildTune(`X:1\n!p!C D E|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      tune.tune_body!.sequence[0].forEach((node) => {
        if (node instanceof Decoration) {
          const rules = ruleMap.get(node);
          assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
        }
      });
    });

    it("handles beamed notes", () => {
      let tune = buildTune(`X:1\nC CDEF GABC|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      tune.tune_body!.sequence[0].forEach((node) => {
        if (node instanceof Beam) {
          const rules = ruleMap.get(node);
          assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
        }
      });
    });

    it("assigns PRECEDE_SPC to a standalone y-spacer", () => {
      let tune = buildTune(`X:1\nA |y|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      const ySpacers = tune.tune_body!.sequence[0].filter((node): node is YSPACER => node instanceof YSPACER);
      assert.isAbove(ySpacers.length, 0, "Expected to find a y-spacer node");
      ySpacers.forEach((node) => {
        const rules = ruleMap.get(node);
        assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
      });
    });

    it("does not govern a y-spacer glued inside a beam (beam joining stays untouched)", () => {
      let tune = buildTune(`X:1\nAy2B|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      const beam = tune.tune_body!.sequence[0].find((node): node is Beam => node instanceof Beam);
      assert.ok(beam, "Expected the glued A/y2/B run to parse as a single beam");
      const ySpacer = beam!.contents.find((node): node is YSPACER => node instanceof YSPACER);
      assert.ok(ySpacer, "Expected the beam to contain a y-spacer");
      assert.isFalse(ruleMap.has(ySpacer!), "Beam-internal nodes are never visited by the top-level rule map");
    });

    it("handles grace notes", () => {
      let tune = buildTune(`X:1\nC {ag}f2|`, ctx);

      tune = preprocessTune(tune, ctx);
      const ruleMap = assignTuneBodyRules(tune);

      tune.tune_body!.sequence[0].forEach((node) => {
        if (node instanceof Grace_group) {
          const rules = ruleMap.get(node);
          assert.isTrue(!!rules && rules === SpcRul.PRECEDE_SPC);
        }
      });
    });
  });
});

describe("expandMultiMeasureRests (fmt2)", () => {
  let ctx: ABCContext;

  beforeEach(() => {
    ctx = new ABCContext();
  });

  it("expands Z4 into four single-measure rests", () => {
    const input = "X:1\nZ4|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    // Should be: Z|Z|Z|Z|
    const rests = expanded.filter((node) => node instanceof MultiMeasureRest);
    const barlines = expanded.filter((node) => isBarLine(node));

    assert.equal(rests.length, 4, "Should have 4 rests");
    assert.equal(barlines.length, 4, "Should have 4 barlines");
  });

  it("expands X4 into four invisible rests", () => {
    const input = "X:1\nX4|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    // Should be: X|X|X|X|
    const rests = expanded.filter((node): node is MultiMeasureRest => node instanceof MultiMeasureRest);
    assert.equal(rests.length, 4, "Should have 4 rests");

    // Verify all rests are invisible (X)
    rests.forEach((rest) => {
      assert.equal(rest.rest.lexeme, "X", "Rest should be invisible");
    });
  });

  it("does not expand single measure rests", () => {
    const input = "X:1\nZ|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    assert.deepEqual(expanded, system, "Single measure rest should not be expanded");
  });

  it("preserves other nodes while expanding rests", () => {
    const input = "X:1\nCDE Z3 FGA|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    // Find all non-rest, non-barline nodes
    const otherNodes = expanded.filter((node) => !(node instanceof MultiMeasureRest) && !(node instanceof BarLine));

    // Original nodes should be preserved
    assert.isTrue(otherNodes.length >= 2, "Original nodes should be preserved");
  });

  it("handles multiple multi-measure rests", () => {
    const input = "X:1\nZ2 Z2|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    // Should be: Z|Z Z|Z|
    const rests = expanded.filter((node) => node instanceof MultiMeasureRest);
    const barlines = expanded.filter((node) => isBarLine(node));

    assert.equal(rests.length, 4, "Should have 4 total rests");
    assert.equal(barlines.length, 3, "Should have 3 barlines");
  });

  it("does not modify system without multi-measure rests", () => {
    const input = "X:1\nCDEF|GABG|";
    const tune = buildTune(input, ctx);
    const system = tune.tune_body!.sequence[0];
    const expanded = expandMultiMeasureRests(system, ctx);

    assert.deepEqual(expanded, system, "System without rests should not be modified");
  });
});
