import {
  Token,
  TT,
  Expr,
  File_structure,
  Tune,
  Tune_header,
  Tune_Body,
  Info_line,
  Note,
  Pitch,
  Rhythm,
  Rest,
  Chord,
  Beam,
  Grace_group,
  BarLine,
  Decoration,
  Annotation,
  Inline_field,
  MultiMeasureRest,
  YSPACER,
  SystemBreak,
  Symbol,
  Tuplet,
  Voice_overlay,
  Line_continuation,
  Comment,
  Directive,
  Measurement,
  Rational,
  File_header,
  Lyric_section,
  AbsolutePitch,
  Lyric_line,
  Macro_decl,
  Macro_invocation,
  User_symbol_decl,
  User_symbol_invocation,
  KV,
  Binary,
  Unary,
  Grouping,
  ChordSymbol,
  ErrorExpr,
  SymbolLine,
  tune_body_code,
  Beam_contents,
} from "abcls-parser";
import { CSNode, TAGS, isTokenNode, getTokenData, TuneBodyData, FormattingData } from "./types";

function collectChildren(node: CSNode): CSNode[] {
  const result: CSNode[] = [];
  let child = node.firstChild;
  while (child !== null) {
    result.push(child);
    child = child.nextSibling;
  }
  return result;
}

export function toAst(node: CSNode): Expr | Token {
  if (isTokenNode(node)) {
    const data = getTokenData(node);
    const token = new Token(data.tokenType, data.lexeme, node.id);
    token.line = data.line;
    token.position = data.position;
    return token;
  }

  // Handle Tune_Body specially to reconstruct System[] structure from System wrapper nodes
  if (node.tag === TAGS.Tune_Body) {
    return buildTuneBodyFromSystems(node);
  }

  const children = collectChildren(node).map(toAst);
  return buildExpr(node, children);
}

function buildExpr(node: CSNode, children: Array<Expr | Token>): Expr {
  switch (node.tag) {
    case TAGS.Note:
      return buildNote(node.id, children);
    case TAGS.Chord:
      return buildChord(node.id, children);
    case TAGS.Pitch:
      return buildPitch(node.id, children);
    case TAGS.AbsolutePitch:
      return buildAbsolutePitch(node.id, children);
    case TAGS.Rest:
      return buildRest(node.id, children);
    case TAGS.BarLine:
      return buildBarLine(node.id, children);
    case TAGS.Tuplet:
      return buildTuplet(node.id, children);
    case TAGS.Grace_group:
      return buildGraceGroup(node, children);
    case TAGS.Inline_field:
      return buildInlineField(node.id, children);
    case TAGS.Directive:
      return buildDirective(node.id, children);
    case TAGS.Beam:
      return buildBeam(node.id, children);
    case TAGS.Tune_Body:
      return buildTuneBody(node.id, children);
    case TAGS.Decoration:
      return buildDecoration(node.id, children);
    case TAGS.Annotation:
      return buildAnnotation(node.id, children);
    case TAGS.Info_line:
      return buildInfoLine(node.id, children);
    case TAGS.SymbolLine:
      return buildSymbolLine(node.id, children);
    case TAGS.Tune:
      return buildTune(node, children);
    case TAGS.Tune_header:
      return buildTuneHeader(node.id, children);
    case TAGS.File_structure:
      return buildFileStructure(node, children);
    case TAGS.File_header:
      return buildFileHeader(node.id, children);
    case TAGS.Rhythm:
      return buildRhythm(node.id, children);
    case TAGS.MultiMeasureRest:
      return buildMultiMeasureRest(node.id, children);
    case TAGS.YSPACER:
      return buildYSpacer(node.id, children);
    case TAGS.SystemBreak:
      return buildSystemBreak(node.id, children);
    case TAGS.Symbol:
      return buildSymbol(node.id, children);
    case TAGS.Voice_overlay:
      return buildVoiceOverlay(node.id, children);
    case TAGS.Line_continuation:
      return buildLineContinuation(node.id, children);
    case TAGS.Comment:
      return buildComment(node.id, children);
    case TAGS.Measurement:
      return buildMeasurement(node.id, children);
    case TAGS.Rational:
      return buildRational(node.id, children);
    case TAGS.Lyric_section:
      return buildLyricSection(node.id, children);
    case TAGS.Lyric_line:
      return buildLyricLine(node.id, children);
    case TAGS.Macro_decl:
      return buildMacroDecl(node.id, children);
    case TAGS.Macro_invocation:
      return buildMacroInvocation(node.id, children);
    case TAGS.User_symbol_decl:
      return buildUserSymbolDecl(node.id, children);
    case TAGS.User_symbol_invocation:
      return buildUserSymbolInvocation(node.id, children);
    case TAGS.KV:
      return buildKV(node.id, children);
    case TAGS.Binary:
      return buildBinary(node.id, children);
    case TAGS.Unary:
      return buildUnary(node.id, children);
    case TAGS.Grouping:
      return buildGrouping(node.id, children);
    case TAGS.ChordSymbol:
      return buildChordSymbol(node.id, children);
    case TAGS.ErrorExpr:
      return buildErrorExpr(node.id, children);
    default:
      throw new Error(`toAst: unrecognized tag "${node.tag}"`);
  }
}

