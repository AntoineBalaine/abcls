import { advance, Ctx, isAtEnd, TT, WS } from "../scan";
import { collectInvalidToken, pEOL, pitch, pPitch } from "../scan_tunebody";
import { identifier, stringLiteral, singleChar } from "./scanInfoLine";

/**
 * Directive scanner for stylesheet directives (%%directive content)
 *
 * Handles the content after %% in stylesheet directives, supporting:
 * - TT.IDENTIFIER identifiers (accepts hyphens in words)
 * - TT.ANNOTATION string literals
 * - TT.NUMBER numbers (floats & ints)
 * - TT.NUMBER + TT.MEASUREMENT_UNIT numbers with units (like "in" for inches)
 * - TT.NUMBER + TT.SLASH + TT.NUMBER rational numbers (integer fractions)
 * - Pitch tokens (tune-body pitches using pitch() function)
 * - TT.IDENTIFIER + TT.EQL + TT.NUMBER octave/transpose offset assignments (handled by separate tokens)
 * - Special case: %%begintext multi-line directive
 */
export function scanDirective(ctx: Ctx): boolean {
  // Special case: multi-line text directive
  if (ctx.test(/^%%begintext/i)) {
    return scanTextDirective(ctx);
  }

  // Special case: single-line text directives (%%text, %%center, %%header, %%footer)
  if (ctx.test(/^%%(text|center|header|footer)\b/i)) {
    return scanSingleLineTextDirective(ctx);
  }

  if (!ctx.test("%%")) return false;
  advance(ctx, 2);
  ctx.push(TT.STYLESHEET_DIRECTIVE);

  // Voice IDs (e.g. "B") can look like ABC pitches; abcls-voices takes plain
  // identifiers only, so its content must never be scanned as a pitch.
  const isVoicesDirective = ctx.test(/abcls-voices\b/i);

  while (!(isAtEnd(ctx) || ctx.test(pEOL) || ctx.test("%"))) {
    if (numberWithUnit(ctx)) continue; // number + unit (must come before number)
    if (!isVoicesDirective && tuneBodyPitch(ctx)) continue; // ABC pitches (^c, _b, =f)

    // Score/staves directive grouping symbols (check BEFORE identifier)
    if (singleChar(ctx, "(", TT.LPAREN)) continue;
    if (singleChar(ctx, ")", TT.RPAREN)) continue;
    if (singleChar(ctx, "{", TT.LBRACE)) continue;
    if (singleChar(ctx, "}", TT.RBRACE)) continue;
    if (singleChar(ctx, "[", TT.LBRACKET)) continue;
    if (singleChar(ctx, "]", TT.RBRACKET)) continue;
    if (singleChar(ctx, "|", TT.PIPE)) continue;

    if (identifier(ctx)) continue; // identifiers with hyphens
    if (stringLiteral(ctx)) continue; // "quoted strings"
    if (signedNumber(ctx)) continue; // signed integers and floats (including negative)
    if (singleChar(ctx, "=", TT.EQL)) continue; // =
    if (singleChar(ctx, "/", TT.SLASH)) continue; // /
    if (WS(ctx, true)) continue;
    collectInvalidToken(ctx);
  }

  return true;
}
function tuneBodyPitch(ctx: Ctx): boolean {
  if (!ctx.test(new RegExp(`^${pPitch.source}([%\n \t]|$)`))) return false;
  return pitch(ctx);
}

/**
 * Scan signed number: positive or negative integers and floats
 * Examples: 1, -1, 42, -12, 1.5, -0.25, .9, -.5
 * Produces: TT.NUMBER
 */
function signedNumber(ctx: Ctx): boolean {
  // Pattern for signed numbers: optional minus sign followed by number
  // Supports both standard notation (0.9) and shorthand notation (.9)
  const signedNumberPattern = /^-?(([0-9]+(\.[0-9]+)?)|(\.[0-9]+))/;

  const match = signedNumberPattern.exec(ctx.source.substring(ctx.current));
  if (!match) return false;

  ctx.current += match[0].length;
  ctx.push(TT.NUMBER);
  return true;
}

/**
 * Scan text directive block (%%begintext ... %%endtext)
 *
 * This is a special multi-line directive that:
 * 1. Starts with %%begintext (no parameters)
 * 2. Contains free text on multiple lines
 * 3. Ends with %%endtext (or EOF if never found)
 * 4. Lines starting with %% (except %%endtext) have the %% prefix stripped
 *
 * Produces: TT.STYLESHEET_DIRECTIVE + TT.IDENTIFIER("begintext") + TT.FREE_TXT (text content) + [TT.STYLESHEET_DIRECTIVE + TT.IDENTIFIER("endtext")]
 */
