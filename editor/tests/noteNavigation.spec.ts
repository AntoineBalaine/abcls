import { Range } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import {
  collectChordRanges,
  collectElementRanges,
  moveSelectionsToElement,
  collectNoteRanges,
  findAdjacentRange,
  moveSelectionsToChord,
  moveSelectionsToNote,
} from "../src/selectors/noteNavigation";
import { toCSTree } from "./helpers";

function caret(line: number, character: number): Range {
  return { start: { line, character }, end: { line, character } };
}

function range(line: number, start: number, end: number): Range {
  return { start: { line, character: start }, end: { line, character: end } };
}

// The body is on line 2. The characters are: C at 0, D at 2, [ at 4, E at 5, G at 6, ] at 7, F at 9.
const SOURCE = "X:1\nK:C\nC D [EG] F |\n";

describe("noteNavigation", () => {
  describe("collectNoteRanges", () => {
    it("lists every note in the order of the document, the notes of a chord included", () => {
      const ranges = collectNoteRanges(toCSTree(SOURCE));
      expect(ranges).to.deep.equal([range(2, 0, 1), range(2, 2, 3), range(2, 5, 6), range(2, 6, 7), range(2, 9, 10)]);
    });
  });

  describe("moveSelectionsToElement", () => {
    // Line 2: C at 0, [ at 2, D at 3, F at 4, ] at 5, z at 7, E at 9.
    const rooted = toCSTree("X:1\nK:C\nC [DF] z E |\n");

    it("lists the chords, the lone notes and the rests, and leaves the notes of a chord out", () => {
      expect(collectElementRanges(rooted)).to.deep.equal([range(2, 0, 1), range(2, 2, 6), range(2, 7, 8), range(2, 9, 10)]);
    });

    it("moves from a note to the chord, from the chord to the rest, and from the rest to the next note", () => {
      expect(moveSelectionsToElement(rooted, [caret(2, 0)], "next")).to.deep.equal([range(2, 2, 6)]);
      expect(moveSelectionsToElement(rooted, [range(2, 2, 6)], "next")).to.deep.equal([range(2, 7, 8)]);
      expect(moveSelectionsToElement(rooted, [range(2, 7, 8)], "next")).to.deep.equal([range(2, 9, 10)]);
    });

    it("moves backward over the same elements, and several steps with a count", () => {
      expect(moveSelectionsToElement(rooted, [range(2, 9, 10)], "previous")).to.deep.equal([range(2, 7, 8)]);
      expect(moveSelectionsToElement(rooted, [caret(2, 9)], "previous", 3)).to.deep.equal([range(2, 0, 1)]);
    });

    it("moves from a caret inside a chord to the element that follows the chord", () => {
      expect(moveSelectionsToElement(rooted, [caret(2, 4)], "next")).to.deep.equal([range(2, 7, 8)]);
    });
  });

  describe("moveSelectionsToChord", () => {
    const rooted = toCSTree("X:1\nK:C\n[CE] D [FA] [GB] |\n");

    it("lists the chords in the order of the document", () => {
      expect(collectChordRanges(rooted)).to.deep.equal([range(2, 0, 4), range(2, 7, 11), range(2, 12, 16)]);
    });

    it("moves a caret to the next chord, skipping the notes outside of chords", () => {
      expect(moveSelectionsToChord(rooted, [caret(2, 5)], "next")).to.deep.equal([range(2, 7, 11)]);
    });

    it("moves a caret to the previous chord", () => {
      expect(moveSelectionsToChord(rooted, [caret(2, 5)], "previous")).to.deep.equal([range(2, 0, 4)]);
    });

    it("moves several chords when it is given a count, and stops at the last chord", () => {
      expect(moveSelectionsToChord(rooted, [caret(2, 0)], "next", 2)).to.deep.equal([range(2, 12, 16)]);
      expect(moveSelectionsToChord(rooted, [caret(2, 0)], "next", 9)).to.deep.equal([range(2, 12, 16)]);
    });
  });

  describe("moveSelectionsToNote", () => {
    const root = toCSTree(SOURCE);

    it("moves a caret on a note to the next note, and not to the note under the caret", () => {
      expect(moveSelectionsToNote(root, [caret(2, 0)], "next")).to.deep.equal([range(2, 2, 3)]);
    });

    it("moves a caret inside a note to the next note", () => {
      const rooted = toCSTree("X:1\nK:C\nC2 D |\n");
      expect(moveSelectionsToNote(rooted, [caret(2, 1)], "next")).to.deep.equal([range(2, 3, 4)]);
    });

    it("moves from a selected note to the note that follows it, going into a chord", () => {
      expect(moveSelectionsToNote(root, [range(2, 2, 3)], "next")).to.deep.equal([range(2, 5, 6)]);
    });

    it("moves a caret to the previous note", () => {
      expect(moveSelectionsToNote(root, [caret(2, 9)], "previous")).to.deep.equal([range(2, 6, 7)]);
    });

    it("moves from a selected note to the note before it", () => {
      expect(moveSelectionsToNote(root, [range(2, 2, 3)], "previous")).to.deep.equal([range(2, 0, 1)]);
    });

    it("leaves a selection where it is when no note lies in that direction", () => {
      expect(moveSelectionsToNote(root, [caret(2, 0)], "previous")).to.deep.equal([caret(2, 0)]);
      expect(moveSelectionsToNote(root, [range(2, 9, 10)], "next")).to.deep.equal([range(2, 9, 10)]);
    });

    it("merges two selections that reach the same note, and keeps the order of the document", () => {
      expect(moveSelectionsToNote(root, [caret(2, 2), caret(2, 0)], "next")).to.deep.equal([range(2, 2, 3), range(2, 5, 6)]);
      expect(moveSelectionsToNote(root, [caret(2, 0), caret(2, 1)], "next")).to.deep.equal([range(2, 2, 3)]);
    });

    it("moves several notes with a number of steps, and stops at the last note", () => {
      expect(moveSelectionsToNote(root, [caret(2, 0)], "next", 3)).to.deep.equal([range(2, 6, 7)]);
      expect(moveSelectionsToNote(root, [caret(2, 0)], "next", 99)).to.deep.equal([range(2, 9, 10)]);
      expect(moveSelectionsToNote(root, [caret(2, 9)], "previous", 2)).to.deep.equal([range(2, 5, 6)]);
      expect(moveSelectionsToNote(root, [caret(2, 9)], "previous", 99)).to.deep.equal([range(2, 0, 1)]);
    });

    it("crosses a line", () => {
      const rooted = toCSTree("X:1\nK:C\nC D |\nE F |\n");
      expect(moveSelectionsToNote(rooted, [range(2, 2, 3)], "next")).to.deep.equal([range(3, 0, 1)]);
    });
  });

  describe("findAdjacentRange", () => {
    it("returns null with no candidates", () => {
      expect(findAdjacentRange([], caret(0, 0), "next")).to.equal(null);
      expect(findAdjacentRange([], caret(0, 0), "previous")).to.equal(null);
    });
  });

  describe("property-based tests", () => {
    const letters = fc.array(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), { minLength: 2, maxLength: 10 });

    it("goes back to the same note after moving to the next note and then to the previous one", () => {
      fc.assert(
        fc.property(letters, fc.nat(), (notes, pick) => {
          const index = pick % (notes.length - 1);
          const rooted = toCSTree(`X:1\nK:C\n${notes.join(" ")} |\n`);
          const ranges = collectNoteRanges(rooted);
          const forward = moveSelectionsToNote(rooted, [ranges[index]], "next");
          const back = moveSelectionsToNote(rooted, forward, "previous");
          return (
            forward.length === 1 &&
            JSON.stringify(forward[0]) === JSON.stringify(ranges[index + 1]) &&
            JSON.stringify(back[0]) === JSON.stringify(ranges[index])
          );
        })
      );
    });

    it("moving n steps at once reaches the same note as n single steps", () => {
      fc.assert(
        fc.property(letters, fc.nat({ max: 12 }), fc.constantFrom("next" as const, "previous" as const), (notes, steps, direction) => {
          const rooted = toCSTree(`X:1\nK:C\n${notes.join(" ")} |\n`);
          const start = [direction === "next" ? caret(2, 0) : caret(2, notes.length * 2 - 2)];
          let single = start;
          for (let step = 0; step < steps; step++) single = moveSelectionsToNote(rooted, single, direction);
          return JSON.stringify(moveSelectionsToNote(rooted, start, direction, steps)) === JSON.stringify(single);
        })
      );
    });

    it("never returns more ranges than selections, and always at least one", () => {
      fc.assert(
        fc.property(
          letters,
          fc.array(fc.nat({ max: 30 }), { minLength: 1, maxLength: 5 }),
          fc.constantFrom("next" as const, "previous" as const),
          (notes, characters, direction) => {
            const rooted = toCSTree(`X:1\nK:C\n${notes.join(" ")} |\n`);
            const result = moveSelectionsToNote(
              rooted,
              characters.map((character) => caret(2, character)),
              direction
            );
            return result.length >= 1 && result.length <= characters.length;
          }
        )
      );
    });
  });
});