// --- Single-child wrappers ---

function buildDecoration(id: number, children: Array<Expr | Token>): Decoration {
  return new Decoration(id, children[0] as Token);
}

function buildAnnotation(id: number, children: Array<Expr | Token>): Annotation {
  return new Annotation(id, children[0] as Token);
}

function buildComment(id: number, children: Array<Expr | Token>): Comment {
  return new Comment(id, children[0] as Token);
}

function buildSymbol(id: number, children: Array<Expr | Token>): Symbol {
  return new Symbol(id, children[0] as Token);
}

function buildSystemBreak(id: number, children: Array<Expr | Token>): SystemBreak {
  return new SystemBreak(id, children[0] as Token);
}

function buildLineContinuation(id: number, children: Array<Expr | Token>): Line_continuation {
  return new Line_continuation(id, children[0] as Token);
}

function buildChordSymbol(id: number, children: Array<Expr | Token>): ChordSymbol {
  return new ChordSymbol(id, children[0] as Token);
}

function buildMacroInvocation(id: number, children: Array<Expr | Token>): Macro_invocation {
  return new Macro_invocation(id, children[0] as Token);
}

function buildUserSymbolInvocation(id: number, children: Array<Expr | Token>): User_symbol_invocation {
  return new User_symbol_invocation(id, children[0] as Token);
}

// --- Array containers ---

function buildBeam(id: number, children: Array<Expr | Token>): Beam {
  return new Beam(id, children as Beam_contents[]);
}

function buildTuneHeader(id: number, children: Array<Expr | Token>): Tune_header {
  return new Tune_header(id, children as Array<Info_line | Comment | Macro_decl | User_symbol_decl | Directive>);
}

function buildFileHeader(id: number, children: Array<Expr | Token>): File_header {
  return new File_header(id, children as Array<Token | Expr>);
}

function buildVoiceOverlay(id: number, children: Array<Expr | Token>): Voice_overlay {
  return new Voice_overlay(id, children as Token[]);
}

function buildErrorExpr(id: number, children: Array<Expr | Token>): ErrorExpr {
  return new ErrorExpr(id, children as Token[]);
}

// --- Token-type discrimination builders ---

function buildPitch(id: number, children: Array<Expr | Token>): Pitch {
  let alteration: Token | undefined;
  let noteLetter: Token | undefined;
  let octave: Token | undefined;
  for (const child of children) {
    const token = child as Token;
    switch (token.type) {
      case TT.NOTE_LETTER:
        noteLetter = token;
        break;
      case TT.ACCIDENTAL:
        alteration = token;
        break;
      case TT.OCTAVE:
        octave = token;
        break;
    }
  }
  return new Pitch(id, { alteration, noteLetter: noteLetter!, octave });
}

function buildAbsolutePitch(id: number, children: Array<Expr | Token>): AbsolutePitch {
  let alteration: Token | undefined;
  let noteLetter: Token | undefined;
  let octave: Token | undefined;
  for (const child of children) {
    const token = child as Token;
    switch (token.type) {
      case TT.NOTE_LETTER:
        noteLetter = token;
        break;
      case TT.ACCIDENTAL:
        alteration = token;
        break;
      case TT.OCTAVE:
        octave = token;
        break;
    }
  }
  return new AbsolutePitch(id, noteLetter!, alteration, octave);
}

