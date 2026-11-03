import * as assert from "assert";
import { createPreviewSyncState, previewRangeForSelection } from "./cursorSync";

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
