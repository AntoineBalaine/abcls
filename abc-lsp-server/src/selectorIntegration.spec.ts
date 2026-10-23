import { fromAst, createSelection, Selection, selectRange } from "abcls-editor";
import { Scanner, parse, ABCContext, File_structure } from "abcls-parser";
import { expect } from "chai";
import { describe, it } from "mocha";
import { Range } from "vscode-languageserver/node";
import { resolveSelectionRanges, resolveContiguousRanges } from "abcls-editor";
import { lookupSelector } from "./selectorLookup";

function parseAbc(source: string): { ast: File_structure; ctx: ABCContext } {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);
  return { ast, ctx };
}

function applySelector(ast: File_structure, ctx: ABCContext, selectorName: string, args?: number[], ranges?: Range[]): { ranges: Range[] } {
  const root = fromAst(ast, ctx);

  const selectorFn = lookupSelector(selectorName);
  if (!selectorFn) {
    throw new Error(`Unknown selector: "${selectorName}"`);
  }

  let selection: Selection;
  if (ranges && ranges.length > 0) {
    // Selections provided: constrain to nodes within those ranges
    const allCursors: Set<number>[] = [];
    for (const range of ranges) {
      const baseSelection = createSelection(root);
      const narrowed = selectRange(baseSelection, range.start.line, range.start.character, range.end.line, range.end.character);
      allCursors.push(...narrowed.cursors);
    }
    if (allCursors.length === 0) {
      return { ranges: [] };
    }
    selection = { root, cursors: allCursors };
  } else {
    selection = createSelection(root);
  }

  const newSelection = selectorFn(selection, ...(args ?? []));
  // Use resolveContiguousRanges for selectors that group elements into cursors,
  // which matches the behavior in server.ts
  const resultRanges =
    selectorName === "selectMeasures" || selectorName === "selectVoices" || selectorName === "selectSystem"
      ? resolveContiguousRanges(newSelection)
      : resolveSelectionRanges(newSelection);
  return { ranges: resultRanges };
}

describe("Selector Integration (end-to-end flow)", () => {
  it("selectChords on [CEG]2 C2 D2| returns 1 range matching the chord's position", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const result = applySelector(ast, ctx, "selectChords");
    expect(result.ranges).to.have.length(1);
    expect(result.ranges[0].start.line).to.equal(2);
    // The chord range includes the '[' bracket at position 0
    expect(result.ranges[0].start.character).to.equal(0);
  });

  it("selectChords followed by selectTop (composition via ranges): returns 1 range for G's position", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const chordsResult = applySelector(ast, ctx, "selectChords");
    // Use chord ranges as scope for selectTop
    const result = applySelector(ast, ctx, "selectTop", undefined, chordsResult.ranges);
    expect(result.ranges).to.have.length(1);
    expect(result.ranges[0].start.line).to.equal(2);
    expect(result.ranges[0].start.character).to.equal(3);
  });

  it("selectChords followed by selectNotes: returns only notes inside chords, not standalone notes", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const chordsResult = applySelector(ast, ctx, "selectChords");
    expect(chordsResult.ranges).to.have.length(1);
    // Use chord ranges as scope for selectNotes
    const result = applySelector(ast, ctx, "selectNotes", undefined, chordsResult.ranges);
    // Only 3 notes inside the chord (C, E, G), not the 2 standalone notes (C2, D2)
    expect(result.ranges).to.have.length(3);
  });

  it("applying a selector without ranges starts from root (selects entire document)", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");
    const result = applySelector(ast, ctx, "selectChords");
    expect(result.ranges).to.have.length(1);
  });

  it("unknown selector name throws an error", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\n");
    expect(() => applySelector(ast, ctx, "nonExistentSelector")).to.throw('Unknown selector: "nonExistentSelector"');
  });

  it("selectNotes returns one range per note", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2 E2|\n");
    const result = applySelector(ast, ctx, "selectNotes");
    expect(result.ranges).to.have.length(3);
  });

  it("selectRests returns one range per rest", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 z2 D2 z2|\n");
    const result = applySelector(ast, ctx, "selectRests");
    expect(result.ranges).to.have.length(2);
  });

  it("selectNthFromTop with n=0 returns the top note of each chord", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2|\n");
    const chordsResult = applySelector(ast, ctx, "selectChords");
    // Use chord ranges as scope, pass args
    const result = applySelector(ast, ctx, "selectNthFromTop", [0], chordsResult.ranges);
    expect(result.ranges).to.have.length(1);
    expect(result.ranges[0].start.character).to.equal(3);
  });

  it("selectTune returns one range per tune", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\n");
    const result = applySelector(ast, ctx, "selectTune");
    expect(result.ranges).to.have.length(1);
  });

  it("empty document returns empty results", () => {
    const { ast, ctx } = parseAbc("");
    const result = applySelector(ast, ctx, "selectTune");
    expect(result.ranges).to.have.length(0);
  });

  it("multi-step composition via ranges: selectChords -> selectTop", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 [FAC]2|\n");
    // First select all chords in the document
    const chordsResult = applySelector(ast, ctx, "selectChords");
    expect(chordsResult.ranges).to.have.length(2);
    // Then use chord ranges as scope to select top notes
    const topResult = applySelector(ast, ctx, "selectTop", undefined, chordsResult.ranges);
    expect(topResult.ranges).to.have.length(2);
    expect(topResult.ranges[0].start.line).to.equal(2);
  });

  it("selectMeasures returns one range per measure", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC D|E F|G A|\n");
    const result = applySelector(ast, ctx, "selectMeasures");
    // 3 measures: (C D), (E F), (G A)
    // resolveContiguousRanges returns one range per cursor (measure)
    expect(result.ranges).to.have.length(3);
  });

  it("selectMeasures groups contiguous elements within each measure", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG] z|D E|\n");
    const measureResult = applySelector(ast, ctx, "selectMeasures");
    // 2 measures: (Chord, Rest), (D, E)
    // Each measure is one contiguous range
    expect(measureResult.ranges).to.have.length(2);
  });
});

