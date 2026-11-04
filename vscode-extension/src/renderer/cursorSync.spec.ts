import * as assert from "assert";
import { createPreviewSyncState, documentRangeForPreviewClick, previewRangeForSelection, previewRangesForSelections } from "./cursorSync";

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

describe("previewRangesForSelections", () => {
  it("returns one range per selection, in the order of the selections", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    const ranges = previewRangesForSelections(state, URI, 3, [
      { anchor: 9, active: 10 },
      { anchor: 12, active: 12 },
    ]);
    assert.deepStrictEqual(ranges, [
      { start: 9, end: 10 },
      { start: 12, end: 12 },
    ]);
  });

  it("orders each backwards selection from its start to its end", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(previewRangesForSelections(state, URI, 3, [{ anchor: 12, active: 8 }]), [{ start: 8, end: 12 }]);
  });

  it("returns an empty list for no selection", () => {
    const state = createPreviewSyncState(URI, 3, TEXT, TEXT);
    assert.deepStrictEqual(previewRangesForSelections(state, URI, 3, []), []);
  });

  it("returns null when the preview shows a converted text, another document, or an older version", () => {
    const converted = createPreviewSyncState(URI, 3, TEXT, "X:1\nV:1\nK:C\nV:1\nCDEF|\n");
    const same = createPreviewSyncState(URI, 3, TEXT, TEXT);
    const selections = [{ anchor: 9, active: 10 }];
    assert.strictEqual(previewRangesForSelections(converted, URI, 3, selections), null);
    assert.strictEqual(previewRangesForSelections(same, "file:///other.abc", 3, selections), null);
    assert.strictEqual(previewRangesForSelections(same, URI, 4, selections), null);
    assert.strictEqual(previewRangesForSelections(undefined, URI, 3, selections), null);
  });

  describe("with voice filtering", () => {
    // The document holds three lines, and the preview shows it without the middle one.
    const DOCUMENT = "X:1\n[V:2] hidden |\n[V:1] CDEF |\n[V:1] GABc |\n";
    const HIDDEN_START = DOCUMENT.indexOf("[V:2]");
    const HIDDEN_END = DOCUMENT.indexOf("[V:1]");
    const PREVIEW = DOCUMENT.slice(0, HIDDEN_START) + DOCUMENT.slice(HIDDEN_END);
    const state = createPreviewSyncState(URI, 3, DOCUMENT, DOCUMENT, { text: PREVIEW, deletions: [{ start: HIDDEN_START, end: HIDDEN_END }] });

    it("converts every selection to the position of the same notes in the preview", () => {
      const first = DOCUMENT.indexOf("CDEF");
      const second = DOCUMENT.indexOf("GABc");
      const ranges = previewRangesForSelections(state, URI, 3, [
        { anchor: first, active: first + 4 },
        { anchor: second, active: second + 4 },
      ]);
      assert.ok(ranges);
      assert.deepStrictEqual(
        ranges.map((r) => PREVIEW.slice(r.start, r.end)),
        ["CDEF", "GABc"]
      );
    });

    it("leaves out the selections that lie inside a hidden voice, and keeps the others", () => {
      const hidden = DOCUMENT.indexOf("hidden");
      const shown = DOCUMENT.indexOf("GABc");
      const ranges = previewRangesForSelections(state, URI, 3, [
        { anchor: hidden, active: hidden + 6 },
        { anchor: shown, active: shown + 4 },
      ]);
      assert.ok(ranges);
      assert.strictEqual(ranges.length, 1);
      assert.strictEqual(PREVIEW.slice(ranges[0].start, ranges[0].end), "GABc");
    });

    it("returns an empty list when every selection lies inside a hidden voice", () => {
      const hidden = DOCUMENT.indexOf("hidden");
      assert.deepStrictEqual(previewRangesForSelections(state, URI, 3, [{ anchor: hidden, active: hidden + 6 }]), []);
    });
  });
});