function buildRhythm(id: number, children: Array<Expr | Token>): Rhythm {
  let numerator: Token | null = null;
  let separator: Token | undefined;
  let denominator: Token | null = null;
  let broken: Token | null = null;
  for (const child of children) {
    const token = child as Token;
    switch (token.type) {
      case TT.RHY_NUMER:
        numerator = token;
        break;
      case TT.RHY_SEP:
        separator = token;
        break;
      case TT.RHY_DENOM:
        denominator = token;
        break;
      case TT.RHY_BRKN:
        broken = token;
        break;
    }
  }
  return new Rhythm(id, numerator, separator, denominator, broken);
}

function buildBarLine(id: number, children: Array<Expr | Token>): BarLine {
  const barline: Token[] = [];
  const repeatNumbers: Token[] = [];
  for (const child of children) {
    const token = child as Token;
    if (token.type === TT.REPEAT_NUMBER || token.type === TT.REPEAT_COMMA || token.type === TT.REPEAT_DASH || token.type === TT.REPEAT_X) {
      repeatNumbers.push(token);
    } else {
      barline.push(token);
    }
  }
  return new BarLine(id, barline, repeatNumbers.length > 0 ? repeatNumbers : undefined);
}

function buildTuplet(id: number, children: Array<Expr | Token>): Tuplet {
  let leftParen: Token | undefined;
  let firstColon: Token | undefined;
  let secondColon: Token | undefined;
  let p: Token | undefined;
  let q: Token | undefined;
  let r: Token | undefined;
  let colonCount = 0;
  for (const child of children) {
    const token = child as Token;
    switch (token.type) {
      case TT.TUPLET_LPAREN:
        leftParen = token;
        break;
      case TT.TUPLET_COLON:
        if (colonCount === 0) {
          firstColon = token;
          colonCount++;
        } else {
          secondColon = token;
        }
        break;
      case TT.TUPLET_P:
        p = token;
        break;
      case TT.TUPLET_Q:
        q = token;
        break;
      case TT.TUPLET_R:
        r = token;
        break;
    }
  }
  return new Tuplet(id, p!, q, r, leftParen, firstColon, secondColon);
}

// --- Optional trailing fields ---

function buildNote(id: number, children: Array<Expr | Token>): Note {
  const pitch = children[0] as Pitch;
  let rhythm: Rhythm | undefined;
  let tie: Token | undefined;
  for (let i = 1; i < children.length; i++) {
    if (children[i] instanceof Rhythm) rhythm = children[i] as Rhythm;
    else if (children[i] instanceof Token) tie = children[i] as Token;
  }
  return new Note(id, pitch, rhythm, tie);
}

function buildChord(id: number, children: Array<Expr | Token>): Chord {
  let leftBracket: Token | undefined;
  let rightBracket: Token | undefined;
  const contents: Array<Note | Token | Annotation> = [];
  let rhythm: Rhythm | undefined;
  let tie: Token | undefined;
  for (const child of children) {
    if (child instanceof Token && child.type === TT.CHRD_LEFT_BRKT) {
      leftBracket = child;
    } else if (child instanceof Token && child.type === TT.CHRD_RIGHT_BRKT) {
      rightBracket = child;
    } else if (child instanceof Rhythm) {
      rhythm = child;
    } else if (child instanceof Token && child.type === TT.TIE) {
      tie = child;
    } else {
      contents.push(child as Note | Token | Annotation);
    }
  }
  return new Chord(id, contents, rhythm, tie, leftBracket, rightBracket);
}

function buildRest(id: number, children: Array<Expr | Token>): Rest {
  const rest = children[0] as Token;
  const rhythm = children.length > 1 ? (children[1] as Rhythm) : undefined;
  return new Rest(id, rest, rhythm);
}

function buildMultiMeasureRest(id: number, children: Array<Expr | Token>): MultiMeasureRest {
  const rest = children[0] as Token;
  const length = children.length > 1 ? (children[1] as Token) : undefined;
  return new MultiMeasureRest(id, rest, length);
}

