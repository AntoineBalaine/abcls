import { Range } from "abcls-parser";
import { expect } from "chai";
import { runTransform } from "../src/runner/runTransform";

const HEADER = "X:1\nM:C\nL:1/8\nK:F\n";

/**
 * Keeps the music of a result and writes it with one space around each bar line,
 * so that the specs compare the notes and the bars and not the spacing that the writer chooses.
 */
function music(text: string): string {
  return text
    .split("\n")
    .slice(4)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?(\|:|:\||\|) ?/g, " $1 ")
    .replace(/ +\n/g, "\n")
    .trim();
}

function run(transform: string, body: string, args: unknown[] = [2], ranges: Range[] | null = null): string {
  const result = runTransform({ source: HEADER + body, transform, args, ranges });
  if (!result.ok) throw new Error(result.error);
  return music(result.value);
}

const multiply = (body: string, factor: number = 2, ranges: Range[] | null = null) => run("multiplyRhythmRebar", body, [factor], ranges);
const divide = (body: string, factor: number = 2, ranges: Range[] | null = null) => run("divideRhythmRebar", body, [factor], ranges);

describe("multiplyRhythmRebar", () => {
  it("doubles the lengths and cuts every bar into two bars of the meter's length", () => {
    expect(multiply("G2 G2 _B2 f2- | f4 g4 |\n")).to.equal("G4 G4 | _B4 f4- | f8 | g8 |");
  });

  it("ties a note that crosses the new bar line, and keeps the rest of the bar in the second one", () => {
    expect(multiply("G3 F3 G2 |\n")).to.equal("G6 F2- | F4 G4 |");
  });

  it("cuts a note that is longer than a bar into tied notes", () => {
    expect(multiply("d8 |\n")).to.equal("d8- | d8 |");
  });

  it("keeps the tie that a crossing note already had", () => {
    expect(multiply("A6- A2 |\n")).to.equal("A8- | A4- A4 |");
  });

  it("ties a chord that crosses the new bar line", () => {
    expect(multiply("[Acg]3 [Acg]3 z [Acg] |\n")).to.equal("[Acg]6 [Acg]2- | [Acg]4 z2 [Acg]2 |");
  });

  it("does not add a tie to a chord whose notes carry their own ties", () => {
    expect(multiply("[Acg]3 [A-c-g-]3 [Acg]2 |\n")).to.equal("[Acg]6 [A-c-g-]2 | [A-c-g-]4 [Acg]4 |");
  });

  it("cuts a rest that crosses the new bar line without a tie", () => {
    expect(multiply("z6 A2 |\n")).to.equal("z8 | z4 A4 |");
  });

  it("gives each chord change its own bar when the chords were half a bar long", () => {
    expect(multiply('[V:2] "Gm" x4 "Dm" x4 |\n')).to.equal('[V:2] "Gm" x8 | "Dm" x8 |');
  });

  it("repeats a one-bar multi-measure rest as many times as the factor, keeping the chord symbol on the first", () => {
    expect(multiply('[V:2] "F" X |\n')).to.equal('[V:2] "F" X | X |');
  });

  it("keeps a broken rhythm that does not cross the new bar line", () => {
    expect(multiply("e3/d/ z A- A>F Ac |\n")).to.equal("e3d z2 A2- | A2>F2 A2c2 |");
  });

  it("cuts notes that are written without spaces", () => {
    expect(multiply("fc_BG G3/F/ z G |\n")).to.equal("f2c2_B2G2 | G3F z2 G2 |");
  });

  it("cuts a bar into as many bars as a factor of three says", () => {
    expect(multiply("G2 G2 _B2 f2- |\n", 3)).to.equal("G6 G2- | G4 _B4- | _B2 f6- |");
  });

  it("changes only the bars that the selection touches", () => {
    const second: Range = { start: { line: 5, character: 0 }, end: { line: 5, character: 100 } };
    expect(multiply("G2 G2 _B2 f2- |\nA2 A2 c2 g2- |\n", 2, [second])).to.equal("G2 G2 _B2 f2- |\nA4 A4 | c4 g4- |");
  });

  it("stops with a message when the new bar line would fall inside a tuplet", () => {
    expect(() => multiply("c2 c (3ccc c2 c |\n")).to.throw(/tuplet/);
  });

  it("stops with a message when the factor is not a whole number", () => {
    expect(() => multiply("G2 G2 |\n", 1.5)).to.throw(/whole number/);
  });
});

