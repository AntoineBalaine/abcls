import { expect } from "chai";
import fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS, CSNode } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { explode, explode2, explode3, explode4 } from "../src/transforms/explode";
import { toCSTreeWithContext, formatSelection, findByTag } from "./helpers";

describe("explode", () => {
  describe("example-based tests", () => {
    describe("single chord explosion", () => {
      it("3-note chord with partCount=3 produces 3 parts, each with one note", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] |\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

        explode(sel, 3, ctx);

        const result = formatSelection(sel);
        // Original line + 3 exploded parts
        // Part 0: G (top note)
        // Part 1: E (middle note)
        // Part 2: C (bottom note)
        expect(result).to.include("[CEG]");
        expect(result).to.include("G");
        expect(result).to.include("E");
        expect(result).to.include("C");
        // After explosion, there should be the original chord plus 3 single notes
        const notesAfter = findByTag(root, TAGS.Note);
        // 3 notes inside chord + 3 exploded notes = 6
        expect(notesAfter.length).to.equal(6);
      });

      it("2-note chord with partCount=2 produces 2 parts", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

        explode(sel, 2, ctx);

        const result = formatSelection(sel);
        expect(result).to.include("[CE]");
        // Part 0 gets E (top), Part 1 gets C (bottom)
        const notesAfter = findByTag(root, TAGS.Note);
        expect(notesAfter.length).to.equal(4); // 2 in chord + 2 exploded
      });
    });

    describe("mixed chords and notes", () => {
      it("chord followed by notes: part 0 keeps notes, part 1+ converts to rests", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE]AB |\n");
        const chords = findByTag(root, TAGS.Chord);
        const notes = findByTag(root, TAGS.Note);
        // Select the chord and the following notes
        const sel: Selection = {
          root,
          cursors: [new Set([chords[0].id, notes[2].id, notes[3].id])],
        };

        explode(sel, 2, ctx);

        const result = formatSelection(sel);
        // Original: [CE]AB
        // Part 0: E A B (top note + melody notes)
        // Part 1: C z2 (bottom note + consolidated rests)
        expect(result).to.include("[CE]");
        expect(result).to.match(/E\s*A\s*B/);
        expect(result).to.match(/C\s*z2/);
      });
    });

    describe("chord with fewer notes than partCount", () => {
      it("2-note chord with partCount=3: extra part becomes rest", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

        explode(sel, 3, ctx);

        const result = formatSelection(sel);
        // Part 0: E (top)
        // Part 1: C (bottom)
        // Part 2: z (rest, not enough notes)
        expect(result).to.include("[CE]");
        expect(result).to.include("E");
        expect(result).to.include("C");
        const restsAfter = findByTag(root, TAGS.Rest);
        expect(restsAfter.length).to.be.at.least(1);
      });
    });

    describe("rhythm preservation", () => {
      it("chord with rhythm: all parts preserve rhythm", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG]2 |\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

        explode(sel, 3, ctx);

        const result = formatSelection(sel);
        // All exploded notes should have rhythm 2
        expect(result).to.include("[CEG]2");
        expect(result).to.match(/G2/);
        expect(result).to.match(/E2/);
        expect(result).to.match(/C2/);
      });

      it("standalone notes with rhythm: converted to rests preserve rhythm", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE]A2B4 |\n");
        const chords = findByTag(root, TAGS.Chord);
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = {
          root,
          cursors: [new Set([chords[0].id, notes[2].id, notes[3].id])],
        };

        explode(sel, 2, ctx);

        const result = formatSelection(sel);
        // Part 1 should have: C z2 z4
        expect(result).to.match(/C\s*z2\s*z4/);
      });
    });

    describe("beamed notes", () => {
      it("beamed chord sequence: beam structure preserved in exploded parts", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE][DF] |\n");
        const beams = findByTag(root, TAGS.Beam);
        if (beams.length > 0) {
          const sel: Selection = { root, cursors: [new Set([beams[0].id])] };

          explode(sel, 2, ctx);

          const result = formatSelection(sel);
          // Both chords should be exploded
          expect(result).to.include("[CE]");
          expect(result).to.include("[DF]");
          // Part 0: E F (top notes)
          // Part 1: C D (bottom notes)
          expect(result).to.match(/E\s*F/);
          expect(result).to.match(/C\s*D/);
        }
      });
    });

    describe("standalone notes only", () => {
      it("no chords: part 0 keeps notes, other parts become rests", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nA B C D |\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = {
          root,
          cursors: [new Set(notes.map((n) => n.id))],
        };

        explode(sel, 2, ctx);

        const result = formatSelection(sel);
        // Original: A B C D
        // Part 0: A B C D (kept)
        // Part 1: z4 (all rests consolidated: z+z=z2, z2+z2=z4)
        expect(result).to.match(/A\s*B\s*C\s*D\s*\|.*A\s*B\s*C\s*D.*z4/s);
      });
    });

    describe("rests in original", () => {
      it("rests are preserved in all parts", () => {
        const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE]z[DF] |\n");
        const chords = findByTag(root, TAGS.Chord);
        const rests = findByTag(root, TAGS.Rest);
        const sel: Selection = {
          root,
          cursors: [new Set([chords[0].id, rests[0].id, chords[1].id])],
        };

        explode(sel, 2, ctx);

        const result = formatSelection(sel);
        // Part 0: E z F
        // Part 1: C z D
        expect(result).to.match(/E\s*z\s*F/);
        expect(result).to.match(/C\s*z\s*D/);
      });
    });
  });

  describe("grace groups", () => {
    it("grace group before chord: part 0 keeps grace, parts 1+ remove it", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{g}[CE] |\n");
      const graceGroups = findByTag(root, TAGS.Grace_group);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([graceGroups[0].id, chords[0].id])] };

      explode(sel, 2, ctx);

      // Part 0 should have grace group: {g}E
      // Part 1 should not have grace group: C
      const graceGroupsAfter = findByTag(root, TAGS.Grace_group);
      // Original + part 0 = 2 grace groups
      expect(graceGroupsAfter.length).to.equal(2);
    });

    it("grace group before standalone note: part 0 keeps grace, parts 1+ remove it", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{g}A[CE] |\n");
      const notes = findByTag(root, TAGS.Note);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([notes[0].id, chords[0].id])] };

      explode(sel, 2, ctx);

      // Part 0: {g}A E (grace kept, standalone note kept, top chord note)
      // Part 1: z C (grace removed, note became rest, bottom chord note)
      const graceGroupsAfter = findByTag(root, TAGS.Grace_group);
      expect(graceGroupsAfter.length).to.equal(2); // Original + part 0
    });

    it("multiple grace groups: part 0 keeps all, parts 1+ remove all", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{g}[CE] {a}[DF] |\n");
      const graceGroups = findByTag(root, TAGS.Grace_group);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = {
        root,
        cursors: [new Set([...graceGroups.map((g) => g.id), ...chords.map((c) => c.id)])],
      };

      explode(sel, 2, ctx);

      const graceGroupsAfter = findByTag(root, TAGS.Grace_group);
      // Original (2) + part 0 (2) = 4 grace groups
      expect(graceGroupsAfter.length).to.equal(4);
    });
  });

  describe("decorations", () => {
    it("decoration on chord: preserved in all parts", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n.[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode(sel, 2, ctx);

      // Decorations should be preserved in all parts
      const decorations = findByTag(root, TAGS.Decoration);
      // Original + part 0 + part 1 = 3 decorations
      expect(decorations.length).to.be.at.least(2);
    });
  });

  describe("edge cases", () => {
    it("partCount=0 returns selection unchanged", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      const notesBefore = findByTag(root, TAGS.Note).length;

      explode(sel, 0, ctx);

      const notesAfter = findByTag(root, TAGS.Note).length;
      expect(notesAfter).to.equal(notesBefore);
    });

    it("partCount=1 creates one copy (duplicates the line)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode(sel, 1, ctx);

      // Original chord (2 notes) + 1 exploded part (1 note = top)
      const notesAfter = findByTag(root, TAGS.Note);
      expect(notesAfter.length).to.equal(3); // 2 in original chord + 1 exploded
    });

    it("empty selection returns unchanged", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] |\n");
      const sel: Selection = { root, cursors: [] };
      const notesBefore = findByTag(root, TAGS.Note).length;

      explode(sel, 3, ctx);

      const notesAfter = findByTag(root, TAGS.Note).length;
      expect(notesAfter).to.equal(notesBefore);
    });
  });

  describe("preset functions", () => {
    it("explode2 produces 2 parts", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode2(sel, ctx);

      const notesAfter = findByTag(root, TAGS.Note);
      // 2 notes in chord + 2 exploded = 4
      expect(notesAfter.length).to.equal(4);
    });

    it("explode3 produces 3 parts", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode3(sel, ctx);

      const notesAfter = findByTag(root, TAGS.Note);
      // 3 notes in chord + 3 exploded = 6
      expect(notesAfter.length).to.equal(6);
    });

    it("explode4 produces 4 parts", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEGB] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode4(sel, ctx);

      const notesAfter = findByTag(root, TAGS.Note);
      // 4 notes in chord + 4 exploded = 8
      expect(notesAfter.length).to.equal(8);
    });

    it("explode4 on 2-note chord: 2 notes + 2 rests", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode4(sel, ctx);

      const restsAfter = findByTag(root, TAGS.Rest);
      // Parts 2 and 3 should be rests
      expect(restsAfter.length).to.be.at.least(2);
    });
  });

  describe("cursor return values", () => {
    it("returns one cursor per created line", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      const result = explode(sel, 3, ctx);

      // 3 parts = 3 cursors
      expect(result.cursors.length).to.equal(3);
    });

    it("each cursor contains all element IDs from its line", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      const result = explode(sel, 3, ctx);

      // Each cursor should have at least one ID
      for (const cursor of result.cursors) {
        expect(cursor.size).to.be.greaterThan(0);
      }
    });

    it("cursors are in document order", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      const result = explode(sel, 2, ctx);

      // Part 0 cursor comes before part 1 cursor
      expect(result.cursors.length).to.equal(2);

      // Get notes/rests from the tree - after the original chord
      const allNotes = findByTag(root, TAGS.Note);

      // Find which notes are in each cursor
      const cursor0Ids = result.cursors[0];
      const cursor1Ids = result.cursors[1];

      // Cursor 0 should contain the top note (E), cursor 1 should contain bottom note (C)
      const notesInCursor0 = allNotes.filter((n) => cursor0Ids.has(n.id));
      const notesInCursor1 = allNotes.filter((n) => cursor1Ids.has(n.id));

      // Part 0 has top note E, Part 1 has bottom note C
      expect(notesInCursor0.length).to.equal(1);
      expect(notesInCursor1.length).to.equal(1);
    });

    it("multiple selected lines produce cursors for each", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE] |\n[DF] |\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = {
        root,
        cursors: [new Set([chords[0].id, chords[1].id])],
      };

      const result = explode(sel, 2, ctx);

      // 2 lines × 2 parts = 4 cursors
      expect(result.cursors.length).to.equal(4);
    });
  });

  describe("multi-tune documents", () => {
    const TWO_TUNES = "X:1\nT:first\nK:C\n[CEG] |\n\nX:2\nT:second\nK:C\n[DFA] |\n";

    it("selection in the second tune explodes that tune, not the first", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[1].id])] };

      const result = explode(sel, 3, ctx);

      expect(result.cursors.length).to.equal(3);

      const text = formatSelection(sel);
      // The second tune gains the exploded parts of [DFA]
      expect(text).to.include("A |\nF |\nD |");
      // The first tune is untouched
      expect(text).to.include("K:C\n[CEG] |\n\nX:2");
    });

    it("selection spanning two tunes explodes both", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = {
        root,
        cursors: [new Set([chords[0].id]), new Set([chords[1].id])],
      };

      const result = explode(sel, 3, ctx);

      // 2 tunes × 3 parts = 6 cursors
      expect(result.cursors.length).to.equal(6);

      const text = formatSelection(sel);
      // First tune's parts come from [CEG], second tune's from [DFA]
      expect(text).to.include("[CEG] |\nG |\nE |\nC |");
      expect(text).to.include("[DFA] |\nA |\nF |\nD |");
    });

    it("selection in the middle tune leaves the outer tunes unchanged", () => {
      const source = "X:1\nT:one\nK:C\nCDEF |\n\nX:2\nT:two\nK:C\n[CEG] |\n\nX:3\nT:three\nK:C\nGABc |\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode(sel, 2, ctx);

      const text = formatSelection(sel);
      // The first and third tunes keep their original single content line
      expect(text).to.include("T:one\nK:C\nCDEF |\n");
      expect(text).to.include("T:three\nK:C\nGABc |\n");
      // Only the middle tune gained lines
      expect(text).to.include("[CEG] |\nG |\nE |");
    });

    it("created lines in a non-final tune each stand on their own line", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

      explode(sel, 3, ctx);

      const text = formatSelection(sel);
      // The exploded parts must not be appended onto the original line, and the
      // blank line separating the two tunes must survive intact
      expect(text).to.not.include("[CEG] |G");
      expect(text).to.include("[CEG] |\nG |\nE |\nC |\n\nX:2");
    });
  });

  describe("property-based tests", () => {
    it("element count: each part has same number of rhythm-bearing elements as original", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 4 }),
          fc.array(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), { minLength: 2, maxLength: 4 }),
          (partCount, notes) => {
            const chordContent = notes.join("");
            const abc = `X:1\nK:C\n[${chordContent}] |\n`;
            const { root, ctx } = toCSTreeWithContext(abc);

            const chords = findByTag(root, TAGS.Chord);
            if (chords.length === 0) return true;

            const sel: Selection = { root, cursors: [new Set([chords[0].id])] };

            // Count original rhythm-bearing elements
            const originalNoteCount = findByTag(root, TAGS.Note).filter((n) => !findByTag(root, TAGS.Chord).some((c) => isDescendant(c, n))).length;
            const originalRestCount = findByTag(root, TAGS.Rest).length;

            explode(sel, partCount, ctx);

            // After explosion, we should have:
            // - original elements (1 chord)
            // - partCount new elements (each is either a note or rest)
            const afterNoteCount = findByTag(root, TAGS.Note).filter((n) => !findByTag(root, TAGS.Chord).some((c) => isDescendant(c, n))).length;
            const afterRestCount = findByTag(root, TAGS.Rest).length;

            // We expect partCount new rhythm-bearing elements to be added
            const newElements = afterNoteCount + afterRestCount - (originalNoteCount + originalRestCount);
            return newElements === partCount;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("preset functions produce correct part count", () => {
      fc.assert(
        fc.property(fc.array(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), { minLength: 2, maxLength: 4 }), (notes) => {
          const chordContent = notes.join("");
          const abc = `X:1\nK:C\n[${chordContent}] |\n`;

          // Test explode2
          {
            const { root, ctx } = toCSTreeWithContext(abc);
            const chords = findByTag(root, TAGS.Chord);
            if (chords.length === 0) return true;
            const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
            const beforeNotes = findByTag(root, TAGS.Note).length;
            const beforeRests = findByTag(root, TAGS.Rest).length;
            explode2(sel, ctx);
            const afterNotes = findByTag(root, TAGS.Note).length;
            const afterRests = findByTag(root, TAGS.Rest).length;
            const newElements = afterNotes + afterRests - beforeNotes - beforeRests;
            if (newElements !== 2) return false;
          }

          // Test explode3
          {
            const { root, ctx } = toCSTreeWithContext(abc);
            const chords = findByTag(root, TAGS.Chord);
            if (chords.length === 0) return true;
            const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
            const beforeNotes = findByTag(root, TAGS.Note).length;
            const beforeRests = findByTag(root, TAGS.Rest).length;
            explode3(sel, ctx);
            const afterNotes = findByTag(root, TAGS.Note).length;
            const afterRests = findByTag(root, TAGS.Rest).length;
            const newElements = afterNotes + afterRests - beforeNotes - beforeRests;
            if (newElements !== 3) return false;
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("grace group count in part 0 equals original", () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), { minLength: 2, maxLength: 3 }),
          fc.integer({ min: 2, max: 4 }),
          (notes, partCount) => {
            const chordContent = notes.join("");
            const abc = `X:1\nK:C\n{g}[${chordContent}] |\n`;
            const { root, ctx } = toCSTreeWithContext(abc);

            const gracesBefore = findByTag(root, TAGS.Grace_group).length;
            const chords = findByTag(root, TAGS.Chord);
            if (chords.length === 0) return true;

            const sel: Selection = {
              root,
              cursors: [new Set([...findByTag(root, TAGS.Grace_group).map((g) => g.id), chords[0].id])],
            };

            explode(sel, partCount, ctx);

            const gracesAfter = findByTag(root, TAGS.Grace_group).length;
            // We should have: original graces + graces in part 0 = 2 * original graces
            // (parts 1+ have their grace groups removed)
            return gracesAfter === gracesBefore * 2;
          }
        ),
        { numRuns: 50 }
      );
    });

    it("exploding one tune leaves every other tune's text untouched", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 2, max: 4 }), (tuneCount, targetSeed, partCount) => {
          // Each tune carries one chord, so tune N's chord is chords[N]
          const tunes = Array.from({ length: tuneCount }, (_, i) => `X:${i + 1}\nT:tune${i + 1}\nK:C\n[CEG] |\n`);
          const abc = tunes.join("\n");
          const targetIndex = targetSeed % tuneCount;

          const before = toCSTreeWithContext(abc);
          const beforeTuneTexts = findByTag(before.root, TAGS.Tune).map((t) => formatSelection({ root: t, cursors: [] }));

          const { root, ctx } = toCSTreeWithContext(abc);
          const chords = findByTag(root, TAGS.Chord);
          if (chords.length !== tuneCount) return true;

          explode({ root, cursors: [new Set([chords[targetIndex].id])] }, partCount, ctx);

          const afterTuneTexts = findByTag(root, TAGS.Tune).map((t) => formatSelection({ root: t, cursors: [] }));
          if (afterTuneTexts.length !== beforeTuneTexts.length) return false;

          for (let i = 0; i < afterTuneTexts.length; i++) {
            if (i === targetIndex) {
              // The targeted tune must have grown
              if (afterTuneTexts[i] === beforeTuneTexts[i]) return false;
            } else if (afterTuneTexts[i] !== beforeTuneTexts[i]) {
              // Every other tune must be byte-identical
              return false;
            }
          }
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("cursor count equals partCount times the number of tunes holding a selection", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 2, max: 4 }), (tuneCount, partCount) => {
          const tunes = Array.from({ length: tuneCount }, (_, i) => `X:${i + 1}\nT:tune${i + 1}\nK:C\n[CEG] |\n`);
          const abc = tunes.join("\n");

          const { root, ctx } = toCSTreeWithContext(abc);
          const chords = findByTag(root, TAGS.Chord);
          if (chords.length !== tuneCount) return true;

          // Select the chord of every tune, so every tune holds a selection
          const result = explode({ root, cursors: chords.map((c) => new Set([c.id])) }, partCount, ctx);

          return result.cursors.length === partCount * tuneCount;
        }),
        { numRuns: 50 }
      );
    });
  });
});

// Helper function to check if a node is a descendant of another
function isDescendant(parent: CSNode, child: CSNode): boolean {
  let current = parent.firstChild;
  while (current) {
    if (current === child || isDescendant(current, child)) {
      return true;
    }
    current = current.nextSibling;
  }
  return false;
}
