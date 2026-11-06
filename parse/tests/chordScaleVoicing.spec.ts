import { expect } from "chai";
import fc from "fast-check";
import { NATURAL_SEMITONES } from "../music-theory/constants";
import {
  VoicedNote,
  buildChord,
  getAvailableTensions,
  buildScaleCloseVoicing,
  buildScaleSpreadVoicing,
  MAX_BASS_GAP,
  MAX_UPPER_GAP,
  LOW_INTERVAL_LIMITS,
  swapChordForRootLead,
  keyRootToLetter,
  keyAccidentalToSemitones,
} from "../music-theory/harmonization";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyRoot, KeyAccidental, KeySignature, Mode } from "../types/abcjs-ast";

function makeChord(root: KeyRoot, accidental: KeyAccidental, quality: ChordQuality, extension: number | null = null): ParsedChord {
  return { root, rootAccidental: accidental, quality, qualityExplicit: true, extension, alterations: [], addedTones: [], bass: null };
}

function makeKey(root: KeyRoot): KeySignature {
  return { root, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] };
}

const C_MAJOR = makeKey(KeyRoot.C);

/** The degrees of the available tensions of a chord, with its root placed near C5. */
function tensionDegrees(chord: ParsedChord, key: KeySignature = C_MAJOR): number[] {
  const rootPosChord = buildChord(chord, 72);
  return Array.from(getAvailableTensions(rootPosChord, chord, key).keys()).sort((a, b) => a - b);
}

/** The letters of the voices, from the top voice to the bottom voice. */
function letters(voices: VoicedNote[]): string {
  return voices
    .map((voice) => voice.spelling.letter)
    .reverse()
    .join("");
}

/** The voicing that voiceChord builds: the sixth chord swap comes first, and then the walk. */
function scaleClose(written: ParsedChord, leadMidi: number, voiceCount: number, key: KeySignature = C_MAJOR): VoicedNote[] | null {
  const chord = swapChordForRootLead(written, leadMidi % 12);
  const rootPosChord = buildChord(chord, leadMidi);
  const tensions = getAvailableTensions(rootPosChord, chord, key);
  return buildScaleCloseVoicing(rootPosChord, tensions, leadMidi, voiceCount);
}

const ROOTS = [KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G, KeyRoot.A, KeyRoot.B];
const ACCIDENTALS = [KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat];
const QUALITIES = [ChordQuality.Major, ChordQuality.Minor, ChordQuality.Dominant, ChordQuality.HalfDiminished];

describe("the unified tension rule", () => {
  describe("example-based tests", () => {
    it("keeps the 9, the 11 and the 13 of Dm7 in C, because none lies a half step above a chord tone", () => {
      expect(tensionDegrees(makeChord(KeyRoot.D, KeyAccidental.None, ChordQuality.Minor, 7))).to.deep.equal([9, 11, 13]);
    });

    it("keeps only the 11 of Em7 in C, because the 9 and the 13 lie a half step above the root and the fifth", () => {
      expect(tensionDegrees(makeChord(KeyRoot.E, KeyAccidental.None, ChordQuality.Minor, 7))).to.deep.equal([11]);
    });

    it("drops the 13 of Am7 in C, because it lies a half step above the fifth", () => {
      expect(tensionDegrees(makeChord(KeyRoot.A, KeyAccidental.None, ChordQuality.Minor, 7))).to.deep.equal([9, 11]);
    });

    it("drops the 11 of G7 in C, because it lies a half step above the third", () => {
      expect(tensionDegrees(makeChord(KeyRoot.G, KeyAccidental.None, ChordQuality.Dominant, 7))).to.deep.equal([9, 13]);
    });

    it("drops the 11 of Cmaj7, because it lies a half step above the third", () => {
      expect(tensionDegrees(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7))).to.deep.equal([9, 13]);
    });

    it("keeps the #11 of a dominant chord, because no chord tone lies a half step below it", () => {
      const chord = { ...makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7), alterations: [{ type: "sharp" as const, degree: 11 }] };
      expect(tensionDegrees(chord)).to.include(11);
    });

    it("keeps the b9 of a dominant chord that the chord symbol writes", () => {
      const chord = { ...makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7), alterations: [{ type: "flat" as const, degree: 9 }] };
      expect(tensionDegrees(chord)).to.include(9);
    });
  });

  describe("property-based tests", () => {
    it("never offers a tension that lies a half step above a chord tone, except the b9 above the root of a dominant chord", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ROOTS),
          fc.constantFrom(...ACCIDENTALS),
          fc.constantFrom(...QUALITIES),
          fc.constantFrom(...ROOTS),
          (root, accidental, quality, keyRoot) => {
            const chord = makeChord(root, accidental, quality, 7);
            const rootPosChord = buildChord(chord, 72);
            const tensions = getAvailableTensions(rootPosChord, chord, makeKey(keyRoot));
            for (const tension of tensions.values()) {
              for (let index = 0; index < rootPosChord.length; index++) {
                if (index === 0 && quality === ChordQuality.Dominant) continue;
                const distance = (tension.midi - rootPosChord[index].midi + 120) % 12;
                if (distance === 1) return false;
              }
            }
            return true;
          }
        )
      );
    });
  });
});

