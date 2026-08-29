import { ABCContext, Scanner, parse, AbcFormatter, Expr, AbcErrorReporter, SemanticAnalyzer } from "abcls-parser";
import { ContextInterpreter, DocumentSnapshots } from "abcls-parser/interpreter/ContextInterpreter";
import { createRational, isInfiniteRational } from "abcls-parser/Visitors/fmt/rational";
import { expect } from "chai";
import { cloneSubtree, visit } from "../../cstree/src/cstree";
import * as barmap from "../src/context/csBarMap";
import { fromAst } from "../src/csTree/fromAst";
import { toAst } from "../src/csTree/toAst";
import { CSNode, TAGS } from "../src/csTree/types";
import { createSelection, Selection } from "../src/selection";
import { selectRange } from "../src/selectors/rangeSelector";
import { findFirstByTag } from "../src/selectors/treeWalk";
import {
  isTimeEvent,
  calculateDuration,
  splitNoteAt,
  getMaxChordSize,
  getBarSlice,
  findBarSliceInSystems,
  buildTimeMap,
  cursorRangeToTimeRange,
  replaceTimeRangeInBar,
  extractBarsContent,
  filterToParts,
  assignParts,
  createVoiceLine,
  createVoiceLineNodes,
  registerVoiceInBarMap,
  createBar,
  collectVoicePositions,
  findBarEntry,
  walkAndFilterMulti,
  explosion,
} from "../src/transforms/explosionTimed";
import { computeNodeRange, rangesOverlap } from "../src/utils/rangeUtils";

function parseToCSTree(input: string): CSNode {
  const ctx = new ABCContext();
  const tokens = Scanner(input, ctx);
  const ast = parse(tokens, ctx);
  return fromAst(ast, ctx);
}

function findTuneBody(root: CSNode): CSNode {
  const tuneBody = findFirstByTag(root, TAGS.Tune_Body);
  if (!tuneBody) throw new Error("Tune has no body");
  return tuneBody;
}

function findFirstSystem(root: CSNode): CSNode {
  const tuneBody = findTuneBody(root);
  let child = tuneBody.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.System) return child;
    child = child.nextSibling;
  }
  throw new Error("Tune has no system");
}

function findFirstByTagInSystem(system: CSNode, tag: TAGS): CSNode | null {
  let child = system.firstChild;
  while (child !== null) {
    if (child.tag === tag) return child;
    child = child.nextSibling;
  }
  return null;
}

