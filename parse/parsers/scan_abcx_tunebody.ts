/**
 * ABCx Scanner - Scans ABCx chord sheet notation
 *
 * ABCx is a simplified subset of ABC notation for chord sheet transcriptions.
 * The tune body contains: chord symbols, bar lines, annotations, comments,
 * multi-measure rests, and inline fields.
 */

import { ABCContext } from "./Context";
import { scanDirective } from "./infoLines/scanDirective";
import { Ctx, EOL, TT, WS, freeText, info_line, isAtEnd, tuneStartBeforeSectBrk, sectionBreak, fileHeader } from "./scan";
import { annotation, barline2, collectInvalidToken, comment, inline_field, pEOL, pSectionBrk, rest } from "./scan_tunebody";

/**
 * Chord symbol pattern for ABCx format
 * Matches: Root[#b]?[quality][extensions][alterations][/bass]
 *
 * Examples: C, Am, G7, Cmaj7, Dm7b5, F#m7, Bb/D, Cmaj7#11, C-7, Cdim, C°, Cø7
 *
 * Note: Quality alternatives are ordered longest-first to ensure
 * "maj" is matched before "m" in chords like "Cmaj7"
 *
 * Quality symbols:
 * - maj, min, dim, aug, sus, add, alt, m, M: standard ABC quality indicators
 * - `-`: alternate notation for minor (e.g., C-7 = Cm7)
 * - `°`: diminished symbol (e.g., C°7 = Cdim7)
 * - `ø`, `Ø`: half-diminished symbols (e.g., Cø7 = Cm7b5)
 * - `alt`: altered dominant (e.g., Calt7 = C7 with implied altered tensions)
 * - `-^`: minor-major 7 (e.g., C-^7 = minor triad with a major 7th)
 */
export const pChordSymbol = /[A-Gacdefg][#b]?(maj|min|dim|aug|sus|add|alt|-\^|m|M|-|°|ø|Ø)?[0-9]*(#[0-9]+|b[0-9]+)*(\/[A-Gacdefg][#b]?)?/;

/**
 * Scans a chord symbol token
 * Pattern: Root note (A-G) + optional accidental (#/b) + optional quality + optional extensions + optional bass
 */
export function chordSymbol(ctx: Ctx): boolean {
  const match = new RegExp(`^${pChordSymbol.source}`).exec(ctx.source.substring(ctx.current));
  if (!match) return false;

  ctx.current += match[0].length;
  ctx.push(TT.CHORD_SYMBOL);
  return true;
}

/**
 * Scans an ABCx tune body
 * ABCx tune bodies contain: chord symbols, barlines, annotations, comments,
 * multi-measure rests, and inline fields
 */
export function scanAbcxTuneBody(ctx: Ctx): boolean {
  while (!isAtEnd(ctx) && !ctx.test(pSectionBrk)) {
    ctx.start = ctx.current;

    // Try each tokenizer in order of precedence
    // inline_field must come before chordSymbol to prevent [K:C] being parsed as chord K
    if (scanDirective(ctx)) continue;
    if (comment(ctx)) continue;
    if (info_line(ctx)) continue;
    if (annotation(ctx)) continue;
    if (inline_field(ctx)) continue;
    if (barline2(ctx)) continue;
    if (rest(ctx)) continue;
    if (chordSymbol(ctx)) continue;
    if (WS(ctx)) continue;
    if (EOL(ctx)) continue;

    // Collect invalid characters using the shared function with ABCx-specific recovery points
    collectInvalidToken(ctx, isAbcxRecoveryPoint);
  }
  return true;
}

/**
 * Checks if current position is a recovery point for ABCx scanning
 */
function isAbcxRecoveryPoint(ctx: Ctx): boolean {
  return (
    ctx.test(pEOL) ||
    ctx.test(/[ \t]/) ||
    ctx.test(/[|:[\]]/) || // barline characters
    ctx.test(/[A-Gacdefg]/) || // chord symbol start (excluding 'b' which is flat accidental)
    ctx.test('"') || // annotation start
    ctx.test("%") // comment start
  );
}

/**
 * Main ABCx Scanner function
 * Scans ABCx source text into tokens
 */
export function ScannerAbcx(source: string, abcContext: ABCContext): Array<import("./scan").Token> {
  const ctx = new Ctx(String.raw`${source}`, abcContext);

  while (!isAtEnd(ctx)) {
    ctx.start = ctx.current;
    fileStructureAbcx(ctx);
  }

  ctx.push(TT.EOF);
  return ctx.tokens;
}

/**
 * Scans ABCx file structure (header + tunes)
 */
function fileStructureAbcx(ctx: Ctx): void {
  while (!isAtEnd(ctx)) {
    if (sectionBreak(ctx)) continue;
    if (fileHeader(ctx)) continue;
    // Inline tune scanning: check for tune start then scan body
    if (tuneStartBeforeSectBrk(ctx.source.substring(ctx.current))) {
      scanAbcxTuneBody(ctx);
      continue;
    }
    if (scanDirective(ctx)) continue;
    if (comment(ctx)) continue;
    if (EOL(ctx)) continue;
    freeText(ctx);
  }
}
