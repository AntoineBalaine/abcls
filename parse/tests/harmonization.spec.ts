import { expect } from "chai";
import fc from "fast-check";
import { NATURAL_SEMITONES, LETTERS } from "../music-theory/constants";
import {
  VoicedNote,
  ChordFunction,
  spellFromRoot,
  getIntervals,
  buildChord,
  keyRootToLetter,
  keyAccidentalToSemitones,
  placeBassWithLIL,
  placeAboveFloor,
  getArrangements4,
  getArrangements5,
  getArrangements6,
  scoreVoiceLeading,
  scoreSpreadQuality,
  buildSpreadVoicing,
  // Phase 2: Chord Tone Validation
  isChordTone,
  getAvailableTensions,
  isChordScaleTone,
  // Phase 3
  invert,
  drop2,
  drop24,
  drop3,
  matchOctave,
  substituteTensions,
  buildChordScale,
  buildClusterVoicing,
  // Phase 4
  DIATONIC_QUALITIES,
  descendScale,
  letterToKeyRoot,
  accidentalTypeToSemitones,
  semitonesToKeyAccidental,
  getKeyAccidentalFor,
  deriveDiatonicChord,
  // Parallel transform helpers
  voicedNoteOctave,
  shiftChordDiatonic,
  shiftChordChromatic,
} from "../music-theory/harmonization";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { NoteSpellings } from "../music-theory/types";
import { KeyRoot, KeyAccidental } from "../types/abcjs-ast";
import { KeySignature, AccidentalType, Mode, NoteLetter } from "../types/abcjs-ast";

function makeChord(
  root: KeyRoot,
  accidental: KeyAccidental,
  quality: ChordQuality,
  extension: number | null = null,
  alterations: Array<{ type: "sharp" | "flat"; degree: number }> = []
): ParsedChord {
  return {
    root,
    rootAccidental: accidental,
    quality,
    qualityExplicit: true,
    extension,
    alterations,
    bass: null,
  };
}

function makeKey(root: KeyRoot, acc: KeyAccidental = KeyAccidental.None, mode: Mode = Mode.Major): KeySignature {
  return { root, acc, mode, accidentals: [] };
}

const C_MAJOR = makeKey(KeyRoot.C);