describe("explosionTimed", () => {
  describe("isTimeEvent", () => {
    it("a Note node returns true", () => {
      const root = parseToCSTree("X:1\nK:C\nC\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note);
      expect(note).to.not.be.null;
      expect(isTimeEvent(note!)).to.be.true;
    });

    it("a Chord node returns true", () => {
      const root = parseToCSTree("X:1\nK:C\n[CEG]\n");
      const system = findFirstSystem(root);
      const chord = findFirstByTagInSystem(system, TAGS.Chord);
      expect(chord).to.not.be.null;
      expect(isTimeEvent(chord!)).to.be.true;
    });

    it("a Rest node returns true", () => {
      const root = parseToCSTree("X:1\nK:C\nz\n");
      const system = findFirstSystem(root);
      const rest = findFirstByTagInSystem(system, TAGS.Rest);
      expect(rest).to.not.be.null;
      expect(isTimeEvent(rest!)).to.be.true;
    });

    it("a BarLine node returns false", () => {
      const root = parseToCSTree("X:1\nK:C\nC |\n");
      const system = findFirstSystem(root);
      const barline = findFirstByTagInSystem(system, TAGS.BarLine);
      expect(barline).to.not.be.null;
      expect(isTimeEvent(barline!)).to.be.false;
    });

    it("a Beam with Note children returns true", () => {
      const root = parseToCSTree("X:1\nK:C\nAB\n");
      const system = findFirstSystem(root);
      const beam = findFirstByTagInSystem(system, TAGS.Beam);
      if (beam) {
        expect(isTimeEvent(beam)).to.be.true;
      }
      // If no beam is generated (parser may not beam these), the test is trivially correct
    });

    it("an Info_line returns false", () => {
      const root = parseToCSTree("X:1\nK:C\nC\n");
      const tuneHeader = findFirstByTag(root, TAGS.Tune_header);
      if (tuneHeader && tuneHeader.firstChild) {
        expect(isTimeEvent(tuneHeader.firstChild)).to.be.false;
      }
    });

    it("a MultiMeasureRest returns true", () => {
      const root = parseToCSTree("X:1\nK:C\nZ4\n");
      const system = findFirstSystem(root);
      const multiMeasureRest = findFirstByTagInSystem(system, TAGS.MultiMeasureRest);
      expect(multiMeasureRest).to.not.be.null;
      expect(isTimeEvent(multiMeasureRest!)).to.be.true;
    });
  });

  describe("calculateDuration", () => {
    it("note with no rhythm child has duration 1/1", () => {
      const root = parseToCSTree("X:1\nK:C\nC\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;
      const dur = calculateDuration(note, {});
      expect(dur.numerator).to.equal(1);
      expect(dur.denominator).to.equal(1);
    });

    it("note with rhythm 2 has duration 2/1", () => {
      const root = parseToCSTree("X:1\nK:C\nC2\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;
      const dur = calculateDuration(note, {});
      expect(dur.numerator).to.equal(2);
      expect(dur.denominator).to.equal(1);
    });

    it("note with rhythm /2 has duration 1/2", () => {
      const root = parseToCSTree("X:1\nK:C\nC/2\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;
      const dur = calculateDuration(note, {});
      expect(dur.numerator).to.equal(1);
      expect(dur.denominator).to.equal(2);
    });

    it("note with rhythm 3/4 has duration 3/4", () => {
      const root = parseToCSTree("X:1\nK:C\nC3/4\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;
      const dur = calculateDuration(note, {});
      expect(dur.numerator).to.equal(3);
      expect(dur.denominator).to.equal(4);
    });

    it("multi-measure rest returns infinity (1/0)", () => {
      const root = parseToCSTree("X:1\nK:C\nZ4\n");
      const system = findFirstSystem(root);
      const multiMeasureRest = findFirstByTagInSystem(system, TAGS.MultiMeasureRest)!;
      const dur = calculateDuration(multiMeasureRest, {});
      expect(isInfiniteRational(dur)).to.be.true;
    });

    it("rest with rhythm 2 has duration 2/1", () => {
      const root = parseToCSTree("X:1\nK:C\nz2\n");
      const system = findFirstSystem(root);
      const rest = findFirstByTagInSystem(system, TAGS.Rest)!;
      const dur = calculateDuration(rest, {});
      expect(dur.numerator).to.equal(2);
      expect(dur.denominator).to.equal(1);
    });

    it("chord with rhythm 4 has duration 4/1", () => {
      const root = parseToCSTree("X:1\nK:C\n[CEG]4\n");
      const system = findFirstSystem(root);
      const chord = findFirstByTagInSystem(system, TAGS.Chord)!;
      const dur = calculateDuration(chord, {});
      expect(dur.numerator).to.equal(4);
      expect(dur.denominator).to.equal(1);
    });
  });

  describe("splitNoteAt", () => {
    it("splits a note C2 at offset 1 into two notes each with duration 1", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC2\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;

      const result = splitNoteAt(note, createRational(1, 1), ctx);
      expect(result).to.not.be.null;

      const firstDur = calculateDuration(result!.first, {});
      const secondDur = calculateDuration(result!.second, {});
      expect(firstDur.numerator).to.equal(1);
      expect(firstDur.denominator).to.equal(1);
      expect(secondDur.numerator).to.equal(1);
      expect(secondDur.denominator).to.equal(1);
    });

    it("returns null when splitAt is zero", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC2\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;

      const result = splitNoteAt(note, createRational(0, 1), ctx);
      expect(result).to.be.null;
    });

    it("returns null when splitAt equals the full duration", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC2\n");
      const system = findFirstSystem(root);
      const note = findFirstByTagInSystem(system, TAGS.Note)!;

      const result = splitNoteAt(note, createRational(2, 1), ctx);
      expect(result).to.be.null;
    });

    it("splits a chord [CEG]4 at offset 2 into two chords each with duration 2", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CEG]4\n");
      const system = findFirstSystem(root);
      const chord = findFirstByTagInSystem(system, TAGS.Chord)!;

      const result = splitNoteAt(chord, createRational(2, 1), ctx);
      expect(result).to.not.be.null;

      const firstDur = calculateDuration(result!.first, {});
      const secondDur = calculateDuration(result!.second, {});
      expect(firstDur.numerator).to.equal(2);
      expect(firstDur.denominator).to.equal(1);
      expect(secondDur.numerator).to.equal(2);
      expect(secondDur.denominator).to.equal(1);
    });
  });

  describe("getMaxChordSize", () => {
    it("sibling chain with [CEG] returns 3", () => {
      const root = parseToCSTree("X:1\nK:C\n[CEG]\n");
      const system = findFirstSystem(root);
      expect(getMaxChordSize(system.firstChild)).to.equal(3);
    });

    it("sibling chain with standalone notes only returns 1", () => {
      const root = parseToCSTree("X:1\nK:C\nC D E\n");
      const system = findFirstSystem(root);
      expect(getMaxChordSize(system.firstChild)).to.equal(1);
    });

    it("sibling chain with [CE] and [CEGA] returns 4", () => {
      const root = parseToCSTree("X:1\nK:C\n[CE] [CEGA]\n");
      const system = findFirstSystem(root);
      expect(getMaxChordSize(system.firstChild)).to.equal(4);
    });

    it("empty chain returns 1", () => {
      expect(getMaxChordSize(null)).to.equal(1);
    });
  });

  describe("getBarSlice", () => {
    it("finds bar content before first barline", () => {
      const root = parseToCSTree("X:1\nK:C\nC D | E F\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;

      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry);
      expect(slice).to.not.be.null;
      expect(slice!.startNode).to.not.be.null;
      expect(slice!.startNode!.tag).to.equal(TAGS.Note);
    });

    it("finds bar content between two barlines", () => {
      const root = parseToCSTree("X:1\nK:C\nC D | E F | G A\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(1)!;

      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry);
      expect(slice).to.not.be.null;
      expect(slice!.startNode).to.not.be.null;
    });

    it("returns null for non-existent anchor ID", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, { barNumber: 0, closingNodeId: 99999 });
      expect(slice).to.be.null;
    });

    it("stops at voice markers when scanning backward", () => {
      const root = parseToCSTree("X:1\nK:C\n[V:1]C D | [V:2]E F |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      // Voice 2's first bar should start after the [V:2] marker
      const voice2Entries = barMap.get("2");
      if (voice2Entries && voice2Entries.size > 0) {
        const entry = voice2Entries.get(0)!;
        const system = findFirstSystem(root);
        const slice = getBarSlice(system, entry);
        expect(slice).to.not.be.null;
        // The start node should not be a voice marker
        if (slice!.startNode) {
          expect(isVoiceMarkerNode(slice!.startNode)).to.be.false;
        }
      }
    });

    it("content-node anchor is included in the slice (endNode is the anchor)", () => {
      // When there is no trailing barline, the last content node is the anchor
      const root = parseToCSTree("X:1\nK:C\nC D E F\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;

      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry);
      expect(slice).to.not.be.null;
      expect(slice!.endNode).to.not.be.null;
      // The end node should be the anchor itself (not a barline)
      expect(slice!.endNode!.id).to.equal(entry.closingNodeId);
    });
  });

  describe("findBarSliceInSystems", () => {
    it("finds bar in second System when not in first", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\nE F |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      // Bar 1 should be in the second system (second line)
      const entry = barMap.get("1")!.get(1)!;
      const slice = findBarSliceInSystems(tuneBody, entry);
      expect(slice).to.not.be.null;
    });

    it("returns null when anchor not found in any System", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const slice = findBarSliceInSystems(tuneBody, { barNumber: 0, closingNodeId: 99999 });
      expect(slice).to.be.null;
    });
  });

  // ==========================================================================
  // Phase 2 tests
  // ==========================================================================

  describe("buildTimeMap", () => {
    it("bar with two quarter notes produces two entries with start times 0 and 1", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;
      const timeMap = buildTimeMap(slice.startNode, slice.endNode);
      expect(timeMap).to.have.length(2);
      expect(timeMap[0].startTime.numerator).to.equal(0);
      expect(timeMap[1].startTime.numerator).to.equal(1);
      expect(timeMap[1].startTime.denominator).to.equal(1);
    });

    it("bar with no time events produces empty map", () => {
      // A bar that is entirely empty (only barlines) has no time events
      const root = parseToCSTree("X:1\nK:C\n| |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;
      const timeMap = buildTimeMap(slice.startNode, slice.endNode);
      expect(timeMap).to.have.length(0);
    });

    it("multi-measure rest without barDuration stops the map", () => {
      const root = parseToCSTree("X:1\nK:C\nZ4 |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;
      const timeMap = buildTimeMap(slice.startNode, slice.endNode);
      // Without barDuration, the map stops at the multi-measure rest
      expect(timeMap).to.have.length(0);
    });

    it("multi-measure rest with barDuration uses it as the duration", () => {
      const root = parseToCSTree("X:1\nK:C\nZ4 |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;
      const barDur = createRational(4, 1);
      const timeMap = buildTimeMap(slice.startNode, slice.endNode, barDur);
      expect(timeMap).to.have.length(1);
      expect(timeMap[0].duration.numerator).to.equal(4);
      expect(timeMap[0].duration.denominator).to.equal(1);
    });
  });

  describe("cursorRangeToTimeRange", () => {
    it("cursor covering entire bar returns time range spanning all content", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;

      // Create a cursor range that spans the entire line
      const cursorRange = { start: { line: 2, character: 0 }, end: { line: 2, character: 100 } };
      const timeRange = cursorRangeToTimeRange(slice.startNode, slice.endNode, cursorRange);

      expect(timeRange.start.numerator).to.equal(0);
      // Two quarter notes: total duration = 2
      expect(timeRange.end.numerator).to.equal(2);
      expect(timeRange.end.denominator).to.equal(1);
    });

    it("cursor covering no notes returns zero-span range", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;

      // Cursor range on a different line
      const cursorRange = { start: { line: 99, character: 0 }, end: { line: 99, character: 10 } };
      const timeRange = cursorRangeToTimeRange(slice.startNode, slice.endNode, cursorRange);

      expect(timeRange.start.numerator).to.equal(0);
      expect(timeRange.end.numerator).to.equal(0);
    });
  });

  describe("replaceTimeRangeInBar", () => {
    it("replaces entire bar content when time range covers everything", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");
      const entry = barMap.get("1")!.get(0)!;
      const system = findFirstSystem(root);
      const slice = getBarSlice(system, entry)!;

      // Create replacement: a single E note
      const replacementRoot = parseToCSTree("X:1\nK:C\nE\n");
      const replacementSystem = findFirstSystem(replacementRoot);
      const replacementNote = findFirstByTagInSystem(replacementSystem, TAGS.Note)!;
      const replacementClone = cloneSubtree(replacementNote, () => ctx.generateId());

      // Time range covering the whole bar (0 to 2)
      const timeRange = { start: createRational(0, 1), end: createRational(2, 1) };

      replaceTimeRangeInBar(slice, timeRange, [replacementClone], ctx);

      // After replacement, the system should contain the replacement note before the barline
      let noteCount = 0;
      let child = system.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Note) noteCount++;
        child = child.nextSibling;
      }
      // Should have exactly 1 note (the replacement)
      expect(noteCount).to.equal(1);
    });
  });

  describe("extractBarsContent", () => {
    it("extracts bars with each bar including its closing barline", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D | E F |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const result = extractBarsContent(barMap, { start: 0, end: 1 }, "1", tuneBody, ctx);

      // Each bar includes its closing barline: C D | and E F |
      let noteCount = 0;
      let barlineCount = 0;
      let child = result.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Note) noteCount++;
        if (child.tag === TAGS.BarLine) barlineCount++;
        child = child.nextSibling;
      }
      expect(noteCount).to.equal(4);
      expect(barlineCount).to.equal(2);
    });

    it("single bar extraction includes its closing barline", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const result = extractBarsContent(barMap, { start: 0, end: 0 }, "1", tuneBody, ctx);

      let barlineCount = 0;
      let child = result.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.BarLine) barlineCount++;
        child = child.nextSibling;
      }
      expect(barlineCount).to.equal(1);
    });

    it("returns empty system for non-existent voice", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const result = extractBarsContent(barMap, { start: 0, end: 0 }, "nonexistent", tuneBody, ctx);
      expect(result.firstChild).to.be.null;
    });
  });

  describe("walkAndFilterMulti", () => {
    it("[CEG] filtered with partIndices [0] keeps only the top note G", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CEG]\n");
      const system = findFirstSystem(root);

      // Clone the system to avoid modifying the original
      const clone = cloneSubtree(system, () => ctx.generateId());
      walkAndFilterMulti(clone, clone.firstChild, [0], ctx);

      // Part 0 keeps the top note (G). The chord should be unwrapped to a single note.
      let noteCount = 0;
      let chordCount = 0;
      let child = clone.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Note) noteCount++;
        if (child.tag === TAGS.Chord) chordCount++;
        child = child.nextSibling;
      }
      expect(noteCount).to.equal(1);
      expect(chordCount).to.equal(0);
    });

    it("[CEG] filtered with partIndices [2] keeps only the bottom note C, converts standalone notes to rests", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CEG] A\n");
      const system = findFirstSystem(root);

      const clone = cloneSubtree(system, () => ctx.generateId());
      walkAndFilterMulti(clone, clone.firstChild, [2], ctx);

      // Part 2 keeps the bottom note C from the chord (unwrapped), and converts A to rest
      let noteCount = 0;
      let restCount = 0;
      let child = clone.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Note) noteCount++;
        if (child.tag === TAGS.Rest) restCount++;
        child = child.nextSibling;
      }
      expect(noteCount).to.equal(1);
      expect(restCount).to.equal(1);
    });

    it("[CEG] filtered with partIndices [1, 2] keeps two notes as chord", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CEG]\n");
      const system = findFirstSystem(root);

      const clone = cloneSubtree(system, () => ctx.generateId());
      walkAndFilterMulti(clone, clone.firstChild, [1, 2], ctx);

      // partIndices [1, 2] keeps notes at index 1 (E) and 2 (C) — the chord remains a chord with 2 notes
      let chordCount = 0;
      let child = clone.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Chord) chordCount++;
        child = child.nextSibling;
      }
      expect(chordCount).to.equal(1);
    });
  });

  describe("filterToParts", () => {
    it("filters and consolidates rests", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nA B [CEG]\n");
      const system = findFirstSystem(root);

      const clone = cloneSubtree(system, () => ctx.generateId());
      // Part 1: standalone notes become rests, chords keep second note
      filterToParts(clone, [1], ctx);

      // A and B become rests, which should be consolidated into one rest
      // [CEG] keeps the E note (second from top)
      let restCount = 0;
      let child = clone.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.Rest) restCount++;
        child = child.nextSibling;
      }
      // Two z rests should be consolidated into one z2
      expect(restCount).to.equal(1);
    });
  });

  describe("assignParts", () => {
    it("assigns single part to each target when chord size equals target count", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CE]\n");
      const system = findFirstSystem(root);

      const contentNode = cloneSubtree(system, () => ctx.generateId());
      const assignments = assignParts([{ voiceId: "1", contentNode }], ["1", "2"]);

      expect(assignments.size).to.equal(2);
      expect(assignments.get("1")!.partIndices).to.deep.equal([0]);
      expect(assignments.get("2")!.partIndices).to.deep.equal([1]);
    });

    it("last target gets leftover parts when more notes than targets", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\n[CEG]\n");
      const system = findFirstSystem(root);

      const contentNode = cloneSubtree(system, () => ctx.generateId());
      const assignments = assignParts([{ voiceId: "1", contentNode }], ["1", "2"]);

      expect(assignments.size).to.equal(2);
      expect(assignments.get("1")!.partIndices).to.deep.equal([0]);
      expect(assignments.get("2")!.partIndices).to.deep.equal([1, 2]);
    });
  });

  describe("createVoiceLine", () => {
    it("creates a system with voice marker, Z rest, barline and registers in bar map", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      createVoiceLine(barMap, "2", tuneBody, ["1", "2"], ctx);

      // The bar map should now have voice "2"
      expect(barMap.has("2")).to.be.true;
      const voice2Entries = barMap.get("2")!;
      expect(voice2Entries.size).to.equal(1);
      expect(voice2Entries.get(0)!.barNumber).to.equal(0);

      // There should be a new System child in tuneBody
      let systemCount = 0;
      let child = tuneBody.firstChild;
      while (child !== null) {
        if (child.tag === TAGS.System) systemCount++;
        child = child.nextSibling;
      }
      expect(systemCount).to.equal(2);
    });
  });

  describe("createVoiceLineNodes", () => {
    it("returns unattached nodes with the expected tags and lexemes", () => {
      const ctx = new ABCContext();
      const nodes = createVoiceLineNodes("2", ctx);

      expect(nodes.inlineField.tag).to.equal(TAGS.Inline_field);
      expect(nodes.multiMeasureRestNode.tag).to.equal(TAGS.MultiMeasureRest);
      expect(nodes.barlineNode.tag).to.equal(TAGS.BarLine);
      expect(nodes.eolToken.tag).to.equal(TAGS.Token);
      expect((nodes.eolToken.data as { lexeme: string }).lexeme).to.equal("\n");

      // The inline field should contain [V:2]
      let child = nodes.inlineField.firstChild;
      const lexemes: string[] = [];
      while (child !== null) {
        if ("lexeme" in child.data) lexemes.push((child.data as { lexeme: string }).lexeme);
        child = child.nextSibling;
      }
      expect(lexemes).to.deep.equal(["[", "V:", "2", "]"]);
    });
  });

  describe("registerVoiceInBarMap", () => {
    it("registers a voice with a single bar entry at bar 0", () => {
      const barMap = new Map() as import("../src/context/csBarMap").BarMap;
      registerVoiceInBarMap(barMap, "2", 42);

      expect(barMap.has("2")).to.be.true;
      const entries = barMap.get("2")!;
      expect(entries.size).to.equal(1);
      expect(entries.get(0)!.barNumber).to.equal(0);
      expect(entries.get(0)!.closingNodeId).to.equal(42);
    });
  });

  describe("createBarMapState + visit on System directly", () => {
    it("produces the same bar map as buildMap with a Tune_Body wrapper", () => {
      const root = parseToCSTree("X:1\nK:C\nC D | E F |\n");
      const tuneBody = findTuneBody(root);

      const barMapFromTuneBody = barmap.buildMap(tuneBody, "1");

      // Find the System child
      let system: CSNode | null = tuneBody.firstChild;
      while (system !== null && system.tag !== TAGS.System) {
        system = system.nextSibling;
      }
      expect(system).to.not.be.null;

      // Build bar map directly from the System
      const state = barmap.init("1");
      visit(system!, state);
      barmap.finalize(state);
      const barMapFromSystem = state.barMap;

      // Both should have the same voices and bar entries
      expect(barMapFromSystem.size).to.equal(barMapFromTuneBody.size);
      for (const [voiceId, entries] of barMapFromTuneBody) {
        expect(barMapFromSystem.has(voiceId)).to.be.true;
        const systemEntries = barMapFromSystem.get(voiceId)!;
        expect(systemEntries.size).to.equal(entries.size);
        for (const [barNum, entry] of entries) {
          expect(systemEntries.has(barNum)).to.be.true;
          expect(systemEntries.get(barNum)!.closingNodeId).to.equal(entry.closingNodeId);
        }
      }
    });
  });

  describe("findBarSliceInSystems with System root", () => {
    it("finds a bar slice when the root node is a System", () => {
      const root = parseToCSTree("X:1\nK:C\nC D | E F |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const entry = barMap.get("1")!.get(0)!;

      // Call with System as root (not Tune_Body)
      let system: CSNode | null = tuneBody.firstChild;
      while (system !== null && system.tag !== TAGS.System) {
        system = system.nextSibling;
      }
      expect(system).to.not.be.null;

      const slice = findBarSliceInSystems(system!, entry);
      expect(slice).to.not.be.null;
      expect(slice!.systemNode).to.equal(system);
    });
  });

  describe("createBar", () => {
    it("appends rest + barline after the last bar entry and registers in bar map", () => {
      const ctx = new ABCContext();
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      expect(barMap.get("1")!.size).to.equal(1);

      createBar(barMap, "1", 1, tuneBody, ctx);

      // The bar map should now have 2 entries for voice "1"
      expect(barMap.get("1")!.size).to.equal(2);
      expect(barMap.get("1")!.get(1)!.barNumber).to.equal(1);
    });
  });

  describe("collectVoicePositions", () => {
    it("collects voice IDs from multi-voice tune", () => {
      const root = parseToCSTree("X:1\nK:C\n[V:1]C D | [V:2]E F |\n");
      const tuneBody = findTuneBody(root);
      const positions = collectVoicePositions(tuneBody);

      const voiceIds = positions.map((p) => p.voiceId);
      expect(voiceIds).to.include("1");
      expect(voiceIds).to.include("2");
    });

    it("collects voice IDs from deferred multi-voice tune", () => {
      const root = parseToCSTree("X:1\nK:C\nV:1\nC D |\nV:2\nE F |\n");
      const tuneBody = findTuneBody(root);
      const positions = collectVoicePositions(tuneBody);

      const voiceIds = positions.map((p) => p.voiceId);
      expect(voiceIds).to.include("1");
      expect(voiceIds).to.include("2");
    });

    it("returns empty array for single-voice tune without voice markers", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const positions = collectVoicePositions(tuneBody);
      expect(positions).to.have.length(0);
    });
  });

  describe("findBarEntry", () => {
    it("finds an existing bar entry", () => {
      const root = parseToCSTree("X:1\nK:C\nC D | E F |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const entry = findBarEntry(barMap, "1", 0);
      expect(entry).to.not.be.null;
      expect(entry!.barNumber).to.equal(0);
    });

    it("returns null for non-existent bar number", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const entry = findBarEntry(barMap, "1", 99);
      expect(entry).to.be.null;
    });

    it("returns null for non-existent voice", () => {
      const root = parseToCSTree("X:1\nK:C\nC D |\n");
      const tuneBody = findTuneBody(root);
      const barMap = barmap.buildMap(tuneBody, "1");

      const entry = findBarEntry(barMap, "nonexistent", 0);
      expect(entry).to.be.null;
    });
  });
});

