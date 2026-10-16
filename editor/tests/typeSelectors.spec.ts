import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS } from "../src/csTree/types";
import { createSelection } from "../src/selection";
import {
  selectChords,
  selectNotes,
  selectNonChordNotes,
  selectChordNotes,
  selectRests,
  selectRhythm,
  selectRhythmParent,
  selectAnnotations,
} from "../src/selectors/typeSelectors";
import { toSelection, toCSTree, findById, findByTag, genAbcTune, genAbcWithChords, genAbcWithMultiMeasureRests } from "./helpers";

describe("typeSelectors", () => {
  describe("properties", () => {
    it("every cursor in selectChords result contains exactly 1 ID of a Chord CSNode", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const result = selectChords(sel);
          for (const cursor of result.cursors) {
            if (cursor.size !== 1) return false;
            const id = [...cursor][0];
            const node = findById(result.root, id);
            if (!node || node.tag !== TAGS.Chord) return false;
          }
          return true;
        })
      );
    });

    it("every cursor in selectNotes result contains exactly 1 ID of a Note CSNode", () => {
      fc.assert(
        fc.property(genAbcTune, (abc) => {
          const sel = toSelection(abc);
          const result = selectNotes(sel);
          for (const cursor of result.cursors) {
            if (cursor.size !== 1) return false;
            const id = [...cursor][0];
            const node = findById(result.root, id);
            if (!node || node.tag !== TAGS.Note) return false;
          }
          return true;
        })
      );
    });

    it("selectNonChordNotes and selectChordNotes are disjoint and their union equals selectNotes", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const allNotes = selectNotes(sel);
          const nonChord = selectNonChordNotes(sel);
          const chordNotes = selectChordNotes(sel);

          const allIds = new Set(allNotes.cursors.map((c) => [...c][0]));
          const nonChordIds = new Set(nonChord.cursors.map((c) => [...c][0]));
          const chordIds = new Set(chordNotes.cursors.map((c) => [...c][0]));

          // Disjoint
          for (const id of nonChordIds) {
            if (chordIds.has(id)) return false;
          }
          // Union equals all
          const unionIds = new Set([...nonChordIds, ...chordIds]);
          if (unionIds.size !== allIds.size) return false;
          for (const id of allIds) {
            if (!unionIds.has(id)) return false;
          }
          return true;
        })
      );
    });

    it("selectChords cursor count equals the number of Chord CSNodes in the tree", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const root = toCSTree(abc);
          const sel = createSelection(root);
          const result = selectChords(sel);
          const chordNodes = findByTag(root, TAGS.Chord);
          return result.cursors.length === chordNodes.length;
        })
      );
    });

    it("applying two type selectors for disjoint types produces zero cursors", () => {
      fc.assert(
        fc.property(genAbcTune, (abc) => {
          const sel = toSelection(abc);
          const notesOnly = selectNotes(sel);
          const chordsFromNotes = selectChords(notesOnly);
          return chordsFromNotes.cursors.length === 0;
        })
      );
    });

    it("idempotence: selectChords(selectChords(sel)) equals selectChords(sel)", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const first = selectChords(sel);
          const second = selectChords(first);
          if (second.cursors.length !== first.cursors.length) return false;
          for (let i = 0; i < first.cursors.length; i++) {
            const a = [...first.cursors[i]];
            const b = [...second.cursors[i]];
            if (a.length !== b.length || a[0] !== b[0]) return false;
          }
          return true;
        })
      );
    });

    it("every cursor in selectRests result contains exactly 1 ID of a Rest or MultiMeasureRest CSNode", () => {
      // We use genAbcWithMultiMeasureRests to guarantee at least one multi-measure rest
      // is present, so the test does not pass vacuously on tunes with no rests.
      fc.assert(
        fc.property(genAbcWithMultiMeasureRests, (abc) => {
          const sel = toSelection(abc);
          const result = selectRests(sel);
          for (const cursor of result.cursors) {
            if (cursor.size !== 1) return false;
            const id = [...cursor][0];
            const node = findById(result.root, id);
            if (!node || (node.tag !== TAGS.Rest && node.tag !== TAGS.MultiMeasureRest)) return false;
          }
          return true;
        })
      );
    });
  });

  describe("examples", () => {
    it("[CEG]2 C2 D2 E2| — selectChords produces 1 cursor", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C2 D2 E2|\n");
      const chords = selectChords(sel);
      expect(chords.cursors.length).to.equal(1);
    });

    it("[CEG]2 C2 D2 E2| — selectNotes produces 6 cursors", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C2 D2 E2|\n");
      const notes = selectNotes(sel);
      expect(notes.cursors.length).to.equal(6);
    });

    it("[CEG]2 C2 D2 E2| — selectNonChordNotes produces 3 cursors", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C2 D2 E2|\n");
      const result = selectNonChordNotes(sel);
      expect(result.cursors.length).to.equal(3);
    });

    it("[CEG]2 C2 D2 E2| — selectChordNotes produces 3 cursors", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C2 D2 E2|\n");
      const result = selectChordNotes(sel);
      expect(result.cursors.length).to.equal(3);
    });

    it("C2 z2 [DF]2 z2| — selectRests produces 2 cursors", () => {
      const sel = toSelection("X:1\nK:C\nC2 z2 [DF]2 z2|\n");
      const rests = selectRests(sel);
      expect(rests.cursors.length).to.equal(2);
    });

    it("C | X4 | D| — selectRests produces 1 cursor (invisible multi-measure rest)", () => {
      const sel = toSelection("X:1\nK:C\nC | X4 | D|\n");
      const rests = selectRests(sel);
      expect(rests.cursors.length).to.equal(1);
      const id = [...rests.cursors[0]][0];
      const node = findById(rests.root, id);
      expect(node!.tag).to.equal(TAGS.MultiMeasureRest);
    });

    it("C | Z4 | D| — selectRests produces 1 cursor (visible multi-measure rest)", () => {
      const sel = toSelection("X:1\nK:C\nC | Z4 | D|\n");
      const rests = selectRests(sel);
      expect(rests.cursors.length).to.equal(1);
      const id = [...rests.cursors[0]][0];
      const node = findById(rests.root, id);
      expect(node!.tag).to.equal(TAGS.MultiMeasureRest);
    });

    it("z2 X2 Z2| — selectRests produces 3 cursors (regular + invisible + visible)", () => {
      const sel = toSelection("X:1\nK:C\nz2 X2 Z2|\n");
      const rests = selectRests(sel);
      expect(rests.cursors.length).to.equal(3);
    });

    it("C2 z2 [DF]2 z2| — selectChords produces 1 cursor", () => {
      const sel = toSelection("X:1\nK:C\nC2 z2 [DF]2 z2|\n");
      const chords = selectChords(sel);
      expect(chords.cursors.length).to.equal(1);
    });

    it("C2 z2 [DF]2 z2| — selectNonChordNotes produces 1 cursor (standalone C)", () => {
      const sel = toSelection("X:1\nK:C\nC2 z2 [DF]2 z2|\n");
      const result = selectNonChordNotes(sel);
      expect(result.cursors.length).to.equal(1);
    });

    it("CDEF| (beamed) — selectNotes produces 4 cursors", () => {
      const sel = toSelection("X:1\nK:C\nCDEF|\n");
      const result = selectNotes(sel);
      expect(result.cursors.length).to.equal(4);
    });

    it("selectChords(selectNotes(sel)) on any input produces zero cursors", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C2|\n");
      const result = selectChords(selectNotes(sel));
      expect(result.cursors.length).to.equal(0);
    });
  });
});

