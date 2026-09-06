import { expect } from "chai";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { GridToken, gridTokensToText, textToGridTokens } from "./gridNotation";

function chord(partial: Partial<ParsedChord>): ParsedChord {
  return {
    root: KeyRoot.C,
    rootAccidental: KeyAccidental.None,
    quality: ChordQuality.Dominant,
    qualityExplicit: false,
    extension: null,
    alterations: [],
    bass: null,
    ...partial,
  };
}

describe("iReal grid notation", () => {
  it("round-trips a simple chord/bar sequence", () => {
    const tokens: GridToken[] = [
      { type: "chord", chord: chord({ quality: ChordQuality.Major, qualityExplicit: true, extension: 7 }) },
      { type: "bar" },
      { type: "chord", chord: chord({ root: KeyRoot.D, quality: ChordQuality.Minor, qualityExplicit: true, extension: 7 }) },
      { type: "bar" },
    ];
    const text = gridTokensToText(tokens);
    expect(textToGridTokens(text)).to.deep.equal(tokens);
  });

  it("round-trips N.C. and repeat-bar tokens", () => {
    const tokens: GridToken[] = [{ type: "chord", chord: chord({ extension: 7 }) }, { type: "bar" }, { type: "noChord" }, { type: "bar" }, { type: "repeatBar" }, { type: "bar" }];
    expect(textToGridTokens(gridTokensToText(tokens))).to.deep.equal(tokens);
  });

  it("parses bars glued directly to a chord with no space", () => {
    expect(textToGridTokens("|C-7|G7|")).to.deep.equal([
      { type: "bar" },
      { type: "chord", chord: chord({ quality: ChordQuality.Minor, qualityExplicit: true, extension: 7 }) },
      { type: "bar" },
      { type: "chord", chord: chord({ root: KeyRoot.G, extension: 7 }) },
      { type: "bar" },
    ]);
  });

  it("skips an unrecognized cell rather than throwing", () => {
    expect(() => textToGridTokens("C7 *A G7")).to.not.throw();
  });
});
