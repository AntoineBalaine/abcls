import { addRational, createRational, IRational } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { consolidateRests, isSingleRestDuration, partitionRestRun } from "../src/transforms/consolidateRests";
import { getNodeRhythm } from "../src/transforms/rhythm";
import { toCSTreeWithContext, formatSelection, findByTag } from "./helpers";

/** Runs the deep mode on every rest of the body, and gives the formatted text. */
function deepConsolidate(body: string): string {
  const { root, ctx } = toCSTreeWithContext(`X:1\nL:1/8\nM:3/4\nK:C\n${body}\n`);
  const rests = findByTag(root, TAGS.Rest);
  const selection: Selection = { root, cursors: [new Set(rests.map((r) => r.id))] };
  consolidateRests(selection, ctx, { dotted: true });
  return formatSelection(selection);
}

/** Lists the rest tokens of a text, such as ["z6", "z"], in order. */
function restsOf(text: string): string[] {
  return text.match(/[zx][0-9/]*/g) ?? [];
}

function total(root: ReturnType<typeof toCSTreeWithContext>["root"]): IRational {
  let sum = createRational(0, 1);
  for (const rest of findByTag(root, TAGS.Rest)) {
    sum = addRational(sum, getNodeRhythm(rest));
  }
  return sum;
}

const rational = (n: number): IRational => createRational(n, 1);

describe("consolidateRests, deep mode", () => {
  describe("isSingleRestDuration", () => {
    it("accepts the powers of two and their dotted values, and refuses what needs a tie", () => {
      for (const ok of [1, 2, 3, 4, 6, 7, 8, 12, 14, 16]) expect(isSingleRestDuration(rational(ok)), String(ok)).to.equal(true);
      for (const bad of [5, 9, 10, 11, 13, 15]) expect(isSingleRestDuration(rational(bad)), String(bad)).to.equal(false);
      expect(isSingleRestDuration(createRational(3, 2))).to.equal(true);
      expect(isSingleRestDuration(createRational(5, 2))).to.equal(false);
      expect(isSingleRestDuration(createRational(1, 3))).to.equal(false);
    });
  });

  describe("example-based tests", () => {
    it("joins a half and a quarter into a dotted half: z4 z2 -> z6", () => {
      expect(restsOf(deepConsolidate('[V:2] "e" z4 z2 |'))).to.deep.equal(["z6"]);
    });

    it("joins the three rests of a bar: z2 z3 z -> z6", () => {
      expect(restsOf(deepConsolidate('[V:2] "e" z2 z3 z |'))).to.deep.equal(["z6"]);
    });

    it("joins in any order: z3 z2 z -> z6", () => {
      expect(restsOf(deepConsolidate("[V:2] z3 z2 z |"))).to.deep.equal(["z6"]);
    });

    it("joins every bar of a line on its own", () => {
      const formatted = deepConsolidate('[V:2] "e" z2 z3 z | "b/d#" z4 z2 | "c#m" z2 z3 z | "g#m" z4 z2 |');
      expect(restsOf(formatted)).to.deep.equal(["z6", "z6", "z6", "z6"]);
    });

    it("does not create a rest that cannot be written as one: z3 z2 stays", () => {
      expect(restsOf(deepConsolidate("[V:2] z3 z2 |"))).to.deep.equal(["z3", "z2"]);
    });

    it("keeps the fewest rests when the whole run cannot be one: five units become z4 z", () => {
      expect(restsOf(deepConsolidate("[V:2] z z z z z |"))).to.deep.equal(["z4", "z"]);
    });

    it("joins equal rests into a power of two as before: z2 z2 z2 z2 -> z8", () => {
      expect(restsOf(deepConsolidate("[V:2] z2 z2 z2 z2 |"))).to.deep.equal(["z8"]);
    });

    it("does not join across a bar line", () => {
      expect(restsOf(deepConsolidate("[V:2] z4 | z2 |"))).to.deep.equal(["z4", "z2"]);
    });

    it("does not join across a chord symbol, which marks a new harmony", () => {
      expect(restsOf(deepConsolidate('[V:2] "e" z4 "b" z2 |'))).to.deep.equal(["z4", "z2"]);
    });

    it("does not join a visible rest with an invisible one", () => {
      expect(restsOf(deepConsolidate("[V:2] z4 x2 |"))).to.deep.equal(["z4", "x2"]);
    });

    it("does not join across a note", () => {
      expect(restsOf(deepConsolidate("[V:2] z2 C z2 |"))).to.deep.equal(["z2", "z2"]);
    });
  });

  describe("property-based tests", () => {
    const durations = fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 8 });

    it("property: the groups cover the whole run, and every group of several rests makes one rest", () => {
      fc.assert(
        fc.property(durations, (units) => {
          const lengths = partitionRestRun(units.map(rational));
          expect(lengths.reduce((a, b) => a + b, 0)).to.equal(units.length);
          let position = 0;
          for (const length of lengths) {
            const sum = units.slice(position, position + length).reduce((a, b) => a + b, 0);
            if (length > 1) expect(isSingleRestDuration(rational(sum))).to.equal(true);
            position += length;
          }
        })
      );
    });

    it("property: no split has fewer groups than the one that is chosen", () => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 7 }), (units) => {
          const chosen = partitionRestRun(units.map(rational)).length;
          // every way of cutting the run in groups is a choice of cut points between the rests
          for (let mask = 0; mask < 1 << (units.length - 1); mask++) {
            const sums: number[] = [];
            let current = units[0];
            for (let i = 1; i < units.length; i++) {
              if ((mask >> (i - 1)) & 1) {
                sums.push(current);
                current = units[i];
              } else {
                current += units[i];
              }
            }
            sums.push(current);
            // a group is allowed when it is alone or makes one rest, so we check the sizes through the sums
            let position = 0;
            let allowed = true;
            for (let g = 0; g < sums.length; g++) {
              let size = 0;
              let acc = 0;
              while (acc < sums[g]) acc += units[position + size++];
              if (size > 1 && !isSingleRestDuration(rational(sums[g]))) allowed = false;
              position += size;
            }
            if (allowed) expect(sums.length).to.be.at.least(chosen);
          }
        }),
        { numRuns: 50 }
      );
    });

    it("property: the total duration is preserved, the count never grows, and a second pass changes nothing", () => {
      fc.assert(
        fc.property(durations, (units) => {
          const source = "X:1\nL:1/8\nK:C\n" + units.map((u) => `z${u === 1 ? "" : u}`).join(" ") + " |\n";
          const { root, ctx } = toCSTreeWithContext(source);
          const before = total(root);
          const countBefore = findByTag(root, TAGS.Rest).length;
          const selection: Selection = { root, cursors: [new Set(findByTag(root, TAGS.Rest).map((r) => r.id))] };
          consolidateRests(selection, ctx, { dotted: true });
          const after = total(root);
          expect(after.numerator * before.denominator).to.equal(before.numerator * after.denominator);
          expect(findByTag(root, TAGS.Rest).length).to.be.at.most(countBefore);

          const once = formatSelection(selection);
          const second = toCSTreeWithContext(once);
          const secondSelection: Selection = { root: second.root, cursors: [new Set(findByTag(second.root, TAGS.Rest).map((r) => r.id))] };
          consolidateRests(secondSelection, second.ctx, { dotted: true });
          expect(formatSelection(secondSelection)).to.equal(once);
        }),
        { numRuns: 100 }
      );
    });
  });
});
