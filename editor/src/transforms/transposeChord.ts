import { LETTERS, NATURAL_SEMITONES } from "abcls-parser/music-theory/constants";
import { isChordSymbolText } from "abcls-parser/music-theory/scanChordSymbol";
import { NoteLetter } from "./pitchHelpers";

const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Transposes one note name of a chord, such as "Bb" or "F#".
 *
 * Because transposing by an interval moves every letter by the same number of steps, a chord root is spelled like
 * a note is: Bb moves to Ab when F major moves to Eb major. When we do not know the steps, we fall back on flat
 * names when going down and sharp names when going up.
 */
function transposeNoteName(letter: string, accidental: string, semitones: number, steps: number | null): string {
  const pitchClass = NATURAL_SEMITONES[letter as NoteLetter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  const target = (((pitchClass + semitones) % 12) + 12) % 12;
  if (steps !== null) {
    const newLetter = LETTERS[(((LETTERS.indexOf(letter as NoteLetter) + steps) % 7) + 7) % 7];
    // Because the difference is only meaningful modulo an octave, we fold it into the range -6..5.
    let alteration = (((target - NATURAL_SEMITONES[newLetter]) % 12) + 12) % 12;
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
