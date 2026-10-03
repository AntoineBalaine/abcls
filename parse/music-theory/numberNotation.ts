/**
 * Converts a chord root into a scale-degree number relative to a key,
 * for iReal Pro-style "number chart" display.
 *
 * Two numbering systems are supported, matching iReal Pro's own two
 * modes:
 *
 * - Nashville numbering: degrees are always measured against the major
 *   scale built on the key's tonic, regardless of the song's actual
 *   mode. A minor-key tune's diatonic iii chord (a minor third above the
 *   tonic) reads as "b3", because a minor third is not in the major
 *   scale built on that same tonic.
 * - Regular number notation: degrees are measured against the song's
 *   actual mode's scale, anchored at the same tonic. The same minor-key
 *   iii chord above reads as a plain "3", because a minor third above
 *   the tonic is the diatonic 3rd degree of a minor (Aeolian) scale.
 *
 * Both reduce to the same offset-to-degree lookup; only the scale
 * pattern used for that lookup differs.
 */

import { KeyRoot, KeyAccidental, KeySignature, Mode } from "../types/abcjs-ast";
import { NATURAL_SEMITONES } from "./constants";
import { keyRootToLetter, keyAccidentalToSemitones } from "./harmonization";

export interface DegreeSpelling {
  /** 1-7 scale degree. */
  degree: number;
  /** Accidental prefix for a note outside the reference scale, or null if diatonic. */
  accidental: "b" | "#" | null;
}

/**
 * Natural (unaltered) semitone offsets from the tonic for each of the 7
 * degrees of each mode's scale.
 */
const MODE_SCALE_STEPS: Record<Mode, number[]> = {
  [Mode.Lydian]: [0, 2, 4, 6, 7, 9, 11],
  [Mode.Major]: [0, 2, 4, 5, 7, 9, 11],
  [Mode.Mixolydian]: [0, 2, 4, 5, 7, 9, 10],
  [Mode.Dorian]: [0, 2, 3, 5, 7, 9, 10],
  [Mode.Minor]: [0, 2, 3, 5, 7, 8, 10],
  [Mode.Phrygian]: [0, 1, 3, 5, 7, 8, 10],
  [Mode.Locrian]: [0, 1, 3, 5, 6, 8, 10],
};

function rootSemitone(root: KeyRoot, accidental: KeyAccidental): number {
  const letter = keyRootToLetter(root);
  const base = NATURAL_SEMITONES[letter] ?? 0;
  return ((base + keyAccidentalToSemitones(accidental)) % 12 + 12) % 12;
}

/**
 * Maps a semitone offset-from-tonic (0-11) to a scale degree within the
 * given scale pattern (7 ascending semitone values starting at 0).
 *
 * An offset that falls exactly on a scale step is diatonic (no
 * accidental). An offset that falls in a whole-tone gap between two
 * scale steps is labeled relative to its neighbors: the gap between
 * degrees 4 and 5 is spelled as a raised 4th ("#4"), every other gap is
 * spelled as a flattened upper degree (e.g. "b3", "b7") — this matches
 * the convention iReal Pro and Nashville charts use, and is a function
 * of *degree position*, not of the scale's own alterations, so the same
 * rule applies unchanged across every mode.
 */
function offsetToDegree(offset: number, scaleSteps: number[]): DegreeSpelling {
  for (let i = 0; i < 7; i++) {
    if (scaleSteps[i] === offset) {
      return { degree: i + 1, accidental: null };
    }
    const next = i < 6 ? scaleSteps[i + 1] : scaleSteps[0] + 12;
    if (offset > scaleSteps[i] && offset < next) {
      const lowerDegree = i + 1;
      const upperDegree = lowerDegree === 7 ? 1 : lowerDegree + 1;
      if (lowerDegree === 4) return { degree: 4, accidental: "#" };
      return { degree: upperDegree, accidental: "b" };
    }
  }
  // Unreachable for a valid 0-11 offset and a well-formed 7-step scale.
  return { degree: 1, accidental: null };
}

function chordOffsetFromTonic(
  chordRoot: KeyRoot,
  chordRootAccidental: KeyAccidental,
  key: KeySignature,
): number {
  const chordSemitone = rootSemitone(chordRoot, chordRootAccidental);
  const tonicSemitone = rootSemitone(key.root, key.acc);
  return ((chordSemitone - tonicSemitone) % 12 + 12) % 12;
}

/**
 * Nashville numbering: degree relative to the major scale of the key's
 * tonic, ignoring the key's actual mode.
 */
export function nashvilleDegree(
  chordRoot: KeyRoot,
  chordRootAccidental: KeyAccidental,
  key: KeySignature,
): DegreeSpelling {
  const offset = chordOffsetFromTonic(chordRoot, chordRootAccidental, key);
  return offsetToDegree(offset, MODE_SCALE_STEPS[Mode.Major]);
}

/**
 * Regular number notation: degree relative to the song's actual mode's
 * scale, anchored at the same tonic.
 */
export function regularDegree(
  chordRoot: KeyRoot,
  chordRootAccidental: KeyAccidental,
  key: KeySignature,
): DegreeSpelling {
  const offset = chordOffsetFromTonic(chordRoot, chordRootAccidental, key);
  return offsetToDegree(offset, MODE_SCALE_STEPS[key.mode]);
}

/** Renders a DegreeSpelling as iReal Pro-style text, e.g. "b3", "#4", "1". */
export function formatDegree(spelling: DegreeSpelling): string {
  if (!spelling.accidental) return String(spelling.degree);
  return `${spelling.accidental}${spelling.degree}`;
}
