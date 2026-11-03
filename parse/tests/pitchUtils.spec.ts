import { expect } from "chai";
import * as fc from "fast-check";
import { NATURAL_SEMITONES } from "../music-theory/constants";
import {
  PitchContext,
  resolveMelodyPitch,
  pitchToNoteName,
  noteLetterToMidi,
  accidentalToSemitones,
  accidentalTypeToSemitones,
  semitonesToAccidentalString,
  semitonesToAccidentalType,
  getKeyAccidentalForPitch,
  midiToNaturalNote,
  spellPitch,
  chromaticSpelling,
  computeOctaveFromPitch,
  findDiatonicSpelling,
  getKeyDirection,
  getEnharmonicSpellings,
  chooseBestChromatic,
} from "../music-theory/pitchUtils";
import { NoteSpellings } from "../music-theory/types";
import { Token, TT } from "../parsers/scan";
import { KeySignature, AccidentalType, KeyRoot, KeyAccidental, Mode, NoteLetter } from "../types/abcjs-ast";
import { Pitch } from "../types/Expr";

// Helper to create a basic key signature
function makeKey(root: KeyRoot, acc: KeyAccidental, mode: Mode, accidentals: Array<{ note: string; acc: AccidentalType }> = []): KeySignature {
  return {
    root,
    acc,
    mode,
    accidentals: accidentals.map((a) => ({
      note: a.note as NoteLetter,
      acc: a.acc,
      verticalPos: 0,
    })),
  };
}

// Common key signatures for testing
const C_MAJOR = makeKey(KeyRoot.C, KeyAccidental.None, Mode.Major);
const G_MAJOR = makeKey(KeyRoot.G, KeyAccidental.None, Mode.Major, [{ note: "F", acc: AccidentalType.Sharp }]);
const F_MAJOR = makeKey(KeyRoot.F, KeyAccidental.None, Mode.Major, [{ note: "B", acc: AccidentalType.Flat }]);
const D_MAJOR = makeKey(KeyRoot.D, KeyAccidental.None, Mode.Major, [
  { note: "F", acc: AccidentalType.Sharp },
  { note: "C", acc: AccidentalType.Sharp },
]);

