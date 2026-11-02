import { MAJOR_KEY_SHARPS, MODE_FIFTH_OFFSET } from "abcls-parser/music-theory/constants";
import { KeyAccidental, KeyRoot, KeySignature } from "abcls-parser/types/abcjs-ast";

/**
 * The tonic names we can give to a key, by pitch class.
 *
 * Because the library derives a key signature from a tonic that is in MAJOR_KEY_SHARPS, we only offer names from that table.
 */
const TONIC_NAMES_BY_PITCH_CLASS: string[][] = [
  ["C"],
  ["C#", "Db"],
  ["D"],
  ["D#", "Eb"],
  ["E"],
  ["F"],
  ["F#", "Gb"],
  ["G"],
  ["G#", "Ab"],
  ["A"],
  ["A#", "Bb"],
  ["B", "Cb"],
];

const PITCH_CLASS_BY_TONIC_NAME: Record<string, number> = {};
TONIC_NAMES_BY_PITCH_CLASS.forEach((names, pitchClass) => names.forEach((name) => (PITCH_CLASS_BY_TONIC_NAME[name] = pitchClass)));

/**
 * Writes the tonic of a key as text, for example "Bb" or "F#".
 */
export function keyTonicName(key: KeySignature): string {
  return key.root + (key.acc === KeyAccidental.Sharp ? "#" : key.acc === KeyAccidental.Flat ? "b" : "");
}

const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * Counts the letter names between two keys, in the direction of the transposition.
 *
 * Because transposing by an interval moves every note by the same number of letter names (D major down to C major
 * moves every letter one step down), this is the number of steps we move each note, which spells chromatic notes
 * faithfully: G# becomes F#, not Gb.
 */
export function diatonicSteps(from: KeySignature, to: KeySignature, semitones: number): number {
  const difference = LETTER_INDEX[to.root] - LETTER_INDEX[from.root];
  const upwards = ((difference % 7) + 7) % 7;
  return semitones >= 0 ? upwards : upwards === 0 ? 0 : upwards - 7;
}

/**
 * Transposes a key signature by a number of semitones.
 *
 * Because several tonic names share a pitch class, we choose the one with the fewest accidentals in the key signature,
 * and when two names tie, we choose the flat name when going down and the sharp name when going up.
 *
 * @returns The transposed key, or null when the key has no tonic we can transpose (such as the bagpipe keys)
 */
export function transposeKeySignature(key: KeySignature, semitones: number): KeySignature | null {
  const pitchClass = PITCH_CLASS_BY_TONIC_NAME[keyTonicName(key)];
  if (pitchClass === undefined) return null;
  const modeOffset = MODE_FIFTH_OFFSET[key.mode] ?? 0;

  const target = (((pitchClass + semitones) % 12) + 12) % 12;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const name of TONIC_NAMES_BY_PITCH_CLASS[target]) {
    const sharps = MAJOR_KEY_SHARPS[name] + modeOffset;
    // Because a tie goes to the direction of the transposition, we add a small penalty to the other direction.
    const wrongDirection = (semitones < 0 && sharps > 0) || (semitones >= 0 && sharps < 0);
    const score = Math.abs(sharps) + (wrongDirection ? 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = name;
    }
  }
  if (best === null) return null;

  return {
    root: best[0] as KeyRoot,
    acc: best.length > 1 ? (best[1] === "#" ? KeyAccidental.Sharp : KeyAccidental.Flat) : KeyAccidental.None,
    mode: key.mode,
    accidentals: [],
  };
}
