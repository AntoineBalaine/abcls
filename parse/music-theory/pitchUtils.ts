import { KeySignature, AccidentalType, KeyAccidental } from "../types/abcjs-ast";
import { Pitch } from "../types/Expr";
import { Spelling, LETTERS, NATURAL_SEMITONES, SHARP_ORDER, FLAT_ORDER, MAJOR_KEY_SHARPS, MODE_FIFTH_OFFSET } from "./constants";
import { NoteSpellings } from "./types";

/**
 * The direction of a key signature for chromatic note spelling preference.
 * Sharp keys prefer sharp spellings for chromatic notes, flat keys prefer flat spellings.
 */
export type KeyDirection = "sharp" | "flat" | "neutral";

/**
 * Context for pitch resolution operations.
 * Contains the information needed to convert between written ABC notation
 * and sounding MIDI pitches.
 */
export interface PitchContext {
  key: KeySignature;
  measureAccidentals?: Map<string, AccidentalType>;
  transpose: number;
}

/**
 * Maps semitone offsets to possible enharmonic spellings.
 * Each entry contains [noteLetter, semitoneOffset] pairs.
 * For natural notes, there's one option. For accidental notes, there are two.
 */
const SEMITONE_TO_ENHARMONICS: Record<number, Array<[string, number]>> = {
  0: [["C", 0]],
  1: [
    ["C", 1],
    ["D", -1],
  ], // C# or Db
  2: [["D", 0]],
  3: [
    ["D", 1],
    ["E", -1],
  ], // D# or Eb
  4: [["E", 0]],
  5: [["F", 0]],
  6: [
    ["F", 1],
    ["G", -1],
  ], // F# or Gb
  7: [["G", 0]],
  8: [
    ["G", 1],
    ["A", -1],
  ], // G# or Ab
  9: [["A", 0]],
  10: [
    ["A", 1],
    ["B", -1],
  ], // A# or Bb
  11: [["B", 0]],
};

/**
 * Converts a note letter and octave to MIDI pitch number.
 * C4 (middle C) = 60.
 */
export function noteLetterToMidi(pitchClass: string, octave: number): number {
  const semitone = NATURAL_SEMITONES[pitchClass.toUpperCase()] ?? 0;
  return (octave + 1) * 12 + semitone;
}

/**
 * Counts octave markers in an ABC octave lexeme.
 * Returns positive for apostrophes (higher octave) and negative for commas (lower octave).
 */
export function countOctaveMarkers(lexeme: string): number {
  let count = 0;
  for (const char of lexeme) {
    if (char === "'") count++;
    else if (char === ",") count--;
  }
  return count;
}

/**
 * Converts an ABC accidental string to semitone adjustment.
 */
export function accidentalToSemitones(acc: string): number {
  switch (acc) {
    case "^^":
      return 2;
    case "^":
      return 1;
    case "=":
      return 0;
    case "_":
      return -1;
    case "__":
      return -2;
    default:
      return 0;
  }
}

/**
 * Converts an AccidentalType enum to semitone adjustment.
 */
export function accidentalTypeToSemitones(acc: AccidentalType | null): number {
  if (acc === null) return 0;
  switch (acc) {
    case AccidentalType.DblSharp:
      return 2;
    case AccidentalType.Sharp:
      return 1;
    case AccidentalType.Natural:
      return 0;
    case AccidentalType.Flat:
      return -1;
    case AccidentalType.DblFlat:
      return -2;
    case AccidentalType.QuarterSharp:
      return 0.5;
    case AccidentalType.QuarterFlat:
      return -0.5;
    default:
      return 0;
  }
}

/**
 * Converts a semitone adjustment to an ABC accidental string.
 */
export function semitonesToAccidentalString(semitones: number): string {
  switch (semitones) {
    case 2:
      return "^^";
    case 1:
      return "^";
    case 0:
      return "=";
    case -1:
      return "_";
    case -2:
      return "__";
    default:
      return "";
  }
}

/**
 * Converts a semitone adjustment to an AccidentalType enum.
 * This is the inverse of accidentalTypeToSemitones.
 */
