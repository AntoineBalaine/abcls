import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parsedChordToIrealText } from "./chordShorthand";
import { Bar, IrealChart } from "./gridAst";
import { chartChords, parseGrid } from "./gridParser";
import { scanGrid } from "./gridScanner";

/**
 * Example-based tests for `gridParser.ts`, one per resolution rule in
 * `plans/2.ireal-grid-lexer-parser.md` section 7 and one per defect in its
 * section 1 that the parser is responsible for.
 *
 * Every fixture here is raw grid text in iReal Pro's own chord dialect,
 * handed straight to `scanGrid`: minor seventh is `D-7`, major seventh is
 * `C^7`, half-diminished is `Ch7`. Writing a fixture in ABC's dialect
 * instead makes correct code look broken, which has cost this work real
 * time three times over, and running a fixture through `scramble.ts`
 * changes it (that module substitutes on `| x`, ` |` and three-space runs),
 * so no fixture goes through it.
 */

function parse(grid: string): { chart: IrealChart; errors: string[] } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const chart = parseGrid(scanGrid(grid, ctx), ctx);
  return { chart, errors: ctx.errorReporter.getErrors().map((e) => e.message) };
}

/** Each bar as the iReal Pro text of the chords it holds, cells joined by a space. */
function barTexts(bars: Bar[]): string[] {
  return bars.map((bar) =>
    bar.cells
      .map((cell) => (cell.chord ? parsedChordToIrealText(cell.chord) : cell.kind))
      .join(" ")
      .trim()
  );
}