describe("Selector Integration with range constraints", () => {
  it("selectNotes with ranges constrains to notes within the range", () => {
    // Line 2: [CEG]2 C2 D2|
    // Positions: [CEG]2 = 0-5, space = 6, C2 = 7-8, space = 9, D2 = 10-11, | = 12
    // Without ranges, selectNotes returns 5 notes (C, E, G in chord + C2 + D2)
    // With ranges covering positions 7-12 (C2 and D2), should return 2 notes
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 D2|\n");

    // First verify without ranges: all 5 notes
    const allNotes = applySelector(ast, ctx, "selectNotes");
    expect(allNotes.ranges).to.have.length(5);

    // Now with ranges covering only C2 and D2 (positions 7-12 on line 2)
    const ranges = [{ start: { line: 2, character: 7 }, end: { line: 2, character: 12 } }];
    const scopedNotes = applySelector(ast, ctx, "selectNotes", undefined, ranges);
    expect(scopedNotes.ranges).to.have.length(2);
  });

  it("selectChords with ranges returns only chords within the range", () => {
    // Line 2: [CEG]2 C2 [FAC]2|
    // With ranges covering only the first chord, should return 1 chord
    const { ast, ctx } = parseAbc("X:1\nK:C\n[CEG]2 C2 [FAC]2|\n");

    // Without ranges: 2 chords
    const allChords = applySelector(ast, ctx, "selectChords");
    expect(allChords.ranges).to.have.length(2);

    // With ranges covering only first chord (positions 0-6 on line 2)
    const ranges = [{ start: { line: 2, character: 0 }, end: { line: 2, character: 6 } }];
    const scopedChords = applySelector(ast, ctx, "selectChords", undefined, ranges);
    expect(scopedChords.ranges).to.have.length(1);
  });

  it("ranges with no matching nodes returns empty results", () => {
    // Line 2: C2 D2 E2|
    // ranges covering only the barline (position 9) should return no notes
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2 E2|\n");

    const ranges = [{ start: { line: 2, character: 9 }, end: { line: 2, character: 10 } }];
    const result = applySelector(ast, ctx, "selectNotes", undefined, ranges);
    expect(result.ranges).to.have.length(0);
  });

  it("multiple ranges combine results from all ranges", () => {
    // Line 2: C2 D2 E2 F2|
    // Two ranges: one covering C2 (0-2), one covering F2 (9-11)
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2 E2 F2|\n");

    // Without ranges: 4 notes
    const allNotes = applySelector(ast, ctx, "selectNotes");
    expect(allNotes.ranges).to.have.length(4);

    // With two ranges
    const ranges = [
      { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } },
      { start: { line: 2, character: 9 }, end: { line: 2, character: 11 } },
    ];
    const scopedNotes = applySelector(ast, ctx, "selectNotes", undefined, ranges);
    expect(scopedNotes.ranges).to.have.length(2);
  });

  it("ranges spanning multiple lines works correctly", () => {
    // Two lines of music
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\nE2 F2|\n");

    // Without ranges: 4 notes across both lines
    const allNotes = applySelector(ast, ctx, "selectNotes");
    expect(allNotes.ranges).to.have.length(4);

    // With ranges covering only first line (line 2)
    const ranges = [{ start: { line: 2, character: 0 }, end: { line: 2, character: 6 } }];
    const scopedNotes = applySelector(ast, ctx, "selectNotes", undefined, ranges);
    expect(scopedNotes.ranges).to.have.length(2);
  });

  it("ranges crossing line boundaries selects partial lines correctly", () => {
    // Two lines of music: line 2 has C2 D2|, line 3 has E2 F2|
    // Positions: C2=0-1, space=2, D2=3-4, |=5 (line 2)
    //            E2=0-1, space=2, F2=3-4, |=5 (line 3)
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\nE2 F2|\n");

    // Range from D2 on line 2 (char 3) to E2 on line 3 (char 2)
    // This should capture D2 on line 2 and E2 on line 3
    const ranges = [{ start: { line: 2, character: 3 }, end: { line: 3, character: 2 } }];
    const scopedNotes = applySelector(ast, ctx, "selectNotes", undefined, ranges);
    expect(scopedNotes.ranges).to.have.length(2);
  });

  it("empty ranges array behaves like undefined (selects entire document)", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2 E2|\n");
    // Empty array should be treated the same as undefined
    const result = applySelector(ast, ctx, "selectNotes", undefined, []);
    expect(result.ranges).to.have.length(3);
  });
});

