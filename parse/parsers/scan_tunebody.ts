import { scanDirective } from "./infoLines/scanDirective";
import { absolutePitch, infoLineIdentifier, singleChar, specialLiteral, stringLiteral, unsignedNumber } from "./infoLines/scanInfoLine";
import { Decorations } from "../types/abcjs-ast";
import {
  Ctx,
  EOL,
  TT,
  WS,
  advance,
  info_line,
  isAtEnd,
  macro_invocation,
  precededBy,
  tuneStartBeforeSectBrk,
  user_symbol_decl,
  user_symbol_invocation,
} from "./scan";

export const pEOL = "\n";
export const pMacroLine = /[m][ \t]*:/;
export const pUserSymbol = /U[ \t]*:/;
export const pInfoLine = /[a-zA-Z][ \t]*:/;
export const pSymbolLine = /s[ \t]*:/;
export const pLyricLine = /[wW][ \t]*:/;
export const pInfoLnCtd = /[ \t]*\+:[ \t]*/;

export const pTuneHeadStrt = /[ \t]*X:/;
export const pTuneStart = new RegExp(`^(?:(?!\n[ \t]*\n).)*${pTuneHeadStrt.source}`, "s");
// Duration pattern: slashes, fractions, integers (including 0 for no-stem), broken rhythm
// Note: 0 is allowed as numerator (no-stem) but not as denominator
export const pDuration = /(\/+)|(([1-9][0-9]*)?\/[1-9][0-9]*)|([0-9]+)|([>]+|[<]+)/;
export const pSectionBrk = /\n([ \t]*\n)+/;
export const pNumber = /[1-9][0-9]*/;
export const pRest = /[zZxX]/;
const pAccidental = /^((\^[\^/]?)|(_[_/]?)|=)/;
// export const pPitch = /[\^=_]?[a-gA-G][,']*/;
export const pPitch = new RegExp(`((\\^[\\^\\/]?)|(_[_\\/]?)|=)?[a-gA-G][,']*`);
export const pString = /"[^\n]*"/;
// Chord pattern: [ followed by pitches (with optional rhythm) and/or strings, then ]
// Note: rhythm values inside chords are allowed (scanner parses them, interpreter handles them)
export const pChord = new RegExp(`\\[[ \\t]*((${pString.source}[ \\t]*)+|(${pPitch.source}(?:${pDuration.source})?-?[ \\t]*)+)\\]`);
export const pDeco = /[~.HJKkLMnOPRSTuv]/;

export const pTuplet = new RegExp(`\\(${pNumber.source}(:(${pNumber.source})?)?(:(${pNumber.source})?)?`);
export const pBrLn = /((\[\|)|(\|\])|(\|\|)|(\|))/;
const pSymbol = /![^\n!]*!/;
const pDecoLookahead = new RegExp(`^${pDeco.source}+(?=(${pPitch.source}|${pRest.source}|${pChord.source}|${pSymbol.source}))`);
/**
inline field is a left bracket, followed by a letter, followed by a colon
followed by any text, followed by a right bracket
*/
export const pInlineField = /\[[ \t]*[a-zA-Z][ \t]*:[^\]]*\]/;
export const pGraceGrp = new RegExp(`{/?([-() \\t]*(${pPitch.source})(${pDuration.source})?[-() \\t]*)+}`);

export function note(ctx: Ctx): boolean {
  const hasTie = tie(ctx);
  // When a tie was consumed, only attempt pitch if what follows looks like a pitch start.
  // This prevents spurious "Expected pitch" errors and orphaned ACCIDENTAL tokens
  // for valid constructs like [CEG]-[FAC] where the tie stands alone.
  if (hasTie && !ctx.test(/[\^_=a-gA-G]/)) {
    return true;
  }
  if (!pitch(ctx)) {
    ctx.report("Expected pitch");
    return false;
  }
  rhythm(ctx);
  tie(ctx);
  return true;
}

export function tie(ctx: Ctx): boolean {
  if (ctx.test("-")) {
    advance(ctx);
    ctx.push(TT.TIE);

    return true;
  } else return false;
}

export function ampersand(ctx: Ctx): boolean {
  if (!ctx.test("&")) return false;
  if (ctx.test(/&\n/)) {
    advance(ctx, 2);
    ctx.push(TT.VOICE_OVRLAY);
    return true;
  } else {
    advance(ctx);
    ctx.push(TT.VOICE);
    return true;
  }
}

