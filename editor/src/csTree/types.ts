import type { CSNode as CSTNode, CSNodeOf, ParentRef } from "abcls-cstree";
import { TT, FormatterConfig } from "abcls-parser";

export type { ParentRef, CSNodeOf };

export interface TokenData {
  lexeme: string;
  tokenType: TT;
  line: number;
  position: number;
}

export interface TuneBodyData {
  voices: string[];
}

/**
 * The two properties that govern how a tune is formatted. A Tune node carries its own
 * values, and the File_structure node carries the file-level values that each tune starts
 * from. Because both are lost when the tree is converted back to an AST unless they are
 * stored here, they must travel with the node rather than being read from the ABCContext,
 * whose tuneLinear field holds only whatever the last parsed tune left behind.
 */
export interface FormattingData {
  linear: boolean;
  formatterConfig: FormatterConfig;
}

export type NodeData = TokenData | TuneBodyData | FormattingData | null;

export enum TAGS {
  File_structure = "File_structure",
  Tune = "Tune",
  Tune_header = "Tune_header",
  Tune_Body = "Tune_Body",
  System = "System",
  Info_line = "Info_line",
  Note = "Note",
  Pitch = "Pitch",
  Rhythm = "Rhythm",
  Rest = "Rest",
  Chord = "Chord",
  Beam = "Beam",
  Grace_group = "Grace_group",
  BarLine = "BarLine",
  Decoration = "Decoration",
  Annotation = "Annotation",
  Inline_field = "Inline_field",
  MultiMeasureRest = "MultiMeasureRest",
  YSPACER = "YSPACER",
  SystemBreak = "SystemBreak",
  Symbol = "Symbol",
  Tuplet = "Tuplet",
  Voice_overlay = "Voice_overlay",
  Line_continuation = "Line_continuation",
  Comment = "Comment",
  Directive = "Directive",
  Measurement = "Measurement",
  Rational = "Rational",
  File_header = "File_header",
  Lyric_section = "Lyric_section",
  AbsolutePitch = "AbsolutePitch",
  Lyric_line = "Lyric_line",
  Macro_decl = "Macro_decl",
  Macro_invocation = "Macro_invocation",
  User_symbol_decl = "User_symbol_decl",
  User_symbol_invocation = "User_symbol_invocation",
  KV = "KV",
  Binary = "Binary",
  Unary = "Unary",
  Grouping = "Grouping",
  ChordSymbol = "ChordSymbol",
  ErrorExpr = "ErrorExpr",
  SymbolLine = "SymbolLine",
  Token = "Token",
}

export type EditorDataMap = {
  [TAGS.File_structure]: FormattingData;
  [TAGS.Tune]: FormattingData;
  [TAGS.Tune_header]: null;
  [TAGS.Tune_Body]: TuneBodyData;
  [TAGS.System]: null;
  [TAGS.Info_line]: null;
  [TAGS.Note]: null;
  [TAGS.Pitch]: null;
  [TAGS.Rhythm]: null;
  [TAGS.Rest]: null;
  [TAGS.Chord]: null;
  [TAGS.Beam]: null;
  [TAGS.Grace_group]: null;
  [TAGS.BarLine]: null;
  [TAGS.Decoration]: null;
  [TAGS.Annotation]: null;
  [TAGS.Inline_field]: null;
  [TAGS.MultiMeasureRest]: null;
  [TAGS.YSPACER]: null;
  [TAGS.SystemBreak]: null;
  [TAGS.Symbol]: null;
  [TAGS.Tuplet]: null;
  [TAGS.Voice_overlay]: null;
  [TAGS.Line_continuation]: null;
  [TAGS.Comment]: null;
  [TAGS.Directive]: null;
  [TAGS.Measurement]: null;
  [TAGS.Rational]: null;
  [TAGS.File_header]: null;
  [TAGS.Lyric_section]: null;
  [TAGS.AbsolutePitch]: null;
  [TAGS.Lyric_line]: null;
  [TAGS.Macro_decl]: null;
  [TAGS.Macro_invocation]: null;
  [TAGS.User_symbol_decl]: null;
  [TAGS.User_symbol_invocation]: null;
  [TAGS.KV]: null;
  [TAGS.Binary]: null;
  [TAGS.Unary]: null;
  [TAGS.Grouping]: null;
  [TAGS.ChordSymbol]: null;
  [TAGS.ErrorExpr]: null;
  [TAGS.SymbolLine]: null;
  [TAGS.Token]: TokenData;
};

export type CSNode = CSTNode<TAGS, EditorDataMap>;

export function isTokenNode(node: CSNode): node is CSNodeOf<TAGS.Token, TAGS, EditorDataMap> {
  return node.tag === TAGS.Token;
}

export function getTokenData(node: CSNode): TokenData {
  if (node.tag !== TAGS.Token) throw new Error("getTokenData called on non-token node");
  return node.data;
}

export function createCSNode<K extends TAGS>(tag: K, id: number, data: EditorDataMap[K]): CSNodeOf<K, TAGS, EditorDataMap> {
  return { tag, id, data, firstChild: null, nextSibling: null, parentRef: null };
}

export function isRest(node: CSNode): boolean {
  return node.tag === TAGS.Rest || node.tag === TAGS.MultiMeasureRest;
}

export function isNote(node: CSNode): boolean {
  return node.tag === TAGS.Note;
}

export function isChord(node: CSNode): boolean {
  return node.tag === TAGS.Chord;
}

export function isBarLine(node: CSNode): boolean {
  return node.tag === TAGS.BarLine;
}

export function isBeam(node: CSNode): boolean {
  return node.tag === TAGS.Beam;
}

export function isRhythm(node: CSNode): boolean {
  return node.tag === TAGS.Rhythm;
}

export function isYSpacer(node: CSNode): boolean {
  return node.tag === TAGS.YSPACER;
}

export function hasRhythmChild(node: CSNode): boolean {
  let child = node.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.Rhythm) {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

export function isRhythmParent(node: CSNode): boolean {
  const isParentType = isNote(node) || isChord(node) || isRest(node) || isYSpacer(node);
  return isParentType && hasRhythmChild(node);
}
