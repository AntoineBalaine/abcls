import { KeyRoot, KeyAccidental, KeySignature, AccidentalType, Mode } from "../types/abcjs-ast";
import { Chord, Note } from "../types/Expr";
import { Spelling, LETTERS, NATURAL_SEMITONES, SHARP_ORDER, FLAT_ORDER, MAJOR_KEY_SHARPS, MODE_FIFTH_OFFSET } from "./constants";
import { accidentalTypeToSemitones, computeOctaveFromPitch, noteLetterToMidi, accidentalToSemitones, spellPitch } from "./pitchUtils";
import { ChordQuality, ParsedChord, NoteSpellings } from "./types";

/**
 * VoicedNote combines a spelling with its MIDI pitch and chord function.
 * This allows tracking both the sounding pitch and how it should be written.
 */
export interface VoicedNote {
  spelling: Spelling;
  midi: number;
  func: ChordFunction;
}

/**
 * Derives the octave number from a VoicedNote's MIDI pitch and spelling.
 * This centralizes the octave calculation used by toChordAst and shiftChordDiatonic.
 */
export function voicedNoteOctave(note: VoicedNote): number {
  const letterSemitone = NATURAL_SEMITONES[note.spelling.letter];
  return Math.round((note.midi - letterSemitone - 60) / 12) + 4;
}

/**
 * Converts a Chord AST to VoicedNote[] for harmonization processing.
 * This bridges the AST representation with the VoicedNote representation
 * used by the harmonization module.
 */
export function chordToVoicedNotes(chord: Chord, key: KeySignature, measureAccidentals: Map<string, AccidentalType>): VoicedNote[] {
  const result: VoicedNote[] = [];
  for (const content of chord.contents) {
    if (!(content instanceof Note)) continue;

    const pitch = content.pitch;
    const letter = pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
    const octave = computeOctaveFromPitch(pitch);

    let alteration: number;
    if (pitch.alteration) {
      alteration = accidentalToSemitones(pitch.alteration.lexeme);
    } else if (measureAccidentals.has(letter)) {
      alteration = accidentalTypeToSemitones(measureAccidentals.get(letter)!);
    } else {
      alteration = getKeyAccidentalFor(letter, key);
    }

    const midi = noteLetterToMidi(letter, octave) + alteration;

    result.push({
      spelling: { letter, alteration },
      midi,
      func: 8, // func is not meaningful for parallel transforms
    });
  }
  return result;
}

/**
 * Shifts all notes in a VoicedNote array diatonically by the given offset.
 * Because the new notes should stay diatonic to the current key, we use the
 * key signature for their alteration.
 */
export function shiftChordDiatonic(refNotes: VoicedNote[], diatonicOffset: number, key: KeySignature): VoicedNote[] {
  const result: VoicedNote[] = [];
  for (const note of refNotes) {
    const letterIndex = LETTERS.indexOf(note.spelling.letter);
    const octave = voicedNoteOctave(note);

    const newIndex = letterIndex + diatonicOffset;
    const octaveShift = Math.floor(newIndex / 7);
    const normalizedIndex = ((newIndex % 7) + 7) % 7;
    const newLetter = LETTERS[normalizedIndex];
    const newOctave = octave + octaveShift;

    const newAlteration = getKeyAccidentalFor(newLetter, key);
    const newMidi = noteLetterToMidi(newLetter, newOctave) + newAlteration;

    result.push({
      spelling: { letter: newLetter, alteration: newAlteration },
      midi: newMidi,
      func: 8,
    });
  }
  return result;
}

/**
 * Shifts MIDI pitches chromatically and spells them according to context.
 * Because the chromatic shift might result in pitches outside the key, we return
 * a list of spellings that need explicit accidentals.
 */
export function shiftChordChromatic(
  refMidis: number[],
  chromaticOffset: number,
  noteSpellings: NoteSpellings
): { notes: VoicedNote[]; newAccidentals: Spelling[] } {
  const notes: VoicedNote[] = [];
  const newAccidentals: Spelling[] = [];

  for (const refMidi of refMidis) {
    const newMidi = refMidi + chromaticOffset;
    const spelling = spellPitch(newMidi, noteSpellings, chromaticOffset);

    const contextAlt = noteSpellings[spelling.letter] ?? 0;
    if (spelling.alteration !== contextAlt) {
      newAccidentals.push(spelling);
    }

    notes.push({
      spelling,
      midi: newMidi,
      func: 8,
    });
  }

  return { notes, newAccidentals };
}

/**
 * ChordFunction identifies the role of a note within a chord.
 * 8 = root, 3 = third, 5 = fifth, 7 = seventh, 9/11/13 = tensions.
 */
export type ChordFunction = 8 | 3 | 5 | 7 | 9 | 11 | 13;

/**
 * IntervalSpec combines an interval with its chord function and scale step.
 * This allows building chords with correct function assignments directly.
 */
export interface IntervalSpec {
  func: ChordFunction;
  interval: number;
  scaleStep: number;
}

/**
 * Basic interval patterns for chord qualities (triads only, without 7th).
 * Used by chordPitches.ts for flexible chord building.
 */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  [ChordQuality.Major]: [0, 4, 7],
  [ChordQuality.Minor]: [0, 3, 7],
  [ChordQuality.Dominant]: [0, 4, 7],
  [ChordQuality.Diminished]: [0, 3, 6],
  [ChordQuality.Augmented]: [0, 4, 8],
  [ChordQuality.HalfDiminished]: [0, 3, 6],
  [ChordQuality.Suspended2]: [0, 2, 7],
  [ChordQuality.Suspended4]: [0, 5, 7],
  [ChordQuality.Power]: [0, 7],
  [ChordQuality.Add]: [0, 4, 7],
  // Altered dominant
  [ChordQuality.Altered]: [0, 4, 7],
  // Minor triad, major 7th
  [ChordQuality.MinorMajor7]: [0, 3, 7],
  // Diminished triad, major 7th
  [ChordQuality.DiminishedMajor7]: [0, 3, 6],
};

/**
 * Interval patterns for chord qualities as 4-note 7th chords.
 * Each entry includes the chord function, interval in semitones, and scale step.
 * This is used by the harmonization module, which is designed for 7th-based harmonies.
 */
