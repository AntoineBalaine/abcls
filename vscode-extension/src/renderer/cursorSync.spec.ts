import * as assert from "assert";
import { createPreviewSyncState, documentRangeForPreviewClick, previewRangeForSelection } from "./cursorSync";

const URI = "file:///tune.abc";
const TEXT = "X:1\nK:C\nCDEF|\n";

describe("previewRangeForSelection", () => {
  it("returns the selection's offsets when the preview shows the same text as the document", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(previewRangeForSelection(state, URI, 3, 9, 10), { start: 9, end: 10 });
  });

  it("returns a collapsed range for a cursor without a selection", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(previewRangeForSelection(state, URI, 3, 9, 9), { start: 9, end: 9 });
  });

  it("orders a backwards selection from its start to its end", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(previewRangeForSelection(state, URI, 3, 12, 8), { start: 8, end: 12 });
  });

  it("returns null when the preview shows a converted text, because the offsets would point at the wrong note", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, "X:1\nV:1\nK:C\nV:1\nCDEF|\n");
    assert.strictEqual(previewRangeForSelection(state, URI, 3, 9, 9), null);
  });

  it("returns null when the document changed since the preview content was sent", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.strictEqual(previewRangeForSelection(state, URI, 4, 9, 9), null);
  });

  it("returns null for a selection in another document", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.strictEqual(previewRangeForSelection(state, "file:///other.abc", 3, 9, 9), null);
  });

  it("returns null before any preview content was sent", () => {
    assert.strictEqual(previewRangeForSelection(undefined, URI, 3, 9, 9), null);
  });
});

describe("voice filtering", () => {
  // The document holds three lines, and the preview shows it without the middle one.
  const DOCUMENT = "X:1\n[V:2] hidden |\n[V:1] CDEF |\n";
  const HIDDEN_START = DOCUMENT.indexOf("[V:2]");
  const HIDDEN_END = DOCUMENT.indexOf("[V:1]");
  const PREVIEW = DOCUMENT.slice(0, HIDDEN_START) + DOCUMENT.slice(HIDDEN_END);
  const FILTERED = { text: PREVIEW, deletions: [{ start: HIDDEN_START, end: HIDDEN_END }] };

  it("converts an editor selection in a shown voice to the position of the same notes in the preview", () => {
    const state = createPreviewSyncState(URI, 3, DOCUMENT, DOCUMENT, FILTERED);
    const start = DOCUMENT.indexOf("CDEF");
    const range = previewRangeForSelection(state, URI, 3, start, start + 4);
    assert.ok(range);
    assert.strictEqual(PREVIEW.slice(range.start, range.end), "CDEF");
  });

  it("returns null for a selection that lies inside a hidden voice, so that nothing is highlighted", () => {
    const state = createPreviewSyncState(URI, 3, DOCUMENT, DOCUMENT, FILTERED);
    const start = DOCUMENT.indexOf("hidden");
    assert.strictEqual(previewRangeForSelection(state, URI, 3, start, start + 6), null);
  });

  it("converts a click in the preview to the note that it points at in the document", () => {
    const state = createPreviewSyncState(URI, 3, DOCUMENT, DOCUMENT, FILTERED);
    const clickStart = PREVIEW.indexOf("CDEF");
    const range = documentRangeForPreviewClick(state, clickStart, clickStart + 4);
    assert.strictEqual(DOCUMENT.slice(range.start, range.end), "CDEF");
  });

  it("converts a click on the line before the deletion without moving it", () => {
    const state = createPreviewSyncState(URI, 3, DOCUMENT, DOCUMENT, FILTERED);
    assert.deepStrictEqual(documentRangeForPreviewClick(state, 0, 3), { start: 0, end: 3 });
  });

  it("returns the click's offsets unchanged when the preview shows the same text as the document", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(documentRangeForPreviewClick(state, 9, 10), { start: 9, end: 10 });
  });

  it("returns the click's offsets unchanged, as before, when the server converted the document and nothing can be mapped", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, "X:1\nV:1\nK:C\nV:1\nCDEF|\n", { text: "x", deletions: [{ start: 0, end: 1 }] });
    assert.deepStrictEqual(documentRangeForPreviewClick(state, 9, 10), { start: 9, end: 10 });
    assert.strictEqual(previewRangeForSelection(state, URI, 3, 9, 9), null);
  });

  it("returns the click's offsets unchanged before any preview content was sent", () => {
    assert.deepStrictEqual(documentRangeForPreviewClick(undefined, 4, 6), { start: 4, end: 6 });
  });
});