describe("pitchUtils", () => {
  describe("noteLetterToMidi", () => {
    it("should return 60 for C4 (middle C)", () => {
      expect(noteLetterToMidi("C", 4)).to.equal(60);
    });

    it("should return 69 for A4 (concert A)", () => {
      expect(noteLetterToMidi("A", 4)).to.equal(69);
    });

    it("should return 48 for C3", () => {
      expect(noteLetterToMidi("C", 3)).to.equal(48);
    });

    it("should return 72 for C5", () => {
      expect(noteLetterToMidi("C", 5)).to.equal(72);
    });

    it("should handle lowercase letters", () => {
      expect(noteLetterToMidi("c", 4)).to.equal(60);
    });

    it("should return correct values for all notes in octave 4", () => {
      expect(noteLetterToMidi("C", 4)).to.equal(60);
      expect(noteLetterToMidi("D", 4)).to.equal(62);
      expect(noteLetterToMidi("E", 4)).to.equal(64);
      expect(noteLetterToMidi("F", 4)).to.equal(65);
      expect(noteLetterToMidi("G", 4)).to.equal(67);
      expect(noteLetterToMidi("A", 4)).to.equal(69);
      expect(noteLetterToMidi("B", 4)).to.equal(71);
    });

    it("should fall back to C for invalid pitch class", () => {
      expect(noteLetterToMidi("X", 4)).to.equal(60); // Falls back to C4
    });
  });

  describe("accidentalToSemitones", () => {
    it("should return 2 for double sharp", () => {
      expect(accidentalToSemitones("^^")).to.equal(2);
    });

    it("should return 1 for sharp", () => {
      expect(accidentalToSemitones("^")).to.equal(1);
    });

    it("should return 0 for natural", () => {
      expect(accidentalToSemitones("=")).to.equal(0);
    });

    it("should return -1 for flat", () => {
      expect(accidentalToSemitones("_")).to.equal(-1);
    });

    it("should return -2 for double flat", () => {
      expect(accidentalToSemitones("__")).to.equal(-2);
    });
  });

  describe("accidentalTypeToSemitones", () => {
    it("should return 0 for null", () => {
      expect(accidentalTypeToSemitones(null)).to.equal(0);
    });

    it("should return correct values for all accidental types", () => {
      expect(accidentalTypeToSemitones(AccidentalType.DblSharp)).to.equal(2);
      expect(accidentalTypeToSemitones(AccidentalType.Sharp)).to.equal(1);
      expect(accidentalTypeToSemitones(AccidentalType.Natural)).to.equal(0);
      expect(accidentalTypeToSemitones(AccidentalType.Flat)).to.equal(-1);
      expect(accidentalTypeToSemitones(AccidentalType.DblFlat)).to.equal(-2);
    });
  });

  describe("semitonesToAccidentalString", () => {
    it("should return correct ABC strings", () => {
      expect(semitonesToAccidentalString(2)).to.equal("^^");
      expect(semitonesToAccidentalString(1)).to.equal("^");
      expect(semitonesToAccidentalString(0)).to.equal("=");
      expect(semitonesToAccidentalString(-1)).to.equal("_");
      expect(semitonesToAccidentalString(-2)).to.equal("__");
    });
  });

  describe("getKeyAccidentalForPitch", () => {
    it("should return null for C in C major", () => {
      expect(getKeyAccidentalForPitch("C", C_MAJOR)).to.be.null;
    });

    it("should return Sharp for F in G major", () => {
      expect(getKeyAccidentalForPitch("F", G_MAJOR)).to.equal(AccidentalType.Sharp);
    });

    it("should return Flat for B in F major", () => {
      expect(getKeyAccidentalForPitch("B", F_MAJOR)).to.equal(AccidentalType.Flat);
    });

    it("should return Sharp for both F and C in D major", () => {
      expect(getKeyAccidentalForPitch("F", D_MAJOR)).to.equal(AccidentalType.Sharp);
      expect(getKeyAccidentalForPitch("C", D_MAJOR)).to.equal(AccidentalType.Sharp);
    });

    it("should handle lowercase pitch class", () => {
      expect(getKeyAccidentalForPitch("f", G_MAJOR)).to.equal(AccidentalType.Sharp);
    });
  });

  describe("midiToNaturalNote", () => {
    it("should return C4 for MIDI 60", () => {
      const result = midiToNaturalNote(60);
      expect(result.naturalNote).to.equal("C");
      expect(result.octave).to.equal(4);
      expect(result.semitoneOffset).to.equal(0);
    });

    it("should return C4 with offset 1 for MIDI 61 (C#)", () => {
      const result = midiToNaturalNote(61);
      expect(result.naturalNote).to.equal("C");
      expect(result.octave).to.equal(4);
      expect(result.semitoneOffset).to.equal(1);
    });

    it("should return D4 for MIDI 62", () => {
      const result = midiToNaturalNote(62);
      expect(result.naturalNote).to.equal("D");
      expect(result.octave).to.equal(4);
      expect(result.semitoneOffset).to.equal(0);
    });

    it("should return A4 for MIDI 69", () => {
      const result = midiToNaturalNote(69);
      expect(result.naturalNote).to.equal("A");
      expect(result.octave).to.equal(4);
      expect(result.semitoneOffset).to.equal(0);
    });
  });

  describe("resolveMelodyPitch", () => {
    it("should return 60 for C in C major with no accidentals", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("C", 4, null, ctx)).to.equal(60);
    });

    it("should return 66 for F in G major (F#)", () => {
      const ctx: PitchContext = { key: G_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("F", 4, null, ctx)).to.equal(66);
    });

    it("should return 65 for F natural in G major with explicit natural", () => {
      const ctx: PitchContext = { key: G_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("F", 4, "=", ctx)).to.equal(65);
    });

    it("should return 65 for F in G major with measure accidental natural", () => {
      const measureAccidentals = new Map<string, AccidentalType>();
      measureAccidentals.set("F4", AccidentalType.Natural);
      const ctx: PitchContext = { key: G_MAJOR, measureAccidentals, transpose: 0 };
      expect(resolveMelodyPitch("F", 4, null, ctx)).to.equal(65);
    });

    it("should not apply a measure accidental on E4 to E5", () => {
      const measureAccidentals = new Map<string, AccidentalType>();
      measureAccidentals.set("E4", AccidentalType.Flat);
      const ctx: PitchContext = { key: C_MAJOR, measureAccidentals, transpose: 0 };
      expect(resolveMelodyPitch("E", 4, null, ctx)).to.equal(63);
      expect(resolveMelodyPitch("E", 5, null, ctx)).to.equal(76);
    });

    it("should return 70 for B in F major (Bb)", () => {
      const ctx: PitchContext = { key: F_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("B", 4, null, ctx)).to.equal(70);
    });

    it("should apply transpose offset", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 12 };
      expect(resolveMelodyPitch("C", 4, null, ctx)).to.equal(72);
    });

    it("should apply negative transpose offset", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: -12 };
      expect(resolveMelodyPitch("C", 4, null, ctx)).to.equal(48);
    });

    it("should handle explicit sharp", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("F", 4, "^", ctx)).to.equal(66);
    });

    it("should handle explicit flat", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("B", 4, "_", ctx)).to.equal(70);
    });

    it("should handle explicit double sharp", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("C", 4, "^^", ctx)).to.equal(62);
    });

    it("should handle explicit double flat", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      expect(resolveMelodyPitch("D", 4, "__", ctx)).to.equal(60);
    });
  });

  describe("pitchToNoteName", () => {
    it("should return F with no accidental for 66 in G major", () => {
      const ctx: PitchContext = { key: G_MAJOR, transpose: 0 };
      const result = pitchToNoteName(66, ctx);
      expect(result.noteLetter).to.equal("F");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("");
    });

    it("should return F with sharp accidental for 66 in C major", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      const result = pitchToNoteName(66, ctx);
      expect(result.noteLetter).to.equal("F");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("^");
    });

    it("should return F with no accidental for 65 in G major with measure natural", () => {
      const measureAccidentals = new Map<string, AccidentalType>();
      measureAccidentals.set("F4", AccidentalType.Natural);
      const ctx: PitchContext = { key: G_MAJOR, measureAccidentals, transpose: 0 };
      const result = pitchToNoteName(65, ctx);
      expect(result.noteLetter).to.equal("F");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("");
    });

    it("should handle transpose correctly", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 12 };
      // MIDI 72 with transpose 12 means written pitch is 60 (C4)
      const result = pitchToNoteName(72, ctx);
      expect(result.noteLetter).to.equal("C");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("");
    });

    it("should return C with no accidental for 60 in C major", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      const result = pitchToNoteName(60, ctx);
      expect(result.noteLetter).to.equal("C");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("");
    });

    it("should return A with sharp for 70 in C major (prefers sharps over flats)", () => {
      const ctx: PitchContext = { key: C_MAJOR, transpose: 0 };
      const result = pitchToNoteName(70, ctx);
      expect(result.noteLetter).to.equal("A");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("^");
    });

    it("should return B with no accidental for 70 in F major", () => {
      const ctx: PitchContext = { key: F_MAJOR, transpose: 0 };
      const result = pitchToNoteName(70, ctx);
      expect(result.noteLetter).to.equal("B");
      expect(result.octave).to.equal(4);
      expect(result.accidental).to.equal("");
    });
  });

  describe("property tests", () => {
    const noteLetterArb = fc.constantFrom("C", "D", "E", "F", "G", "A", "B");
    const octaveArb = fc.integer({ min: 0, max: 8 });
    const accidentalArb = fc.constantFrom(null, "^", "_", "=", "^^", "__");
    const transposeArb = fc.integer({ min: -24, max: 24 });

    it("property: resolveMelodyPitch returns value in valid MIDI range", () => {
      fc.assert(
        fc.property(noteLetterArb, octaveArb, accidentalArb, transposeArb, (note, octave, acc, transpose) => {
          const ctx: PitchContext = { key: C_MAJOR, transpose };
          const result = resolveMelodyPitch(note, octave, acc, ctx);
          // MIDI pitch should be reasonable (allowing for transpose)
          return result >= -24 && result <= 151;
        })
      );
    });

    it("property: noteLetterToMidi + accidental is reversible via midiToNaturalNote", () => {
      fc.assert(
        fc.property(noteLetterArb, octaveArb, (note, octave) => {
          const midi = noteLetterToMidi(note, octave);
          const { naturalNote, octave: resultOctave, semitoneOffset } = midiToNaturalNote(midi);
          // The natural note should match and semitone offset should be 0 for natural notes
          return naturalNote === note && resultOctave === octave && semitoneOffset === 0;
        })
      );
    });

    it("property: accidentalToSemitones and semitonesToAccidentalString are inverses for standard accidentals", () => {
      const standardAccidentals = fc.constantFrom("^", "_", "=", "^^", "__");
      fc.assert(
        fc.property(standardAccidentals, (acc) => {
          const semitones = accidentalToSemitones(acc);
          const result = semitonesToAccidentalString(semitones);
          return result === acc;
        })
      );
    });

    it("property: resolveMelodyPitch then pitchToNoteName produces equivalent pitch", () => {
      fc.assert(
        fc.property(noteLetterArb, octaveArb, transposeArb, (note, octave, transpose) => {
          const ctx: PitchContext = { key: C_MAJOR, transpose };

          // Resolve the pitch
          const midiPitch = resolveMelodyPitch(note, octave, null, ctx);

          // Convert back to note name
          const { noteLetter, octave: resultOctave, accidental } = pitchToNoteName(midiPitch, ctx);

          // Resolve the result again - should give same MIDI pitch
          const roundtripMidi = resolveMelodyPitch(noteLetter, resultOctave, accidental || null, ctx);

          return midiPitch === roundtripMidi;
        })
      );
    });

    it("property: transpose is correctly applied and removed", () => {
      fc.assert(
        fc.property(noteLetterArb, octaveArb, transposeArb, (note, octave, transpose) => {
          const ctxWithTranspose: PitchContext = { key: C_MAJOR, transpose };
          const ctxNoTranspose: PitchContext = { key: C_MAJOR, transpose: 0 };

          const withTranspose = resolveMelodyPitch(note, octave, null, ctxWithTranspose);
          const withoutTranspose = resolveMelodyPitch(note, octave, null, ctxNoTranspose);

          return withTranspose === withoutTranspose + transpose;
        })
      );
    });
  });

  describe("semitonesToAccidentalType", () => {
    it("returns DblSharp for 2", () => {
      expect(semitonesToAccidentalType(2)).to.equal(AccidentalType.DblSharp);
    });

    it("returns Sharp for 1", () => {
      expect(semitonesToAccidentalType(1)).to.equal(AccidentalType.Sharp);
    });

    it("returns Natural for 0", () => {
      expect(semitonesToAccidentalType(0)).to.equal(AccidentalType.Natural);
    });

    it("returns Flat for -1", () => {
      expect(semitonesToAccidentalType(-1)).to.equal(AccidentalType.Flat);
    });

    it("returns DblFlat for -2", () => {
      expect(semitonesToAccidentalType(-2)).to.equal(AccidentalType.DblFlat);
    });

    it("returns Natural for unsupported values", () => {
      expect(semitonesToAccidentalType(3)).to.equal(AccidentalType.Natural);
      expect(semitonesToAccidentalType(-3)).to.equal(AccidentalType.Natural);
    });
  });

  describe("spellPitch", () => {
    // C major note spellings (all naturals)
    const C_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };

    // G major note spellings (F#)
    const G_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0 };

    // F major note spellings (Bb)
    const F_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: -1 };

    describe("example-based", () => {
      it("spells C (MIDI 60) in C major as C natural", () => {
        const result = spellPitch(60, C_MAJOR_SPELLINGS, 0);
        expect(result.letter).to.equal("C");
        expect(result.alteration).to.equal(0);
      });

      it("spells D (MIDI 62) in C major as D natural", () => {
        const result = spellPitch(62, C_MAJOR_SPELLINGS, 2);
        expect(result.letter).to.equal("D");
        expect(result.alteration).to.equal(0);
      });

      it("spells F# (MIDI 66) in G major as F sharp (from context)", () => {
        const result = spellPitch(66, G_MAJOR_SPELLINGS, 0);
        expect(result.letter).to.equal("F");
        expect(result.alteration).to.equal(1);
      });

      it("spells Bb (MIDI 70) in F major as B flat (from context)", () => {
        const result = spellPitch(70, F_MAJOR_SPELLINGS, 0);
        expect(result.letter).to.equal("B");
        expect(result.alteration).to.equal(-1);
      });

      it("spells C# (MIDI 61) in C major as C sharp when transposing up", () => {
        const result = spellPitch(61, C_MAJOR_SPELLINGS, 1);
        expect(result.letter).to.equal("C");
        expect(result.alteration).to.equal(1);
      });

      it("spells Db (MIDI 61) in C major as D flat when transposing down", () => {
        const result = spellPitch(61, C_MAJOR_SPELLINGS, -1);
        expect(result.letter).to.equal("D");
        expect(result.alteration).to.equal(-1);
      });

      it("spells B natural (MIDI 71) in F major as B natural (tier 2: natural not in scale)", () => {
        // In F major, B is flat. B natural is not in scale but is a natural pitch class.
        const result = spellPitch(71, F_MAJOR_SPELLINGS, 2);
        expect(result.letter).to.equal("B");
        expect(result.alteration).to.equal(0);
      });

      it("spells F natural (MIDI 65) in G major as F natural (tier 2: natural not in scale)", () => {
        // In G major, F is sharp. F natural is not in scale but is a natural pitch class.
        const result = spellPitch(65, G_MAJOR_SPELLINGS, -1);
        expect(result.letter).to.equal("F");
        expect(result.alteration).to.equal(0);
      });
    });

    describe("property-based", () => {
      const genKeySpellings = fc.constantFrom(
        C_MAJOR_SPELLINGS,
        G_MAJOR_SPELLINGS,
        F_MAJOR_SPELLINGS,
        { C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0 }, // G major
        { C: 0, D: 0, E: -1, F: 0, G: 0, A: -1, B: -1 } // Eb major
      );

      const genMidi = fc.integer({ min: 24, max: 103 });
      const genNonZeroOffset = fc.integer({ min: -11, max: 11 }).filter((n) => n !== 0);

      it("property: spellPitch produces correct pitch class", () => {
        fc.assert(
          fc.property(genKeySpellings, genMidi, genNonZeroOffset, (spellings, midi, offset) => {
            const targetDegree = midi % 12;
            const spelling = spellPitch(midi, spellings, offset);
            // Use safe modulo because spelling.alteration can be negative
            const resultDegree = (((NATURAL_SEMITONES[spelling.letter] + spelling.alteration) % 12) + 12) % 12;
            return resultDegree === targetDegree;
          }),
          { numRuns: 500 }
        );
      });

      it("property: in-scale pitch uses context spelling", () => {
        fc.assert(
          fc.property(genKeySpellings, genMidi, genNonZeroOffset, (spellings, midi, offset) => {
            const targetDegree = midi % 12;

            // Find if target is in scale
            let inScaleLetter: string | null = null;
            let inScaleAlt: number | null = null;
            for (const letter of ["C", "D", "E", "F", "G", "A", "B"] as ("C" | "D" | "E" | "F" | "G" | "A" | "B")[]) {
              const alt = spellings[letter] ?? 0;
              const noteDegree = (((NATURAL_SEMITONES[letter] + alt) % 12) + 12) % 12;
              if (noteDegree === targetDegree) {
                inScaleLetter = letter;
                inScaleAlt = alt;
                break;
              }
            }

            if (inScaleLetter === null) {
              return true; // Not in scale, property doesn't apply
            }

            const spelling = spellPitch(midi, spellings, offset);
            return spelling.letter === inScaleLetter && spelling.alteration === inScaleAlt;
          }),
          { numRuns: 500 }
        );
      });

      it("property: chromatic notes use sharp when transposing up, flat when down", () => {
        fc.assert(
          fc.property(genKeySpellings, genMidi, genNonZeroOffset, (spellings, midi, offset) => {
            const targetDegree = midi % 12;

            // Check if target is in scale
            let inScale = false;
            for (const letter of ["C", "D", "E", "F", "G", "A", "B"] as ("C" | "D" | "E" | "F" | "G" | "A" | "B")[]) {
              const alt = spellings[letter] ?? 0;
              const noteDegree = (((NATURAL_SEMITONES[letter] + alt) % 12) + 12) % 12;
              if (noteDegree === targetDegree) {
                inScale = true;
                break;
              }
            }

            if (inScale) {
              return true; // Not a chromatic, property doesn't apply
            }

            // Check if target is a natural pitch class
            let isNatural = false;
            for (const letter of ["C", "D", "E", "F", "G", "A", "B"]) {
              if (NATURAL_SEMITONES[letter] === targetDegree) {
                isNatural = true;
                break;
              }
            }

            if (isNatural) {
              return true; // Natural not in scale, property doesn't apply
            }

            // True chromatic: verify direction
            const spelling = spellPitch(midi, spellings, offset);
            if (offset > 0) {
              return spelling.alteration === 1; // sharp
            } else {
              return spelling.alteration === -1; // flat
            }
          }),
          { numRuns: 500 }
        );
      });
    });
  });

  describe("chromaticSpelling", () => {
    it("returns C# for pitch class 1 when preferring sharp", () => {
      const result = chromaticSpelling(1, true);
      expect(result.letter).to.equal("C");
      expect(result.alteration).to.equal(1);
    });

    it("returns Db for pitch class 1 when preferring flat", () => {
      const result = chromaticSpelling(1, false);
      expect(result.letter).to.equal("D");
      expect(result.alteration).to.equal(-1);
    });

    it("returns F# for pitch class 6 when preferring sharp", () => {
      const result = chromaticSpelling(6, true);
      expect(result.letter).to.equal("F");
      expect(result.alteration).to.equal(1);
    });

    it("returns Gb for pitch class 6 when preferring flat", () => {
      const result = chromaticSpelling(6, false);
      expect(result.letter).to.equal("G");
      expect(result.alteration).to.equal(-1);
    });

    it("returns A# for pitch class 10 when preferring sharp", () => {
      const result = chromaticSpelling(10, true);
      expect(result.letter).to.equal("A");
      expect(result.alteration).to.equal(1);
    });

    it("returns Bb for pitch class 10 when preferring flat", () => {
      const result = chromaticSpelling(10, false);
      expect(result.letter).to.equal("B");
      expect(result.alteration).to.equal(-1);
    });
  });

  describe("computeOctaveFromPitch", () => {
    // Helper to create a Pitch AST node for testing
    function makePitch(letterStr: string, octaveStr?: string): Pitch {
      const noteLetter = new Token(TT.NOTE_LETTER, letterStr, 0);
      const octave = octaveStr ? new Token(TT.OCTAVE, octaveStr, 0) : undefined;
      return new Pitch(0, { noteLetter, octave });
    }

    it("returns 4 for uppercase C", () => {
      expect(computeOctaveFromPitch(makePitch("C"))).to.equal(4);
    });

    it("returns 5 for lowercase c", () => {
      expect(computeOctaveFromPitch(makePitch("c"))).to.equal(5);
    });

    it("returns 3 for uppercase C,", () => {
      expect(computeOctaveFromPitch(makePitch("C", ","))).to.equal(3);
    });

    it("returns 2 for uppercase C,,", () => {
      expect(computeOctaveFromPitch(makePitch("C", ",,"))).to.equal(2);
    });

    it("returns 6 for lowercase c'", () => {
      expect(computeOctaveFromPitch(makePitch("c", "'"))).to.equal(6);
    });

    it("returns 7 for lowercase c''", () => {
      expect(computeOctaveFromPitch(makePitch("c", "''"))).to.equal(7);
    });

    it("returns 4 for uppercase B", () => {
      expect(computeOctaveFromPitch(makePitch("B"))).to.equal(4);
    });

    it("returns 5 for lowercase b", () => {
      expect(computeOctaveFromPitch(makePitch("b"))).to.equal(5);
    });
  });

  describe("findDiatonicSpelling", () => {
    const C_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    const G_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0 };
    const F_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: -1 };

    describe("C major (all naturals)", () => {
      it("pitch class 0 (C) returns C natural", () => {
        const result = findDiatonicSpelling(C_MAJOR_SPELLINGS, 0);
        expect(result).to.deep.equal({ letter: "C", alteration: 0 });
      });

      it("pitch class 1 (C#/Db) returns null - chromatic", () => {
        const result = findDiatonicSpelling(C_MAJOR_SPELLINGS, 1);
        expect(result).to.be.null;
      });

      it("pitch class 5 (F) returns F natural", () => {
        const result = findDiatonicSpelling(C_MAJOR_SPELLINGS, 5);
        expect(result).to.deep.equal({ letter: "F", alteration: 0 });
      });
    });

    describe("G major (F#)", () => {
      it("pitch class 6 (F#) returns F sharp", () => {
        const result = findDiatonicSpelling(G_MAJOR_SPELLINGS, 6);
        expect(result).to.deep.equal({ letter: "F", alteration: 1 });
      });

      it("pitch class 5 (F natural) returns null - chromatic in G major", () => {
        const result = findDiatonicSpelling(G_MAJOR_SPELLINGS, 5);
        expect(result).to.be.null;
      });
    });

    describe("F major (Bb)", () => {
      it("pitch class 10 (Bb) returns B flat", () => {
        const result = findDiatonicSpelling(F_MAJOR_SPELLINGS, 10);
        expect(result).to.deep.equal({ letter: "B", alteration: -1 });
      });

      it("pitch class 11 (B natural) returns null - chromatic in F major", () => {
        const result = findDiatonicSpelling(F_MAJOR_SPELLINGS, 11);
        expect(result).to.be.null;
      });
    });

    describe("with measure accidentals", () => {
      it("G major with =F measure accidental: pitch class 5 returns F natural", () => {
        const merged: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        const result = findDiatonicSpelling(merged, 5);
        expect(result).to.deep.equal({ letter: "F", alteration: 0 });
      });

      it("G major with =F measure accidental: pitch class 6 returns null", () => {
        const merged: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        const result = findDiatonicSpelling(merged, 6);
        expect(result).to.be.null;
      });
    });

    describe("property tests", () => {
      const genNoteSpellings = fc.record({
        C: fc.integer({ min: -2, max: 2 }),
        D: fc.integer({ min: -2, max: 2 }),
        E: fc.integer({ min: -2, max: 2 }),
        F: fc.integer({ min: -2, max: 2 }),
        G: fc.integer({ min: -2, max: 2 }),
        A: fc.integer({ min: -2, max: 2 }),
        B: fc.integer({ min: -2, max: 2 }),
      });

      it("returns spelling with matching pitch class when found", () => {
        fc.assert(
          fc.property(genNoteSpellings, fc.integer({ min: 0, max: 11 }), (merged, pitchClass) => {
            const result = findDiatonicSpelling(merged, pitchClass);
            if (result !== null) {
              const computedPc = (((NATURAL_SEMITONES[result.letter] + result.alteration) % 12) + 12) % 12;
              return computedPc === pitchClass;
            }
            return true;
          }),
          { numRuns: 500 }
        );
      });

      it("returns exactly 7 non-null results for standard key spellings", () => {
        fc.assert(
          fc.property(fc.constantFrom(C_MAJOR_SPELLINGS, G_MAJOR_SPELLINGS, F_MAJOR_SPELLINGS), (merged) => {
            let count = 0;
            for (let pc = 0; pc < 12; pc++) {
              if (findDiatonicSpelling(merged, pc) !== null) {
                count++;
              }
            }
            return count === 7;
          }),
          { numRuns: 50 }
        );
      });
    });
  });

  describe("getKeyDirection", () => {
    it("C major is neutral", () => {
      const key = makeKey(KeyRoot.C, KeyAccidental.None, Mode.Major);
      expect(getKeyDirection(key)).to.equal("neutral");
    });

    it("G major is sharp", () => {
      expect(getKeyDirection(G_MAJOR)).to.equal("sharp");
    });

    it("D major is sharp", () => {
      expect(getKeyDirection(D_MAJOR)).to.equal("sharp");
    });

    it("F major is flat", () => {
      expect(getKeyDirection(F_MAJOR)).to.equal("flat");
    });

    it("Bb major is flat", () => {
      const key = makeKey(KeyRoot.B, KeyAccidental.Flat, Mode.Major, [
        { note: "B", acc: AccidentalType.Flat },
        { note: "E", acc: AccidentalType.Flat },
      ]);
      expect(getKeyDirection(key)).to.equal("flat");
    });

    it("A minor (relative of C) is neutral", () => {
      const key = makeKey(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(getKeyDirection(key)).to.equal("neutral");
    });

    it("E minor (relative of G) is sharp", () => {
      const key = makeKey(KeyRoot.E, KeyAccidental.None, Mode.Minor, [{ note: "F", acc: AccidentalType.Sharp }]);
      expect(getKeyDirection(key)).to.equal("sharp");
    });

    it("D minor (relative of F) is flat", () => {
      const key = makeKey(KeyRoot.D, KeyAccidental.None, Mode.Minor, [{ note: "B", acc: AccidentalType.Flat }]);
      expect(getKeyDirection(key)).to.equal("flat");
    });
  });

  describe("getEnharmonicSpellings", () => {
    it("pitch class 0 (C) includes C, B#, Dbb", () => {
      const result = getEnharmonicSpellings(0);
      expect(result).to.deep.include({ letter: "C", alteration: 0 });
      expect(result).to.deep.include({ letter: "B", alteration: 1 });
      expect(result).to.deep.include({ letter: "D", alteration: -2 });
    });

    it("pitch class 1 (C#/Db) includes C#, Db, B##", () => {
      const result = getEnharmonicSpellings(1);
      expect(result).to.deep.include({ letter: "C", alteration: 1 });
      expect(result).to.deep.include({ letter: "D", alteration: -1 });
      expect(result).to.deep.include({ letter: "B", alteration: 2 });
    });

    it("pitch class 6 (F#/Gb) includes F#, Gb, E##", () => {
      const result = getEnharmonicSpellings(6);
      expect(result).to.deep.include({ letter: "F", alteration: 1 });
      expect(result).to.deep.include({ letter: "G", alteration: -1 });
      expect(result).to.deep.include({ letter: "E", alteration: 2 });
    });

    it("pitch class 11 (B) includes B, Cb, A##", () => {
      const result = getEnharmonicSpellings(11);
      expect(result).to.deep.include({ letter: "B", alteration: 0 });
      expect(result).to.deep.include({ letter: "C", alteration: -1 });
      expect(result).to.deep.include({ letter: "A", alteration: 2 });
    });

    describe("property tests", () => {
      it("all returned spellings have correct pitch class", () => {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: 11 }), (pitchClass) => {
            const spellings = getEnharmonicSpellings(pitchClass);
            for (const spelling of spellings) {
              const pc = (((NATURAL_SEMITONES[spelling.letter] + spelling.alteration) % 12) + 12) % 12;
              if (pc !== pitchClass) return false;
            }
            return true;
          }),
          { numRuns: 12 }
        );
      });

      it("returns at least 2 spellings for each pitch class", () => {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: 11 }), (pitchClass) => {
            const spellings = getEnharmonicSpellings(pitchClass);
            return spellings.length >= 2;
          }),
          { numRuns: 12 }
        );
      });
    });
  });

  describe("chooseBestChromatic", () => {
    const C_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    const G_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0 };
    const F_MAJOR_SPELLINGS: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: -1 };

    describe("prefers natural when available", () => {
      it("pitch class 5 with options [E#, F] chooses F", () => {
        const options: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number }[] = [
          { letter: "E", alteration: 1 },
          { letter: "F", alteration: 0 },
        ];
        const result = chooseBestChromatic(options, C_MAJOR, C_MAJOR_SPELLINGS);
        expect(result).to.deep.equal({ letter: "F", alteration: 0 });
      });
    });

    describe("prefers key direction", () => {
      it("pitch class 1 in G major chooses C#", () => {
        const options: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number }[] = [
          { letter: "C", alteration: 1 },
          { letter: "D", alteration: -1 },
        ];
        const result = chooseBestChromatic(options, G_MAJOR, G_MAJOR_SPELLINGS);
        expect(result).to.deep.equal({ letter: "C", alteration: 1 });
      });

      it("pitch class 1 in F major chooses Db", () => {
        const options: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number }[] = [
          { letter: "C", alteration: 1 },
          { letter: "D", alteration: -1 },
        ];
        const result = chooseBestChromatic(options, F_MAJOR, F_MAJOR_SPELLINGS);
        expect(result).to.deep.equal({ letter: "D", alteration: -1 });
      });
    });

    describe("avoids measure accidental conflict", () => {
      it("pitch class 1 in C major with measure ^C chooses C#", () => {
        const options: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number }[] = [
          { letter: "C", alteration: 1 },
          { letter: "D", alteration: -1 },
        ];
        const merged: NoteSpellings = { C: 1, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        const result = chooseBestChromatic(options, C_MAJOR, merged);
        expect(result).to.deep.equal({ letter: "C", alteration: 1 });
      });
    });

    describe("prefers single over double accidentals", () => {
      it("prefers C# over B##", () => {
        const options = getEnharmonicSpellings(1);
        const result = chooseBestChromatic(options, G_MAJOR, G_MAJOR_SPELLINGS);
        expect(result.alteration).to.be.oneOf([1, -1]);
      });
    });

    describe("fallback", () => {
      it("pitch class 1 in C major with no preferences chooses first single accidental", () => {
        const options: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number }[] = [
          { letter: "B", alteration: 2 },
          { letter: "C", alteration: 1 },
          { letter: "D", alteration: -1 },
        ];
        const result = chooseBestChromatic(options, C_MAJOR, C_MAJOR_SPELLINGS);
        expect(result.alteration).to.be.oneOf([1, -1]);
      });
    });

    describe("property tests", () => {
      const genKeyAndSpellings = fc.constantFrom(
        { key: C_MAJOR, spellings: C_MAJOR_SPELLINGS },
        { key: G_MAJOR, spellings: G_MAJOR_SPELLINGS },
        { key: F_MAJOR, spellings: F_MAJOR_SPELLINGS }
      );

      it("always returns one of the input options", () => {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: 11 }), genKeyAndSpellings, (pitchClass, { key, spellings }) => {
            const options = getEnharmonicSpellings(pitchClass);
            const result = chooseBestChromatic(options, key, spellings);
            return options.some((o) => o.letter === result.letter && o.alteration === result.alteration);
          }),
          { numRuns: 100 }
        );
      });

      it("result has same pitch class as input", () => {
        fc.assert(
          fc.property(fc.integer({ min: 0, max: 11 }), genKeyAndSpellings, (pitchClass, { key, spellings }) => {
            const options = getEnharmonicSpellings(pitchClass);
            const result = chooseBestChromatic(options, key, spellings);
            const resultPc = (((NATURAL_SEMITONES[result.letter] + result.alteration) % 12) + 12) % 12;
            return resultPc === pitchClass;
          }),
          { numRuns: 100 }
        );
      });
    });
  });
});
