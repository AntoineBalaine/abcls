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

const SYMBOL_TO_QUALITY: Array<[string, ChordQuality]> = [
  ["sus2", ChordQuality.Suspended2],
  ["sus4", ChordQuality.Suspended4],
  ["add", ChordQuality.Add],
  ["^", ChordQuality.Major],
  ["-", ChordQuality.Minor],
  ["o", ChordQuality.Diminished],
  ["h", ChordQuality.HalfDiminished],
  ["+", ChordQuality.Augmented],
];

function rootToText(root: KeyRoot, accidental: KeyAccidental): string {
  return root + (accidental === KeyAccidental.None ? "" : accidental);
}

function alterationToText(alt: ChordAlteration): string {
  return (alt.type === "sharp" ? "#" : "b") + String(alt.degree);
}

export function parsedChordToIrealText(chord: ParsedChord): string {
  let text = rootToText(chord.root, chord.rootAccidental);

  if (chord.quality === ChordQuality.Dominant || !chord.qualityExplicit) {
    // Bare extension number, no quality letter, e.g. "C7".
    if (chord.extension !== null) text += String(chord.extension);
  } else if (chord.quality === ChordQuality.Add) {
    text += "add" + (chord.extension !== null ? String(chord.extension) : "");
  } else {
    text += QUALITY_TO_SYMBOL[chord.quality];
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

const CHORD_TEXT_PATTERN = /^([A-G])([#b]?)((?:sus2|sus4|add|\^|-|o|h|\+)?)(\d+)?((?:[#b]\d+)*)(?:\/([A-G])([#b]?))?$/;

export function irealTextToParsedChord(text: string): ParsedChord | null {
  const match = CHORD_TEXT_PATTERN.exec(text.trim());
  if (!match) return null;

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
  let text = rootToText(chord.root, chord.rootAccidental);

  if (chord.quality === ChordQuality.Dominant || !chord.qualityExplicit) {
    if (chord.extension !== null) text += String(chord.extension);
  } else if (chord.quality === ChordQuality.Add) {
    text += "add" + (chord.extension !== null ? String(chord.extension) : "");
  } else {
    text += ABCX_QUALITY_TO_SYMBOL[chord.quality];
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