/**
 * Scans for line continuation in tune body.
 * Pattern: \<space?><comment?><EOL>
 * - Backslash followed by optional whitespace (spaces/tabs)
 * - Optionally followed by a comment (% to end of line)
 * - Must end with newline
 *
 * Note: Only the backslash is captured as the LINE_CONT token.
 * Spaces, comments, and newlines are scanned separately.
 */
export function line_continuation(ctx: Ctx): boolean {
  // Pattern validates context: \ followed by optional spaces/tabs, optional comment, then newline
  const pattern = /^\\[ \t]*(%[^\n]*)?\n/;
  const match = pattern.exec(ctx.source.substring(ctx.current));

  if (!match) return false;

  // Only advance by 1 character (just the backslash)
  advance(ctx, 1);
  ctx.push(TT.LINE_CONT);
  return true;
}

export function tuplet(ctx: Ctx): boolean {
  const fullMatch = new RegExp(`^${pTuplet.source}`).exec(ctx.source.substring(ctx.current));
  if (!fullMatch) return false;

  // Push the opening parenthesis token
  ctx.start = ctx.current;
  ctx.current += 1; // Move past the opening parenthesis
  ctx.push(TT.TUPLET_LPAREN);

  // Extract and push the p value
  const pMatch = new RegExp(`^${pNumber.source}`).exec(ctx.source.substring(ctx.current));
  if (pMatch) {
    ctx.start = ctx.current;
    ctx.current += pMatch[0].length;
    ctx.push(TT.TUPLET_P);
  }

  // Check for q value (after first colon)
  if (ctx.source[ctx.current] === ":") {
    // Push the colon token
    ctx.start = ctx.current;
    ctx.current += 1; // Move past the colon
    ctx.push(TT.TUPLET_COLON);

    // Check if there's a q value after the colon
    const qMatch = new RegExp(`^${pNumber.source}`).exec(ctx.source.substring(ctx.current));
    if (qMatch) {
      ctx.start = ctx.current;
      ctx.current += qMatch[0].length;
      ctx.push(TT.TUPLET_Q);
    }

    // Check for r value (after second colon)
    if (ctx.source[ctx.current] === ":") {
      // Push the second colon token
      ctx.start = ctx.current;
      ctx.current += 1; // Move past the colon
      ctx.push(TT.TUPLET_COLON);

      // Check if there's an r value after the colon
      const rMatch = new RegExp(`^${pNumber.source}`).exec(ctx.source.substring(ctx.current));
      if (rMatch) {
        ctx.start = ctx.current;
        ctx.current += rMatch[0].length;
        ctx.push(TT.TUPLET_R);
      }
    }
  }

  // The tuplet is now fully parsed with individual tokens
  // No need for backward compatibility token anymore

  return true;
}

export function comment(ctx: Ctx): boolean {
  if (!ctx.test("%")) return false;
  advance(ctx);
  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    advance(ctx);
  }
  ctx.push(TT.COMMENT);
  return true;
}

export function decoration(ctx: Ctx): boolean {
  const mtch = pDecoLookahead.exec(ctx.source.substring(ctx.start));
  if (mtch) {
    ctx.current = ctx.start + mtch[0].length;
    ctx.push(TT.DECORATION);
    return true;
  }
  return false;
}

export const pSystemBreak = /!/;

/**
 * Scans for a system break - a standalone bang surrounded by whitespace.
 * Pattern: ` ! ` where the bang is either:
 * - At start of source OR preceded by whitespace/newline
 * - At end of source OR followed by whitespace/newline
 */
export function systemBreak(ctx: Ctx): boolean {
  // Check if current position is a bang
  if (!ctx.test(pSystemBreak)) return false;

  // Check if preceded by whitespace/newline or at start of source
  const prevChar = ctx.current > 0 ? ctx.source.charAt(ctx.current - 1) : null;
  const precededByWsOrStart = prevChar === null || /[ \t\n]/.test(prevChar);
  if (!precededByWsOrStart) return false;

  // Check if followed by whitespace/newline or at end of source
  const nextChar = ctx.current + 1 < ctx.source.length ? ctx.source.charAt(ctx.current + 1) : null;
  const followedByWsOrEnd = nextChar === null || /[ \t\n]/.test(nextChar);
  if (!followedByWsOrEnd) return false;

  // Consume the bang character
  advance(ctx);
  ctx.push(TT.SYSTEM_BREAK);
  return true;
}

