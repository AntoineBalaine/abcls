import { expect } from "chai";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
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
    // "r" (repeat-previous-two-bars) is still not implemented — a
    // genuinely unrecognized cell, unlike "*A" below.
    expect(() => textToGridTokens("C7 r G7")).to.not.throw();
  });

  it("recognizes a section label as its own token, not dropped or glued to the next chord", () => {
    expect(textToGridTokens("C7 *A G7")).to.deep.equal([
      { type: "chord", chord: chord({ extension: 7 }) },
      { type: "sectionLabel", label: "A" },
      { type: "chord", chord: chord({ root: KeyRoot.G, extension: 7 }) },
    ]);
  });

  it("recognizes a section label glued directly to the following chord", () => {
    // Real charts commonly glue a section label straight onto the first
    // chord of that section with no separating space (e.g. "*AC-7").
    expect(textToGridTokens("*AC-7")).to.deep.equal([
      { type: "sectionLabel", label: "A" },
      { type: "chord", chord: chord({ quality: ChordQuality.Minor, qualityExplicit: true, extension: 7 }) },
    ]);
  });
});