export function semitonesToAccidentalType(semitones: number): AccidentalType {
  switch (semitones) {
    case 2:
      return AccidentalType.DblSharp;
    case 1:
      return AccidentalType.Sharp;
    case 0:
      return AccidentalType.Natural;
    case -1:
      return AccidentalType.Flat;
    case -2:
      return AccidentalType.DblFlat;
    default:
      return AccidentalType.Natural;
  }
}

/**
 * Gets the accidental for a pitch class from the key signature.
 * Derives the accidentals from the key root and mode if the accidentals array is empty.
 * Returns the AccidentalType if the note is altered in the key, null otherwise.
 */
export function getKeyAccidentalForPitch(pitchClass: string, key: KeySignature): AccidentalType | null {
  const upperPitch = pitchClass.toUpperCase();

  // First check if accidentals array is populated (explicit accidentals)
  if (key.accidentals.length > 0) {
    for (const acc of key.accidentals) {
      if (acc.note.toUpperCase() === upperPitch) {
        return acc.acc;
      }
    }
    return null;
  }

  // Derive accidentals from key root, accidental, and mode
  const rootKey = key.root + (key.acc === KeyAccidental.Sharp ? "#" : key.acc === KeyAccidental.Flat ? "b" : "");
  const baseSharps = MAJOR_KEY_SHARPS[rootKey];
  if (baseSharps === undefined) return null; // Unknown key (e.g., HP)

  const modeOffset = MODE_FIFTH_OFFSET[key.mode] ?? 0;
  const sharps = baseSharps + modeOffset;

  if (sharps > 0) {
    for (let i = 0; i < Math.min(sharps, 7); i++) {
      if (SHARP_ORDER[i] === upperPitch) return AccidentalType.Sharp;
    }
  } else if (sharps < 0) {
    for (let i = 0; i < Math.min(-sharps, 7); i++) {
      if (FLAT_ORDER[i] === upperPitch) return AccidentalType.Flat;
    }
  }

  return null;
}

/**
 * Converts a MIDI pitch to its natural note components.
 * Returns the first (sharp-preferring) enharmonic option.
 * For context-aware spelling, use pitchToNoteName instead.
 */
export function midiToNaturalNote(midiPitch: number): {
  naturalNote: string;
  octave: number;
  semitoneOffset: number;
} {
  const octave = Math.floor(midiPitch / 12) - 1;
  // Use ((n % 12) + 12) % 12 to handle negative MIDI values correctly
  const semitoneInOctave = ((midiPitch % 12) + 12) % 12;

  // Get the first enharmonic option (prefers sharps)
  const [naturalNote, semitoneOffset] = SEMITONE_TO_ENHARMONICS[semitoneInOctave][0];

  return { naturalNote, octave, semitoneOffset };
}

/**
 * Gets all possible enharmonic spellings for a MIDI pitch.
 */
function getEnharmonicOptions(midiPitch: number): Array<{
  noteLetter: string;
  octave: number;
  semitoneOffset: number;
}> {
  const octave = Math.floor(midiPitch / 12) - 1;
  // Use ((n % 12) + 12) % 12 to handle negative MIDI values correctly
  const semitoneInOctave = ((midiPitch % 12) + 12) % 12;

  return SEMITONE_TO_ENHARMONICS[semitoneInOctave].map(([noteLetter, semitoneOffset]) => ({
    noteLetter,
    octave,
    semitoneOffset,
  }));
}

/**
 * Resolves a melody note to its sounding MIDI pitch.
 *
 * The resolution follows this precedence:
 * 1. Explicit accidental on the note itself
 * 2. Measure accidental (previously seen accidental on same pitch class)
 * 3. Key signature accidental
 * 4. Natural (no accidental)
 *
 * Finally, the transpose offset is applied to get the sounding pitch.
 *
 * @param noteLetter The note letter (A-G, case insensitive)
 * @param noteOctave The octave number (4 = middle C octave)
 * @param explicitAccidental The explicit accidental string ("^", "_", "=", "^^", "__") or null
 * @param ctx The pitch context containing key, measure accidentals, and transpose
 * @returns The sounding MIDI pitch number
 */
/**
 * Builds the key under which a bar accidental is stored.
 *
 * Because ABC applies an accidental only to notes of the same pitch in the bar, an accidental on E4 must not affect E5.
 * Therefore the key carries both the letter and the octave, for example "E4".
 */
