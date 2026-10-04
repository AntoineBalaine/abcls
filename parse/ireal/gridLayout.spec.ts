import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parsedChordToIrealText } from "./chordShorthand";
import { Barline, ChartLayout, layoutChart } from "./gridLayout";
import { parseGrid } from "./gridParser";
import { scanGrid } from "./gridScanner";

/**
 * Example-based tests for `gridLayout.ts`, one per rule in
 * `plans/3.chord-grid-text-rendering.md` section 5, plus one per defect in
 * `plans/2.ireal-grid-lexer-parser.md` section 1 that the layout is
 * responsible for.
 *
 * Every fixture is raw grid text in iReal Pro's own chord dialect, handed
 * straight to `scanGrid`: minor seventh is `D-7`, major seventh is `C^7`,
 * half-diminished is `Ch7`. Writing a fixture in ABC's dialect makes correct
 * code look broken, which has cost this work real time three times over.
 */

function layout(grid: string, barsPerLine?: number): ChartLayout {
  const ctx = new ABCContext(new AbcErrorReporter());
  const chart = parseGrid(scanGrid(grid, ctx), ctx);
  return layoutChart(chart, barsPerLine === undefined ? {} : { barsPerLine });
}

/** Each line as "<openBarline marks> chords ... <closeBarline mark>", for readable assertions. */
const BARLINE_MARK: Record<Barline, string> = {
  plain: "|",
  openRepeat: "|:",
  closeRepeat: ":|",
  closeOpenRepeat: ":|:",
  final: "||",
};

function lineTexts(result: ChartLayout): string[] {
  return result.lines.map((line) => {
    const parts: string[] = [];
    for (const bar of line.bars) {
      parts.push(BARLINE_MARK[bar.openBarline]);
      parts.push(
        bar.cells
          .map((cell) => (cell.chord ? parsedChordToIrealText(cell.chord) : cell.kind))
          .join(" ")
      );
    }
    parts.push(BARLINE_MARK[line.closeBarline]);
    return parts.join(" ");
  });
}

