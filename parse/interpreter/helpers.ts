import { Token } from "../parsers/scan";
import { AccidentalType, BarType, Font } from "../types/abcjs-ast";
import { FontSpec } from "../types/directive-specs";

export function determineBarType(barTokens: Token[]): BarType {
  const barString = barTokens.map((t) => t.lexeme).join("");

  // Map ABC bar notations to ABCJS bar types
  switch (barString) {
    case "|":
      return BarType.BarThin;
    case "||":
      return BarType.BarThinThin;
    case "|:":
      return BarType.BarLeftRepeat;
    case ":|":
      return BarType.BarRightRepeat;
    case "::":
      return BarType.BarDblRepeat;
    case "|]":
      return BarType.BarThinThick;
    case "[|":
      return BarType.BarThickThin;
    case "[|]":
      return BarType.BarInvisible;
    default:
      return BarType.BarThin;
  }
}

/**
 * Converts an accidental string from ABC notation to AccidentalType.
 * This is the canonical implementation used by all interpreters and transforms
 * that need to convert accidental lexemes to AccidentalType enum values.
 */
export function convertAccidentalToType(accidental: string): AccidentalType {
  switch (accidental) {
    case "^":
      return AccidentalType.Sharp;
    case "_":
      return AccidentalType.Flat;
    case "=":
      return AccidentalType.Natural;
    case "^^":
      return AccidentalType.DblSharp;
    case "__":
      return AccidentalType.DblFlat;
    default:
      return AccidentalType.Natural;
  }
}

/**
 * Converts a FontSpec (from the semantic analyzer, all fields optional) to a Font
 * (for the abcjs Tune output, all fields required). Because FontSpec represents
 * a partial font specification from a directive (e.g., %%titlefont Times 20),
 * missing fields are filled from `defaults` if provided, or from hardcoded
 * fallback values.
 */
export function fontSpecToFont(spec: FontSpec, defaults?: Font): Font {
  return {
    face: spec.face ?? defaults?.face ?? "",
    size: spec.size ?? defaults?.size ?? 12,
    weight: spec.weight ?? defaults?.weight ?? "normal",
    style: spec.style ?? defaults?.style ?? "normal",
    decoration: spec.decoration ?? defaults?.decoration ?? "none",
  };
}