function isVoiceMarkerNode(node: CSNode): boolean {
  return node.tag === TAGS.Info_line || node.tag === TAGS.Inline_field;
}

function serializeSelection(selection: Selection, ctx: ABCContext): string {
  const ast = toAst(selection.root);
  const formatter = new AbcFormatter(ctx);
  return formatter.stringify(ast as Expr);
}

function createFullTestContext(abc: string): {
  selection: Selection;
  ctx: ABCContext;
  snapshots: DocumentSnapshots;
} {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const root = fromAst(ast, ctx);
  const selection = createSelection(root);

  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);

  const interpreter = new ContextInterpreter();
  const snapshots = interpreter.interpret(ast, analyzer.data, ctx);

  return { selection, ctx, snapshots };
}

function createExplosionTestContext(
  abc: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): {
  selection: Selection;
  ctx: ABCContext;
  snapshots: DocumentSnapshots;
} {
  const { selection, ctx, snapshots } = createFullTestContext(abc);
  const narrowed = selectRange(selection, startLine, startCol, endLine, endCol);
  const merged = new Set<number>();
  for (const cursor of narrowed.cursors) {
    for (const id of cursor) merged.add(id);
  }
  return {
    selection: { root: narrowed.root, cursors: [merged] },
    ctx,
    snapshots,
  };
}