export const SEVENTH_CHORD_SPECS: Record<ChordQuality, IntervalSpec[]> = {
  [ChordQuality.Major]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 4, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 11, scaleStep: 6 },
  ],
  [ChordQuality.Minor]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 3, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  [ChordQuality.Dominant]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 4, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  [ChordQuality.Diminished]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 3, scaleStep: 2 },
    { func: 5, interval: 6, scaleStep: 4 },
    { func: 7, interval: 9, scaleStep: 6 },
  ],
  [ChordQuality.Augmented]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 4, scaleStep: 2 },
    { func: 5, interval: 8, scaleStep: 4 },
    { func: 7, interval: 11, scaleStep: 6 },
  ],
  [ChordQuality.HalfDiminished]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 3, scaleStep: 2 },
    { func: 5, interval: 6, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  [ChordQuality.Suspended2]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 2, scaleStep: 1 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  [ChordQuality.Suspended4]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 5, scaleStep: 3 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  [ChordQuality.Power]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 8, interval: 12, scaleStep: 0 },
    { func: 5, interval: 19, scaleStep: 4 },
  ],
  [ChordQuality.Add]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 4, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 11, scaleStep: 6 },
  ],
  // Altered dominant: same unaltered dominant 7th shape as
  // ChordQuality.Dominant above — see QUALITY_INTERVALS's Altered entry
  // for why the implied altered tensions aren't represented here.
  [ChordQuality.Altered]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 4, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 10, scaleStep: 6 },
  ],
  // Minor triad with a major 7th (minMaj7), not the minor 7th Minor uses.
  [ChordQuality.MinorMajor7]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 3, scaleStep: 2 },
    { func: 5, interval: 7, scaleStep: 4 },
    { func: 7, interval: 11, scaleStep: 6 },
  ],
  // Diminished triad with a major 7th (dimMaj7), not the diminished 7th
  // Diminished uses nor the minor 7th HalfDiminished uses.
  [ChordQuality.DiminishedMajor7]: [
    { func: 8, interval: 0, scaleStep: 0 },
    { func: 3, interval: 3, scaleStep: 2 },
    { func: 5, interval: 6, scaleStep: 4 },
    { func: 7, interval: 11, scaleStep: 6 },
  ],
};

/**
 * Maps chord degree to its natural interval in semitones from the root.
 */
export const DEGREE_TO_INTERVAL: Record<number, number> = { 3: 4, 5: 7, 7: 11 };

/**
 * Default intervals for tension notes (9, 11, 13) in semitones from root.
 */
export const DEFAULT_TENSION_INTERVALS: Record<number, number> = {
  9: 14,
  11: 17,
  13: 21,
};

/**
 * Maps tension degrees to their scale step relative to root (0-indexed from root).
 * 9th is scale step 1 (D in C), 11th is scale step 3 (F in C), 13th is scale step 5 (A in C).
 * This is used for spelling tensions correctly (determining the letter name).
 * Note: This is distinct from FUNC_FOR_TENSION which maps tensions to the chord
 * function they substitute. The values 11->3 and 13->5 appear in both but for
 * different reasons: here they indicate scale position, there they indicate
 * substitution targets.
 */
export const TENSION_SCALE_STEPS: Record<number, number> = { 9: 1, 11: 3, 13: 5 };

/**
 * Maps chord tones to their corresponding tension substitution.
 * Root (8) can be substituted by 9th, third (3) by 11th, fifth (5) by 13th.
 */
export const TENSION_FOR: Record<number, number> = { 8: 9, 3: 11, 5: 13 };

/**
 * Maps tensions back to the chord function they can substitute.
 * 9th substitutes root (8), 11th substitutes 3rd (3), 13th substitutes 5th (5).
 */
export const FUNC_FOR_TENSION: Record<number, number> = { 9: 8, 11: 3, 13: 5 };

/**
 * Maps intervals (in semitones) to their scale steps (for spelling purposes).
 * Scale steps are 0-indexed from the root: 0=root, 1=2nd, 2=3rd, etc.
 */
export const INTERVAL_TO_SCALE_STEP: Record<number, number> = {
  0: 0, // root
  2: 1, // sus2
  3: 2, // minor 3rd
  4: 2, // major 3rd
  5: 3, // sus4
  6: 4, // diminished 5th
  7: 4, // perfect 5th
  8: 4, // augmented 5th
  9: 5, // 6th or diminished 7th
  10: 6, // minor 7th
  11: 6, // major 7th
  14: 1, // 9th (octave + 2nd)
  17: 3, // 11th (octave + 4th)
  21: 5, // 13th (octave + 6th)
};

/**
 * Maps intervals (in semitones) to their chord function.
 * Chord functions: 8=root, 3=third, 5=fifth, 7=seventh, 9/11/13=tensions.
 */
export const INTERVAL_TO_FUNC: Record<number, ChordFunction> = {
  0: 8, // root
  2: 3, // sus2 acts as 3
  3: 3, // minor 3rd
  4: 3, // major 3rd
  5: 3, // sus4 acts as 3
  6: 5, // dim 5th
  7: 5, // perfect 5th
  8: 5, // aug 5th
  9: 7, // 6th/dim 7th
  10: 7, // minor 7th
  11: 7, // major 7th
  14: 9, // 9th
  17: 11, // 11th
  21: 13, // 13th
};

/**
 * Low Interval Limits map interval sizes (in semitones) to minimum bass MIDI pitches.
 * Because small intervals in the bass register create acoustic muddiness, we require
 * the bass to be placed at or above these thresholds.
 */
export const LOW_INTERVAL_LIMITS: Record<number, number> = {
  1: 52, // m2: E3
  2: 51, // M2: Eb3
  3: 48, // m3: C3
  4: 46, // M3: Bb2
  5: 46, // P4: Bb2
  6: 46, // tritone: Bb2
  7: 34, // P5: Bb1
  8: 43, // m6: G2
  9: 41, // M6: F2
  10: 41, // m7: F2
  11: 41, // M7: F2
  12: 0, // octave: no limit
  13: 40, // m9: E2
  14: 39, // M9: Eb2
  15: 36, // m10: C2
  16: 34, // M10: Bb1
};

/**
 * Places a bass note at the lowest octave that respects the low interval limit.
 * The bass is pushed down by octaves until it would go below minBass, then
 * pushed up if needed.
 *
 * @param noteMidi The MIDI pitch of the bass note (any octave)
 * @param minBass The minimum allowed MIDI pitch for the bass
 * @returns The placed MIDI pitch
 */
