import { expect } from "chai";
import * as fc from "fast-check";
import { KIND_BY_QUALITY, parseChordSymbol, parseDegrees } from "./chordSymbols";

const ROOTS = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: Array<[string, number | undefined]> = [
  ["", undefined],
  ["#", 1],
  ["b", -1],
];

describe("parseChordSymbol", () => {
  describe("examples", () => {
    it("parses a plain major triad", () => {
      expect(parseChordSymbol("C")).to.deep.equal({ rootStep: "C", kind: "major", kindText: "" });
    });

    it("parses a flat root with a minor seventh", () => {
      expect(parseChordSymbol("Bbm7")).to.deep.equal({ rootStep: "B", rootAlter: -1, kind: "minor-seventh", kindText: "m7" });
    });

    it("prefers the longest quality, so m7b5 is half-diminished rather than m7 plus a degree", () => {
      expect(parseChordSymbol("Em7b5")!.kind).to.equal("half-diminished");
    });

    it("parses a slash chord's bass note and its accidental", () => {
      const harmony = parseChordSymbol("Ebmaj7/Bb")!;
      expect(harmony.kind).to.equal("major-seventh");
      expect(harmony.bassStep).to.equal("B");
      expect(harmony.bassAlter).to.equal(-1);
    });

    it("parses double accidentals on the root and the bass", () => {
      const harmony = parseChordSymbol("Fbb/C##")!;
      expect(harmony.kind).to.equal("major");
      expect(harmony.rootAlter).to.equal(-2);
      expect(harmony.bassAlter).to.equal(2);
    });

    it("parses several parenthesised groups, as opensheetmusicdisplay writes them", () => {
      expect(parseChordSymbol("B7(#9)(alt #5)")!.degrees).to.deep.equal([
        { value: 9, alter: 1, type: "add" },
        { value: 5, alter: 1, type: "alter" },
      ]);
    });

    it("parses parenthesised additions as add degrees", () => {
      expect(parseChordSymbol("G7(b9,#11)")!.degrees).to.deep.equal([
        { value: 9, alter: -1, type: "add" },
        { value: 11, alter: 1, type: "add" },
      ]);
    });

    it("treats a bare altered fifth as an alteration of the chord's fifth", () => {
      expect(parseChordSymbol("C7b5")!.degrees).to.deep.equal([{ value: 5, alter: -1, type: "alter" }]);
    });

    it("parses add, omit and alt prefixes", () => {
      expect(parseChordSymbol("Cadd9")!.degrees).to.deep.equal([{ value: 9, alter: 0, type: "add" }]);
      expect(parseChordSymbol("C7(omit 3)")!.degrees).to.deep.equal([{ value: 3, alter: 0, type: "subtract" }]);
      expect(parseChordSymbol("C7(alt #5)")!.degrees).to.deep.equal([{ value: 5, alter: 1, type: "alter" }]);
    });

    it("writes N.C. as kind none with an empty root text, because the schema requires a root", () => {
      expect(parseChordSymbol("N.C.")).to.deep.equal({ rootStep: "C", rootText: "", kind: "none", kindText: "N.C." });
    });

    it("keeps an unknown suffix made of chord vocabulary as kind other", () => {
      expect(parseChordSymbol("C7sus4")).to.deep.equal({ rootStep: "C", kind: "other", kindText: "7sus4" });
    });

    it("returns null for plain words that happen to start with a root letter", () => {
      for (const word of ["Allegro", "Coda", "Dolce", "Fine", "D.C. al Fine", "Bridge"]) {
        expect(parseChordSymbol(word), word).to.equal(null);
      }
    });

    it("returns null for positioned annotations", () => {
      for (const text of ["^allegro", "_dolce", "<left", ">right", "@1,2 text"]) {
        expect(parseChordSymbol(text), text).to.equal(null);
      }
    });
  });

  describe("properties", () => {
    const genRoot = fc.tuple(fc.constantFrom(...ROOTS), fc.constantFrom(...ACCIDENTALS));
    const genQuality = fc.constantFrom(...Object.keys(KIND_BY_QUALITY));

    it("maps every quality in the table to its kind, for every root and optional bass", () => {
      fc.assert(
        fc.property(genRoot, genQuality, fc.option(genRoot, { nil: undefined }), ([step, [accidental, alter]], quality, bass) => {
          const bassText = bass ? `/${bass[0]}${bass[1][0]}` : "";
          const harmony = parseChordSymbol(`${step}${accidental}${quality}${bassText}`);
          expect(harmony).to.not.equal(null);
          expect(harmony!.rootStep).to.equal(step);
          expect(harmony!.rootAlter).to.equal(alter);
          expect(harmony!.kind).to.equal(KIND_BY_QUALITY[quality]);
          expect(harmony!.kindText).to.equal(quality);
          expect(harmony!.bassStep).to.equal(bass?.[0]);
          expect(harmony!.bassAlter).to.equal(bass?.[1][1]);
        })
      );
    });

    it("never treats text with a position prefix as a chord symbol", () => {
      fc.assert(
        fc.property(fc.constantFrom("^", "_", "<", ">", "@"), fc.string(), (prefix, text) => {
          expect(parseChordSymbol(prefix + text)).to.equal(null);
        })
      );
    });
  });
});

describe("parseDegrees", () => {
  it("returns null when the text holds anything besides degrees", () => {
    expect(parseDegrees("(b9) and more")).to.equal(null);
    expect(parseDegrees("")).to.equal(null);
  });

  it("accepts degrees separated by commas or spaces", () => {
    expect(parseDegrees("(b9 #11)")).to.have.length(2);
    expect(parseDegrees("b9,#11")).to.have.length(2);
  });
});
