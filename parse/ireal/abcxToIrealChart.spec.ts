import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parseAbcx } from "../parsers/parse_abcx";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { Tune } from "../types/Expr";
import { abcxTuneToIrealChart, abcxTuneToSongFields } from "./abcxToIrealChart";
import { parsedChordToIrealText } from "./chordShorthand";
import { IrealChart } from "./gridAst";

/**
 * Example-based tests for `abcxToIrealChart.ts`, one per rule in
 * `plans/4.abcx-to-ireal-export.md` section 7.
 *
 * Every fixture here is ABCx, so the chords are in ABC's dialect and not
 * iReal Pro's: a minor seventh is `Dm7`, a major seventh `Cmaj7`, a
 * half-diminished `Cm7b5`. That is the opposite of `gridWriter.spec.ts`
 * and of every other spec in this directory, whose fixtures are grid text,
 * and the two sitting side by side is worth the warning: a fixture in the
 * wrong dialect makes correct code look broken.
 */

function read(body: string, header = ""): { chart: IrealChart; errors: string[]; tune: Tune } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const source = `X:1\n${header}K:C\n${body}\n`;
  const file = parseAbcx(ScannerAbcx(source, ctx), ctx);
  const tune = file.contents.find((item): item is Tune => item instanceof Tune);
  if (tune === undefined) throw new Error(`no tune parsed from ${JSON.stringify(source)}`);
  const chart = abcxTuneToIrealChart(tune, ctx);
  return { chart, errors: ctx.errorReporter.getErrors().map((e) => e.message), tune };
}

/** Each bar of a section as the iReal text of the chords it holds. */
function bars(chart: IrealChart, index = 0): string[] {
  return chart.sections[index].bars.map((bar) =>
    bar.cells.map((cell) => (cell.chord ? parsedChordToIrealText(cell.chord) : cell.kind)).join(" "),
  );
}

