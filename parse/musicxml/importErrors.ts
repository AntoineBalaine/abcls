import { Tune } from "../types/abcjs-ast";

/**
 * Writes the message for content of a parsed MusicXML score that has no representation anywhere in AbcLs's current type
 * system (types/abcjs-ast.ts). Per the unsupported-content policy in .private/2.mxml-to-tune-import.md, such content must
 * not be silently dropped or approximated, so importFromMusicSheet fails with these messages.
 */
export function unsupportedFeature(feature: string, location?: string): string {
  return `Unsupported MusicXML feature: ${feature}${location ? ` (${location})` : ""}`;
}

/**
 * The result of importFromMusicSheet: the tune, or the list of the unsupported features that prevented the import.
 */
export type ImportResult = { ok: true; tune: Tune } | { ok: false; errors: string[] };
