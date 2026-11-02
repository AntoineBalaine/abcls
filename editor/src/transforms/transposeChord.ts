import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";

const NATURAL_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** True when the whole text reads as a chord symbol. */
export function isChordSymbolText(text: string): boolean {
  const scanned = scanChordSymbol(text);
  return scanned !== null && scanned.consumed === text.length;
}

/**
 * Transposes one note name of a chord, such as "Bb" or "F#".
 *
 * Because transposing by an interval moves every letter by the same number of steps, a chord root is spelled like
 * a note is: Bb moves to Ab when F major moves to Eb major. When we do not know the steps, we fall back on flat
 * names when going down and sharp names when going up.
 */
function transposeNoteName(letter: string, accidental: string, semitones: number, steps: number | null): string {
  const pitchClass = NATURAL_PITCH_CLASS[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  const target = (((pitchClass + semitones) % 12) + 12) % 12;
  if (steps !== null) {
    const newLetter = LETTERS[(((LETTERS.indexOf(letter) + steps) % 7) + 7) % 7];
    // Because the difference is only meaningful modulo an octave, we fold it into the range -6..5.
    let alteration = (((target - NATURAL_PITCH_CLASS[newLetter]) % 12) + 12) % 12;
    if (alteration > 6) alteration -= 12;
    if (Math.abs(alteration) <= 1) return newLetter + (alteration === 1 ? "#" : alteration === -1 ? "b" : "");
  }
  return (semitones < 0 ? FLAT_NAMES : SHARP_NAMES)[target];
}

/**
 * Transposes the root and the bass note of a chord symbol, and keeps the rest of the symbol as it was written,
 * so "F▵", "B⁷#5" and "Dm/C" keep their own notation.
 *
 * @param steps The number of letter steps of the transposition, or null when it is not known
 * @returns The transposed text, or null when the text is not a chord symbol
 */
export function transposeChordText(text: string, semitones: number, steps: number | null): string | null {
  if (!isChordSymbolText(text)) return null;
  const root = /^([A-Ga-g])([#b]?)/.exec(text);
  if (root === null) return null;

  let rest = text.slice(root[0].length);
  let bass = "";
  const slash = rest.lastIndexOf("/");
  if (slash >= 0) {
    const bassMatch = /^\/([A-Ga-g])([#b]?)$/.exec(rest.slice(slash));
    if (bassMatch !== null) {
      bass = "/" + transposeNoteName(bassMatch[1].toUpperCase(), bassMatch[2], semitones, steps);
      rest = rest.slice(0, slash);
    }
  }
  return transposeNoteName(root[1].toUpperCase(), root[2], semitones, steps) + rest + bass;
}