describe("iReal grid layout", () => {
  describe("line grouping", () => {
    it("fills lines four bars at a time", () => {
      const result = layout("C^7 |D-7 |E-7 |F^7 |G7 |A-7 ");
      expect(result.lines.length).to.equal(2);
      expect(result.lines[0].bars.length).to.equal(4);
      expect(result.lines[1].bars.length).to.equal(2);
    });

    it("leaves a short final line short rather than padding it", () => {
      const result = layout("C^7 |D-7 |E-7 ");
      expect(result.lines.length).to.equal(1);
      expect(result.lines[0].bars.length).to.equal(3);
    });

    it("honours a different bars-per-line setting", () => {
      const result = layout("C^7 |D-7 |E-7 |F^7 ", 2);
      expect(result.lines.map((l) => l.bars.length)).to.deep.equal([2, 2]);
    });

    it("starts a new line at a section even mid-group", () => {
      const result = layout("[*AC^7 |D-7 ][*BE-7 |F^7 ");
      expect(result.lines.length).to.equal(2);
      expect(result.lines[0].sectionLabel).to.equal("A");
      expect(result.lines[1].sectionLabel).to.equal("B");
    });

    it("numbers bars over the whole chart in reading order", () => {
      const result = layout("[*AC^7 |D-7 |E-7 |F^7 |G7 ");
      const indexes = result.lines.flatMap((l) => l.bars.map((b) => b.indexInChart));
      expect(indexes).to.deep.equal([0, 1, 2, 3, 4]);
    });
  });

  describe("section headings", () => {
    it("carries a section label on its first line only", () => {
      const result = layout("[*AC^7 |D-7 |E-7 |F^7 |G7 |A-7 ");
      expect(result.lines[0].sectionLabel).to.equal("A");
      expect(result.lines[1].sectionLabel).to.equal(undefined);
    });

    it("carries a time signature on the section's first line", () => {
      const result = layout("[*AT44C^7 |D-7 ");
      expect(result.lines[0].timeSignature).to.deep.equal({ numerator: 4, denominator: 4 });
    });

    it("does not repeat the time signature on a continuation line", () => {
      const result = layout("[*AT34C^7 |D-7 |E-7 |F^7 |G7 ");
      expect(result.lines[0].timeSignature).to.deep.equal({ numerator: 3, denominator: 4 });
      expect(result.lines[1].timeSignature).to.equal(undefined);
    });

    it("names the section each line's bars came from", () => {
      // A navigation marker records a section index, so a consumer placing
      // one must not have to recover section boundaries by counting labels.
      const result = layout("[*AC^7 |D-7 |E-7 |F^7 |G7 ][*BA-7 ");
      expect(result.lines.map((l) => l.sectionIndex)).to.deep.equal([0, 0, 1]);
    });
  });

  describe("barlines", () => {
    it("writes a plain barline between ordinary bars", () => {
      expect(lineTexts(layout("C^7 |D-7 "))).to.deep.equal(["| C^7 | D-7 ||"]);
    });

    it("opens and closes a simple repeat around the section's bars", () => {
      expect(lineTexts(layout("{C^7 |D-7 }"))).to.deep.equal(["|: C^7 | D-7 :|"]);
    });

    it("splits a close meeting an open across the line break between them", () => {
      // Inside one line, a bar that closes a repeat where the next opens
      // another is the single symbol ":|:", because ":|" then "|:" says
      // something different and wrong: repeat what came before, then two
      // empty bars, then repeat what follows. Across a line break the two
      // halves belong at different ends, which is how a chart is engraved,
      // and since a section always begins a line the two never meet inside
      // one line today.
      const result = layout("{C^7 |D-7 }{E-7 |F^7 }");
      expect(result.lines[0].closeBarline).to.equal("closeRepeat");
      expect(result.lines[1].bars[0].openBarline).to.equal("openRepeat");
    });

    it("ends the chart with a final barline rather than a separator", () => {
      const result = layout("C^7 |D-7 ");
      expect(result.lines[0].closeBarline).to.equal("final");
    });

    it("splits a barline across a line break so neither half prints twice", () => {
      // A barline between two bars is printed once. When they fall on
      // different lines, what closes belongs to the earlier line and what
      // opens to the later one; printing the whole symbol at both ends left
      // a dangling repeat sign hanging off the end of a section.
      const result = layout("[*AC^7 |D-7 ][*B{E-7 |F^7 }");
      expect(result.lines[0].closeBarline).to.equal("plain");
      expect(result.lines[1].bars[0].openBarline).to.equal("openRepeat");
    });

    it("gives a closing repeat to the line it ends, not to the line after it", () => {
      const result = layout("{C^7 |D-7 }[*BE-7 ");
      expect(result.lines[0].closeBarline).to.equal("closeRepeat");
      expect(result.lines[1].bars[0].openBarline).to.equal("plain");
    });

    it("closes a repeat between two bars of one line", () => {
      // The bar after a first ending continues the same line, so the
      // closing repeat stands between two bars rather than at a line edge.
      const result = layout("{C^7 |N1D-7 }N2E-7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars[2].openBarline).to.equal("closeRepeat");
    });

    it("closes a repeat that was never closed, which real charts write", () => {
      const result = layout("{C^7 |D-7 ");
      expect(result.lines[0].bars[0].openBarline).to.equal("openRepeat");
      expect(result.lines[0].closeBarline).to.equal("closeRepeat");
    });

    it("lays a repeated section out once rather than writing its bars twice", () => {
      // The old path wrote a repeated section's text out once per pass, which
      // inflated charts roughly twofold library wide.
      const result = layout("{C^7 |D-7 |E-7 |F^7 }");
      expect(result.lines.length).to.equal(1);
      expect(result.lines[0].bars.map((b) => parsedChordToIrealText(b.cells[0].chord!))).to.deep.equal([
        "C^7",
        "D-7",
        "E-7",
        "F^7",
      ]);
    });
  });

  describe("numbered endings", () => {
    it("lays the common bars out once and then each ending in turn", () => {
      const result = layout("{C^7 |D-7 |N1E-7 }N2F^7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.map((b) => b.endingNumber)).to.deep.equal([undefined, undefined, 1, 2]);
    });

    it("does not open a repeat on an ending that begins its section", () => {
      // In the `[N1 ... }` shape the repeated span lies before the ending
      // rather than inside it, so drawing an opening repeat on the ending's
      // own first bar would tell the reader to loop that single bar.
      const result = layout("[*AC^7 |D-7 ][*BN1E-7 }N2F^7 ");
      const sectionB = result.lines[1];
      expect(sectionB.bars[0].openBarline).to.equal("plain");
    });

    it("handles more than two endings", () => {
      const result = layout("{C^7 |N1D-7 }N2E-7 }N3F^7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.map((b) => b.endingNumber)).to.deep.equal([undefined, 1, 2, 3]);
      // Only the last ending plays on; the earlier two send the reader back.
      expect(bars[2].openBarline).to.equal("closeRepeat");
      expect(bars[3].openBarline).to.equal("closeRepeat");
    });

    it("starts a section at its first ending when it has no common bar", () => {
      // Two charts in the sample library label a section whose bars all live
      // in its endings. Marking only a common bar as starting the section
      // lost both labels, since there was no common bar to mark.
      const result = layout("[*BN1C^7 }N2D-7 ");
      expect(result.lines[0].sectionLabel).to.equal("B");
      expect(result.lines[0].bars[0].endingNumber).to.equal(1);
    });

    it("sends the reader back from every ending but the last", () => {
      const result = layout("{C^7 |D-7 |N1E-7 }N2F^7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      // The bar after the first ending reopens nothing and closes the repeat;
      // the second ending plays on.
      expect(bars[3].openBarline).to.equal("closeRepeat");
    });
  });

  describe("cells", () => {
    it("resolves a held chord to that chord repeated, not to a repeat sign", () => {
      // `x` means a held chord. Reading it as a repeat sign littered real
      // charts with spurious repeats.
      const result = layout("C^7 |x ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.map((b) => parsedChordToIrealText(b.cells[0].chord!))).to.deep.equal(["C^7", "C^7"]);
      expect(bars[1].openBarline).to.equal("plain");
    });

    it("emits no bar for a bar holding no cell", () => {
      // Asserting that no laid-out bar is empty would pass by construction,
      // since an empty bar is filtered out before a bar is built; the rule
      // is that the empty bar between these two does not become a third.
      const result = layout("C^7 | |D-7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.length).to.equal(2);
    });

    it("keeps the bass of a back reference the parser could not resolve", () => {
      // A chart whose first chord cell is a back reference leaves the cell
      // unresolved with its bass intact, and a stage whose contract is to
      // lose nothing must carry that bass through.
      const result = layout("W/C |D-7 ");
      const first = result.lines[0].bars[0].cells[0];
      expect(first.kind).to.equal("sameChordWithBass");
      expect(first.bass?.root).to.equal("C");
    });

    it("lays out a no-chord cell", () => {
      const result = layout("n |C^7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars[0].cells[0].kind).to.equal("noChord");
    });

    it("resolves a same-chord cell to the chord before it", () => {
      const result = layout("C^7 |p ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.map((b) => parsedChordToIrealText(b.cells[0].chord!))).to.deep.equal(["C^7", "C^7"]);
    });

    it("expands a two-bar back reference into two bars", () => {
      const result = layout("C^7 |D-7 |r ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.map((b) => parsedChordToIrealText(b.cells[0].chord!))).to.deep.equal([
        "C^7",
        "D-7",
        "C^7",
        "D-7",
      ]);
    });

    it("carries a fermata onto its bar", () => {
      const result = layout("C^7 |fD-7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars.some((b) => b.fermata)).to.equal(true);
    });

    it("keeps a cell's alternative chord and its cue size", () => {
      const result = layout("C^7 (D-7)|sE-7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars[0].cells[0].alternative && parsedChordToIrealText(bars[0].cells[0].alternative)).to.equal("D-7");
      expect(bars[1].cells[0].small).to.equal(true);
    });
  });

  describe("what passes through untouched", () => {
    it("keeps bar annotations on their bar", () => {
      const result = layout("C^7 <Solos>|D-7 ");
      const bars = result.lines.flatMap((l) => l.bars);
      expect(bars[0].annotations.map((a) => a.text)).to.deep.equal(["Solos"]);
    });

    it("passes the chart's navigation markers through", () => {
      const result = layout("[*AC^7 ][*BS D-7 ");
      expect(result.navigation.segnoSectionIndex).to.equal(1);
    });
  });
});