describe("selectRhythm", () => {
  describe("examples", () => {
    it("C2 D E/4 F| — selectRhythm produces 2 cursors (C2 and E/4 have explicit rhythm)", () => {
      const sel = toSelection("X:1\nK:C\nC2 D E/4 F|\n");
      const result = selectRhythm(sel);
      expect(result.cursors.length).to.equal(2);
    });

    it("[CEG]2 C D| — selectRhythm produces 1 cursor (chord has rhythm)", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C D|\n");
      const result = selectRhythm(sel);
      expect(result.cursors.length).to.equal(1);
    });

    it("C D E F| — selectRhythm produces 0 cursors (no explicit rhythms)", () => {
      const sel = toSelection("X:1\nK:C\nC D E F|\n");
      const result = selectRhythm(sel);
      expect(result.cursors.length).to.equal(0);
    });

    it("z2 z z/2| — selectRhythm produces 2 cursors (z2 and z/2)", () => {
      const sel = toSelection("X:1\nK:C\nz2 z z/2|\n");
      const result = selectRhythm(sel);
      expect(result.cursors.length).to.equal(2);
    });

    it("every cursor in selectRhythm result contains exactly 1 ID of a Rhythm CSNode", () => {
      const sel = toSelection("X:1\nK:C\nC2 D E/4 [FA]2|\n");
      const result = selectRhythm(sel);
      for (const cursor of result.cursors) {
        expect(cursor.size).to.equal(1);
        const id = [...cursor][0];
        const node = findById(result.root, id);
        expect(node).to.not.be.null;
        expect(node!.tag).to.equal(TAGS.Rhythm);
      }
    });
  });
});

