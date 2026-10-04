import { assert } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { scanGrid } from "./gridScanner";
import * as Gen from "./gridScanner.pbt.generators";
import { GridToken, GridTT, tokensToGridText } from "./gridTokens";

/**
 * Property-based tests for the iReal Pro grid scanner.
 *
 * Because the previous implementation lost musical content by discarding
 * anything it could not classify, total coverage is the central property
 * here: concatenating the lexemes of the token stream must reproduce the
 * input exactly, for any input at all.
 */
describe("iReal Pro grid scanner - Property-Based Tests", () => {
  function scan(source: string): GridToken[] {
    return scanGrid(source, new ABCContext(new AbcErrorReporter()));
  }

  describe("total coverage", () => {
    it("reproduces any generated grid from its token lexemes", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          assert.strictEqual(tokensToGridText(scan(grid.text)), grid.text);
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("reproduces any printable ASCII string from its token lexemes", () => {
      fc.assert(
        fc.property(Gen.genPrintableAscii, (source) => {
          assert.strictEqual(tokensToGridText(scan(source)), source);
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("emits no token with an empty lexeme, so no token is a hole in the coverage", () => {
      fc.assert(
        fc.property(Gen.genPrintableAscii, (source) => {
          assert.isTrue(scan(source).every((t) => t.lexeme.length > 0));
          return true;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("position integrity", () => {
    it("gives each token a position one lexeme past the previous token", () => {
      fc.assert(
        fc.property(Gen.genPrintableAscii, (source) => {
          const tokens = scan(source);
          let expected = 0;
          for (const token of tokens) {
            assert.strictEqual(token.position, expected);
            expected += token.lexeme.length;
          }
          assert.strictEqual(expected, source.length);
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("gives strictly increasing positions", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          const positions = scan(grid.text).map((t) => t.position);
          for (let i = 1; i < positions.length; i++) {
            assert.isAbove(positions[i], positions[i - 1]);
          }
          return true;
        }),
        { numRuns: 300 }
      );
    });
  });

  describe("termination and total function", () => {
    it("returns without throwing for any printable ASCII string", () => {
      fc.assert(
        fc.property(Gen.genPrintableAscii, (source) => {
          scan(source);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it("returns without throwing for any unicode string", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 200 }), (source) => {
          const tokens = scan(source);
          assert.strictEqual(tokensToGridText(tokens), source);
          return true;
        }),
        { numRuns: 300 }
      );
    });
  });

  describe("grammar closure", () => {
    it("produces no unknown token for a grid built from the known grammar", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          const unknown = scan(grid.text).filter((t) => t.type === GridTT.UNKNOWN);
          assert.deepStrictEqual(
            unknown.map((t) => t.lexeme),
            []
          );
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("produces no unknown token for a chart-shaped grid", () => {
      fc.assert(
        fc.property(Gen.genChartLikeGrid, (grid) => {
          assert.isTrue(scan(grid.text).every((t) => t.type !== GridTT.UNKNOWN));
          return true;
        }),
        { numRuns: 300 }
      );
    });

    it("reports nothing through the error reporter for a grid built from the known grammar", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          const ctx = new ABCContext(new AbcErrorReporter());
          scanGrid(grid.text, ctx);
          assert.isFalse(ctx.errorReporter.hasErrors());
          return true;
        }),
        { numRuns: 300 }
      );
    });
  });

  describe("expectation match", () => {
    it("scans a generated grid to the token types it was built from", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          assert.deepStrictEqual(
            scan(grid.text).map((t) => t.type),
            grid.expectedTypes,
            `scanning ${JSON.stringify(grid.text)}`
          );
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("scans a chart-shaped grid to the token types it was built from", () => {
      fc.assert(
        fc.property(Gen.genChartLikeGrid, (grid) => {
          assert.deepStrictEqual(
            scan(grid.text).map((t) => t.type),
            grid.expectedTypes,
            `scanning ${JSON.stringify(grid.text)}`
          );
          return true;
        }),
        { numRuns: 300 }
      );
    });
  });

  describe("stability", () => {
    it("yields an identical stream when the stream is rendered back to text and scanned again", () => {
      fc.assert(
        fc.property(Gen.genPrintableAscii, (source) => {
          const first = scan(source);
          const second = scan(tokensToGridText(first));
          assert.deepStrictEqual(second, first);
          return true;
        }),
        { numRuns: 400 }
      );
    });

    it("is stable for generated grids too", () => {
      fc.assert(
        fc.property(Gen.genGrid, (grid) => {
          const first = scan(grid.text);
          assert.deepStrictEqual(scan(tokensToGridText(first)), first);
          return true;
        }),
        { numRuns: 300 }
      );
    });
  });
});