export function placeBassWithLIL(noteMidi: number, minBass: number): number {
  let result = noteMidi;
  while (result >= minBass + 12) {
    result -= 12;
  }
  while (result < minBass) {
    result += 12;
  }
  return result;
}

/**
 * Places a note in the octave just above the floor, below the ceiling.
 * Returns null if no valid placement exists.
 *
 * @param noteMidi The MIDI pitch of the note (any octave)
 * @param floorMidi The floor pitch (note must be strictly above this)
 * @param ceilingMidi The ceiling pitch (note must be strictly below this)
 * @returns The placed MIDI pitch, or null if it cannot fit
 */
export function placeAboveFloor(noteMidi: number, floorMidi: number, ceilingMidi: number): number | null {
  let result = noteMidi;
  while (result <= floorMidi) {
    result += 12;
  }
  while (result > floorMidi + 12) {
    result -= 12;
  }
  if (result <= floorMidi || result >= ceilingMidi) {
    return null;
  }
  return result;
}

/**
 * Returns possible middle voice arrangements for 6-voice spread voicings.
 * The arrangement is the list of VoicedNotes to place between GT1 and lead.
 * Multiple arrangements are returned when there is branching (interchangeable pairs).
 *
 * @param lead The lead note (top voice)
 * @param tensions Available tensions (filtered from getAvailableTensions)
 * @param GT2 The second guide tone (null if lead is a guide tone)
 * @param fifth The fifth of the chord
 * @param root The root of the chord
 * @returns Array of possible arrangements, or null if no valid arrangement exists
 */
export function getArrangements6(lead: VoicedNote, tensions: VoicedNote[], GT2: VoicedNote | null, fifth: VoicedNote, root: VoicedNote): VoicedNote[][] | null {
  const leadFunc = lead.func;
  const tensionCount = tensions.length;

  // CASE: lead is tension (9, 11, 13)
  if (leadFunc === 9 || leadFunc === 11 || leadFunc === 13) {
    const leadTension = tensions.find((t) => t.func === leadFunc);
    const otherTensions = tensions.filter((t) => t.func !== leadFunc);

    if (leadTension === undefined) return null;
    if (GT2 === null) return null;

    if (tensionCount >= 3) {
      // [GT2, T3, T2]
      return [[GT2, otherTensions[1], otherTensions[0]]];
    }
    if (tensionCount === 2) {
      // [GT2, T1-8vb, T2]
      return [[GT2, leadTension, otherTensions[0]]];
    }
    if (tensionCount === 1) {
      // [(GT2, root_or_fifth), T1-8vb] - branching
      return [
        [GT2, fifth, leadTension],
        [fifth, GT2, leadTension],
        [GT2, root, leadTension],
        [root, GT2, leadTension],
      ];
    }
    return null;
  }

  // CASE: lead is guide tone (3 or 7)
  if (leadFunc === 3 || leadFunc === 7) {
    if (tensionCount >= 3) {
      // [T1, T2, T3]
      return [[tensions[0], tensions[1], tensions[2]]];
    }
    if (tensionCount === 2) {
      // [root_or_fifth, T1, T2] - branching
      return [
        [root, tensions[0], tensions[1]],
        [fifth, tensions[0], tensions[1]],
      ];
    }
    if (tensionCount === 1) {
      // [(root, fifth), T1] - branching
      return [
        [root, fifth, tensions[0]],
        [fifth, root, tensions[0]],
      ];
    }
    return null;
  }

  // CASE: lead is root (8)
  if (leadFunc === 8) {
    if (GT2 === null) return null;
    if (tensionCount >= 2) {
      // [GT2, T1, T2]
      return [[GT2, tensions[0], tensions[1]]];
    }
    if (tensionCount === 1) {
      // [GT2, fifth, T1]
      return [[GT2, fifth, tensions[0]]];
    }
    return null;
  }

  // CASE: lead is fifth (5)
  if (leadFunc === 5) {
    if (GT2 === null) return null;
    if (tensionCount >= 2) {
      // [GT2, T1, T2]
      return [[GT2, tensions[0], tensions[1]]];
    }
    if (tensionCount === 1) {
      // [(GT2, fifth_double), T1] - branching
      return [
        [GT2, fifth, tensions[0]],
        [fifth, GT2, tensions[0]],
      ];
    }
    return null;
  }

  return null;
}

/**
 * Returns possible middle voice arrangements for 5-voice spread voicings.
 *
 * @param lead The lead note (top voice)
 * @param tensions Available tensions
 * @param GT2 The second guide tone (null if lead is a guide tone)
 * @param fifth The fifth of the chord
 * @param root The root of the chord
 * @returns Array of possible arrangements, or null if no valid arrangement exists
 */
export function getArrangements5(lead: VoicedNote, tensions: VoicedNote[], GT2: VoicedNote | null, fifth: VoicedNote, root: VoicedNote): VoicedNote[][] | null {
  const leadFunc = lead.func;
  const tensionCount = tensions.length;

  // CASE: lead is tension
  if (leadFunc === 9 || leadFunc === 11 || leadFunc === 13) {
    const otherTensions = tensions.filter((t) => t.func !== leadFunc);

    if (GT2 === null) return null;

    if (tensionCount >= 3) {
      // [GT2, T2/T3] - pick 1 of 2 others
      return [
        [GT2, otherTensions[0]],
        [GT2, otherTensions[1]],
      ];
    }
    if (tensionCount === 2) {
      // [GT2, T2]
      return [[GT2, otherTensions[0]]];
    }
    if (tensionCount === 1) {
      // [(GT2, root_or_fifth)]
      return [
        [GT2, fifth],
        [fifth, GT2],
        [GT2, root],
        [root, GT2],
      ];
    }
    return null;
  }

  // CASE: lead is guide tone
  if (leadFunc === 3 || leadFunc === 7) {
    if (tensionCount >= 3) {
      // Pick 2 of 3 tensions
      return [
        [tensions[0], tensions[1]],
        [tensions[0], tensions[2]],
        [tensions[1], tensions[2]],
      ];
    }
    if (tensionCount === 2) {
      // [T1, T2]
      return [[tensions[0], tensions[1]]];
    }
    if (tensionCount === 1) {
      // [(root, fifth), T1]
      return [
        [root, tensions[0]],
        [fifth, tensions[0]],
      ];
    }
    return null;
  }

  // CASE: lead is root
  if (leadFunc === 8) {
    if (GT2 === null) return null;
    if (tensionCount >= 2) {
      // [GT2, T1/T2]
      return [
        [GT2, tensions[0]],
        [GT2, tensions[1]],
      ];
    }
    if (tensionCount === 1) {
      // [GT2, T1]
      return [[GT2, tensions[0]]];
    }
    return null;
  }

  // CASE: lead is fifth
  if (leadFunc === 5) {
    if (GT2 === null) return null;
    if (tensionCount >= 2) {
      // [GT2, T1/T2]
      return [
        [GT2, tensions[0]],
        [GT2, tensions[1]],
      ];
    }
    if (tensionCount === 1) {
      // [GT2, T1]
      return [[GT2, tensions[0]]];
    }
    return null;
  }

  return null;
}

