/**
 * Converts a chord root into a scale-degree number relative to a key,
 * for iReal Pro-style "number chart" display.
 *
 * Two numbering systems are supported, matching iReal Pro's own two
 * modes:
 *
 * - Nashville numbering: degrees are always measured against a major
 *   scale. For a major-key song that's the key's own tonic; for a
 *   minor-key song it's the *relative major* — the major key sharing the
 *   same key signature, a minor third above the minor tonic (C minor's
 *   relative major is Eb major) — because the Nashville Number System
 *   always reads a chart's numbers off a major scale, never a minor one.
 *   A C-minor tune's i chord (C) is a diatonic vi relative to Eb major,
 *   so it reads as "6", not "1".
 * - Regular number notation: degrees are measured against the song's
 *   actual mode's scale, anchored at the song's own tonic (no relative-
 *   major shift) — a C-minor tune's i chord reads as a plain "1".
 *
 * Both reduce to the same offset-to-degree lookup; only the tonic and
 * scale pattern used for that lookup differ.
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
 * accidental). An offset that falls in a whole-tone gap between two scale
 * steps has two available names, the lower degree raised or the upper
 * degree flattened, and which one a musician reads depends on the scale
 * rather than only on the degree's position.
 *
 * The rule is that a degree the scale itself already lowers is raised to
 * name the note above it, and every other gap is named by flattening the
 * upper degree. Reading a minor key against its own scale is what makes
 * the distinction necessary: the minor scale lowers its third, sixth and
 * seventh, so the notes above them are the major third, the major sixth
 * and the major seventh, written "#3", "#6" and "#7". Naming them by
 * flattening the upper degree instead produced "b4" for a major third and
 * "b1" for a leading tone, neither of which is a degree anyone reads, and
 * 314 chords in a 657-chart library were spelled that way.
 *
 * The gap between degrees 4 and 5 keeps its own convention of a raised
 * fourth, since neither neighbour is lowered in any mode where that gap
 * exists and "#4" is what a chart writes for a tritone.
 */
function offsetToDegree(offset: number, scaleSteps: number[]): DegreeSpelling {
  const majorSteps = MODE_SCALE_STEPS[Mode.Major];
  for (let i = 0; i < 7; i++) {
    if (scaleSteps[i] === offset) {
      return { degree: i + 1, accidental: null };
    }
    const next = i < 6 ? scaleSteps[i + 1] : scaleSteps[0] + 12;
    if (offset > scaleSteps[i] && offset < next) {
      const lowerDegree = i + 1;
      const upperDegree = lowerDegree === 7 ? 1 : lowerDegree + 1;
      if (scaleSteps[i] < majorSteps[i]) return { degree: lowerDegree, accidental: "#" };
      if (lowerDegree === 4) return { degree: 4, accidental: "#" };
      return { degree: upperDegree, accidental: "b" };
    }
  }
  // Unreachable for a valid 0-11 offset and a well-formed 7-step scale.
  return { degree: 1, accidental: null };
}

function chordOffsetFromTonic(chordSemitone: number, tonicSemitone: number): number {
  return ((chordSemitone - tonicSemitone) % 12 + 12) % 12;
}

// A minor key's relative major sits a minor third (3 semitones) above
// its tonic — e.g. C minor's relative major is Eb major.
const RELATIVE_MAJOR_SHIFT_SEMITONES = 3;

/**
 * Nashville numbering: degree relative to a major scale — the key's own
 * tonic for a major key, or the relative major's tonic for a minor key,
 * since the Nashville Number System always reads off a major scale.
 */
export function nashvilleDegree(
  chordRoot: KeyRoot,
  chordRootAccidental: KeyAccidental,
  key: KeySignature,
): DegreeSpelling {
  const chordSemitone = rootSemitone(chordRoot, chordRootAccidental);
  const keyTonicSemitone = rootSemitone(key.root, key.acc);
  const nashvilleTonicSemitone =
    key.mode === Mode.Minor ? (keyTonicSemitone + RELATIVE_MAJOR_SHIFT_SEMITONES) % 12 : keyTonicSemitone;
  const offset = chordOffsetFromTonic(chordSemitone, nashvilleTonicSemitone);
  return offsetToDegree(offset, MODE_SCALE_STEPS[Mode.Major]);
}

/**
 * Regular number notation: degree relative to the song's own tonic.
 *
 * A minor key is read against its parallel major, the major scale on the
 * same tonic, which is what iReal Pro's own number charts do. A minor is
 * therefore read against A major, so a C major seventh in A minor is
 * `b3maj7` and not `3maj7`: A major's third is C sharp, and C is a
 * semitone below it.
 *
 * The reason is that an accidental in a degree then always means the same
 * thing, a departure from a major scale, so `3` and `b3` each have one
 * reading whatever mode the song is in. Reading a minor key against the
 * minor scale instead makes the same digit mean different notes depending
 * on the key's mode, which is the ambiguity this convention exists to
 * remove.
 *
 * This is the same reference scale Nashville uses and a different tonic:
 * Nashville reads a minor key against its relative major, three semitones
 * up, so C minor's tonic prints `6`, where here it prints `1`.
 *
 * A key in one of the other modes is still read against that mode's own
 * scale. No iReal Pro chart can be in one, since its key field spells only
 * major and minor, so this concerns ABC-sourced keys alone.
 */
export function regularDegree(
  chordRoot: KeyRoot,
  chordRootAccidental: KeyAccidental,
  key: KeySignature,
): DegreeSpelling {
  const chordSemitone = rootSemitone(chordRoot, chordRootAccidental);
  const tonicSemitone = rootSemitone(key.root, key.acc);
  const offset = chordOffsetFromTonic(chordSemitone, tonicSemitone);
  const referenceMode = key.mode === Mode.Minor ? Mode.Major : key.mode;
  return offsetToDegree(offset, MODE_SCALE_STEPS[referenceMode]);
}

/** Renders a DegreeSpelling as iReal Pro-style text, e.g. "b3", "#4", "1". */
export function formatDegree(spelling: DegreeSpelling): string {
  if (!spelling.accidental) return String(spelling.degree);
  return `${spelling.accidental}${spelling.degree}`;
}