// The full set of decoration names AbcLs recognizes, used to tell a genuine
// !decoration! or +decoration+ token apart from other bang/plus-delimited
// content that symbol() also matches (e.g. unrecognized vendor extensions).
const KNOWN_DECORATION_NAMES = new Set<string>(Object.values(Decorations));

// Mirrors the delimiter- and position-hint-stripping visitDecorationExpr
// (TuneInterpreter.ts) applies to a matched !decoration!/+decoration+ lexeme,
// so this classification stays in sync with what the interpreter accepts.
export function isKnownDecorationLexeme(delimitedLexeme: string): boolean {
  let name = delimitedLexeme.slice(1, -1);
  if (name.startsWith("^") || name.startsWith("_")) {
    name = name.substring(1);
  }
  return KNOWN_DECORATION_NAMES.has(name);
}

export function symbol(ctx: Ctx): boolean {
  if (!(ctx.test(/![^\n!]*!/) || ctx.test(/\+[^\n+]*\+/))) return false;
  const is_plus_symbol = ctx.test("+");
  advance(ctx);
  while (!ctx.test(is_plus_symbol ? "+" : "!")) {
    advance(ctx);
  }
  advance(ctx);
  const lexeme = ctx.source.substring(ctx.start, ctx.current);
  ctx.push(isKnownDecorationLexeme(lexeme) ? TT.DECORATION : TT.SYMBOL);
  return true;
}

export function rhythm(ctx: Ctx): boolean {
  if (!ctx.test(pDuration)) return false;
  let parsed = false;
  // Match any non-negative integer (including 0, 02, 007, etc.)
  // Zero numerator indicates zero-duration / nostem (matching abcjs behavior)
  if (ctx.test(/[0-9]/)) {
    advance(ctx);
    while (ctx.test(/[0-9]/)) {
      advance(ctx);
    }
    ctx.push(TT.RHY_NUMER);
    parsed = true;
  }
  if (ctx.test("/")) {
    while (ctx.test("/")) {
      advance(ctx);
    }
    ctx.push(TT.RHY_SEP);
    if (ctx.test(pNumber)) {
      advance(ctx);
      while (ctx.test(/[0-9]/)) {
        advance(ctx);
      }
      ctx.push(TT.RHY_DENOM);
    }
    parsed = true;
  }

  if (ctx.test(/[><]/)) {
    const mtch = /^([>]+|[<]+)/.exec(ctx.source.substring(ctx.current));
    if (mtch) {
      ctx.current = ctx.current + mtch[0].length;
      ctx.push(TT.RHY_BRKN);
      parsed = true;
    }
  }
  return parsed;
}

