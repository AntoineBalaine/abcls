/**
 * ABCx to ABC Converter
 *
 * Converts ABCx chord sheet AST to standard ABC AST.
 * Chord symbols are converted to quoted annotations followed by invisible rests.
 * Rest durations are calculated to evenly fill each bar based on the number of chords.
 *
 * Architecture:
 *   ABCx AST -> AbcxToAbcConverter -> ABC AST -> Formatter2 -> ABC string
 *
 * The converter transforms ChordSymbol nodes into Annotation + Rest node pairs.
 * For stringification, use Formatter2 on the resulting ABC AST.
 */

import { isToken } from "../helpers";
import { ABCContext } from "../parsers/Context";
import { parseAbcx } from "../parsers/parse_abcx";
import { Token, TT } from "../parsers/scan";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import {
  Annotation,
  BarLine,
  Binary,
  ChordSymbol,
  File_header,
  File_structure,
  Info_line,
  Rest,
  Rhythm,
  Tune,
  Tune_Body,
  Tune_header,
  tune_body_code,
} from "../types/Expr";
import { IRational, createRational } from "./fmt/rational";
import { AbcFormatter } from "./Formatter";

/**
 * Configuration for ABCx to ABC conversion
 */
export interface AbcxConversionConfig {
  /** Default meter if not specified (default: 4/4) */
  defaultMeter?: IRational;
  /** Default note length if not specified (default: 1/8) */
  defaultNoteLength?: IRational;
}

/**
 * Converts ABCx AST to ABC AST (not string)
 *
 * This converter transforms ABCx-specific nodes (ChordSymbol) into
 * standard ABC nodes (Annotation + Rest). The result can be passed
 * to Formatter2 for stringification.
 */
export class AbcxToAbcConverter {
  config: AbcxConversionConfig;
  abcContext: ABCContext;

  /** Current meter (time signature) */
  meter: IRational;
  /** Current note length (L: field) */
  noteLength: IRational;
  /** Track whether we added M: or L: fields */
  addedMeter: boolean = false;
  addedNoteLength: boolean = false;

  constructor(abcContext: ABCContext, config?: AbcxConversionConfig) {
    this.abcContext = abcContext;
    this.config = config || {};
    this.meter = this.config.defaultMeter || createRational(4, 4);
    this.noteLength = this.config.defaultNoteLength || createRational(1, 8);
  }

  /**
   * Main conversion function - converts an ABCx file structure to ABC AST
   */
  convert(ast: File_structure): File_structure {
    const convertedContents: Array<Tune | Token> = [];

    for (const item of ast.contents) {
      if (item instanceof Tune) {
        convertedContents.push(this.convertTune(item));
      } else {
        convertedContents.push(item);
      }
    }

    // Convert file header if present
    const convertedFileHeader = ast.file_header ? this.convertFileHeader(ast.file_header) : null;

    return new File_structure(this.abcContext.generateId(), convertedFileHeader, convertedContents, ast.linear, ast.formatterConfig);
  }

  /**
   * Calculates the greatest common divisor of two numbers
   */
  greatestCommonDivisor(firstNumber: number, secondNumber: number): number {
    return secondNumber === 0 ? firstNumber : this.greatestCommonDivisor(secondNumber, firstNumber % secondNumber);
  }

