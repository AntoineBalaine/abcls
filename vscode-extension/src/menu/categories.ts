/**
 * The categories of the keymap, in the order in which the views list them.
 * A leaf names its category by id, and the views take the name from this table.
 */

export const CATEGORY_NAMES: Record<string, string> = {
  selectType: "select by type",
  selectRhythm: "select rhythm",
  selectStructure: "select structure",
  selectPosition: "select by position",
  selectDelimiter: "select inside / around",
  pitch: "pitch",
  harmony: "harmonize",
  rhythm: "rhythm",
  accidental: "accidentals",
  mode: "mode switch",
  voice: "voices",
  rest: "rests",
  voicing: "voicings",
  parallel: "parallel",
  layout: "systems",
  io: "MIDI",
  dynamics: "dynamics",
  history: "history",
};

export const CATEGORY_ORDER: string[] = Object.keys(CATEGORY_NAMES);

/** A category that the table does not know, for example one from the user's abc.keymap, is shown under its own id. */
export function categoryName(id: string): string {
  return CATEGORY_NAMES[id] ?? id;
}
