/**
 * ContextInterpreter
 *
 * A visitor-based interpreter that traverses the ABC AST to gather musical context snapshots.
 * Transforms can query these snapshots to determine the meter, key, clef, tempo, and other
 * context at any position.
 *
 * Design:
 * - Snapshots are stored in a flat array across all tunes in document order
 * - Position encoding: `pos = line * 1_000_000 + char`
 * - O(log n) binary search for floor queries
 * - Each snapshot includes voiceId for voice-specific context
 * - Reuses semantic analyzer output rather than re-parsing directives
 */

import { SemanticData } from "../analyzers/semantic-analyzer";
import { ParsedChord, scanChordSymbol, parseChordSymbol } from "../music-theory";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { Meter, KeySignature, ClefProperties, TempoProperties, MeterType, AccidentalType } from "../types/abcjs-ast";
import { InfoLineUnion } from "../types/Expr";
import {
  Visitor,
  File_structure,
  File_header,
  Tune,
  Tune_header,
  Tune_Body,
  Info_line,
  Inline_field,
  BarLine,
  Note,
  Rest,
  Chord,
  Beam,
  Tuplet,
  Grace_group,
  Decoration,
  Annotation,
  Comment,
  SystemBreak,
  Symbol,
  Voice_overlay,
  Line_continuation,
  Macro_decl,
  Macro_invocation,
  User_symbol_decl,
  User_symbol_invocation,
  Lyric_line,
  Lyric_section,
  Pitch,
  Rhythm,
  ErrorExpr,
  KV,
  Binary,
  Grouping,
  AbsolutePitch,
  Rational,
  Measurement,
  Unary,
  Directive,
  MultiMeasureRest,
  YSPACER,
  ChordSymbol,
  Expr,
} from "../types/Expr";
import { Range } from "../types/types";
import { IRational } from "../Visitors/fmt/rational";
import { RangeVisitor } from "../Visitors/RangeVisitor";
import { convertAccidentalToType } from "./helpers";
import { TuneDefaults, VoiceState, newVxState, createTuneDefaults, createFileDefaults } from "./InterpreterState";

// ============================================================================
// Type Guards
// ============================================================================

/**
 * The set of info line types that affect musical context.
 * These are the only SemanticData types that the ContextInterpreter processes.
 */
const CONTEXT_INFO_TYPES = new Set(["key", "meter", "voice", "tempo", "note_length"]);

/**
 * Type guard to check if the semantic data is an InfoLineUnion that affects context.
 * Because SemanticData is a union of DirectiveSemanticData and InfoLineUnion,
 * we need to filter to only the types that we handle.
 */
function isContextInfoLineData(sem: SemanticData): sem is InfoLineUnion {
  return CONTEXT_INFO_TYPES.has(sem.type);
}

/**
 * Default meter to use when no meter has been specified.
 */
const DEFAULT_METER: Meter = { type: MeterType.CommonTime };

/**
 * Default tempo to use when no tempo has been specified.
 */
const DEFAULT_TEMPO: TempoProperties = { bpm: 120 };

/**
 * Configuration options for the ContextInterpreter.
 */
export interface ContextInterpreterConfig {
  /** When true, snapshots include measureAccidentals map. Default: false */
  snapshotAccidentals: boolean;
}

const DEFAULT_CONFIG: ContextInterpreterConfig = {
  snapshotAccidentals: false,
};

// ============================================================================
// Data Structures
// ============================================================================

/**
 * Stores the full resolved musical context at a directive position.
 * All fields are the effective values at that point.
 */
export interface ContextSnapshot {
  /** Encoded position (line * 1_000_000 + char) for binary search */
  pos: number;
  /** Original line number (0-indexed) */
  line: number;
  /** Original character position (0-indexed) */
  char: number;
  /** The meter in effect at this position */
  meter: Meter;
  /** The note length in effect at this position */
  noteLength: IRational;
  /** The tempo in effect at this position */
  tempo: TempoProperties;
  /** The key signature in effect at this position */
  key: KeySignature;
  /** The clef in effect at this position */
  clef: ClefProperties;
  /** The voice ID at this position */
  voiceId: string;
  /**
   * The measure number at this snapshot position.
   *
   * LIMITATION: This value is only accurate for deferred-style tunes.
   * For linear-style tunes, omitted voices are considered to be implicitly
   * resting while other voices play, which means their measure count should
   * be incremented by the maximum bar count across all voices in each system.
   * The current implementation does not handle this case.
   *
   * See the "Addendum: Linear-Style Measure Counting" section in
   * context-gathering-design.md for details.
   */
  measureNumber: number;
  /** The transpose value in effect at this position */
  transpose: number;
  /** The octave shift in effect at this position */
  octave: number;
  /** Measure accidentals active at this position (only present when snapshotAccidentals is enabled) */
  measureAccidentals?: Map<"C" | "D" | "E" | "F" | "G" | "A" | "B", AccidentalType>;
  /** Current chord symbol in effect at this position */
  currentChord?: ParsedChord;
}

