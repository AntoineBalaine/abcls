import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parsedChordToIrealText } from "./chordShorthand";
import { exportAbcxToIrealLink } from "./exportToIreal";
import { parsePlaylistLink, stripChordDataMarker } from "./fields";
import { IrealChart } from "./gridAst";
import { parseGrid } from "./gridParser";
import { scanGrid } from "./gridScanner";
import { unscramble } from "./scramble";

/**
 * ABCx to an iReal Pro link, end to end.
 *
 * The fixtures are ABCx, so the chords are in ABC's dialect: a minor
 * seventh is `Dm7` and a major seventh `Cmaj7`. Each case exports a tune
 * and then reads the link back through the grid scanner and parser, which
 * is the only way to see what the link actually says.
 *
 * The cases that matter are the ones the previous implementation could not
 * express at all: a repeat, numbered endings, a section label, a time
 * signature and an annotation. It wrote chords and barlines and dropped
 * everything else, and its own tests passed because every fixture in them
 * was a flat chord grid.
 */

function exportChart(body: string, header = "T:Test\n"): { chart: IrealChart; errors: string[]; link: string } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const link = exportAbcxToIrealLink(`X:1\n${header}K:C\n${body}\n`, ctx);
  const song = parsePlaylistLink(link).songs[0];
  const grid = unscramble(stripChordDataMarker(song.rawChordData));
  const readCtx = new ABCContext(new AbcErrorReporter());
  const chart = parseGrid(scanGrid(grid, readCtx), readCtx);
  return {
    chart,
    errors: [...ctx.errorReporter.getErrors(), ...readCtx.errorReporter.getErrors()].map((e) => e.message),
    link,
  };
}

function bars(chart: IrealChart, index = 0): string[] {
  return chart.sections[index].bars.map((bar) =>
    bar.cells.map((cell) => (cell.chord ? parsedChordToIrealText(cell.chord) : cell.kind)).join(" "),
  );
}

describe("ABCx to an iReal Pro link", () => {
  it("carries the chords through, in iReal Pro's own dialect", () => {
    const { chart, errors } = exportChart("Cm7 F7 | Bbmaj7 Ebmaj7 | Am7b5 D7 | Gm7 Gm7 |");
    expect(errors).to.deep.equal([]);
    expect(bars(chart)).to.deep.equal(["C-7 F7", "Bb^7 Eb^7", "A-7b5 D7", "G-7 G-7"]);
  });

  it("carries a repeat", () => {
    const { chart, errors } = exportChart("|: Cmaj7 | Dm7 :|");
    expect(errors).to.deep.equal([]);
    expect(chart.sections[0].repeat?.kind).to.equal("simple");
  });

  it("carries two numbered endings", () => {
    const { chart, errors } = exportChart("|: Cmaj7 | Dm7 :|[1 Em7 :|[2 F7 |]");
    expect(errors).to.deep.equal([]);
    const repeat = chart.sections[0].repeat;
    expect(repeat?.kind).to.equal("endings");
    expect(repeat?.endings?.map((ending) => ending.number)).to.deep.equal([1, 2]);
    expect(repeat?.endings?.map((ending) => bars({ ...chart, sections: [{ bars: ending.bars }] }))).to.deep.equal([
      ["E-7"],
      ["F7"],
    ]);
  });

  it("carries section labels", () => {
    const { chart, errors } = exportChart("[P:A] Cmaj7 | [P:B] Dm7 |");
    expect(errors).to.deep.equal([]);
    expect(chart.sections.map((section) => section.label)).to.deep.equal(["A", "B"]);
  });

  it("carries a time signature", () => {
    const { chart, errors } = exportChart("[P:A][M:3/4] Cmaj7 |");
    expect(errors).to.deep.equal([]);
    expect(chart.sections[0].timeSignature).to.deep.equal({ numerator: 3, denominator: 4 });
  });

  it("carries an annotation", () => {
    const { chart, errors } = exportChart('"Solos" Cmaj7 | Dm7 |');
    expect(errors).to.deep.equal([]);
    expect(chart.sections[0].bars[0].annotations.map((a) => a.text)).to.deep.equal(["Solos"]);
  });

  it("carries a segno and a coda", () => {
    const { chart, errors } = exportChart('[P:A] Cmaj7 | [P:B] "^segno" Dm7 |');
    expect(errors).to.deep.equal([]);
    expect(chart.navigation.segnoSectionIndex).to.equal(1);
  });

  it("carries the title, composer and key into the link's own fields", () => {
    const ctx = new ABCContext(new AbcErrorReporter());
    const link = exportAbcxToIrealLink("X:1\nT:My Tune\nC:A. Composer\nK:F\nC7 F7 |\n", ctx);
    const song = parsePlaylistLink(link).songs[0];
    expect(song.title).to.equal("My Tune");
    expect(song.composer).to.equal("A. Composer");
    expect(song.key).to.equal("F");
  });

  it("takes only the rate from a tempo written as a note length and a rate", () => {
    const ctx = new ABCContext(new AbcErrorReporter());
    const link = exportAbcxToIrealLink("X:1\nT:Test\nQ:1/4=140\nK:C\nC7 |\n", ctx);
    expect(parsePlaylistLink(link).songs[0].bpm).to.equal("140");
  });

  it("exports every tune of a multi-tune source", () => {
    const ctx = new ABCContext(new AbcErrorReporter());
    const link = exportAbcxToIrealLink("X:1\nT:Song A\nK:C\nC7 |\n\nX:2\nT:Song B\nK:F\nF7 |\n", ctx);
    expect(parsePlaylistLink(link).songs.map((song) => song.title)).to.deep.equal(["Song A", "Song B"]);
  });

  it("throws when there is no tune to export", () => {
    expect(() => exportAbcxToIrealLink("")).to.throw(/No tunes found/);
  });

  it("reports a chord it could not read rather than exporting a chart without it", () => {
    const { errors } = exportChart("Cmaj79 | Dm7 |");
    expect(errors.join()).to.match(/Could not read the chord symbol/);
  });
});
