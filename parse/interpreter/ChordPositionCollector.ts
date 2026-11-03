/**
 * ChordPositionCollector
 *
 * A visitor that collects chord positions with their MIDI pitches from an ABC AST.
 * This enables voice leading scoring by providing previous chord data for spread voicings.
 *
 * Design:
 * - Mirrors the state management of ContextInterpreter for consistent pitch resolution
 * - Tracks key signatures, measure accidentals, and voice properties (transpose, octave)
 * - Emits ChordPosition entries for chords that meet the minimum voice count threshold
 */

import { SemanticData } from "../analyzers/semantic-analyzer";
import { NATURAL_SEMITONES } from "../music-theory/constants";
import { getKeyAccidentalForPitch, accidentalTypeToSemitones as pitchUtilsAccidentalTypeToSemitones } from "../music-theory/pitchUtils";
import { Token, TT } from "../parsers/scan";
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
  InfoLineUnion,
  isKeyInfo,
  isVoiceInfo,
} from "../types/Expr";
import { encode } from "./ContextInterpreter";
import { convertAccidentalToType } from "./helpers";
import { TuneDefaults, VoiceState, newVxState, createTuneDefaults, createFileDefaults, FileDefaults } from "./InterpreterState";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the ChordPositionCollector.
 */
export interface ChordCollectorConfig {
  /** Minimum number of notes for a chord to be collected */
  minVoices: number;
  /** Whether to include the AST Chord reference (needed for diatonic parallel transform) */
  includeAstChord: boolean;
}

const DEFAULT_CONFIG: ChordCollectorConfig = {
  minVoices: 4,
  includeAstChord: false,
};

/**
 * Represents a chord position with its MIDI pitches for voice leading analysis.
 */
export interface ChordPosition {
  /** Encoded position (line * 1_000_000 + char) for ordering and lookup */
  pos: number;
  /** The voice ID where this chord appears */
  voiceId: string;
  /** MIDI pitches of all notes in the chord, sorted low to high */
  midiPitches: number[];
  /** Original AST chord reference, only populated when config.includeAstChord is true */
  astChord?: Chord;
}

// ============================================================================
// Collector State
// ============================================================================

interface CollectorState {
  /** Semantic data from analyzer, keyed by expression ID */
  semanticData: Map<number, SemanticData>;
  /** File-level defaults */
  fileDefaults: FileDefaults;
  /** Tune-level defaults */
  tuneDefaults: TuneDefaults;
  /** Per-voice state (key, accidentals, properties) */
  voices: Map<string, VoiceState>;
  /** Current voice ID */
  currentVoiceId: string;
  /** Whether we're in the tune body */
  inBody: boolean;
  /** Collected positions */
  positions: ChordPosition[];
  /** Collector configuration */
  config: ChordCollectorConfig;
}

// ============================================================================
// ChordPositionCollector
// ============================================================================

export class ChordPositionCollector implements Visitor<void> {
  state: CollectorState;

