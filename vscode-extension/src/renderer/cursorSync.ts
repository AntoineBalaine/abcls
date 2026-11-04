import { filteredRangeToOriginal, OffsetRange, originalRangeToFiltered } from "abcls-parser";

/**
 * Decides whether an editor selection can be shown in the preview, and where,
 * and where a click in the preview lands in the editor.
 *
 * Because the preview renders the text that the language server returns for a
 * document, and that text can differ from the document (ABCx conversion,
 * linear-to-deferred conversion, voice filtering), a character offset in the
 * editor only points at the same note in the preview when both texts are
 * identical, or when we know exactly which characters were removed from the
 * document's text (voice filtering). This module holds that rule without
 * depending on the vscode API, so that it can be tested on its own.
 */

/** What the preview currently shows, recorded when its content was last sent. */
export interface PreviewSyncState {
  uri: string;
  // Because the document may change while the preview content is being
  // computed, the version is the one read before the content was requested.
  version: number;
  /**
   * How the preview's text relates to the document's text.
   * - An empty list means that both texts are identical, so offsets are the same.
   * - A list of ranges of the document's text means that the preview shows the document without those ranges
   *   (voice filtering), so offsets are converted by counting the removed characters.
   * - null means that the preview shows a converted text that we cannot map, so offsets cannot be converted.
   */
  deletions: readonly OffsetRange[] | null;
}

/** The text that the preview shows after the voice filter, and the ranges of the document's text that the filter removed. */
export interface FilteredPreview {
  text: string;
  deletions: readonly OffsetRange[];
}

/** A range of character offsets to highlight in the rendered score. */
export interface PreviewRange {
  start: number;
  end: number;
}

/**
 * Records what the preview shows.
 *
 * Because the voice filter only cuts ranges out of the text that the server returned, the deletions of the filter
 * relate the preview to the document only when that text is the document's own text. When the server converted
 * the document, the deletions are relative to the converted text, and we cannot map the offsets.
 */
export function createPreviewSyncState(
  uri: string,
  version: number,
  documentText: string,
  serverContent: string,
  filtered?: FilteredPreview
): PreviewSyncState {
  if (documentText !== serverContent) {
    return { uri, version, deletions: null };
  }
  return { uri, version, deletions: filtered?.deletions ?? [] };
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
  if (!state || state.deletions === null) return null;
  if (state.uri !== uri || state.version !== version) return null;
  const start = Math.min(anchor, active);
  const end = Math.max(anchor, active);
  if (state.deletions.length === 0) return { start, end };
  return originalRangeToFiltered(start, end, state.deletions);
}

/**
 * Returns the range of the document that a click in the preview points at.
 *
 * Because the preview's offsets count the characters of the text that it shows, a click is converted with the
 * deletions of the voice filter, so that it lands on the same note in the document. When the preview shows a
 * converted text that we cannot map, the offsets are returned unchanged, as the editor did before.
 */
export function documentRangeForPreviewClick(state: PreviewSyncState | undefined, start: number, end: number): PreviewRange {
  if (!state || state.deletions === null || state.deletions.length === 0) return { start, end };
  return filteredRangeToOriginal(start, end, state.deletions);
}