/**
 * A flat array of all snapshots across all tunes in document order.
 * Each snapshot includes voiceId, so the caller can determine which voice is active.
 * Snapshots are sorted by position (encoded as line * 1_000_000 + char).
 */
export type DocumentSnapshots = Array<{ pos: number; snapshot: ContextSnapshot }>;

/**
 * The interpreter state for the current tune during traversal.
 * Snapshots are accumulated directly in the interpreter's result array.
 */
export interface ContextInterpreterState {
  ctx: ABCContext;
  semanticData: Map<number, SemanticData>;
  tuneDefaults: TuneDefaults;
  voices: Map<string, VoiceState>;
  /** The current voice ID. Default: "" (empty string) for content before any voice declaration */
  currentVoiceId: string;
  measureNumber: number;
  /** True when we've entered the tune body (past the header). Info lines in header don't create snapshots. */
  inBody: boolean;
  /** Current chord symbol in effect (system-wide, not per-voice) */
  currentChord: ParsedChord | null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Encodes a (line, char) position into a single integer for binary search.
 * Preserves lexicographic ordering: if position A comes before position B
 * in the document, then `encode(A) < encode(B)`.
 *
 * The multiplier of 1,000,000 assumes no line exceeds one million characters,
 * which is safe for any reasonable source file.
 */
export function encode(line: number, char: number): number {
  return line * 1_000_000 + char;
}

/**
 * Finds the largest index i where `snapshots[i].pos <= target`.
 * Returns -1 if no such index exists (i.e., all positions are greater than target).
 *
 * Uses binary search for O(log n) complexity.
 */
export function binarySearchFloor(snapshots: Array<{ pos: number }>, target: number): number {
  let lo = 0;
  let hi = snapshots.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].pos <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Returns all snapshots within a given range.
 * Each snapshot includes voiceId, so the caller can determine which voice
 * each context change belongs to.
 *
 * @param snapshots The document snapshots array
 * @param range The range to query
 * @returns An array of position-snapshot pairs within the range
 */
export function getRangeSnapshots(snapshots: DocumentSnapshots, range: Range): Array<{ pos: number; snapshot: ContextSnapshot }> {
  if (snapshots.length === 0) {
    return [];
  }

  const startPos = encode(range.start.line, range.start.character);
  const endPos = encode(range.end.line, range.end.character);

  let baseIndex = binarySearchFloor(snapshots, startPos);
  if (baseIndex < 0) {
    baseIndex = 0;
  }

  let endIndex = baseIndex;
  while (endIndex < snapshots.length && snapshots[endIndex].pos <= endPos) {
    endIndex++;
  }

  return snapshots.slice(baseIndex, endIndex);
}

/**
 * Queries the context snapshot at a given position.
 * Returns the most recent snapshot at or before `pos`, or null if none exists.
 * The returned snapshot includes the voiceId, so the caller can determine
 * which voice is active at that position.
 *
 * @param snapshots The document snapshots array
 * @param pos The encoded position to query (line * 1_000_000 + char)
 * @returns The snapshot at or before the position, or null if none exists
 */
export function getSnapshotAtPosition(snapshots: DocumentSnapshots, pos: number): ContextSnapshot {
  const index = binarySearchFloor(snapshots, pos);
  if (index < 0) {
    return snapshots[0].snapshot;
  }
  return snapshots[index].snapshot;
}

// ============================================================================
// ContextInterpreter Class
// ============================================================================

/**
 * The ContextInterpreter traverses the ABC AST and gathers context snapshots
 * at positions where musical context changes (M:, K:, L:, Q:, V: directives).
 */
export class ContextInterpreter implements Visitor<void> {
  state!: ContextInterpreterState;
  ctx!: ABCContext;
  semanticData!: Map<number, SemanticData>;
  rangeVisitor!: RangeVisitor;
  result!: DocumentSnapshots;
  config!: ContextInterpreterConfig;

