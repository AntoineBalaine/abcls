import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { ChordAlteration, ChordQuality, ParsedChord } from "../music-theory/types";

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
};

// Kept as the exact inverse of QUALITY_TO_SYMBOL: every symbol that table can
// produce must be recognized here, or a round trip through an explicit
// quality (e.g. Power, qualityExplicit: true) reparses as a different chord.
const SYMBOL_TO_QUALITY: Array<[string, ChordQuality]> = [
  ["sus2", ChordQuality.Suspended2],
  ["sus4", ChordQuality.Suspended4],
  ["add", ChordQuality.Add],
  ["^", ChordQuality.Major],
  ["-", ChordQuality.Minor],
  ["o", ChordQuality.Diminished],
  ["h", ChordQuality.HalfDiminished],
  ["+", ChordQuality.Augmented],
  ["5", ChordQuality.Power],
];

function rootToText(root: KeyRoot, accidental: KeyAccidental): string {
  return root + (accidental === KeyAccidental.None ? "" : accidental);
}

function alterationToText(alt: ChordAlteration): string {
  return (alt.type === "sharp" ? "#" : "b") + String(alt.degree);
}

function chordToText(chord: ParsedChord, qualityToSymbol: Record<ChordQuality, string>): string {
  let text = rootToText(chord.root, chord.rootAccidental);

  if (chord.quality === ChordQuality.Dominant || !chord.qualityExplicit) {
    // Bare extension number, no quality letter, e.g. "C7".
    if (chord.extension !== null) text += String(chord.extension);
  } else if (chord.quality === ChordQuality.Add) {
    text += "add" + (chord.extension !== null ? String(chord.extension) : "");
  } else {
    text += qualityToSymbol[chord.quality];
    if (chord.extension !== null && chord.quality !== ChordQuality.Suspended2 && chord.quality !== ChordQuality.Suspended4) {
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
  return chordToText(chord, QUALITY_TO_SYMBOL);
}

// "5" (Power) is included as a quality-symbol alternative, not left to the
// bare-extension digit group below: no dominant chord extension is ever the
// literal digit 5 in real jazz chord vocabulary (extensions are 6, 7, 9, 11,
// 13), so this is unambiguous, and it must stay in sync with SYMBOL_TO_QUALITY.
const CHORD_TEXT_PATTERN = /^([A-G])([#b]?)((?:sus2|sus4|add|\^|-|o|h|\+|5)?)(\d+)?((?:[#b]\d+)*)(?:\/([A-G])([#b]?))?$/;

// Real iReal Pro charts write a sus chord's extension *before* "sus"
// (e.g. "G7sus", "A9sus" — the dominant-extension-plus-sus4 chord), not
// after it, and write a bare sus triad as plain "sus" with no trailing
// "2"/"4" at all (defaulting to sus4) — neither of which
// CHORD_TEXT_PATTERN's quality-before-extension ordering matches. Tried
// as a fallback (only once the primary pattern above has failed) since
// it has its own, different field ordering.
const SUS_CHORD_TEXT_PATTERN = /^([A-G])([#b]?)(\d+)?sus([24])?((?:[#b]\d+)*)(?:\/([A-G])([#b]?))?$/;

function parseSusChordText(trimmed: string): ParsedChord | null {
  const match = SUS_CHORD_TEXT_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, rootLetter, rootAcc, extensionStr, susDigit, alterationsStr, bassLetter, bassAcc] = match;
  const alterations: ChordAlteration[] = [];
  for (const altText of alterationsStr.match(/[#b]\d+/g) ?? []) {
    alterations.push({ type: altText[0] === "#" ? "sharp" : "flat", degree: parseInt(altText.slice(1), 10) });
  }
  return {
    root: rootLetter as KeyRoot,
    rootAccidental: (rootAcc || "") as KeyAccidental,
    quality: susDigit === "2" ? ChordQuality.Suspended2 : ChordQuality.Suspended4,
    qualityExplicit: true,
    extension: extensionStr ? parseInt(extensionStr, 10) : null,
    alterations,
    bass: bassLetter ? { root: bassLetter as KeyRoot, accidental: (bassAcc || "") as KeyAccidental } : null,
  };
}

export function irealTextToParsedChord(text: string): ParsedChord | null {
  const trimmed = text.trim();
  const match = CHORD_TEXT_PATTERN.exec(trimmed);
  if (!match) return parseSusChordText(trimmed);

  const [, rootLetter, rootAcc, qualitySymbol, extensionStr, alterationsStr, bassLetter, bassAcc] = match;

  let quality: ChordQuality = ChordQuality.Dominant;
  let qualityExplicit = false;
  for (const [symbol, q] of SYMBOL_TO_QUALITY) {
    if (qualitySymbol === symbol) {
      quality = q;
      qualityExplicit = true;
      break;
    }
  }

  const alterations: ChordAlteration[] = [];
  const altMatches = alterationsStr.match(/[#b]\d+/g) ?? [];
  for (const altText of altMatches) {
    alterations.push({ type: altText[0] === "#" ? "sharp" : "flat", degree: parseInt(altText.slice(1), 10) });
  }

  return {
    root: rootLetter as KeyRoot,
    rootAccidental: (rootAcc || "") as KeyAccidental,
    quality,
    qualityExplicit,
    extension: extensionStr ? parseInt(extensionStr, 10) : null,
    alterations,
    bass: bassLetter ? { root: bassLetter as KeyRoot, accidental: (bassAcc || "") as KeyAccidental } : null,
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
};

export function parsedChordToAbcxText(chord: ParsedChord): string {
  return chordToText(chord, ABCX_QUALITY_TO_SYMBOL);
}