describe("the sixth chord swap", () => {
  const rootPitchClass = (chord: ParsedChord): number =>
    (NATURAL_SEMITONES[keyRootToLetter(chord.root)] + keyAccidentalToSemitones(chord.rootAccidental) + 12) % 12;

  describe("example-based tests", () => {
    it("turns Cmaj7 into C6 when the lead is C", () => {
      const swapped = swapChordForRootLead(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7), 0);
      expect(swapped.quality).to.equal(ChordQuality.Major);
      expect(swapped.extension).to.equal(6);
    });

    it("turns CmMaj7 into Cm6 when the lead is C", () => {
      const swapped = swapChordForRootLead(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.MinorMajor7), 0);
      expect(swapped.quality).to.equal(ChordQuality.Minor);
      expect(swapped.extension).to.equal(6);
    });

    it("leaves Cmaj7 as it is when the lead is E", () => {
      const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);
      expect(swapChordForRootLead(chord, 4)).to.equal(chord);
    });

    it("leaves C7 as it is when the lead is C", () => {
      const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Dominant, 7);
      expect(swapChordForRootLead(chord, 0)).to.equal(chord);
    });

    it("leaves C6 as it is when the lead is C", () => {
      const chord = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 6);
      expect(swapChordForRootLead(chord, 0)).to.equal(chord);
    });

    it("handles a flat root: Dbmaj7 with the lead Db becomes Db6", () => {
      const swapped = swapChordForRootLead(makeChord(KeyRoot.D, KeyAccidental.Flat, ChordQuality.Major, 7), 1);
      expect(swapped.extension).to.equal(6);
    });
  });

  describe("property-based tests", () => {
    it("returns the chord untouched when the lead is not the root", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ROOTS),
          fc.constantFrom(...ACCIDENTALS),
          fc.constantFrom(...QUALITIES),
          fc.integer({ min: 0, max: 11 }),
          (root, accidental, quality, lead) => {
            const chord = makeChord(root, accidental, quality, 7);
            return lead === rootPitchClass(chord) || swapChordForRootLead(chord, lead) === chord;
          }
        )
      );
    });

    it("leaves no minor 2nd between the lead and the voice below it for a major seventh chord", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ROOTS),
          fc.constantFrom(...ACCIDENTALS),
          fc.integer({ min: 4, max: 6 }),
          fc.integer({ min: 60, max: 84 }),
          (root, accidental, voiceCount, leadMidi) => {
            const voices = scaleClose(makeChord(root, accidental, ChordQuality.Major, 7), leadMidi, voiceCount);
            if (voices === null) return true;
            return leadMidi - voices[voices.length - 2].midi > 2;
          }
        )
      );
    });
  });
});

