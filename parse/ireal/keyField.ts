/**
 * The `key` field of an iReal Pro song.
 *
 * The dialect is the library's business rather than a consumer's: iReal Pro
 * writes a minor key as a trailing hyphen (`C-`), where ABC writes a
 * trailing `m` and every consumer that wanted the key had been recovering it
 * from an ABC header we had written ourselves, which is a round trip through
 * a lossy format for no reason.
 */

import { KeyAccidental, KeyRoot, KeySignature, Mode } from "../types/abcjs-ast";

const DEFAULT_KEY: KeySignature = {
  root: KeyRoot.C,
  acc: KeyAccidental.None,
  mode: Mode.Major,
  accidentals: [],
};

function parseRoot(letter: string): KeyRoot | null {
  switch (letter) {
    case "A":
      return KeyRoot.A;
    case "B":
      return KeyRoot.B;
    case "C":
      return KeyRoot.C;
    case "D":
      return KeyRoot.D;
    case "E":
      return KeyRoot.E;
    case "F":
      return KeyRoot.F;
    case "G":
      return KeyRoot.G;
    default:
      return null;
  }
}

/**
 * Reads an iReal Pro key field into a key signature, falling back to C major
 * when the field is absent or unreadable.
 *
 * The `accidentals` list is left empty because every consumer of this key
 * needs only the tonic and the mode, which is what the degree arithmetic in
 * `numberNotation.ts` reads. Filling it would mean computing a key signature
 * nobody engraves.
 */
export function parseIrealKey(field: string | undefined): KeySignature {
  const text = (field ?? "").trim();
  if (text.length === 0) return { ...DEFAULT_KEY };

  const root = parseRoot(text[0]);
  if (root === null) return { ...DEFAULT_KEY };

  let index = 1;
  let acc = KeyAccidental.None;
  if (text[index] === "#") {
    acc = KeyAccidental.Sharp;
    index++;
  } else if (text[index] === "b") {
    acc = KeyAccidental.Flat;
    index++;
  }

  const rest = text.slice(index);
  if (rest !== "" && rest !== "-") return { ...DEFAULT_KEY };

  return { root, acc, mode: rest === "-" ? Mode.Minor : Mode.Major, accidentals: [] };
}