  /**
   * Entry point for interpreting an ABC structure (File_structure or Tune).
   * Returns a flat array of all snapshots across all tunes in document order.
   */
  interpret(ast: Expr | Token, semanticData: Map<number, SemanticData>, ctx: ABCContext, config: ContextInterpreterConfig = DEFAULT_CONFIG): DocumentSnapshots {
    this.ctx = ctx;
    this.semanticData = semanticData;
    this.rangeVisitor = new RangeVisitor();
    this.result = [];
    this.config = config;

    ast.accept(this);
    return this.result;
  }

  /**
   * Initializes state for a new tune.
   * Snapshots are accumulated directly in this.result across all tunes.
   */
  initTuneState(): void {
    this.state = {
      ctx: this.ctx,
      semanticData: this.semanticData,
      tuneDefaults: createTuneDefaults(createFileDefaults()),
      voices: new Map(),
      currentVoiceId: "", // Default voice is empty string
      measureNumber: 1,
      inBody: false,
      currentChord: null,
    };
  }

  /**
   * Gets the current voice state, creating it if it doesn't exist.
   */
  getCurrentVoice(): VoiceState {
    const voiceId = this.state.currentVoiceId;
    let voice = this.state.voices.get(voiceId);
    if (!voice) {
      voice = newVxState(voiceId, {}, this.state.tuneDefaults);
      this.state.voices.set(voiceId, voice);
    }
    return voice;
  }

  /**
   * Clears measure accidentals for the current voice.
   * Only performs work when snapshotAccidentals is enabled.
   */
  clearCurrentVoiceAccidentals(): void {
    if (!this.config.snapshotAccidentals) return;
    const voice = this.getCurrentVoice();
    voice.measureAccidentals.clear();
  }

  /**
   * Clears measure accidentals for all voices.
   * Only performs work when snapshotAccidentals is enabled.
   */
  clearAllVoicesAccidentals(): void {
    if (!this.config.snapshotAccidentals) return;
    for (const voice of this.state.voices.values()) {
      voice.measureAccidentals.clear();
    }
  }

  /**
   * Extracts the position from an expression using RangeVisitor.
   */
  getPosition(expr: Expr): { line: number; char: number } {
    const range = expr.accept(this.rangeVisitor);
    if (range && range.start && range.start.line !== undefined) {
      return { line: range.start.line, char: range.start.character };
    }
    // Fallback: return (0, 0) if range not found
    return { line: 0, char: 0 };
  }

  /**
   * Creates and stores a snapshot at the given position for the current voice.
   */
  pushSnapshot(expr: Expr | Token): void {
    const { line, char } = this.getPosition(expr);
    const voice = this.getCurrentVoice();
    const voiceId = voice.id;
    const pos = encode(line, char);

    const snapshot: ContextSnapshot = {
      pos,
      line,
      char,
      meter: voice.currentMeter ?? this.state.tuneDefaults.meter ?? DEFAULT_METER,
      noteLength: this.state.tuneDefaults.noteLength,
      tempo: this.state.tuneDefaults.tempo ?? DEFAULT_TEMPO,
      key: voice.currentKey,
      clef: voice.currentClef,
      voiceId,
      measureNumber: this.state.measureNumber,
      transpose: voice.properties.transpose ?? 0,
      octave: voice.properties.octave ?? 0,
      measureAccidentals: this.config.snapshotAccidentals ? new Map(voice.measureAccidentals) : undefined,
      currentChord: this.state.currentChord ?? undefined,
    };

    this.result.push({ pos, snapshot });
  }

  // ============================================================================
  // Active Visitor Methods
  // ============================================================================

  visitFileStructureExpr(expr: File_structure): void {
    for (const item of expr.contents) {
      if (item instanceof Tune) {
        item.accept(this);
      }
    }
  }

  visitTuneExpr(expr: Tune): void {
    // Initialize state for this tune
    this.initTuneState();

    // Traverse header and body
    expr.tune_header.accept(this);
    if (expr.tune_body) {
      expr.tune_body.accept(this);
    }
  }

  visitTuneHeaderExpr(expr: Tune_header): void {
    for (const line of expr.info_lines) {
      if (line instanceof Info_line) {
        line.accept(this);
      }
    }
  }