describe("the chord scale close voicing", () => {
  describe("example-based tests", () => {
    it("voices Cmaj7 under E with six voices as E C B A G D", () => {
      const voices = scaleClose(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7), 76, 6);
      expect(letters(voices!)).to.equal("ECBAGD");
    });

    it("voices Cmaj7 under C as the chord C6, and the sixth voice doubles the lead", () => {
      const voices = scaleClose(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7), 72, 6);
      expect(letters(voices!)).to.equal("CAGEDC");
      expect(voices![0].midi).to.equal(60);
    });

    it("adds the seventh of Dm7 under D with six voices, because the seven-note scale would drop it", () => {
      const voices = scaleClose(makeChord(KeyRoot.D, KeyAccidental.None, ChordQuality.Minor, 7), 74, 6);
      expect(letters(voices!)).to.equal("DBAGFC");
    });

    it("adds the seventh of Cmaj7 under G with four voices", () => {
      const voices = scaleClose(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7), 79, 4);
      expect(letters(voices!)).to.equal("GECB");
    });

    it("doubles the third below the 11th and not the lead when the scale runs out: G#m7 in E under D# with six voices", () => {
      const voices = scaleClose(makeChord(KeyRoot.G, KeyAccidental.Sharp, ChordQuality.Minor, 7), 75, 6, makeKey(KeyRoot.E));
      expect(letters(voices!)).to.equal("DBGFCB");
    });

    it("doubles the third below the 11th and not the lead when the scale runs out: G#m7 in E under D# with six voices", () => {
      const voices = scaleClose(makeChord(KeyRoot.G, KeyAccidental.Sharp, ChordQuality.Minor, 7), 75, 6, makeKey(KeyRoot.E));
      expect(letters(voices!)).to.equal("DBGFCB");
    });

    it("leaves the 13th out of B7 under its 7th A, because it would lie a minor 9th below the lead: B7 in E with six voices", () => {
      const voices = scaleClose(makeChord(KeyRoot.B, KeyAccidental.None, ChordQuality.Dominant, 7), 81, 6, makeKey(KeyRoot.E));
      expect(letters(voices!)).to.equal("AFDCBA");
    });

    it("returns null when the lead is not in the chord scale", () => {
      expect(scaleClose(makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7), 77, 4)).to.equal(null);
    });
  });

  describe("property-based tests", () => {
    const voicingArb = fc.record({
      root: fc.constantFrom(...ROOTS),
      accidental: fc.constantFrom(...ACCIDENTALS),
      quality: fc.constantFrom(...QUALITIES),
      keyRoot: fc.constantFrom(...ROOTS),
      voiceCount: fc.integer({ min: 4, max: 6 }),
      leadMidi: fc.integer({ min: 60, max: 84 }),
    });

    function build(input: { root: KeyRoot; accidental: KeyAccidental; quality: ChordQuality; keyRoot: KeyRoot; voiceCount: number; leadMidi: number }) {
      const voices = scaleClose(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi, input.voiceCount, makeKey(input.keyRoot));
      return voices;
    }

    it("builds exactly the requested voices, with the lead on top and no two voices on the same pitch", () => {
      fc.assert(
        fc.property(voicingArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const midis = voices.map((voice) => voice.midi);
          const isStrictlyAscending = midis.every((midi, index) => index === 0 || midi > midis[index - 1]);
          return voices.length === input.voiceCount && midis[midis.length - 1] === input.leadMidi && isStrictlyAscending;
        })
      );
    });

    it("keeps more than 2 semitones between the lead and the second voice", () => {
      fc.assert(
        fc.property(voicingArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          return input.leadMidi - voices[voices.length - 2].midi > 2;
        })
      );
    });

    it("never puts a voice a minor 2nd (or a minor 9th) below the lead", () => {
      fc.assert(
        fc.property(voicingArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          return voices.every((voice) => (input.leadMidi - voice.midi) % 12 !== 1);
        })
      );
    });

    it("keeps the third and the seventh of the chord", () => {
      fc.assert(
        fc.property(voicingArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const chord = swapChordForRootLead(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi % 12);
          const rootPosChord = buildChord(chord, input.leadMidi);
          const pitchClasses = new Set(voices.map((voice) => voice.midi % 12));
          return [rootPosChord[1], rootPosChord[3]].every((guideTone) => pitchClasses.has(guideTone.midi % 12));
        })
      );
    });

    it("only uses the notes of the chord scale", () => {
      fc.assert(
        fc.property(voicingArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const chord = swapChordForRootLead(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi % 12);
          const rootPosChord = buildChord(chord, input.leadMidi);
          const tensions = getAvailableTensions(rootPosChord, chord, makeKey(input.keyRoot));
          const allowed = new Set([...rootPosChord.map((note) => note.midi % 12), ...Array.from(tensions.values()).map((note) => note.midi % 12)]);
          return voices.every((voice) => allowed.has(voice.midi % 12));
        })
      );
    });
  });
});

/** The voicing that voiceChord builds for the chord scale spread voicing: the sixth chord swap comes first, and then the loop. */
function scaleSpread(written: ParsedChord, leadMidi: number, voiceCount: number, key: KeySignature = C_MAJOR): VoicedNote[] | null {
  const chord = swapChordForRootLead(written, leadMidi % 12);
  const rootPosChord = buildChord(chord, leadMidi);
  const tensions = getAvailableTensions(rootPosChord, chord, key);
  return buildScaleSpreadVoicing(rootPosChord, tensions, leadMidi, voiceCount);
}

