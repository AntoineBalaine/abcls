/**
 * Decides whether an editor selection can be shown in the preview, and where.
 *
 * Because the preview renders the text that the language server returns for a
 * document, and that text can differ from the document (ABCx conversion,
 * linear-to-deferred conversion, voice filtering), a character offset in the
 * editor only points at the same note in the preview when both texts are
 * identical. This module holds that rule without depending on the vscode API,
 * so that it can be tested on its own.
 */

/** What the preview currently shows, recorded when its content was last sent. */
export interface PreviewSyncState {
  uri: string;
  // Because the document may change while the preview content is being
  // computed, the version is the one read before the content was requested.
  version: number;
  matchesDocument: boolean;
}

/** A range of character offsets to highlight in the rendered score. */
export interface PreviewRange {
  start: number;
  end: number;
}

export function createPreviewSyncState(uri: string, version: number, documentText: string, previewContent: string): PreviewSyncState {
  return { uri, version, matchesDocument: documentText === previewContent };
}

/**
 * Returns the range that the preview should highlight for a selection, or null
 * when the preview shows another document, an older version of this one, or a
 * text whose offsets differ from the document's. The anchor and the active end
 * may come in either order, because a selection can be made backwards.
 */
export function previewRangeForSelection(
  state: PreviewSyncState | undefined,
  uri: string,
  version: number,
  anchor: number,
  active: number
): PreviewRange | null {
  if (!state || !state.matchesDocument) return null;
  if (state.uri !== uri || state.version !== version) return null;
  return { start: Math.min(anchor, active), end: Math.max(anchor, active) };
}