/**
 * Returns possible middle voice arrangements for 4-voice spread voicings.
 *
 * @param lead The lead note (top voice)
 * @param tensions Available tensions (not used for 4-voice, but kept for consistency)
 * @param GT2 The second guide tone (null if lead is a guide tone)
 * @param fifth The fifth of the chord
 * @param root The root of the chord (not used for 4-voice, but kept for consistency)
 * @returns Array of possible arrangements, or null if no valid arrangement exists
 */
export function getArrangements4(lead: VoicedNote, GT2: VoicedNote | null, fifth: VoicedNote): VoicedNote[][] | null {
  const leadFunc = lead.func;

  // CASE: lead is tension
  if (leadFunc === 9 || leadFunc === 11 || leadFunc === 13) {
    if (GT2 === null) return null;
    return [[GT2]];
  }

  // CASE: lead is guide tone
  if (leadFunc === 3 || leadFunc === 7) {
    return [[fifth]];
  }

  // CASE: lead is root or fifth
  if (leadFunc === 8 || leadFunc === 5) {
    if (GT2 === null) return null;
    return [[GT2]];
  }

  return null;
}

/**
 * Scores a voicing based on voice leading from the previous chord.
 * Returns a negative penalty proportional to total voice movement.
 * Both arrays are assumed to be sorted low to high by MIDI pitch.
 *
 * @param voicing The candidate voicing
 * @param prevMidi MIDI pitches of the previous chord (sorted low to high)
 * @returns Negative penalty (higher is better, 0 is no movement)
 */
export function scoreVoiceLeading(voicing: VoicedNote[], prevMidi: number[]): number {
  let penalty = 0;
  const minLen = Math.min(voicing.length, prevMidi.length);

  for (let i = 0; i < minLen; i++) {
    penalty += Math.abs(voicing[i].midi - prevMidi[i]);
  }

  // Penalize voice count differences
  penalty += Math.abs(voicing.length - prevMidi.length) * 12;

  return -penalty;
}

/**
 * Scores a voicing based on spread quality.
 * Rewards narrowing intervals from bottom to top.
 *
 * @param voicing The candidate voicing (sorted low to high by MIDI)
 * @returns Score (positive is better)
 */
export function scoreSpreadQuality(voicing: VoicedNote[]): number {
  let score = 0;

  for (let i = 2; i < voicing.length; i++) {
    const interval = voicing[i].midi - voicing[i - 1].midi;
    const prevInterval = voicing[i - 1].midi - voicing[i - 2].midi;

    if (interval <= prevInterval) {
      score += 10;
    } else {
      score -= 5;
    }
  }

  return score;
}

/**
 * Places each arrangement from the decision tree and returns all valid voicings.
 * Invalid arrangements (where a voice cannot fit) are filtered out.
 *
 * @param arrangements Array of middle voice arrangements from getArrangements
 * @param bassMidi Placed bass MIDI pitch
 * @param gtMidi Placed GT1 MIDI pitch
 * @param leadMidi Lead MIDI pitch (ceiling for middle voices)
 * @param bassNote The bass VoicedNote (for spelling)
 * @param gtNote The GT1 VoicedNote (for spelling)
 * @param lead The lead VoicedNote
 * @returns Array of valid complete voicings (sorted low to high)
 */
export function placeArrangements(
  arrangements: VoicedNote[][],
  bassMidi: number,
  gtMidi: number,
  leadMidi: number,
  bassNote: VoicedNote,
  gtNote: VoicedNote,
  lead: VoicedNote
): VoicedNote[][] {
  const results: VoicedNote[][] = [];

  for (const arrangement of arrangements) {
    const voices: VoicedNote[] = [];

    // Bass and GT1 already placed
    voices.push({ spelling: bassNote.spelling, midi: bassMidi, func: bassNote.func });
    voices.push({ spelling: gtNote.spelling, midi: gtMidi, func: gtNote.func });

    // Place middle voices
    let floor = gtMidi;
    let valid = true;

    for (const note of arrangement) {
      const placed = placeAboveFloor(note.midi, floor, leadMidi);
      if (placed === null) {
        valid = false;
        break;
      }

      voices.push({ spelling: note.spelling, midi: placed, func: note.func });
      floor = placed;
    }

    if (!valid) continue;

    // Add lead
    voices.push({ spelling: lead.spelling, midi: leadMidi, func: lead.func });

    // Sort by MIDI pitch
    voices.sort((a, b) => a.midi - b.midi);
    results.push(voices);
  }

  return results;
}

/**
 * Builds a spread voicing for the given chord and lead note.
 * Returns the best voicing based on voice leading and spread quality scoring,
 * or null if no valid voicing exists.
 *
 * @param rootPosChord Root-position 7th chord (from buildChord)
 * @param tensions Available tensions (from getAvailableTensions)
 * @param lead The lead note with its chord function
 * @param voiceCount Number of voices (4, 5, or 6)
 * @param prevMidi MIDI pitches of previous chord for voice leading (null if none)
 * @returns The best voicing, or null if no valid voicing exists
 */