describe("the chord scale spread voicing", () => {
  const cmaj7 = makeChord(KeyRoot.C, KeyAccidental.None, ChordQuality.Major, 7);

  describe("example-based tests", () => {
    it("pushes the voices of Cmaj7 under E down until the low interval limit stops it: E A G B C with five voices", () => {
      const voices = scaleSpread(cmaj7, 76, 5);
      expect(letters(voices!)).to.equal("EAGBC");
      expect(voices!.map((voice) => voice.midi)).to.deep.equal([48, 59, 67, 69, 76]);
    });

    it("makes room for the root with four voices: E A B C", () => {
      const voices = scaleSpread(cmaj7, 76, 4);
      expect(letters(voices!)).to.equal("EABC");
    });

    it("keeps a 10th, and not a 3rd, between the bass and the voice above it: B7 under F# in E with six voices", () => {
      const voices = scaleSpread(makeChord(KeyRoot.B, KeyAccidental.None, ChordQuality.Dominant, 7), 78, 6, makeKey(KeyRoot.E));
      expect(voices!.map((voice) => voice.midi)).to.deep.equal([35, 51, 61, 68, 69, 78]);
    });

    it("lowers the bass of G#m under D# in E with six voices, where it formed a 3rd with the voice above", () => {
      const voices = scaleSpread(makeChord(KeyRoot.G, KeyAccidental.Sharp, ChordQuality.Minor, 7), 75, 6, makeKey(KeyRoot.E));
      expect(voices![1].midi - voices![0].midi).to.equal(15);
    });

    it("returns null when the lead is not in the chord scale", () => {
      expect(scaleSpread(cmaj7, 77, 5)).to.equal(null);
    });
  });

  describe("property-based tests", () => {
    const spreadArb = fc.record({
      root: fc.constantFrom(...ROOTS),
      accidental: fc.constantFrom(...ACCIDENTALS),
      quality: fc.constantFrom(...QUALITIES),
      keyRoot: fc.constantFrom(...ROOTS),
      voiceCount: fc.integer({ min: 4, max: 6 }),
      leadMidi: fc.integer({ min: 60, max: 90 }),
    });

    function build(input: { root: KeyRoot; accidental: KeyAccidental; quality: ChordQuality; keyRoot: KeyRoot; voiceCount: number; leadMidi: number }) {
      return scaleSpread(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi, input.voiceCount, makeKey(input.keyRoot));
    }

    it("builds the requested voices, ascending, with the lead on top and the root in the bass", () => {
      fc.assert(
        fc.property(spreadArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const chord = swapChordForRootLead(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi % 12);
          const rootPitchClass = buildChord(chord, input.leadMidi)[0].midi % 12;
          const midis = voices.map((voice) => voice.midi);
          const isStrictlyAscending = midis.every((midi, index) => index === 0 || midi > midis[index - 1]);
          return voices.length === input.voiceCount && midis[midis.length - 1] === input.leadMidi && isStrictlyAscending && midis[0] % 12 === rootPitchClass;
        })
      );
    });

    it("respects the spacing limits and the low interval limits", () => {
      fc.assert(
        fc.property(spreadArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const bassGap = voices[1].midi - voices[0].midi;
          const minBass = LOW_INTERVAL_LIMITS[bassGap];
          let upperOk = true;
          for (let index = 2; index < voices.length; index++) {
            if (voices[index].midi - voices[index - 1].midi > MAX_UPPER_GAP) upperOk = false;
          }
          return bassGap <= MAX_BASS_GAP && (minBass === undefined || voices[0].midi >= minBass) && upperOk;
        })
      );
    });

    it("never leaves a 3rd between the bass and the voice above it", () => {
      fc.assert(
        fc.property(spreadArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const bassGap = voices[1].midi - voices[0].midi;
          return bassGap !== 3 && bassGap !== 4;
        })
      );
    });

    it("only uses the notes of the chord scale and the root", () => {
      fc.assert(
        fc.property(spreadArb, (input) => {
          const voices = build(input);
          if (voices === null) return true;
          const chord = swapChordForRootLead(makeChord(input.root, input.accidental, input.quality, 7), input.leadMidi % 12);
          const rootPosChord = buildChord(chord, input.leadMidi);
          const tensions = getAvailableTensions(rootPosChord, chord, makeKey(input.keyRoot));
          const allowed = new Set([...rootPosChord.map((note) => note.midi % 12), ...Array.from(tensions.values()).map((note) => note.midi % 12)]);
          return voices.every((voice) => allowed.has(voice.midi % 12));
        })
      );
    });
  });
});
