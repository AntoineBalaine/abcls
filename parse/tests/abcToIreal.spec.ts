import { expect } from "chai";
import { describe, it } from "mocha";
import { exportAbcToIrealLink, parsePlaylistLink, scanGrid, stripChordDataMarker, tokensToGridText, unscramble } from "../index";
import { ABCContext } from "../parsers/Context";

function gridOf(abc: string, options: Parameters<typeof exportAbcToIrealLink>[1] = {}): { grid: string; link: string; ctx: ABCContext } {
  const ctx = new ABCContext();
  const link = exportAbcToIrealLink(abc, options, ctx);
  if (link === null)
    expect.fail(
      ctx.errorReporter
        .getErrors()
        .map((error) => error.message)
        .join("; ")
    );
  const song = parsePlaylistLink(link).songs[0];
  return { grid: tokensToGridText(scanGrid(unscramble(stripChordDataMarker(song.rawChordData)), new ABCContext())), link, ctx };
}

describe("exportAbcToIrealLink", () => {
  it("exports a bar of notes with no chord by repeating the previous chord", () => {
    const { grid } = gridOf('X:1\nT:t\nM:4/4\nK:C\n"C" c4 | c4 | "G7" d4 | d4 |]\n');
    expect(grid).to.contain("C|C|G7|G7");
  });

  it("writes the key of the header, so the tune stays in the key it is written in", () => {
    const link = gridOf('X:1\nT:t\nK:Bb\n"Bb" B4|]\n').link;
    expect(parsePlaylistLink(link).songs[0].key).to.equal("Bb");
  });

  it("reads plain chords as major chords without reporting a loss", () => {
    const { ctx } = gridOf('X:1\nT:t\nK:C\n"C" c4 | "G" d4 | "C6" c4 |]\n');
    expect(ctx.errorReporter.getErrors().map((e) => e.message)).to.deep.equal([]);
  });

  it("reads the jazz symbols of a lead sheet", () => {
    const { grid, ctx } = gridOf('X:1\nT:t\nK:C\n"F▵" c4 | "B⁷#5" d4 | "C#°" c4 | "Dm7" e4 |]\n');
    expect(grid).to.contain("F^7|B7#5|C#o|D-7");
    expect(ctx.errorReporter.getErrors()).to.have.length(0);
  });

  it("reads the chords from the voice that carries them and keeps the bars of that voice", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\nV:1\nV:2\n[V:1] c4 | d4 | e4 | f4 |\n[V:2] "C" x4 | "G" x4 | "Am" x4 | "F" x4 |]\n';
    expect(gridOf(abc).grid).to.contain("C|G|A-|F");
  });

  it("takes the chord of a bar from the neighbouring voice when the chord voice names none", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\nV:1\nV:2\n[V:1] "C" c4 | "G" d4 |\n[V:2] "Am" x4 | x4 | "F" x4 | x4 |]\n';
    expect(gridOf(abc, { voice: "2" }).grid).to.contain("A-|G|F|F");
  });

  it("starts a new section at a part marker and keeps a long part name as text", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\n"C" c4 | "G" d4 |\nP:A\n"F" f4 | "C" c4 |\nP:ENDING\n"G" g4 | "C" c4 |]\n';
    const { grid } = gridOf(abc);
    expect(grid).to.contain("*A");
    expect(grid).to.contain("<ENDING>");
  });

  it("ends the section at a closing repeat, so the repeat does not swallow the bars after it", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\n|: "C" c4 | "G" d4 :| "F" f4 | "C" c4 |]\n';
    const { grid } = gridOf(abc);
    expect(grid).to.contain("C|G}");
    expect(grid).to.contain("[F|C]");
  });

  it("exports only the tunes with the requested X: numbers", () => {
    const abc = 'X:1\nT:first\nK:C\n"C" c4|]\n\nX:2\nT:second\nK:D\n"D" d4|]\n';
    const playlist = parsePlaylistLink(exportAbcToIrealLink(abc, { tunes: [1] })!);
    expect(playlist.songs.map((song) => song.title)).to.deep.equal(["first"]);
  });

  it("reports an error and gives no link when no tune matches", () => {
    const ctx = new ABCContext();
    expect(exportAbcToIrealLink('X:1\nT:t\nK:C\n"C" c4|]\n', { tunes: [9] }, ctx)).to.equal(null);
    expect(
      ctx.errorReporter
        .getErrors()
        .map((error) => error.message)
        .join("\n")
    ).to.contain("No tune to export");
  });

  it("starts the body in the first voice of the header, so --voice finds it", () => {
    const { grid } = gridOf('X:1\nT:t\nM:4/4\nL:1/4\nV:1\nK:C\n"C"C4|"F"F4|"G"G4|"C"C4|\n', { voice: "1" });
    expect(grid).to.contain("C|F|G|C");
  });

  it("reads common time and cut time in a meter change of the body as the fractions they stand for", () => {
    const common = gridOf('X:1\nT:t\nM:3/4\nL:1/4\nK:C\n"C"C3|[M:C]"F"F4|"G"G4|\n');
    const fraction = gridOf('X:1\nT:t\nM:3/4\nL:1/4\nK:C\n"C"C3|[M:4/4]"F"F4|"G"G4|\n');
    expect(common.ctx.errorReporter.getErrors().map((error) => error.message)).to.deep.equal([]);
    expect(common.grid).to.equal(fraction.grid);
  });
});
