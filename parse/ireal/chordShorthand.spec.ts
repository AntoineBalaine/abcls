import { expect } from "chai";
import fc from "fast-check";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { irealTextToParsedChord, parsedChordToAbcxText, parsedChordToIrealText } from "./chordShorthand";

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

describe("iReal chord shorthand", () => {
  describe("confirmed symbols (parsedChordToIrealText)", () => {
    it("major seventh uses ^", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Major, qualityExplicit: true, extension: 7 }))).to.equal("C^7");
    });
    it("minor uses -", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Minor, qualityExplicit: true, extension: 7 }))).to.equal("C-7");
    });
    it("dominant has no quality symbol", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Dominant, qualityExplicit: true, extension: 7 }))).to.equal("C7");
    });
    it("diminished uses o", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Diminished, qualityExplicit: true, extension: 7 }))).to.equal("Co7");
    });
    it("half-diminished uses h (Cm7b5 becomes Ch7)", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.HalfDiminished, qualityExplicit: true, extension: 7 }))).to.equal("Ch7");
    });
    it("augmented uses +", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Augmented, qualityExplicit: true, extension: 5 }))).to.equal("C+5");
    });
    it("sus4 and sus2 spell out the word", () => {
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Suspended4, qualityExplicit: true }))).to.equal("Csus4");
      expect(parsedChordToIrealText(chord({ quality: ChordQuality.Suspended2, qualityExplicit: true }))).to.equal("Csus2");
    });
    it("keeps a sus chord's extension, which is a degree and not the suspension", () => {
      const sus9 = { quality: ChordQuality.Suspended4, qualityExplicit: true, extension: 9 };
      expect(parsedChordToIrealText(chord(sus9))).to.equal("C9sus");
      expect(parsedChordToAbcxText(chord(sus9))).to.equal("Csus49");
      expect(irealTextToParsedChord("C9sus")?.extension).to.equal(9);
    });
    it("emits root accidentals and slash bass", () => {
      expect(
        parsedChordToIrealText(
          chord({
            root: KeyRoot.B,
            rootAccidental: KeyAccidental.Flat,
            quality: ChordQuality.Major,
            qualityExplicit: true,
            extension: 7,
            bass: { root: KeyRoot.D, accidental: KeyAccidental.None },
          })
        )
      ).to.equal("Bb^7/D");
    });
    it("emits alterations after the extension", () => {
      expect(
        parsedChordToIrealText(chord({ quality: ChordQuality.Dominant, qualityExplicit: true, extension: 7, alterations: [{ type: "flat", degree: 9 }] }))
      ).to.equal("C7b9");
    });
  });

  describe("round trip (irealTextToParsedChord after parsedChordToIrealText)", () => {
    const cases: ParsedChord[] = [
      chord({ quality: ChordQuality.Major, qualityExplicit: true, extension: 7 }),
      chord({ quality: ChordQuality.Minor, qualityExplicit: true, extension: 7 }),
      chord({ quality: ChordQuality.Diminished, qualityExplicit: true, extension: 7 }),
      chord({ quality: ChordQuality.HalfDiminished, qualityExplicit: true, extension: 7 }),
      chord({ quality: ChordQuality.Augmented, qualityExplicit: true, extension: 5 }),
      chord({ quality: ChordQuality.Suspended4, qualityExplicit: true }),
      chord({ quality: ChordQuality.Suspended2, qualityExplicit: true }),
      chord({
        root: KeyRoot.B,
        rootAccidental: KeyAccidental.Flat,
        quality: ChordQuality.Major,
        qualityExplicit: true,
        extension: 7,
        bass: { root: KeyRoot.D, accidental: KeyAccidental.None },
      }),
      chord({ quality: ChordQuality.Dominant, qualityExplicit: true, extension: 7, alterations: [{ type: "flat", degree: 9 }] }),
      chord({ quality: ChordQuality.Power, qualityExplicit: true }),
    ];

    for (const c of cases) {
      it(`round-trips ${parsedChordToIrealText(c)}`, () => {
        const text = parsedChordToIrealText(c);
        const reparsed = irealTextToParsedChord(text);
        expect(reparsed).to.not.be.null;
        // Dominant chords have no distinct iReal symbol, so qualityExplicit
        // cannot be recovered from text alone for that one quality; every
        // other quality's explicitness is fully recoverable.
        const expected = c.quality === ChordQuality.Dominant ? { ...c, qualityExplicit: false } : c;
        expect(reparsed).to.deep.equal(expected);
      });
    }
  });

  describe("property-based: ParsedChord generated directly", () => {
    // KeyRoot also includes HP/Hp (bagpipe key notation), never valid as a
    // chord symbol root; restrict to the seven real note letters.
    const rootArb = fc.constantFrom(KeyRoot.A, KeyRoot.B, KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G);
    const accArb = fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat);
    const qualityArb = fc.constantFrom(
      ChordQuality.Major,
      ChordQuality.Minor,
      ChordQuality.Dominant,
      ChordQuality.Diminished,
      ChordQuality.Augmented,
      ChordQuality.HalfDiminished,
      ChordQuality.Suspended2,
      ChordQuality.Suspended4
    );
    const extensionArb = fc.constantFrom(null, 5, 6, 7, 9, 11, 13);
    const chordArb = fc
      .record({
        root: rootArb,
        rootAccidental: accArb,
        quality: qualityArb,
        extension: extensionArb,
        bass: fc.option(fc.record({ root: rootArb, accidental: accArb }), { nil: null }),
      })
      .map(
        (r): ParsedChord => ({
          ...r,
          qualityExplicit: true,
          alterations: [],
        })
      );

    it("round-trips arbitrary confirmed-quality chords with no alterations", () => {
      fc.assert(
        fc.property(chordArb, (c) => {
          // sus2/sus4 do not carry an extension in this mapping's convention.
          // A Dominant chord with extension exactly 5 and no other symbol
          // serializes to the same text ("A5") as a Power chord, an inherent
          // collision in the shorthand itself (see CHORD_TEXT_PATTERN's "5"
          // alternative), not something either direction can recover from
          // text alone; excluded from this fidelity claim the same way
          // Dominant's own qualityExplicit is already excluded below.
          const normalized: ParsedChord =
            c.quality === ChordQuality.Suspended2 || c.quality === ChordQuality.Suspended4
              ? { ...c, extension: null }
              : c.quality === ChordQuality.Dominant && c.extension === 5
                ? { ...c, extension: 7 }
                : c;
          const text = parsedChordToIrealText(normalized);
          const reparsed = irealTextToParsedChord(text);
          const expected = normalized.quality === ChordQuality.Dominant ? { ...normalized, qualityExplicit: false } : normalized;
          expect(reparsed).to.deep.equal(expected);
        })
      );
    });
  });

  it("returns null for unparseable text", () => {
    expect(irealTextToParsedChord("not a chord")).to.be.null;
  });

  describe("real-world sus chord text (extension before 'sus', not after)", () => {
    // Confirmed against real charts in a user's iReal Pro library
    // backup: a sus chord's extension digit is written *before* "sus"
    // ("G7sus", "A9sus"), and a bare sus triad has no trailing "2"/"4"
    // at all ("Csus") — the opposite ordering, and a stricter form, than
    // CHORD_TEXT_PATTERN's "sus2"/"sus4"-then-extension assumption.
    it('parses a bare "sus" (no digit) as sus4', () => {
      expect(irealTextToParsedChord("Csus")).to.deep.equal({
        root: "C",
        rootAccidental: "",
        quality: ChordQuality.Suspended4,
        qualityExplicit: true,
        extension: null,
        alterations: [],
        bass: null,
      });
    });

    it('parses "<extension>sus" as that extension with sus4', () => {
      expect(irealTextToParsedChord("G7sus")).to.deep.equal({
        root: "G",
        rootAccidental: "",
        quality: ChordQuality.Suspended4,
        qualityExplicit: true,
        extension: 7,
        alterations: [],
        bass: null,
      });
      expect(irealTextToParsedChord("A9sus")?.extension).to.equal(9);
    });

    it('parses "<extension>sus2" with the explicit sus2 quality', () => {
      const parsed = irealTextToParsedChord("C7sus2");
      expect(parsed?.quality).to.equal(ChordQuality.Suspended2);
      expect(parsed?.extension).to.equal(7);
    });

    it("still parses alterations and a slash bass after the sus", () => {
      const parsed = irealTextToParsedChord("G7sus#11/F");
      expect(parsed?.extension).to.equal(7);
      expect(parsed?.alterations).to.deep.equal([{ type: "sharp", degree: 11 }]);
      expect(parsed?.bass).to.deep.equal({ root: "F", accidental: "" });
    });
  });

  describe("real-world altered-dominant chord text ('alt', extension before the word)", () => {
    // Confirmed against real charts in a user's iReal Pro library backup
    // ("Dominant 7alt Workout", "Hindsight"): same before-the-word
    // ordering as sus chords ("C7alt", not "Calt7"), and a bare "alt"
    // with no extension at all.
    it('parses "<extension>alt" with the Altered quality', () => {
      const parsed = irealTextToParsedChord("C7alt");
      expect(parsed?.quality).to.equal(ChordQuality.Altered);
      expect(parsed?.extension).to.equal(7);
    });

    it('parses a bare "alt" (no extension)', () => {
      const parsed = irealTextToParsedChord("Calt");
      expect(parsed?.quality).to.equal(ChordQuality.Altered);
      expect(parsed?.extension).to.be.null;
    });

    it("still parses alterations and a slash bass after the alt", () => {
      const parsed = irealTextToParsedChord("C7alt#9/Bb");
      expect(parsed?.alterations).to.deep.equal([{ type: "sharp", degree: 9 }]);
      expect(parsed?.bass).to.deep.equal({ root: "B", accidental: "b" });
    });

    it('emits ABCx text with the quality word *before* the extension ("Calt7"), the opposite of iReal\'s own ordering', () => {
      // ABCx's chord-symbol grammar (parsers/scan_abcx_tunebody.ts's
      // pChordSymbol) expects quality-then-extension like every other
      // quality word, unlike iReal's own "extension-then-alt" shorthand.
      const parsed = irealTextToParsedChord("C7alt")!;
      expect(parsedChordToAbcxText(parsed)).to.equal("Calt7");
      expect(parsedChordToIrealText(parsed)).to.equal("C7alt");
    });
  });

  describe("components written in any order, which is what iReal Pro does", () => {
    // Measured against a real 657-chart library: of 25,181 chord lexemes
    // the grid scanner isolates, these are the shapes the previous
    // whole-string patterns rejected. All six are real music, and the
    // pattern across them is that iReal Pro fixes no order among a chord's
    // components, which is why the parser reads components positionally
    // rather than matching one of a few fixed orders.
    it("parses an alteration written between the extension and a trailing sus", () => {
      for (const text of ["G7b9sus", "Bb7b9sus", "A7b9sus"]) {
        const parsed = irealTextToParsedChord(text);
        expect(parsed, text).to.not.be.null;
        expect(parsed!.quality, text).to.equal(ChordQuality.Suspended4);
        expect(parsed!.extension, text).to.equal(7);
        expect(parsed!.alterations, text).to.deep.equal([{ type: "flat", degree: 9 }]);
      }
      expect(irealTextToParsedChord("G7b9sus")!.root).to.equal("G");
      expect(irealTextToParsedChord("Bb7b9sus")!.rootAccidental).to.equal("b");
    });

    it("parses an augmented symbol written after the extension", () => {
      for (const text of ["C7+", "D7+"]) {
        const parsed = irealTextToParsedChord(text);
        expect(parsed, text).to.not.be.null;
        expect(parsed!.quality, text).to.equal(ChordQuality.Augmented);
        expect(parsed!.extension, text).to.equal(7);
      }
    });

    it("parses two quality symbols combining into the diminished major seventh", () => {
      const parsed = irealTextToParsedChord("Dbo^7");
      expect(parsed?.root).to.equal("D");
      expect(parsed?.rootAccidental).to.equal("b");
      expect(parsed?.quality).to.equal(ChordQuality.DiminishedMajor7);
      expect(parsed?.extension).to.equal(7);
      expect(parsedChordToIrealText(parsed!)).to.equal("Dbo^7");
    });

    it("rejects two quality symbols that name no single quality", () => {
      // `Bb-77h` and `F7-b`, the two remaining rejected lexemes in the
      // sample library, both come from charts whose chord data is damaged
      // upstream of this module; a chord shape that means nothing must
      // stay rejected rather than being absorbed to make a count read zero.
      expect(irealTextToParsedChord("Bb-77h")).to.be.null;
      expect(irealTextToParsedChord("F7-b")).to.be.null;
    });

    it("reads a digit 5 standing right after the root as the power chord, and elsewhere as an extension", () => {
      expect(irealTextToParsedChord("C5")?.quality).to.equal(ChordQuality.Power);
      expect(irealTextToParsedChord("C^5")?.quality).to.equal(ChordQuality.Major);
      expect(irealTextToParsedChord("C^5")?.extension).to.equal(5);
    });

    it("rejects text carrying anything after its slash bass", () => {
      expect(irealTextToParsedChord("C7/Fx")).to.be.null;
      expect(irealTextToParsedChord("C7/")).to.be.null;
    });
  });

  describe("minor-major 7 chord text ('-^', a combined symbol)", () => {
    // Confirmed against a real chart in a user's iReal Pro library backup
    // ("A Shade Of Jade"): "-^" must be matched as a single two-character
    // quality symbol before the standalone "-" (minor) and "^" (major)
    // alternatives, or it parses as minor with a stray "^" left over.
    it('parses "<root>-^<extension>" with the MinorMajor7 quality', () => {
      const parsed = irealTextToParsedChord("Bb-^7");
      expect(parsed?.root).to.equal("B");
      expect(parsed?.rootAccidental).to.equal("b");
      expect(parsed?.quality).to.equal(ChordQuality.MinorMajor7);
      expect(parsed?.extension).to.equal(7);
    });

    it('parses a bare "-^" (no extension)', () => {
      const parsed = irealTextToParsedChord("C-^");
      expect(parsed?.quality).to.equal(ChordQuality.MinorMajor7);
      expect(parsed?.extension).to.be.null;
    });

    it("round-trips through ABCx text without fragmenting", () => {
      const parsed = irealTextToParsedChord("C-^7")!;
      const abcxText = parsedChordToAbcxText(parsed);
      expect(abcxText).to.equal("C-^7");
    });
  });
});