  /**
   * Calculates the rest length for each chord in a bar
   * @param numChords Number of chord symbols in the bar
   * @param isFullBar Whether this is a single chord occupying the full bar
   * @returns Object with rest letter (x or X) and length as numerator/denominator
   */
  calculateRestLength(numChords: number, isFullBar: boolean): { letter: string; numerator: number; denominator: number } {
    if (numChords <= 0) return { letter: "x", numerator: 1, denominator: 1 };

    // "X" is ABC's invisible whole-measure rest: on its own it already
    // means "one full measure, whatever the meter is", and a trailing
    // number changes its meaning to "this many whole measures" (a
    // multi-measure rest), not "a rest lasting this many note-lengths".
    // A single chord spanning the full bar is exactly one measure, so it
    // must be bare "X" with no duration suffix — computing a note-length
    // based numerator here (as the general per-chord case below does) and
    // attaching it to "X" would wrongly turn one measure of rest into a
    // multi-measure rest spanning that many measures instead.
    if (isFullBar) return { letter: "X", numerator: 1, denominator: 1 };

    // Calculate bar length in terms of the default note length
    const meterValue = this.meter.numerator / this.meter.denominator;
    const noteLengthValue = this.noteLength.numerator / this.noteLength.denominator;
    const barUnits = meterValue / noteLengthValue;
    const restUnits = barUnits / numChords;
    const restLetter = "x";

    if (restUnits === Math.floor(restUnits)) {
      return { letter: restLetter, numerator: Math.floor(restUnits), denominator: 1 };
    } else {
      // Handle fractional rests
      const restNumerator = restUnits * this.noteLength.denominator;
      const restDenominator = this.noteLength.denominator;
      const divisor = this.greatestCommonDivisor(Math.round(restNumerator), restDenominator);
      return {
        letter: restLetter,
        numerator: Math.round(restNumerator) / divisor,
        denominator: restDenominator / divisor,
      };
    }
  }

  /**
   * Creates a synthetic token for the converter
   */
  createToken(type: TT, lexeme: string): Token {
    return new Token(type, lexeme, this.abcContext.generateId());
  }

  /**
   * Converts file header (passes through unchanged)
   */
  convertFileHeader(header: File_header): File_header {
    return new File_header(this.abcContext.generateId(), [...header.contents]);
  }

  /**
   * Converts a tune, transforming ChordSymbols in the body
   */
  convertTune(tune: Tune): Tune {
    // Reset state for each tune
    this.meter = this.config.defaultMeter || createRational(4, 4);
    this.noteLength = this.config.defaultNoteLength || createRational(1, 8);
    this.addedMeter = false;
    this.addedNoteLength = false;

    // First, scan the header to extract M: and L: values
    let hasMeter = false;
    let hasNoteLength = false;

    for (const line of tune.tune_header.info_lines) {
      if (line instanceof Info_line) {
        const key = line.key.lexeme.trim().toUpperCase();
        if (key === "M:") {
          hasMeter = true;
          if (line.value2 && line.value2.length > 0) {
            const meterExpr = line.value2[0];
            if (meterExpr instanceof Binary && meterExpr.operator.type === TT.SLASH) {
              const n = meterExpr.left instanceof Token ? parseInt(meterExpr.left.lexeme) : 4;
              const d = meterExpr.right instanceof Token ? parseInt(meterExpr.right.lexeme) : 4;
              this.meter = createRational(n, d);
            }
          }
        } else if (key === "L:") {
          hasNoteLength = true;
          if (line.value2 && line.value2.length > 0) {
            const lenExpr = line.value2[0];
            if (lenExpr instanceof Binary && lenExpr.operator.type === TT.SLASH) {
              const n = lenExpr.left instanceof Token ? parseInt(lenExpr.left.lexeme) : 1;
              const d = lenExpr.right instanceof Token ? parseInt(lenExpr.right.lexeme) : 8;
              this.noteLength = createRational(n, d);
            }
          }
        }
      }
    }

    // Convert header, adding M: and L: if needed
    const convertedHeader = this.convertTuneHeader(tune.tune_header, hasMeter, hasNoteLength);

    // Convert body
    const convertedBody = tune.tune_body ? this.convertTuneBody(tune.tune_body) : null;

    return new Tune(this.abcContext.generateId(), convertedHeader, convertedBody, tune.linear, tune.formatterConfig);
  }

  /**
   * Converts tune header (passes through unchanged - M: and L: are implied if not present)
   */
  convertTuneHeader(header: Tune_header, _hasMeter: boolean, _hasNoteLength: boolean): Tune_header {
    // Pass through header unchanged - do NOT add default M: or L: fields
    // They can be implied, and it's up to the composer to decide whether to include them
    return new Tune_header(this.abcContext.generateId(), [...header.info_lines], header.voices);
  }