export function pitch(ctx: Ctx): boolean {
  accidental(ctx);
  if (!ctx.test(/[a-gA-G]/)) {
    ctx.report("Expected pitch");
    return false;
  }
  advance(ctx);
  ctx.push(TT.NOTE_LETTER);
  const mtch = /^[',]+/.exec(ctx.source.substring(ctx.current));
  if (mtch) {
    ctx.current = ctx.start + mtch[0].length;
    ctx.push(TT.OCTAVE);
  }
  return true;
}

/**
 * Tune body pitch scanner for inline fields.
 * Matches pitches like ^c, _b, =f in tune body context.
 * Pattern requires pitch followed by terminator (whitespace, comment, newline, bracket) or end-of-input.
 */
function tuneBodyPitch(ctx: Ctx): boolean {
  if (!ctx.test(new RegExp(`^${pPitch.source}([%\\n \\t\\]]|$)`))) return false;
  return pitch(ctx);
}

export function accidental(ctx: Ctx): boolean {
  const match = pAccidental.exec(ctx.source.substring(ctx.current));
  if (!match) return false;

  ctx.current += match[0].length;

  ctx.push(TT.ACCIDENTAL);
  return true;
}

export function barline(ctx: Ctx): boolean {
  const mtch = new RegExp(`^${pBrLn.source}`).exec(ctx.source.substring(ctx.start));
  if (mtch) {
    ctx.current = ctx.start + mtch[0].length;
    ctx.push(TT.BARLINE);
    return true;
  }
  return false;
}

export function bcktck_spc(ctx: Ctx): boolean {
  if (!ctx.test("`")) return false;
  advance(ctx);
  ctx.push(TT.BCKTCK_SPC);
  return true;
}

export function y_spacer(ctx: Ctx): boolean {
  if (!ctx.test("y")) return false;
  advance(ctx);
  ctx.push(TT.Y_SPC);
  rhythm(ctx);
  return true;
}

export function slur(ctx: Ctx): boolean {
  if (!ctx.test(/[()]/)) return false;
  advance(ctx);
  ctx.push(TT.SLUR);
  return true;
}

export function dotted_slur(ctx: Ctx): boolean {
  // Check for .( pattern (dotted slur opening)
  // Emit as single token to prevent formatter from inserting whitespace between . and (
  if (!ctx.test(/\.\(/)) return false;
  advance(ctx); // consume .
  advance(ctx); // consume (
  ctx.push(TT.DOTTED_SLUR);
  return true;
}

export function rest(ctx: Ctx): boolean {
  if (!ctx.test(pRest)) return false;

  advance(ctx);

  ctx.push(TT.REST);
  rhythm(ctx);
  return true;
}

export function chord(ctx: Ctx): boolean {
  if (!ctx.test(pChord)) return false;
  advance(ctx);
  ctx.push(TT.CHRD_LEFT_BRKT);
  // Store reference to the opening bracket token for warning location
  const chordStartToken = ctx.tokens[ctx.tokens.length - 1];

  // Track rhythm values inside chord for warnings
  let notesWithRhythm = 0;
  const rhythmTypes = [TT.RHY_NUMER, TT.RHY_SEP, TT.RHY_DENOM, TT.RHY_BRKN];

  while (!isAtEnd(ctx) && !ctx.test("]")) {
    if (WS(ctx, true)) continue;
    if (ctx.test(pString)) {
      annotation(ctx);
      continue;
    } else {
      const tokenCountBefore = ctx.tokens.length;
      note(ctx);
      // Check if rhythm tokens were added
      const hasRhythm = ctx.tokens.slice(tokenCountBefore).some((t) => rhythmTypes.includes(t.type));
      if (hasRhythm) {
        notesWithRhythm++;
      }
      continue;
    }
  }
  advance(ctx);
  // tie(ctx);
  ctx.push(TT.CHRD_RIGHT_BRKT);
  rhythm(ctx);

  // Emit warnings for rhythm values inside chord brackets
  if (notesWithRhythm === 1) {
    ctx.errorReporter?.ScannerWarning("Rhythm on note in chord - prefer writing rhythm after ] bracket", chordStartToken);
  } else if (notesWithRhythm > 1) {
    ctx.errorReporter?.ScannerWarning("Multiple rhythm values in chord - only first note's rhythm is used", chordStartToken);
  }

  return true;
}

export function grace_grp(ctx: Ctx): boolean {
  if (!ctx.test(pGraceGrp)) return false;
  advance(ctx);
  ctx.push(TT.GRC_GRP_LEFT_BRACE);
  if (ctx.test("/")) {
    advance(ctx);
    ctx.push(TT.GRC_GRP_SLSH);
  }
  while (!isAtEnd(ctx) && !ctx.test("}")) {
    if (note(ctx)) {
      continue;
    } else if (slur(ctx)) {
      continue;
    } else if (ctx.test(/[ \t]/)) {
      advance(ctx);
      continue;
    } else {
      ctx.report("Expected pitch or whitespace");
      return false;
    }
  }
  advance(ctx);
  ctx.push(TT.GRC_GRP_RGHT_BRACE);
  return true;
}

/**
 * Scan content tokens for V: (voice) inline fields.
 *
 * Because voice IDs can look like key signatures (e.g., "DMix" could be
 * D Mixolydian), we prioritize identifiers and do not attempt to match
 * absolute pitches or special literals.
 */
function scanVoiceFieldContent(ctx: Ctx): boolean {
  if (infoLineIdentifier(ctx)) return true;
  if (stringLiteral(ctx)) return true;
  if (singleChar(ctx, "=", TT.EQL)) return true;
  if (singleChar(ctx, "-", TT.MINUS)) return true;
  if (singleChar(ctx, "+", TT.PLUS)) return true;
  if (unsignedNumber(ctx)) return true;
  return false;
}

/**
 * Scan content tokens for general inline fields (K:, M:, L:, Q:, etc.).
 *
 * Uses the original scanning order with absolutePitch before identifier
 * to correctly recognize key signatures and tempo note references.
 */
function scanGeneralFieldContent(ctx: Ctx): boolean {
  if (specialLiteral(ctx)) return true; // C, C|
  if (absolutePitch(ctx)) return true; // G4, F#5
  if (tuneBodyPitch(ctx)) return true; // ^c, _b
  if (infoLineIdentifier(ctx)) return true; // treble, major
  if (stringLiteral(ctx)) return true; // "Allegro"
  if (singleChar(ctx, "=", TT.EQL)) return true;
  if (singleChar(ctx, "-", TT.MINUS)) return true;
  if (singleChar(ctx, "+", TT.PLUS)) return true;
  if (singleChar(ctx, "/", TT.SLASH)) return true;
  if (singleChar(ctx, "(", TT.LPAREN)) return true;
  if (singleChar(ctx, ")", TT.RPAREN)) return true;
  if (unsignedNumber(ctx)) return true;
  return false;
}

export function inline_field(ctx: Ctx): boolean {
  if (!ctx.test(pInlineField)) return false;
  advance(ctx);
  ctx.push(TT.INLN_FLD_LFT_BRKT); // [

  // Capture the field type before consuming the header
  const headerStart = ctx.current;

  // Scan the field header (K:, M:, etc.)
  while (!isAtEnd(ctx) && !ctx.test(":")) {
    advance(ctx);
  }

  // Extract field type (e.g., "V" from "[V:...")
  const fieldType = ctx.source.substring(headerStart, ctx.current).trim().toUpperCase();

  advance(ctx); // consume the :
  ctx.push(TT.INF_HDR);

  // Tokenize content using appropriate scanners based on field type
  const scanContent = fieldType === "V" ? scanVoiceFieldContent : scanGeneralFieldContent;

  while (!(isAtEnd(ctx) || ctx.test("]"))) {
    if (WS(ctx)) continue;
    if (scanContent(ctx)) continue;

    // Invalid token
    collectInvalidToken(ctx);
    break;
  }

  advance(ctx); // consume the ]
  ctx.push(TT.INLN_FLD_RGT_BRKT); // ]
  return true;
}

export function annotation(ctx: Ctx): boolean {
  // Match opening quote, then any chars (including escaped chars), then closing quote
  // Pattern supports escaped quotes like "D\"" but rejects newlines
  if (!ctx.test(/"([^"\\\n]|\\.)*"/)) return false;
  advance(ctx); // consume opening quote
  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    if (ctx.test("\\")) {
      advance(ctx); // consume backslash
      if (!isAtEnd(ctx) && !ctx.test(pEOL)) {
        advance(ctx); // consume escaped character
      }
    } else if (ctx.test('"')) {
      advance(ctx); // consume closing quote
      ctx.push(TT.ANNOTATION);
      return true;
    } else {
      advance(ctx);
    }
  }
  ctx.report("Unterminated string");
  return false;
}

/**
 * Parse repeat numbers when current token is a number
 * - Single number: 1
 * - Number list: 1,2,3
 * - Range: 1-3
 * - Mixed: 1,3,5-7,9
 * - X notation: 1x2,3 or 1,2x2,3
 */
export function scanRepeatNumbers(ctx: Ctx): boolean {
  // Must start with a number
  if (!ctx.test(/[ \t]*[1-9]/)) {
    return false;
  }

  // Parse the first number
  while (ctx.test(/[ \t]*[0-9]/)) {
    advance(ctx);
  }
  ctx.push(TT.REPEAT_NUMBER);

  // Continue parsing until we don't find valid repeat number syntax
  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    if (ctx.test(",")) {
      // Handle comma separator
      advance(ctx);
      ctx.push(TT.REPEAT_COMMA);

      // Must have a number after comma
      if (!ctx.test(/[1-9]/)) {
        ctx.report("Expected number after comma in repeat");
        return true; // Still return true as we parsed at least one number
      }

      while (ctx.test(/[0-9]/)) {
        advance(ctx);
      }
      ctx.push(TT.REPEAT_NUMBER);
    } else if (ctx.test("-")) {
      // Handle range dash
      advance(ctx);
      ctx.push(TT.REPEAT_DASH);

      // Must have a number after dash
      if (!ctx.test(/[1-9]/)) {
        ctx.report("Expected number after dash in repeat range");
        return true; // Still return true as we parsed at least one number
      }

      while (ctx.test(/[0-9]/)) {
        advance(ctx);
      }
      ctx.push(TT.REPEAT_NUMBER);
    } else if (ctx.test(/[xX]/)) {
      // Handle x notation
      advance(ctx);
      ctx.push(TT.REPEAT_X);

      // Must have a number after x
      if (!ctx.test(/[1-9]/)) {
        ctx.report("Expected number after x in repeat");
        return true; // Still return true as we parsed at least one number
      }

      while (ctx.test(/[0-9]/)) {
        advance(ctx);
      }
      ctx.push(TT.REPEAT_NUMBER);
    } else {
      // No more valid repeat number syntax
      break;
    }
  }

  return true; // Successfully parsed repeat numbers
}

