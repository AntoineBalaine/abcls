import { advance, Ctx, isAtEnd, TT, WS, collectInvalidInfoLn } from "../scan";
import { pEOL, pSectionBrk, pInfoLine } from "../scan_tunebody";
import { infoHeader } from "./infoLnHelper";

/**
 * Unified info line scanner using generic token types
 *
 * This scanner produces a generic token stream that can be used by
 * a unified parser to handle all info line types (K:, M:, L:, Q:, V:).
 *
 * Replaces the type-specific sub-scanners with a single generic approach.
 */
export function scanInfoLine2(ctx: Ctx): boolean {
  if (!infoHeader(ctx)) return false;

  while (!(isAtEnd(ctx) || ctx.test(pEOL) || ctx.test("%"))) {
    if (WS(ctx)) continue;
    if (specialLiteral(ctx)) continue; // C, C|
    if (absolutePitch(ctx)) continue; // G4, F#5, Bb3 (note + optional accidental + optional numeric octave)
    if (infoLineIdentifier(ctx)) continue; // abc, treble, major
    if (stringLiteral(ctx)) continue; // "Allegro"
    if (singleChar(ctx, "=", TT.EQL)) continue; // =
    if (singleChar(ctx, "-", TT.MINUS)) continue; // -
    if (singleChar(ctx, "+", TT.PLUS)) continue; // +
    if (singleChar(ctx, "/", TT.SLASH)) continue; // /
    if (singleChar(ctx, "(", TT.LPAREN)) continue; // (
    if (singleChar(ctx, ")", TT.RPAREN)) continue; // )
    if (unsignedNumber(ctx)) continue; // 1, 4, 120

    // Invalid token - use existing helper
    collectInvalidInfoLn(ctx, "Invalid token in info line");
    break;
  }

  return true;
}

/**
 * Helper function to scan a single character and push the corresponding token type
 */
export function singleChar(ctx: Ctx, char: string, tokenType: TT): boolean {
  if (!ctx.test(char)) return false;

  advance(ctx);
  ctx.push(tokenType);
  return true;
}

/**
 * Scan identifier: unquoted words like "treble", "major", "clef"
 */
export function identifier(ctx: Ctx): boolean {
  if (!ctx.test(/[a-zA-Z][-a-zA-Z0-9_]*/)) return false;

  const match = /^[a-zA-Z][-a-zA-Z0-9_]*/.exec(ctx.source.substring(ctx.current));
  if (match) {
    ctx.current += match[0].length;
    ctx.push(TT.IDENTIFIER);
    return true;
  }
  return false;
}

/**
 * Scan identifier for info line content (K:, M:, etc.) where
 * hyphens followed by digits should be treated as separate tokens.
 * This way `treble-8` is parsed as identifier + minus + number,
 * while directive names like `setfont-1` use the regular identifier function.
 */
export function infoLineIdentifier(ctx: Ctx): boolean {
  if (!ctx.test(/[a-zA-Z]/)) return false;

  const match = /^[a-zA-Z](-(?=[a-zA-Z_])|[a-zA-Z0-9_])*/.exec(ctx.source.substring(ctx.current));
  if (match) {
    ctx.current += match[0].length;
    ctx.push(TT.IDENTIFIER);
    return true;
  }
  return false;
}

/**
 * Scan the voice id at the start of a V: info line or inline field.
 * Because abcjs reads the id as any text up to the first space (V:1_2, V:S1-a), the id is the whole first word, up to
 * a space, a comment, an equals sign (a property such as clef=bass) or the closing bracket of an inline field.
 * A plain number gives a NUMBER token, as the general number scanner would, and any other word gives an IDENTIFIER.
 */
export function voiceId(ctx: Ctx): boolean {
  const match = /^[^\s%=\]]+/.exec(ctx.source.substring(ctx.current));
  if (!match || ctx.source[ctx.current + match[0].length] === "=") return false;
  ctx.current += match[0].length;
  ctx.push(/^[0-9]+$/.test(match[0]) ? TT.NUMBER : TT.IDENTIFIER);
  return true;
}

/**
 * Scan string literal: quoted text like "Allegro", "Slowly"
 * Includes the quotes in the token
 */
