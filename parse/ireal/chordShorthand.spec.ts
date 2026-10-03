import { expect } from "chai";
import fc from "fast-check";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { irealTextToParsedChord, parsedChordToIrealText } from "./chordShorthand";

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
});
