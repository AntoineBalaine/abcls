/**
 * CourtesyAccidentalsTransform
 *
 * A visitor that traverses the AST to add courtesy accidentals.
 * When a note was altered in the previous measure but has no explicit accidental
 * in the current measure, the transform inserts an accidental token corresponding
 * to the key signature value for that note letter.
 *
 * Follows the same state-tracking pattern as ContextInterpreter.
 * Triggered by: %%abcls-fmt courtesy-accidentals directive
 */

import { SemanticData } from "../analyzers/semantic-analyzer";
import { convertAccidentalToType } from "../interpreter/helpers";
import { VoiceState, newVxState, TuneDefaults, createTuneDefaults, createFileDefaults } from "../interpreter/InterpreterState";
import { getKeyAccidentalForPitch, semitonesToAccidentalString, accidentalTypeToSemitones } from "../music-theory";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { AccidentalType } from "../types/abcjs-ast";
import {
  Visitor,
  Tune,
  Tune_header,
  Tune_Body,
  Info_line,
  Inline_field,
  BarLine,
  Note,
  Chord,
  Beam,
  SystemBreak,
  Grace_group,
  MultiMeasureRest,
  File_structure,
  File_header,
  Rest,
  Pitch,
  Rhythm,
  Tuplet,
  Decoration,
  Annotation,
  Comment,
  Symbol,
  Voice_overlay,
  Line_continuation,
  Macro_decl,
  Macro_invocation,
  User_symbol_decl,
  User_symbol_invocation,
  Lyric_line,
  Lyric_section,
  ErrorExpr,
  KV,
  Binary,
  Unary,
  Grouping,
  AbsolutePitch,
  Rational,
  Measurement,
  YSPACER,
  ChordSymbol,
  Directive,
} from "../types/Expr";

// ============================================================================
// State
// ============================================================================

interface CourtesyState {
  ctx: ABCContext;
  semanticData: Map<number, SemanticData>;
  tuneDefaults: TuneDefaults;
  voices: Map<string, VoiceState>;
  currentVoiceId: string;
  measureNumber: number;
  inBody: boolean;
  previousMeasureAccidentals: Map<string, Map<string, AccidentalType>>;
  pendingTies: Map<string, Set<string>>;
}

// ============================================================================
// Standalone Helper Functions
// ============================================================================

function getCurrentVoice(state: CourtesyState): VoiceState {
  const voiceId = state.currentVoiceId;
  let voice = state.voices.get(voiceId);
  if (!voice) {
    voice = newVxState(voiceId, {}, state.tuneDefaults);
    state.voices.set(voiceId, voice);
    state.previousMeasureAccidentals.set(voiceId, new Map());
    state.pendingTies.set(voiceId, new Set());
  }
  return voice;
}

function getPreviousAccidentals(state: CourtesyState): Map<string, AccidentalType> {
  const voiceId = state.currentVoiceId;
  let prev = state.previousMeasureAccidentals.get(voiceId);
  if (!prev) {
    prev = new Map();
    state.previousMeasureAccidentals.set(voiceId, prev);
  }
  return prev;
}

function getPendingTies(state: CourtesyState): Set<string> {
  const voiceId = state.currentVoiceId;
  let ties = state.pendingTies.get(voiceId);
  if (!ties) {
    ties = new Set();
    state.pendingTies.set(voiceId, ties);
  }
  return ties;
}

function rotateMeasureAccidentals(state: CourtesyState): void {
  const voice = getCurrentVoice(state);
  const voiceId = state.currentVoiceId;
  state.previousMeasureAccidentals.set(voiceId, new Map(voice.measureAccidentals));
  voice.measureAccidentals.clear();
}

function clearAllAccidentals(state: CourtesyState): void {
  for (const voice of state.voices.values()) {
    voice.measureAccidentals.clear();
  }
  for (const prev of state.previousMeasureAccidentals.values()) {
    prev.clear();
  }
}

