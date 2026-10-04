import { KeyRoot, KeyAccidental } from "../types/abcjs-ast";
import { parseKeyRoot, parseKeyAccidental } from "../utils/keyUtils";
import { ChordToken, ChordTT, ChordQuality, ChordAlteration, ParsedChord } from "./types";

const VALID_EXTENSIONS = new Set([5, 6, 7, 9, 11, 13, 69]);

function parseQuality(lexeme: string): ChordQuality {
  switch (lexeme) {
    case "maj":
    case "M":
      return ChordQuality.Major;
    case "min":
    case "m":
    case "-":
      return ChordQuality.Minor;
    case "dim":
    case "°":
      return ChordQuality.Diminished;
    case "aug":
    case "+":
      return ChordQuality.Augmented;
    case "ø":
    case "Ø":
      return ChordQuality.HalfDiminished;
    case "sus":
      return ChordQuality.Suspended4;
    case "sus2":
      return ChordQuality.Suspended2;
    case "sus4":
      return ChordQuality.Suspended4;
    case "add":
      return ChordQuality.Add;
    case "alt":
      return ChordQuality.Altered;
    case "-^":
      return ChordQuality.MinorMajor7;
    case "o^":
      return ChordQuality.DiminishedMajor7;
    default:
      return ChordQuality.Major;
  }
}

function parseAlteration(lexeme: string): ChordAlteration {
  const type = lexeme[0] === "#" ? "sharp" : "flat";
  const degree = parseInt(lexeme.substring(1), 10);
  return { type, degree };
}

function applyQualityInference(result: ParsedChord): ParsedChord {
  const ext = result.extension;

  // Power chord: extension 5 with no explicit quality
  if (ext === 5) {
    result.quality = ChordQuality.Power;
    return result;
  }

  // Dominant: extension 7, 9, 11, or 13 with no explicit quality
  if (ext === 7 || ext === 9 || ext === 11 || ext === 13) {
    result.quality = ChordQuality.Dominant;
    return result;
  }

  // Everything else stays Major
  return result;
}

/**
 * Parses chord tokens into a ParsedChord structure.
 * Returns null if the tokens do not represent a valid chord.
 */
export function parseChordSymbol(tokens: ChordToken[]): ParsedChord | null {
  if (tokens.length === 0) return null;

  let index = 0;
  let qualityExplicit = false;

  const result: ParsedChord = {
    root: KeyRoot.C,
    rootAccidental: KeyAccidental.None,
    quality: ChordQuality.Major,
    qualityExplicit: false,
    extension: null,
    alterations: [],
    bass: null,
  };

  // 1. Root (required, first token)
  if (tokens[index].type !== ChordTT.ROOT) return null;
  const root = parseKeyRoot(tokens[index].lexeme);
  if (root === null) return null;
  result.root = root;
  index += 1;

  // 2. Root accidental (optional)
  if (index < tokens.length && tokens[index].type === ChordTT.ACCIDENTAL) {
    result.rootAccidental = parseKeyAccidental(tokens[index].lexeme);
    index += 1;
  }

  // 3. Quality (optional)
  if (index < tokens.length && tokens[index].type === ChordTT.QUALITY) {
    result.quality = parseQuality(tokens[index].lexeme);
    qualityExplicit = true;
    index += 1;
  }

  // 4. Extension (optional)
  if (index < tokens.length && tokens[index].type === ChordTT.EXTENSION) {
    const ext = parseInt(tokens[index].lexeme, 10);
    if (!VALID_EXTENSIONS.has(ext)) {
      return null; // Invalid extension
    }
    result.extension = ext;
    index += 1;
  }

  // 5. Apply quality inference rules (only if quality was not explicit)
  if (!qualityExplicit) {
    applyQualityInference(result);
  }

  result.qualityExplicit = qualityExplicit;

  // 6. Alterations (optional, repeatable)
  while (index < tokens.length && tokens[index].type === ChordTT.ALTERATION) {
    const alteration = parseAlteration(tokens[index].lexeme);
    result.alterations.push(alteration);
    index += 1;
  }

  // 7. Bass (optional)
  if (index < tokens.length && tokens[index].type === ChordTT.BASS_SLASH) {
    index += 1; // skip slash
    if (index >= tokens.length || tokens[index].type !== ChordTT.ROOT) {
      return null; // invalid: slash without bass root
    }
    const bassRoot = parseKeyRoot(tokens[index].lexeme);
    if (bassRoot === null) return null;
    index += 1;
    let bassAcc = KeyAccidental.None;
    if (index < tokens.length && tokens[index].type === ChordTT.ACCIDENTAL) {
      bassAcc = parseKeyAccidental(tokens[index].lexeme);
      index += 1;
    }
    result.bass = { root: bassRoot, accidental: bassAcc };
  }

  return result;
}