describe("iReal grid parser", () => {
  describe("bars and cells", () => {
    it("reads one bar per separator, with the chords of that bar in order", () => {
      const { chart, errors } = parse("C^7 A-7 |D-7 G7 |C^7 ");
      expect(errors).to.deep.equal([]);
      expect(chart.sections).to.have.length(1);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7 A-7", "D-7 G7", "C^7"]);
    });

    it("reads `n` as a cell holding no chord rather than as a chord", () => {
      const { chart } = parse("n |C^7 ");
      expect(chart.sections[0].bars[0].cells[0].kind).to.equal("noChord");
      expect(chart.sections[0].bars[0].cells[0].chord).to.be.undefined;
    });

    it("drops `,` padding, which marks a held chord and means nothing further", () => {
      const { chart } = parse("D-7,   ,|G7 ");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["D-7", "G7"]);
    });

    it("marks the cell after `s` as cue sized, and only that cell", () => {
      const { chart } = parse("sC^7 D-7 |");
      const cells = chart.sections[0].bars[0].cells;
      expect(cells.map((c) => c.small)).to.deep.equal([true, false]);
    });

    it("records a fermata on its bar", () => {
      const { chart } = parse("C^7 |fD-7 |");
      expect(chart.sections[0].bars.map((b) => b.fermata)).to.deep.equal([false, true]);
    });

    it("attaches a `(...)` alternative chord to the cell beside it", () => {
      const { chart } = parse("D-(D7) |");
      const cell = chart.sections[0].bars[0].cells[0];
      expect(parsedChordToIrealText(cell.chord!)).to.equal("D-");
      expect(parsedChordToIrealText(cell.alternative!)).to.equal("D7");
    });

    it("keeps an annotation on its bar, without its delimiters or its size code", () => {
      const { chart } = parse("<*64Open Feel>C^7 |<Solos>D-7 |");
      expect(chart.sections[0].bars.map((b) => b.annotations.map((a) => a.text))).to.deep.equal([["Open Feel"], ["Solos"]]);
    });
  });

  describe("resolution: a bar that repeats the bar before it", () => {
    it("takes a copy of the preceding bar's cells", () => {
      const { chart, errors } = parse("C^7 A-7 |x |");
      expect(errors).to.deep.equal([]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7 A-7", "C^7 A-7"]);
    });

    it("does not take the preceding bar's annotations or fermata, which belong to the bar that introduced them", () => {
      const { chart } = parse("<Solos>fC^7 |x |");
      const [first, second] = chart.sections[0].bars;
      expect(first.annotations.map((a) => a.text)).to.deep.equal(["Solos"]);
      expect(first.fermata).to.equal(true);
      expect(second.annotations).to.deep.equal([]);
      expect(second.fermata).to.equal(false);
    });

    it("copies rather than shares, so editing one bar's chord cannot change the other's", () => {
      const { chart } = parse("C^7 |x |");
      const bars = chart.sections[0].bars;
      expect(bars[0].cells[0].chord).to.not.equal(bars[1].cells[0].chord);
    });

    it("reports a repeat with no bar before it, and drops the bar rather than throwing", () => {
      const { chart, errors } = parse("x |C^7 |");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("no bar came before it");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7"]);
    });

    it("reports a repeat marker sharing its bar with chords, and keeps the content as a repeat of the previous cell", () => {
      const { chart, errors } = parse("C^7 |D-7 x |");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("shares its bar with chord cells");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7 D-7"]);
    });
  });

  describe("resolution: a bar that repeats the two bars before it", () => {
    it("expands into two bars, copying each of the two in order", () => {
      const { chart, errors } = parse("C^7 |D-7 |r |");
      expect(errors).to.deep.equal([]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7", "C^7", "D-7"]);
    });

    it("reports a two-bar repeat with fewer than two bars before it", () => {
      const { chart, errors } = parse("C^7 |r |");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("fewer than two bars");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7"]);
    });
  });

  describe("resolution: a cell that holds the same chord as the cell before it", () => {
    it("takes the chord of the preceding cell in the same bar", () => {
      const { chart, errors } = parse("D-7 p |");
      expect(errors).to.deep.equal([]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["D-7 D-7"]);
    });

    it("takes the last cell of the preceding bar when it is first in its own bar", () => {
      const { chart } = parse("C^7 D-7 |p G7 |");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7 D-7", "D-7 G7"]);
    });

    it("resolves a doubled `pp`, which real charts write", () => {
      const { chart } = parse("D-7 pp |");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["D-7 D-7 D-7"]);
    });

    it("reports a back reference with no chord named before it", () => {
      const { errors } = parse("p |C^7 |");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("no chord was named before it");
    });
  });

  describe("resolution: a cell that holds the same chord over an explicit bass", () => {
    // The `W` construct, read as the previous cell's chord over the bass
    // that follows it. The evidence is in `gridScanner.ts`'s own rule: the
    // only chart in the sample library that writes `W` ("Ingênuo") writes
    // it three times, each time as the second cell of a bar whose first
    // cell is a minor chord, over the seventh below that chord's root.
    it("takes the previous chord and puts the written bass under it", () => {
      const { chart, errors } = parse("D-,W/C,|C-,W/Bb,|F-,W/Eb,|");
      expect(errors).to.deep.equal([]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["D- D-/C", "C- C-/Bb", "F- F-/Eb"]);
    });

    it("replaces a bass the previous chord carried rather than keeping both", () => {
      const { chart } = parse("D-7/A W/C |");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["D-7/A D-7/C"]);
    });
  });

  describe("resolution: a bar with no cells is not a bar", () => {
    it("drops an empty bar instead of emitting it, which is the empty bar defect", () => {
      const { chart } = parse("C^7 | |D-7 |");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7"]);
    });

    it("carries the label of a bar with no cells onto the next bar that has cells, which is the phantom label bar defect", () => {
      const { chart } = parse("*A |C^7 |D-7 |");
      expect(chart.sections).to.have.length(1);
      expect(chart.sections[0].label).to.equal("A");
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7"]);
    });

    it("gives a section label standing immediately before a repeated section no bar of its own", () => {
      const { chart } = parse("C^7 |*B {D-7 |G7 }");
      expect(chart.sections.map((s) => s.label)).to.deep.equal([undefined, "B"]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7"]);
      expect(barTexts(chart.sections[1].bars)).to.deep.equal(["D-7", "G7"]);
      expect(chart.sections[1].repeat?.kind).to.equal("simple");
    });

    it("carries the annotation of a bar with no cells onto the next bar that has cells", () => {
      const { chart } = parse("<Solos> |C^7 |");
      expect(chart.sections[0].bars).to.have.length(1);
      expect(chart.sections[0].bars[0].annotations.map((a) => a.text)).to.deep.equal(["Solos"]);
    });

    it("keeps an annotation that never finds a bar as a fact about the chart", () => {
      const { chart } = parse("C^7 Z <Fine>");
      expect(chart.annotations.map((a) => a.text)).to.deep.equal(["Fine"]);
    });
  });

  describe("resolution: repeated sections", () => {
    it("stores the bars of a simple repeat once rather than duplicating them", () => {
      const { chart, errors } = parse("{C^7 |D-7 |G7 |C^7 }");
      expect(errors).to.deep.equal([]);
      expect(chart.sections).to.have.length(1);
      expect(chart.sections[0].repeat).to.deep.equal({ kind: "simple" });
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7", "G7", "C^7"]);
    });

    it("reads a bracketed section boundary as closing a repeat the chart opened with a brace", () => {
      // What real charts write, 57 occurrences across the sample library:
      // `{T44F7 | ... |G-7 C7 ]` opens with a brace and closes with a
      // bracket, the two characters being the two repeat barlines iReal
      // Pro draws rather than a matched pair it insists on.
      const { chart, errors } = parse("{T44F7 |Bb7 ]");
      expect(errors).to.deep.equal([]);
      expect(chart.sections[0].repeat).to.deep.equal({ kind: "simple" });
      expect(chart.sections[0].repeat?.unclosed).to.be.undefined;
    });

    it("reads a closing brace with no opening one as repeating the section it ends", () => {
      const { chart, errors } = parse("[C^7 |D-7 }");
      expect(errors).to.deep.equal([]);
      expect(chart.sections[0].repeat?.kind).to.equal("simple");
    });

    it("tolerates an unclosed brace, reports it, and keeps every chord after it", () => {
      const { chart, errors } = parse("{C^7 |D-7 |G7 ");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("never closed");
      expect(chart.sections[0].repeat?.unclosed).to.equal(true);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7", "G7"]);
    });

    it("keeps the chord an unmatched brace used to fuse onto, which is the dropped chord defect", () => {
      const { chart } = parse("{C^7 |D-7 ");
      expect(chartChords(chart).map(parsedChordToIrealText)).to.deep.equal(["C^7", "D-7"]);
    });

    it("stores the common bars once and each ending's own bars separately", () => {
      const { chart, errors } = parse("{C^7 |D-7 |N1G7 |C^7 }[N2A7 |D-7 ]");
      expect(errors).to.deep.equal([]);
      const section = chart.sections[0];
      expect(section.repeat?.kind).to.equal("endings");
      expect(barTexts(section.bars)).to.deep.equal(["C^7", "D-7"]);
      expect(section.repeat?.endings?.map((e) => e.number)).to.deep.equal([1, 2]);
      expect(barTexts(section.repeat!.endings![0].bars)).to.deep.equal(["G7", "C^7"]);
      expect(barTexts(section.repeat!.endings![1].bars)).to.deep.equal(["A7", "D-7"]);
    });

    it("counts every chord of every ending, losing none to the ending structure", () => {
      const { chart } = parse("{C^7 |N1G7 }[N2A7 ]");
      expect(chartChords(chart).map(parsedChordToIrealText)).to.deep.equal(["C^7", "G7", "A7"]);
    });
  });

  describe("sections, labels and time signatures", () => {
    it("starts a new section at a label, and names it with the label's letter", () => {
      const { chart } = parse("*AC^7 |D-7 |*BG7 |C^7 ");
      expect(chart.sections.map((s) => s.label)).to.deep.equal(["A", "B"]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7"]);
      expect(barTexts(chart.sections[1].bars)).to.deep.equal(["G7", "C^7"]);
    });

    it("names a repeated section with the label written just inside its brace, which is the glued form real charts use", () => {
      const { chart } = parse("{*AT44C^7 |D-7 }");
      expect(chart.sections).to.have.length(1);
      expect(chart.sections[0].label).to.equal("A");
      expect(chart.sections[0].timeSignature).to.deep.equal({ numerator: 4, denominator: 4 });
      expect(chart.sections[0].repeat?.kind).to.equal("simple");
    });

    it("keeps a label whose letter the old cleanup passes used to delete", () => {
      // `f`, `l`, `s`, `Y`, `U`, `S` and `Q` were each deleted by a pass
      // with whole-string scope, so a label built on one of them decayed
      // to an empty sentinel and was dropped with no record.
      for (const letter of ["f", "l", "s", "Y", "U", "S", "Q"]) {
        const { chart } = parse(`*${letter}C^7 |D-7 `);
        expect(chart.sections.map((s) => s.label), letter).to.deep.equal([letter]);
        expect(barTexts(chart.sections[0].bars), letter).to.deep.equal(["C^7", "D-7"]);
      }
    });

    it("reads a two-digit time signature as a numerator and a denominator", () => {
      expect(parse("T34C^7 |").chart.sections[0].timeSignature).to.deep.equal({ numerator: 3, denominator: 4 });
      expect(parse("T68C^7 |").chart.sections[0].timeSignature).to.deep.equal({ numerator: 6, denominator: 8 });
    });

    it("reads `T12` as twelve eight, the one code whose digits are not a numerator and a denominator", () => {
      expect(parse("T12C^7 |").chart.sections[0].timeSignature).to.deep.equal({ numerator: 12, denominator: 8 });
    });

    it("starts a new section at a time signature written where one is already under way", () => {
      const { chart } = parse("T44C^7 |T34D-7 |");
      expect(chart.sections.map((s) => s.timeSignature)).to.deep.equal([
        { numerator: 4, denominator: 4 },
        { numerator: 3, denominator: 4 },
      ]);
    });

    it("does not leak a `Y` spacer or an `l` layout hint into a chord, which is the leaked spacer defect", () => {
      const { chart, errors } = parse("YC^7 |lD-7 |");
      expect(errors).to.deep.equal([]);
      expect(barTexts(chart.sections[0].bars)).to.deep.equal(["C^7", "D-7"]);
    });
  });

  describe("navigation", () => {
    it("records a segno, a coda and a part marker by section, reordering nothing", () => {
      const { chart } = parse("*AC^7 |*BSD-7 |*CQG7 |*DUA7 ");
      expect(chart.navigation.segnoSectionIndex).to.equal(1);
      expect(chart.navigation.codaSectionIndex).to.equal(2);
      expect(chart.navigation.partMarkerSections).to.deep.equal([3]);
      expect(chart.sections.map((s) => s.label)).to.deep.equal(["A", "B", "C", "D"]);
      expect(barTexts(chart.sections[2].bars)).to.deep.equal(["G7"]);
    });

    it("keeps every chord of a chart that jumps to a coda, rather than reordering bars away", () => {
      const { chart } = parse("SC^7 |D-7 |QG7 |QA7 ");
      expect(chartChords(chart).map(parsedChordToIrealText)).to.deep.equal(["C^7", "D-7", "G7", "A7"]);
    });
  });

  describe("chords the parser cannot read", () => {
    it("reports an unparsable chord naming the text it could not read", () => {
      const { errors } = parse("C^7 |Bb-77h |");
      expect(errors).to.have.length(1);
      expect(errors[0]).to.contain("Bb-77h");
    });
  });

  it("parses an empty grid into a chart with no sections", () => {
    const { chart, errors } = parse("");
    expect(chart.sections).to.deep.equal([]);
    expect(errors).to.deep.equal([]);
  });
});
