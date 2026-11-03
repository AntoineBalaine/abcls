import { KeyRoot, KeyAccidental } from "../types/abcjs-ast";

/**
 * Chord quality enumeration for jazz chord notation.
 * This is separate from key mode because chord quality describes
 * triad structure, not scale patterns.
 */
export enum ChordQuality {
  Major = "major",
  Minor = "minor",
  Dominant = "dominant",
  Diminished = "diminished",
  Augmented = "augmented",
  HalfDiminished = "half-diminished",
  Suspended2 = "sus2",
  Suspended4 = "sus4",
  Power = "power",
  Add = "add",
  Altered = "altered",
  // A minor triad with a major 7th (minMaj7)
  MinorMajor7 = "minor-major-7",
  // A diminished triad with a major 7th (dimMaj7)
  DiminishedMajor7 = "diminished-major-7",
}

/**
 * Chord alteration (e.g., #5, b9, #11).
 */
export interface ChordAlteration {
  type: "sharp" | "flat";
  degree: number;
}

/**
 * Parsed chord symbol structure.
 */
export interface ParsedChord {
  root: KeyRoot;
  rootAccidental: KeyAccidental;
  quality: ChordQuality;
  qualityExplicit: boolean;
  extension: number | null;
  alterations: ChordAlteration[];
  /**
   * The degrees of the tones that the chord adds without changing its quality, in the order they were written.
   * Because "Cm(add9)" is a minor chord with an added ninth, the minor quality stays in `quality` and the 9 goes here.
   * It is empty for a chord with no added tone.
   */
  addedTones: number[];
  bass: {
    root: KeyRoot;
    accidental: KeyAccidental;
  } | null;
}

/**
 * Token types for chord symbol scanning.
 * These are separate from the main TT enum because chord tokens
 * are only used internally by the music-theory module.
 */
export enum ChordTT {
  ROOT = "CHORD_ROOT",
  ACCIDENTAL = "CHORD_ACCIDENTAL",
  QUALITY = "CHORD_QUALITY",
  EXTENSION = "CHORD_EXTENSION",
  ALTERATION = "CHORD_ALTERATION",
  BASS_SLASH = "CHORD_BASS_SLASH",
  GROUP_OPEN = "CHORD_GROUP_OPEN",
  GROUP_CLOSE = "CHORD_GROUP_CLOSE",
}

/**
 * Lightweight token structure for chord symbol scanning.
 * We do not need full Token class features (ID, line/position)
 * for ephemeral chord tokens.
 */
export interface ChordToken {
  type: ChordTT;
  lexeme: string;
}

/**
 * Note spellings map: for each letter (C-B), the current semitone alteration.
 * Used to represent key signature + measure accidentals combined.
 */
export type NoteSpellings = Record<"C" | "D" | "E" | "F" | "G" | "A" | "B", number>;
