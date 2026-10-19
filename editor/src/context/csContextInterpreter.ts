/**
 * CSTree Context Interpreter
 *
 * A CSTree-native interpreter that walks the CSTree to gather musical context snapshots.
 * This is the CSTree equivalent of the AST-based ContextInterpreter. Because the CSTree
 * preserves node IDs from the AST, we can look up SemanticData by node ID directly.
 *
 * Compared to the AST version, this implementation:
 * - Uses firstTokenData() to get positions instead of RangeVisitor
 * - Navigates children via firstChild/nextSibling instead of typed AST properties
 * - Uses the visit dispatch mechanism instead of the Visitor<void> interface
 */

import { visit, findChild, type CSVisitor } from "abcls-cstree";
import { InfoLineUnion } from "abcls-parser";
import { TT } from "abcls-parser";
import { SemanticData } from "abcls-parser/analyzers/semantic-analyzer";
import { ContextSnapshot, DocumentSnapshots, ContextInterpreterConfig, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { convertAccidentalToType } from "abcls-parser/interpreter/helpers";
import { TuneDefaults, VoiceState, newVxState, createTuneDefaults, createFileDefaults } from "abcls-parser/interpreter/InterpreterState";
import { parseChordSymbol } from "abcls-parser/music-theory/parseChordSymbol";
import { scanChordSymbol } from "abcls-parser/music-theory/scanChordSymbol";
import { ParsedChord } from "abcls-parser/music-theory/types";
import { Meter, MeterType, TempoProperties } from "abcls-parser/types/abcjs-ast";
import { CSNode, TAGS, isTokenNode, getTokenData, type EditorDataMap } from "../csTree/types";
import { firstTokenData } from "../selectors/treeWalk";

// ============================================================================
// Constants
// ============================================================================

const CONTEXT_INFO_TYPES = new Set(["key", "meter", "voice", "tempo", "note_length"]);

const DEFAULT_METER: Meter = { type: MeterType.CommonTime };
const DEFAULT_TEMPO: TempoProperties = { bpm: 120 };
const DEFAULT_CONFIG: ContextInterpreterConfig = { snapshotAccidentals: false };

// ============================================================================
// State
// ============================================================================

type EditorVisitor = CSVisitor<TAGS, EditorDataMap, CsContextState>;

export interface CsContextState {
  visitor: EditorVisitor;
  semanticData: Map<number, SemanticData>;
  tuneDefaults: TuneDefaults;
  voices: Map<string, VoiceState>;
  currentVoiceId: string;
  measureNumber: number;
  inBody: boolean;
  currentChord: ParsedChord | null;
  config: ContextInterpreterConfig;
  result: DocumentSnapshots;
}

// ============================================================================
// Helper Functions
// ============================================================================

function isContextInfoLineData(sem: SemanticData): sem is InfoLineUnion {
  return CONTEXT_INFO_TYPES.has(sem.type);
}

function initTuneState(state: CsContextState): void {
  state.tuneDefaults = createTuneDefaults(createFileDefaults());
  state.voices = new Map();
  state.currentVoiceId = "";
  state.measureNumber = 1;
  state.inBody = false;
  state.currentChord = null;
}

function getCurrentVoice(state: CsContextState): VoiceState {
  const voiceId = state.currentVoiceId;
  let voice = state.voices.get(voiceId);
  if (!voice) {
    voice = newVxState(voiceId, {}, state.tuneDefaults);
    state.voices.set(voiceId, voice);
  }
  return voice;
}

function clearCurrentVoiceAccidentals(state: CsContextState): void {
  if (!state.config.snapshotAccidentals) return;
  const voice = getCurrentVoice(state);
  voice.measureAccidentals.clear();
}

function clearAllVoicesAccidentals(state: CsContextState): void {
  if (!state.config.snapshotAccidentals) return;
  for (const voice of state.voices.values()) {
    voice.measureAccidentals.clear();
  }
}

function pushSnapshot(state: CsContextState, node: CSNode): void {
  const tokenData = firstTokenData(node);
  const line = tokenData?.line ?? 0;
  const char = tokenData?.position ?? 0;
  const voice = getCurrentVoice(state);
  const pos = encode(line, char);

  const snapshot: ContextSnapshot = {
    pos,
    line,
    char,
    meter: voice.currentMeter ?? state.tuneDefaults.meter ?? DEFAULT_METER,
    noteLength: state.tuneDefaults.noteLength,
    tempo: state.tuneDefaults.tempo ?? DEFAULT_TEMPO,
    key: voice.currentKey,
    clef: voice.currentClef,
    voiceId: voice.id,
    measureNumber: state.measureNumber,
    transpose: voice.properties.transpose ?? 0,
    octave: voice.properties.octave ?? 0,
    measureAccidentals: state.config.snapshotAccidentals ? new Map(voice.measureAccidentals) : undefined,
    currentChord: state.currentChord ?? undefined,
  };

  state.result.push({ pos, snapshot });
}

function handleContextDirective(state: CsContextState, sem: InfoLineUnion): boolean {
  const voice = getCurrentVoice(state);

  if (sem.type === "key") {
    voice.currentKey = sem.data.keySignature;
    if (sem.data.clef) {
      voice.currentClef = sem.data.clef;
    }
    state.tuneDefaults.key = sem.data.keySignature;
    if (sem.data.clef) {
      state.tuneDefaults.clef = sem.data.clef;
    }
    // Because a header K: is tune-wide, the voices declared before it (e.g. V:1 and V:2
    // in the header) must also receive the key, otherwise they keep the default C major.
    if (!state.inBody) {
      for (const headerVoice of state.voices.values()) {
        headerVoice.currentKey = sem.data.keySignature;
      }
    }
    return true;
  } else if (sem.type === "meter") {
    voice.currentMeter = sem.data;
    state.tuneDefaults.meter = sem.data;
    // Because a header M: is tune-wide, the voices declared before it must also receive the meter.
    if (!state.inBody) {
      for (const headerVoice of state.voices.values()) {
        headerVoice.currentMeter = sem.data;
      }
    }
    return true;
  } else if (sem.type === "note_length") {
    state.tuneDefaults.noteLength = sem.data;
    return true;
  } else if (sem.type === "tempo") {
    state.tuneDefaults.tempo = sem.data;
    return true;
  } else if (sem.type === "voice") {
    const voiceId = sem.data.id;
    state.currentVoiceId = voiceId;
    const updatedVoice = getCurrentVoice(state);
    if (sem.data.properties?.clef) {
      updatedVoice.currentClef = sem.data.properties.clef;
    }
    if (sem.data.properties?.transpose !== undefined) {
      updatedVoice.properties.transpose = sem.data.properties.transpose;
    }
    if (sem.data.properties?.octave !== undefined) {
      updatedVoice.properties.octave = sem.data.properties.octave;
    }
    return true;
  }

  return false;
}

/**
 * Extracts note accidental information from a Note CSNode and updates measureAccidentals.
 * Returns true if an accidental was found.
 */
function extractNoteAccidental(noteNode: CSNode, state: CsContextState): boolean {
  const pitchNode = findChild(noteNode, (n) => n.tag === TAGS.Pitch);
  if (!pitchNode) return false;

  let alterationLexeme: string | null = null;
  let noteLetterLexeme: string | null = null;

  let child = pitchNode.firstChild;
  while (child !== null) {
    if (isTokenNode(child)) {
      const data = getTokenData(child);
      if (data.tokenType === TT.ACCIDENTAL) {
        alterationLexeme = data.lexeme;
      } else if (data.tokenType === TT.NOTE_LETTER) {
        noteLetterLexeme = data.lexeme;
      }
    }
    child = child.nextSibling;
  }

  if (!alterationLexeme || !noteLetterLexeme) return false;

  const pitchClass = noteLetterLexeme.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
  const accidentalType = convertAccidentalToType(alterationLexeme);
  const voice = getCurrentVoice(state);
  voice.measureAccidentals.set(pitchClass, accidentalType);

  return true;
}

// ============================================================================
// Visitor Definition
// ============================================================================

const contextVisitor: EditorVisitor = {
  [TAGS.File_structure]: (node, state) => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      if (child.tag === TAGS.Tune) {
        visit(child, state);
      }
      child = next;
    }
  },

  [TAGS.Tune]: (node, state) => {
    initTuneState(state);
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      visit(child, state);
      child = next;
    }
  },

  [TAGS.Tune_header]: (node, state) => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      if (child.tag === TAGS.Info_line) {
        visit(child, state);
      }
      child = next;
    }
  },

  [TAGS.Tune_Body]: (node, state) => {
    state.inBody = true;
    pushSnapshot(state, node);

    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      visit(child, state);
      child = next;
    }
  },

  [TAGS.System]: (node, state) => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      if (isTokenNode(child)) {
        const data = getTokenData(child);
        if (data.tokenType === TT.EOL) {
          const hadAccidentals = getCurrentVoice(state).measureAccidentals.size > 0;
          clearAllVoicesAccidentals(state);
          // Because the reset at the end of the line would otherwise leave no trace, we record it.
          if (state.config.snapshotAccidentals && hadAccidentals) {
            pushSnapshot(state, child);
          }
        }
      } else {
        visit(child, state);
      }
      child = next;
    }
  },

  [TAGS.Info_line]: (node, state) => {
    const sem = state.semanticData.get(node.id);
    if (!sem || !isContextInfoLineData(sem)) return;

    if (handleContextDirective(state, sem)) {
      if (state.inBody) {
        pushSnapshot(state, node);
      }
    }
  },

  [TAGS.Inline_field]: (node, state) => {
    const sem = state.semanticData.get(node.id);
    if (!sem || !isContextInfoLineData(sem)) return;

    if (handleContextDirective(state, sem)) {
      pushSnapshot(state, node);
    }
  },

  [TAGS.BarLine]: (node, state) => {
    state.measureNumber++;
    const hadAccidentals = getCurrentVoice(state).measureAccidentals.size > 0;
    clearCurrentVoiceAccidentals(state);
    // Because snapshots are otherwise only pushed at notes that carry an accidental, the
    // reset at the barline must be recorded, or the next measure would inherit the stale accidentals.
    if (state.config.snapshotAccidentals && hadAccidentals) {
      pushSnapshot(state, node);
    }
  },

  [TAGS.Note]: (node, state) => {
    if (!state.config.snapshotAccidentals) return;

    if (extractNoteAccidental(node, state)) {
      pushSnapshot(state, node);
    }
  },

  [TAGS.Chord]: (node, state) => {
    if (!state.config.snapshotAccidentals) return;

    let hasAccidental = false;
    let child = node.firstChild;
    while (child !== null) {
      if (child.tag === TAGS.Note) {
        if (extractNoteAccidental(child, state)) {
          hasAccidental = true;
        }
      }
      child = child.nextSibling;
    }

    if (hasAccidental) {
      pushSnapshot(state, node);
    }
  },

  [TAGS.Annotation]: (node, state) => {
    const tokenNode = findChild(node, (n) => isTokenNode(n));
    if (!tokenNode || !isTokenNode(tokenNode)) return;

    let text = getTokenData(tokenNode).lexeme;

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

    state.currentChord = parsed;
    pushSnapshot(state, node);
  },

  [TAGS.SystemBreak]: (_node, state) => {
    clearAllVoicesAccidentals(state);
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Interprets a CSTree to produce DocumentSnapshots, the same output as the
 * AST-based ContextInterpreter. Because the CSTree preserves node IDs from
 * the AST, we can look up SemanticData by node ID directly.
 */
export function interpretContext(root: CSNode, semanticData: Map<number, SemanticData>, config: ContextInterpreterConfig = DEFAULT_CONFIG): DocumentSnapshots {
  const state: CsContextState = {
    visitor: contextVisitor,
    semanticData,
    tuneDefaults: createTuneDefaults(createFileDefaults()),
    voices: new Map(),
    currentVoiceId: "",
    measureNumber: 1,
    inBody: false,
    currentChord: null,
    config,
    result: [],
  };

  visit(root, state);

  return state.result;
}
