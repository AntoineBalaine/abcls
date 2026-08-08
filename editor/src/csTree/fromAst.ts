import { appendChild } from "abcls-cstree";
import {
  Token,
  Expr,
  File_structure,
  Tune,
  Tune_header,
  Tune_Body,
  Info_line,
  SymbolLine,
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
  Visitor,
  ABCContext,
} from "abcls-parser";
import { CSNode, TAGS, createCSNode } from "./types";

function createCsNodeFromAst(node: Expr | Token): CSNode {
  if (node instanceof Token) {
    return createCSNode(TAGS.Token, node.id, {
      lexeme: node.lexeme,
      tokenType: node.type,
      line: node.line,
      position: node.position,
    });
  }
  if (node instanceof File_structure)
    return createCSNode(TAGS.File_structure, node.id, { linear: node.linear, formatterConfig: structuredClone(node.formatterConfig) });
  if (node instanceof Tune) return createCSNode(TAGS.Tune, node.id, { linear: node.linear, formatterConfig: structuredClone(node.formatterConfig) });
  if (node instanceof Tune_header) return createCSNode(TAGS.Tune_header, node.id, null);
  if (node instanceof Tune_Body) return createCSNode(TAGS.Tune_Body, node.id, { voices: node.voices });
  if (node instanceof Info_line) return createCSNode(TAGS.Info_line, node.id, null);
  if (node instanceof SymbolLine) return createCSNode(TAGS.Info_line, node.id, null);
  if (node instanceof Note) return createCSNode(TAGS.Note, node.id, null);
  if (node instanceof Pitch) return createCSNode(TAGS.Pitch, node.id, null);
  if (node instanceof Rhythm) return createCSNode(TAGS.Rhythm, node.id, null);
  if (node instanceof Rest) return createCSNode(TAGS.Rest, node.id, null);
  if (node instanceof Chord) return createCSNode(TAGS.Chord, node.id, null);
  if (node instanceof Beam) return createCSNode(TAGS.Beam, node.id, null);
  if (node instanceof Grace_group) return createCSNode(TAGS.Grace_group, node.id, null);
  if (node instanceof BarLine) return createCSNode(TAGS.BarLine, node.id, null);
  if (node instanceof Decoration) return createCSNode(TAGS.Decoration, node.id, null);
  if (node instanceof Annotation) return createCSNode(TAGS.Annotation, node.id, null);
  if (node instanceof Inline_field) return createCSNode(TAGS.Inline_field, node.id, null);
  if (node instanceof MultiMeasureRest) return createCSNode(TAGS.MultiMeasureRest, node.id, null);
  if (node instanceof YSPACER) return createCSNode(TAGS.YSPACER, node.id, null);
  if (node instanceof SystemBreak) return createCSNode(TAGS.SystemBreak, node.id, null);
  if (node instanceof Symbol) return createCSNode(TAGS.Symbol, node.id, null);
  if (node instanceof Tuplet) return createCSNode(TAGS.Tuplet, node.id, null);
  if (node instanceof Voice_overlay) return createCSNode(TAGS.Voice_overlay, node.id, null);
  if (node instanceof Line_continuation) return createCSNode(TAGS.Line_continuation, node.id, null);
  if (node instanceof Comment) return createCSNode(TAGS.Comment, node.id, null);
  if (node instanceof Directive) return createCSNode(TAGS.Directive, node.id, null);
  if (node instanceof Measurement) return createCSNode(TAGS.Measurement, node.id, null);
  if (node instanceof Rational) return createCSNode(TAGS.Rational, node.id, null);
  if (node instanceof File_header) return createCSNode(TAGS.File_header, node.id, null);
  if (node instanceof Lyric_section) return createCSNode(TAGS.Lyric_section, node.id, null);
  if (node instanceof AbsolutePitch) return createCSNode(TAGS.AbsolutePitch, node.id, null);
  if (node instanceof Lyric_line) return createCSNode(TAGS.Lyric_line, node.id, null);
  if (node instanceof Macro_decl) return createCSNode(TAGS.Macro_decl, node.id, null);
  if (node instanceof Macro_invocation) return createCSNode(TAGS.Macro_invocation, node.id, null);
  if (node instanceof User_symbol_decl) return createCSNode(TAGS.User_symbol_decl, node.id, null);
  if (node instanceof User_symbol_invocation) return createCSNode(TAGS.User_symbol_invocation, node.id, null);
  if (node instanceof KV) return createCSNode(TAGS.KV, node.id, null);
  if (node instanceof Binary) return createCSNode(TAGS.Binary, node.id, null);
  if (node instanceof Unary) return createCSNode(TAGS.Unary, node.id, null);
  if (node instanceof Grouping) return createCSNode(TAGS.Grouping, node.id, null);
  if (node instanceof ChordSymbol) return createCSNode(TAGS.ChordSymbol, node.id, null);
  if (node instanceof ErrorExpr) return createCSNode(TAGS.ErrorExpr, node.id, null);
  throw new Error(`createCsNodeFromAst: unrecognized node type (id=${node.id}, constructor=${node.constructor?.name})`);
}