  /**
   * Converts tune body, transforming ChordSymbols to Annotation + Rest
   */
  convertTuneBody(body: Tune_Body): Tune_Body {
    const convertedSystems = body.sequence.map((system) => this.convertSystem(system));
    return new Tune_Body(this.abcContext.generateId(), convertedSystems, body.voices);
  }

  /**
   * Converts a system (line), counting chords per bar and transforming them
   */
  convertSystem(elements: tune_body_code[]): tune_body_code[] {
    // First pass: count chords per bar
    let totalChordsInBar = 0;
    const barChordCounts: number[] = [];

    for (const elem of elements) {
      if (elem instanceof ChordSymbol) {
        totalChordsInBar++;
      } else if (elem instanceof BarLine) {
        barChordCounts.push(totalChordsInBar);
        totalChordsInBar = 0;
      }
    }
    // Don't forget the last bar
    if (totalChordsInBar > 0) {
      barChordCounts.push(totalChordsInBar);
    }

    // Second pass: convert elements
    const result: tune_body_code[] = [];
    let barIndex = 0;
    let chordsInCurrentBar = barChordCounts[barIndex] || 1;

    for (const elem of elements) {
      if (elem instanceof ChordSymbol) {
        // Convert chord symbol to Annotation + Rest
        const isFullBar = chordsInCurrentBar === 1;
        const { letter, numerator, denominator } = this.calculateRestLength(chordsInCurrentBar, isFullBar);

        // Create annotation node: "ChordName"
        const annotationToken = this.createToken(TT.ANNOTATION, `"${elem.token.lexeme}"`);
        const annotation = new Annotation(this.abcContext.generateId(), annotationToken);
        result.push(annotation);

        // Create rest node
        const restToken = this.createToken(TT.REST, letter);
        let rhythm: Rhythm | undefined;

        // Only create rhythm if numerator != 1 or denominator != 1
        if (numerator !== 1 || denominator !== 1) {
          if (denominator === 1) {
            // Simple multiplier like x4
            const numToken = this.createToken(TT.NUMBER, String(numerator));
            rhythm = new Rhythm(this.abcContext.generateId(), numToken, undefined, undefined);
          } else {
            // Fractional like x3/4
            const numToken = this.createToken(TT.NUMBER, String(numerator));
            const slashToken = this.createToken(TT.SLASH, "/");
            const denomToken = this.createToken(TT.NUMBER, String(denominator));
            rhythm = new Rhythm(this.abcContext.generateId(), numToken, slashToken, denomToken);
          }
        }

        const rest = new Rest(this.abcContext.generateId(), restToken, rhythm);
        result.push(rest);
      } else if (elem instanceof BarLine) {
        result.push(elem);
        barIndex++;
        chordsInCurrentBar = barChordCounts[barIndex] || 1;
      } else if (isToken(elem)) {
        // Filter out whitespace but keep other tokens
        if (elem.type !== TT.WS) {
          result.push(elem);
        } else {
          result.push(elem);
        }
      } else {
        // Pass through other expressions unchanged
        result.push(elem);
      }
    }

    return result;
  }
}

/**
 * Helper function to convert ABCx string to ABC AST
 */
export function convertAbcxToAbcAst(abcx: string, ctx: ABCContext, config?: AbcxConversionConfig): File_structure {
  const tokens = ScannerAbcx(abcx, ctx);
  const ast = parseAbcx(tokens, ctx);
  const converter = new AbcxToAbcConverter(ctx, config);

  return converter.convert(ast);
}

/**
 * Helper function to convert ABCx string to ABC string
 * (for backwards compatibility - uses Formatter2 for stringification)
 */
export function convertAbcxToAbc(abcx: string, ctx: ABCContext, config?: AbcxConversionConfig): string {
  const abcAst = convertAbcxToAbcAst(abcx, ctx, config);
  const formatter = new AbcFormatter(ctx);
  return formatter.stringify(abcAst);
}
