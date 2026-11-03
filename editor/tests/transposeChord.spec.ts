import { isChordSymbolText } from "abcls-parser/music-theory/scanChordSymbol";
import { expect } from "chai";
import { describe, it } from "mocha";
import { transposeChordText } from "../src/transforms/transposeChord";

describe("transposeChordText", () => {
  it("moves the root by the steps of the interval, so Bb goes to Ab when F major goes to Eb major", () => {
    expect(transposeChordText("Bb▵", -2, -1)).to.equal("Ab▵");
  });

  it("spells the sharp roots by interval, so F#m goes to Em and A#° goes to G#°", () => {
    expect(transposeChordText("F#m", -2, -1)).to.equal("Em");
    expect(transposeChordText("A#°", -2, -1)).to.equal("G#°");
  });

  it("transposes the bass note with the same interval and keeps the rest of the symbol", () => {
    expect(transposeChordText("D7#5/Ab", -2, -1)).to.equal("C7#5/Gb");
    expect(transposeChordText("Dm/C", -2, -1)).to.equal("Cm/Bb");
    expect(transposeChordText("B⁷#5", -2, -1)).to.equal("A⁷#5");
  });

  it("falls back on flat names going down and sharp names going up when the steps are unknown", () => {
    expect(transposeChordText("C", -2, null)).to.equal("Bb");
    expect(transposeChordText("C", 1, null)).to.equal("C#");
  });

  it("returns null for a text that is not a chord symbol", () => {
    expect(transposeChordText("simil.", -2, -1)).to.equal(null);
    expect(isChordSymbolText("Gsus")).to.equal(true);
  });
});