function processNote(state: CourtesyState, note: Note): void {
  const pitch = note.pitch;
  const letter = pitch.noteLetter.lexeme.toUpperCase();
  const voice = getCurrentVoice(state);

  // Check for incoming tie: if this note's letter has a pending tie,
  // it is a continuation and should not receive a courtesy accidental.
  const ties = getPendingTies(state);
  if (ties.has(letter)) {
    ties.delete(letter);
    // Still check for outgoing tie before returning
    if (note.tie !== undefined) {
      ties.add(letter);
    }
    return;
  }

  if (pitch.alteration !== undefined) {
    // The note has an explicit accidental: record it and move on
    const accType = convertAccidentalToType(pitch.alteration.lexeme);
    voice.measureAccidentals.set(letter as "C" | "D" | "E" | "F" | "G" | "A" | "B", accType);
    // Check for outgoing tie
    if (note.tie !== undefined) {
      ties.add(letter);
    }
    return;
  }

  // No explicit accidental: check if a courtesy accidental is needed
  const prevAcc = getPreviousAccidentals(state);
  if (prevAcc.has(letter)) {
    // The letter was altered in the previous measure: add a courtesy accidental
    // showing what the note resolves to now (from the key signature)
    const keyAcc = getKeyAccidentalForPitch(letter, voice.currentKey);
    let accString: string;
    if (keyAcc === null) {
      // The note is natural in the key
      accString = "=";
    } else {
      accString = semitonesToAccidentalString(accidentalTypeToSemitones(keyAcc));
    }
    const accToken = new Token(TT.ACCIDENTAL, accString, state.ctx.generateId());
    pitch.alteration = accToken;
  }

  // Check for outgoing tie
  if (note.tie !== undefined) {
    ties.add(letter);
  }
}

// ============================================================================
// Visitor
// ============================================================================

export class CourtesyAccidentalsTransform implements Visitor<void> {
  state!: CourtesyState;

  transform(node: File_structure | Tune, semanticData: Map<number, SemanticData>, ctx: ABCContext): void {
    this.state = {
      ctx,
      semanticData,
      tuneDefaults: createTuneDefaults(createFileDefaults()),
      voices: new Map(),
      currentVoiceId: "",
      measureNumber: 1,
      inBody: false,
      previousMeasureAccidentals: new Map(),
      pendingTies: new Map(),
    };
    node.accept(this);
  }

  visitTuneExpr(tune: Tune): void {
    tune.tune_header.accept(this);
    if (tune.tune_body) {
      tune.tune_body.accept(this);
    }
  }

  visitTuneHeaderExpr(header: Tune_header): void {
    for (const line of header.info_lines) {
      if (line instanceof Info_line) {
        line.accept(this);
      }
    }
  }

  visitTuneBodyExpr(body: Tune_Body): void {
    this.state.inBody = true;
    for (const system of body.sequence) {
      for (const element of system) {
        if (element instanceof Token) {
          if (element.type === TT.EOL) {
            clearAllAccidentals(this.state);
          }
          continue;
        }
        element.accept(this);
      }
    }
  }

  visitInfoLineExpr(expr: Info_line): void {
    const sem = this.state.semanticData.get(expr.id);
    if (!sem) return;

    if (sem.type === "key") {
      const voice = getCurrentVoice(this.state);
      // Because a K: field that only changes the clef gives no key, the key in effect stays.
      const keySignature = sem.data.keySignature;
      if (keySignature) {
        voice.currentKey = keySignature;
        this.state.tuneDefaults.key = keySignature;
      }
    } else if (sem.type === "voice") {
      this.state.currentVoiceId = sem.data.id;
      getCurrentVoice(this.state);
    }
  }

  visitInlineFieldExpr(expr: Inline_field): void {
    const sem = this.state.semanticData.get(expr.id);
    if (!sem) return;

    if (sem.type === "key") {
      const voice = getCurrentVoice(this.state);
      // Because a K: field that only changes the clef gives no key, the key in effect stays.
      const keySignature = sem.data.keySignature;
      if (keySignature) {
        voice.currentKey = keySignature;
        this.state.tuneDefaults.key = keySignature;
      }
    } else if (sem.type === "voice") {
      this.state.currentVoiceId = sem.data.id;
      getCurrentVoice(this.state);
    }
  }