export function measureAccidentalKey(letter: string, octave: number): string {
  return `${letter.toUpperCase()}${octave}`;
}

export function resolveMelodyPitch(noteLetter: string, noteOctave: number, explicitAccidental: string | null, ctx: PitchContext): number {
  const pitchClass = noteLetter.toUpperCase();
  const baseMidi = noteLetterToMidi(pitchClass, noteOctave);

  let writtenPitch: number;

  if (explicitAccidental !== null) {
    // Explicit accidental takes precedence
    writtenPitch = baseMidi + accidentalToSemitones(explicitAccidental);
  } else if (ctx.measureAccidentals?.has(measureAccidentalKey(pitchClass, noteOctave))) {
    // Measure accidental (from earlier in the measure, on the same letter and octave)
    const measureAcc = ctx.measureAccidentals.get(measureAccidentalKey(pitchClass, noteOctave))!;
    writtenPitch = baseMidi + accidentalTypeToSemitones(measureAcc);
  } else {
    // Key signature accidental
    const keyAccidental = getKeyAccidentalForPitch(pitchClass, ctx.key);
    if (keyAccidental !== null) {
      writtenPitch = baseMidi + accidentalTypeToSemitones(keyAccidental);
    } else {
      writtenPitch = baseMidi;
    }
  }

  // Apply transpose to get sounding pitch
  return writtenPitch + ctx.transpose;
}

/**
 * Converts a sounding MIDI pitch to ABC notation components.
 *
 * This function determines the appropriate note letter, octave, and accidental
 * needed to represent the given MIDI pitch in the current context.
 *
 * When there are multiple enharmonic options (e.g., A# vs Bb), it chooses
 * the spelling that requires no explicit accidental if possible. This means
 * it will prefer spellings that match the key signature or measure accidentals.
 *
 * @param midiPitch The sounding MIDI pitch number
 * @param ctx The pitch context containing key, measure accidentals, and transpose
 * @returns Object with noteLetter, octave, and accidental string
 */
export function pitchToNoteName(midiPitch: number, ctx: PitchContext): { noteLetter: string; octave: number; accidental: string } {
  // Remove transpose to get written pitch
  const writtenMidi = midiPitch - ctx.transpose;

  // Get all possible enharmonic spellings
  const options = getEnharmonicOptions(writtenMidi);

  // For each option, calculate what accidental would be needed
  type ScoredOption = {
    noteLetter: string;
    octave: number;
    neededAccidental: string;
    score: number; // lower is better
  };

  const scoredOptions: ScoredOption[] = options.map((opt) => {
    const pitchClass = opt.noteLetter.toUpperCase();

    // Determine what accidental is already in effect for this pitch class
    let effectiveAccidental: AccidentalType | null = null;
    if (ctx.measureAccidentals?.has(measureAccidentalKey(pitchClass, opt.octave))) {
      effectiveAccidental = ctx.measureAccidentals.get(measureAccidentalKey(pitchClass, opt.octave))!;
    } else {
      effectiveAccidental = getKeyAccidentalForPitch(pitchClass, ctx.key);
    }

    const neededSemitones = opt.semitoneOffset;
    const effectiveSemitones = accidentalTypeToSemitones(effectiveAccidental);

    let neededAccidental: string;
    let score: number;

    if (neededSemitones === effectiveSemitones) {
      // No explicit accidental needed - best option
      neededAccidental = "";
      score = 0;
    } else {
      // Need an explicit accidental
      neededAccidental = semitonesToAccidentalString(neededSemitones);
      // Score based on complexity: natural < single accidental < double accidental
      score = Math.abs(neededSemitones) + 1;
    }

    return {
      noteLetter: opt.noteLetter,
      octave: opt.octave,
      neededAccidental,
      score,
    };
  });

  // Sort by score (lower is better) and pick the first
  scoredOptions.sort((a, b) => a.score - b.score);
  const best = scoredOptions[0];

  return {
    noteLetter: best.noteLetter,
    octave: best.octave,
    accidental: best.neededAccidental,
  };
}