export function buildSpreadVoicing(
  rootPosChord: VoicedNote[],
  tensions: Map<9 | 11 | 13, VoicedNote>,
  lead: VoicedNote,
  voiceCount: 4 | 5 | 6,
  prevMidi: number[] | null
): VoicedNote[] | null {
  // Get notes by function
  const root = rootPosChord.find((n) => n.func === 8);
  const third = rootPosChord.find((n) => n.func === 3);
  const fifth = rootPosChord.find((n) => n.func === 5);
  const seventh = rootPosChord.find((n) => n.func === 7);

  if (root === undefined || fifth === undefined) return null;

  // Build tension list from the Map values
  const tensionList = Array.from(tensions.values());

  // Determine guide tones
  // GT1 is placed after bass; GT2 is available for middle voices
  let GT1: VoicedNote | undefined;
  let GT2: VoicedNote | null;

  if (lead.func === 3) {
    GT1 = seventh;
    GT2 = null; // lead is the other guide tone
  } else if (lead.func === 7) {
    GT1 = third;
    GT2 = null;
  } else {
    GT1 = third;
    GT2 = seventh ?? null;
  }

  if (GT1 === undefined) return null;

  const bassNote = root;
  const gtNote = GT1;

  // Calculate bass-GT interval, prefer 10th over 3rd
  let interval = (gtNote.midi - bassNote.midi) % 12;
  if (interval <= 4) {
    interval += 12;
  }

  // Place bass respecting low interval limits
  const minBass = LOW_INTERVAL_LIMITS[interval] ?? 34;
  const bassMidi = placeBassWithLIL(bassNote.midi, minBass);
  const gtMidi = bassMidi + interval;

  // GT must be below lead
  if (gtMidi >= lead.midi) return null;

  // Get arrangements based on voice count
  let arrangements: VoicedNote[][] | null;
  if (voiceCount === 6) {
    arrangements = getArrangements6(lead, tensionList, GT2, fifth, root);
  } else if (voiceCount === 5) {
    arrangements = getArrangements5(lead, tensionList, GT2, fifth, root);
  } else {
    arrangements = getArrangements4(lead, GT2, fifth);
  }

  if (arrangements === null || arrangements.length === 0) return null;

  // Place each arrangement and collect valid voicings
  const voicings = placeArrangements(arrangements, bassMidi, gtMidi, lead.midi, bassNote, gtNote, lead);

  if (voicings.length === 0) return null;

  // Score and pick best
  let bestVoicing: VoicedNote[] | null = null;
  let bestScore = -Infinity;

  for (const voicing of voicings) {
    let score = scoreSpreadQuality(voicing);
    if (prevMidi !== null) {
      score += scoreVoiceLeading(voicing, prevMidi);
    }
    if (score > bestScore) {
      bestScore = score;
      bestVoicing = voicing;
    }
  }

  return bestVoicing;
}

/**
 * Converts a KeyRoot enum to its letter name.
 */
export function keyRootToLetter(root: KeyRoot): "C" | "D" | "E" | "F" | "G" | "A" | "B" {
  const mapping: Record<KeyRoot, string> = {
    [KeyRoot.C]: "C",
    [KeyRoot.D]: "D",
    [KeyRoot.E]: "E",
    [KeyRoot.F]: "F",
    [KeyRoot.G]: "G",
    [KeyRoot.A]: "A",
    [KeyRoot.B]: "B",
    [KeyRoot.HP]: "A", // Highland Pipes default to A
    [KeyRoot.Hp]: "A",
  };
  return (mapping[root] as "C" | "D" | "E" | "F" | "G" | "A" | "B") ?? "C";
}

/**
 * Converts a KeyAccidental enum to semitone adjustment.
 */
export function keyAccidentalToSemitones(acc: KeyAccidental | null): number {
  if (acc === null) return 0;
  switch (acc) {
    case KeyAccidental.Sharp:
      return 1;
    case KeyAccidental.Flat:
      return -1;
    case KeyAccidental.None:
      return 0;
    default:
      return 0;
  }
}

/**
 * Computes the interval specs for a parsed chord, including all 4 voices and alterations.
 * Each spec includes the chord function, interval, and scale step.
 * This harmonization module always produces 4-note 7th chords.
 */
export function getIntervals(chord: ParsedChord): IntervalSpec[] {
  const specs = structuredClone(SEVENTH_CHORD_SPECS[chord.quality]);

  // Apply alterations by finding the entry with matching function and adjusting interval
  for (const alt of chord.alterations) {
    // Map alteration degrees to chord functions
    // Degrees 3, 5, 7 map to functions 3, 5, 7
    // Tensions would be handled differently but we're building 4-note chords here
    const targetFunc = alt.degree as ChordFunction;
    const offset = alt.type === "sharp" ? 1 : -1;

    const entry = specs.find((s) => s.func === targetFunc);
    if (entry !== undefined) {
      entry.interval += offset;
    }
  }

  return specs;
}

/**
 * Spells a note given a root letter index, root semitone, target scale step, and interval.
 * The scale step determines the target letter (rootIndex + scaleStep in LETTERS),
 * and the alteration is computed by comparing the interval to the natural distance.
 *
 * @param rootIndex Index of the root letter in LETTERS (0=C, 1=D, etc.)
 * @param rootSemitone The semitone value of the root (accounting for its own alteration)
 * @param scaleStep Number of scale steps from root to target (0=root, 1=second, 2=third, etc.)
 * @param interval The interval in semitones from root to target note
 * @returns The spelling of the target note
 */
export function spellFromRoot(rootIndex: number, rootSemitone: number, scaleStep: number, interval: number): Spelling {
  const targetIndex = (rootIndex + scaleStep) % 7;
  const targetLetter = LETTERS[targetIndex];
  const naturalTargetSemitone = NATURAL_SEMITONES[targetLetter];

  // The actual semitone we need
  const targetSemitone = (rootSemitone + interval) % 12;

  // Compute the alteration needed
  let alteration = targetSemitone - naturalTargetSemitone;

  // Normalize to range [-6, 5] to handle wrap-around (e.g., B to C)
  if (alteration > 6) alteration -= 12;
  if (alteration < -6) alteration += 12;

  return { letter: targetLetter, alteration };
}

/**
 * Builds a root-position 7th chord (4 notes) with correct spellings for each voice.
 * The leadMidi parameter is used to determine the octave placement.
 *
 * @param chord The parsed chord structure
 * @param leadMidi The MIDI pitch of the melody note (used for octave reference)
 * @returns Array of 4 VoicedNotes: root, 3rd, 5th, 7th
 */
