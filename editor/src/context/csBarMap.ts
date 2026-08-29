/**
 * CSTree Bar Map Builder
 *
 * A CSTree-native bar map builder that walks the CSTree to produce a BarMap,
 * the same output as the AST-based BarMapVisitor. Because the CSTree uses
 * firstChild/nextSibling traversal, we avoid the 30+ visitor method stubs
 * required by the AST visitor interface.
 *
 * The bar map associates each voice with its bars, where each bar records
 * a closing node ID that anchors the bar's position in the tree.
 */

import { visit, type CSVisitor } from "abcls-cstree";
import { TT } from "abcls-parser";
import { type CSNode, type EditorDataMap, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { isVoiceMarker, extractVoiceId } from "../selectors/voiceSelector";

// ============================================================================
// Types
// ============================================================================

interface VoiceBarState {
  barCount: number;
  hasContent: boolean;
}

export interface BarEntry {
  barNumber: number;
  closingNodeId: number;
}

/** Maps voice ID to a map of bar number -> BarEntry */
export type BarMap = Map<string, Map<number, BarEntry>>;

// ============================================================================
// State
// ============================================================================

type BarMapVisitor = CSVisitor<TAGS, EditorDataMap, BarMapState>;

export interface BarMapState {
  visitor: BarMapVisitor;
  barMap: BarMap;
  voices: Map<string, VoiceBarState>;
  currentVoiceId: string;
  lastNodeId: number | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates the voice's state if it does not already exist. The bar map
 * entry for the voice is created but left empty -- bar entries are only
 * added when a bar is closed, so the bar map never contains placeholder entries.
 */
function ensureVoice(state: BarMapState, voiceId: string): void {
  if (!state.voices.has(voiceId)) {
    state.voices.set(voiceId, { barCount: 0, hasContent: false });
    state.barMap.set(voiceId, new Map());
  }
}

/**
 * Closes the current bar for the active voice. Creates the bar entry
 * with the given closingNodeId, increments the bar counter, and resets
 * hasContent to false.
 */
function closeCurrentBar(state: BarMapState, closingNodeId: number): void {
  const voiceState = state.voices.get(state.currentVoiceId)!;
  const voiceEntries = state.barMap.get(state.currentVoiceId)!;

  voiceEntries.set(voiceState.barCount, {
    barNumber: voiceState.barCount,
    closingNodeId,
  });

  voiceState.barCount++;
  voiceState.hasContent = false;
}

/**
 * Marks that the current bar has received meaningful content.
 * lastNodeId is shared across voices but safe: between any two voice
 * switches, all content belongs to a single voice, so lastNodeId
 * always reflects the current voice's last content when read.
 */
function markContent(state: BarMapState, nodeId: number): void {
  const voiceState = state.voices.get(state.currentVoiceId)!;
  voiceState.hasContent = true;
  state.lastNodeId = nodeId;
}

/**
 * Switches the active voice when a voice marker is encountered.
 * If the outgoing voice's current bar has content, it is closed with
 * the last seen node ID as the closing anchor.
 */
function switchVoice(state: BarMapState, node: CSNode): void {
  const voiceId = extractVoiceId(node);
  if (voiceId === null || voiceId === "") return;

  // Close the outgoing voice's bar if it has content
  const outgoingState = state.voices.get(state.currentVoiceId)!;
  if (outgoingState.hasContent && state.lastNodeId !== null) {
    closeCurrentBar(state, state.lastNodeId);
  }

  state.currentVoiceId = voiceId;
  ensureVoice(state, voiceId);
}

/**
 * Called after all elements have been visited. Closes the final bar
 * for the active voice if it has content.
 */
export function finalize(state: BarMapState): void {
  const voiceState = state.voices.get(state.currentVoiceId)!;
  if (voiceState.hasContent && state.lastNodeId !== null) {
    closeCurrentBar(state, state.lastNodeId);
  }
}

// ============================================================================
// Tags that are structural (not content) and should not trigger markContent
// ============================================================================

const NON_CONTENT_TAGS = new Set<string>([
  TAGS.BarLine,
  TAGS.Info_line,
  TAGS.Inline_field,
  TAGS.SystemBreak,
  TAGS.Line_continuation,
  TAGS.Comment,
  TAGS.Pitch,
  TAGS.Rhythm,
  TAGS.KV,
  TAGS.Binary,
  TAGS.Unary,
  TAGS.Grouping,
  TAGS.AbsolutePitch,
  TAGS.Rational,
  TAGS.Measurement,
]);

// ============================================================================
// Visitor Definition
// ============================================================================

const barMapVisitor: BarMapVisitor = {
  [TAGS.Tune_Body]: (node, state) => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      visit(child, state);
      child = next;
    }
  },

  /**
   * The System handler iterates its direct children. Tokens (EOL) are
   * checked for bar closure. Non-token children are either dispatched
   * through visit (for BarLine, Info_line, Inline_field) or treated as
   * content. We avoid recursing into content nodes because their children
   * (Pitch, Rhythm, etc.) are not meaningful for bar mapping.
   */
  [TAGS.System]: (node, state) => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      if (isTokenNode(child)) {
        const data = getTokenData(child);
        if (data.tokenType === TT.EOL) {
          const voiceState = state.voices.get(state.currentVoiceId)!;
          if (voiceState.hasContent) {
            closeCurrentBar(state, state.lastNodeId!);
          }
        }
      } else if (child.tag === TAGS.BarLine) {
        closeCurrentBar(state, child.id);
      } else if (child.tag === TAGS.Info_line || child.tag === TAGS.Inline_field) {
        if (isVoiceMarker(child)) {
          switchVoice(state, child);
        } else {
          markContent(state, child.id);
        }
      } else if (!NON_CONTENT_TAGS.has(child.tag)) {
        markContent(state, child.id);
      }
      child = next;
    }
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates an initialized BarMapState ready for visiting. Callers can
 * use this with `visit(node, state)` to build a bar map from any node
 * (Tune_Body or System) without needing the `buildCsBarMap` wrapper.
 */
export function init(startingVoiceId: string): BarMapState {
  const state: BarMapState = {
    visitor: barMapVisitor,
    barMap: new Map(),
    voices: new Map(),
    currentVoiceId: startingVoiceId,
    lastNodeId: null,
  };
  ensureVoice(state, startingVoiceId);
  return state;
}

/**
 * Builds a bar map from a CSTree Tune_Body node. The visitor traverses
 * all systems, tracking voice switches and recording bar entries when
 * bars are closed by barlines, EOL tokens, voice markers, or the end
 * of the stream.
 */
export function buildMap(tuneBody: CSNode, startingVoiceId: string): BarMap {
  const state = init(startingVoiceId);
  visit(tuneBody, state);
  finalize(state);
  return state.barMap;
}
