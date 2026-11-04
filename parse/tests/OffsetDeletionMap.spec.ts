import { expect } from "chai";
import * as fc from "fast-check";
import {
  applyDeletions,
  filteredOffsetToOriginal,
  filteredRangeToOriginal,
  joinRangesAcrossBlanks,
  lineColumnToOffset,
  lineStartOffsets,
  mergeOffsetRanges,
  originalRangeToFiltered,
  OffsetRange,
} from "../Visitors/OffsetDeletionMap";

describe("OffsetDeletionMap", () => {
  describe("mergeOffsetRanges", () => {
    it("sorts the ranges, drops the empty ones, and joins the ones that overlap or touch", () => {
      const merged = mergeOffsetRanges([
        { start: 10, end: 14 },
        { start: 2, end: 5 },
        { start: 5, end: 7 },
        { start: 12, end: 20 },
        { start: 30, end: 30 },
      ]);
      expect(merged).to.deep.equal([
        { start: 2, end: 7 },
        { start: 10, end: 20 },
      ]);
    });

    it("does not change the ranges that it receives", () => {
      const input: OffsetRange[] = [{ start: 1, end: 3 }];
      mergeOffsetRanges(input);
      expect(input).to.deep.equal([{ start: 1, end: 3 }]);
    });
  });

  describe("applyDeletions", () => {
    it("cuts the ranges out of the text", () => {
      expect(
        applyDeletions("0123456789", [
          { start: 2, end: 4 },
          { start: 7, end: 10 },
        ])
      ).to.equal("01456");
    });

    it("returns the text as it is when nothing is deleted", () => {
      expect(applyDeletions("abc", [])).to.equal("abc");
    });
  });

  describe("lineStartOffsets and lineColumnToOffset", () => {
    it("gives the offset at which each line starts, and the offset of a column in a line", () => {
      const starts = lineStartOffsets("ab\ncde\n\nf");
      expect(starts).to.deep.equal([0, 3, 7, 8]);
      expect(lineColumnToOffset(starts, 1, 2)).to.equal(5);
      expect(lineColumnToOffset(starts, 3, 0)).to.equal(8);
    });
  });

  describe("joinRangesAcrossBlanks", () => {
    it("joins ranges that only spaces or tabs separate, and keeps apart the ones with other text or a newline between them", () => {
      const text = "ab  cd\tef\ngh";
      const joined = joinRangesAcrossBlanks(text, [
        { start: 0, end: 2 },
        { start: 4, end: 6 },
        { start: 7, end: 9 },
        { start: 10, end: 12 },
      ]);
      expect(joined).to.deep.equal([
        { start: 0, end: 9 },
        { start: 10, end: 12 },
      ]);
    });
  });

  describe("conversions, on the text 0123456789 with 2-3 and 6-8 deleted", () => {
    const deletions = [
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ];
    // the filtered text is 01 45 89, which is "014589"

    it("converts a filtered offset to the offset of the same character in the original text", () => {
      expect([0, 1, 2, 3, 4, 5].map((i) => filteredOffsetToOriginal(i, deletions))).to.deep.equal([0, 1, 4, 5, 8, 9]);
    });

    it("converts a filtered range without swallowing the deletion that follows it", () => {
      // the filtered range 1-2 holds the characters 1 and the 4 that comes after the deletion
      expect(filteredRangeToOriginal(0, 2, deletions)).to.deep.equal({ start: 0, end: 2 });
      expect(filteredRangeToOriginal(1, 3, deletions)).to.deep.equal({ start: 1, end: 5 });
    });

    it("converts an empty filtered range to an empty range", () => {
      expect(filteredRangeToOriginal(2, 2, deletions)).to.deep.equal({ start: 4, end: 4 });
    });

    it("converts an original range to the filtered text", () => {
      expect(originalRangeToFiltered(0, 2, deletions)).to.deep.equal({ start: 0, end: 2 });
      expect(originalRangeToFiltered(4, 6, deletions)).to.deep.equal({ start: 2, end: 4 });
    });

    it("keeps the visible part of an original range that is partly deleted", () => {
      // 1 is visible, 2 and 3 are deleted, 4 is visible
      expect(originalRangeToFiltered(1, 5, deletions)).to.deep.equal({ start: 1, end: 3 });
    });

    it("returns null for an original range that lies inside a deletion", () => {
      expect(originalRangeToFiltered(2, 4, deletions)).to.equal(null);
      expect(originalRangeToFiltered(3, 4, deletions)).to.equal(null);
    });

    it("returns null for a cursor inside a deletion, and a position for a cursor at its edge", () => {
      expect(originalRangeToFiltered(3, 3, deletions)).to.equal(null);
      expect(originalRangeToFiltered(2, 2, deletions)).to.deep.equal({ start: 2, end: 2 });
      expect(originalRangeToFiltered(4, 4, deletions)).to.deep.equal({ start: 2, end: 2 });
    });
  });

  describe("properties, on any text and any deletions", () => {
    const textAndDeletions = fc
      .tuple(fc.string({ minLength: 0, maxLength: 60 }), fc.array(fc.tuple(fc.nat({ max: 60 }), fc.nat({ max: 12 })), { maxLength: 8 }))
      .map(([text, raw]) => {
        const ranges = raw.map(([start, length]) => ({ start: Math.min(start, text.length), end: Math.min(start + length, text.length) }));
        return { text, deletions: mergeOffsetRanges(ranges) };
      });

    it("property: every character of the filtered text is the character that its converted offset points at in the original text", () => {
      fc.assert(
        fc.property(textAndDeletions, ({ text, deletions }) => {
          const filtered = applyDeletions(text, deletions);
          for (let i = 0; i < filtered.length; i++) {
            if (text[filteredOffsetToOriginal(i, deletions)] !== filtered[i]) return false;
          }
          return true;
        })
      );
    });

    it("property: the conversion of filtered offsets is strictly increasing", () => {
      fc.assert(
        fc.property(textAndDeletions, ({ text, deletions }) => {
          const filtered = applyDeletions(text, deletions);
          for (let i = 1; i < filtered.length; i++) {
            if (filteredOffsetToOriginal(i, deletions) <= filteredOffsetToOriginal(i - 1, deletions)) return false;
          }
          return true;
        })
      );
    });

    it("property: a deleted character has no filtered position, and a kept character has one that points back at it", () => {
      fc.assert(
        fc.property(textAndDeletions, ({ text, deletions }) => {
          const filtered = applyDeletions(text, deletions);
          for (let o = 0; o < text.length; o++) {
            const mapped = originalRangeToFiltered(o, o + 1, deletions);
            const isDeleted = deletions.some((d) => d.start <= o && o < d.end);
            if (isDeleted) {
              if (mapped !== null) return false;
            } else {
              if (mapped === null || mapped.end !== mapped.start + 1) return false;
              if (filtered[mapped.start] !== text[o]) return false;
              if (filteredOffsetToOriginal(mapped.start, deletions) !== o) return false;
            }
          }
          return true;
        })
      );
    });

    it("property: a filtered range converts to an original range that starts and ends on the same characters", () => {
      fc.assert(
        fc.property(textAndDeletions, fc.nat({ max: 60 }), fc.nat({ max: 60 }), ({ text, deletions }, a, b) => {
          const filtered = applyDeletions(text, deletions);
          const start = Math.min(a, b, filtered.length);
          const end = Math.min(Math.max(a, b), filtered.length);
          if (end <= start) return true;
          const original = filteredRangeToOriginal(start, end, deletions);
          return text[original.start] === filtered[start] && text[original.end - 1] === filtered[end - 1];
        })
      );
    });
  });
});
