import { ChordAlteration, ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";

/**
 * ParsedChord <-> iReal Pro chord shorthand text.
 *
 * Quality symbols confirmed against iReal Pro's own published chord
 * symbol reference: "^" major seventh, "-" minor, "o" diminished, "h"
 * half-diminished (min7b5), "+" augmented. Dominant has no quality
 * symbol (a bare extension number after the root, e.g. "C7"). Power and
 * Add chord shorthand, and the exact ordering/spacing convention for
 * alterations after an extension, were not independently confirmed
 * against real sample data during implementation and are best-effort
 * here ("5" for Power, "add" + degree for Add, alterations appended
 * in order after the extension with no separator, e.g. "7b9#11").
 */

const QUALITY_TO_SYMBOL: Record<ChordQuality, string> = {
  [ChordQuality.Major]: "^",
  [ChordQuality.Minor]: "-",
  [ChordQuality.Dominant]: "",
  [ChordQuality.Diminished]: "o",
  [ChordQuality.Augmented]: "+",
  [ChordQuality.HalfDiminished]: "h",
  [ChordQuality.Suspended2]: "sus2",
  [ChordQuality.Suspended4]: "sus4",
  [ChordQuality.Power]: "5",
  [ChordQuality.Add]: "add",
  // Unused at runtime — chordToText special-cases Altered's extension
  // ordering directly (see there); only present so this Record type
  // covers every ChordQuality value.
  [ChordQuality.Altered]: "alt",
  [ChordQuality.MinorMajor7]: "-^",
  [ChordQuality.DiminishedMajor7]: "o^",
};

function rootToText(root: KeyRoot, accidental: KeyAccidental): string {
  return root + (accidental === KeyAccidental.None ? "" : accidental);
}

function alterationToText(alt: ChordAlteration): string {
  return (alt.type === "sharp" ? "#" : "b") + String(alt.degree);
}

function chordToText(chord: ParsedChord, qualityToSymbol: Record<ChordQuality, string>, altExtensionFirst: boolean): string {
  let text = rootToText(chord.root, chord.rootAccidental);

  if (chord.quality === ChordQuality.Dominant || !chord.qualityExplicit) {
    // Bare extension number, no quality letter, e.g. "C7".
    if (chord.extension !== null) text += String(chord.extension);
  } else if (chord.quality === ChordQuality.Altered) {
    // iReal Pro's own shorthand writes "alt" after any extension (e.g.
    // "C7alt"), the opposite ordering from every other quality symbol,
    // which precedes the extension (e.g. "C^7"); ABCx's chord-symbol
    // scanner instead expects quality before extension like everything
    // else (scanQuality always runs before scanExtension), so ABCx text
    // must be "Calt7".
    const extensionText = chord.extension !== null ? String(chord.extension) : "";
    text += altExtensionFirst ? extensionText + "alt" : "alt" + extensionText;
  } else if (chord.quality === ChordQuality.Add) {
    text += "add" + (chord.extension !== null ? String(chord.extension) : "");
  } else if (chord.quality === ChordQuality.Suspended2 || chord.quality === ChordQuality.Suspended4) {
    // A sus chord's extension is a real degree of the chord and not a
    // restatement of the suspension, so "Eb9sus" (a ninth over a
    // suspended fourth) must not collapse to "Ebsus4"; the library has
    // such chords in twelve charts. The two dialects place the digit
    // differently. iReal Pro writes it before the word and then omits
    // the suspension's own digit, which is how real charts read
    // ("G7sus", "A9sus"), while ABCx's chord scanner reads a quality and
    // only then an extension, so there the digit follows a fully spelled
    // "sus4"/"sus2".
    const extensionText = chord.extension !== null ? String(chord.extension) : "";
    const suspensionWord = chord.quality === ChordQuality.Suspended2 ? "sus2" : "sus4";
    if (altExtensionFirst) {
      text += extensionText + (chord.quality === ChordQuality.Suspended2 ? "sus2" : extensionText ? "sus" : "sus4");
    } else {
      text += suspensionWord + extensionText;
    }
  } else {
    text += qualityToSymbol[chord.quality];
    if (chord.extension !== null) {
      text += String(chord.extension);
    }
  }

  for (const alt of chord.alterations) {
    text += alterationToText(alt);
  }

  if (chord.bass) {
    text += "/" + rootToText(chord.bass.root, chord.bass.accidental);
  }

  return text;
}

export function parsedChordToIrealText(chord: ParsedChord): string {
  return chordToText(chord, QUALITY_TO_SYMBOL, true);
}

/**
 * The quality symbols and quality words a chord may carry, longest first.
 *
 * Because `-^` and `o^` each name one quality rather than two, they are
 * listed before the standalone `-`, `o` and `^` that spell their halves;
 * matching a half would leave the other half for the alteration rule,
 * which is the defect this ordering has already prevented once.
 */
const QUALITY_SYMBOLS: Array<[string, ChordQuality]> = [
  ["sus2", ChordQuality.Suspended2],
  ["sus4", ChordQuality.Suspended4],
  // A bare "sus" with no trailing digit means sus4, which is what real
  // charts write (`Csus`, `G7sus`).
  ["sus", ChordQuality.Suspended4],
  ["alt", ChordQuality.Altered],
  ["add", ChordQuality.Add],
  ["-^", ChordQuality.MinorMajor7],
  ["o^", ChordQuality.DiminishedMajor7],
  ["^", ChordQuality.Major],
  ["-", ChordQuality.Minor],
  ["o", ChordQuality.Diminished],
  ["h", ChordQuality.HalfDiminished],
  ["+", ChordQuality.Augmented],
];

/**
 * The qualities that two separately written symbols may combine into.
 *
 * iReal Pro writes the minor-major seventh as the single symbol `-^` and
 * the diminished major seventh as `o^`, so these pairs are what the
 * component parser sees when it takes those symbols apart; keeping the
 * combination here rather than in the symbol table means a chart writing
 * the halves in either order still resolves to one quality.
 */
const QUALITY_COMBINATIONS: Array<[ChordQuality, ChordQuality, ChordQuality]> = [
  [ChordQuality.Minor, ChordQuality.Major, ChordQuality.MinorMajor7],
  [ChordQuality.Diminished, ChordQuality.Major, ChordQuality.DiminishedMajor7],
];

function combineQualities(qualities: ChordQuality[]): ChordQuality | null {
  if (qualities.length === 0) return ChordQuality.Dominant;
  if (qualities.length === 1) return qualities[0];
  if (qualities.length > 2) return null;
  const [first, second] = qualities;
  for (const [a, b, combined] of QUALITY_COMBINATIONS) {
    if ((first === a && second === b) || (first === b && second === a)) return combined;
  }
  return null;
}

/**
 * Parses one chord cell written in iReal Pro's own dialect, or returns
 * null when the text is not a chord.
 *
 * Because iReal Pro fixes no order among a chord's components, this
 * consumes a root and an optional accidental and then reads components
 * in whatever order they appear, validating the combination at the end.
 * Three measurements against a real 657-chart library made that
 * necessary: `G7b9sus` writes an alteration between the extension and a
 * trailing quality word, `C7+` writes a quality symbol after the
 * extension, and `Dbo^7` combines two quality symbols. A whole-string
 * pattern per component order had grown three alternates by then and
 * would have needed a fourth for each of these.
 */
export function irealTextToParsedChord(text: string): ParsedChord | null {
  const trimmed = text.trim();
  let i = 0;

  if (!/[A-G]/.test(trimmed[i] ?? "")) return null;
  const root = trimmed[i] as KeyRoot;
  i++;
  let rootAccidental = "" as KeyAccidental;
  if (trimmed[i] === "#" || trimmed[i] === "b") {
    rootAccidental = trimmed[i] as KeyAccidental;
    i++;
  }

  const qualities: ChordQuality[] = [];
  const alterations: ChordAlteration[] = [];
  let extension: number | null = null;
  let bass: ParsedChord["bass"] = null;
  let firstComponent = true;

  while (i < trimmed.length) {
    // A slash bass ends the chord, so anything written after it is not a
    // component of this chord and the whole text is rejected.
    if (trimmed[i] === "/") {
      const bassRoot = trimmed[i + 1];
      if (bassRoot === undefined || !/[A-G]/.test(bassRoot)) return null;
      let bassAccidental = "" as KeyAccidental;
      let next = i + 2;
      if (trimmed[next] === "#" || trimmed[next] === "b") {
        bassAccidental = trimmed[next] as KeyAccidental;
        next++;
      }
      if (next !== trimmed.length) return null;
      bass = { root: bassRoot as KeyRoot, accidental: bassAccidental };
      i = next;
      continue;
    }

    // An alteration is a sign followed by at least one digit, which is
    // what separates it from the accidental already consumed above.
    if (trimmed[i] === "#" || trimmed[i] === "b") {
      const digits = /^\d+/.exec(trimmed.slice(i + 1));
      if (!digits) return null;
      alterations.push({ type: trimmed[i] === "#" ? "sharp" : "flat", degree: parseInt(digits[0], 10) });
      i += 1 + digits[0].length;
      firstComponent = false;
      continue;
    }

    // The digit 5 standing immediately after the root is the Power chord
    // symbol rather than an extension, because no dominant chord's
    // extension is ever the literal 5; later in the component sequence the
    // same digit is an ordinary extension, as in `C^5`.
    if (firstComponent && trimmed[i] === "5" && !/\d/.test(trimmed[i + 1] ?? "")) {
      qualities.push(ChordQuality.Power);
      i++;
      firstComponent = false;
      continue;
    }

    const digits = /^\d+/.exec(trimmed.slice(i));
    if (digits) {
      // A chord carries at most one extension, so a second run of digits
      // means the text is not a chord rather than an extension to merge.
      if (extension !== null) return null;
      extension = parseInt(digits[0], 10);
      i += digits[0].length;
      firstComponent = false;
      continue;
    }

    const symbol = QUALITY_SYMBOLS.find(([lexeme]) => trimmed.startsWith(lexeme, i));
    if (symbol) {
      qualities.push(symbol[1]);
      i += symbol[0].length;
      firstComponent = false;
      continue;
    }

    return null;
  }

  const quality = combineQualities(qualities);
  if (quality === null) return null;

  return {
    root,
    rootAccidental,
    quality,
    // Dominant has no symbol of its own in this dialect, so an explicit
    // dominant cannot be told from an implicit one by text alone.
    qualityExplicit: qualities.length > 0,
    extension,
    alterations,
    bass,
  };
}

/**
 * ParsedChord to ABCx's own chord symbol syntax (as opposed to iReal's),
 * for the import direction. Quality words confirmed directly against
 * music-theory/scanChordSymbol.ts's accepted quality token list
 * ("maj", "min"/"m", "dim", "aug"/"+"/"-", "sus2", "sus4", "add", "ø").
 */
const ABCX_QUALITY_TO_SYMBOL: Record<ChordQuality, string> = {
  [ChordQuality.Major]: "maj",
  [ChordQuality.Minor]: "m",
  [ChordQuality.Dominant]: "",
  [ChordQuality.Diminished]: "dim",
  [ChordQuality.Augmented]: "aug",
  [ChordQuality.HalfDiminished]: "ø",
  [ChordQuality.Suspended2]: "sus2",
  [ChordQuality.Suspended4]: "sus4",
  [ChordQuality.Power]: "5",
  [ChordQuality.Add]: "add",
  [ChordQuality.Altered]: "alt",
  // Reuses iReal's own "-^" symbol rather than inventing a distinct ABCx
  // word for it — nothing else in this codebase depends on ABCx using a
  // different spelling, and pChordSymbol/scanChordSymbol.ts both
  // recognize "-^" the same way.
  [ChordQuality.MinorMajor7]: "-^",
  // Reuses iReal's own "o^" symbol for the same reason "-^" is reused
  // above: scanChordSymbol.ts and pChordSymbol both recognize it.
  [ChordQuality.DiminishedMajor7]: "o^",
};

export function parsedChordToAbcxText(chord: ParsedChord): string {
  return chordToText(chord, ABCX_QUALITY_TO_SYMBOL, false);
}
