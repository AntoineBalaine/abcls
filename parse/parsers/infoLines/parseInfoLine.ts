import { followedBy } from "../../helpers";
import { Expr, KV, Binary, Unary, Grouping, AbsolutePitch } from "../../types/Expr";
import { ParseCtx } from "../parse";
import { parsePitch } from "../parse"; // Reuse existing pitch parsing logic
import { Token, TT } from "../scan";

/**
 * Unified info line parser using generic expression types
 *
 * This parser produces a generic expression tree that can be used by
 * an interpreter to handle all info line types (K:, M:, L:, Q:, V:).
 *
 * Replaces the type-specific sub-parsers with a single generic approach.
 */
export function parseInfoLine2(ctx: ParseCtx): Array<Expr | Token> {
  const expressions: (Expr | Token)[] = [];

  while (!(ctx.isAtEnd() || ctx.check(TT.EOL) || ctx.check(TT.COMMENT) || ctx.check(TT.SCT_BRK))) {
    if (ctx.match(TT.WS)) continue;

    const expr = parseExpression(ctx);
    if (expr) {
      expressions.push(expr);
    } else {
      // If we can't parse anything, store the token and advance to avoid infinite loop
      expressions.push(ctx.advance());
    }
  }

  while (ctx.match(TT.COMMENT)) {
    expressions.push(ctx.previous());
  }

  return expressions;
}

/**
 * Parse a complete expression (KV or binary)
 */
export function parseExpression(ctx: ParseCtx): Expr | null {
  // Check for KV expression first (identifier followed by =)
  if (ctx.check(TT.IDENTIFIER) && followedBy(ctx, [TT.EQL], [TT.WS])) {
    return parseKV(ctx);
  }

  // Check for absolute pitch KV expression (NOTE_LETTER + optional ACCIDENTAL + optional NUMBER followed by =)
  if (ctx.check(TT.NOTE_LETTER) && isAbsPitchAssignment(ctx)) {
    return prsAbsPitch(ctx);
  }

  // Otherwise try to parse as binary expression or standalone value
  const result = prsBinaryExpr(ctx);

  // Wrap standalone tokens in KV expressions (tokens that aren't part of binary/unary expressions)
  if (result instanceof Token) {
    return new KV(ctx.abcContext.generateId(), result);
  }

  return result;
}

/**
 * Parse key-value expressions: key=value
 */
export function parseKV(ctx: ParseCtx): KV | null {
  const key = ctx.advance();

  // Skip whitespace between key and equals
  while (ctx.match(TT.WS)) {}

  const equals = ctx.advance();

  // Skip whitespace between equals and value
  while (ctx.match(TT.WS)) {}

  // Parse the value as an expression (handles unary operators like -2, and
  // trailing binary modifiers like the octave shift in clef=treble+8/treble-8)
  const value = prsBinaryExpr(ctx);
  if (!value) {
    ctx.report("Expected value after '='");
    return null;
  }

  return new KV(ctx.abcContext.generateId(), value, key, equals);
}

/**
 * Parse binary expressions: handles +, -, and / operators with proper precedence.
 * Whitespace around operators is allowed (e.g., "4 / 4" is valid).
 */
export function prsBinaryExpr(ctx: ParseCtx): Expr | null {
  // Skip leading whitespace (important for expressions inside parentheses)
  while (ctx.match(TT.WS)) {}

  let left = parsePrimary(ctx);
  if (!left) return null;

  while (ctx.match(TT.WS)) {}

  while (ctx.check(TT.PLUS) || ctx.check(TT.MINUS) || ctx.check(TT.SLASH)) {
    const operator = ctx.advance();
    while (ctx.match(TT.WS)) {}
    const right = parsePrimary(ctx);
    if (!right) {
      ctx.report(`Expected expression after '${operator.lexeme}'`);
      return null;
    }
    left = new Binary(ctx.abcContext.generateId(), left, operator, right);
    while (ctx.match(TT.WS)) {}
  }

  return left;
}

/**
 * Parse primary expressions: numbers, identifiers, parenthesized expressions, unary operators
 */
