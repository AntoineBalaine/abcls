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
  // An altered dominant 7th (implied b9/#9/#11/b13 tensions), written
  // "alt" in iReal Pro chord shorthand (e.g. "C7alt"). Kept distinct from
  // Dominant rather than folded into it with explicit ChordAlteration
  // entries, since iReal's own text never spells out which specific
  // tensions "alt" implies — it's a single opaque quality word, not a
  // shorthand this codebase can expand into concrete alterations without
  // guessing.
  Altered = "altered",
  // A minor triad with a major 7th (minMaj7), written as the combined
  // symbol "-^" in iReal Pro chord shorthand (e.g. "C-^7") — distinct
  // from both Minor (minor 7th) and Major (major triad), common as a
  // minor key's tonic chord in jazz harmony.
  MinorMajor7 = "minor-major-7",
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
