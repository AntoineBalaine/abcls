import { DegreeIR, HarmonyIR } from "./ir";

/**
 * Maps the quality part of an ABC chord symbol (what follows the root, such
 * as "m7" in "Am7") onto a MusicXML kind-value. Several spellings map to the
 * same kind, because ABC has no canonical chord spelling. The spellings that
 * opensheetmusicdisplay writes on import ("m7b5", "m(maj7)", "maj6", ...) are
 * all present, so an imported symbol exports back to the same kind.
 */
export const KIND_BY_QUALITY: Record<string, string> = {
  "": "major",
  maj: "major",
  M: "major",
  m: "minor",
  min: "minor",
  "-": "minor",
  aug: "augmented",
  "+": "augmented",
  dim: "diminished",
  o: "diminished",
  "°": "diminished",
  "7": "dominant",
  maj7: "major-seventh",
  M7: "major-seventh",
  ma7: "major-seventh",
  Δ: "major-seventh",
  Δ7: "major-seventh",
  m7: "minor-seventh",
  min7: "minor-seventh",
  mi7: "minor-seventh",
  "-7": "minor-seventh",
  dim7: "diminished-seventh",
  o7: "diminished-seventh",
  "°7": "diminished-seventh",
  aug7: "augmented-seventh",
  "+7": "augmented-seventh",
  m7b5: "half-diminished",
  min7b5: "half-diminished",
  "-7b5": "half-diminished",
  ø: "half-diminished",
  ø7: "half-diminished",
  "m(maj7)": "major-minor",
  mmaj7: "major-minor",
  mM7: "major-minor",
  "-maj7": "major-minor",
  "6": "major-sixth",
  maj6: "major-sixth",
  M6: "major-sixth",
  m6: "minor-sixth",
  min6: "minor-sixth",
  "-6": "minor-sixth",
  "9": "dominant-ninth",
  maj9: "major-ninth",
  M9: "major-ninth",
  m9: "minor-ninth",
  min9: "minor-ninth",
  "-9": "minor-ninth",
  "11": "dominant-11th",
  maj11: "major-11th",
  M11: "major-11th",
  m11: "minor-11th",
  min11: "minor-11th",
  "-11": "minor-11th",
  "13": "dominant-13th",
  maj13: "major-13th",
  M13: "major-13th",
  m13: "minor-13th",
  min13: "minor-13th",
  "-13": "minor-13th",
  sus2: "suspended-second",
  sus4: "suspended-fourth",
  sus: "suspended-fourth",
  "5": "power",
};

/**
 * Because a longer quality must win over its own prefix ("m7b5" over "m7"
 * over "m"), the qualities are tried from the longest to the shortest.
 */
const QUALITIES_LONGEST_FIRST = Object.keys(KIND_BY_QUALITY).sort((a, b) => b.length - a.length);

const NO_CHORD_SPELLINGS = new Set(["N.C.", "N.C", "NC"]);