function buildYSpacer(id: number, children: Array<Expr | Token>): YSPACER {
  const ySpacer = children[0] as Token;
  const rhythm = children.length > 1 ? (children[1] as Rhythm) : undefined;
  return new YSPACER(id, ySpacer, rhythm);
}

// --- Data payload builder ---

function buildGraceGroup(node: CSNode, children: Array<Expr | Token>): Grace_group {
  let leftBrace: Token | undefined;
  let rightBrace: Token | undefined;
  let acciaccaturaSlash: Token | undefined;
  const notes: Array<Note | Token> = [];
  for (const child of children) {
    if (child instanceof Token && child.type === TT.GRC_GRP_LEFT_BRACE) {
      leftBrace = child;
    } else if (child instanceof Token && child.type === TT.GRC_GRP_RGHT_BRACE) {
      rightBrace = child;
    } else if (child instanceof Token && child.type === TT.GRC_GRP_SLSH) {
      acciaccaturaSlash = child;
    } else {
      notes.push(child as Note | Token);
    }
  }
  const isAccacciatura = acciaccaturaSlash !== undefined;
  return new Grace_group(node.id, notes, isAccacciatura, leftBrace, rightBrace, acciaccaturaSlash);
}

// --- Text-based builders ---

// The Inline_field class invariant requires text[0] === field.
// The parser establishes this (parseInlineField pushes field as tokens[0]),
// and the Formatter2 relies on it (text.slice(1) skips the field token).
// Because the CSTree may contain structured expressions (value2) from Info_line conversion,
// we need to properly separate Token children into `text` and Expr children into `value2`.
// When expressions are present, we extract tokens from them to populate `text` for
// backward compatibility (similar to how buildInfoLine handles this).
function buildInlineField(id: number, children: Array<Expr | Token>): Inline_field {
  let leftBracket: Token | undefined;
  let rightBracket: Token | undefined;
  const directTokens: Token[] = [];
  const value2: Expr[] = [];

  for (const child of children) {
    if (child instanceof Token) {
      if (child.type === TT.INLN_FLD_LFT_BRKT) {
        leftBracket = child;
      } else if (child.type === TT.INLN_FLD_RGT_BRKT) {
        rightBracket = child;
      } else {
        directTokens.push(child);
      }
    } else {
      // child is an Expr (e.g., KV, Binary, etc.)
      value2.push(child);
    }
  }

  // Build text array: field token + tokens extracted from expressions.
  // The field token (e.g., K:, V:) should always be present in a valid inline field.
  if (directTokens.length === 0) {
    throw new Error("Invalid Inline_field: no field token found");
  }
  const field = directTokens[0];
  let text: Token[];
  if (value2.length > 0) {
    const extractedTokens = extractTokensFromExpressions(value2);
    text = [field, ...extractedTokens];
  } else {
    text = directTokens;
  }

  return new Inline_field(id, field, text, value2.length > 0 ? value2 : undefined, leftBracket, rightBracket);
}

// When expression children are present, we populate `value2` with the expressions and
// extract all tokens from within those expressions to populate `value` for backward
// compatibility. The Formatter2 prefers value2 when available, but other code may still
// access the token array.
function buildInfoLine(id: number, children: Array<Expr | Token>): Info_line {
  const key = children[0] as Token;
  const rest = children.slice(1);

  // Check if we have expression children (KV, Binary, Unary, etc.)
  const hasExpressions = rest.some((child) => !(child instanceof Token));

  if (hasExpressions) {
    // Build with value2 (expressions take precedence)
    // Extract tokens for the value array (for backward compatibility during transition)
    const extractedTokens = extractTokensFromExpressions(rest);
    return new Info_line(id, [key, ...extractedTokens], undefined, rest as Array<Expr>);
  }

  // Fallback: all children are tokens, use value only
  return new Info_line(id, children as Token[]);
}

/**
 * Extract all tokens from an array of expressions/tokens for the value array.
 * This is used during the transition period to maintain backward compatibility.
 */