export function stringLiteral(ctx: Ctx): boolean {
  if (!ctx.test(/"/)) return false;

  advance(ctx); // consume opening quote

  // Scan until closing quote or end of line
  while (!(isAtEnd(ctx) || ctx.test(/"/) || ctx.test(pEOL))) {
    advance(ctx);
  }

  // Consume closing quote if present
  if (ctx.test(/"/)) {
    advance(ctx);
  }

  ctx.push(TT.ANNOTATION);
  return true;
}

/**
 * Scan number: integers and floats
 * Matches: 1, 42, 1.5, 0.25, 120.0
 * Does not match: .5, 1., leading zeros like 01
 */
export function unsignedNumber(ctx: Ctx): boolean {
  // Unified regex pattern for integers and floats
  // - Integers: [1-9][0-9]* or just 0
  // - Floats: ([1-9][0-9]*|0)\.[0-9]+
  const numberPattern = /^(([1-9][0-9]*|0)(\.[0-9]+)?)/;

  const match = numberPattern.exec(ctx.source.substring(ctx.current));
  if (!match) return false;

  ctx.current += match[0].length;
  ctx.push(TT.NUMBER);
  return true;
}

/**
 * Scan special literals: C (common time) and C| (cut time)
 * These are special cases in meter info lines
 * Must be followed by whitespace, end of line, or comment
 */
export function specialLiteral(ctx: Ctx): boolean {
  // Check C| first since it contains C - must be followed by WS/EOL/comment
  if (ctx.test(/C\|(?=\s|$|%)/)) {
    advance(ctx, 2);
    ctx.push(TT.SPECIAL_LITERAL);
    return true;
  } else if (ctx.test(/C(?=\s|$|%)/)) {
    advance(ctx);
    ctx.push(TT.SPECIAL_LITERAL);
    return true;
  }

  return false;
}

/**
 * Scan absolute pitch: note letter + optional accidental + optional numeric octave
 * Examples: G4, F#5, Bb3, C
 * Used in tempo markings like Q: G4=120
 *
 * Important: A letter can only follow if there's an accidental or octave.
 * This prevents "Aa_" from being split as "A" (note) + "a_" (identifier).
 * - F#m → F (note) + # (accidental) - then m is scanned separately as identifier
 * - Aa_ → Aa_ (identifier) - letter directly after note, no match
 *
 * Note: Key signatures with modes (like DMix, Ador) are now handled by
 * the dedicated scanKeyInfoLine scanner, so we no longer match uppercase
 * notes followed by mode identifiers here.
 */
export function absolutePitch(ctx: Ctx): boolean {
  // Pattern breakdown:
  // 1. Note letter: [A-Ga-g]
  // 2. One of:
  //    - Accidental + optional octave + terminator: [#b][0-9]?(?=[= \t%\n\]a-zA-Z]|$)
  //    - Octave + terminator: [0-9](?=[= \t%\n\]a-zA-Z]|$)
  //    - Just terminator (no accidental, no octave): (?=[= \t%\n\]]|$)
  // OR: Uppercase note (A-G) followed by mode start (any letter except A-G which would be another note)
  // Mode names like Mix, Dor, Phr, Lyd, Loc, Ion, Aeo, min, maj, m start with letters other than A-G
  // Wrap entire pattern in non-capturing group so ctx.test()'s ^ anchor applies to both alternatives
  if (!ctx.test(/(?:[A-Ga-g]([#b][0-9]?(?=[= \t%\n\]a-zA-Z]|$)|[0-9](?=[= \t%\n\]a-zA-Z]|$)|(?=[= \t%\n\]]|$))|[A-G][H-Zh-z])/)) return false;

  advance(ctx); // consume note letter
  ctx.push(TT.NOTE_LETTER);

  // Optional accidental (# or b)
  if (ctx.test(/[#b]/)) {
    advance(ctx); // consume accidental
    ctx.push(TT.ACCIDENTAL);
  }

  // Optional numeric octave (0-9)
  if (ctx.test(/[0-9]/)) {
    advance(ctx); // consume octave digit
    ctx.push(TT.NUMBER);
  }

  return true;
}

/**
 * Scans continuation lines for H: (History) field.
 *
 * H: field supports free-form multi-line continuation. Continue reading
 * lines until another info line or section break is found.
 * The entire content (including line breaks) is returned as a single FREE_TXT token.
 *
 * Assumption: H: is never the last info field - there's always another
 * info line (like K:) or section break before the tune body starts.
 */
export function scanHistoryField(ctx: Ctx): void {
  const contentStart = ctx.current;

  while (!isAtEnd(ctx)) {
    // Check for section break BEFORE consuming EOL
    if (ctx.test(pSectionBrk)) break;

    // Check for EOL existence
    if (!ctx.test(pEOL)) break;

    // Peek ahead: check if the line after EOL is an info line
    // If so, don't consume the EOL - leave it for the next scanner
    // Use anchored regex to match only at the start of the next line
    const afterEol = ctx.source.substring(ctx.current + 1);
    if (new RegExp(`^${pInfoLine.source}`).test(afterEol)) break;

    // Consume EOL as part of the content (don't tokenize separately)
    advance(ctx); // consume newline character
    ctx.line++;

    // Scan line content (everything until next EOL, including comments)
    while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
      advance(ctx);
    }
  }

  // Push single FREE_TXT token for all accumulated content (including line breaks)
  if (ctx.current > contentStart) {
    ctx.start = contentStart;
    ctx.push(TT.FREE_TXT);
  }
}

/**
 * Dedicated scanner for V: (voice) info lines
 *
 * Voice info lines contain voice declarations like:
 *   V:1 clef=treble name="Soprano"
 *   V:DMix clef=bass
 *   V:Tenor name="Tenor voice"
 *
 * Because voice IDs can look like key signatures (e.g., "DMix" could be
 * D Mixolydian), we use a dedicated scanner that prioritizes identifiers
 * and does not attempt to match absolute pitches or key signature patterns.
 *
 * Tokens produced:
 *   - IDENTIFIER: voice ID, parameter names, clef values
 *   - NUMBER: numeric voice IDs or parameter values
 *   - ANNOTATION: quoted strings for name values
 *   - EQL, MINUS, PLUS: operators
 */
export function scanVoiceInfoLine(ctx: Ctx): boolean {
  if (!infoHeader(ctx)) return false;

  WS(ctx);
  voiceId(ctx);
  while (!(isAtEnd(ctx) || ctx.test(pEOL) || ctx.test("%"))) {
    if (WS(ctx)) continue;
    if (infoLineIdentifier(ctx)) continue;
    if (stringLiteral(ctx)) continue;
    if (singleChar(ctx, "=", TT.EQL)) continue;
    if (singleChar(ctx, "-", TT.MINUS)) continue;
    if (singleChar(ctx, "+", TT.PLUS)) continue;
    if (unsignedNumber(ctx)) continue;

    // Invalid token
    collectInvalidInfoLn(ctx, "Invalid token in voice info line");
    break;
  }

  return true;
}