  visitTuneBodyExpr(expr: Tune_Body): void {
    // Because we've entered the body, info lines from now on should create snapshots.
    this.state.inBody = true;

    // Push initial snapshot at body start with accumulated header state
    this.pushSnapshot(expr);

    for (const system of expr.sequence) {
      for (const element of system) {
        if (element instanceof Token) {
          if (element.type === TT.EOL) {
            const hadAccidentals = this.getCurrentVoice().measureAccidentals.size > 0;
            this.clearAllVoicesAccidentals();
            // Because the reset at the end of the line would otherwise leave no trace, we record it.
            if (this.config.snapshotAccidentals && hadAccidentals) {
              this.pushSnapshot(element);
            }
          }
          continue;
        }
        element.accept(this);
      }
    }
  }

  /**
   * Handles context-changing directives (M:, K:, L:, Q:, V:) from both info lines
   * and inline fields. Updates the voice state and tune defaults accordingly.
   *
   * @param expr The expression containing the directive
   * @param sem The semantic data for the directive (must be an InfoLineUnion)
   * @returns true if the context was changed and a snapshot should be created
   */
  handleContextDirective(expr: Expr, sem: InfoLineUnion): boolean {
    const voice = this.getCurrentVoice();

    if (sem.type === "key") {
      voice.currentKey = sem.data.keySignature;
      if (sem.data.clef) {
        voice.currentClef = sem.data.clef;
      }
      this.state.tuneDefaults.key = sem.data.keySignature;
      if (sem.data.clef) {
        this.state.tuneDefaults.clef = sem.data.clef;
      }
      // Because a header K: is tune-wide, the voices declared before it (e.g. V:1 and V:2
      // in the header) must also receive the key, otherwise they keep the default C major.
      if (!this.state.inBody) {
        for (const headerVoice of this.state.voices.values()) {
          headerVoice.currentKey = sem.data.keySignature;
        }
      }
      return true;
    } else if (sem.type === "meter") {
      voice.currentMeter = sem.data;
      this.state.tuneDefaults.meter = sem.data;
      // Because a header M: is tune-wide, the voices declared before it must also receive the meter.
      if (!this.state.inBody) {
        for (const headerVoice of this.state.voices.values()) {
          headerVoice.currentMeter = sem.data;
        }
      }
      return true;
    } else if (sem.type === "note_length") {
      this.state.tuneDefaults.noteLength = sem.data;
      return true;
    } else if (sem.type === "tempo") {
      this.state.tuneDefaults.tempo = sem.data;
      return true;
    } else if (sem.type === "voice") {
      const voiceId = sem.data.id;
      this.state.currentVoiceId = voiceId;
      // Apply voice-specific properties (clef, transpose, octave) to the voice state
      const voice = this.getCurrentVoice();
      if (sem.data.properties?.clef) {
        voice.currentClef = sem.data.properties.clef;
      }
      if (sem.data.properties?.transpose !== undefined) {
        voice.properties.transpose = sem.data.properties.transpose;
      }
      if (sem.data.properties?.octave !== undefined) {
        voice.properties.octave = sem.data.properties.octave;
      }
      return true;
    }

    return false;
  }

  /**
   * Handles info lines (standalone directive lines like M:4/4, V:1, etc.).
   *
   * - In the header: Updates state but does NOT push a snapshot, because the
   *   accumulated header state is captured in a single snapshot at body start.
   * - In the body: Updates state AND pushes a snapshot, because these represent
   *   context changes within the music that transforms need to see.
   */
  visitInfoLineExpr(expr: Info_line): void {
    const sem = this.semanticData.get(expr.id);
    if (!sem || !isContextInfoLineData(sem)) return;

    if (this.handleContextDirective(expr, sem)) {
      // Only push snapshot if we're in the body (not header)
      if (this.state.inBody) {
        this.pushSnapshot(expr);
      }
    }
  }

  visitInlineFieldExpr(expr: Inline_field): void {
    const sem = this.semanticData.get(expr.id);
    if (!sem || !isContextInfoLineData(sem)) return;

    if (this.handleContextDirective(expr, sem)) {
      this.pushSnapshot(expr);
    }
  }

  visitBarLineExpr(expr: BarLine): void {
    this.state.measureNumber++;
    const hadAccidentals = this.getCurrentVoice().measureAccidentals.size > 0;
    this.clearCurrentVoiceAccidentals();
    // Because snapshots are otherwise only pushed at notes that carry an accidental, the
    // reset at the barline must be recorded, or the next measure would inherit the stale accidentals.
    if (this.config.snapshotAccidentals && hadAccidentals) {
      this.pushSnapshot(expr);
    }
  }