type ChildList = Array<Expr | Token>;

export const childrenVisitor: Visitor<ChildList> = {
  visitToken(_token: Token): ChildList {
    return [];
  },
  visitFileStructureExpr(expr: File_structure): ChildList {
    const children: ChildList = [];
    if (expr.file_header) children.push(expr.file_header);
    children.push(...expr.contents);
    return children;
  },
  visitTuneExpr(expr: Tune): ChildList {
    const children: ChildList = [expr.tune_header];
    if (expr.tune_body) children.push(expr.tune_body);
    return children;
  },
  visitTuneHeaderExpr(expr: Tune_header): ChildList {
    return [...expr.info_lines];
  },
  // Note: fromAst handles Tune_Body specially to preserve System boundaries via System wrapper nodes.
  // This visitor method is still used by other callers (e.g., stripValue2 in test helpers) that need
  // flattened children for recursive traversal. The flattening here does not affect CSTree structure.
  visitTuneBodyExpr(expr: Tune_Body): ChildList {
    return expr.sequence.flat();
  },
  visitInfoLineExpr(expr: Info_line): ChildList {
    // Prefer value2 (structured expressions) over value (raw tokens)
    if (expr.value2 && expr.value2.length > 0) {
      return [expr.key, ...expr.value2];
    }
    return [expr.key, ...expr.value];
  },
  visitNoteExpr(expr: Note): ChildList {
    const children: ChildList = [expr.pitch];
    if (expr.rhythm) children.push(expr.rhythm);
    if (expr.tie) children.push(expr.tie);
    return children;
  },
  visitPitchExpr(expr: Pitch): ChildList {
    const children: ChildList = [];
    if (expr.alteration) children.push(expr.alteration);
    children.push(expr.noteLetter);
    if (expr.octave) children.push(expr.octave);
    return children;
  },
  visitRhythmExpr(expr: Rhythm): ChildList {
    const children: ChildList = [];
    if (expr.numerator) children.push(expr.numerator);
    if (expr.separator) children.push(expr.separator);
    if (expr.denominator) children.push(expr.denominator);
    if (expr.broken) children.push(expr.broken);
    return children;
  },
  visitRestExpr(expr: Rest): ChildList {
    const children: ChildList = [expr.rest];
    if (expr.rhythm) children.push(expr.rhythm);
    return children;
  },
  visitChordExpr(expr: Chord): ChildList {
    const children: ChildList = [];
    if (expr.leftBracket) children.push(expr.leftBracket);
    children.push(...expr.contents);
    if (expr.rightBracket) children.push(expr.rightBracket);
    if (expr.rhythm) children.push(expr.rhythm);
    if (expr.tie) children.push(expr.tie);
    return children;
  },
  visitBeamExpr(expr: Beam): ChildList {
    return [...expr.contents];
  },
  visitGraceGroupExpr(expr: Grace_group): ChildList {
    const children: ChildList = [];
    if (expr.leftBrace) children.push(expr.leftBrace);
    if (expr.acciaccaturaSlash) children.push(expr.acciaccaturaSlash);
    children.push(...expr.notes);
    if (expr.rightBrace) children.push(expr.rightBrace);
    return children;
  },
  visitBarLineExpr(expr: BarLine): ChildList {
    const children: ChildList = [...expr.barline];
    if (expr.repeatNumbers) children.push(...expr.repeatNumbers);
    return children;
  },
  visitDecorationExpr(expr: Decoration): ChildList {
    return [expr.decoration];
  },
  visitAnnotationExpr(expr: Annotation): ChildList {
    return [expr.text];
  },
  visitInlineFieldExpr(expr: Inline_field): ChildList {
    const children: ChildList = [];
    if (expr.leftBracket) children.push(expr.leftBracket);
    children.push(...expr.text);
    if (expr.rightBracket) children.push(expr.rightBracket);
    return children;
  },
  visitMultiMeasureRestExpr(expr: MultiMeasureRest): ChildList {
    const children: ChildList = [expr.rest];
    if (expr.length) children.push(expr.length);
    return children;
  },
  visitYSpacerExpr(expr: YSPACER): ChildList {
    const children: ChildList = [expr.ySpacer];
    if (expr.rhythm) children.push(expr.rhythm);
    return children;
  },
  visitSystemBreakExpr(expr: SystemBreak): ChildList {
    return [expr.symbol];
  },
  visitSymbolExpr(expr: Symbol): ChildList {
    return [expr.symbol];
  },
  visitTupletExpr(expr: Tuplet): ChildList {
    const children: ChildList = [];
    if (expr.leftParen) children.push(expr.leftParen);
    children.push(expr.p);
    if (expr.firstColon) children.push(expr.firstColon);
    if (expr.q) children.push(expr.q);
    if (expr.secondColon) children.push(expr.secondColon);
    if (expr.r) children.push(expr.r);
    return children;
  },
  visitVoiceOverlayExpr(expr: Voice_overlay): ChildList {
    return [...expr.contents];
  },
  visitLineContinuationExpr(expr: Line_continuation): ChildList {
    return [expr.token];
  },
  visitCommentExpr(expr: Comment): ChildList {
    return [expr.token];
  },
  visitDirectiveExpr(expr: Directive): ChildList {
    return [expr.key, ...expr.values];
  },
  visitMeasurementExpr(expr: Measurement): ChildList {
    return [expr.value, expr.scale];
  },
  visitRationalExpr(expr: Rational): ChildList {
    return [expr.numerator, expr.separator, expr.denominator];
  },
  visitFileHeaderExpr(expr: File_header): ChildList {
    return [...expr.contents];
  },
  visitLyricSectionExpr(expr: Lyric_section): ChildList {
    return [...expr.info_lines];
  },
  visitAbsolutePitch(expr: AbsolutePitch): ChildList {
    const children: ChildList = [expr.noteLetter];
    if (expr.alteration) children.push(expr.alteration);
    if (expr.octave) children.push(expr.octave);
    return children;
  },
  visitLyricLineExpr(expr: Lyric_line): ChildList {
    return [expr.header, ...expr.contents];
  },
  visitMacroDeclExpr(expr: Macro_decl): ChildList {
    const children: ChildList = [expr.header, expr.variable];
    if (expr.equals) children.push(expr.equals);
    children.push(expr.content);
    return children;
  },
  visitMacroInvocationExpr(expr: Macro_invocation): ChildList {
    return [expr.variable];
  },
  visitUserSymbolDeclExpr(expr: User_symbol_decl): ChildList {
    const children: ChildList = [expr.header, expr.variable];
    if (expr.equals) children.push(expr.equals);
    children.push(expr.symbol);
    return children;
  },
  visitUserSymbolInvocationExpr(expr: User_symbol_invocation): ChildList {
    return [expr.variable];
  },
  visitKV(expr: KV): ChildList {
    const children: ChildList = [];
    if (expr.key) children.push(expr.key);
    if (expr.equals) children.push(expr.equals);
    children.push(expr.value);
    return children;
  },
  visitBinary(expr: Binary): ChildList {
    return [expr.left, expr.operator, expr.right];
  },
  visitUnary(expr: Unary): ChildList {
    return [expr.operator, expr.operand];
  },
  visitGrouping(expr: Grouping): ChildList {
    const children: ChildList = [];
    if (expr.leftParen) children.push(expr.leftParen);
    children.push(expr.expression);
    if (expr.rightParen) children.push(expr.rightParen);
    return children;
  },
  visitChordSymbolExpr(expr: ChordSymbol): ChildList {
    return [expr.token];
  },
  visitErrorExpr(expr: ErrorExpr): ChildList {
    return [...expr.tokens];
  },
};

export function fromAst(node: Expr | Token, ctx: ABCContext): CSNode {
  const csNode = createCsNodeFromAst(node);

  // Handle Tune_Body specially to preserve System boundaries
  if (node instanceof Tune_Body) {
    for (const system of node.sequence) {
      const systemNode = createCSNode(TAGS.System, ctx.generateId(), null);
      for (const element of system) {
        appendChild(systemNode, fromAst(element, ctx));
      }
      appendChild(csNode, systemNode);
    }
    return csNode;
  }

  // Standard processing for all other nodes
  const children = node.accept(childrenVisitor);
  for (const child of children) {
    appendChild(csNode, fromAst(child, ctx));
  }

  return csNode;
}