export function buildChord(chord: ParsedChord, leadMidi: number): VoicedNote[] {
  const rootLetter = keyRootToLetter(chord.root);
  const rootAccSemitones = keyAccidentalToSemitones(chord.rootAccidental);
  const rootIndex = LETTERS.indexOf(rootLetter);
  const rootNaturalSemitone = NATURAL_SEMITONES[rootLetter];
  const rootSemitone = (rootNaturalSemitone + rootAccSemitones + 12) % 12;

  // Compute base octave from leadMidi. We use (leadMidi - 1) to handle the octave
  // boundary correctly: C notes should be grouped with the notes below them (B, Bb, etc.)
  // so that a lead of C5 (72) builds the chord in the same octave as B4 (71).
  const baseOctave = Math.floor((leadMidi - 1) / 12);
  const rootMidi = baseOctave * 12 + rootSemitone;

  // getIntervals now returns IntervalSpec[] with func, interval, and scaleStep
  const specs = getIntervals(chord);

  const result: VoicedNote[] = [];

  for (const spec of specs) {
    const spelling = spellFromRoot(rootIndex, rootSemitone, spec.scaleStep, spec.interval);
    const midi = rootMidi + spec.interval;
    result.push({ spelling, midi, func: spec.func });
  }

  return result;
}

// ============================================================================
// Phase 2: Chord Tone Validation
// ============================================================================

/**
 * Checks whether a MIDI pitch matches any chord tone by pitch class.
 * The comparison ignores octave, so C4 (60) matches C5 (72).
 *
 * @param midi The MIDI pitch to check
 * @param rootPosChord The root-position chord (array of VoicedNotes)
 * @returns true if the pitch class matches any chord tone
 */
export function isChordTone(midi: number, rootPosChord: VoicedNote[]): boolean {
  const leadPitchClass = midi % 12;
  return rootPosChord.some((n) => n.midi % 12 === leadPitchClass);
}

/**
 * Calculates which tensions (9, 11, 13) are available for a chord.
 * A tension is unavailable (an "avoid note") if it forms a minor 2nd (1 semitone)
 * above a guide tone (3rd or 7th).
 *
 * Tensions are derived from the chord scale based on the key signature.
 *
 * The function assumes rootPosChord has at least 4 notes: root, 3rd, 5th, 7th.
 *
 * @param rootPosChord The root-position 7th chord (array of 4 VoicedNotes)
 * @param chord The parsed chord structure (used for alterations)
 * @param key Key signature for deriving tensions from the chord scale
 * @returns Map from tension degree (9, 11, or 13) to VoicedNote
 */
export function getAvailableTensions(rootPosChord: VoicedNote[], chord: ParsedChord, key: KeySignature): Map<9 | 11 | 13, VoicedNote> {
  const thirdMidi = rootPosChord[1].midi;
  const seventhMidi = rootPosChord[3].midi;
  const root = rootPosChord[0];
  const rootMidi = root.midi;
  const rootIndex = LETTERS.indexOf(root.spelling.letter);
  const rootSemitone = (NATURAL_SEMITONES[root.spelling.letter] + root.spelling.alteration + 12) % 12;

  // Build tension intervals from the key's chord scale
  const tensionIntervals: Record<number, number> = {};
  for (const degree of [9, 11, 13] as const) {
    const scaleStep = TENSION_SCALE_STEPS[degree];
    const tensionLetter = LETTERS[(rootIndex + scaleStep) % 7];
    const keyAccidental = getKeyAccidentalFor(tensionLetter, key);
    const naturalTensionSemitone = NATURAL_SEMITONES[tensionLetter];
    const adjustedTensionSemitone = (naturalTensionSemitone + keyAccidental + 12) % 12;
    const intervalFromRoot = (adjustedTensionSemitone - rootSemitone + 12) % 12;
    // Tensions are in the second octave, so we add 12
    tensionIntervals[degree] = intervalFromRoot + 12;
  }

  // Apply explicit chord alterations (these override key-derived intervals)
  for (const alt of chord.alterations) {
    if (alt.degree === 9 || alt.degree === 11 || alt.degree === 13) {
      const offset = alt.type === "sharp" ? 1 : -1;
      tensionIntervals[alt.degree] += offset;
    }
  }

  const available = new Map<9 | 11 | 13, VoicedNote>();

  for (const degree of [9, 11, 13] as const) {
    const interval = tensionIntervals[degree];
    const tensionMidi = rootMidi + interval;

    // Avoid note check: minor 2nd above 3rd or 7th
    // We compute (tensionPitchClass - guideTonePitchClass + 12) % 12 === 1
    const tensionPitchClass = tensionMidi % 12;
    const thirdPitchClass = thirdMidi % 12;
    const seventhPitchClass = seventhMidi % 12;
    const rootPitchClass = rootMidi % 12;

    const isMinor2ndAboveThird = (tensionPitchClass - thirdPitchClass + 12) % 12 === 1;
    const isMinor2ndAboveSeventh = (tensionPitchClass - seventhPitchClass + 12) % 12 === 1;
    // Minor 9th (minor 2nd above root) is an avoid note, except on dominant chords
    const isMinor9th = degree === 9 && (tensionPitchClass - rootPitchClass + 12) % 12 === 1;
    const isMinor9thAvoid = isMinor9th && chord.quality !== ChordQuality.Dominant;

    const isAvoidNote = isMinor2ndAboveThird || isMinor2ndAboveSeventh || isMinor9thAvoid;

    if (!isAvoidNote) {
      const spelling = spellFromRoot(rootIndex, rootSemitone, TENSION_SCALE_STEPS[degree], interval % 12);
      available.set(degree, { spelling, midi: tensionMidi, func: degree });
    }
  }

  return available;
}

/**
 * Checks whether a MIDI pitch is either a chord tone or an available tension.
 * This determines if a melody note can be harmonized with the given chord.
 *
 * @param midi The MIDI pitch to check
 * @param rootPosChord The root-position 7th chord
 * @param chord The parsed chord structure
 * @param key Key signature for deriving tensions from the chord scale
 * @returns true if the pitch is a chord tone or available tension
 */
