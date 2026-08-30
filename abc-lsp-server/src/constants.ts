// ============================================================================
// Error Codes (JSON-RPC style)
// ============================================================================

import { TAGS } from "abcls-editor";

export const ERROR_CODES = {
  DOCUMENT_NOT_FOUND: -32001,
  FILE_TYPE_NOT_SUPPORTED: -32002,
  INVALID_REQUEST: -32600,
  UNKNOWN_METHOD: -32601,
  INVALID_PARAMS: -32602,
};
/**
 * Transforms that require all selected nodes to be in a single cursor.
 * Because these transforms operate on the sequential relationship between nodes,
 * they need to see all nodes together rather than each node in isolation.
 */
export const GROUPED_CURSOR_TRANSFORMS = new Set(["legato", "consolidateRests", "toSlashNotation", "explosion"]);

/**
 * Transforms that operate on cursor positions rather than selected nodes.
 *
 * Input contract: These transforms receive raw Position[] as input instead of
 * operating on nodes identified by selection.cursors.
 *
 * Output contract: These transforms MUST populate selection.cursors with the
 * node IDs of result nodes. The cursor nodes will have valid token positions
 * from the original source, allowing direct range computation via
 * resolveSelectionRanges() without ordinal mapping.
 */
export const POSITION_BASED_TRANSFORMS = new Set(["splitSystems"]);

// ============================================================================
// Transform Node Tags Mapping
// ============================================================================
/**
 * Maps transform names to the node tags they operate on.
 * If a transform is not listed, it defaults to [Note, Chord].
 */
export const TRANSFORM_NODE_TAGS: Record<string, string[]> = {
  harmonize: [TAGS.Note, TAGS.Chord],
  harmonizeVoicing: [TAGS.Note],
  dropVoicing: [TAGS.Chord],
  parallelVoicing: [TAGS.Note],
  consolidateRests: [TAGS.Rest],
  insertVoiceLine: [TAGS.Note, TAGS.Chord],
  voiceInfoLineToInline: [TAGS.Info_line],
  voiceInlineToInfoLine: [TAGS.Inline_field],
  legato: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER],
  toSlashNotation: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest],
  multiplyRhythm: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER],
  divideRhythm: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER],
};