/**
 * Determines the correct spelling for a target MIDI pitch given the current context.
 *
 * The algorithm follows three tiers:
 * 1. If the target pitch class matches a note in noteSpellings, use that spelling
 * 2. If the target is a natural pitch class not in noteSpellings, use the natural
 * 3. For true chromatic pitches, use sharp if transposing up, flat if down
 *
 * @param targetMidi The target MIDI pitch (0-127)
 * @param noteSpellings Map of letter to current alteration (from key + measure accidentals)
 * @param semitoneOffset The transposition offset (used for chromatic direction)
 * @returns The spelling (letter and alteration) for the target pitch
 */
export function spellPitch(targetMidi: number, noteSpellings: NoteSpellings, semitoneOffset: number): Spelling {
  const targetDegree = targetMidi % 12;

  // Tier 1: Search note spellings (notes in current context)
  for (const letter of LETTERS) {
    const alteration = noteSpellings[letter] ?? 0;
    // Use safe modulo because alteration can be negative
    const noteDegree = (((NATURAL_SEMITONES[letter] + alteration) % 12) + 12) % 12;
    if (noteDegree === targetDegree) {
      return { letter, alteration };
    }
  }

  // Tier 2: Check if a natural note matches (e.g., B natural in F major where B is flatted)
  for (const letter of LETTERS) {
    if (NATURAL_SEMITONES[letter] === targetDegree) {
      return { letter, alteration: 0 };
    }
  }

  // Tier 3: True chromatic fallback - sharp if transposing up, flat if down
  return chromaticSpelling(targetDegree, semitoneOffset > 0);
}

/**
 * Determines the spelling for a true chromatic pitch class.
 *
 * For the 5 chromatic pitch classes (1, 3, 6, 8, 10), each has exactly one
 * natural note at degree-1 (for sharp spelling) and one at degree+1 (for flat spelling).
 *
 * @param targetDegree The target pitch class (0-11)
 * @param preferSharp Whether to prefer sharp spelling (true) or flat spelling (false)
 * @returns The chromatic spelling
 */
export function chromaticSpelling(targetDegree: number, preferSharp: boolean): Spelling {
  if (preferSharp) {
    // Find letter whose natural semitone + 1 = targetDegree
    const sharpBase = (targetDegree - 1 + 12) % 12;
    for (const letter of LETTERS) {
      if (NATURAL_SEMITONES[letter] === sharpBase) {
        return { letter, alteration: 1 };
      }
    }
  } else {
    // Find letter whose natural semitone - 1 = targetDegree
    const flatBase = (targetDegree + 1) % 12;
    for (const letter of LETTERS) {
      if (NATURAL_SEMITONES[letter] === flatBase) {
        return { letter, alteration: -1 };
      }
    }
  }

  // Fallback (should never reach here for valid chromatic degrees)
  return { letter: "C", alteration: 0 };
}

/**
 * Derives the octave number from a Pitch AST node.
 *
 * ABC notation uses letter case and octave markers to indicate pitch:
 * - Uppercase letters (C-B) are octave 4
 * - Lowercase letters (c-b) are octave 5
 * - Each comma lowers the octave by 1
 * - Each apostrophe raises the octave by 1
 *
 * @param pitchExpr The Pitch AST node
 * @returns The octave number (e.g., 4 for middle C)
 */
export function computeOctaveFromPitch(pitchExpr: Pitch): number {
  const letter = pitchExpr.noteLetter.lexeme;
  const isLowercase = letter === letter.toLowerCase();
  let octave = isLowercase ? 5 : 4;

  if (pitchExpr.octave) {
    const octaveStr = pitchExpr.octave.lexeme;
    for (const char of octaveStr) {
      if (char === ",") octave--;
      else if (char === "'") octave++;
    }
  }

  return octave;
}

/**
 * Finds the reference spelling for a pitch class in the merged context.
 * Returns the Spelling if the pitch class is diatonic (in the scale), null if chromatic.
 *
 * For example, in G major (F is sharped):
 * - pitchClass 6 (F#) returns { letter: "F", alteration: 1 }
 * - pitchClass 5 (F natural) returns null (chromatic in G major)
 *
 * @param merged The merged accidentals from key signature and measure (NoteSpellings)
 * @param pitchClass The pitch class to look up (0-11)
 * @returns The diatonic Spelling, or null if the pitch class is chromatic
 */
