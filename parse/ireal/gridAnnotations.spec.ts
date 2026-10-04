import { expect } from "chai";
import { cleanGridText } from "./gridAnnotations";

describe("cleanGridText", () => {
  it("converts section-grouping brackets to bar separators", () => {
    expect(cleanGridText("[C |D7]")).to.equal("|C |D7|");
  });

  it("removes comments", () => {
    expect(cleanGridText("C <a comment> D7")).to.equal("C  D7");
  });

  it("removes alternative chords in parentheses", () => {
    expect(cleanGridText("C(D7) G7")).to.equal("C G7");
  });

  it("keeps section labels, rewritten to an isolated sentinel cell", () => {
    // A musician reading the chart wants to see "A section starts here"
    // the same way iReal Pro itself shows it — dropping the label
    // silently lost real structural information.
    expect(cleanGridText("*AC |*BD7")).to.equal(" §A§ C | §B§ D7");
  });

  it("removes time signatures", () => {
    expect(cleanGridText("T44C |D7")).to.equal("C |D7");
  });

  it("removes fermata markers", () => {
    expect(cleanGridText("Cf |D7")).to.equal("C |D7");
  });

  it("removes the layout marker 'l', but keeps it in an altered-dominant 'alt' suffix", () => {
    expect(cleanGridText("lC |D7")).to.equal("C |D7");
    expect(cleanGridText("C7alt |D7")).to.equal("C7alt |D7");
  });

  it("removes the 'small' marker, but keeps it in 'sus' chords", () => {
    expect(cleanGridText("sC |D7")).to.equal("C |D7");
    expect(cleanGridText("Csus |D7")).to.equal("Csus |D7");
  });

  it("treats hold/sustain comma padding as whitespace", () => {
    expect(cleanGridText("D9,   |C,")).to.equal("D9    |C ");
  });

  it("removes the end-of-song marker", () => {
    expect(cleanGridText("C |D7 Z")).to.equal("C |D7 ");
  });

  it("removes vertical-alignment spacer characters", () => {
    expect(cleanGridText("C |YYY D7")).to.equal("C | D7");
  });

  describe("simple repeat sections", () => {
    it("plays a bracketed section twice", () => {
      expect(cleanGridText("A |{C |D7}| E")).to.equal("A |C |D7|C |D7| E");
    });

    it("doesn't add a spurious leading bar when the repeat starts the chart", () => {
      expect(cleanGridText("{C |D7}| E")).to.equal("C |D7|C |D7| E");
    });
  });

  describe("first/second-ending repeats", () => {
    it("plays the common material once before each ending", () => {
      // "{C |N1D7}G7|N2E7": common = "C |", first ending = "D7", second
      // ending = "E7" — expands to the common material before each.
      expect(cleanGridText("{C |N1D7}G7|N2E7")).to.equal("C |D7G7|C |E7");
    });
  });

  describe("coda jumps", () => {
    it("removes a single coda marker with no further structure", () => {
      expect(cleanGridText("A |QB |C")).to.equal("A |B |C");
    });

    it("plays from the segno through the first coda, then jumps to after the second", () => {
      // "A SB |QC |D QE": repeat = everything between the segno and the
      // first coda marker ("B |"), reinserted right before that marker;
      // everything after the second coda marker ("E") is appended after.
      expect(cleanGridText("A SB |QC |D QE")).to.equal("A B |C |D B |E");
    });
  });
});