export function scanTune(ctx: Ctx): boolean {
  if (!tuneStartBeforeSectBrk(ctx.source.substring(ctx.current))) return false;
  // if (!ctx.test(pTuneStart)) return false;
  while (!isAtEnd(ctx) && !ctx.test(pSectionBrk)) {
    ctx.start = ctx.current;
    // Try each tokenizer function in order of precedence
    if (scanDirective(ctx)) continue;
    if (comment(ctx)) continue;
    if (line_continuation(ctx)) continue;
    /** NOTE: macros are off for now */
    // if (macro_decl(ctx)) continue;
    if (user_symbol_decl(ctx)) continue;
    if (symbol_line(ctx)) continue;
    if (lyric_line(ctx)) continue;
    if (info_line(ctx)) continue;
    if (macro_invocation(ctx)) continue;
    if (user_symbol_invocation(ctx)) continue;
    if (annotation(ctx)) continue;
    if (inline_field(ctx)) continue;
    if (tuplet(ctx)) continue;
    if (dotted_slur(ctx)) continue;
    if (slur(ctx)) continue;
    if (grace_grp(ctx)) continue;
    if (chord(ctx)) continue;
    if (barline2(ctx)) continue;
    if (decoration(ctx)) continue;
    if (note(ctx)) continue;
    if (rest(ctx)) continue;
    if (y_spacer(ctx)) continue;
    if (systemBreak(ctx)) continue;
    if (symbol(ctx)) continue;
    if (ampersand(ctx)) continue;
    if (bcktck_spc(ctx)) continue;
    if (WS(ctx)) continue;
    if (EOL(ctx)) continue;
    // If no match is found, collect invalid characters into a token
    collectInvalidToken(ctx);
  }
  return true;
}