describe("divideRhythmRebar", () => {
  it("halves the lengths and merges every two bars into one", () => {
    expect(divide("G4 G4 | _B4 f4- | f8 | g8 |\n")).to.equal("G2 G2 _B2 f2- | f4 g4 |");
  });

  it("joins the tied notes that the removed bar line separated", () => {
    expect(divide("G6 F2- | F4 G4 |\n")).to.equal("G3 F3 G2 |");
  });

  it("joins tied chords", () => {
    expect(divide("[Acg]6 [Acg]2- | [Acg]4 z2 [Acg]2 |\n")).to.equal("[Acg]3 [Acg]3 z [Acg] |");
  });

  it("keeps two chord changes of the chord line, now half a bar each", () => {
    expect(divide('[V:2] "Gm" x8 | "Dm" x8 |\n')).to.equal('[V:2] "Gm" x4 "Dm" x4 |');
  });

  it("merges the bars of rest that a multiplication made", () => {
    expect(divide('[V:2] "F" X | X |\n')).to.equal('[V:2] "F" X |');
  });

  it("leaves the last bar alone when the bars are not a multiple of the factor", () => {
    expect(divide("G4 G4 | _B4 f4 | c8 |\n")).to.equal("G2 G2 _B2 f2 | c4 |");
  });

  it("never merges across a repeat sign", () => {
    expect(divide("|: G4 G4 :| _B4 f4 |\n")).to.equal("|: G2 G2 :| _B2 f2 |");
  });

  it("never merges bars of different lines", () => {
    expect(divide("G4 G4 |\n_B4 f4 |\n")).to.equal("G2 G2 |\n_B2 f2 |");
  });

  it("stops with a message when two bars of rest carry different chord symbols", () => {
    expect(() => divide('[V:2] "F" X | "Dm" X |\n')).to.throw(/annotations/);
  });

  it("stops with a message when the factor is not a whole number", () => {
    expect(() => divide("G4 G4 |\n", 0)).to.throw(/whole number/);
  });
});

describe("multiplyRhythmRebar followed by divideRhythmRebar", () => {
  const tunes: Record<string, string> = {
    "plain bars": "G2 G2 _B2 f2- | f4 g4 |\n",
    "notes that cross the half bar": "G3 F3 G2 | G3 F3 G2 |\n",
    "a note longer than a bar": "d8 | d8 |\n",
    "chords and rests": "[Acg]3 [Acg]3 z [Acg] | z [Acg]3 z [Acg] z [Acg] |\n",
    "chords with their own ties": "[Acg]3 [A-c-g-]3 [Acg]2 | [Acg][Acg] z [Acg] z [Acg]3 |\n",
    "chord symbols and rests": '[V:2] "Gm" x4 "Dm" x4 | "F" X | "Dsus" D8 | X |\n',
    "a broken rhythm": "e3/d/ z A- A>F Ac | G8 |\n",
    "notes without spaces": "fc_BG G3/F/ z G | e8 |\n",
    "a tie across the bar line": "A8- | A8 | c8 |\n",
  };

  for (const [name, body] of Object.entries(tunes)) {
    it(`gives back the original music: ${name}`, () => {
      const doubled = runTransform({ source: HEADER + body, transform: "multiplyRhythmRebar", args: [2], ranges: null });
      if (!doubled.ok) throw new Error(doubled.error);
      const back = runTransform({ source: doubled.value, transform: "divideRhythmRebar", args: [2], ranges: null });
      if (!back.ok) throw new Error(back.error);
      expect(music(back.value)).to.equal(music(HEADER + body));
    });
  }
});