describe("ABCx to an iReal chart", () => {
  describe("bars and chords", () => {
    it("reads a chord into iReal Pro's own dialect", () => {
      // The input says maj7 and m7; the chart holds the chord itself, and
      // writing it out again uses iReal's symbols.
      expect(bars(read("Cmaj7 | Dm7 | G7 |").chart)).to.deep.equal(["C^7", "D-7", "G7"]);
    });

    it("reads several chords in one bar", () => {
      expect(bars(read("Cmaj7 Dm7 | G7 |").chart)).to.deep.equal(["C^7 D-7", "G7"]);
    });

    it("reads a half-diminished and an altered chord", () => {
      // ABC's `m7b5` reads as a minor seventh with a flattened fifth
      // rather than as iReal's own half-diminished symbol, so it writes
      // back as `C-7b5`. Both spellings are iReal Pro's and real charts
      // use each, so this is a spelling the export keeps rather than
      // normalises.
      expect(bars(read("Cm7b5 | Calt7 |").chart)).to.deep.equal(["C-7b5", "C7alt"]);
    });

    it("reads a slash bass", () => {
      expect(bars(read("Cmaj7/G |").chart)).to.deep.equal(["C^7/G"]);
    });

    it("refuses a chord symbol it cannot read as a chord", () => {
      // `Cmaj79` scans as one symbol and then parses to nothing. Accepting
      // it would put a cell in the chart with no chord in it.
      expect(read("Cmaj79 |").errors.join()).to.match(/Could not read the chord symbol/);
    });

    it("drops a bar that holds nothing", () => {
      expect(bars(read("Cmaj7 | | Dm7 |").chart)).to.deep.equal(["C^7", "D-7"]);
    });
  });

  describe("sections", () => {
    it("reads a part field as a section label", () => {
      const { chart } = read("[P:A] Cmaj7 | [P:B] Dm7 |");
      expect(chart.sections.map((section) => section.label)).to.deep.equal(["A", "B"]);
      expect(bars(chart, 0)).to.deep.equal(["C^7"]);
      expect(bars(chart, 1)).to.deep.equal(["D-7"]);
    });

    it("reads a tune with no part field as one section", () => {
      const { chart } = read("Cmaj7 | Dm7 |");
      expect(chart.sections.length).to.equal(1);
      expect(chart.sections[0].label).to.equal(undefined);
    });

    it("reads an inline meter field as a time signature", () => {
      const { chart } = read("[P:A][M:3/4] Cmaj7 |");
      expect(chart.sections[0].timeSignature).to.deep.equal({ numerator: 3, denominator: 4 });
    });

    it("reports a meter it cannot read", () => {
      expect(read("[M:C|] Cmaj7 |").errors.join()).to.match(/cannot be read/);
    });

    it("ends a section at a doubled barline", () => {
      const { chart } = read("Cmaj7 || Dm7 |");
      expect(chart.sections.length).to.equal(2);
    });
  });

  describe("repeats and endings", () => {
    it("reads a repeat", () => {
      const { chart } = read("|: Cmaj7 | Dm7 :|");
      expect(chart.sections.length).to.equal(1);
      expect(chart.sections[0].repeat?.kind).to.equal("simple");
      expect(bars(chart)).to.deep.equal(["C^7", "D-7"]);
    });

    it("reads two numbered endings", () => {
      const { chart } = read("|: Cmaj7 | Dm7 :|[1 Em7 :|[2 F7 |]");
      const repeat = chart.sections[0].repeat;
      expect(repeat?.kind).to.equal("endings");
      expect(repeat?.endings?.map((ending) => ending.number)).to.deep.equal([1, 2]);
      expect(repeat?.endings?.map((ending) => ending.bars.length)).to.deep.equal([1, 1]);
      expect(bars(chart)).to.deep.equal(["C^7", "D-7"]);
    });

    it("reads a repeat that closes and reopens at one barline", () => {
      // ABCx splits ":|:" into a closing and an opening barline, so the
      // walk must not read the opening half as a second close.
      const { chart } = read("|: Cmaj7 :|: Dm7 :|");
      expect(chart.sections.length).to.equal(2);
      expect(chart.sections.every((section) => section.repeat?.kind === "simple")).to.equal(true);
    });

    it("reads an ending whose repeat was never opened", () => {
      const { chart } = read("Cmaj7 | Dm7 :|[1 Em7 :|[2 F7 |");
      expect(chart.sections[0].repeat?.endings?.length).to.equal(2);
    });
  });

  describe("annotations and navigation", () => {
    it("reads a quoted annotation as a bar annotation", () => {
      const { chart } = read('"Solos" Cmaj7 | Dm7 |');
      expect(chart.sections[0].bars[0].annotations.map((a) => a.text)).to.deep.equal(["Solos"]);
    });

    it("reads a segno and a coda as navigation rather than as text", () => {
      // ABCx has no decoration syntax: both the bang and the plus forms
      // scan into error nodes, which was measured. A quoted annotation is
      // what parses, so it is the agreed spelling.
      const { chart } = read('[P:A] Cmaj7 | [P:B] "^segno" Dm7 | [P:C] "^coda" Em7 |');
      expect(chart.navigation.segnoSectionIndex).to.equal(1);
      expect(chart.navigation.codaSectionIndex).to.equal(2);
      for (const section of chart.sections) {
        for (const bar of section.bars) expect(bar.annotations).to.deep.equal([]);
      }
    });

    it("keeps an annotation that merely contains the word", () => {
      const { chart } = read('"to coda now" Cmaj7 |');
      expect(chart.navigation.codaSectionIndex).to.equal(undefined);
      expect(chart.sections[0].bars[0].annotations.map((a) => a.text)).to.deep.equal(["to coda now"]);
    });

    it("reads an annotation with no bar after it as the chart's own", () => {
      const { chart } = read('Cmaj7 | "Fine"');
      expect(chart.annotations.map((a) => a.text)).to.deep.equal(["Fine"]);
    });
  });

  describe("the song's fields", () => {
    it("reads title, composer, key, tempo, style and groove", () => {
      const { tune } = read("Cmaj7 |", "T:My Tune\nC:A. Composer\nQ:1/4=140\n%%irealstyle Bossa Nova\n%%irealgroove Jazz-Bossa Nova\n");
      const ctx = new ABCContext(new AbcErrorReporter());
      const fields = abcxTuneToSongFields(tune, "grid", ctx);
      expect(fields.title).to.equal("My Tune");
      expect(fields.composer).to.equal("A. Composer");
      expect(fields.key).to.equal("C");
      expect(fields.bpm).to.equal("140");
      expect(fields.style).to.equal("Bossa Nova");
      expect(fields.groove).to.equal("Jazz-Bossa Nova");
      expect(fields.rawChordData).to.equal("grid");
    });

    it("takes only the rate from a tempo written as a note length and a rate", () => {
      const { tune } = read("Cmaj7 |", "T:T\nQ:1/4=96\n");
      const ctx = new ABCContext(new AbcErrorReporter());
      expect(abcxTuneToSongFields(tune, "", ctx).bpm).to.equal("96");
    });

    it("reports a tune with no title", () => {
      const { tune } = read("Cmaj7 |");
      const ctx = new ABCContext(new AbcErrorReporter());
      abcxTuneToSongFields(tune, "", ctx);
      expect(ctx.errorReporter.getErrors().map((e) => e.message).join()).to.match(/no title/);
    });
  });
});