describe("harmonization", () => {
  describe("spellFromRoot", () => {
    describe("example-based tests", () => {
      it("C root + major 3rd (4 semitones) at scale step 2 = E natural", () => {
        const rootIndex = LETTERS.indexOf("C"); // 0
        const rootSemitone = NATURAL_SEMITONES["C"]; // 0
        const result = spellFromRoot(rootIndex, rootSemitone, 2, 4);
        expect(result.letter).to.equal("E");
        expect(result.alteration).to.equal(0);
      });

      it("Bb root + minor 3rd (3 semitones) at scale step 2 = Db", () => {
        const rootIndex = LETTERS.indexOf("B"); // 6
        const rootSemitone = (NATURAL_SEMITONES["B"] - 1 + 12) % 12; // 10 (Bb)
        const result = spellFromRoot(rootIndex, rootSemitone, 2, 3);
        expect(result.letter).to.equal("D");
        expect(result.alteration).to.equal(-1);
      });

      it("G root + perfect 5th (7 semitones) at scale step 4 = D natural", () => {
        const rootIndex = LETTERS.indexOf("G"); // 4
        const rootSemitone = NATURAL_SEMITONES["G"]; // 7
        const result = spellFromRoot(rootIndex, rootSemitone, 4, 7);
        expect(result.letter).to.equal("D");
        expect(result.alteration).to.equal(0);
      });

      it("F# root + major 3rd (4 semitones) at scale step 2 = A#", () => {
        const rootIndex = LETTERS.indexOf("F"); // 3
        const rootSemitone = (NATURAL_SEMITONES["F"] + 1) % 12; // 6 (F#)
        const result = spellFromRoot(rootIndex, rootSemitone, 2, 4);
        expect(result.letter).to.equal("A");
        expect(result.alteration).to.equal(1);
      });

      it("root with scale step 0 returns the root letter", () => {
        const rootIndex = LETTERS.indexOf("C");
        const rootSemitone = NATURAL_SEMITONES["C"];
        const result = spellFromRoot(rootIndex, rootSemitone, 0, 0);
        expect(result.letter).to.equal("C");
        expect(result.alteration).to.equal(0);
      });
    });

    describe("property-based tests", () => {
      it("output letter is always (rootIndex + scaleStep) % 7 in LETTERS", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 0, max: 6 }), // rootIndex
            fc.integer({ min: 0, max: 11 }), // rootSemitone
            fc.integer({ min: 0, max: 6 }), // scaleStep
            fc.integer({ min: 0, max: 11 }), // interval
            (rootIndex, rootSemitone, scaleStep, interval) => {
              const result = spellFromRoot(rootIndex, rootSemitone, scaleStep, interval);
              const expectedLetter = LETTERS[(rootIndex + scaleStep) % 7];
              expect(result.letter).to.equal(expectedLetter);
            }
          )
        );
      });

      it("alteration is always in normalized range [-6, 6]", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 0, max: 6 }),
            fc.integer({ min: 0, max: 11 }),
            fc.integer({ min: 0, max: 6 }),
            fc.integer({ min: 0, max: 11 }),
            (rootIndex, rootSemitone, scaleStep, interval) => {
              const result = spellFromRoot(rootIndex, rootSemitone, scaleStep, interval);
              // The function normalizes to [-6, 6] to handle wrap-around
              expect(result.alteration).to.be.at.least(-6);
              expect(result.alteration).to.be.at.most(6);
            }
          )
        );
      });
    });
  });

  /** NOTE: brittle tests */
  describe("getIntervals", () => {
    describe("example-based tests", () => {
      it("Cmaj7 intervals = [0, 4, 7, 11]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 4, 7, 11]);
      });

      it("C7 intervals = [0, 4, 7, 10]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 4, 7, 10]);
      });

      it("Cm7 intervals = [0, 3, 7, 10]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Minor, 7);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 3, 7, 10]);
      });

      it("Cdim7 intervals = [0, 3, 6, 9]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Diminished, 7);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 3, 6, 9]);
      });

      it("C7b5 intervals = [0, 4, 6, 10]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7, [{ type: "flat", degree: 5 }]);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 4, 6, 10]);
      });

      it("Bb6 intervals = [0, 4, 7, 9] (major sixth in place of the seventh)", () => {
        const chord = makeChord(KeyRoot.B, KeyAccidental.Flat, ChordQuality.Major, 6);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 4, 7, 9]);
        expect(result.map((s) => s.scaleStep)).to.deep.equal([0, 2, 4, 5]);
      });

      it("Cm6 intervals = [0, 3, 7, 9]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Minor, 6);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 3, 7, 9]);
      });

      it("C69 intervals = [0, 4, 7, 9]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 69);
        const result = getIntervals(chord);
        expect(result.map((s) => s.interval)).to.deep.equal([0, 4, 7, 9]);
      });

      it("getIntervals returns funcs [8, 3, 5, 7] for 7th chords", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const result = getIntervals(chord);
        expect(result.map((s) => s.func)).to.deep.equal([8, 3, 5, 7]);
      });
    });

    describe("property-based tests", () => {
      const chordArb = fc.record({
        root: fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
        accidental: fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
        quality: fc.constantFrom(
          ChordQuality.Major,
          ChordQuality.Minor,
          ChordQuality.Dominant,
          ChordQuality.Diminished,
          ChordQuality.Augmented,
          ChordQuality.HalfDiminished
        ),
        extension: fc.constantFrom(null, 7),
      });

      it("getIntervals first entry always has interval 0 (root)", () => {
        fc.assert(
          fc.property(chordArb, ({ root, accidental, quality, extension }) => {
            const chord = makeChord(root, accidental, quality, extension);
            const specs = getIntervals(chord);
            expect(specs[0].interval).to.equal(0);
          })
        );
      });

      it("getIntervals first entry always has func 8 (root)", () => {
        fc.assert(
          fc.property(chordArb, ({ root, accidental, quality, extension }) => {
            const chord = makeChord(root, accidental, quality, extension);
            const specs = getIntervals(chord);
            expect(specs[0].func).to.equal(8);
          })
        );
      });

      it("getIntervals returns exactly 4 elements for all chords", () => {
        fc.assert(
          fc.property(chordArb, ({ root, accidental, quality }) => {
            const chord = makeChord(root, accidental, quality, 7);
            const specs = getIntervals(chord);
            expect(specs.length).to.equal(4);
          })
        );
      });
    });
  });

  describe("buildChord", () => {
    describe("example-based tests", () => {
      it("Cmaj7 with lead at 64 (E4) produces 4 VoicedNotes", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const result = buildChord(chord, 64);

        expect(result.length).to.equal(4);
        expect(result.map((n) => n.func)).to.deep.equal([8, 3, 5, 7]);
      });

      it("Cmaj7 has correct spellings (C, E, G, B)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const result = buildChord(chord, 60);

        expect(result[0].spelling.letter).to.equal("C");
        expect(result[0].spelling.alteration).to.equal(0);
        expect(result[1].spelling.letter).to.equal("E");
        expect(result[1].spelling.alteration).to.equal(0);
        expect(result[2].spelling.letter).to.equal("G");
        expect(result[2].spelling.alteration).to.equal(0);
        expect(result[3].spelling.letter).to.equal("B");
        expect(result[3].spelling.alteration).to.equal(0);
      });

      it("Dm7 has correct spellings (D, F, A, C)", () => {
        const chord = makeChord(KeyRoot.D, KeyAccidental.None, ChordQuality.Minor, 7);
        const result = buildChord(chord, 62);

        expect(result[0].spelling.letter).to.equal("D");
        expect(result[1].spelling.letter).to.equal("F");
        expect(result[2].spelling.letter).to.equal("A");
        expect(result[3].spelling.letter).to.equal("C");
      });

      it("F#m7 has correct spellings (F#, A, C#, E)", () => {
        const chord = makeChord(KeyRoot.F, KeyAccidental.Sharp, ChordQuality.Minor, 7);
        const result = buildChord(chord, 66);

        expect(result[0].spelling.letter).to.equal("F");
        expect(result[0].spelling.alteration).to.equal(1);
        expect(result[1].spelling.letter).to.equal("A");
        expect(result[1].spelling.alteration).to.equal(0);
        expect(result[2].spelling.letter).to.equal("C");
        expect(result[2].spelling.alteration).to.equal(1);
        expect(result[3].spelling.letter).to.equal("E");
        expect(result[3].spelling.alteration).to.equal(0);
      });

      it("Cm7 with Bb lead has correct spellings (C, Eb, G, Bb)", () => {
        // Cm7 = C minor 7th = C, Eb, G, Bb
        // Lead Bb4 = MIDI 70
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Minor, 7);
        const result = buildChord(chord, 70);

        // Root: C natural
        expect(result[0].spelling.letter).to.equal("C");
        expect(result[0].spelling.alteration).to.equal(0);
        // 3rd: Eb (E flat)
        expect(result[1].spelling.letter).to.equal("E");
        expect(result[1].spelling.alteration).to.equal(-1);
        // 5th: G natural
        expect(result[2].spelling.letter).to.equal("G");
        expect(result[2].spelling.alteration).to.equal(0);
        // 7th: Bb (B flat)
        expect(result[3].spelling.letter).to.equal("B");
        expect(result[3].spelling.alteration).to.equal(-1);
      });
    });

    describe("property-based tests", () => {
      const chordArb = fc.record({
        root: fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
        accidental: fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
        quality: fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant, ChordQuality.Diminished, ChordQuality.HalfDiminished),
      });

      it("buildChord output has exactly 4 VoicedNotes with funcs [8, 3, 5, 7]", () => {
        fc.assert(
          fc.property(chordArb, fc.integer({ min: 48, max: 84 }), ({ root, accidental, quality }, leadMidi) => {
            const chord = makeChord(root, accidental, quality, 7);
            const result = buildChord(chord, leadMidi);

            expect(result.length).to.equal(4);
            expect(result.map((n) => n.func)).to.deep.equal([8, 3, 5, 7]);
          })
        );
      });

      it("buildChord MIDI pitches are in valid range", () => {
        fc.assert(
          fc.property(chordArb, fc.integer({ min: 48, max: 84 }), ({ root, accidental, quality }, leadMidi) => {
            const chord = makeChord(root, accidental, quality, 7);
            const result = buildChord(chord, leadMidi);

            for (const note of result) {
              expect(note.midi).to.be.at.least(0);
              expect(note.midi).to.be.at.most(127);
            }
          })
        );
      });

      it("buildChord produces ascending MIDI pitches", () => {
        fc.assert(
          fc.property(chordArb, fc.integer({ min: 48, max: 84 }), ({ root, accidental, quality }, leadMidi) => {
            const chord = makeChord(root, accidental, quality, 7);
            const result = buildChord(chord, leadMidi);

            for (let i = 1; i < result.length; i++) {
              expect(result[i].midi).to.be.at.least(result[i - 1].midi);
            }
          })
        );
      });
    });
  });

  describe("keyRootToLetter", () => {
    it("converts KeyRoot.C to 'C'", () => {
      expect(keyRootToLetter(KeyRoot.C)).to.equal("C");
    });

    it("converts KeyRoot.G to 'G'", () => {
      expect(keyRootToLetter(KeyRoot.G)).to.equal("G");
    });

    it("converts KeyRoot.HP to 'A' (Highland Pipes default)", () => {
      expect(keyRootToLetter(KeyRoot.HP)).to.equal("A");
    });
  });

  describe("keyAccidentalToSemitones", () => {
    it("KeyAccidental.None returns 0", () => {
      expect(keyAccidentalToSemitones(KeyAccidental.None)).to.equal(0);
    });

    it("KeyAccidental.Sharp returns 1", () => {
      expect(keyAccidentalToSemitones(KeyAccidental.Sharp)).to.equal(1);
    });

    it("KeyAccidental.Flat returns -1", () => {
      expect(keyAccidentalToSemitones(KeyAccidental.Flat)).to.equal(-1);
    });

    it("null returns 0", () => {
      expect(keyAccidentalToSemitones(null)).to.equal(0);
    });
  });

  // ============================================================================
  // Phase 1: Low Interval Limits and Placement Functions
  // ============================================================================

  describe("placeBassWithLIL", () => {
    describe("example-based tests", () => {
      it("pushes bass down to lowest valid octave", () => {
        expect(placeBassWithLIL(60, 34)).to.equal(36); // C4 -> C2
        expect(placeBassWithLIL(72, 34)).to.equal(36); // C5 -> C2
        expect(placeBassWithLIL(48, 34)).to.equal(36); // C3 -> C2
      });

      it("stops at the limit when bass would go below", () => {
        expect(placeBassWithLIL(60, 48)).to.equal(48); // C4 -> C3
        expect(placeBassWithLIL(62, 50)).to.equal(50); // D4 -> D3
      });

      it("keeps bass in place when already above limit", () => {
        expect(placeBassWithLIL(60, 55)).to.equal(60); // C4 stays
        expect(placeBassWithLIL(48, 40)).to.equal(48); // C3 stays
      });

      it("pushes bass up when below limit", () => {
        expect(placeBassWithLIL(36, 40)).to.equal(48); // C2 -> C3
        expect(placeBassWithLIL(34, 40)).to.equal(46); // Bb1 -> Bb2
      });
    });

    describe("property-based tests", () => {
      it("result is always >= minBass", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 24, max: 96 }), // noteMidi
            fc.integer({ min: 24, max: 60 }), // minBass
            (noteMidi, minBass) => {
              const result = placeBassWithLIL(noteMidi, minBass);
              expect(result).to.be.at.least(minBass);
            }
          )
        );
      });

      it("result has same pitch class as input", () => {
        fc.assert(
          fc.property(fc.integer({ min: 24, max: 96 }), fc.integer({ min: 24, max: 60 }), (noteMidi, minBass) => {
            const result = placeBassWithLIL(noteMidi, minBass);
            expect(result % 12).to.equal(noteMidi % 12);
          })
        );
      });

      it("result is always < minBass + 12 (lowest valid octave)", () => {
        fc.assert(
          fc.property(fc.integer({ min: 24, max: 96 }), fc.integer({ min: 24, max: 60 }), (noteMidi, minBass) => {
            const result = placeBassWithLIL(noteMidi, minBass);
            expect(result).to.be.lessThan(minBass + 12);
          })
        );
      });
    });
  });

  describe("placeAboveFloor", () => {
    describe("example-based tests", () => {
      it("places note in octave just above floor when it fits", () => {
        // Floor=52, octave just above is (52, 64]. G=55 is in that range, ceiling=74 allows it
        expect(placeAboveFloor(67, 52, 74)).to.equal(55); // G4 -> G3 (in octave above floor)
        expect(placeAboveFloor(64, 52, 74)).to.equal(64); // E4 is exactly at floor+12, adjust to E3=52+12=64
        expect(placeAboveFloor(57, 52, 74)).to.equal(57); // A3 already in (52, 64], stays
      });

      it("adjusts octave down when note is above floor+12", () => {
        // G5 (79) with floor=52 -> octave above floor is (52,64], G3=55
        expect(placeAboveFloor(79, 52, 74)).to.equal(55); // G5 -> G3
        expect(placeAboveFloor(81, 59, 74)).to.equal(69); // A5 -> A4 (in octave above 59)
      });

      it("adjusts octave up when note is at or below floor", () => {
        expect(placeAboveFloor(52, 52, 74)).to.equal(64); // E3 at floor -> E4
        expect(placeAboveFloor(50, 52, 74)).to.equal(62); // D3 below floor -> D4
      });

      it("returns null when note cannot fit", () => {
        // Floor=69, ceiling=74: octave above floor is (69, 81]. G would be 79, which is > ceiling
        expect(placeAboveFloor(67, 69, 74)).to.be.null; // G in (69,81] is 79, 79 >= 74
        expect(placeAboveFloor(65, 65, 77)).to.be.null; // F in (65,77] is 77, 77 >= 77
      });
    });

    describe("property-based tests", () => {
      it("result is strictly above floor when not null", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 36, max: 84 }), // noteMidi
            fc.integer({ min: 36, max: 72 }), // floorMidi
            fc.integer({ min: 48, max: 96 }), // ceilingMidi
            (noteMidi, floorMidi, ceilingMidi) => {
              if (ceilingMidi <= floorMidi) return; // skip invalid inputs
              const result = placeAboveFloor(noteMidi, floorMidi, ceilingMidi);
              if (result !== null) {
                expect(result).to.be.greaterThan(floorMidi);
              }
            }
          )
        );
      });

      it("result is strictly below ceiling when not null", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 36, max: 84 }),
            fc.integer({ min: 36, max: 72 }),
            fc.integer({ min: 48, max: 96 }),
            (noteMidi, floorMidi, ceilingMidi) => {
              if (ceilingMidi <= floorMidi) return;
              const result = placeAboveFloor(noteMidi, floorMidi, ceilingMidi);
              if (result !== null) {
                expect(result).to.be.lessThan(ceilingMidi);
              }
            }
          )
        );
      });

      it("result has same pitch class as input when not null", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 36, max: 84 }),
            fc.integer({ min: 36, max: 72 }),
            fc.integer({ min: 48, max: 96 }),
            (noteMidi, floorMidi, ceilingMidi) => {
              if (ceilingMidi <= floorMidi) return;
              const result = placeAboveFloor(noteMidi, floorMidi, ceilingMidi);
              if (result !== null) {
                expect(result % 12).to.equal(noteMidi % 12);
              }
            }
          )
        );
      });

      it("result is at most 12 above floor when not null", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 36, max: 84 }),
            fc.integer({ min: 36, max: 72 }),
            fc.integer({ min: 48, max: 96 }),
            (noteMidi, floorMidi, ceilingMidi) => {
              if (ceilingMidi <= floorMidi) return;
              const result = placeAboveFloor(noteMidi, floorMidi, ceilingMidi);
              if (result !== null) {
                expect(result).to.be.at.most(floorMidi + 12);
              }
            }
          )
        );
      });
    });
  });

  // ============================================================================
  // Phase 2: Decision Tree Arrangement Functions
  // ============================================================================

  // Helper to create mock VoicedNote
  function mockVoicedNote(func: ChordFunction, midi: number = 60): VoicedNote {
    return { spelling: { letter: "C", alteration: 0 }, midi, func };
  }

  describe("getArrangements6", () => {
    const root = mockVoicedNote(8, 60);
    const fifth = mockVoicedNote(5, 67);
    const seventh = mockVoicedNote(7, 71);
    const ninth = mockVoicedNote(9, 74);
    const eleventh = mockVoicedNote(11, 77);
    const thirteenth = mockVoicedNote(13, 81);

    describe("example-based tests", () => {
      it("returns arrangement for tension lead with 3 tensions", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, eleventh, thirteenth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [GT2=seventh, T3=thirteenth, T2=eleventh]
        expect(result![0][0].func).to.equal(7);
        expect(result![0][1].func).to.equal(13);
        expect(result![0][2].func).to.equal(11);
      });

      it("returns arrangement for tension lead with 2 tensions", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [GT2=seventh, T1-8vb=ninth, T2=thirteenth]
        expect(result![0][0].func).to.equal(7);
        expect(result![0][1].func).to.equal(9);
        expect(result![0][2].func).to.equal(13);
      });

      it("returns branching arrangements for tension lead with 1 tension", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(4);
      });

      it("returns null for tension lead with 0 tensions", () => {
        const lead = mockVoicedNote(9, 74);
        const result = getArrangements6(lead, [], seventh, fifth, root);

        expect(result).to.be.null;
      });

      it("returns arrangement for guide tone lead with 3 tensions", () => {
        const lead = mockVoicedNote(7, 71);
        const tensions = [ninth, eleventh, thirteenth];
        const result = getArrangements6(lead, tensions, null, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [T1=ninth, T2=eleventh, T3=thirteenth]
        expect(result![0][0].func).to.equal(9);
        expect(result![0][1].func).to.equal(11);
        expect(result![0][2].func).to.equal(13);
      });

      it("returns branching for guide tone lead with 2 tensions", () => {
        const lead = mockVoicedNote(7, 71);
        const tensions = [ninth, thirteenth];
        const result = getArrangements6(lead, tensions, null, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(2);
        // [root, T1, T2] or [fifth, T1, T2]
        expect(result![0][0].func).to.equal(8);
        expect(result![1][0].func).to.equal(5);
      });

      it("returns null when GT2 is null and lead is tension", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements6(lead, tensions, null, fifth, root);

        expect(result).to.be.null;
      });

      it("returns arrangement for root lead with 2 tensions", () => {
        const lead = mockVoicedNote(8, 72);
        const tensions = [ninth, thirteenth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [GT2=seventh, T1=ninth, T2=thirteenth]
        expect(result![0][0].func).to.equal(7);
        expect(result![0][1].func).to.equal(9);
        expect(result![0][2].func).to.equal(13);
      });

      it("returns arrangement for root lead with 1 tension", () => {
        const lead = mockVoicedNote(8, 72);
        const tensions = [ninth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [GT2=seventh, fifth, T1=ninth]
        expect(result![0][0].func).to.equal(7);
        expect(result![0][1].func).to.equal(5);
        expect(result![0][2].func).to.equal(9);
      });

      it("returns branching for fifth lead with 1 tension", () => {
        const lead = mockVoicedNote(5, 79);
        const tensions = [ninth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(2);
      });
    });

    describe("property-based tests", () => {
      it("returns arrays of length 3 for all arrangements", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements6(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        for (const arr of result!) {
          expect(arr.length).to.equal(3);
        }
      });
    });
  });

  describe("getArrangements5", () => {
    const root = mockVoicedNote(8, 60);
    const fifth = mockVoicedNote(5, 67);
    const seventh = mockVoicedNote(7, 71);
    const ninth = mockVoicedNote(9, 74);
    const thirteenth = mockVoicedNote(13, 81);

    describe("example-based tests", () => {
      it("returns arrangement for tension lead with 2 tensions", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements5(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [GT2=seventh, T2=thirteenth]
        expect(result![0][0].func).to.equal(7);
        expect(result![0][1].func).to.equal(13);
      });

      it("returns arrangement for guide tone lead with 2 tensions", () => {
        const lead = mockVoicedNote(7, 71);
        const tensions = [ninth, thirteenth];
        const result = getArrangements5(lead, tensions, null, fifth, root);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(1);
        // [T1=ninth, T2=thirteenth]
        expect(result![0][0].func).to.equal(9);
        expect(result![0][1].func).to.equal(13);
      });

      it("returns null when GT2 is null and lead is tension", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements5(lead, tensions, null, fifth, root);

        expect(result).to.be.null;
      });
    });

    describe("property-based tests", () => {
      it("returns arrays of length 2 for all arrangements", () => {
        const lead = mockVoicedNote(9, 74);
        const tensions = [ninth, thirteenth];
        const result = getArrangements5(lead, tensions, seventh, fifth, root);

        expect(result).to.not.be.null;
        for (const arr of result!) {
          expect(arr.length).to.equal(2);
        }
      });
    });
  });

  describe("getArrangements4", () => {
    const fifth = mockVoicedNote(5, 67);
    const seventh = mockVoicedNote(7, 71);

    describe("example-based tests", () => {
      it("returns GT2 for tension lead", () => {
        const lead = mockVoicedNote(9, 74);
        const result = getArrangements4(lead, seventh, fifth);

        expect(result).to.not.be.null;
        expect(result![0][0].func).to.equal(7);
      });

      it("returns fifth for guide tone lead", () => {
        const lead = mockVoicedNote(7, 71);
        const result = getArrangements4(lead, null, fifth);

        expect(result).to.not.be.null;
        expect(result![0][0].func).to.equal(5);
      });

      it("returns GT2 for root lead", () => {
        const lead = mockVoicedNote(8, 72);
        const result = getArrangements4(lead, seventh, fifth);

        expect(result).to.not.be.null;
        expect(result![0][0].func).to.equal(7);
      });

      it("returns null when GT2 is null and lead is tension", () => {
        const lead = mockVoicedNote(9, 74);
        const result = getArrangements4(lead, null, fifth);

        expect(result).to.be.null;
      });
    });

    describe("property-based tests", () => {
      it("returns arrays of length 1 for all arrangements", () => {
        const lead = mockVoicedNote(7, 71);
        const result = getArrangements4(lead, null, fifth);

        expect(result).to.not.be.null;
        for (const arr of result!) {
          expect(arr.length).to.equal(1);
        }
      });
    });
  });

  describe("scoreVoiceLeading", () => {
    describe("example-based tests", () => {
      it("returns 0 when no movement", () => {
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 52), mockVoicedNote(5, 55), mockVoicedNote(7, 59)];
        const prevMidi = [36, 52, 55, 59];
        expect(scoreVoiceLeading(voicing, prevMidi)).to.equal(0);
      });

      it("returns negative penalty for voice movement", () => {
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 52), mockVoicedNote(5, 55), mockVoicedNote(7, 59)];
        const prevMidi = [38, 54, 57, 61]; // Each voice moved by 2
        expect(scoreVoiceLeading(voicing, prevMidi)).to.equal(-8);
      });

      it("penalizes voice count differences", () => {
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 52), mockVoicedNote(5, 55)];
        const prevMidi = [36, 52, 55, 59]; // Previous had 4 voices, now 3
        expect(scoreVoiceLeading(voicing, prevMidi)).to.equal(-12); // 12 * 1 voice diff
      });
    });
  });

  describe("scoreSpreadQuality", () => {
    describe("example-based tests", () => {
      it("rewards narrowing intervals", () => {
        // Intervals: 10, 8, 5 (narrowing)
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 46), mockVoicedNote(5, 54), mockVoicedNote(7, 59)];
        const score = scoreSpreadQuality(voicing);
        expect(score).to.be.greaterThan(0);
      });

      it("penalizes widening intervals", () => {
        // Intervals: 4, 6, 8 (widening)
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 40), mockVoicedNote(5, 46), mockVoicedNote(7, 54)];
        const score = scoreSpreadQuality(voicing);
        expect(score).to.be.lessThan(0);
      });

      it("handles equal intervals", () => {
        // Intervals: 6, 6, 6 (equal)
        const voicing = [mockVoicedNote(8, 36), mockVoicedNote(3, 42), mockVoicedNote(5, 48), mockVoicedNote(7, 54)];
        const score = scoreSpreadQuality(voicing);
        expect(score).to.be.greaterThan(0); // Equal counts as narrowing
      });
    });
  });

  describe("buildSpreadVoicing", () => {
    // Helper to build a Cmaj7 chord
    function buildCmaj7(): VoicedNote[] {
      return [
        { spelling: { letter: "C", alteration: 0 }, midi: 60, func: 8 },
        { spelling: { letter: "E", alteration: 0 }, midi: 64, func: 3 },
        { spelling: { letter: "G", alteration: 0 }, midi: 67, func: 5 },
        { spelling: { letter: "B", alteration: 0 }, midi: 71, func: 7 },
      ];
    }

    // Helper to build tensions for Cmaj7 (9th=D, 13th=A; 11th avoided)
    function buildCmaj7Tensions(): Map<9 | 11 | 13, VoicedNote> {
      const tensions = new Map<9 | 11 | 13, VoicedNote>();
      tensions.set(9, { spelling: { letter: "D", alteration: 0 }, midi: 62, func: 9 });
      tensions.set(13, { spelling: { letter: "A", alteration: 0 }, midi: 69, func: 13 });
      return tensions;
    }

    describe("example-based tests", () => {
      it("builds 6-voice spread for tension lead", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, null);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(6);
        expect(result![0].func).to.equal(8); // bass is root
        expect(result![5].midi).to.equal(74); // lead on top
      });

      it("builds 5-voice spread for guide tone lead", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "B", alteration: 0 }, midi: 71, func: 7 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 5, null);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(5);
        expect(result![0].func).to.equal(8); // bass is root
        expect(result![4].midi).to.equal(71); // lead on top
      });

      it("builds 4-voice spread for tension lead", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 4, null);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(4);
        expect(result![0].func).to.equal(8); // bass is root
        expect(result![3].midi).to.equal(74); // lead on top
      });

      it("returns null when lead is too low", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "E", alteration: 0 }, midi: 52, func: 3 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, null);

        expect(result).to.be.null;
      });

      it("uses voice leading when prevMidi is provided", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };
        const prevMidi = [36, 52, 55, 59, 64, 72];

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, prevMidi);

        expect(result).to.not.be.null;
        expect(result!.length).to.equal(6);
      });
    });

    describe("property-based tests", () => {
      it("result is always sorted by MIDI", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, null);

        expect(result).to.not.be.null;
        for (let i = 1; i < result!.length; i++) {
          expect(result![i].midi).to.be.at.least(result![i - 1].midi);
        }
      });

      it("bass is always lowest voice", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, null);

        expect(result).to.not.be.null;
        expect(result![0].func).to.equal(8);
      });

      it("lead is always highest voice", () => {
        const rootPosChord = buildCmaj7();
        const tensions = buildCmaj7Tensions();
        const lead: VoicedNote = { spelling: { letter: "D", alteration: 0 }, midi: 74, func: 9 };

        const result = buildSpreadVoicing(rootPosChord, tensions, lead, 6, null);

        expect(result).to.not.be.null;
        expect(result![result!.length - 1].midi).to.equal(lead.midi);
      });
    });
  });

  // ============================================================================
  // Phase 2: Chord Tone Validation
  // ============================================================================

  describe("isChordTone", () => {
    describe("example-based tests", () => {
      it("MIDI 64 (E4) is a chord tone of Cmaj7 (E is the 3rd)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordTone(64, rootPosChord)).to.be.true;
      });

      it("MIDI 66 (F#4) is not a chord tone of Cmaj7", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordTone(66, rootPosChord)).to.be.false;
      });

      it("MIDI 72 (C5) is a chord tone of Cmaj7 (same pitch class as root)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordTone(72, rootPosChord)).to.be.true;
      });

      it("MIDI 67 (G4) is a chord tone of Cmaj7 (G is the 5th)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordTone(67, rootPosChord)).to.be.true;
      });

      it("MIDI 71 (B4) is a chord tone of Cmaj7 (B is the 7th)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordTone(71, rootPosChord)).to.be.true;
      });
    });

    describe("property-based tests", () => {
      it("returns true for any pitch in rootPosChord (same pitch class)", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 0, max: 3 }), // index into chord
            fc.integer({ min: -2, max: 2 }), // octave offset
            (root, acc, quality, noteIndex, octaveOffset) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPosChord = buildChord(chord, 60);
              const chordNoteMidi = rootPosChord[noteIndex].midi;
              const testMidi = chordNoteMidi + octaveOffset * 12;
              expect(isChordTone(testMidi, rootPosChord)).to.be.true;
            }
          )
        );
      });
    });
  });

  describe("getAvailableTensions", () => {
    describe("example-based tests", () => {
      it("Cmaj7 returns 9 and 13 (11 is avoid because F is minor 2nd above E)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

        expect(tensions.has(9)).to.be.true;
        expect(tensions.has(11)).to.be.false;
        expect(tensions.has(13)).to.be.true;
      });

      it("G7 returns 9 and 13 (11 is avoid because C is minor 2nd above B)", () => {
        const chord = makeChord(KeyRoot.G, KeyAccidental.None, ChordQuality.Dominant, 7);
        const rootPosChord = buildChord(chord, 55);
        const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

        // G7: G(55), B(59), D(62), F(65)
        // Tensions: 9=A(69), 11=C(72), 13=E(76)
        // C (11) is 1 semitone above B (7th), so it's an avoid note
        expect(tensions.has(9)).to.be.true;
        expect(tensions.has(11)).to.be.false;
        expect(tensions.has(13)).to.be.true;
      });

      it("Dm7 returns all tensions (9, 11, 13) because no tension is a minor 2nd above a guide tone", () => {
        // Dm7 chord tones: D(2), F(5), A(9), C(0) as pitch classes
        // Because the avoid note rule checks if a tension is exactly 1 semitone
        // above a guide tone (3rd or 7th), we verify each tension:
        // - 9th (E, pc=4): (4-5+12)%12 = 11, not 1 semitone above F (3rd)
        // - 11th (G, pc=7): (7-5+12)%12 = 2, not 1 semitone above F
        // - 13th (B, pc=11): (11-0+12)%12 = 11, not 1 semitone above C (7th)
        // Since none of the tensions form a minor 2nd above a guide tone,
        // all three tensions are available for Dm7.
        const chord = makeChord(KeyRoot.D, KeyAccidental.None, ChordQuality.Minor, 7);
        const rootPosChord = buildChord(chord, 62);
        const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

        expect(tensions.has(9)).to.be.true;
        expect(tensions.has(11)).to.be.true;
        expect(tensions.has(13)).to.be.true;
      });

      it("applies chord alterations to tension intervals", () => {
        // C7#11 should have #11 (F#) instead of natural 11 (F)
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7, [{ type: "sharp", degree: 11 }]);
        const rootPosChord = buildChord(chord, 60);
        const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

        // With #11, the 11th is now F# (pitch class 6) instead of F (pitch class 5)
        // F# is not a minor 2nd above E (pitch class 4), so it should be available
        // Actually F# - E = 6 - 4 = 2, so not an avoid note
        expect(tensions.has(11)).to.be.true;
      });
    });

    describe("property-based tests", () => {
      it("returns at most 3 entries", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPosChord = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);
              expect(tensions.size).to.be.at.most(3);
            }
          )
        );
      });

      it("never returns a tension whose pitch class is 1 semitone above the 3rd or 7th", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPosChord = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

              const thirdPitchClass = rootPosChord[1].midi % 12;
              const seventhPitchClass = rootPosChord[3].midi % 12;

              for (const tension of tensions.values()) {
                const tensionPitchClass = tension.midi % 12;
                const diffFromThird = (tensionPitchClass - thirdPitchClass + 12) % 12;
                const diffFromSeventh = (tensionPitchClass - seventhPitchClass + 12) % 12;
                expect(diffFromThird).to.not.equal(1);
                expect(diffFromSeventh).to.not.equal(1);
              }
            }
          )
        );
      });
    });
  });

  describe("isChordScaleTone", () => {
    describe("example-based tests", () => {
      it("MIDI 62 (D4) is a chord scale tone of Cmaj7 (it's the 9th)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordScaleTone(62, rootPosChord, chord, C_MAJOR)).to.be.true;
      });

      it("MIDI 65 (F4) is not a chord scale tone of Cmaj7 (11 is avoid)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordScaleTone(65, rootPosChord, chord, C_MAJOR)).to.be.false;
      });

      it("MIDI 69 (A4) is a chord scale tone of Cmaj7 (it's the 13th)", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        expect(isChordScaleTone(69, rootPosChord, chord, C_MAJOR)).to.be.true;
      });

      it("chord tones are always chord scale tones", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPosChord = buildChord(chord, 60);
        // Test all chord tones (C=60, E=64, G=67, B=71)
        expect(isChordScaleTone(60, rootPosChord, chord, C_MAJOR)).to.be.true;
        expect(isChordScaleTone(64, rootPosChord, chord, C_MAJOR)).to.be.true;
        expect(isChordScaleTone(67, rootPosChord, chord, C_MAJOR)).to.be.true;
        expect(isChordScaleTone(71, rootPosChord, chord, C_MAJOR)).to.be.true;
      });
    });

    describe("property-based tests", () => {
      it("returns true for all chord tones", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 0, max: 3 }),
            (root, acc, quality, noteIndex) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPosChord = buildChord(chord, 60);
              const chordToneMidi = rootPosChord[noteIndex].midi;
              expect(isChordScaleTone(chordToneMidi, rootPosChord, chord, C_MAJOR)).to.be.true;
            }
          )
        );
      });

      it("returns true for all pitches returned by getAvailableTensions", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPosChord = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPosChord, chord, C_MAJOR);

              for (const tension of tensions.values()) {
                expect(isChordScaleTone(tension.midi, rootPosChord, chord, C_MAJOR)).to.be.true;
              }
            }
          )
        );
      });
    });
  });

  // ============================================================================
  // Phase 3: Voicing Algorithms
  // ============================================================================

  describe("invert", () => {
    describe("example-based tests", () => {
      it("Cmaj7 root position [C4, E4, G4, B4] with target E4 (64) -> [G3, B3, C4, E4]", () => {
        // Build chord at octave 4 by using a higher leadMidi
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 72);
        // rootPos: C4(60), E4(64), G4(67), B4(71)

        const inverted = invert(rootPos, 64);

        // G4(67) > 64, drops to G3(55)
        // B4(71) > 64, drops to B3(59)
        // C4(60) <= 64, stays
        // E4(64) <= 64, stays
        // Expected sorted: G3(55), B3(59), C4(60), E4(64)
        expect(inverted.map((n) => n.midi)).to.deep.equal([55, 59, 60, 64]);
        expect(inverted[inverted.length - 1].midi).to.equal(64);
      });

      it("Cmaj7 with target B4 (71) keeps all notes in original octave", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 72);
        // rootPos: C4(60), E4(64), G4(67), B4(71)

        const inverted = invert(rootPos, 71);

        // All notes are <= 71, so they stay where they are
        expect(inverted[inverted.length - 1].midi).to.equal(71);
        for (const note of inverted) {
          expect(note.midi).to.be.at.most(71);
        }
      });

      it("Cmaj7 with target C4 (60) drops everything to or below C4", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 72);
        // rootPos: C4(60), E4(64), G4(67), B4(71)

        const inverted = invert(rootPos, 60);

        // E4(64) > 60, drops to E3(52)
        // G4(67) > 60, drops to G3(55)
        // B4(71) > 60, drops to B3(59)
        // C4(60) <= 60, stays
        // Expected sorted: E3(52), G3(55), B3(59), C4(60)
        expect(inverted[inverted.length - 1].midi).to.equal(60);
        for (const note of inverted) {
          expect(note.midi).to.be.at.most(60);
        }
      });
    });

    describe("property-based tests", () => {
      it("output has same pitch classes as input", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 48, max: 84 }),
            (root, acc, quality, targetMidi) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const inverted = invert(rootPos, targetMidi);

              const inputPitchClasses = rootPos.map((n) => n.midi % 12).sort((a, b) => a - b);
              const outputPitchClasses = inverted.map((n) => n.midi % 12).sort((a, b) => a - b);

              expect(outputPitchClasses).to.deep.equal(inputPitchClasses);
            }
          )
        );
      });

      it("output's highest note equals targetMidi when target is a chord tone", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 0, max: 3 }), // chord tone index
            (root, acc, quality, chordToneIdx) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              // Use an actual chord tone as the target
              const targetMidi = rootPos[chordToneIdx].midi;
              const inverted = invert(rootPos, targetMidi);

              expect(inverted[inverted.length - 1].midi).to.equal(targetMidi);
            }
          )
        );
      });

      it("all notes are at or below targetMidi", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 48, max: 84 }),
            (root, acc, quality, targetMidi) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const inverted = invert(rootPos, targetMidi);

              for (const note of inverted) {
                expect(note.midi).to.be.at.most(targetMidi);
              }
            }
          )
        );
      });

      it("output is sorted ascending by MIDI pitch", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 48, max: 84 }),
            (root, acc, quality, targetMidi) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const inverted = invert(rootPos, targetMidi);

              for (let i = 1; i < inverted.length; i++) {
                expect(inverted[i].midi).to.be.at.least(inverted[i - 1].midi);
              }
            }
          )
        );
      });
    });
  });

  describe("drop2", () => {
    describe("example-based tests", () => {
      it("[C4, E4, G4, B4] -> [G3, C4, E4, B4]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 71);
        // rootPos: [C4(60), E4(64), G4(67), B4(71)]

        const dropped = drop2(rootPos);

        // Second highest is G4(67), drop by octave = G3(55)
        // Result sorted: G3(55), C4(60), E4(64), B4(71)
        expect(dropped.map((n) => n.midi)).to.deep.equal([55, 60, 64, 71]);
      });
    });

    describe("property-based tests", () => {
      it("output has same pitch classes as input", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const dropped = drop2(rootPos);

              const inputPitchClasses = rootPos.map((n) => n.midi % 12).sort((a, b) => a - b);
              const outputPitchClasses = dropped.map((n) => n.midi % 12).sort((a, b) => a - b);

              expect(outputPitchClasses).to.deep.equal(inputPitchClasses);
            }
          )
        );
      });

      it("output's second-highest is 12 semitones lower than input's second-highest", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const inputSecondHighest = rootPos[rootPos.length - 2].midi;

              const dropped = drop2(rootPos);
              const droppedSecondHighestPitchClass = inputSecondHighest % 12;

              // Find the note with the same pitch class in the dropped chord
              const droppedNote = dropped.find((n) => n.midi % 12 === droppedSecondHighestPitchClass);
              expect(droppedNote).to.not.be.undefined;
              expect(droppedNote!.midi).to.equal(inputSecondHighest - 12);
            }
          )
        );
      });
    });
  });

  describe("drop24", () => {
    describe("example-based tests", () => {
      it("[C4, E4, G4, B4] -> [C3, G3, E4, B4]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 71);
        // rootPos: [C4(60), E4(64), G4(67), B4(71)]

        const dropped = drop24(rootPos);

        // 2nd highest: G4(67) -> G3(55)
        // 4th highest: C4(60) -> C3(48)
        // Result sorted: C3(48), G3(55), E4(64), B4(71)
        expect(dropped.map((n) => n.midi)).to.deep.equal([48, 55, 64, 71]);
      });
    });

    describe("property-based tests", () => {
      it("output has same pitch classes as input", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const dropped = drop24(rootPos);

              const inputPitchClasses = rootPos.map((n) => n.midi % 12).sort((a, b) => a - b);
              const outputPitchClasses = dropped.map((n) => n.midi % 12).sort((a, b) => a - b);

              expect(outputPitchClasses).to.deep.equal(inputPitchClasses);
            }
          )
        );
      });
    });
  });

  describe("drop3", () => {
    describe("example-based tests", () => {
      it("[C4, E4, G4, B4] -> [E3, C4, G4, B4]", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 71);
        // rootPos: [C4(60), E4(64), G4(67), B4(71)]

        const dropped = drop3(rootPos);

        // 3rd highest: E4(64) -> E3(52)
        // Result sorted: E3(52), C4(60), G4(67), B4(71)
        expect(dropped.map((n) => n.midi)).to.deep.equal([52, 60, 67, 71]);
      });
    });

    describe("property-based tests", () => {
      it("output has same pitch classes as input", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const dropped = drop3(rootPos);

              const inputPitchClasses = rootPos.map((n) => n.midi % 12).sort((a, b) => a - b);
              const outputPitchClasses = dropped.map((n) => n.midi % 12).sort((a, b) => a - b);

              expect(outputPitchClasses).to.deep.equal(inputPitchClasses);
            }
          )
        );
      });
    });
  });

  describe("matchOctave", () => {
    describe("example-based tests", () => {
      it("74 (D5) with target 64 (E4) -> 62 (D4)", () => {
        const result = matchOctave(74, 64);
        expect(result).to.equal(62);
      });

      it("50 (D3) with target 64 (E4) -> 62 (D4)", () => {
        const result = matchOctave(50, 64);
        expect(result).to.equal(62);
      });

      it("62 (D4) with target 64 (E4) -> 62 (D4) (already within range)", () => {
        const result = matchOctave(62, 64);
        expect(result).to.equal(62);
      });

      it("pitch at target+6 stays in range", () => {
        const result = matchOctave(70, 64);
        expect(result).to.equal(70);
      });

      it("pitch at target-6 stays in range", () => {
        const result = matchOctave(58, 64);
        expect(result).to.equal(58);
      });
    });

    describe("property-based tests", () => {
      it("output is within 6 semitones of target", () => {
        fc.assert(
          fc.property(fc.integer({ min: 24, max: 108 }), fc.integer({ min: 36, max: 96 }), (tensionMidi, targetMidi) => {
            const result = matchOctave(tensionMidi, targetMidi);
            expect(Math.abs(result - targetMidi)).to.be.at.most(6);
          })
        );
      });

      it("output has same pitch class as input", () => {
        fc.assert(
          fc.property(fc.integer({ min: 24, max: 108 }), fc.integer({ min: 36, max: 96 }), (tensionMidi, targetMidi) => {
            const result = matchOctave(tensionMidi, targetMidi);
            expect(result % 12).to.equal(tensionMidi % 12);
          })
        );
      });
    });
  });

  describe("substituteTensions", () => {
    describe("example-based tests", () => {
      it("substitutes root doubling with 9th when available", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 60);

        // Create a voicing with a root doubling (add another C)
        const withDoubling: VoicedNote[] = [{ spelling: { letter: "C", alteration: 0 }, midi: 48, func: 8 }, ...rootPos];

        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
        const result = substituteTensions(withDoubling, tensions);

        // The lower C (48) should be replaced with D (9th)
        // Since we work from second-to-top downward, the first root we encounter
        // going down should be substituted
        const hasTension9 = result.some((n) => n.func === 9);
        expect(hasTension9).to.be.true;
      });

      it("does not substitute the top voice", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 60);
        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);

        const result = substituteTensions(rootPos, tensions);

        // The top voice should remain unchanged
        expect(result[result.length - 1].midi).to.equal(rootPos[rootPos.length - 1].midi);
        expect(result[result.length - 1].func).to.equal(rootPos[rootPos.length - 1].func);
      });
    });

    describe("property-based tests", () => {
      it("top voice is never changed", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const result = substituteTensions(rootPos, tensions);

              expect(result[result.length - 1].midi).to.equal(rootPos[rootPos.length - 1].midi);
            }
          )
        );
      });

      it("output has same length as input", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const result = substituteTensions(rootPos, tensions);

              expect(result.length).to.equal(rootPos.length);
            }
          )
        );
      });
    });
  });

  describe("buildChordScale", () => {
    describe("example-based tests", () => {
      it("Cmaj7 with tensions 9 and 13 produces 6-note scale", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 60);
        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);

        // Cmaj7 has 9 and 13 available (11 is avoid)
        const scale = buildChordScale(rootPos, tensions);

        // Should have 4 chord tones + 2 tensions = 6 notes
        expect(scale.length).to.equal(6);
      });

      it("scale is sorted by pitch class", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 60);
        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
        const scale = buildChordScale(rootPos, tensions);

        for (let i = 1; i < scale.length; i++) {
          expect(scale[i].midi % 12).to.be.at.least(scale[i - 1].midi % 12);
        }
      });
    });

    describe("property-based tests", () => {
      it("output contains all chord tones", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const scale = buildChordScale(rootPos, tensions);

              const scalePitchClasses = scale.map((n) => n.midi % 12);
              for (const chordTone of rootPos) {
                expect(scalePitchClasses).to.include(chordTone.midi % 12);
              }
            }
          )
        );
      });

      it("output length equals chord tones plus available tensions", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            (root, acc, quality) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 60);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const scale = buildChordScale(rootPos, tensions);

              expect(scale.length).to.equal(rootPos.length + tensions.size);
            }
          )
        );
      });
    });
  });

  describe("buildClusterVoicing", () => {
    describe("example-based tests", () => {
      it("chord scale with lead E4 (64) and voiceCount 4 returns 4 notes", () => {
        // Use a higher leadMidi for buildChord so the chord is in the right octave
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 72);
        // rootPos: C4(60), E4(64), G4(67), B4(71)
        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
        const scale = buildChordScale(rootPos, tensions);

        const cluster = buildClusterVoicing(scale, 64, 4);

        expect(cluster.length).to.equal(4);
      });

      it("highest note equals leadMidi when lead is in chord scale", () => {
        const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
        const rootPos = buildChord(chord, 72);
        // rootPos: C4(60), E4(64), G4(67), B4(71) - E4 is in the chord
        const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
        const scale = buildChordScale(rootPos, tensions);

        const cluster = buildClusterVoicing(scale, 64, 4);

        expect(cluster[cluster.length - 1].midi).to.equal(64);
      });

      it("drops second-highest by octave if 1 semitone below lead", () => {
        // Create a scenario where second-highest would be 1 semitone below
        // E4 (64) with D#4 (63) would trigger this
        const customScale: VoicedNote[] = [
          { spelling: { letter: "C", alteration: 0 }, midi: 60, func: 8 },
          { spelling: { letter: "D", alteration: 1 }, midi: 63, func: 9 }, // D# is 1 below E
          { spelling: { letter: "E", alteration: 0 }, midi: 64, func: 3 },
          { spelling: { letter: "G", alteration: 0 }, midi: 67, func: 5 },
        ];

        const cluster = buildClusterVoicing(customScale, 64, 4);

        // D# should be dropped to D#3 (51) because it's 1 semitone below E
        const dSharpNote = cluster.find((n) => n.midi % 12 === 3);
        if (dSharpNote) {
          expect(dSharpNote.midi).to.equal(51);
        }
      });
    });

    describe("property-based tests", () => {
      it("output has exactly voiceCount notes when scale is large enough", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 3, max: 4 }),
            (root, acc, quality, voiceCount) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const scale = buildChordScale(rootPos, tensions);

              // Use a chord tone as the lead to ensure it's in the scale
              const leadMidi = rootPos[1].midi; // Use the 3rd as lead

              if (scale.length >= voiceCount) {
                const cluster = buildClusterVoicing(scale, leadMidi, voiceCount);
                expect(cluster.length).to.equal(voiceCount);
              }
            }
          )
        );
      });

      it("output's highest note equals leadMidi when lead is a chord tone", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat),
            fc.constantFrom(ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant),
            fc.integer({ min: 0, max: 3 }), // chord tone index
            (root, acc, quality, chordToneIdx) => {
              const chord = makeChord(root, acc, quality, 7);
              const rootPos = buildChord(chord, 72);
              const tensions = getAvailableTensions(rootPos, chord, C_MAJOR);
              const scale = buildChordScale(rootPos, tensions);

              // Use a chord tone as the lead
              const leadMidi = rootPos[chordToneIdx].midi;
              const cluster = buildClusterVoicing(scale, leadMidi, 4);

              expect(cluster[cluster.length - 1].midi).to.equal(leadMidi);
            }
          )
        );
      });
    });
  });

  // ============================================================================
  // Phase 4: Diatonic Chord Derivation
  // ============================================================================

  // Helper to create KeySignature objects for testing
  function makeKeySignature(root: KeyRoot, acc: KeyAccidental, mode: Mode, accidentals: Array<{ note: string; acc: AccidentalType }> = []): KeySignature {
    return {
      root,
      acc,
      mode,
      accidentals: accidentals.map((a) => ({ note: a.note as NoteLetter, acc: a.acc, verticalPos: 0 })),
    };
  }

  describe("descendScale", () => {
    describe("example-based tests", () => {
      it("descendScale('E', 3) returns 'C' (C is a 3rd below E)", () => {
        expect(descendScale("E", 3)).to.equal("C");
      });

      it("descendScale('G', 5) returns 'C' (C is a 5th below G)", () => {
        expect(descendScale("G", 5)).to.equal("C");
      });

      it("descendScale('D', 8) returns 'D' (octave returns same letter)", () => {
        expect(descendScale("D", 8)).to.equal("D");
      });

      it("descendScale('C', 1) returns 'C' (unison returns same letter)", () => {
        expect(descendScale("C", 1)).to.equal("C");
      });

      it("descendScale('A', 3) returns 'F' (F is a 3rd below A)", () => {
        expect(descendScale("A", 3)).to.equal("F");
      });

      it("descendScale('B', 7) returns 'C' (C is a 7th below B)", () => {
        expect(descendScale("B", 7)).to.equal("C");
      });
    });

    describe("property-based tests", () => {
      it("descendScale(letter, 1) always returns letter (unison)", () => {
        fc.assert(
          fc.property(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), (letter) => {
            expect(descendScale(letter, 1)).to.equal(letter);
          })
        );
      });

      it("descendScale(letter, 8) always returns letter (octave)", () => {
        fc.assert(
          fc.property(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), (letter) => {
            expect(descendScale(letter, 8)).to.equal(letter);
          })
        );
      });

      it("result is always a valid letter A-G", () => {
        fc.assert(
          fc.property(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), fc.integer({ min: 1, max: 8 }), (letter, interval) => {
            const result = descendScale(letter, interval);
            expect(LETTERS).to.include(result);
          })
        );
      });
    });
  });

  describe("letterToKeyRoot", () => {
    it("converts C to KeyRoot.C", () => {
      expect(letterToKeyRoot("C")).to.equal(KeyRoot.C);
    });

    it("converts G to KeyRoot.G", () => {
      expect(letterToKeyRoot("G")).to.equal(KeyRoot.G);
    });

    it("converts all letters correctly", () => {
      expect(letterToKeyRoot("D")).to.equal(KeyRoot.D);
      expect(letterToKeyRoot("E")).to.equal(KeyRoot.E);
      expect(letterToKeyRoot("F")).to.equal(KeyRoot.F);
      expect(letterToKeyRoot("A")).to.equal(KeyRoot.A);
      expect(letterToKeyRoot("B")).to.equal(KeyRoot.B);
    });
  });

  describe("accidentalTypeToSemitones", () => {
    it("DblSharp returns 2", () => {
      expect(accidentalTypeToSemitones(AccidentalType.DblSharp)).to.equal(2);
    });

    it("Sharp returns 1", () => {
      expect(accidentalTypeToSemitones(AccidentalType.Sharp)).to.equal(1);
    });

    it("Natural returns 0", () => {
      expect(accidentalTypeToSemitones(AccidentalType.Natural)).to.equal(0);
    });

    it("Flat returns -1", () => {
      expect(accidentalTypeToSemitones(AccidentalType.Flat)).to.equal(-1);
    });

    it("DblFlat returns -2", () => {
      expect(accidentalTypeToSemitones(AccidentalType.DblFlat)).to.equal(-2);
    });
  });

  describe("semitonesToKeyAccidental", () => {
    it("positive semitones return Sharp", () => {
      expect(semitonesToKeyAccidental(1)).to.equal(KeyAccidental.Sharp);
      expect(semitonesToKeyAccidental(2)).to.equal(KeyAccidental.Sharp);
    });

    it("negative semitones return Flat", () => {
      expect(semitonesToKeyAccidental(-1)).to.equal(KeyAccidental.Flat);
      expect(semitonesToKeyAccidental(-2)).to.equal(KeyAccidental.Flat);
    });

    it("zero returns None", () => {
      expect(semitonesToKeyAccidental(0)).to.equal(KeyAccidental.None);
    });
  });

  describe("getKeyAccidentalFor", () => {
    it("F in G major returns 1 (F#)", () => {
      const gMajor = makeKeySignature(KeyRoot.G, KeyAccidental.None, Mode.Major, [{ note: "F", acc: AccidentalType.Sharp }]);
      expect(getKeyAccidentalFor("F", gMajor)).to.equal(1);
    });

    it("C in G major returns 0 (C natural)", () => {
      const gMajor = makeKeySignature(KeyRoot.G, KeyAccidental.None, Mode.Major, [{ note: "F", acc: AccidentalType.Sharp }]);
      expect(getKeyAccidentalFor("C", gMajor)).to.equal(0);
    });

    it("B in F major returns -1 (Bb)", () => {
      const fMajor = makeKeySignature(KeyRoot.F, KeyAccidental.None, Mode.Major, [{ note: "B", acc: AccidentalType.Flat }]);
      expect(getKeyAccidentalFor("B", fMajor)).to.equal(-1);
    });

    it("returns 0 for all notes in C major", () => {
      const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
      for (const letter of LETTERS) {
        expect(getKeyAccidentalFor(letter, cMajor)).to.equal(0);
      }
    });
  });

  describe("deriveDiatonicChord", () => {
    describe("example-based tests", () => {
      it("C in C major returns Cmaj7", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("C", cMajor);

        expect(chord.root).to.equal(KeyRoot.C);
        expect(chord.rootAccidental).to.equal(KeyAccidental.None);
        expect(chord.quality).to.equal(ChordQuality.Major);
        expect(chord.extension).to.equal(7);
      });

      it("D in C major returns Dm7 (ii chord)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("D", cMajor);

        expect(chord.root).to.equal(KeyRoot.D);
        expect(chord.quality).to.equal(ChordQuality.Minor);
        expect(chord.extension).to.equal(7);
      });

      it("E in C major returns Em7 (iii chord)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("E", cMajor);

        expect(chord.root).to.equal(KeyRoot.E);
        expect(chord.quality).to.equal(ChordQuality.Minor);
        expect(chord.extension).to.equal(7);
      });

      it("F in C major returns Fmaj7 (IV chord)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("F", cMajor);

        expect(chord.root).to.equal(KeyRoot.F);
        expect(chord.quality).to.equal(ChordQuality.Major);
        expect(chord.extension).to.equal(7);
      });

      it("G in C major returns G7 (V chord - dominant)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("G", cMajor);

        expect(chord.root).to.equal(KeyRoot.G);
        expect(chord.quality).to.equal(ChordQuality.Dominant);
        expect(chord.extension).to.equal(7);
      });

      it("A in C major returns Am7 (vi chord)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("A", cMajor);

        expect(chord.root).to.equal(KeyRoot.A);
        expect(chord.quality).to.equal(ChordQuality.Minor);
        expect(chord.extension).to.equal(7);
      });

      it("B in C major returns Bm7b5 (vii chord - half-diminished)", () => {
        const cMajor = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const chord = deriveDiatonicChord("B", cMajor);

        expect(chord.root).to.equal(KeyRoot.B);
        expect(chord.quality).to.equal(ChordQuality.HalfDiminished);
        expect(chord.extension).to.equal(7);
      });

      it("A in A minor returns Am7 (i chord)", () => {
        const aMinor = makeKeySignature(KeyRoot.A, KeyAccidental.None, Mode.Minor, []);
        const chord = deriveDiatonicChord("A", aMinor);

        expect(chord.root).to.equal(KeyRoot.A);
        expect(chord.quality).to.equal(ChordQuality.Minor);
        expect(chord.extension).to.equal(7);
      });

      it("F in G major returns F#m7b5 (vii chord)", () => {
        const gMajor = makeKeySignature(KeyRoot.G, KeyAccidental.None, Mode.Major, [{ note: "F", acc: AccidentalType.Sharp }]);
        const chord = deriveDiatonicChord("F", gMajor);

        expect(chord.root).to.equal(KeyRoot.F);
        expect(chord.rootAccidental).to.equal(KeyAccidental.Sharp);
        expect(chord.quality).to.equal(ChordQuality.HalfDiminished);
      });
    });

    describe("property-based tests", () => {
      it("always returns a chord with extension 7", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(Mode.Major, Mode.Minor, Mode.Dorian),
            fc.constantFrom("C", "D", "E", "F", "G", "A", "B"),
            (root, mode, rootLetter) => {
              const key = makeKeySignature(root, KeyAccidental.None, mode, []);
              const chord = deriveDiatonicChord(rootLetter, key);
              expect(chord.extension).to.equal(7);
            }
          )
        );
      });

      it("chord root letter matches input rootLetter", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(Mode.Major, Mode.Minor),
            fc.constantFrom("C", "D", "E", "F", "G", "A", "B"),
            (root, mode, rootLetter) => {
              const key = makeKeySignature(root, KeyAccidental.None, mode, []);
              const chord = deriveDiatonicChord(rootLetter, key);
              expect(keyRootToLetter(chord.root)).to.equal(rootLetter);
            }
          )
        );
      });

      it("for any key, the 7 diatonic chords have qualities matching DIATONIC_QUALITIES distribution", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B),
            fc.constantFrom(Mode.Major, Mode.Minor, Mode.Dorian),
            (root, mode) => {
              const key = makeKeySignature(root, KeyAccidental.None, mode, []);
              const chords = LETTERS.map((letter) => deriveDiatonicChord(letter, key));
              const qualities = chords.map((c) => c.quality);

              // The multiset of qualities should match DIATONIC_QUALITIES
              const expectedQualities = DIATONIC_QUALITIES.map((q) => q.quality).sort();
              const actualQualities = [...qualities].sort();
              expect(actualQualities).to.deep.equal(expectedQualities);
            }
          )
        );
      });
    });
  });

  describe("parallel transform helpers", () => {
    describe("voicedNoteOctave", () => {
      it("derives octave 4 for middle C", () => {
        const note: VoicedNote = { spelling: { letter: "C", alteration: 0 }, midi: 60, func: 8 };
        expect(voicedNoteOctave(note)).to.equal(4);
      });

      it("derives octave 5 for C above middle C", () => {
        const note: VoicedNote = { spelling: { letter: "C", alteration: 0 }, midi: 72, func: 8 };
        expect(voicedNoteOctave(note)).to.equal(5);
      });

      it("handles sharped notes correctly", () => {
        // F#4 = MIDI 66
        const note: VoicedNote = { spelling: { letter: "F", alteration: 1 }, midi: 66, func: 8 };
        expect(voicedNoteOctave(note)).to.equal(4);
      });

      it("handles enharmonic Cb correctly", () => {
        // Cb5 = MIDI 71 (same as B4)
        const note: VoicedNote = { spelling: { letter: "C", alteration: -1 }, midi: 71, func: 8 };
        expect(voicedNoteOctave(note)).to.equal(5);
      });
    });

    describe("shiftChordDiatonic", () => {
      it("shifts a triad up by one diatonic step in C major", () => {
        const cMajorKey = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const cTriad: VoicedNote[] = [
          { spelling: { letter: "C", alteration: 0 }, midi: 60, func: 8 },
          { spelling: { letter: "E", alteration: 0 }, midi: 64, func: 3 },
          { spelling: { letter: "G", alteration: 0 }, midi: 67, func: 5 },
        ];
        const result = shiftChordDiatonic(cTriad, 1, cMajorKey);
        expect(result[0].spelling.letter).to.equal("D");
        expect(result[1].spelling.letter).to.equal("F");
        expect(result[2].spelling.letter).to.equal("A");
      });

      it("handles negative offsets", () => {
        const cMajorKey = makeKeySignature(KeyRoot.C, KeyAccidental.None, Mode.Major, []);
        const dNote: VoicedNote[] = [{ spelling: { letter: "D", alteration: 0 }, midi: 62, func: 8 }];
        const result = shiftChordDiatonic(dNote, -1, cMajorKey);
        expect(result[0].spelling.letter).to.equal("C");
      });

      it("applies key signature accidentals", () => {
        const gMajorKey = makeKeySignature(KeyRoot.G, KeyAccidental.None, Mode.Major, []); // F#
        const gNote: VoicedNote[] = [{ spelling: { letter: "G", alteration: 0 }, midi: 67, func: 8 }];
        const result = shiftChordDiatonic(gNote, -1, gMajorKey);
        expect(result[0].spelling.letter).to.equal("F");
        expect(result[0].spelling.alteration).to.equal(1); // F#
      });
    });

    describe("shiftChordChromatic", () => {
      it("shifts MIDI pitches and spells according to context", () => {
        const noteSpellings: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        const { notes } = shiftChordChromatic([60, 64, 67], 2, noteSpellings);
        expect(notes[0].midi).to.equal(62); // D
        expect(notes[1].midi).to.equal(66); // F#
        expect(notes[2].midi).to.equal(69); // A
      });

      it("returns accidentals that differ from context", () => {
        const noteSpellings: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        const { notes, newAccidentals } = shiftChordChromatic([60], 1, noteSpellings);
        expect(notes[0].midi).to.equal(61); // Db or C#
        expect(newAccidentals.length).to.be.greaterThan(0);
      });
    });
  });
});
