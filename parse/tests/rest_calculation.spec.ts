/**
 * Rest Duration Calculation Unit Tests (ABCx-specific)
 *
 * Tests for the rest duration calculation logic in the ABCx to ABC converter.
 * Verifies correct rest lengths for various meter/note-length combinations.
 *
 * Note: These tests are specific to ABCx conversion. The rest calculation
 * determines how chord symbols are converted to invisible rests that fill
 * the bar duration evenly based on the number of chords per bar.
 */

import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { parseAbcx } from "../parsers/parse_abcx";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { Rest, Tune } from "../types/Expr";
import { AbcxToAbcConverter } from "../Visitors/AbcxToAbcConverter";
import { createRational } from "../Visitors/fmt/rational";

describe("Rest Duration Calculation", () => {
  /**
   * Helper to get rests from converted ABCx
   */
  function getRests(source: string): Rest[] {
    const ctx = new ABCContext();
    const tokens = ScannerAbcx(source, ctx);
    const ast = parseAbcx(tokens, ctx);
    const converter = new AbcxToAbcConverter(ctx);
    const abcAst = converter.convert(ast);

    const tune = abcAst.contents[0] as Tune;
    const rests: Rest[] = [];
    tune.tune_body?.sequence.forEach((system) => {
      system.forEach((elem) => {
        if (elem instanceof Rest) {
          rests.push(elem);
        }
      });
    });
    return rests;
  }

  /**
   * Helper to get rest length as string (e.g., "4", "8", "3/4")
   */
  function getRestLength(rest: Rest): string {
    if (!rest.rhythm) return "1";
    if (rest.rhythm.separator && rest.rhythm.denominator) {
      return `${rest.rhythm.numerator?.lexeme}/${rest.rhythm.denominator.lexeme}`;
    }
    return rest.rhythm.numerator?.lexeme || "1";
  }

  describe("4/4 Time with L:1/8", () => {
    it("single chord per bar should get bare X (full bar rest), not X8", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X"); // Full bar rest
      // Bare X, no duration suffix: a trailing number on X means "this
      // many whole measures" (multi-measure rest), not "a rest lasting
      // this many note-lengths" — X8 would wrongly mean 8 whole measures.
      expect(rests[0].rhythm).to.be.undefined;
    });

    it("two chords per bar should get x4 each", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C G |`;
      const rests = getRests(source);

      expect(rests).to.have.length(2);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("4");
      });
    });

    it("four chords per bar should get x2 each", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C G Am F |`;
      const rests = getRests(source);

      expect(rests).to.have.length(4);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("2");
      });
    });

    it("eight chords per bar should get x each (length 1)", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C D E F G A B C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(8);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        // Length 1 means no rhythm attached
        expect(rest.rhythm).to.be.undefined;
      });
    });
  });

  describe("4/4 Time with L:1/4", () => {
    it("single chord per bar should get bare X, not X4", () => {
      const source = `X:1
M:4/4
L:1/4
K:C
C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });

    it("two chords per bar should get x2 each", () => {
      const source = `X:1
M:4/4
L:1/4
K:C
C G |`;
      const rests = getRests(source);

      expect(rests).to.have.length(2);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("2");
      });
    });

    it("four chords per bar should get x each (length 1)", () => {
      const source = `X:1
M:4/4
L:1/4
K:C
C G Am F |`;
      const rests = getRests(source);

      expect(rests).to.have.length(4);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(rest.rhythm).to.be.undefined; // Length 1
      });
    });
  });

  describe("3/4 Time with L:1/4", () => {
    it("single chord per bar should get bare X, not X3", () => {
      const source = `X:1
M:3/4
L:1/4
K:C
C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });

    it("three chords per bar should get x each (length 1)", () => {
      const source = `X:1
M:3/4
L:1/4
K:C
C G Am |`;
      const rests = getRests(source);

      expect(rests).to.have.length(3);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(rest.rhythm).to.be.undefined;
      });
    });
  });

  describe("6/8 Time with L:1/8", () => {
    it("single chord per bar should get bare X, not X6", () => {
      const source = `X:1
M:6/8
L:1/8
K:C
C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });

    it("two chords per bar should get x3 each", () => {
      const source = `X:1
M:6/8
L:1/8
K:C
C G |`;
      const rests = getRests(source);

      expect(rests).to.have.length(2);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("3");
      });
    });

    it("three chords per bar should get x2 each", () => {
      const source = `X:1
M:6/8
L:1/8
K:C
C G Am |`;
      const rests = getRests(source);

      expect(rests).to.have.length(3);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("2");
      });
    });
  });

  describe("2/4 Time with L:1/8", () => {
    it("single chord per bar should get bare X, not X4", () => {
      const source = `X:1
M:2/4
L:1/8
K:C
C |`;
      const rests = getRests(source);

      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });

    it("two chords per bar should get x2 each", () => {
      const source = `X:1
M:2/4
L:1/8
K:C
C G |`;
      const rests = getRests(source);

      expect(rests).to.have.length(2);
      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
        expect(getRestLength(rest)).to.equal("2");
      });
    });
  });

  describe("Full Bar vs Partial Rest", () => {
    it("should use X (capital) for single chord per bar", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C |`;
      const rests = getRests(source);

      expect(rests[0].rest.lexeme).to.equal("X");
    });

    it("should use x (lowercase) for multiple chords per bar", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C G |`;
      const rests = getRests(source);

      rests.forEach((rest) => {
        expect(rest.rest.lexeme).to.equal("x");
      });
    });
  });

  describe("Multiple Bars", () => {
    it("should calculate independently for each bar", () => {
      const source = `X:1
M:4/4
L:1/8
K:C
C | G Am | F |`;
      const rests = getRests(source);

      // First bar: 1 chord -> bare X, not X8
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;

      // Second bar: 2 chords -> x4 each
      expect(rests[1].rest.lexeme).to.equal("x");
      expect(getRestLength(rests[1])).to.equal("4");
      expect(rests[2].rest.lexeme).to.equal("x");
      expect(getRestLength(rests[2])).to.equal("4");

      // Third bar: 1 chord -> bare X, not X8
      expect(rests[3].rest.lexeme).to.equal("X");
      expect(rests[3].rhythm).to.be.undefined;
    });
  });

  describe("Default Values", () => {
    it("should use default meter 4/4 when not specified", () => {
      const source = `X:1
K:C
C |`;
      const rests = getRests(source);

      // Default: M:4/4, L:1/8 -> single chord gets bare X, not X8
      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });
  });

  describe("Custom Converter Config", () => {
    it("should respect custom default meter", () => {
      const source = `X:1
K:C
C |`;
      const ctx = new ABCContext();
      const tokens = ScannerAbcx(source, ctx);
      const ast = parseAbcx(tokens, ctx);
      const converter = new AbcxToAbcConverter(ctx, {
        defaultMeter: createRational(3, 4),
        defaultNoteLength: createRational(1, 4),
      });
      const abcAst = converter.convert(ast);

      const tune = abcAst.contents[0] as Tune;
      const rests: Rest[] = [];
      tune.tune_body?.sequence.forEach((system) => {
        system.forEach((elem) => {
          if (elem instanceof Rest) rests.push(elem);
        });
      });

      // Custom: M:3/4, L:1/4 -> single chord gets bare X, not X3
      expect(rests).to.have.length(1);
      expect(rests[0].rest.lexeme).to.equal("X");
      expect(rests[0].rhythm).to.be.undefined;
    });
  });
});