// Collect invalid characters into a token
// Accepts an otional recovery predicate; defaults to isRecoveryPoint
export function collectInvalidToken(ctx: Ctx, recoveryPredicate: (ctx: Ctx) => boolean = isRecoveryPoint): boolean {
  // Store the starting position to ensure we capture all characters
  const startPos = ctx.current;

  // Advance until we find a character that could start a valid token
  // or until we reach the end of the line or input
  while (!isAtEnd(ctx) && !ctx.test(pEOL) && !recoveryPredicate(ctx)) {
    advance(ctx);
  }

  // If we collected any characters, create an INVALID token
  if (ctx.current > startPos) {
    // Make sure we set the start position to the beginning of the invalid token
    ctx.start = startPos;
    ctx.report(`Invalid token: ${ctx.source.slice(ctx.start, ctx.current)}`);
    ctx.push(TT.INVALID);
    return true;
  }

  // If we didn't collect any characters (shouldn't happen), just advance
  advance(ctx);
  return false;
}

// Check if the current character could start a valid token
function isRecoveryPoint(ctx: Ctx): boolean {
  // Check for characters that could start valid tokens
  return (
    ctx.test(pEOL) || // stylesheet directive
    ctx.test(/[ \t]/) ||
    ctx.test(pBrLn) // comment
  );
}

/**
 * Writing down the rules as regular expressions:
 * ```
 * (:+)(\\|+\[ \t]*\\])?                    # Colon start rule
 * \\|+((:+)|(\[ \t]*(\\]|(\\[\\d+))))?     # Barline start rule
 * \\[(\\d+|(\\|(:+)?)|\\])              # Left bracket start rule
 * ```
 *
 * <colon>+(<barline>+(<WS>?<RBrkt>))?
 * <barline>+(<colon>+|(<WS>?(<RBrkt>|(<LBrkt><REPEAT_NUMBERS>))))?
 * <LBrkt>(<REPEAT_NUMBERS>|(<barline>(<colon>+)?)|<RBrkt>)
 */