function extractTokensFromExpressions(items: Array<Expr | Token>): Token[] {
  const tokens: Token[] = [];
  for (const item of items) {
    if (item instanceof Token) {
      tokens.push(item);
    } else {
      // Recursively extract tokens from expression
      tokens.push(...getTokensFromExpr(item));
    }
  }
  return tokens;
}

/**
 * Recursively extract all tokens from an expression.
 *
 * Expected expression types in Info_line.value2 and Inline_field.value2:
 * - KV: key-value pairs like "clef=treble" or standalone values like "1"
 * - Binary: rationals like "4/4" in meter lines
 * - Unary: signed numbers like "-2" in octave parameters
 * - Grouping: parenthesized expressions like "(2+3+2)/8"
 * - AbsolutePitch: absolute pitch notation in key signatures
 *
 * Other expression types return an empty array since they either don't appear
 * in info line values or are handled as direct tokens.
 */
function getTokensFromExpr(expr: Expr): Token[] {
  if (expr instanceof KV) {
    const tokens: Token[] = [];
    if (expr.key) {
      if (expr.key instanceof Token) {
        tokens.push(expr.key);
      } else {
        tokens.push(...getTokensFromExpr(expr.key));
      }
    }
    if (expr.equals) tokens.push(expr.equals);
    if (expr.value instanceof Token) {
      tokens.push(expr.value);
    } else {
      tokens.push(...getTokensFromExpr(expr.value));
    }
    return tokens;
  }
  if (expr instanceof Binary) {
    const tokens: Token[] = [];
    if (expr.left instanceof Token) {
      tokens.push(expr.left);
    } else {
      tokens.push(...getTokensFromExpr(expr.left));
    }
    tokens.push(expr.operator);
    if (expr.right instanceof Token) {
      tokens.push(expr.right);
    } else {
      tokens.push(...getTokensFromExpr(expr.right));
    }
    return tokens;
  }
  if (expr instanceof Unary) {
    const tokens: Token[] = [expr.operator];
    if (expr.operand instanceof Token) {
      tokens.push(expr.operand);
    } else {
      tokens.push(...getTokensFromExpr(expr.operand));
    }
    return tokens;
  }
  if (expr instanceof Grouping) {
    const tokens: Token[] = [];
    if (expr.leftParen) tokens.push(expr.leftParen);
    if (expr.expression instanceof Token) {
      tokens.push(expr.expression);
    } else {
      tokens.push(...getTokensFromExpr(expr.expression));
    }
    if (expr.rightParen) tokens.push(expr.rightParen);
    return tokens;
  }
  if (expr instanceof AbsolutePitch) {
    const tokens: Token[] = [expr.noteLetter];
    if (expr.alteration) tokens.push(expr.alteration);
    if (expr.octave) tokens.push(expr.octave);
    return tokens;
  }
  return [];
}

function buildSymbolLine(id: number, children: Array<Expr | Token>): SymbolLine {
  return new SymbolLine(id, children as Token[]);
}

// --- Passthrough builders ---

function buildDirective(id: number, children: Array<Expr | Token>): Directive {
  const key = children[0] as Token;
  const values = children.slice(1);
  return new Directive(id, key, values as Array<Token | Rational | Pitch | KV | Measurement | Annotation>);
}

function buildMeasurement(id: number, children: Array<Expr | Token>): Measurement {
  return new Measurement(id, children[0] as Token, children[1] as Token);
}

function buildRational(id: number, children: Array<Expr | Token>): Rational {
  return new Rational(id, children[0] as Token, children[1] as Token, children[2] as Token);
}

function buildLyricSection(id: number, children: Array<Expr | Token>): Lyric_section {
  return new Lyric_section(id, children as Info_line[]);
}

function buildLyricLine(id: number, children: Array<Expr | Token>): Lyric_line {
  const header = children[0] as Token;
  const contents = children.slice(1) as Token[];
  return new Lyric_line(id, header, contents);
}

function buildMacroDecl(id: number, children: Array<Expr | Token>): Macro_decl {
  const header = children[0] as Token;
  const variable = children[1] as Token;
  let equals: Token | undefined;
  let content: Token;
  if (children.length === 4) {
    equals = children[2] as Token;
    content = children[3] as Token;
  } else {
    content = children[2] as Token;
  }
  return new Macro_decl(id, header, variable, content, equals);
}

