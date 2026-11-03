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
    expect(grid).to.contain("C   |C   |G7   |G7   ");
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
    expect(grid).to.contain("F^7   |B7#5   |C#o   |D-7   ");
    expect(ctx.errorReporter.getErrors()).to.have.length(0);
  });

  it("reads the chords from the voice that carries them and keeps the bars of that voice", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\nV:1\nV:2\n[V:1] c4 | d4 | e4 | f4 |\n[V:2] "C" x4 | "G" x4 | "Am" x4 | "F" x4 |]\n';
    expect(gridOf(abc).grid).to.contain("C   |G   |A-   |F   ");
  });

  it("takes the chord of a bar from the neighbouring voice when the chord voice names none", () => {
    const abc = 'X:1\nT:t\nM:4/4\nK:C\nV:1\nV:2\n[V:1] "C" c4 | "G" d4 |\n[V:2] "Am" x4 | x4 | "F" x4 | x4 |]\n';
    expect(gridOf(abc, { voice: "2" }).grid).to.contain("A-   |G   |F   |F   ");
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
    expect(grid).to.contain("C   |G   }");
    expect(grid).to.contain("[F   |C   ]");
  });

  describe("cells of a bar", () => {
    it("pads a bar to the four cells of 4/4, because iReal Pro lays the chart out by cells", () => {
      expect(gridOf('X:1\nT:t\nM:4/4\nK:C\n"C" c8 |]\n').grid).to.contain("C   ]");
    });

    it("pads a bar to four cells in 3/4 and in 6/8 too, because four bars of four cells fill a row of sixteen", () => {
      expect(gridOf('X:1\nT:t\nM:3/4\nK:C\n"C" c6 |]\n').grid).to.contain("T34C   ]");
      expect(gridOf('X:1\nT:t\nM:6/8\nK:C\n"C" c6 |]\n').grid).to.contain("T68C   ]");
    });

    it("spreads two chords of a bar over its cells, one on the first beat and one on the third", () => {
      expect(gridOf('X:1\nT:t\nM:4/4\nK:C\n"C" c4 "G" d4 |]\n').grid).to.contain("C G ]");
    });

    it("pads a bar that holds no chord, so that it does not shift the bars after it", () => {
      expect(gridOf('X:1\nT:t\nM:6/8\nK:C\nc6 | "G" d6 |]\n').grid).to.contain("n   |G   ]");
    });
  });

  describe("row alignment", () => {
    it("pads the last row of a section with blank cells, so that the next section starts on a new row", () => {
      const abc = 'X:1\nT:t\nM:4/4\nK:C\n"C" c4 | "D" d4 | "E" e4 |]\n';
      expect(gridOf(abc).grid).to.contain("E   ]    ");
    });

    it("does not pad a section whose bars fill its rows exactly", () => {
      const abc = 'X:1\nT:t\nM:4/4\nK:C\n"C" c4 | "D" d4 | "E" e4 | "F" f4 |]\n';
      expect(gridOf(abc).grid).to.contain("F   ]Z");
    });
  });

  describe("adjacent cells", () => {
    it("packs the last two of three chords into one cell with a comma, so that the bar keeps its four cells", () => {
      expect(gridOf('X:1\nT:t\nM:4/4\nK:C\n"F7" c2 "G" d2 "A6" e2 |]\n').grid).to.contain("F7 G,A6 ]");
    });
  });

  describe("chord symbols", () => {
    it("exports a minor chord with a major seventh as a chord, and not as text", () => {
      const { grid, ctx } = gridOf('X:1\nT:t\nM:4/4\nK:C\n"Cm" c4 | "EbmM7" d4 |]\n');
      expect(grid).to.contain("Eb-^7");
      expect(grid).not.to.contain("<EbmM7>");
      expect(ctx.errorReporter.getErrors()).to.have.length(0);
    });

    it("says so when a chord symbol cannot be read, and exports it as text", () => {
      const { grid, ctx } = gridOf('X:1\nT:t\nM:4/4\nK:C\n"C" c4 | "Cmxx" d4 |]\n');
      expect(grid).to.contain("<Cmxx>");
      expect(ctx.errorReporter.getErrors().map((e) => e.message).join(" ")).to.contain("'Cmxx' could not be read");
    });

    it("does not warn about a word that only starts with a note letter, such as Chorus", () => {
      const { ctx } = gridOf('X:1\nT:t\nM:4/4\nK:C\n"^Chorus" c4 | "C" d4 |]\n');
      expect(ctx.errorReporter.getErrors()).to.have.length(0);
    });
  });

  describe("tempo", () => {
    const bpmOf = (abc: string, options: Parameters<typeof exportAbcToIrealLink>[1] = {}): string | undefined =>
      parsePlaylistLink(gridOf(abc, options).link).songs[0].bpm;

    it("uses the tempo of the Q: line", () => {
      expect(bpmOf('X:1\nT:t\nQ:1/4=96\nK:C\n"C" c4|]\n')).to.equal("96");
    });

    it("uses the tempo option when the tune has no Q: line", () => {
      expect(bpmOf('X:1\nT:t\nK:C\n"C" c4|]\n', { tempo: 120 })).to.equal("120");
    });

    it("prefers the Q: line to the tempo option", () => {
      expect(bpmOf('X:1\nT:t\nQ:1/4=96\nK:C\n"C" c4|]\n', { tempo: 120 })).to.equal("96");
    });
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
    expect(grid).to.contain("C   |F   |G   |C   ");
  });

  it("reads common time and cut time in a meter change of the body as the fractions they stand for", () => {
    const common = gridOf('X:1\nT:t\nM:3/4\nL:1/4\nK:C\n"C"C3|[M:C]"F"F4|"G"G4|\n');
    const fraction = gridOf('X:1\nT:t\nM:3/4\nL:1/4\nK:C\n"C"C3|[M:4/4]"F"F4|"G"G4|\n');
    expect(common.ctx.errorReporter.getErrors().map((error) => error.message)).to.deep.equal([]);
    expect(common.grid).to.equal(fraction.grid);
  });
});