export function barline2(ctx: Ctx): boolean {
  if (ctx.test(":")) return parseColonStart(ctx);
  if (ctx.test("|")) return parseBarlineStart(ctx);
  if (ctx.test("[")) return parseLeftBracketStart(ctx);

  return false;
}

/**
 * <colon>+(<barline>+(<WS>?<RBrkt>))?
 *
 * Parses barlines that start with one or more colons.
 * Handles optional barlines, whitespace, right brackets, and repeat numbers.
 */
export function parseColonStart(ctx: Ctx): boolean {
  while (ctx.test(":")) {
    advance(ctx);
  }
  if (ctx.test("|")) {
    advance(ctx);
    while (ctx.test("|")) {
      advance(ctx);
    }

    let match: RegExpExecArray | null = null;
    const rgt_brkt = /^[ \t]*\]/;
    const lft_brkt = /^[ \t]*\[/;
    const cur = ctx.source.substring(ctx.current);

    if (rgt_brkt.test(cur)) {
      match = rgt_brkt.exec(cur);
    } else if (lft_brkt.test(cur)) {
      match = lft_brkt.exec(cur);
    }
    if (match) {
      ctx.current = ctx.current + match[0].length;
    }

    ctx.push(TT.BARLINE);
    scanRepeatNumbers(ctx);
    return true;
  }
  ctx.push(TT.BARLINE);
  return true;
}

/**
 * <barline>+(<colon>+|(<WS>?(<RBrkt>|(<LBrkt><REPEAT_NUMBERS>))))?
 *
 * Parses barlines that start with one or more barline characters.
 * Handles optional colons, whitespace, brackets, and repeat numbers.
 */
export function parseBarlineStart(ctx: Ctx): boolean {
  if (!ctx.test(/\|+((:+)|( *(\]|\[)))?/)) return false;

  while (ctx.test("|")) {
    advance(ctx);
  }

  // Case 1: Colons
  if (ctx.test(":")) {
    while (ctx.test(":")) {
      advance(ctx);
    }
    ctx.push(TT.BARLINE);
    return true;
  } else if (ctx.test(/[ \t]*[1-9]/)) {
    while (ctx.test(" ")) {
      advance(ctx);
    }
    ctx.push(TT.BARLINE);
    scanRepeatNumbers(ctx);
    return true;
  } else if (ctx.test(/[ \t]*\[[ \t]*[1-9]/)) {
    while (ctx.test(" ")) {
      advance(ctx);
    }
    advance(ctx); // Consume left bracket
    ctx.push(TT.BARLINE);
    scanRepeatNumbers(ctx);
    return true;
  } else if (ctx.test(/[ \t]*\]/)) {
    while (ctx.test(" ")) {
      advance(ctx);
    }
    advance(ctx); // Right bracket
    ctx.push(TT.BARLINE);
    return true;
  }

  // Push the barline token with the entire matched text
  ctx.push(TT.BARLINE);
  return true;
}

/**
 * <LBrkt>(<REPEAT_NUMBERS>|(<barline>(<colon>+)?)|<RBrkt>)
 *
 * Parses barlines that start with a left bracket.
 * Handles repeat numbers, barlines with optional colons, and right brackets.
 */
export function parseLeftBracketStart(ctx: Ctx): boolean {
  if (!ctx.test(/\[(( *[0-9])|(\|:+)?|\])/)) return false;

  advance(ctx); // Consume left brkt

  if (ctx.test(/[1-9]/)) {
    // repeat numbers
    ctx.push(TT.BARLINE);
    scanRepeatNumbers(ctx);
    return true;
  } else if (ctx.test(/\|/)) {
    //Barline possibly followed by colons or right bracket
    advance(ctx); // Consume barline

    // Optional colons
    if (ctx.test(":")) {
      while (ctx.test(":")) {
        advance(ctx);
      }
    } else if (ctx.test(/\]/)) {
      // Optional right bracket
      advance(ctx);
    }
  } else if (ctx.test(/\]/)) {
    // Right bracket (empty brackets)
    advance(ctx);
  }

  // Push the barline token with the entire matched text
  ctx.push(TT.BARLINE);
  return true;
}

