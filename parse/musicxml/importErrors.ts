/**
 * Thrown by importFromMusicSheet when a parsed MusicXML score contains
 * content with no representation anywhere in AbcLs's current type system
 * (types/abcjs-ast.ts). Per the unsupported-content policy in
 * .private/2.mxml-to-tune-import.md, such content must not be silently
 * dropped or approximated.
 */
export class UnsupportedMusicXmlFeatureError extends Error {
  constructor(feature: string, location?: string) {
    super(`Unsupported MusicXML feature: ${feature}${location ? ` (${location})` : ""}`);
    this.name = "UnsupportedMusicXmlFeatureError";
  }
}