  visitBarLineExpr(_expr: BarLine): void {
    this.state.measureNumber++;
    rotateMeasureAccidentals(this.state);
  }

  visitBeamExpr(expr: Beam): void {
    for (const content of expr.contents) {
      if (content instanceof Token) continue;
      content.accept(this);
    }
  }

  visitChordExpr(expr: Chord): void {
    for (const content of expr.contents) {
      if (content instanceof Note) {
        processNote(this.state, content);
      }
    }
  }

  visitNoteExpr(expr: Note): void {
    processNote(this.state, expr);
  }

  visitGraceGroupExpr(expr: Grace_group): void {
    for (const content of expr.notes) {
      if (content instanceof Note) {
        processNote(this.state, content);
      }
    }
  }

  visitMultiMeasureRestExpr(_expr: MultiMeasureRest): void {
    const voice = getCurrentVoice(this.state);
    voice.measureAccidentals.clear();
    const voiceId = this.state.currentVoiceId;
    const prev = this.state.previousMeasureAccidentals.get(voiceId);
    if (prev) prev.clear();
  }

  visitSystemBreakExpr(_expr: SystemBreak): void {
    clearAllAccidentals(this.state);
  }

  // ============================================================================
  // No-op Stubs (required by Visitor<void> interface)
  // ============================================================================

  visitToken(_token: Token): void {}
  visitFileStructureExpr(expr: File_structure): void {
    for (const content of expr.contents) {
      if (content instanceof Token) continue;
      // Each tune is independent, so we reset all per-tune state before visiting it
      this.state.tuneDefaults = createTuneDefaults(createFileDefaults());
      this.state.voices = new Map();
      this.state.currentVoiceId = "";
      this.state.measureNumber = 1;
      this.state.inBody = false;
      this.state.previousMeasureAccidentals = new Map();
      this.state.pendingTies = new Map();
      content.accept(this);
    }
  }
  visitFileHeaderExpr(_expr: File_header): void {}
  visitRestExpr(_expr: Rest): void {}
  visitPitchExpr(_expr: Pitch): void {}
  visitRhythmExpr(_expr: Rhythm): void {}
  visitTupletExpr(_expr: Tuplet): void {}
  visitDecorationExpr(_expr: Decoration): void {}
  visitAnnotationExpr(_expr: Annotation): void {}
  visitCommentExpr(_expr: Comment): void {}
  visitSymbolExpr(_expr: Symbol): void {}
  visitVoiceOverlayExpr(_expr: Voice_overlay): void {}
  visitLineContinuationExpr(_expr: Line_continuation): void {}
  visitMacroDeclExpr(_expr: Macro_decl): void {}
  visitMacroInvocationExpr(_expr: Macro_invocation): void {}
  visitUserSymbolDeclExpr(_expr: User_symbol_decl): void {}
  visitUserSymbolInvocationExpr(_expr: User_symbol_invocation): void {}
  visitLyricLineExpr(_expr: Lyric_line): void {}
  visitLyricSectionExpr(_expr: Lyric_section): void {}
  visitErrorExpr(_expr: ErrorExpr): void {}
  visitKV(_expr: KV): void {}
  visitBinary(_expr: Binary): void {}
  visitGrouping(_expr: Grouping): void {}
  visitAbsolutePitch(_expr: AbsolutePitch): void {}
  visitRationalExpr(_expr: Rational): void {}
  visitMeasurementExpr(_expr: Measurement): void {}
  visitUnary(_expr: Unary): void {}
  visitDirectiveExpr(_expr: Directive): void {}
  visitYSpacerExpr(_expr: YSPACER): void {}
  visitChordSymbolExpr(_expr: ChordSymbol): void {}
}