describe("selectRhythmParent", () => {
  describe("examples", () => {
    it("C2 D E/4 F| — selectRhythmParent produces 2 cursors", () => {
      const sel = toSelection("X:1\nK:C\nC2 D E/4 F|\n");
      const result = selectRhythmParent(sel);
      expect(result.cursors.length).to.equal(2);
    });

    it("[CEG]2 C D| — selectRhythmParent produces 1 cursor (the chord)", () => {
      const sel = toSelection("X:1\nK:C\n[CEG]2 C D|\n");
      const result = selectRhythmParent(sel);
      expect(result.cursors.length).to.equal(1);
      const id = [...result.cursors[0]][0];
      const node = findById(result.root, id);
      expect(node!.tag).to.equal(TAGS.Chord);
    });

    it("C D E F| — selectRhythmParent produces 0 cursors", () => {
      const sel = toSelection("X:1\nK:C\nC D E F|\n");
      const result = selectRhythmParent(sel);
      expect(result.cursors.length).to.equal(0);
    });

    it("z2 z z/2| — selectRhythmParent produces 2 cursors (rests with rhythm)", () => {
      const sel = toSelection("X:1\nK:C\nz2 z z/2|\n");
      const result = selectRhythmParent(sel);
      expect(result.cursors.length).to.equal(2);
      for (const cursor of result.cursors) {
        const id = [...cursor][0];
        const node = findById(result.root, id);
        expect(node!.tag).to.equal(TAGS.Rest);
      }
    });

    it("selectRhythmParent returns Note, Chord, Rest, or YSPACER nodes only", () => {
      const sel = toSelection("X:1\nK:C\nC2 [DF]4 z/2 y2|\n");
      const result = selectRhythmParent(sel);
      const validTags = new Set([TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER]);
      for (const cursor of result.cursors) {
        const id = [...cursor][0];
        const node = findById(result.root, id);
        expect(validTags.has(node!.tag)).to.be.true;
      }
    });

    it("y2 y| — selectRhythmParent selects only the y2 spacer", () => {
      const sel = toSelection("X:1\nK:C\ny2 C y|\n");
      const result = selectRhythmParent(sel);
      // y2 has rhythm, C has no rhythm, y has no rhythm
      expect(result.cursors.length).to.equal(1);
      const id = [...result.cursors[0]][0];
      const node = findById(result.root, id);
      expect(node!.tag).to.equal(TAGS.YSPACER);
    });
  });

  describe("properties", () => {
    it("selectRhythm cursor count equals selectRhythmParent cursor count for tunes without chord-internal note rhythms", () => {
      // For simple cases where rhythm is only on the parent (Note/Chord/Rest),
      // not on notes inside chords, the counts should match
      const sel = toSelection("X:1\nK:C\nC2 D [EG]4 z/2|\n");
      const rhythms = selectRhythm(sel);
      const parents = selectRhythmParent(sel);
      expect(rhythms.cursors.length).to.equal(parents.cursors.length);
    });
  });

  describe("selectAnnotations", () => {
    it("every cursor contains exactly 1 ID of an Annotation CSNode", () => {
      fc.assert(
        fc.property(genAbcTune, (abc) => {
          const result = selectAnnotations(toSelection(abc));
          return result.cursors.every((cursor) => {
            if (cursor.size !== 1) return false;
            const node = findById(result.root, [...cursor][0]);
            return !!node && node.tag === TAGS.Annotation;
          });
        })
      );
    });

    it("is idempotent", () => {
      fc.assert(
        fc.property(genAbcTune, (abc) => {
          const once = selectAnnotations(toSelection(abc));
          const twice = selectAnnotations(once);
          return once.cursors.length === twice.cursors.length;
        })
      );
    });

    it('"^allegro" C "_dolce" D| selects 2 annotations', () => {
      const result = selectAnnotations(toSelection('X:1\nK:C\n"^allegro" C "_dolce" D|\n'));
      expect(result.cursors.length).to.equal(2);
    });

    it("C D E F| selects no annotations", () => {
      const result = selectAnnotations(toSelection("X:1\nK:C\nC D E F|\n"));
      expect(result.cursors.length).to.equal(0);
    });
  });
});