// Because a root or a bass may carry a double accidental (as in "Fbb/C"),
// each accepts up to two identical accidental signs.
const CHORD_SYMBOL_PATTERN = /^([A-G])(##|bb|♯♯|♭♭|[#b♯♭])?(.*?)(?:\/([A-G])(##|bb|♯♯|♭♭|[#b♯♭])?)?$/;

const DEGREE_TOKEN_PATTERN = /(add|omit|no|alt)?\s*([#b♯♭]?)(\d+)/g;

/**
 * Matches a suffix made only of chord vocabulary (qualities, degrees,
 * accidentals and punctuation). Because plain text such as "Allegro" or
 * "Coda" also starts with a root letter, a suffix that the table cannot
 * explain is kept as a chord symbol only when it matches this pattern.
 */
const CHORD_VOCABULARY_PATTERN = /^(?:maj|min|dim|aug|sus|add|omit|no|alt|[mMoø°Δ]|[#b♯♭+\-()/,\s\d])*$/;

function accidentalToAlter(accidental: string): number | undefined {
  if (accidental === "#" || accidental === "♯") return 1;
  if (accidental === "b" || accidental === "♭") return -1;
  if (accidental === "##" || accidental === "♯♯") return 2;
  if (accidental === "bb" || accidental === "♭♭") return -2;
  return undefined;
}

/**
 * Parses the degree part that follows a quality, such as "(b9,#11)", "add9",
 * "(omit 3)" or "b5", into MusicXML degrees. Returns null when the text holds
 * anything other than degree tokens, separators and one pair of parentheses.
 *
 * A bare altered fifth (b5, #5) alters the chord's own fifth, so it becomes
 * an "alter" degree; every other bare degree is an addition, which matches
 * how notation programs export alterations such as b9 and #11.
 */
export function parseDegrees(text: string): DegreeIR[] | null {
  const degrees: DegreeIR[] = [];
  let leftover = text;
  for (const match of text.matchAll(DEGREE_TOKEN_PATTERN)) {
    leftover = leftover.replace(match[0], "");
    const prefix = match[1];
    const alter = accidentalToAlter(match[2]) ?? 0;
    const value = Number(match[3]);
    if (prefix === "omit" || prefix === "no") {
      degrees.push({ value, alter: 0, type: "subtract" });
    } else if (prefix === "alt" || (prefix === undefined && value === 5 && alter !== 0)) {
      degrees.push({ value, alter, type: "alter" });
    } else {
      degrees.push({ value, alter, type: "add" });
    }
  }
  if (degrees.length === 0) return null;
  if (!/^[\s,()]*$/.test(leftover)) return null;
  return degrees;
}

/**
 * Splits a suffix into a known quality and its trailing degrees. Returns
 * null when no known quality leaves a remainder made only of degrees.
 */
function parseQualityAndDegrees(suffix: string): { quality: string; degrees: DegreeIR[] } | null {
  if (suffix in KIND_BY_QUALITY) return { quality: suffix, degrees: [] };
  for (const quality of QUALITIES_LONGEST_FIRST) {
    if (!suffix.startsWith(quality)) continue;
    const degrees = parseDegrees(suffix.slice(quality.length));
    if (degrees) return { quality, degrees };
  }
  return null;
}

/**
 * Converts the text of an ABC chord symbol (such as "Am7", "Bb7(b9)",
 * "C/E" or "N.C.") into a MusicXML harmony. Returns null for text that is
 * not a chord symbol, such as a positioned annotation ("^allegro") or a
 * plain word, because those are not harmonies.
 *
 * A suffix that no table entry explains, but that is made only of chord
 * vocabulary (such as "7sus4"), keeps its root and bass and becomes kind
 * "other" with the suffix as display text, so that the symbol is not lost
 * even though its harmonic meaning is unknown. Any other suffix means the
 * text is not a chord symbol, and the result is null.
 */
export function parseChordSymbol(name: string): HarmonyIR | null {
  const trimmed = name.trim();
  if (NO_CHORD_SPELLINGS.has(trimmed)) {
    // Because the schema requires a root even for "no chord", we write an
    // empty display text for it, the way notation programs do.
    return { rootStep: "C", rootText: "", kind: "none", kindText: "N.C." };
  }
  const match = CHORD_SYMBOL_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, rootStep, rootAccidental, suffix, bassStep, bassAccidental] = match;
  const harmony: HarmonyIR = { rootStep, kind: "other" };
  const rootAlter = accidentalToAlter(rootAccidental ?? "");
  if (rootAlter !== undefined) harmony.rootAlter = rootAlter;
  if (bassStep) {
    harmony.bassStep = bassStep;
    const bassAlter = accidentalToAlter(bassAccidental ?? "");
    if (bassAlter !== undefined) harmony.bassAlter = bassAlter;
  }
  const parsed = parseQualityAndDegrees(suffix);
  if (parsed) {
    harmony.kind = KIND_BY_QUALITY[parsed.quality];
    harmony.kindText = parsed.quality;
    if (parsed.degrees.length > 0) harmony.degrees = parsed.degrees;
  } else if (CHORD_VOCABULARY_PATTERN.test(suffix)) {
    harmony.kindText = suffix;
  } else {
    return null;
  }
  return harmony;
}
