/**
 * Shared constants and types for music theory operations.
 * These are centralized here to avoid circular dependencies between pitchUtils and harmonization.
 */

import { Mode } from "../types/abcjs-ast";

/**
 * Spelling represents how a note is written, independent of its MIDI pitch.
 * For example, F# and Gb have the same MIDI pitch but different spellings.
 */
export interface Spelling {
  letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; // "C", "D", "E", "F", "G", "A", "B"
  alteration: number; // semitones: -2 (double flat) to +2 (double sharp)
}

/**
 * The seven note letters in scale order starting from C.
 */
export const LETTERS: ("C" | "D" | "E" | "F" | "G" | "A" | "B")[] = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * Maps note letters to their natural semitone offset from C.
 */
export const NATURAL_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Order of sharps in key signatures (circle of fifths).
 */
export const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];

/**
 * Order of flats in key signatures (circle of fourths).
 */
export const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/**
 * Maps major key root+accidental to number of sharps (positive) or flats (negative).
 */
export const MAJOR_KEY_SHARPS: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  "C#": 7,
  // Because G# minor, D# minor and A# minor (5, 6 and 7 sharps) take their signature from these tonics, the major keys
  // beyond seven sharps are listed too; a mode subtracts its offset, which brings them back within seven.
  "G#": 8,
  "D#": 9,
  "A#": 10,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
};

/**
 * Mode offsets relative to major key (in fifths).
 */
export const MODE_FIFTH_OFFSET: Record<Mode, number> = {
  [Mode.Lydian]: 1,
  [Mode.Major]: 0,
  [Mode.Mixolydian]: -1,
  [Mode.Dorian]: -2,
  [Mode.Minor]: -3,
  [Mode.Phrygian]: -4,
  [Mode.Locrian]: -5,
};