  constructor(semanticData: Map<number, SemanticData>, config: Partial<ChordCollectorConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      semanticData,
      fileDefaults: createFileDefaults(),
      tuneDefaults: createTuneDefaults(createFileDefaults()),
      voices: new Map(),
      currentVoiceId: "",
      inBody: false,
      positions: [],
      config: fullConfig,
    };
  }

  /**
   * Main entry point. Collects chord positions from the AST.
   */
  collect(ast: File_structure): ChordPosition[] {
    this.state.positions = [];
    ast.accept(this);
    return this.state.positions;
  }

  // ============================================================================
  // State Management Helpers
  // ============================================================================

  /**
   * Initializes state for a new tune.
   */
  initTuneState(): void {
    this.state.tuneDefaults = createTuneDefaults(this.state.fileDefaults);
    this.state.voices.clear();
    this.state.currentVoiceId = "";
    this.state.inBody = false;
  }

  /**
   * Gets or creates voice state for the current voice.
   */
  getCurrentVoice(): VoiceState {
    let voice = this.state.voices.get(this.state.currentVoiceId);
    if (!voice) {
      voice = newVxState(this.state.currentVoiceId, {}, this.state.tuneDefaults);
      this.state.voices.set(this.state.currentVoiceId, voice);
    }
    return voice;
  }

  /**
   * Clears measure accidentals for all voices.
   */
  clearAllVoicesAccidentals(): void {
    for (const voice of this.state.voices.values()) {
      voice.measureAccidentals.clear();
    }
  }

  /**
   * Handles K: and V: semantic data from info lines or inline fields.
   */
  handleContextDirective(exprId: number): void {
    const sem = this.state.semanticData.get(exprId);
    if (!sem) return;

    // Type guard: check if this is an InfoLineUnion
    if (!("type" in sem)) return;
    const info = sem as InfoLineUnion;

    if (isKeyInfo(info)) {
      const keyData = info.data;
      const voice = this.getCurrentVoice();
      // Because a K: field that only changes the clef gives no key, the key in effect and its accidentals stay.
      if (keyData.keySignature) {
        voice.currentKey = keyData.keySignature;
        // Key change clears accidentals
        voice.measureAccidentals.clear();
      }
    } else if (isVoiceInfo(info)) {
      const voiceData = info.data;
      this.state.currentVoiceId = voiceData.id;

      // Create or update voice state
      let voice = this.state.voices.get(voiceData.id);
      if (!voice) {
        voice = newVxState(voiceData.id, voiceData.properties || {}, this.state.tuneDefaults);
        this.state.voices.set(voiceData.id, voice);
      } else if (voiceData.properties) {
        voice.properties = { ...voice.properties, ...voiceData.properties };
      }
    }
  }

  /**
   * Converts a Pitch AST node to MIDI pitch, applying key signature,
   * measure accidentals, and voice properties (transpose, octave).
   */
  pitchToMidi(pitch: Pitch, voice: VoiceState): number {
    const letter = pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
    const isLower = pitch.noteLetter.lexeme === pitch.noteLetter.lexeme.toLowerCase();

    // Base octave in ABC: uppercase = 4 (middle C octave), lowercase = 5 (octave above)
    let octave = isLower ? 5 : 4;

    // Apply octave modifiers
    if (pitch.octave) {
      for (const char of pitch.octave.lexeme) {
        if (char === "'") octave++;
        else if (char === ",") octave--;
      }
    }

    // Get natural semitone offset
    const naturalSemitone = NATURAL_SEMITONES[letter] ?? 0;

    // Determine accidental semitones
    let accidentalSemitones = 0;

    if (pitch.alteration) {
      // Explicit accidental in the note
      const accString = pitch.alteration.lexeme;
      const accType = convertAccidentalToType(accString);
      accidentalSemitones = pitchUtilsAccidentalTypeToSemitones(accType);

      // Store in measure accidentals
      voice.measureAccidentals.set(letter, accType);
    } else {
      // Check measure accidentals first
      const measureAcc = voice.measureAccidentals.get(letter);
      if (measureAcc !== undefined) {
        accidentalSemitones = pitchUtilsAccidentalTypeToSemitones(measureAcc);
      } else {
        // Fall back to key signature
        const keyAccidental = getKeyAccidentalForPitch(letter, voice.currentKey);
        accidentalSemitones = keyAccidental !== null ? pitchUtilsAccidentalTypeToSemitones(keyAccidental) : 0;
      }
    }

    // Compute base MIDI (C4 = 60)
    let midi = (octave + 1) * 12 + naturalSemitone + accidentalSemitones;

    // Apply voice transpose (semitones)
    if (voice.properties.transpose) {
      midi += voice.properties.transpose;
    }

    // Apply voice octave shift
    if (voice.properties.octave) {
      midi += voice.properties.octave * 12;
    }

    return midi;
  }

  // ============================================================================
  // Active Visitor Methods
  // ============================================================================

  visitFileStructureExpr(expr: File_structure): void {
    if (expr.file_header) {
      expr.file_header.accept(this);
    }
    for (const item of expr.contents) {
      if (item instanceof Tune) {
        item.accept(this);
      }
    }
  }

  visitFileHeaderExpr(expr: File_header): void {
    // Process file header directives if needed
    for (const item of expr.contents) {
      if (item instanceof Info_line) {
        item.accept(this);
      }
    }
  }

  visitTuneExpr(expr: Tune): void {
    this.initTuneState();
    expr.tune_header.accept(this);
    if (expr.tune_body) {
      expr.tune_body.accept(this);
    }
  }

  visitTuneHeaderExpr(expr: Tune_header): void {
    for (const info of expr.info_lines) {
      info.accept(this);
    }
  }

  visitTuneBodyExpr(expr: Tune_Body): void {
    this.state.inBody = true;

    for (const system of expr.sequence) {
      for (const element of system) {
        if (element instanceof Token) {
          if (element.type === TT.EOL) {
            // End of line clears accidentals
            this.clearAllVoicesAccidentals();
          }
        } else {
          element.accept(this);
        }
      }
    }

    this.state.inBody = false;
  }

  visitInfoLineExpr(expr: Info_line): void {
    this.handleContextDirective(expr.id);
  }

  visitInlineFieldExpr(expr: Inline_field): void {
    this.handleContextDirective(expr.id);
  }

  visitBarLineExpr(_expr: BarLine): void {
    // Barline clears measure accidentals for current voice
    const voice = this.getCurrentVoice();
    voice.measureAccidentals.clear();
  }

  visitSystemBreakExpr(_expr: SystemBreak): void {
    // System break clears accidentals for all voices
    this.clearAllVoicesAccidentals();
  }

  visitNoteExpr(expr: Note): void {
    // Track measure accidentals for single notes
    if (!this.state.inBody) return;

    const voice = this.getCurrentVoice();
    const pitch = expr.pitch;

    if (pitch.alteration) {
      const letter = pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
      const accType = convertAccidentalToType(pitch.alteration.lexeme);
      voice.measureAccidentals.set(letter, accType);
    }
  }

  visitChordExpr(expr: Chord): void {
    if (!this.state.inBody) return;

    const voice = this.getCurrentVoice();
    const midiPitches: number[] = [];

    // Process each note in the chord
    for (const item of expr.contents) {
      if (!(item instanceof Note)) continue;
      const pitch = item.pitch;

      // Track measure accidentals
      if (pitch.alteration) {
        const letter = pitch.noteLetter.lexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
        const accType = convertAccidentalToType(pitch.alteration.lexeme);
        voice.measureAccidentals.set(letter, accType);
      }

      // Compute MIDI pitch
      const midi = this.pitchToMidi(pitch, voice);
      midiPitches.push(midi);
    }

    // Check if chord meets minimum voice count
    if (midiPitches.length < this.state.config.minVoices) return;

    // Sort pitches low to high
    midiPitches.sort((a, b) => a - b);

    // Get position from first note in chord
    const firstNote = expr.contents.find((item) => item instanceof Note) as Note | undefined;
    if (!firstNote) return;

    const line = firstNote.pitch.noteLetter.line;
    const char = firstNote.pitch.noteLetter.position;
    const pos = encode(line, char);

    const position: ChordPosition = {
      pos,
      voiceId: this.state.currentVoiceId,
      midiPitches,
    };

    // Conditionally include AST reference
    if (this.state.config.includeAstChord) {
      position.astChord = expr;
    }

    this.state.positions.push(position);
  }

  visitBeamExpr(expr: Beam): void {
    for (const element of expr.contents) {
      if (element instanceof Token) continue;
      element.accept(this);
    }
  }

  // ============================================================================
  // No-op Visitor Stubs (required by Visitor interface)
  // ============================================================================

  visitToken(_token: Token): void {}
  visitRestExpr(_expr: Rest): void {}
  visitTupletExpr(_expr: Tuplet): void {
    // Tuplet markers don't contain notes directly - notes follow the marker
  }
  visitGraceGroupExpr(_expr: Grace_group): void {}
  visitDecorationExpr(_expr: Decoration): void {}
  visitAnnotationExpr(_expr: Annotation): void {}
  visitCommentExpr(_expr: Comment): void {}
  visitSymbolExpr(_expr: Symbol): void {}
  visitVoiceOverlayExpr(_expr: Voice_overlay): void {
    // Voice overlay only contains tokens (not notes)
  }
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
}