export function scanTextDirective(ctx: Ctx): boolean {
  // Check if this is %%begintext
  if (!ctx.test(/^%%begintext/i)) return false;

  advance(ctx, 2); // %%
  ctx.push(TT.STYLESHEET_DIRECTIVE);

  // Consume "begintext" identifier
  const identifierMatch = /^begintext/i.exec(ctx.source.substring(ctx.current));
  if (identifierMatch) {
    ctx.current += identifierMatch[0].length;
    ctx.push(TT.IDENTIFIER);
  }

  // Skip to end of begintext line
  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    advance(ctx);
  }
  if (ctx.test(pEOL)) {
    advance(ctx); // consume newline
    ctx.line++;
  }

  // Remember the starting position and line for the FREE_TXT token
  const textStartPosition = ctx.current;
  const textStartLine = ctx.line;

  // Now accumulate text until %%endtext or EOF
  const textLines: string[] = [];
  let foundEndText = false;

  while (!isAtEnd(ctx)) {
    // Check if this line is %%endtext
    if (ctx.test(/^%%endtext/i)) {
      foundEndText = true;
      break;
    }

    // Capture the current line
    // const lineStart = ctx.current;
    let lineContent = "";

    while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
      lineContent += ctx.source[ctx.current];
      advance(ctx);
    }

    textLines.push(lineContent);

    // Consume newline if present
    if (ctx.test(pEOL)) {
      advance(ctx);
      ctx.line++;
    }
  }

  // Push the accumulated text as FREE_TXT token
  const fullText = textLines.join("\n");
  // Set start to the beginning of the text content and temporarily set line to where text started
  ctx.start = textStartPosition;
  const savedLine = ctx.line;
  ctx.line = textStartLine;
  ctx.push(TT.FREE_TXT);
  // Update the token's lexeme to contain the actual text
  if (ctx.tokens.length > 0) {
    const textToken = ctx.tokens[ctx.tokens.length - 1];
    textToken.lexeme = fullText;
  }
  // Restore the current line (we're now at %%endtext or EOF)
  ctx.line = savedLine;

  // If we found %%endtext, consume it
  if (foundEndText) {
    ctx.start = ctx.current;
    advance(ctx, 2); // %%
    ctx.push(TT.STYLESHEET_DIRECTIVE);

    const endIdentifierMatch = /^endtext/i.exec(ctx.source.substring(ctx.current));
    if (endIdentifierMatch) {
      ctx.current += endIdentifierMatch[0].length;
      ctx.push(TT.IDENTIFIER);
    }
  }

  return true;
}

/**
 * Scan single-line text directive (%%text, %%center, %%header, or %%footer)
 *
 * Because these directives should capture all remaining text on the line as a single value,
 * we create a FREE_TXT token with the combined text content.
 *
 * Produces: TT.STYLESHEET_DIRECTIVE + TT.IDENTIFIER("text"|"center"|"header"|"footer") + TT.FREE_TXT(text content)
 */
function scanSingleLineTextDirective(ctx: Ctx): boolean {
  // Check if this is %%text, %%center, %%header, or %%footer
  const match = /^%%(text|center|header|footer)\b/i.exec(ctx.source.substring(ctx.current));
  if (!match) return false;

  advance(ctx, 2); // %%
  ctx.push(TT.STYLESHEET_DIRECTIVE);

  // Consume the directive name (text or center)
  const directiveName = match[1];
  ctx.current += directiveName.length;
  ctx.push(TT.IDENTIFIER);

  // Skip whitespace after directive name (without pushing tokens)
  WS(ctx, true);

  while (!isAtEnd(ctx) && !ctx.test(pEOL)) {
    advance(ctx);
  }
  ctx.push(TT.FREE_TXT);

  return true;
}

/**
 * Scan number with measurement unit: number immediately followed by alpha-only string
 * Examples: 12in, 5.5cm, 100pt
 * Produces: TT.NUMBER followed by TT.MEASUREMENT_UNIT
 */
function numberWithUnit(ctx: Ctx): boolean {
  // Look ahead to see if we have number + alpha pattern
  const numberMatch = /^([0-9]+(\.[0-9]+)?)([a-zA-Z]+)/.exec(ctx.source.substring(ctx.current));
  if (!numberMatch) return false;

  const numberPart = numberMatch[1];
  const unitPart = numberMatch[3];

  // Parse the number part
  ctx.current += numberPart.length;
  ctx.push(TT.NUMBER);

  // Parse the unit part
  ctx.current += unitPart.length;
  ctx.push(TT.MEASUREMENT_UNIT);

  return true;
}
