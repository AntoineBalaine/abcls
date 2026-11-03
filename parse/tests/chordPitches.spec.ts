import { expect } from "chai";
import { chordToPitches } from "../music-theory/chordPitches";
import { parseChordSymbol } from "../music-theory/parseChordSymbol";
import { scanChordSymbol } from "../music-theory/scanChordSymbol";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyRoot, KeyAccidental } from "../types/abcjs-ast";

function getPitches(input: string, baseOctave: number = 4): number[] | null {
  const scanResult = scanChordSymbol(input);
  if (!scanResult) return null;
  const parsed = parseChordSymbol(scanResult.tokens);
  if (!parsed) return null;
  const voiced = chordToPitches(parsed, baseOctave);
  if (!voiced) return null;
  return voiced.map((v) => v.midi);
}

describe("chordToPitches", () => {
  // Reference: C4 = MIDI 60

  describe("basic triads", () => {
    it("C (C major) -> [60, 64, 67] (C, E, G)", () => {
      expect(getPitches("C")).to.deep.equal([60, 64, 67]);
    });

    it("Cm (C minor) -> [60, 63, 67] (C, Eb, G)", () => {
      expect(getPitches("Cm")).to.deep.equal([60, 63, 67]);
    });

    it("Cdim (C diminished triad) -> [60, 63, 66] (C, Eb, Gb)", () => {
      expect(getPitches("Cdim")).to.deep.equal([60, 63, 66]);
    });

    it("Caug or C+ -> [60, 64, 68] (C, E, G#)", () => {
      expect(getPitches("Caug")).to.deep.equal([60, 64, 68]);
      expect(getPitches("C+")).to.deep.equal([60, 64, 68]);
    });
  });

  describe("7th chords", () => {
    it("C7 (C dominant 7) -> [60, 64, 67, 70] (C, E, G, Bb)", () => {
      expect(getPitches("C7")).to.deep.equal([60, 64, 67, 70]);
    });

    it("Cmaj7 (C major 7) -> [60, 64, 67, 71] (C, E, G, B)", () => {
      expect(getPitches("Cmaj7")).to.deep.equal([60, 64, 67, 71]);
    });

    it("Cm7 (C minor 7) -> [60, 63, 67, 70] (C, Eb, G, Bb)", () => {
      expect(getPitches("Cm7")).to.deep.equal([60, 63, 67, 70]);
    });

    it("Cdim7 (C diminished 7) -> [60, 63, 66, 69] (C, Eb, Gb, Bbb/A)", () => {
      // Uses diminished 7th (9 semitones)
      expect(getPitches("Cdim7")).to.deep.equal([60, 63, 66, 69]);
    });

    it("Cø7 (C half-diminished) -> [60, 63, 66, 70] (C, Eb, Gb, Bb)", () => {
      // Uses minor 7th (10 semitones)
      expect(getPitches("Cø7")).to.deep.equal([60, 63, 66, 70]);
    });
  });

  describe("alterations", () => {
    it("Cm7b5 -> [60, 63, 66, 70] (same as half-diminished via alteration)", () => {
      expect(getPitches("Cm7b5")).to.deep.equal([60, 63, 66, 70]);
    });

    it("C7b9 -> [60, 64, 67, 70, 73] (C, E, G, Bb, Db)", () => {
      expect(getPitches("C7b9")).to.deep.equal([60, 64, 67, 70, 73]);
    });

    it("C7#9#11 -> [60, 64, 67, 70, 75, 78] (C, E, G, Bb, D#, F#)", () => {
      expect(getPitches("C7#9#11")).to.deep.equal([60, 64, 67, 70, 75, 78]);
    });

    it("Cmaj7#11 -> [60, 64, 67, 71, 78] (C, E, G, B, F#)", () => {
      expect(getPitches("Cmaj7#11")).to.deep.equal([60, 64, 67, 71, 78]);
    });
  });

  describe("suspended chords", () => {
    it("Csus2 -> [60, 62, 67] (C, D, G)", () => {
      expect(getPitches("Csus2")).to.deep.equal([60, 62, 67]);
    });

    it("Csus4 -> [60, 65, 67] (C, F, G)", () => {
      expect(getPitches("Csus4")).to.deep.equal([60, 65, 67]);
    });
  });

  describe("power chords", () => {
    it("C5 (power chord) -> [60, 67] (C, G)", () => {
      expect(getPitches("C5")).to.deep.equal([60, 67]);
    });
  });

  describe("6th chords", () => {
    it("C6 -> [60, 64, 67, 69] (C, E, G, A)", () => {
      expect(getPitches("C6")).to.deep.equal([60, 64, 67, 69]);
    });

    it("C69 -> [60, 64, 67, 69, 74] (C, E, G, A, D)", () => {
      expect(getPitches("C69")).to.deep.equal([60, 64, 67, 69, 74]);
    });
  });

  describe("add chords", () => {
    it("Cadd9 -> [60, 64, 67, 74] (C, E, G, D - no 7th)", () => {
      expect(getPitches("Cadd9")).to.deep.equal([60, 64, 67, 74]);
    });

    it("Cadd6 -> [60, 64, 67, 69] (C, E, G, A - same as C6)", () => {
      expect(getPitches("Cadd6")).to.deep.equal([60, 64, 67, 69]);
    });

    it("Cadd7 -> [60, 64, 67, 71] (C, E, G, B - triad plus major 7th)", () => {
      // Note: produces same pitches as Cmaj7
      expect(getPitches("Cadd7")).to.deep.equal([60, 64, 67, 71]);
    });
  });

  describe("added tones", () => {
    it("Cm(add9) -> [60, 63, 67, 74] (C, Eb, G, D), a minor triad with a ninth and no seventh", () => {
      expect(getPitches("Cm(add9)")).to.deep.equal([60, 63, 67, 74]);
    });

    it("C7(add13) -> [60, 64, 67, 70, 81], the dominant seventh with a thirteenth", () => {
      expect(getPitches("C7(add13)")).to.deep.equal([60, 64, 67, 70, 81]);
    });

    it("Cm(add6) -> [60, 63, 67, 69], a minor triad with a major sixth", () => {
      expect(getPitches("Cm(add6)")).to.deep.equal([60, 63, 67, 69]);
    });

    it("C9(add9) has no second ninth, because the chord holds the ninth already", () => {
      expect(getPitches("C9(add9)")).to.deep.equal(getPitches("C9"));
    });
  });

  describe("different roots", () => {
    it("Am at octave 4 -> [69, 72, 76] (A4, C5, E5)", () => {
      expect(getPitches("Am", 4)).to.deep.equal([69, 72, 76]);
    });

    it("Am at octave 3 -> [57, 60, 64] (A3, C4, E4)", () => {
      expect(getPitches("Am", 3)).to.deep.equal([57, 60, 64]);
    });
  });

  describe("Highland Pipes roots rejected", () => {
    it("returns null for chord with KeyRoot.HP", () => {
      const chord: ParsedChord = {
        root: KeyRoot.HP,
        rootAccidental: KeyAccidental.None,
        quality: ChordQuality.Major,
        qualityExplicit: false,
        extension: null,
        alterations: [],
        addedTones: [],
        bass: null,
      };
      expect(chordToPitches(chord)).to.be.null;
    });

    it("returns null for chord with KeyRoot.Hp", () => {
      const chord: ParsedChord = {
        root: KeyRoot.Hp,
        rootAccidental: KeyAccidental.None,
        quality: ChordQuality.Major,
        qualityExplicit: false,
        extension: null,
        alterations: [],
        addedTones: [],
        bass: null,
      };
      expect(chordToPitches(chord)).to.be.null;
    });
  });

  describe("properties", () => {
    const testCases = ["C", "Cm", "C7", "Cmaj7", "Cm7", "Cdim7", "Caug", "Csus2", "Csus4", "C5", "C6", "Cadd9", "F#m7", "Bb"];

    for (const chord of testCases) {
      it(`pitches are in valid MIDI range for "${chord}"`, () => {
        const pitches = getPitches(chord);
        expect(pitches).to.not.be.null;
        for (const p of pitches!) {
          expect(p).to.be.at.least(0);
          expect(p).to.be.at.most(127);
        }
      });

      it(`pitches are sorted ascending for "${chord}"`, () => {
        const pitches = getPitches(chord);
        expect(pitches).to.not.be.null;
        for (let i = 1; i < pitches!.length; i++) {
          expect(pitches![i]).to.be.at.least(pitches![i - 1]);
        }
      });

      it(`first pitch is root pitch for "${chord}"`, () => {
        const pitches = getPitches(chord);
        expect(pitches).to.not.be.null;
        // The first pitch should be the root (interval 0)
        // For C at octave 4: (4+1)*12 + 0 = 60
        // For F# at octave 4: (4+1)*12 + 6 = 66
        // etc.
        const scanResult = scanChordSymbol(chord);
        const parsed = parseChordSymbol(scanResult!.tokens);
        const rootMap: Partial<Record<KeyRoot, number>> = {
          [KeyRoot.C]: 0,
          [KeyRoot.D]: 2,
          [KeyRoot.E]: 4,
          [KeyRoot.F]: 5,
          [KeyRoot.G]: 7,
          [KeyRoot.A]: 9,
          [KeyRoot.B]: 11,
        };
        let expected = 60 + (rootMap[parsed!.root] ?? 0);
        if (parsed!.rootAccidental === KeyAccidental.Sharp) expected += 1;
        if (parsed!.rootAccidental === KeyAccidental.Flat) expected -= 1;
        expect(pitches![0]).to.equal(expected);
      });

      it(`has at least 2 pitches for "${chord}"`, () => {
        const pitches = getPitches(chord);
        expect(pitches).to.not.be.null;
        expect(pitches!.length).to.be.at.least(2);
      });
    }
  });
});