  // ============================================================================
  // No-op Stubs (required by Visitor<void> interface)
  // ============================================================================

  visitToken(_token: Token): void {}

  visitNoteExpr(expr: Note): void {
    if (!this.config.snapshotAccidentals) return;

    const alteration = expr.pitch.alteration?.lexeme;
    if (!alteration) return;

    const pitchClass = expr.pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
    const accidentalType = convertAccidentalToType(alteration);

    const voice = this.getCurrentVoice();
    voice.measureAccidentals.set(pitchClass, accidentalType);

    this.pushSnapshot(expr);
  }

  visitRestExpr(_expr: Rest): void {}

  visitChordExpr(expr: Chord): void {
    if (!this.config.snapshotAccidentals) return;

    let hasAccidental = false;
    const voice = this.getCurrentVoice();

    for (const content of expr.contents) {
      if (content instanceof Note) {
        const alteration = content.pitch.alteration?.lexeme;
        if (alteration) {
          const pitchClass = content.pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
          const accidentalType = convertAccidentalToType(alteration);
          voice.measureAccidentals.set(pitchClass, accidentalType);
          hasAccidental = true;
        }
      }
    }

    if (hasAccidental) {
      this.pushSnapshot(expr);
    }
  }
  /**
   * Because notes that are written without spaces between them form one beam,
   * and an accidental on any of them stays in force until the end of the bar,
   * the contents of a beam are visited one by one. Without this, a beamed
   * `^D2=D2D2` would leave no trace in the accidental snapshots.
   */
  visitBeamExpr(expr: Beam): void {
    for (const element of expr.contents) {
      if (element instanceof Token) continue;
      element.accept(this);
    }
  }
  visitTupletExpr(_expr: Tuplet): void {}
  visitGraceGroupExpr(_expr: Grace_group): void {}
  visitDecorationExpr(_expr: Decoration): void {}
  visitAnnotationExpr(expr: Annotation): void {
    let text = expr.text.lexeme;

    // Strip surrounding quotes if present
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1);
    }

    // Strip position prefix if present (^, _, <, >, @)
    if (text.length > 0 && "^_<>@".includes(text[0])) {
      text = text.slice(1);
    }

    const scanResult = scanChordSymbol(text);
    if (scanResult === null) return;

    const parsed = parseChordSymbol(scanResult.tokens);
    if (parsed === null) return;

    this.state.currentChord = parsed;
    this.pushSnapshot(expr);
  }
  visitCommentExpr(_expr: Comment): void {}
  visitSystemBreakExpr(_expr: SystemBreak): void {
    this.clearAllVoicesAccidentals();
  }
  visitSymbolExpr(_expr: Symbol): void {}
  visitVoiceOverlayExpr(_expr: Voice_overlay): void {}
  visitLineContinuationExpr(_expr: Line_continuation): void {}
  visitMacroDeclExpr(_expr: Macro_decl): void {}
  visitMacroInvocationExpr(_expr: Macro_invocation): void {}
  visitUserSymbolDeclExpr(_expr: User_symbol_decl): void {}
  visitUserSymbolInvocationExpr(_expr: User_symbol_invocation): void {}
  visitLyricLineExpr(_expr: Lyric_line): void {}
  visitLyricSectionExpr(_expr: Lyric_section): void {}
  visitPitchExpr(_expr: Pitch): void {}
  visitRhythmExpr(_expr: Rhythm): void {}
  visitErrorExpr(_expr: ErrorExpr): void {}
  visitKV(_expr: KV): void {}
  visitBinary(_expr: Binary): void {}
  visitGrouping(_expr: Grouping): void {}
  visitAbsolutePitch(_expr: AbsolutePitch): void {}
  visitRationalExpr(_expr: Rational): void {}
  visitMeasurementExpr(_expr: Measurement): void {}
  visitUnary(_expr: Unary): void {}
  visitDirectiveExpr(_expr: Directive): void {}
  visitMultiMeasureRestExpr(_expr: MultiMeasureRest): void {}
  visitYSpacerExpr(_expr: YSPACER): void {}
  visitChordSymbolExpr(_expr: ChordSymbol): void {}
  visitFileHeaderExpr(_expr: File_header): void {}
}
