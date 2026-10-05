import { expect } from "chai";
import { ChordQuality } from "../music-theory/types";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { IrealChart } from "./gridAst";
import { parseGrid } from "./gridParser";
import { scanGrid } from "./gridScanner";
import { writeGrid } from "./gridWriter";

/**
 * Example-based tests for `gridWriter.ts`, one per rule in
 * `plans/4.abcx-to-ireal-export.md` section 6.
 *
 * Every fixture here is raw grid text in iReal Pro's own chord dialect:
 * minor seventh is `D-7`, major seventh is `C^7`, half-diminished is `Ch7`.
 * Writing a fixture in ABC's dialect instead makes correct code look
 * broken, which has cost this work real time repeatedly. Note that
 * `abcxToIrealChart.spec.ts` uses the opposite dialect, since its input is
 * ABC's.
 */

function parse(grid: string): { chart: IrealChart; errors: string[] } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const chart = parseGrid(scanGrid(grid, ctx), ctx);
  return { chart, errors: ctx.errorReporter.getErrors().map((e) => e.message) };
}

function write(chart: IrealChart): { text: string; errors: string[] } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const text = writeGrid(chart, ctx);
  return { text, errors: ctx.errorReporter.getErrors().map((e) => e.message) };
}

/** Writes the tree a grid text parses to, which is what every case below checks. */
function roundTrip(grid: string): string {
  return write(parse(grid).chart).text;
}

