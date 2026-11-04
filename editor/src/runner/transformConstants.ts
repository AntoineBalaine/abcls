import { TAGS } from "../csTree/types";

/**
 * Transforms that require all selected nodes to be in a single cursor.
 * Because these transforms operate on the sequential relationship between nodes,
 * they need to see all nodes together rather than each node in isolation.
 */
export const GROUPED_CURSOR_TRANSFORMS = new Set(["legato", "consolidateRests", "toSlashNotation", "explosion", "multiplyRhythmRebar", "divideRhythmRebar"]);

/**
 * Transforms that operate on cursor positions rather than selected nodes.
 *
 * Input contract: These transforms receive raw Position[] as input instead of
 * operating on nodes identified by selection.cursors.
 *
 * Output contract: These transforms MUST populate selection.cursors with the
 * node IDs of result nodes. Because the tokens of a node keep the line and the column
 * that they had in the text that was parsed, and a transform moves nodes and creates new ones,
 * the ranges of the cursors are read from the text that the tree serializes to
 * (resolveSelectionRangesInText), and not from the positions of the tokens.
 */
export const POSITION_BASED_TRANSFORMS = new Set(["splitSystems", "joinSystems", "interleaveVoices"]);

// ============================================================================
// Transform Node Tags Mapping
// ============================================================================
/**
 * Maps transform names to the node tags they operate on.
 * If a transform is not listed, it defaults to [Note, Chord].
 */
export const TRANSFORM_NODE_TAGS: Record<string, string[]> = {
  // Because explode copies whole lines, the lines that hold only rests must be selected too.
  explode: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest],
  explode2: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest],
  explode3: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest],
  explode4: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest],
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
  // Because a bar of rest (X) must be repeated too, the re-barring versions also select the multi-measure rests.
  multiplyRhythmRebar: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER, TAGS.MultiMeasureRest],
  divideRhythmRebar: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER, TAGS.MultiMeasureRest],
  divideRhythm: [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER],
};
