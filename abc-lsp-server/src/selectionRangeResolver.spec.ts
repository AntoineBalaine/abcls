import { fromAst, createSelection, selectChords, selectNotes, selectTop, selectVoices, TAGS } from "abcls-editor";
import { Scanner, parse, ABCContext, File_structure } from "abcls-parser";
import { expect } from "chai";
import { describe, it } from "mocha";
import { resolveSelectionRanges, resolveContiguousRanges, findNodeById, findNodesInRange, computeNodeRange } from "./selectionRangeResolver";

function parseAbc(source: string): { ast: File_structure; ctx: ABCContext } {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);
  return { ast, ctx };
}

describe("findNodeById", () => {
  it("returns the root node when the target ID matches the root", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const found = findNodeById(root, root.id);
    expect(found).to.equal(root);
  });

  it("returns null for an ID that does not exist in the tree", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const found = findNodeById(root, 999999);
    expect(found).to.be.null;
  });

  it("finds a nested child node by ID", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    // The first child of root should exist
    const child = root.firstChild;
    expect(child).to.not.be.null;
    const found = findNodeById(root, child!.id);
    expect(found).to.equal(child);
  });
});

describe("resolveSelectionRanges", () => {
  it("on an initial selection returns a single range spanning the file", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const ranges = resolveSelectionRanges(selection);
    expect(ranges).to.have.length(1);
    expect(ranges[0].start).to.have.property("line");
    expect(ranges[0].start).to.have.property("character");
    expect(ranges[0].end).to.have.property("line");
    expect(ranges[0].end).to.have.property("character");
  });

  it("after selectChords returns one range per chord", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const chordSelection = selectChords(selection);
    const ranges = resolveSelectionRanges(chordSelection);
    expect(ranges).to.have.length(1);
    // The chord range should start at the C position on line 2
    expect(ranges[0].start.line).to.equal(2);
  });

  it("after selectNotes returns one range per note", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const noteSelection = selectNotes(selection);
    const ranges = resolveSelectionRanges(noteSelection);
    // 3 notes inside chord + 2 standalone notes = 5, but the notes in chord are C, E, G
    // plus standalone C2 and D2 = 5 total notes
    expect(ranges).to.have.length(5);
  });

  it("after selectTop(selectChords(...)) returns ranges for the top note of each chord only", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const topSelection = selectTop(selectChords(selection));
    const ranges = resolveSelectionRanges(topSelection);
    expect(ranges).to.have.length(1);
    // The top note is G
    expect(ranges[0].start.line).to.equal(2);
  });

  it("returns empty array for a selection with no cursors", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const selection = { root, cursors: [] };
    const ranges = resolveSelectionRanges(selection);
    expect(ranges).to.have.length(0);
  });

  it("skips cursors whose ID cannot be found in the tree", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const selection = { root, cursors: [new Set([999999])] };
    const ranges = resolveSelectionRanges(selection);
    expect(ranges).to.have.length(0);
  });
});

describe("findNodesInRange", () => {
  it("selects a chord as a single node without also selecting its inner notes", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[GBce]|\n");
    const root = fromAst(ast, ctx);
    const range = computeNodeRange(root)!;
    const ids = findNodesInRange(root, range, [TAGS.Note, TAGS.Chord]);
    // Only the chord itself should be selected, not the G/B/c/e notes inside it.
    expect(ids).to.have.length(1);
    const found = findNodeById(root, ids[0]);
    expect(found?.tag).to.equal(TAGS.Chord);
  });

  it("includes rests and y-spacers when they are passed among the requested tags", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC z y D|\n");
    const root = fromAst(ast, ctx);
    const range = computeNodeRange(root)!;
    const ids = findNodesInRange(root, range, [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER]);
    const tags = ids.map((id) => findNodeById(root, id)?.tag);
    expect(tags).to.include(TAGS.Rest);
    expect(tags).to.include(TAGS.YSPACER);
    expect(tags.filter((t) => t === TAGS.Note)).to.have.length(2);
  });

  it("excludes rests and y-spacers when they are not among the requested tags", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC z y D|\n");
    const root = fromAst(ast, ctx);
    const range = computeNodeRange(root)!;
    const ids = findNodesInRange(root, range, [TAGS.Note, TAGS.Chord]);
    const tags = ids.map((id) => findNodeById(root, id)?.tag);
    expect(tags).to.not.include(TAGS.Rest);
    expect(tags).to.not.include(TAGS.YSPACER);
  });
});

describe("resolveContiguousRanges", () => {
  it("computes bounding range for a cursor with multiple IDs", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const voiceSelection = selectVoices(selection, "1");
    const ranges = resolveContiguousRanges(voiceSelection);
    // Voice 1 content should produce one contiguous range
    expect(ranges.length).to.be.greaterThan(0);
    // The range should span from V:1 to the end of CDEF|
    const range = ranges[0];
    expect(range.start.line).to.equal(2); // V:1 line
    expect(range.end.line).to.equal(3); // CDEF| line
  });

  it("produces separate ranges for non-contiguous voice sections", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\nV:1\ndefg|\n");
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const voiceSelection = selectVoices(selection, "1");
    const ranges = resolveContiguousRanges(voiceSelection);
    // Voice 1 appears twice, separated by V:2, so we should have 2 ranges
    expect(ranges).to.have.length(2);
  });

  it("returns empty array for a selection with no cursors", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const selection = { root, cursors: [] };
    const ranges = resolveContiguousRanges(selection);
    expect(ranges).to.have.length(0);
  });

  it("skips IDs that cannot be found in the tree", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2|\n");
    const root = fromAst(ast, ctx);
    const selection = { root, cursors: [new Set([999999])] };
    const ranges = resolveContiguousRanges(selection);
    expect(ranges).to.have.length(0);
  });

  it("handles user input with voice re-entry pattern", () => {
    const input = `X:1
T:Test
M:4 / 4
L:1 / 4
V:1 name=A clef=treble
V:3
V:2 name=B clef=bass
V:4
K:C
V:1
FDEC            | A C     D B     |
V:3
AFGE            | c E     F d     |
V:2
[F,A,]2 [E,G,]2 | [A,B,]2 [F,A,]2 |
V:4
D,2 C,2         | C,2     C,2     |
%
V:1
ABC             | DFE             | DBA
`;
    const { ast, ctx } = parseAbc(input);
    const root = fromAst(ast, ctx);
    const selection = createSelection(root);
    const voiceSelection = selectVoices(selection, "1");
    const ranges = resolveContiguousRanges(voiceSelection);
    // Voice 1 appears twice in the music body (after K:C), separated by other voices
    expect(ranges.length).to.be.greaterThanOrEqual(2);
    // Each range should span multiple characters (not just single nodes)
    for (const range of ranges) {
      const charSpan = range.end.character - range.start.character;
      const lineSpan = range.end.line - range.start.line;
      expect(charSpan > 0 || lineSpan > 0).to.be.true;
    }
  });
});