describe("Selector Integration - selectSystem", () => {
  it("selectSystem on a single-system tune returns the full system range", () => {
    // A simple tune with one system (one line of music)
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2 E2|\n");
    const result = applySelector(ast, ctx, "selectSystem");
    // Should return one range covering the entire system
    expect(result.ranges).to.have.length(1);
    // The system starts at line 2 (after X:1 and K:C)
    expect(result.ranges[0].start.line).to.equal(2);
  });

  it("selectSystem on a multi-system tune with selection in one system returns that system's range", () => {
    // Two systems (two lines of music separated by newline)
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\nE2 F2|\n");

    // Scope to just the first line (line 2, the first system)
    const ranges = [{ start: { line: 2, character: 0 }, end: { line: 2, character: 6 } }];
    const result = applySelector(ast, ctx, "selectSystem", undefined, ranges);

    // Should return one range for the first system
    expect(result.ranges).to.have.length(1);
    expect(result.ranges[0].start.line).to.equal(2);
    expect(result.ranges[0].end.line).to.equal(2);
  });

  it("selectSystem on a multi-system tune with selection spanning systems returns multiple ranges", () => {
    // Two systems (two lines of music)
    const { ast, ctx } = parseAbc("X:1\nK:C\nC2 D2|\nE2 F2|\n");

    // Without scope - selection covers entire document, which touches both systems
    const result = applySelector(ast, ctx, "selectSystem");

    // Should return two ranges, one for each system
    expect(result.ranges).to.have.length(2);
    expect(result.ranges[0].start.line).to.equal(2);
    expect(result.ranges[1].start.line).to.equal(3);
  });

  it("selectSystem with scoped input ranges respects scope and expands within it", () => {
    // Three systems with different content
    const { ast, ctx } = parseAbc("X:1\nK:C\nC D|\nE F|\nG A|\n");

    // Scope to just a note on line 3 (second system)
    const ranges = [{ start: { line: 3, character: 0 }, end: { line: 3, character: 1 } }];
    const result = applySelector(ast, ctx, "selectSystem", undefined, ranges);

    // Should return one range covering the entire second system
    expect(result.ranges).to.have.length(1);
    expect(result.ranges[0].start.line).to.equal(3);
    expect(result.ranges[0].end.line).to.equal(3);
  });
});

describe("Selector Integration with single-character ranges", () => {
  // Property-based coverage for single-char ranges is in editor/tests/rangeSelector.spec.ts.
  // This example demonstrates the end-to-end integration with the LSP selector API.
  it("selectTune with single-character range on music line returns the tune", () => {
    const { ast, ctx } = parseAbc("X:1\nK:C\nCDEF|\n");
    // Single-character range on first note (line 2, char 0-1)
    const ranges = [{ start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }];
    const result = applySelector(ast, ctx, "selectTune", undefined, ranges);
    expect(result.ranges).to.have.length(1);
    // The tune should span from X:1 to the end
    expect(result.ranges[0].start.line).to.equal(0);
  });
});