function buildUserSymbolDecl(id: number, children: Array<Expr | Token>): User_symbol_decl {
  const header = children[0] as Token;
  const variable = children[1] as Token;
  let equals: Token | undefined;
  let symbol: Token;
  if (children.length === 4) {
    equals = children[2] as Token;
    symbol = children[3] as Token;
  } else {
    symbol = children[2] as Token;
  }
  return new User_symbol_decl(id, header, variable, symbol, equals);
}

function buildKV(id: number, children: Array<Expr | Token>): KV {
  // Children order from visitor: [key?, equals?, value]
  // value is always the last child
  const value = children[children.length - 1] as Token | Expr;
  let key: Token | AbsolutePitch | undefined;
  let equals: Token | undefined;
  if (children.length === 3) {
    key = children[0] as Token | AbsolutePitch;
    equals = children[1] as Token;
  } else if (children.length === 2) {
    key = children[0] as Token | AbsolutePitch;
  }
  return new KV(id, value, key, equals);
}

function buildBinary(id: number, children: Array<Expr | Token>): Binary {
  return new Binary(id, children[0], children[1] as Token, children[2]);
}

function buildUnary(id: number, children: Array<Expr | Token>): Unary {
  return new Unary(id, children[0] as Token, children[1]);
}

function buildGrouping(id: number, children: Array<Expr | Token>): Grouping {
  let leftParen: Token | undefined;
  let rightParen: Token | undefined;
  let expression: Expr | undefined;
  for (const child of children) {
    if (child instanceof Token && child.type === TT.LPAREN) {
      leftParen = child;
    } else if (child instanceof Token && child.type === TT.RPAREN) {
      rightParen = child;
    } else {
      expression = child as Expr;
    }
  }
  return new Grouping(id, expression!, leftParen, rightParen);
}

// --- Structural builders ---

/**
 * Build Tune_Body from a CSNode with System wrapper children.
 * Each System child's contents are collected into a separate System array.
 */
function buildTuneBodyFromSystems(tuneBodyNode: CSNode): Tune_Body {
  const systems: Array<tune_body_code[]> = [];
  let systemChild = tuneBodyNode.firstChild;

  while (systemChild !== null) {
    if (systemChild.tag === TAGS.System) {
      // Collect System node's children and convert them
      const systemElements: tune_body_code[] = [];
      let element = systemChild.firstChild;
      while (element !== null) {
        systemElements.push(toAst(element) as tune_body_code);
        element = element.nextSibling;
      }
      systems.push(systemElements);
    }
    systemChild = systemChild.nextSibling;
  }

  const voices = (tuneBodyNode.data as TuneBodyData).voices;

  if (systems.length === 0) {
    return new Tune_Body(tuneBodyNode.id, [], voices);
  }

  return new Tune_Body(tuneBodyNode.id, systems, voices);
}

// Legacy function kept for compatibility - not used when System nodes are present
function buildTuneBody(id: number, children: Array<Expr | Token>): Tune_Body {
  return new Tune_Body(id, [children as tune_body_code[]], []);
}

function buildTune(node: CSNode, children: Array<Expr | Token>): Tune {
  const header = children[0] as Tune_header;
  const body = children.length > 1 ? (children[1] as Tune_Body) : undefined;
  // The tune's own linear flag and formatter config are restored from the node, because
  // letting them fall back to their defaults would re-serialize a linear tune as deferred.
  const formatting = node.data as FormattingData;
  return new Tune(node.id, header, body ?? null, formatting.linear, structuredClone(formatting.formatterConfig));
}

function buildFileStructure(node: CSNode, children: Array<Expr | Token>): File_structure {
  let fileHeader: File_header | null = null;
  let contentsStart = 0;
  if (children.length > 0 && children[0] instanceof File_header) {
    fileHeader = children[0] as File_header;
    contentsStart = 1;
  }
  const contents = children.slice(contentsStart) as Array<Tune | Token>;
  const formatting = node.data as FormattingData;
  return new File_structure(node.id, fileHeader, contents, formatting.linear, structuredClone(formatting.formatterConfig));
}
