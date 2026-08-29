import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { divideRhythm } from "../src/transforms/divideRhythm";
import { multiplyRhythm } from "../src/transforms/multiplyRhythm";
import { getNodeRhythm } from "../src/transforms/rhythm";
import { toCSTreeWithContext, formatSelection, findByTag, genAbcTune } from "./helpers";

describe("multiplyRhythm", () => {
  describe("example-based", () => {
    const cases: [string, string, string][] = [
      ["a", "a2", "default (1) multiplied by 2 becomes 2"],
      ["a2", "a4", "2 multiplied by 2 becomes 4"],
      ["a/", "a", "1/2 multiplied by 2 becomes 1"],
      ["a/2", "a", "1/2 multiplied by 2 becomes 1"],
      ["a//", "a/", "1/4 multiplied by 2 becomes 1/2"],
      ["a/4", "a/", "1/4 multiplied by 2 becomes 1/2"],
      ["a///", "a/4", "1/8 multiplied by 2 becomes 1/4"],
    ];

    cases.forEach(([input, expected, description]) => {
      it(`${input} -> ${expected}: ${description}`, () => {
        const { root, ctx } = toCSTreeWithContext(`X:1\nK:C\n${input}|\n`);
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        multiplyRhythm(sel, 2, ctx);
        const formatted = formatSelection(sel);
        expect(formatted).to.contain(expected);
      });
    });

    it("preserves broken rhythm token (>)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\na>b|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      multiplyRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("a2>");
    });

    it("works on chords", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG]/|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      multiplyRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CEG]|");
    });

    it("works on rests", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nz/|\n");
      const rests = findByTag(root, TAGS.Rest);
      const sel: Selection = { root, cursors: [new Set([rests[0].id])] };
      multiplyRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("z|");
    });

    it("works on y-spacers", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\ny/|\n");
      const ySpacers = findByTag(root, TAGS.YSPACER);
      const sel: Selection = { root, cursors: [new Set([ySpacers[0].id])] };
      multiplyRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("y|");
    });

    it("does not double the notes inside a selected chord", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      multiplyRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      // Only the chord as a whole should carry the rhythm; the inner notes must stay bare.
      expect(formatted).to.contain("[CEG]2");
    });

    it("multiplies multiple selected notes", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\na/ b/ c/|\n");
      const notes = findByTag(root, TAGS.Note);
      const ids = new Set(notes.map((n) => n.id));
      const sel: Selection = { root, cursors: [ids] };
      multiplyRhythm(sel, 2, ctx);
      for (const note of notes) {
        const r = getNodeRhythm(note);
        expect(r.numerator).to.equal(1);
        expect(r.denominator).to.equal(1);
      }
    });

    it("supports custom factor (4)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\na|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      multiplyRhythm(sel, 4, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("a4");
    });
  });

  describe("property-based", () => {
    it("multiply then divide returns to original rhythm", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root: root1, ctx: ctx1 } = toCSTreeWithContext(source);
          const notes1 = findByTag(root1, TAGS.Note);
          if (notes1.length === 0) return;

          // Record original rhythms
          const originalRhythms = notes1.map((n) => getNodeRhythm(n));

          // Multiply by 2
          const ids1 = new Set(notes1.map((n) => n.id));
          const sel1: Selection = { root: root1, cursors: [ids1] };
          multiplyRhythm(sel1, 2, ctx1);

          divideRhythm(sel1, 2, ctx1);

          // Check that we got back to original
          for (let i = 0; i < notes1.length; i++) {
            const r = getNodeRhythm(notes1[i]);
            expect(r.numerator).to.equal(originalRhythms[i].numerator);
            expect(r.denominator).to.equal(originalRhythms[i].denominator);
          }
        }),
        { numRuns: 500 }
      );
    });

    it("multiplying by 2 doubles the numeric rhythm value", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Record original rhythms as numeric values
          const originalValues = notes.map((n) => {
            const r = getNodeRhythm(n);
            return r.numerator / r.denominator;
          });

          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          multiplyRhythm(sel, 2, ctx);

          // Check each note's rhythm was doubled
          for (let i = 0; i < notes.length; i++) {
            const r = getNodeRhythm(notes[i]);
            const newValue = r.numerator / r.denominator;
            expect(newValue).to.be.closeTo(originalValues[i] * 2, 0.0001);
          }
        }),
        { numRuns: 500 }
      );
    });
  });
});