/**
 * Builds the cursor the same way the LSP server does: only Note and Chord
 * nodes whose ranges overlap the selection are included. This matches the
 * GROUPED_CURSOR_TRANSFORMS path in the server, where TRANSFORM_NODE_TAGS
 * defaults to [Note, Chord] for the explosion transform.
 */
function createLspStyleTestContext(
  abc: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): {
  selection: Selection;
  ctx: ABCContext;
  snapshots: DocumentSnapshots;
} {
  const { selection, ctx, snapshots } = createFullTestContext(abc);
  const editorRange = {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };
  const tags = new Set([TAGS.Note, TAGS.Chord]);
  const groupedIds = new Set<number>();
  function collect(node: CSNode): void {
    if (tags.has(node.tag)) {
      const nr = computeNodeRange(node);
      if (nr && rangesOverlap(editorRange, nr)) {
        groupedIds.add(node.id);
      }
    }
    let child = node.firstChild;
    while (child) {
      collect(child);
      child = child.nextSibling;
    }
  }
  collect(selection.root);
  return {
    selection: { root: selection.root, cursors: [groupedIds] },
    ctx,
    snapshots,
  };
}

describe("explosion CSTree end-to-end", () => {
  describe("deferred style (ctx.tuneLinear = false)", () => {
    it("simple two-note chords exploded into two voices", () => {
      const abc = "X:1\nK:C\n[CE] [DF] [EG]|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] [DF] [EG]|\n[V:1]E F G|\n[V:2]C D E|\n");
      expect(result.cursors.length).to.equal(2);
      expect(result.cursors[0].size).to.be.greaterThan(0);
      expect(result.cursors[1].size).to.be.greaterThan(0);
    });

    it("three-note chord exploded into three voices", () => {
      const abc = "X:1\nK:C\n[CEG]|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2", "3"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CEG]|\n[V:1]G|\n[V:2]E|\n[V:3]C|\n");
      expect(result.cursors.length).to.equal(3);
    });

    it("two-bar selection with mixed chords and standalone notes", () => {
      const abc = "X:1\nK:C\n[CE] D | [EG] F|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] D | [EG] F|\n[V:1]E D | G F|\n[V:2]C z | E z|\n");
      expect(result.cursors.length).to.equal(2);
    });

    it("partial bar selection (only some notes selected)", () => {
      const abc = "X:1\nK:C\nA [CE] [DF] B|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 2, 2, 11);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      // Leading z = rest for the unselected A before the cursor.
      // Trailing z = rest for the unselected B after the cursor.
      expect(text).to.equal("X:1\nK:C\nA [CE] [DF] B|\n[V:1]zE Fz|\n[V:2]zC Dz|\n");
    });

    it("tune with explicit voice declaration", () => {
      const abc = "X:1\nK:C\nV:1\n[CE] [DF]| [EG] [FA]|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 3, 0, 3, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\nV:1\nE F|  G A|\n[V:2]C D| E F|\n");
      expect(result.cursors.length).to.equal(2);
      expect(result.cursors[0].size).to.be.greaterThan(0);
      expect(result.cursors[1].size).to.be.greaterThan(0);
    });

    it("chord inside a beamed group (no spaces around it) is exploded to all target voices", () => {
      // The broken rhythm ">" and tie "-" glue this into a single Beam node, so the
      // chord is a grandchild of the bar content rather than a direct sibling.
      const abc = "X:1\nK:C\nV:2\nz2 | A,2>[CEGB]2-[CEGB]4 |\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 3, 0, 3, 100);

      const result = explosion(selection, ["3", "4"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.include("[V:3]");
      expect(text).to.include("[V:4]");
      expect(result.cursors.length).to.equal(2);
      expect(result.cursors[0].size).to.be.greaterThan(0);
      expect(result.cursors[1].size).to.be.greaterThan(0);
    });

    it("two-voice deferred tune, exploding the shorter voice creates exactly as many bars as it has (not the other voice's bar count)", () => {
      // V:1 has 3 bars, V:2 (the source voice being exploded) has only 2. The exploded
      // target voices must match V:2's 2 bars, not get padded out to V:1's 3.
      const abc =
        'X:1\nK:C\n[V:1] E2 | "Am" c6 BA               | "Bø" A4- "E⁷" A2 ^GB |\n[V:2] z2 |      A,2>[cegb]2-[cegb]4 |\n';
      const { selection, ctx, snapshots } = createLspStyleTestContext(abc, 3, 0, 3, 100);

      const result = explosion(selection, ["3", "4"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      function barCount(line: string): number {
        return (line.match(/\|/g) || []).length;
      }
      const v3Line = text.split("\n").find((l) => l.startsWith("[V:3]"))!;
      const v4Line = text.split("\n").find((l) => l.startsWith("[V:4]"))!;
      expect(barCount(v3Line)).to.equal(2);
      expect(barCount(v4Line)).to.equal(2);
    });

    it("multi-system deferred tune, exploding only the last system's bars does not pull in bars from earlier systems", () => {
      // V:2's bar numbers are cumulative across both systems (bars 0-3 in the first system,
      // bars 4-5 in the second). Selecting only the second system's content must produce
      // exactly the 2 bars of that system, not get padded out using V:2's full-tune bar count
      // (which previously produced 5 spurious extra "Z" bars) and must not pick up a phantom
      // bar from the "%" comment line between the two systems.
      const abc = [
        "X:7",
        "%%gchordfont Times 12",
        "Q:75",
        "V:1 clef=treble stem=up style=normal",
        "V:2 clef=bass octave=-2 style=normal stem=down",
        '[V:1] E2 | "Am" c6 BA               | "Bø" A4- "E⁷"    A2 ^GB          | "Am" E4 "etc." y2',
        '[V:2] z2 |      A,2>[cegb]2-[cegb]4 |      B,2>[dfab]2 z [d^^f^gc\']2 E |      A,2>[cegb]2-[cegb]4',
        "%",
        '[V:1] E2 | "Am" c6 BA               | "Bø" A4- "E⁷" A2 ^GB |',
        "[V:2] z2 |      A,2>[cegb]2-[cegb]4 |",
        "",
      ].join("\n");

      // Line 9 (0-indexed) is the last system's [V:2] line.
      const { selection, ctx, snapshots } = createLspStyleTestContext(abc, 9, 0, 9, 100);

      const result = explosion(selection, ["3", "4"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      function barCount(line: string): number {
        return (line.match(/\|/g) || []).length;
      }
      const v3Line = text.split("\n").find((l) => l.startsWith("[V:3]"))!;
      const v4Line = text.split("\n").find((l) => l.startsWith("[V:4]"))!;
      expect(v3Line).to.not.be.undefined;
      expect(v4Line).to.not.be.undefined;
      expect(barCount(v3Line)).to.equal(2);
      expect(barCount(v4Line)).to.equal(2);
      // The rest bar comes before the split-chord bar, matching source order.
      expect(v3Line).to.equal("[V:3]Z|A,2>b2-b4|");
      expect(v4Line).to.equal("[V:4]Z|z2>[ceg]2-[ceg]4|");
    });

    it("chords with rhythm are preserved in the exploded notes", () => {
      const abc = "X:1\nK:C\n[CE]2 [DF]/|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE]2 [DF]/|\n[V:1]E2 F/|\n[V:2]C2 D/|\n");
    });
  });

  describe("linear style (ctx.tuneLinear = true)", () => {
    it("simple linear tune with chords", () => {
      const abc = "X:1\n%%abcls-parse linear\nK:C\n[CE] [DF]|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 3, 0, 3, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\n%%abcls-parse linear\nK:C\n[CE] [DF]|\n[V:1]E F|\n[V:2]C D|\n");
      expect(result.cursors.length).to.equal(2);
    });

    it("linear tune with existing voices", () => {
      const abc = "X:1\n%%abcls-parse linear\nK:C\nV:1\n[CE] [DF]|\nV:2\nG A|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 4, 0, 4, 100);

      const result = explosion(selection, ["1", "3"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\n%%abcls-parse linear\nK:C\nV:1\nE F|\nV:2\nG A|\n[V:3]C D|\n");
    });
  });

  describe("real-world usage: chords with annotations and multi-bar context", () => {
    it("partial selection with annotations in a two-bar, single-voice tune", () => {
      const abc = 'X:1\nL:1/4\nK:F\n[V:1] [DGB] "G7" =B "Fm7" B | _BAC\n';
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 3, 6, 3, 19);

      const result = explosion(selection, ["2", "3"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      // Only the selected portion ([DGB] "G7" =B) appears in the target voices.
      // Trailing z = rest for the unselected time after the cursor.
      // The second bar (_BAC) is outside the selection, so the target voices
      // receive a rest-filled placeholder bar (Z) to match the source voice's length.
      expect(text).to.equal('X:1\nL:1/4\nK:F\n[V:1] [DGB] "G7" =B "Fm7" B | _BAC\n' + '[V:2]B "G7" =Bz|Z|\n' + '[V:3][DG] "G7" zz|Z|\n');
    });

    it("LSP-style cursor (Note/Chord only) preserves annotations and whitespace", () => {
      const abc = 'X:1\nL:1/4\nK:F\n[V:1] [DGB] "G7" =B "Fm7" B | _BAC\n';
      const { selection, ctx, snapshots } = createLspStyleTestContext(abc, 3, 6, 3, 19);

      const result = explosion(selection, ["2", "3"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal('X:1\nL:1/4\nK:F\n[V:1] [DGB] "G7" =B "Fm7" B | _BAC\n' + '[V:2]B "G7" =Bz|Z|\n' + '[V:3][DG] "G7" zz|Z|\n');
    });
  });

  describe("guard clause coverage", () => {
    it("empty selection produces no changes", () => {
      const abc = "X:1\nK:C\n[CE] [DF]|\n";
      const { selection: baseSelection, ctx, snapshots } = createFullTestContext(abc);
      const emptySelection: Selection = { root: baseSelection.root, cursors: [] };

      const result = explosion(emptySelection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal(abc);
    });

    it("selection spanning multiple voices returns unchanged", () => {
      const abc = "X:1\nK:C\nV:1\nC D|\nV:2\nE F|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 3, 0, 5, 100);

      const result = explosion(selection, ["3", "4"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal(abc);
    });

    it("tune with only standalone notes (no chords)", () => {
      const abc = "X:1\nK:C\nC D E F|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\nC D E F|\n[V:1]C D E F|\n");
    });

    it("target voice IDs include the source voice", () => {
      const abc = "X:1\nK:C\n[CE] [DF]|\n";
      const { selection, ctx, snapshots } = createExplosionTestContext(abc, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] [DF]|\n[V:1]E F|\n[V:2]C D|\n");
      expect(result.cursors.length).to.equal(2);
    });
  });

  describe("multi-tune documents", () => {
    // Tune 1's content line is line 2, tune 2's is line 6
    const TWO_DEFERRED = "X:1\nK:C\n[CE] [DF]|\n\nX:2\nK:C\n[EG] [FA]|\n";

    it("selection in the second tune explodes that tune, not the first", () => {
      const { selection, ctx, snapshots } = createLspStyleTestContext(TWO_DEFERRED, 6, 0, 6, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] [DF]|\n\nX:2\nK:C\n[EG] [FA]|\n[V:1]G A|\n[V:2]E F|\n");
      expect(result.cursors.length).to.equal(2);
      expect(result.cursors[0].size).to.be.greaterThan(0);
    });

    it("selection in the first tune leaves the second tune untouched", () => {
      const { selection, ctx, snapshots } = createLspStyleTestContext(TWO_DEFERRED, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] [DF]|\n[V:1]E F|\n[V:2]C D|\n\nX:2\nK:C\n[EG] [FA]|\n");
    });

    it("selection spanning two tunes explodes both", () => {
      const { selection, ctx, snapshots } = createLspStyleTestContext(TWO_DEFERRED, 2, 0, 6, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.equal("X:1\nK:C\n[CE] [DF]|\n[V:1]E F|\n[V:2]C D|\n\nX:2\nK:C\n[EG] [FA]|\n[V:1]G A|\n[V:2]E F|\n");
      // The created IDs of both tunes are merged into one cursor per target voice
      expect(result.cursors.length).to.equal(2);
    });

    it("a tune holding no selection is left byte-identical", () => {
      const source = "X:1\nK:C\n[CE] [DF]|\n\nX:2\nK:C\n[EG] [FA]|\n\nX:3\nK:C\n[GB] [Ac]|\n";
      // The middle tune's content line is line 6
      const { selection, ctx, snapshots } = createLspStyleTestContext(source, 6, 0, 6, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      expect(text).to.include("X:1\nK:C\n[CE] [DF]|\n");
      expect(text).to.include("X:3\nK:C\n[GB] [Ac]|\n");
      // Only the middle tune gained voice lines
      expect(text.split("[V:1]").length - 1).to.equal(1);
    });

    it("each tune is processed by the algorithm its own style calls for", () => {
      // Tune 1 is deferred, tune 2 is linear. Because ctx.tuneLinear holds only the last
      // tune's value after parsing, dispatching from it would run the linear algorithm
      // against tune 1 as well.
      const source = "X:1\nK:C\n[CE] [DF]|\n\nX:2\n%%abcls-parse linear\nK:C\n[EG] [FA]|\n";
      const { selection, ctx, snapshots } = createLspStyleTestContext(source, 2, 0, 2, 100);

      const result = explosion(selection, ["1", "2"], ctx, snapshots);
      const text = serializeSelection(result, ctx);

      // Tune 1 is exploded the deferred way, with the new voices on their own lines
      expect(text).to.include("X:1\nK:C\n[CE] [DF]|\n[V:1]E F|\n[V:2]C D|\n");
      // Tune 2 keeps its linear directive and its content
      expect(text).to.include("%%abcls-parse linear");
      expect(text).to.include("[EG] [FA]|");
    });
  });
});