export function findDiatonicSpelling(merged: NoteSpellings, pitchClass: number): Spelling | null {
  for (const letter of LETTERS) {
    const alteration = merged[letter] ?? 0;
    const pc = (((NATURAL_SEMITONES[letter] + alteration) % 12) + 12) % 12;
    if (pc === pitchClass) {
      return { letter, alteration };
    }
  }
  return null;
}

/**
 * Determines the direction (sharp/flat preference) of a key signature.
 *
 * Sharp keys (G, D, A, E, B, F#, C#) prefer sharp spellings for chromatic notes.
 * Flat keys (F, Bb, Eb, Ab, Db, Gb, Cb) prefer flat spellings.
 * C major/A minor and their modes are neutral.
 *
 * @param key The key signature
 * @returns "sharp", "flat", or "neutral"
 */
export function getKeyDirection(key: KeySignature): KeyDirection {
  const rootKey = key.root + (key.acc === KeyAccidental.Sharp ? "#" : key.acc === KeyAccidental.Flat ? "b" : "");
  const baseSharps = MAJOR_KEY_SHARPS[rootKey];

  if (baseSharps === undefined) {
    return "neutral";
  }

  const modeOffset = MODE_FIFTH_OFFSET[key.mode] ?? 0;
  const sharps = baseSharps + modeOffset;

  if (sharps > 0) return "sharp";
  if (sharps < 0) return "flat";
  return "neutral";
}

/**
 * Gets all possible enharmonic spellings for a pitch class (0-11).
 * Returns spellings without octave information.
 *
 * For example, pitch class 1 returns:
 * - { letter: "C", alteration: 1 }  (C#)
 * - { letter: "D", alteration: -1 } (Db)
 * - { letter: "B", alteration: 2 }  (B##)
 *
 * @param pitchClass The pitch class (0-11)
 * @returns Array of possible spellings
 */
export function getEnharmonicSpellings(pitchClass: number): Spelling[] {
  const result: Spelling[] = [];
  for (const letter of LETTERS) {
    for (const alteration of [-2, -1, 0, 1, 2]) {
      const pc = (((NATURAL_SEMITONES[letter] + alteration) % 12) + 12) % 12;
      if (pc === pitchClass) {
        result.push({ letter, alteration });
      }
    }
  }
  return result;
}

/**
 * Chooses the best enharmonic spelling for a chromatic pitch.
 *
 * Selection algorithm:
 * 1. Prefer natural spelling if available (rare for true chromatics)
 * 2. Prefer single accidental over double accidental
 * 3. Prefer spelling matching key direction (sharps for sharp keys, flats for flat keys)
 * 4. Prefer spelling where the letter already has that alteration in merged context
 * 5. Fallback to first available option
 *
 * @param options Array of possible spellings from getEnharmonicSpellings
 * @param key The key signature (for direction preference)
 * @param merged The merged accidentals (key + measure) for conflict detection
 * @returns The best spelling choice
 */
export function chooseBestChromatic(options: Spelling[], key: KeySignature, merged: NoteSpellings): Spelling {
  // 1. Prefer natural spelling if available
  const naturals = options.filter((o) => o.alteration === 0);
  if (naturals.length === 1) {
    return naturals[0];
  }

  // 2. Filter to single accidentals first (prefer over double accidentals)
  const singleAccidentals = options.filter((o) => o.alteration === 1 || o.alteration === -1);

  // 3. Prefer key direction
  const keyDirection = getKeyDirection(key);
  let matching: Spelling[] = [];

  if (keyDirection === "sharp") {
    matching = singleAccidentals.filter((o) => o.alteration > 0);
  } else if (keyDirection === "flat") {
    matching = singleAccidentals.filter((o) => o.alteration < 0);
  }

  if (matching.length === 1) {
    return matching[0];
  }

  // 4. Prefer spelling where letter already has that alteration (no new accidental needed)
  for (const option of singleAccidentals.length > 0 ? singleAccidentals : options) {
    if ((merged[option.letter] ?? 0) === option.alteration) {
      return option;
    }
  }

  // 5. Fallback: prefer single accidentals, then first option
  if (singleAccidentals.length > 0) {
    return singleAccidentals[0];
  }

  return options[0];
}
