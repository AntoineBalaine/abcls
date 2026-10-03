import { chordToPitches } from "./chordPitches";
import { VoicedNote } from "./harmonization";
import { parseChordSymbol } from "./parseChordSymbol";
import { scanChordSymbol } from "./scanChordSymbol";
import { ParsedChord } from "./types";

export interface ChordInfo {
  parsed: ParsedChord;
  pitches: VoicedNote[] | null;
}

/**
 * Convenience function that combines scanning, parsing, and pitch generation.
 *
 * @param text The chord symbol text (e.g., "Am7", "Cmaj7#11")
 * @param baseOctave The base octave for pitch generation (default 4)
 * @returns ChordInfo with parsed chord and MIDI pitches, or null if invalid
 */
export function analyzeChordSymbol(text: string, baseOctave: number = 4): ChordInfo | null {
  const scanResult = scanChordSymbol(text);
  if (!scanResult) return null;

  const parsed = parseChordSymbol(scanResult.tokens);
  if (!parsed) return null;

  const pitches = chordToPitches(parsed, baseOctave);

  return { parsed, pitches };
}

// Re-export from submodules
export { scanChordSymbol, ScanResult } from "./scanChordSymbol";
export { parseChordSymbol } from "./parseChordSymbol";
export { chordToPitches } from "./chordPitches";
export { ParsedChord, ChordQuality, ChordAlteration, ChordTT, ChordToken, NoteSpellings } from "./types";

// Re-export shared key utilities for external consumers
export { parseKeyRoot, parseKeyAccidental } from "../utils/keyUtils";

// Re-export pitch utilities
export {
  PitchContext,
  KeyDirection,
  resolveMelodyPitch,
  pitchToNoteName,
  noteLetterToMidi,
  countOctaveMarkers,
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
} from "./pitchUtils";

// Re-export constants
export { Spelling, LETTERS, NATURAL_SEMITONES } from "./constants";

// Re-export number-notation (iReal Pro-style number chart) utilities
export { DegreeSpelling, nashvilleDegree, regularDegree, formatDegree } from "./numberNotation";

// Re-export harmonization types and functions
export {
  VoicedNote,
  ChordFunction,
  IntervalSpec,
  QUALITY_INTERVALS,
  SEVENTH_CHORD_SPECS,
  DEGREE_TO_INTERVAL,
  DEFAULT_TENSION_INTERVALS,
  TENSION_SCALE_STEPS,
  TENSION_FOR,
  FUNC_FOR_TENSION,
  INTERVAL_TO_SCALE_STEP,
  INTERVAL_TO_FUNC,
  keyRootToLetter,
  keyAccidentalToSemitones,
  getIntervals,
  spellFromRoot,
  buildChord,
  LOW_INTERVAL_LIMITS,
  placeBassWithLIL,
  placeAboveFloor,
  getArrangements4,
  getArrangements5,
  getArrangements6,
  scoreVoiceLeading,
  scoreSpreadQuality,
  placeArrangements,
  buildSpreadVoicing,
  // Phase 2: Chord Tone Validation
  isChordTone,
  getAvailableTensions,
  isChordScaleTone,
  // Phase 3: Voicing Algorithms
  invert,
  drop2,
  drop24,
  drop3,
  matchOctave,
  substituteTensions,
  buildChordScale,
  buildClusterVoicing,
  // Phase 4: Diatonic Chord Derivation
  DIATONIC_QUALITIES,
  descendScale,
  letterToKeyRoot,
  semitonesToKeyAccidental,
  getKeyAccidentalFor,
  mergeAccidentals,
  MODE_TO_OFFSET,
  deriveDiatonicChord,
  // Parallel transform helpers
  voicedNoteOctave,
  chordToVoicedNotes,
  shiftChordDiatonic,
  shiftChordChromatic,
} from "./harmonization";

// Re-export voice leading utilities
export { findPreviousChordInVoice, findNextChordInVoice } from "./voiceLeading";

// Re-export chord position collector types
export { ChordPositionCollector, ChordPosition, ChordCollectorConfig } from "../interpreter/ChordPositionCollector";
