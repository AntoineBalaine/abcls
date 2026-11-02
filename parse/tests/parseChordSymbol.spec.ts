import { expect } from "chai";
import { parseChordSymbol } from "../music-theory/parseChordSymbol";
import { scanChordSymbol } from "../music-theory/scanChordSymbol";
import { ChordQuality } from "../music-theory/types";
import { KeyRoot, KeyAccidental } from "../types/abcjs-ast";

function parse(input: string) {
  const scanResult = scanChordSymbol(input);
  if (!scanResult) return null;
  return parseChordSymbol(scanResult.tokens);
}

describe("parseChordSymbol", () => {
  describe("jazz symbols", () => {
    it('parses "F▵" as the major seventh chord, because the triangle implies the seventh', () => {
      const result = parse("F▵");
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });

    it('parses "F▵9" with its own extension, without forcing the seventh', () => {
      expect(parse("F▵9")!.extension).to.equal(9);
    });

    it('parses "A⁷" as the dominant seventh chord', () => {
      const result = parse("A⁷");
      expect(result!.quality).to.equal(ChordQuality.Dominant);
      expect(result!.extension).to.equal(7);
    });

    it('parses "C⁹", "C¹¹" and "C¹³" as dominant chords with that extension', () => {
      for (const [text, extension] of [["C⁹", 9], ["C¹¹", 11], ["C¹³", 13]] as const) {
        const result = parse(text);
        expect(result!.quality).to.equal(ChordQuality.Dominant);
        expect(result!.extension).to.equal(extension);
      }
    });

    it('parses "C⁷b⁹" with a superscript alteration', () => {
      expect(parse("C⁷b⁹")!.alterations).to.deep.equal([{ type: "flat", degree: 9 }]);
    });

    it('parses "B⁷#5" with its alteration', () => {
      const result = parse("B⁷#5");
      expect(result!.extension).to.equal(7);
      expect(result!.alterations).to.deep.equal([{ type: "sharp", degree: 5 }]);
    });

    it('parses "Db▵#5/Ab" with root, accidental, alteration and bass', () => {
      const result = parse("Db▵#5/Ab");
      expect(result!.rootAccidental).to.equal(KeyAccidental.Flat);
      expect(result!.extension).to.equal(7);
      expect(result!.bass).to.deep.equal({ root: KeyRoot.A, accidental: KeyAccidental.Flat });
    });
  });

  describe("basic chords", () => {
    it('parses "C"', () => {
      const result = parse("C");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.C);
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.qualityExplicit).to.be.false;
      expect(result!.extension).to.be.null;
    });

    it('parses "Am"', () => {
      const result = parse("Am");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.A);
      expect(result!.quality).to.equal(ChordQuality.Minor);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.be.null;
    });

    it('parses "G7" (dominant inferred)', () => {
      const result = parse("G7");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.G);
      expect(result!.quality).to.equal(ChordQuality.Dominant);
      expect(result!.qualityExplicit).to.be.false;
      expect(result!.extension).to.equal(7);
    });
  });

  describe("major chords with explicit quality", () => {
    it('parses "Cmaj7" (stays Major, not Dominant)', () => {
      const result = parse("Cmaj7");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.C);
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });

    it('parses "Cmaj9" (stays Major, not Dominant)', () => {
      const result = parse("Cmaj9");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(9);
    });

    it('parses "Cmaj" (quality without extension)', () => {
      const result = parse("Cmaj");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.be.null;
    });
  });

  describe("minor chords", () => {
    it('parses "Cm7"', () => {
      const result = parse("Cm7");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.C);
      expect(result!.quality).to.equal(ChordQuality.Minor);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });
  });

  describe("power chords", () => {
    it('parses "C5"', () => {
      const result = parse("C5");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Power);
      expect(result!.qualityExplicit).to.be.false;
      expect(result!.extension).to.equal(5);
    });
  });

  describe("diminished and half-diminished", () => {
    it('parses "Cdim7"', () => {
      const result = parse("Cdim7");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Diminished);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });

    it('parses "Cø7"', () => {
      const result = parse("Cø7");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.HalfDiminished);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });
  });

  describe("alterations", () => {
    it('parses "Dm7b5"', () => {
      const result = parse("Dm7b5");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.D);
      expect(result!.quality).to.equal(ChordQuality.Minor);
      expect(result!.extension).to.equal(7);
      expect(result!.alterations).to.deep.equal([{ type: "flat", degree: 5 }]);
    });
  });

  describe("suspended chords", () => {
    it('parses "Csus2"', () => {
      const result = parse("Csus2");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Suspended2);
      expect(result!.qualityExplicit).to.be.true;
    });

    it('parses "Csus4"', () => {
      const result = parse("Csus4");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Suspended4);
      expect(result!.qualityExplicit).to.be.true;
    });

    it('parses "Csus" (defaults to sus4)', () => {
      const result = parse("Csus");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Suspended4);
      expect(result!.qualityExplicit).to.be.true;
    });
  });

  describe("add chords", () => {
    it('parses "Cadd9"', () => {
      const result = parse("Cadd9");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Add);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(9);
    });

    it('parses "Cadd6"', () => {
      const result = parse("Cadd6");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Add);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(6);
    });

    it('parses "Cadd7" (unusual but valid)', () => {
      const result = parse("Cadd7");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Add);
      expect(result!.qualityExplicit).to.be.true;
      expect(result!.extension).to.equal(7);
    });
  });

  describe("augmented chords", () => {
    it('parses "C+"', () => {
      const result = parse("C+");
      expect(result).to.not.be.null;
      expect(result!.quality).to.equal(ChordQuality.Augmented);
      expect(result!.qualityExplicit).to.be.true;
    });
  });

  describe("accidentals", () => {
    it('parses "F#m7"', () => {
      const result = parse("F#m7");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.F);
      expect(result!.rootAccidental).to.equal(KeyAccidental.Sharp);
      expect(result!.quality).to.equal(ChordQuality.Minor);
      expect(result!.extension).to.equal(7);
    });

    it('parses "Bb/D"', () => {
      const result = parse("Bb/D");
      expect(result).to.not.be.null;
      expect(result!.root).to.equal(KeyRoot.B);
      expect(result!.rootAccidental).to.equal(KeyAccidental.Flat);
      expect(result!.quality).to.equal(ChordQuality.Major);
      expect(result!.bass).to.deep.equal({
        root: KeyRoot.D,
        accidental: KeyAccidental.None,
      });
    });
  });

  describe("invalid extensions", () => {
    it('returns null for "C3" (invalid extension)', () => {
      expect(parse("C3")).to.be.null;
    });

    it('returns null for "C99" (invalid extension)', () => {
      expect(parse("C99")).to.be.null;
    });

    it('returns null for "C0" (invalid extension)', () => {
      expect(parse("C0")).to.be.null;
    });
  });

  describe("integration tests", () => {
    const validChords = ["C", "Am", "G7", "Cmaj7", "Cm7", "Cdim7", "C+", "Csus4", "Cadd9", "F#m7", "Bb/D", "Cmaj7#11", "C7b9"];

    for (const chord of validChords) {
      it(`round-trip: scan + parse produces valid result for "${chord}"`, () => {
        const scanResult = scanChordSymbol(chord);
        expect(scanResult).to.not.be.null;
        const parseResult = parseChordSymbol(scanResult!.tokens);
        expect(parseResult).to.not.be.null;
      });
    }
  });
});
