import { expect } from "chai";
import * as fc from "fast-check";
import { BeamItem, beamJoins, groupStarts } from "./beaming";

const r = (numerator: number, denominator: number) => ({ numerator, denominator });

/** Builds the items of a bar of notes of one length, starting at 0. */
function notes(count: number, length: number): BeamItem[] {
  return Array.from({ length: count }, (_, i) => ({ start: i * length, end: (i + 1) * length, isNoteLike: true }));
}

/** Shows the joins as a string, such as "ab cd", with a space where a beam is not continued. */
function shape(joins: boolean[]): string {
  return joins.map((join, i) => (i === 0 ? "n" : join ? "n" : " n")).join("");
}

describe("beaming", () => {
  describe("groupStarts", () => {
    it("groups 4/4 by quarter notes, and 3/4 and 2/4 as well", () => {
      expect(groupStarts(r(4, 4))).to.deep.equal([0.25, 0.5, 0.75]);
      expect(groupStarts(r(3, 4))).to.deep.equal([0.25, 0.5]);
      expect(groupStarts(r(2, 4))).to.deep.equal([0.25]);
    });

    it("groups 6/8, 9/8 and 12/8 by dotted quarter notes", () => {
      expect(groupStarts(r(6, 8))).to.deep.equal([0.375]);
      expect(groupStarts(r(9, 8))).to.deep.equal([0.375, 0.75]);
      expect(groupStarts(r(12, 8))).to.deep.equal([0.375, 0.75, 1.125]);
    });

    it("keeps 3/8 in one group, and groups 5/8 as 3+2 and 7/8 as 2+2+3", () => {
      expect(groupStarts(r(3, 8))).to.deep.equal([]);
      expect(groupStarts(r(5, 8))).to.deep.equal([0.375]);
      expect(groupStarts(r(7, 8))).to.deep.equal([0.25, 0.5]);
    });

    it("uses the groups that the meter gives, so that 5/8 (2/8+3/8) differs from the default 3+2", () => {
      expect(groupStarts(r(5, 8), [r(2, 8), r(3, 8)])).to.deep.equal([0.25]);
    });

    it("tells 6/8 (3/8+3/8) from 6/8 (2/8+2/8+2/8)", () => {
      expect(groupStarts(r(6, 8), [r(3, 8), r(3, 8)])).to.deep.equal([0.375]);
      expect(groupStarts(r(6, 8), [r(2, 8), r(2, 8), r(2, 8)])).to.deep.equal([0.25, 0.5]);
    });

    it("groups 2/2 by half notes", () => {
      expect(groupStarts(r(2, 2))).to.deep.equal([0.5]);
    });
  });

  describe("beamJoins", () => {
    it("beams eight eighth notes of 4/4 in four pairs", () => {
      expect(shape(beamJoins(notes(8, 1 / 8), groupStarts(r(4, 4))))).to.equal("nn nn nn nn");
    });

    it("beams six eighth notes of 6/8 in two groups of three", () => {
      expect(shape(beamJoins(notes(6, 1 / 8), groupStarts(r(6, 8))))).to.equal("nnn nnn");
    });

    it("beams six eighth notes of 6/8 (2/8+2/8+2/8) in three pairs", () => {
      expect(shape(beamJoins(notes(6, 1 / 8), groupStarts(r(6, 8), [r(2, 8), r(2, 8), r(2, 8)])))).to.equal("nn nn nn");
    });

    it("beams five eighth notes of 5/8 (3/8+2/8) as three and two", () => {
      expect(shape(beamJoins(notes(5, 1 / 8), groupStarts(r(5, 8), [r(3, 8), r(2, 8)])))).to.equal("nnn nn");
    });

    it("does not beam quarter notes, and a quarter note ends a beam", () => {
      const items: BeamItem[] = [
        { start: 0, end: 1 / 8, isNoteLike: true },
        { start: 1 / 8, end: 1 / 4, isNoteLike: true },
        { start: 1 / 4, end: 1 / 2, isNoteLike: true },
        { start: 1 / 2, end: 5 / 8, isNoteLike: true },
        { start: 5 / 8, end: 3 / 4, isNoteLike: true },
      ];
      expect(shape(beamJoins(items, groupStarts(r(4, 4))))).to.equal("nn n nn");
    });

    it("breaks a beam at a rest", () => {
      const items: BeamItem[] = [
        { start: 0, end: 1 / 16, isNoteLike: true },
        { start: 1 / 16, end: 1 / 8, isNoteLike: false },
        { start: 1 / 8, end: 3 / 16, isNoteLike: true },
        { start: 3 / 16, end: 1 / 4, isNoteLike: true },
      ];
      expect(shape(beamJoins(items, groupStarts(r(4, 4))))).to.equal("n n nn");
    });

    it("beams a triplet of eighth notes inside one beat", () => {
      const third = 1 / 12;
      expect(shape(beamJoins(notes(3, third), groupStarts(r(4, 4))))).to.equal("nnn");
    });

    it("property: a beam never crosses a group boundary and never holds a note of a quarter or longer", () => {
      const length = fc.constantFrom(1 / 16, 1 / 8, 1 / 4, 3 / 16, 3 / 8);
      const meter = fc.constantFrom(r(4, 4), r(3, 4), r(6, 8), r(9, 8), r(5, 8), r(2, 2), r(3, 8));
      fc.assert(
        fc.property(fc.array(length, { minLength: 1, maxLength: 12 }), meter, (lengths, m) => {
          const items: BeamItem[] = [];
          let at = 0;
          for (const l of lengths) {
            items.push({ start: at, end: at + l, isNoteLike: true });
            at += l;
          }
          const starts = groupStarts(m);
          const joins = beamJoins(items, starts);
          return joins.every((join, i) => {
            if (!join) return true;
            const crosses = starts.some((s) => items[i - 1].start < s - 1e-9 && s <= items[i].start + 1e-9);
            const isLong = (item: BeamItem) => item.end - item.start >= 1 / 4 - 1e-9;
            return !crosses && !isLong(items[i]) && !isLong(items[i - 1]);
          });
        })
      );
    });
  });
});
