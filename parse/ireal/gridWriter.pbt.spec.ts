import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { Cell, IrealChart } from "./gridAst";
import { parseGrid } from "./gridParser";
import { scanGrid } from "./gridScanner";
import { GridTT } from "./gridTokens";
import { writeGrid } from "./gridWriter";
import { chartArb } from "./gridWriter.pbt.generators";

/**
 * The property `plans/4.abcx-to-ireal-export.md` section 9 states: parsing
 * what the writer writes reproduces the tree it was given.
 *
 * The same property runs over a real 657-chart library in
 * `tools/verifyAgainstLibrary.ts`. Here it runs over generated trees, which
 * is what reaches the shapes a real library happens not to contain.
 */

/** Every cell of a chart, in no particular order. */
function cells(chart: IrealChart): Cell[] {
  const out: Cell[] = [];
  for (const section of chart.sections) {
    for (const bar of section.bars) out.push(...bar.cells);
    for (const ending of section.repeat?.endings ?? []) {
      for (const bar of ending.bars) out.push(...bar.cells);
    }
  }
  return out;
}

/**
 * The tree as a canonical string.
 *
 * Keys are sorted, because two trees holding the same facts may order their
 * properties differently; a plain stringify calls that a difference and it
 * is not one. `position` is an offset into text the writer does not
 * reproduce, and `unclosed` is a diagnostic it normalises away.
 */
function shape(chart: IrealChart): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "position" || key === "unclosed") continue;
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(canonical(chart));
}

describe("iReal grid writer, property-based", () => {
  it("writes a tree that parses back to the same tree", () => {
    fc.assert(
      fc.property(chartArb, (chart) => {
        const writeCtx = new ABCContext(new AbcErrorReporter());
        const text = writeGrid(chart, writeCtx);
        expect(writeCtx.errorReporter.getErrors().map((e) => e.message), `writing ${shape(chart)}`).to.deep.equal([]);

        const readCtx = new ABCContext(new AbcErrorReporter());
        const reparsed = parseGrid(scanGrid(text, readCtx), readCtx);
        // A tree holding an unresolved back reference makes the parser
        // report one, every time, because that is what being unresolved
        // means; any other report would mean the writer wrote something
        // the parser objects to.
        const expectedOnReread = cells(chart).some((cell) => cell.kind === "sameChord" || cell.kind === "sameChordWithBass")
          ? /repeats the previous chord/
          : null;
        for (const message of readCtx.errorReporter.getErrors().map((e) => e.message)) {
          expect(expectedOnReread, `reparsing ${JSON.stringify(text)} reported ${JSON.stringify(message)}`).to.not.equal(null);
          expect(message, `reparsing ${JSON.stringify(text)}`).to.match(expectedOnReread!);
        }
        expect(shape(reparsed), `wrote ${JSON.stringify(text)}`).to.equal(shape(chart));
      }),
      { numRuns: 300 },
    );
  });

  it("writes nothing the scanner does not recognise", () => {
    // A writer that emitted an unknown character would still round-trip if
    // the parser ignored it, so coverage is checked on its own.
    fc.assert(
      fc.property(chartArb, (chart) => {
        const ctx = new ABCContext(new AbcErrorReporter());
        const text = writeGrid(chart, ctx);
        const unknown = scanGrid(text, ctx).filter((token) => token.type === GridTT.UNKNOWN);
        expect(unknown.map((t) => t.lexeme), `wrote ${JSON.stringify(text)}`).to.deep.equal([]);
      }),
      { numRuns: 300 },
    );
  });
});
