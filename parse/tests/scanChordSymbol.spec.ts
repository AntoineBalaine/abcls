import { expect } from "chai";
import { isChordSymbolText, scanChordSymbol } from "../music-theory/scanChordSymbol";
import { ChordTT } from "../music-theory/types";

function ROOT(lexeme: string) {
  return { type: ChordTT.ROOT, lexeme };
}
function ACCIDENTAL(lexeme: string) {
  return { type: ChordTT.ACCIDENTAL, lexeme };
}
function QUALITY(lexeme: string) {
  return { type: ChordTT.QUALITY, lexeme };
}
function EXTENSION(lexeme: string) {
  return { type: ChordTT.EXTENSION, lexeme };
}
function ALTERATION(lexeme: string) {
  return { type: ChordTT.ALTERATION, lexeme };
}
function BASS_SLASH() {
  return { type: ChordTT.BASS_SLASH, lexeme: "/" };
}

describe("scanChordSymbol", () => {
  describe("jazz symbols", () => {
    it('scans "F▵", the major seventh triangle, as a quality', () => {
      expect(scanChordSymbol("F▵")).to.deep.equal({ tokens: [ROOT("F"), QUALITY("▵")], consumed: 2 });
    });

    it('scans "FΔ7" and "F△7" like "F▵7"', () => {
      expect(scanChordSymbol("FΔ7")!.tokens).to.deep.equal([ROOT("F"), QUALITY("Δ"), EXTENSION("7")]);
      expect(scanChordSymbol("F△7")!.tokens).to.deep.equal([ROOT("F"), QUALITY("△"), EXTENSION("7")]);
    });

    it('scans "A⁷" with a superscript seven as the extension 7, and counts the source characters', () => {
      expect(scanChordSymbol("A⁷")).to.deep.equal({ tokens: [ROOT("A"), EXTENSION("7")], consumed: 2 });
    });

    it('scans "C#⁷#11" with a superscript extension followed by an alteration', () => {
      expect(scanChordSymbol("C#⁷#11")).to.deep.equal({ tokens: [ROOT("C"), ACCIDENTAL("#"), EXTENSION("7"), ALTERATION("#11")], consumed: 6 });
    });

    it("scans every superscript digit as the plain digit of the same value", () => {
      const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
      for (let value = 0; value <= 9; value++) {
        expect(scanChordSymbol(`C${superscripts[value]}`)).to.deep.equal({ tokens: [ROOT("C"), EXTENSION(String(value))], consumed: 2 });
      }
    });

    it('scans multi-digit superscripts such as "C¹¹" and "C¹³" as one extension', () => {
      expect(scanChordSymbol("C¹¹")).to.deep.equal({ tokens: [ROOT("C"), EXTENSION("11")], consumed: 3 });
      expect(scanChordSymbol("C¹³")!.tokens).to.deep.equal([ROOT("C"), EXTENSION("13")]);
    });

    it('scans a superscript degree in an alteration, as in "C⁷b⁹" and "C⁷#⁵"', () => {
      expect(scanChordSymbol("C⁷b⁹")).to.deep.equal({ tokens: [ROOT("C"), EXTENSION("7"), ALTERATION("b9")], consumed: 4 });
      expect(scanChordSymbol("C⁷#⁵")!.tokens).to.deep.equal([ROOT("C"), EXTENSION("7"), ALTERATION("#5")]);
    });

    it('scans "Db▵#5" and "F▵/E" with their alteration and bass', () => {
      expect(scanChordSymbol("Db▵#5")!.consumed).to.equal(5);
      expect(scanChordSymbol("F▵/E")!.consumed).to.equal(4);
    });
  });

  describe("combined quality symbols", () => {
    // Each of these names one quality rather than two, so it has to be
    // matched whole; matching only its first character leaves the "^" for
    // the extension rule, which is what used to corrupt the chord.
    it('scans "C-^7", the minor-major seventh', () => {
      expect(scanChordSymbol("C-^7")).to.deep.equal({ tokens: [ROOT("C"), QUALITY("-^"), EXTENSION("7")], consumed: 4 });
    });

    it('scans "Dbo^7", the diminished major seventh', () => {
      expect(scanChordSymbol("Dbo^7")).to.deep.equal({ tokens: [ROOT("D"), ACCIDENTAL("b"), QUALITY("o^"), EXTENSION("7")], consumed: 5 });
    });
  });

  describe("basic chords", () => {
    it('scans "C"', () => {
      const result = scanChordSymbol("C");
      expect(result).to.deep.equal({
        tokens: [ROOT("C")],
        consumed: 1,
      });
    });

    it('scans "Am"', () => {
      const result = scanChordSymbol("Am");
      expect(result).to.deep.equal({
        tokens: [ROOT("A"), QUALITY("m")],
        consumed: 2,
      });
    });

    it('scans "G7"', () => {
      const result = scanChordSymbol("G7");
      expect(result).to.deep.equal({
        tokens: [ROOT("G"), EXTENSION("7")],
        consumed: 2,
      });
    });
  });

  describe("accidentals", () => {
    it('scans "F#m7"', () => {
      const result = scanChordSymbol("F#m7");
      expect(result).to.deep.equal({
        tokens: [ROOT("F"), ACCIDENTAL("#"), QUALITY("m"), EXTENSION("7")],
        consumed: 4,
      });
    });

    it('scans "Bb/D"', () => {
      const result = scanChordSymbol("Bb/D");
      expect(result).to.deep.equal({
        tokens: [ROOT("B"), ACCIDENTAL("b"), BASS_SLASH(), ROOT("D")],
        consumed: 4,
      });
    });
  });

  describe("qualities", () => {
    it('scans "Cmaj7"', () => {
      const result = scanChordSymbol("Cmaj7");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("maj"), EXTENSION("7")],
        consumed: 5,
      });
    });

    it('scans "Cmaj" (quality without extension)', () => {
      const result = scanChordSymbol("Cmaj");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("maj")],
        consumed: 4,
      });
    });

    it('scans "C°7" (diminished)', () => {
      const result = scanChordSymbol("C°7");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("°"), EXTENSION("7")],
        consumed: 3,
      });
    });

    it('scans "Cø7" (half-diminished)', () => {
      const result = scanChordSymbol("Cø7");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("ø"), EXTENSION("7")],
        consumed: 3,
      });
    });

    it('scans "C+" (augmented)', () => {
      const result = scanChordSymbol("C+");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("+")],
        consumed: 2,
      });
    });
  });

  describe("suspended chords", () => {
    it('scans "Csus2"', () => {
      const result = scanChordSymbol("Csus2");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("sus2")],
        consumed: 5,
      });
    });

    it('scans "Csus4"', () => {
      const result = scanChordSymbol("Csus4");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("sus4")],
        consumed: 5,
      });
    });

    it('scans "Csus" (defaults to sus4 in parser)', () => {
      const result = scanChordSymbol("Csus");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("sus")],
        consumed: 4,
      });
    });
  });

  describe("alterations", () => {
    it('scans "Dm7b5"', () => {
      const result = scanChordSymbol("Dm7b5");
      expect(result).to.deep.equal({
        tokens: [ROOT("D"), QUALITY("m"), EXTENSION("7"), ALTERATION("b5")],
        consumed: 5,
      });
    });

    it('scans "Cmaj7#11"', () => {
      const result = scanChordSymbol("Cmaj7#11");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("maj"), EXTENSION("7"), ALTERATION("#11")],
        consumed: 8,
      });
    });

    it('scans "C7#9#11" (multiple alterations)', () => {
      const result = scanChordSymbol("C7#9#11");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), EXTENSION("7"), ALTERATION("#9"), ALTERATION("#11")],
        consumed: 7,
      });
    });
  });

  describe("add chords", () => {
    it('scans "Cadd9"', () => {
      const result = scanChordSymbol("Cadd9");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), QUALITY("add"), EXTENSION("9")],
        consumed: 5,
      });
    });
  });

  describe("power chords", () => {
    it('scans "C5"', () => {
      const result = scanChordSymbol("C5");
      expect(result).to.deep.equal({
        tokens: [ROOT("C"), EXTENSION("5")],
        consumed: 2,
      });
    });
  });

  describe("case insensitivity", () => {
    it('scans "am7" (lowercase root normalized to uppercase)', () => {
      const result = scanChordSymbol("am7");
      expect(result).to.deep.equal({
        tokens: [ROOT("A"), QUALITY("m"), EXTENSION("7")],
        consumed: 3,
      });
    });
  });

  describe("partial consumption", () => {
    it('scans "Am7xyz" (partial consumption)', () => {
      const result = scanChordSymbol("Am7xyz");
      expect(result).to.not.be.null;
      expect(result!.consumed).to.equal(3);
      expect(result!.tokens).to.deep.equal([ROOT("A"), QUALITY("m"), EXTENSION("7")]);
    });
  });

  describe("invalid inputs", () => {
    it('returns null for "xyz" (no root)', () => {
      expect(scanChordSymbol("xyz")).to.be.null;
    });

    it('returns null for "" (empty)', () => {
      expect(scanChordSymbol("")).to.be.null;
    });
  });

  describe("property: token lexemes concatenate to consumed portion", () => {
    const testCases = ["C", "Am", "G7", "F#m7", "Cmaj7", "Dm7b5", "Bb/D", "C+", "Csus4", "Cadd9"];

    for (const chord of testCases) {
      it(`lexemes concatenate for "${chord}"`, () => {
        const result = scanChordSymbol(chord);
        expect(result).to.not.be.null;
        const concatenated = result!.tokens.map((t) => t.lexeme).join("");
        const consumed = chord.substring(0, result!.consumed);
        expect(concatenated).to.equal(consumed);
      });
    }
  });
});

describe("isChordSymbolText", () => {
  for (const text of ["C", "Am7", "Bbmaj7", "F#m7b5", "G7/B", "Cdim7"]) {
    it(`accepts "${text}", which reads as a chord to its end`, () => {
      expect(isChordSymbolText(text)).to.equal(true);
    });
  }

  for (const text of ["Fine", "Coda", "Allegro", "D.C. al Fine", "Am7 rit."]) {
    it(`refuses "${text}", whose beginning only reads as a chord`, () => {
      expect(isChordSymbolText(text)).to.equal(false);
    });
  }
});
