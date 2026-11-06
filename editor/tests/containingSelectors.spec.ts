import { Range } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { collectContainerRanges, selectContaining } from "../src/selectors/containingSelectors";
import { toCSTree } from "./helpers";

function caret(line: number, character: number): Range {
  return { start: { line, character }, end: { line, character } };
}

function range(line: number, start: number, end: number): Range {
  return { start: { line, character: start }, end: { line, character: end } };
}

// Line 2: "C [DFA] E | G A |". C at 0, [ at 2, D at 3, F at 4, A at 5, ] at 6, E at 8, | at 10, G at 12, A at 14, | at 16.
const SOURCE = "X:1\nK:C\nC [DFA] E | G A |\nC D |\n";

describe("containingSelectors", () => {
  const root = toCSTree(SOURCE);

  describe("note", () => {
    it("selects the note under a caret that is inside a chord", () => {
      expect(selectContaining(root, [caret(2, 4)], "note")).to.deep.equal([range(2, 4, 5)]);
    });

    it("selects the note under a caret on a note outside a chord", () => {
      expect(selectContaining(root, [caret(2, 8)], "note")).to.deep.equal([range(2, 8, 9)]);
    });

    it("selects nothing for a caret on a bar line", () => {
      expect(selectContaining(root, [caret(2, 10)], "note")).to.deep.equal([]);
    });

    it("selects every note that a selection with text overlaps", () => {
      expect(selectContaining(root, [range(2, 3, 6)], "note")).to.deep.equal([range(2, 3, 4), range(2, 4, 5), range(2, 5, 6)]);
    });
  });

  describe("measure", () => {
    it("selects the measure that holds a caret in the middle of a chord", () => {
      const measures = collectContainerRanges(root, "measure");
      const found = selectContaining(root, [caret(2, 4)], "measure");
      expect(found).to.have.length(1);
      expect(found[0]).to.deep.equal(measures[0]);
    });

    it("selects the second measure for a caret in it", () => {
      const found = selectContaining(root, [caret(2, 13)], "measure");
      expect(found).to.have.length(1);
      expect(found[0].start.character).to.equal(12);
    });

    it("selects two measures for a selection that crosses a bar line, and merges duplicate hits", () => {
      expect(selectContaining(root, [range(2, 8, 13)], "measure")).to.have.length(2);
      expect(selectContaining(root, [caret(2, 0), caret(2, 8)], "measure")).to.have.length(1);
    });
  });

  describe("system", () => {
    it("selects the system of the line that holds the caret, and not the other system", () => {
      const found = selectContaining(root, [caret(3, 2)], "system");
      expect(found).to.have.length(1);
      expect(found[0].start.line).to.equal(3);
    });
  });

  describe("property-based tests", () => {
    it("selects exactly one measure for a caret on any note, and that measure holds the caret", () => {
      const letters = fc.array(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), { minLength: 3, maxLength: 9 });
      fc.assert(
        fc.property(letters, fc.nat(), (notes, pick) => {
          const rooted = toCSTree(`X:1\nK:C\n${notes.join(" ")} | ${notes.join(" ")} |\n`);
          const notePositions = collectContainerRanges(rooted, "note");
          const target = notePositions[pick % notePositions.length];
          const found = selectContaining(rooted, [caret(target.start.line, target.start.character)], "measure");
          return found.length === 1 && found[0].start.character <= target.start.character && found[0].end.character >= target.end.character;
        })
      );
    });
  });

  describe("tune and annotation", () => {
    const rooted = toCSTree('X:1\nK:C\n"^up" C D |\n\nX:2\nK:C\nE F |\n');

    it("selects the tune that holds a caret", () => {
      const tunes = collectContainerRanges(rooted, "tune");
      expect(tunes).to.have.length(2);
      expect(selectContaining(rooted, [caret(6, 0)], "tune")).to.deep.equal([tunes[1]]);
    });

    it("selects the annotation under a caret, and nothing when the caret is elsewhere", () => {
      const annotations = collectContainerRanges(rooted, "annotation");
      expect(annotations).to.have.length(1);
      expect(selectContaining(rooted, [caret(2, 2)], "annotation")).to.deep.equal(annotations);
      expect(selectContaining(rooted, [caret(2, 8)], "annotation")).to.deep.equal([]);
    });
  });

  describe("decoration, beam, directive and comment", () => {
    const rooted = toCSTree("X:1\nK:C\n%%MIDI program 1\n!trill!C DE | F G % note\n");
    const caretAt = (line: number, character: number): Range[] => [caret(line, character)];

    it("selects the decoration under a caret", () => {
      const decorations = collectContainerRanges(rooted, "decoration");
      expect(decorations).to.have.length(1);
      expect(selectContaining(rooted, caretAt(3, 2), "decoration")).to.deep.equal(decorations);
      expect(selectContaining(rooted, caretAt(3, 12), "decoration")).to.deep.equal([]);
    });

    it("selects the beam around a caret", () => {
      const beams = collectContainerRanges(rooted, "beam");
      expect(beams.length).to.be.greaterThan(0);
      expect(selectContaining(rooted, caretAt(3, 9), "beam")).to.have.length(1);
    });

    it("selects the directive and the comment that hold a caret, even at the end of the line", () => {
      expect(selectContaining(rooted, caretAt(2, 4), "directive")).to.have.length(1);
      expect(selectContaining(rooted, caretAt(3, 18), "comment")).to.have.length(1);
      expect(selectContaining(rooted, caretAt(3, 0), "comment")).to.deep.equal([]);
    });
  });
});
