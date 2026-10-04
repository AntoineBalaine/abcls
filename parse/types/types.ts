import { Comment, Info_line, music_code } from "./Expr";

/**
 * List of token types that the scanner is capable of recognizing.
 * This list tries to be exhaustive, and in case the Scanner
 * can't match a `TokenType` to a char, it will throw a Scanner Error.
 *
 * This is bound to happen for rare characters such as subscript and postscript chars
 * in an info line, or in a tune body's code.
 */
// export enum TokenType {
//   APOSTROPHE,
//   ANTISLASH_EOL,
//   AMPERSAND, // &
//   BACKTICK, // `
//   BARLINE, //|
//   COLON, // :
//   COMMA, //,,,,,,
//   COMMENT,
//   DOLLAR, //$
//   DOT,
//   EOF,
//   EOL,
//   ESCAPED_CHAR,
//   FLAT_HALF, // quarter tone flat
//   FLAT, // ♭
//   FLAT_DBL, // 𝄫
//   GREATER, //>>>>>
//   LEFT_BRACE, // {
//   LEFTBRKT, // [
//   LEFTPAREN, // (
//   LEFTPAREN_NUMBER, // (1
//   LESS, // <<<<<
//   NOTE_LETTER,
//   LETTER,
//   LETTER_COLON,
//   MINUS, //-
//   NATURAL, // ♮
//   NUMBER,
//   PLUS, //+
//   PLUS_COLON, //+: - extending info line
//   RESERVED_CHAR,
//   RIGHT_BRACE, // }
//   RIGHT_BRKT,
//   RIGHT_PAREN, // )
//   SHARP_HALF, // quarter tone sharp
//   SHARP, // ♯
//   SHARP_DBL, // 𝄪
//   SLASH, // ////
//   STRING, // any un-categorizable text
//   STYLESHEET_DIRECTIVE, // %%
//   SYMBOL, // ![a-zA-Z]!
//   TILDE, // ~
//   /**
//    * # * ; ? @ are reserved symbols, treated as ws
//    */
//   WHITESPACE,
//   WHITESPACE_FORMATTER, // THIS IS NOT USED IN THE LEXER OR THE PARSER, only in the formatter
//   INVALID,
// }

/**
 * Based off VsCode's `Position` class.
 *
 * This type is used to represent the position of a character
 * inside of a score.
 *
 * Do note that `line` and `character` are 0-indexed
 */
export type Position = {
  /**
   * The zero-based line value.
   */
  line: number;
  /**
   * The zero-based character value.
   */
  character: number;
};

/**
 * Based off VsCode's `Range` class,
 * this type is used to represent the range of {@link Position}s that an expression occupies.
 * eg:
 * ```abc
 * % here's an abc score
 * X:1
 * _a//-
 * ```
 * In this case, `_a//-` is a note that starts at line 1, char 0, and ends at line 1, char 4.
 */
export type Range = {
  /**
   * The start position. It is before or equal to [end](#Range.end).
   */
  start: Position;

  /**
   * The end position. It is after or equal to [start](#Range.start).
   */
  end: Position;
};

/**
 * The origin of an error, used by the {@link Parser}.
 */
export enum ParserErrorType {
  BACKTICK = "BACKTICK",
  CHORD = "CHORD",
  DECORATION = "DECORATION",
  FILE_HEADER = "FILE_HEADER",
  GRACE_GROUP = "GRACE_GROUP",
  INLINE_FIELD = "INLINE_FIELD",
  LETTER = "LETTER",
  MULTI_MEASURE_REST = "MULTI_MEASURE_REST",
  NOTE = "NOTE",
  PITCH = "PITCH",
  REST = "REST",
  RHYTHM = "RHYTHM",
  TUNE_BODY = "TUNE_BODY",
  TUNE_HEADER = "TUNE_HEADER",
  TUPLET = "TUPLET",
  UNKNOWN = "UNKNOWN",
  SCANNER = "SCANNER",
  PARSER = "PARSER",
  REPEAT_NUMBER = "REPEAT_NUMBER",
  SYMBOL = "SYMBOL",
  ANALYZER = "ANALYZER",
  INTERPRETER = "INTERPRETER",
}

/**
 * An array that represents a system, eg a list of voices/instrument parts
 * that play simultaneously in a score.
 */
export type System = Array<Comment | Info_line | music_code>;