/**
 * The tree as a canonical string, for comparing two of them.
 *
 * Keys are sorted, because two trees holding the same facts may order
 * their properties differently depending on the order the parser assigned
 * them; a plain stringify reports that as a difference and it is not one.
 * `position` is a source offset into text the writer does not reproduce,
 * and `unclosed` is a diagnostic the writer normalises away by closing the
 * repeat.
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

describe("iReal grid writer", () => {
  describe("sections", () => {
    it("writes a plain section in brackets", () => {
      expect(roundTrip("C^7 |D-7 ")).to.equal("[C^7 |D-7 ]Z");
    });

    it("writes a repeated section in braces", () => {
      expect(roundTrip("{C^7 |D-7 }")).to.equal("{C^7 |D-7 }Z");
    });

    it("writes a section label after the opening delimiter", () => {
      expect(roundTrip("[*AC^7 ")).to.equal("[*AC^7 ]Z");
    });

    it("writes a time signature after the label", () => {
      expect(roundTrip("[*AT44C^7 ")).to.equal("[*AT44C^7 ]Z");
    });

    it("writes twelve eight as the one code whose digits are not a fraction", () => {
      expect(roundTrip("[T12C^7 ")).to.equal("[T12C^7 ]Z");
    });

    it("reports a time signature iReal Pro cannot spell", () => {
      const chart = parse("C^7 ").chart;
      chart.sections[0].timeSignature = { numerator: 13, denominator: 16 };
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/no iReal Pro spelling/);
      expect(text).to.equal("[C^7 ]Z");
    });

    it("ends the chart with Z", () => {
      expect(roundTrip("C^7 ").endsWith("Z")).to.equal(true);
    });
  });

  describe("cells", () => {
    it("writes a chord in iReal Pro's own dialect", () => {
      expect(roundTrip("C^7 |D-7 |Eh7 |F#o7 |G7alt ")).to.equal("[C^7 |D-7 |Eh7 |F#o7 |G7alt ]Z");
    });

    it("writes several cells in one bar separated by a space", () => {
      expect(roundTrip("C^7 D-7 |G7 ")).to.equal("[C^7 D-7 |G7 ]Z");
    });

    it("writes a no-chord cell as n", () => {
      expect(roundTrip("n |C^7 ")).to.equal("[n |C^7 ]Z");
    });

    it("writes a slash bass", () => {
      expect(roundTrip("C^7/G ")).to.equal("[C^7/G ]Z");
    });

    it("writes an alternative chord in parentheses after its cell", () => {
      expect(roundTrip("C^7 (A-7)|D-7 ")).to.equal("[C^7(A-7) |D-7 ]Z");
    });

    it("writes the cue-size marker before the cell it applies to", () => {
      expect(roundTrip("sC^7 ")).to.equal("[sC^7 ]Z");
    });

    it("writes a fermata at the head of its bar", () => {
      // It belongs to the bar rather than to a cell and occupies none, so
      // it sits flush against the first cell: a space there would be an
      // empty cell and would move the chord off the first beat.
      expect(roundTrip("fC^7 |D-7 ")).to.equal("[fC^7 |D-7 ]Z");
    });

    it("resolves a held chord rather than writing the back reference again", () => {
      // The tree has already resolved `x`, so the writer has a chord to
      // write and no reason to write a reference to one.
      expect(roundTrip("C^7 |x ")).to.equal("[C^7 |C^7 ]Z");
    });

    it("keeps a back reference the parser could not resolve", () => {
      // Nothing preceded it, so there is no chord to write in its place.
      expect(roundTrip("W/C |D-7 ")).to.equal("[W/C |D-7 ]Z");
    });
  });

  describe("repeats and endings", () => {
    it("writes each ending with its own number", () => {
      expect(roundTrip("{C^7 |N1D-7 }N2G7 ")).to.equal("{C^7 N1D-7 N2G7 }Z");
    });

    it("writes a section whose bars all live in its endings", () => {
      expect(roundTrip("[*BN1C^7 }N2D-7 ")).to.equal("{*BN1C^7 N2D-7 }Z");
    });

    it("closes a repeat the chart left open", () => {
      const { chart } = parse("{C^7 |D-7 ");
      expect(chart.sections[0].repeat?.unclosed).to.equal(true);
      expect(write(chart).text).to.equal("{C^7 |D-7 }Z");
    });
  });

  describe("annotations and navigation", () => {
    it("writes a bar's annotation inside that bar", () => {
      expect(roundTrip("C^7 <Solos>|D-7 ")).to.equal("[<Solos>C^7 |D-7 ]Z");
    });

    it("writes a chart-level annotation after every section", () => {
      const { chart } = parse("C^7 ");
      chart.annotations.push({ text: "Fine", position: 0 });
      expect(write(chart).text).to.equal("[C^7 ]<Fine>Z");
    });

    it("writes a segno and a coda at the section each one names", () => {
      expect(roundTrip("[*AC^7 ][*BS D-7 ")).to.equal("[*AC^7 ][S*B D-7 ]Z");
    });

    it("writes a marker standing after the last section", () => {
      // One chart in the sample library records a part marker against the
      // index one past the end, which had nowhere to go before.
      const { chart } = parse("C^7 ");
      chart.navigation.partMarkerSections = [1];
      expect(write(chart).text).to.equal("[C^7 ]UZ");
    });
  });

  describe("what the language cannot say, and the writer reports", () => {
    // Most of these cannot arise from a tree the parser built, and can
    // arise from one assembled by hand or read out of ABCx, which is what
    // phase B will do. A writer that degraded silently would leave a
    // consumer unable to tell a chart it could not express from one it
    // expressed wrongly.

    it("escapes an annotation whose text begins with a size code", () => {
      // The parser strips one leading size code, so text that begins with
      // one is written behind a second code for it to strip.
      const { chart } = parse("C^7 ");
      chart.sections[0].bars[0].annotations.push({ text: "*64Hey", position: 0 });
      const text = write(chart).text;
      expect(text).to.equal("[<*00*64Hey>C^7 ]Z");
      expect(parse(text).chart.sections[0].bars[0].annotations[0].text).to.equal("*64Hey");
    });

    it("reports an annotation holding a delimiter, and removes it", () => {
      const { chart } = parse("C^7 ");
      chart.sections[0].bars[0].annotations.push({ text: "a > b | c", position: 0 });
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/cannot hold/);
      expect(text).to.equal("[<a  b  c>C^7 ]Z");
    });

    it("reports a section label of more than one character", () => {
      const { chart } = parse("C^7 ");
      chart.sections[0].label = "Intro";
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/one word character/);
      expect(text).to.equal("[*IC^7 ]Z");
    });

    it("reports a time signature whose code already means something else", () => {
      const { chart } = parse("C^7 ");
      chart.sections[0].timeSignature = { numerator: 1, denominator: 2 };
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/T12 already spells/);
      expect(text).to.equal("[C^7 ]Z");
    });

    it("reports a back reference that would bind to the wrong chord", () => {
      // The tree's own order can put a section holding an unresolved
      // reference after one holding chords, which the text cannot express.
      const { chart } = parse("C^7 ");
      chart.sections.push({
        bars: [{ cells: [{ kind: "sameChord", small: false, slot: 0 }], annotations: [], fermata: false, cellCount: 1 }],
      });
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/now follows one/);
      expect(text).to.equal("[C^7 ][n]Z");
    });

    it("reports a chord whose text would read back as a different chord", () => {
      // A flattened fifth with no extension writes "Ab5", which reads as
      // an A flat power chord.
      const { chart } = parse("C^7 ");
      chart.sections[0].bars[0].cells[0].chord = {
        root: KeyRoot.A,
        rootAccidental: KeyAccidental.None,
        quality: ChordQuality.Dominant,
        qualityExplicit: false,
        extension: null,
        alterations: [{ type: "flat", degree: 5 }],
        bass: null,
      };
      expect(write(chart).errors.join()).to.match(/does not read back as itself/);
    });

    it("reports a back reference over a bass that carries no bass", () => {
      const { chart } = parse("C^7 ");
      chart.sections[0].bars[0].cells = [{ kind: "sameChordWithBass", small: false, slot: 0 }];
      const { text, errors } = write(chart);
      expect(errors.join()).to.match(/carries no bass/);
      expect(text).to.equal("[p ]Z");
    });

    it("reports a repeat with numbered endings that holds none", () => {
      const { chart } = parse("C^7 ");
      chart.sections[0].repeat = { kind: "endings", endings: [] };
      expect(write(chart).errors.join()).to.match(/holds none/);
    });

    it("reports a navigation marker naming a section the chart does not have", () => {
      const { chart } = parse("C^7 ");
      chart.navigation.segnoSectionIndex = 5;
      expect(write(chart).errors.join()).to.match(/does not have/);
    });
  });

  describe("the fixpoint the writer exists to satisfy", () => {
    // Parsing what the writer writes must reproduce the tree it was given.
    // This is the property checked over the whole sample library and over
    // generated trees; these are the shapes worth naming individually.
    const cases: Array<[string, string]> = [
      ["a flat grid", "C^7 |D-7 |G7 |C^7 "],
      ["a repeated section", "{C^7 |D-7 }"],
      ["numbered endings", "{C^7 |N1D-7 }N2G7 "],
      ["three endings", "{C^7 |N1D-7 }N2E-7 }N3F^7 "],
      ["a labelled section with a time signature", "[*AT34C^7 |D-7 "],
      ["two sections", "[*AC^7 ][*BD-7 "],
      ["an annotation and a fermata", "fC^7 <Solos>|D-7 "],
      ["an alternative chord and a cue-sized chord", "C^7 (A-7)|sD-7 "],
      ["a no-chord cell", "n |C^7 "],
      ["a segno and a coda", "[*AC^7 ][*BS D-7 ][*CQ E-7 "],
      ["an unresolved back reference", "W/C |D-7 "],
      ["an endings-only section", "[*BN1C^7 }N2D-7 "],
    ];

    for (const [name, grid] of cases) {
      it(`holds for ${name}`, () => {
        const original = parse(grid);
        const text = write(original.chart).text;
        const reparsed = parse(text);
        // The reparse may report what the first parse reported, an
        // unresolvable back reference among them, but must not report
        // anything new: that would mean the writer wrote something worse
        // than it was given.
        expect(reparsed.errors, `reparsing ${JSON.stringify(text)} reported`).to.deep.equal(original.errors);
        expect(shape(reparsed.chart), `wrote ${JSON.stringify(text)}`).to.equal(shape(original.chart));
      });
    }
  });
});