function parsePrimary(ctx: ParseCtx): Expr | Token | null {
  // Handle unary operators (+ and -)
  if (ctx.match(TT.MINUS) || ctx.match(TT.PLUS)) {
    const operator = ctx.previous();
    const operand = parsePrimary(ctx);
    if (!operand) {
      ctx.report(`Expected expression after '${operator.lexeme}'`);
      return null;
    }
    return new Unary(ctx.abcContext.generateId(), operator, operand);
  }

  // Handle parenthesized expressions
  if (ctx.match(TT.LPAREN)) {
    const leftParen = ctx.previous();
    const expr = prsBinaryExpr(ctx);
    if (!expr) {
      ctx.report("Expected expression after '('");
      return null;
    }

    let rightParen: Token | undefined;
    if (ctx.match(TT.RPAREN)) {
      rightParen = ctx.previous();
    } else {
      ctx.report("Expected ')' after expression");
    }

    return new Grouping(ctx.abcContext.generateId(), expr, leftParen, rightParen);
  }

  // Handle absolute pitches (NOTE_LETTER + optional ACCIDENTAL + optional NUMBER)
  if (ctx.check(TT.NOTE_LETTER)) {
    return parseAbsolutePitch(ctx);
  }

  // Handle tune body pitches (ACCIDENTAL + NOTE_LETTER + optional OCTAVE)
  if (ctx.check(TT.ACCIDENTAL)) {
    return parsePitch(ctx);
  }

  // Handle numbers and other value tokens - return them as Tokens
  // QUESTION: Shouldn’t we handle unsigned numbers as a unary expression, though?
  if (isValueToken(ctx.peek())) {
    return ctx.advance();
  }

  return null;
}

/**
 * Check if token can be a value in a KV expression
 */
function isValueToken(token: Token | null): boolean {
  if (!token) return false;

  return [TT.IDENTIFIER, TT.ANNOTATION, TT.NUMBER, TT.SPECIAL_LITERAL].includes(token.type);
}

/**
 * Parse absolute pitch: NOTE_LETTER + optional ACCIDENTAL + optional NUMBER
 * Examples: G4, F#5, Bb3, C
 * Used in tempo markings like Q: G4=120
 */
function parseAbsolutePitch(ctx: ParseCtx): AbsolutePitch | null {
  if (!ctx.check(TT.NOTE_LETTER)) return null;

  const noteLetter = ctx.advance();
  let alteration: Token | undefined;
  let octave: Token | undefined;

  // Optional accidental
  if (ctx.check(TT.ACCIDENTAL)) {
    alteration = ctx.advance();
  }

  // Optional numeric octave
  if (ctx.check(TT.NUMBER)) {
    octave = ctx.advance();
  }

  return new AbsolutePitch(ctx.abcContext.generateId(), noteLetter, alteration, octave);
}

/**
 * Check if current position has an absolute pitch pattern followed by =
 */
function isAbsPitchAssignment(ctx: ParseCtx): boolean {
  let offset = 1; // Start after NOTE_LETTER

  // Skip optional accidental
  if (ctx.tokens[ctx.current + offset]?.type === TT.ACCIDENTAL) {
    offset++;
  }

  // Skip optional numeric octave
  if (ctx.tokens[ctx.current + offset]?.type === TT.NUMBER) {
    offset++;
  }

  // Skip optional whitespace
  if (ctx.tokens[ctx.current + offset]?.type === TT.WS) {
    offset++;
  }

  // Check if followed by =
  return ctx.tokens[ctx.current + offset]?.type === TT.EQL;
}

/**
 * Parse absolute pitch key-value expressions: G4=120
 */
function prsAbsPitch(ctx: ParseCtx): KV | null {
  const absolutePitch = parseAbsolutePitch(ctx);
  if (!absolutePitch) {
    return null;
  }

  if (!ctx.match(TT.EQL)) {
    ctx.report("Expected '=' after absolute pitch");
    return null;
  }
  const equals = ctx.previous();

  if (!isValueToken(ctx.peek())) {
    ctx.report("Expected value after '='");
    return null;
  }

  const value = ctx.advance();
  return new KV(ctx.abcContext.generateId(), value, absolutePitch, equals);
}