export function symbol_line(ctx: Ctx): boolean {
  if (!(ctx.test(pSymbolLine) && precededBy(ctx, new Set([TT.EOL, TT.SCT_BRK]), new Set([TT.WS])))) return false;

  const match = new RegExp(`^${pSymbolLine.source}`).exec(ctx.source.substring(ctx.current));
  if (!match) return false;
  ctx.current += match[0].length;
  ctx.push(TT.SY_HDR);

  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    if (WS(ctx)) continue;
    if (barline(ctx)) continue;
    if (ctx.test("*")) {
      advance(ctx);
      ctx.push(TT.SY_STAR);
      continue;
    }
    if (!isAtEnd(ctx) && !ctx.test(/[ \t%*\n]/)) {
      while (!isAtEnd(ctx) && !ctx.test(pEOL) && !ctx.test(/[ \t%*\n]/) && !ctx.test(pBrLn)) {
        advance(ctx);
      }
      ctx.push(TT.SY_TXT);
    }
    if (ctx.test("%")) break;
  }

  comment(ctx);
  return true;
}

/**
-  (hyphen) break between syllables within a word
_  (underscore) previous syllable is to be held for an extra note
*  one note is skipped (i.e. * is equivalent to a blank syllable)
~  appears as a space; aligns multiple words under one note
\- appears as hyphen; aligns multiple syllables under one note
|  advances to the next bar
LY_HYPH
LY_UNDR
LY_STAR
LY_SPS
LY_CTND
*/
export function lyric_line(ctx: Ctx): boolean {
  if (!ctx.test(pLyricLine)) return false;

  const match = new RegExp(`^${pLyricLine.source}`).exec(ctx.source.substring(ctx.current));
  if (!match) return false;
  ctx.current += match[0].length;

  if (match[0].charAt(0) === "W") {
    ctx.push(TT.LY_SECT_HDR);
  } else {
    ctx.push(TT.LY_HDR);
  }

  while (!isAtEnd(ctx)) {
    if (field_continuation(ctx)) continue;

    // Handle line continuation: consume the backslash, then any whitespace/comment/EOL that follows
    if (line_continuation(ctx)) {
      // The LINE_CONT token was already pushed by line_continuation()
      // Now consume any whitespace and/or comment that follows the backslash
      while (WS(ctx) || comment(ctx)) {}
      // Consume the EOL to complete the line continuation
      if (ctx.test(pEOL)) {
        EOL(ctx);
      }
      // Continue processing lyric content on the next line
      continue;
    }

    // Only break on EOL if we haven't just handled a line continuation
    if (ctx.test(pEOL)) break;
    if (comment(ctx)) continue;

    if (WS(ctx)) continue;
    if (barline(ctx)) continue;

    if (ctx.test("*")) {
      advance(ctx);
      ctx.push(TT.LY_STAR); // Skip one note
      continue;
    }

    if (ctx.test("_")) {
      advance(ctx);
      ctx.push(TT.LY_UNDR); // Hold previous syllable for extra note
      continue;
    }

    if (ctx.test("~")) {
      advance(ctx);
      ctx.push(TT.LY_SPS); // Space that aligns multiple words under one note
      continue;
    }

    if (ctx.test("-")) {
      advance(ctx);
      ctx.push(TT.LY_HYPH); // Break between syllables within a word
      continue;
    }

    if (ctx.test("\\-")) {
      advance(ctx, 2);
      ctx.push(TT.LY_HYPH); // Appears as hyphen; aligns multiple syllables under one note
      continue;
    }

    if (!isAtEnd(ctx) && !isSyllableDelimiter(ctx)) {
      while (!isAtEnd(ctx) && !isSyllableDelimiter(ctx)) {
        advance(ctx);
      }
      ctx.push(TT.LY_TXT);
      continue;
    }

    ctx.report(`Unexpected character in lyric line: ${ctx.source.charAt(ctx.current)}`);
    collectInvalidToken(ctx);
    continue;
  }
  return true;
}

function isSyllableDelimiter(ctx: Ctx): boolean {
  // Check for whitespace, special lyric symbols, and EOL
  if (ctx.test(/[ \t%*_~\\\-\n]/)) return true;

  // Check for barlines using the more comprehensive pBrLn regex
  if (ctx.test(pBrLn)) return true;

  return false;
}

export function field_continuation(ctx: Ctx): boolean {
  if (!ctx.test("\n+:")) return false;
  EOL(ctx);
  advance(ctx, 2);
  ctx.push(TT.INF_CTND);
  return true;
}