export function isChordScaleTone(midi: number, rootPosChord: VoicedNote[], chord: ParsedChord, key: KeySignature): boolean {
  if (isChordTone(midi, rootPosChord)) {
    return true;
  }

  const availableTensions = getAvailableTensions(rootPosChord, chord, key);
  const leadPitchClass = midi % 12;

  for (const tension of availableTensions.values()) {
    if (tension.midi % 12 === leadPitchClass) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Phase 3: Voicing Algorithms
// ============================================================================

/**
 * Inverts a chord so that the target MIDI pitch is on top.
 * All other voices are placed below by dropping them by octaves as needed.
 *
 * @param rootPositionChord The root-position chord to invert
 * @param targetMidi The MIDI pitch that should be the highest note
 * @returns A new array of VoicedNotes with the target on top
 */
export function invert(rootPositionChord: VoicedNote[], targetMidi: number): VoicedNote[] {
  const result = rootPositionChord.map((n) => ({ ...n }));

  for (let i = 0; i < result.length; i++) {
    while (result[i].midi > targetMidi) {
      result[i].midi -= 12;
    }
  }

  return result.sort((a, b) => a.midi - b.midi);
}

/**
 * Drops the second-highest voice by one octave.
 * This creates a more open voicing with wider spacing at the top.
 * Mutates the input array. If the chord has fewer than 2 notes, returns it unchanged.
 *
 * @param voicedChord The chord to transform (mutated in place)
 * @returns The same array, sorted by pitch
 */
export function drop2(voicedChord: VoicedNote[]): VoicedNote[] {
  if (voicedChord.length < 2) {
    return voicedChord;
  }
  voicedChord[voicedChord.length - 2].midi -= 12;
  return voicedChord.sort((a, b) => a.midi - b.midi);
}

/**
 * Drops the second and fourth-highest voices by one octave.
 * This creates an even more open voicing, common in big band arrangements.
 * Mutates the input array. If the chord has fewer than 4 notes, returns it unchanged.
 *
 * @param voicedChord The chord to transform (mutated in place)
 * @returns The same array, sorted by pitch
 */
export function drop24(voicedChord: VoicedNote[]): VoicedNote[] {
  if (voicedChord.length < 4) {
    return voicedChord;
  }
  voicedChord[voicedChord.length - 2].midi -= 12;
  voicedChord[voicedChord.length - 4].midi -= 12;
  return voicedChord.sort((a, b) => a.midi - b.midi);
}

/**
 * Drops the third-highest voice by one octave.
 * This creates an alternative open voicing.
 * Mutates the input array. If the chord has fewer than 3 notes, returns it unchanged.
 *
 * @param voicedChord The chord to transform (mutated in place)
 * @returns The same array, sorted by pitch
 */
export function drop3(voicedChord: VoicedNote[]): VoicedNote[] {
  if (voicedChord.length < 3) {
    return voicedChord;
  }
  voicedChord[voicedChord.length - 3].midi -= 12;
  return voicedChord.sort((a, b) => a.midi - b.midi);
}

/**
 * Adjusts a tension MIDI pitch to be within half an octave of a target pitch.
 * This keeps tension notes close to the chord tones they are substituting.
 *
 * @param tensionMidi The original MIDI pitch of the tension
 * @param targetMidi The target pitch to stay close to
 * @returns The adjusted MIDI pitch
 */
export function matchOctave(tensionMidi: number, targetMidi: number): number {
  let result = tensionMidi;
  while (result > targetMidi + 6) {
    result -= 12;
  }
  while (result < targetMidi - 6) {
    result += 12;
  }
  return result;
}

/**
 * Replaces chord tone doublings with available tensions.
 * Works from second-to-top downward, using the substitution rules:
 * root -> 9th, 3rd -> 11th, 5th -> 13th.
 *
 * @param voicedChord The chord with possible doublings
 * @param tensions Available tensions from getAvailableTensions
 * @returns A new array of VoicedNotes with tensions substituted
 */
export function substituteTensions(voicedChord: VoicedNote[], tensions: Map<9 | 11 | 13, VoicedNote>): VoicedNote[] {
  const result = voicedChord.map((n) => ({ ...n }));
  const availableTensions = new Map(tensions);

  for (let i = result.length - 2; i >= 0; i--) {
    const note = result[i];

    if (!(note.func in TENSION_FOR)) continue;

    const tensionDegree = TENSION_FOR[note.func] as 9 | 11 | 13;
    const tension = availableTensions.get(tensionDegree);
    if (tension === undefined) continue;

    result[i] = {
      spelling: tension.spelling,
      midi: matchOctave(tension.midi, note.midi),
      func: tension.func,
    };
    availableTensions.delete(tensionDegree);
  }

  return result;
}

/**
 * Builds a chord scale by combining chord tones and available tensions.
 * The result is sorted by pitch class (not absolute pitch).
 *
 * @param rootPosChord The root-position chord
 * @param tensions Available tensions from getAvailableTensions
 * @returns Array of VoicedNotes sorted by pitch class
 */
export function buildChordScale(rootPosChord: VoicedNote[], tensions: Map<9 | 11 | 13, VoicedNote>): VoicedNote[] {
  const scale = [...rootPosChord];
  for (const tension of tensions.values()) {
    scale.push(tension);
  }
  return scale.sort((a, b) => (a.midi % 12) - (b.midi % 12));
}

/**
 * Builds a cluster voicing by inverting the chord scale to put the lead on top,
 * then taking the top N voices. If the second-highest note is only 1 semitone
 * below the lead, it is dropped an octave to avoid excessive density at the top.
 *
 * @param chordScale The chord scale from buildChordScale
 * @param leadMidi The MIDI pitch to place on top
 * @param voiceCount How many voices to include in the final voicing
 * @returns Array of VoicedNotes representing the cluster voicing
 */
export function buildClusterVoicing(chordScale: VoicedNote[], leadMidi: number, voiceCount: number): VoicedNote[] {
  let inverted = invert(chordScale, leadMidi);

  // Drop note by octave if only 1 semitone below lead
  if (inverted.length > 1) {
    const top = inverted[inverted.length - 1].midi;
    const secondTop = inverted[inverted.length - 2].midi;
    if (top - secondTop === 1) {
      inverted[inverted.length - 2].midi -= 12;
      inverted = inverted.sort((a, b) => a.midi - b.midi);
    }
  }

  // Take top voiceCount notes
  return inverted.slice(-voiceCount);
}

// ============================================================================
// Phase 4: Diatonic Chord Derivation
// ============================================================================

/**
 * Diatonic seventh chord qualities for each scale degree in major scale.
 * I=maj7, ii=m7, iii=m7, IV=maj7, V=7, vi=m7, vii°=m7b5
 * Other modes rotate this array by their MODE_TO_OFFSET value.
 */
export const DIATONIC_QUALITIES: Array<{ quality: ChordQuality; extension: 7 }> = [
  { quality: ChordQuality.Major, extension: 7 },
  { quality: ChordQuality.Minor, extension: 7 },
  { quality: ChordQuality.Minor, extension: 7 },
  { quality: ChordQuality.Major, extension: 7 },
  { quality: ChordQuality.Dominant, extension: 7 },
  { quality: ChordQuality.Minor, extension: 7 },
  { quality: ChordQuality.HalfDiminished, extension: 7 },
];

/**
 * Finds the letter name that is a given interval below the input letter.
 * The interval is measured in scale degrees: 1 = unison, 3 = third, 5 = fifth, 8 = octave/unison.
 *
 * @param letter The starting letter (must be A-G)
 * @param interval The scale degree interval to descend (1-8)
 * @returns The letter that is `interval` scale degrees below `letter`
 */
export function descendScale(letter: "C" | "D" | "E" | "F" | "G" | "A" | "B", interval: number): "C" | "D" | "E" | "F" | "G" | "A" | "B" {
  if (interval === 8) return letter;
  const index = LETTERS.indexOf(letter);
  return LETTERS[(index - (interval - 1) + 7) % 7];
}

/**
 * Converts a letter string to its corresponding KeyRoot enum value.
 * If the letter is invalid, returns KeyRoot.C as a fallback.
 *
 * @param letter A letter from A-G (uppercase only)
 * @returns The corresponding KeyRoot enum value
 */
export function letterToKeyRoot(letter: string): KeyRoot {
  const mapping: Record<string, KeyRoot> = {
    C: KeyRoot.C,
    D: KeyRoot.D,
    E: KeyRoot.E,
    F: KeyRoot.F,
    G: KeyRoot.G,
    A: KeyRoot.A,
    B: KeyRoot.B,
  };
  const result = mapping[letter];
  return result ?? KeyRoot.C;
}

// Re-export from pitchUtils for convenience
export { accidentalTypeToSemitones };

/**
 * Converts a semitone adjustment to its corresponding KeyAccidental enum value.
 * Because KeyAccidental has only Sharp, Flat, and None, double sharps/flats are clamped.
 *
 * @param semitones The semitone adjustment (-2 to +2)
 * @returns The corresponding KeyAccidental
 */
export function semitonesToKeyAccidental(semitones: number): KeyAccidental {
  if (semitones >= 1) return KeyAccidental.Sharp;
  if (semitones <= -1) return KeyAccidental.Flat;
  return KeyAccidental.None;
}

/**
 * Returns the accidental (in semitones) that applies to a given letter in a key signature.
 * Derives the accidentals from the key root, accidental, and mode if the accidentals array is empty.
 *
 * @param letter The note letter (A-G)
 * @param key The key signature
 * @returns The semitone adjustment for this letter in the key (0 if natural)
 */
export function getKeyAccidentalFor(letter: string, key: KeySignature): number {
  // First check if accidentals array is populated (explicit accidentals)
  if (key.accidentals.length > 0) {
    const acc = key.accidentals.find((a) => a.note.toUpperCase() === letter.toUpperCase());
    if (acc) return accidentalTypeToSemitones(acc.acc);
    return 0;
  }

  // Derive accidentals from key root, accidental, and mode
  const rootKey = key.root + (key.acc === KeyAccidental.Sharp ? "#" : key.acc === KeyAccidental.Flat ? "b" : "");
  const baseSharps = MAJOR_KEY_SHARPS[rootKey];
  if (baseSharps === undefined) return 0; // Unknown key (e.g., HP)

  const modeOffset = MODE_FIFTH_OFFSET[key.mode] ?? 0;
  const sharps = baseSharps + modeOffset;

  const upperLetter = letter.toUpperCase();

  if (sharps > 0) {
    for (let i = 0; i < Math.min(sharps, 7); i++) {
      if (SHARP_ORDER[i] === upperLetter) return 1;
    }
  } else if (sharps < 0) {
    for (let i = 0; i < Math.min(-sharps, 7); i++) {
      if (FLAT_ORDER[i] === upperLetter) return -1;
    }
  }

  return 0;
}

/**
 * Merges key signature accidentals with measure accidentals.
 * Measure accidentals take precedence over key signature.
 *
 * @param key The key signature
 * @param measureAccidentals Map of letter to semitone alteration (already converted from AccidentalType)
 * @returns Object with { letter: semitoneAlteration } for all seven letters
 */
export function mergeAccidentals(key: KeySignature, measureAccidentals: Map<"C" | "D" | "E" | "F" | "G" | "A" | "B", number> | null): NoteSpellings {
  const result: NoteSpellings = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };

  // Apply key signature
  for (const letter of LETTERS) {
    result[letter] = getKeyAccidentalFor(letter, key);
  }

  // Overlay measure accidentals (already in semitones)
  if (measureAccidentals) {
    for (const [letter, semitones] of measureAccidentals) {
      result[letter] = semitones;
    }
  }

  return result;
}

/**
 * Maps Mode enum values to their offset in the DIATONIC_QUALITIES array.
 * Because Mode uses string values like "" for Major and "m" for Minor,
 * we need to map these to the correct rotation offsets.
 */
export const MODE_TO_OFFSET: Record<Mode, number> = {
  [Mode.Major]: 0,
  [Mode.Dorian]: 1,
  [Mode.Phrygian]: 2,
  [Mode.Lydian]: 3,
  [Mode.Mixolydian]: 4,
  [Mode.Minor]: 5,
  [Mode.Locrian]: 6,
};

/**
 * Derives the diatonic seventh chord for a given root letter in a key signature.
 * The chord quality is determined by the scale degree in the current mode.
 *
 * @param rootLetter The root letter of the chord (A-G)
 * @param key The key signature (determines mode and accidentals)
 * @returns A ParsedChord representing the diatonic 7th chord on that degree
 */
export function deriveDiatonicChord(rootLetter: "C" | "D" | "E" | "F" | "G" | "A" | "B", key: KeySignature): ParsedChord {
  const tonicLetter = keyRootToLetter(key.root);
  const tonicIndex = LETTERS.indexOf(tonicLetter);
  const rootIndex = LETTERS.indexOf(rootLetter);
  const scaleDegree = (rootIndex - tonicIndex + 7) % 7;

  const modeOffset = MODE_TO_OFFSET[key.mode] ?? 0;
  const chordType = DIATONIC_QUALITIES[(scaleDegree + modeOffset) % 7];
  const rootAccidentalSemitones = getKeyAccidentalFor(rootLetter, key);

  return {
    root: letterToKeyRoot(rootLetter),
    rootAccidental: semitonesToKeyAccidental(rootAccidentalSemitones),
    quality: chordType.quality,
    qualityExplicit: true,
    extension: chordType.extension,
    alterations: [],
    bass: null,
  };
}
