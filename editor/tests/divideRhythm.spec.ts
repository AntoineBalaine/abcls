import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { divideRhythm } from "../src/transforms/divideRhythm";
import { multiplyRhythm } from "../src/transforms/multiplyRhythm";
import { getNodeRhythm } from "../src/transforms/rhythm";
import { toCSTreeWithContext, formatSelection, findByTag, genAbcTune } from "./helpers";

describe("divideRhythm", () => {
  describe("example-based", () => {
    const cases: [string, string, string][] = [
      ["a,2", "a,", "2 divided by 2 becomes 1 (with octave marker)"],
      ["a4", "a2", "4 divided by 2 becomes 2"],
      ["a/", "a/4", "1/2 divided by 2 becomes 1/4"],
      ["a/2", "a/4", "1/2 divided by 2 becomes 1/4"],
      ["a//", "a/8", "1/4 divided by 2 becomes 1/8"],
      ["a", "a/", "1 divided by 2 becomes 1/2"],
      ["^a''", "^a''/", "1 divided by 2 becomes 1/2 (with sharp and octave marks)"],
    ];

    cases.forEach(([input, expected, description]) => {
      it(`${input} -> ${expected}: ${description}`, () => {
        const { root, ctx } = toCSTreeWithContext(`X:1\nK:C\n${input}|\n`);
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        divideRhythm(sel, 2, ctx);
        const formatted = formatSelection(sel);
        expect(formatted).to.contain(expected);
      });
    });

    it("preserves broken rhythm token (<)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\na2<b|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      divideRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("a<");
    });

    it("works on chords", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG]4|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      divideRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CEG]2");
    });

    it("works on rests", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nz2|\n");
      const rests = findByTag(root, TAGS.Rest);
      const sel: Selection = { root, cursors: [new Set([rests[0].id])] };
      divideRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("z|");
    });

    it("works on y-spacers", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\ny2|\n");
      const ySpacers = findByTag(root, TAGS.YSPACER);
      const sel: Selection = { root, cursors: [new Set([ySpacers[0].id])] };
      divideRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("y|");
    });

    it("does not halve the notes inside a selected chord", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG]4|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      divideRhythm(sel, 2, ctx);
      const formatted = formatSelection(sel);
      // Only the chord as a whole should carry the rhythm; the inner notes must stay bare.
      expect(formatted).to.contain("[CEG]2");
    });

    it("divides multiple selected notes", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\na2 b2 c2|\n");
      const notes = findByTag(root, TAGS.Note);
      const ids = new Set(notes.map((n) => n.id));
      const sel: Selection = { root, cursors: [ids] };
      divideRhythm(sel, 2, ctx);
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
      divideRhythm(sel, 4, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("a/4");
    });
  });

  describe("property-based", () => {
    it("divide then multiply returns to original rhythm", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Record original rhythms
          const originalRhythms = notes.map((n) => getNodeRhythm(n));

          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };

          // Divide by 2
          divideRhythm(sel, 2, ctx);

          // Multiply by 2
          multiplyRhythm(sel, 2, ctx);

          // Check that we got back to original
          for (let i = 0; i < notes.length; i++) {
            const r = getNodeRhythm(notes[i]);
            expect(r.numerator).to.equal(originalRhythms[i].numerator);
            expect(r.denominator).to.equal(originalRhythms[i].denominator);
          }
        }),
        { numRuns: 500 }
      );
    });

    it("dividing by 2 halves the numeric rhythm value", () => {
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
          divideRhythm(sel, 2, ctx);

          // Check each note's rhythm was halved
          for (let i = 0; i < notes.length; i++) {
            const r = getNodeRhythm(notes[i]);
            const newValue = r.numerator / r.denominator;
            expect(newValue).to.be.closeTo(originalValues[i] / 2, 0.0001);
          }
        }),
        { numRuns: 500 }
      );
    });
  });
});
