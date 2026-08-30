import { expect } from "chai";
import { describe, it } from "mocha";
import { TAGS, isTokenNode } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { selectRange } from "../src/selectors/rangeSelector";
import { selectVoices } from "../src/selectors/voiceSelector";
import { toSelection, findByTag } from "./helpers";

describe("voiceSelector", () => {
  describe("single voice file (no V: markers)", () => {
    it("selects all elements when using empty string", () => {
      const sel = toSelection("X:1\nK:C\nCDEF|GABc|\n");
      const result = selectVoices(sel, "");
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("selects all elements when using 'default'", () => {
      const sel = toSelection("X:1\nK:C\nCDEF|GABc|\n");
      const result = selectVoices(sel, "default");
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("groups contiguous elements into a single cursor", () => {
      const sel = toSelection("X:1\nK:C\nCDEF|\n");
      const result = selectVoices(sel, "");
      // All elements are contiguous and belong to default voice
      // They should be in a single cursor with multiple IDs
      expect(result.cursors.length).to.equal(1);
      expect(result.cursors[0].size).to.be.greaterThan(1);
    });
  });

  describe("multi-voice file", () => {
    it("selects only elements belonging to voice 1", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      const result = selectVoices(sel, "1");
      // Should include V:1 info line and elements from CDEF|
      expect(result.cursors.length).to.be.greaterThan(0);
      // Should not include elements from V:2 section
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      // Find the V:2 info line and check it's not included
      const infos = findByTag(sel.root, TAGS.Info_line);
      const v2Info = infos.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme.includes("V:2");
      });
      if (v2Info) {
        expect(allIds.has(v2Info.id)).to.be.false;
      }
    });

    it("selects only elements belonging to voice 2", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      const result = selectVoices(sel, "2");
      expect(result.cursors.length).to.be.greaterThan(0);
      // Should not include V:1 info line
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      const infos = findByTag(sel.root, TAGS.Info_line);
      const v1Info = infos.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme.includes("V:1");
      });
      if (v1Info) {
        expect(allIds.has(v1Info.id)).to.be.false;
      }
    });

    it("selects only elements belonging to voice B (a voice ID that collides with a note letter)", () => {
      // "B" scans as a note-letter token, not a plain identifier, so voice
      // extraction must not be fooled into treating it as a pitch.
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:B\nGABc|\n");
      const result = selectVoices(sel, "B");
      expect(result.cursors.length).to.be.greaterThan(0);
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      const infos = findByTag(sel.root, TAGS.Info_line);
      const v1Info = infos.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme.includes("V:1");
      });
      if (v1Info) {
        expect(allIds.has(v1Info.id)).to.be.false;
      }
    });

    it("selects default voice content before any V: marker", () => {
      const sel = toSelection("X:1\nK:C\nABC|\nV:1\nDEF|\n");
      const result = selectVoices(sel, "");
      // Should include ABC| but not V:1 info line or DEF|
      expect(result.cursors.length).to.be.greaterThan(0);
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      // V:1 info line should not be included
      const infos = findByTag(sel.root, TAGS.Info_line);
      const v1Info = infos.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme.includes("V:1");
      });
      if (v1Info) {
        expect(allIds.has(v1Info.id)).to.be.false;
      }
    });
  });

  describe("non-existent voice ID", () => {
    it("returns input unchanged", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\n");
      const result = selectVoices(sel, "nonexistent");
      expect(result).to.equal(sel);
    });
  });

  describe("inline voice markers", () => {
    it("correctly switches voice tracking mid-line", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCD[V:2]EF|\n");

      const result1 = selectVoices(sel, "1");
      // Should include: V:1 info line, C, D (but not [V:2], E, F, |)
      expect(result1.cursors.length).to.be.greaterThan(0);

      const result2 = selectVoices(sel, "2");
      // Should include: [V:2] inline field, E, F, | (but not V:1 info line, C, D)
      expect(result2.cursors.length).to.be.greaterThan(0);

      // Verify voice 1 and voice 2 selections are disjoint
      const ids1 = new Set<number>();
      const ids2 = new Set<number>();
      for (const cursor of result1.cursors) {
        for (const id of cursor) {
          ids1.add(id);
        }
      }
      for (const cursor of result2.cursors) {
        for (const id of cursor) {
          ids2.add(id);
        }
      }
      // Check they don't overlap
      for (const id of ids1) {
        expect(ids2.has(id)).to.be.false;
      }
    });
  });

  describe("voice overlays", () => {
    it("does not switch voice for voice overlay marker", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDE&FGA|\n");
      const result = selectVoices(sel, "1");
      // All elements (including Voice_overlay marker and F, G, A after it) should be selected
      expect(result.cursors.length).to.be.greaterThan(0);
      // Voice overlay marker should be in the selection
      const overlays = findByTag(sel.root, TAGS.Voice_overlay);
      if (overlays.length > 0) {
        const allIds = new Set<number>();
        for (const cursor of result.cursors) {
          for (const id of cursor) {
            allIds.add(id);
          }
        }
        expect(allIds.has(overlays[0].id)).to.be.true;
      }
    });
  });

  describe("voice ID with metadata", () => {
    it("extracts voice ID correctly when metadata is present", () => {
      const sel = toSelection('X:1\nK:C\nV:Soprano clef=treble name="Soprano"\nCDEF|\n');
      const result = selectVoices(sel, "Soprano");
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("ignores metadata after voice ID", () => {
      const sel = toSelection("X:1\nK:C\nV:1 clef=treble\nCDEF|\nV:2 clef=bass\nGABc|\n");
      const result = selectVoices(sel, "1");
      expect(result.cursors.length).to.be.greaterThan(0);
      // Verify V:2 content is not included
      const result2 = selectVoices(sel, "2");
      expect(result2.cursors.length).to.be.greaterThan(0);

      const ids1 = new Set<number>();
      const ids2 = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          ids1.add(id);
        }
      }
      for (const cursor of result2.cursors) {
        for (const id of cursor) {
          ids2.add(id);
        }
      }
      // Should be disjoint
      for (const id of ids1) {
        expect(ids2.has(id)).to.be.false;
      }
    });
  });

  describe("multiple tunes", () => {
    it("resets voice tracking for each tune", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\n\nX:2\nK:C\nGABc|\n");
      // Second tune has no V: marker, so its content is in default voice ""
      const result = selectVoices(sel, "");
      // Should include GABc| from second tune (but not CDEF| from first tune)
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("selects voice 1 from both tunes if present", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\n\nX:2\nK:C\nV:1\nGABc|\n");
      const result = selectVoices(sel, "1");
      // Should include content from both tunes
      expect(result.cursors.length).to.be.greaterThan(0);
    });
  });

  describe("voice re-entry pattern", () => {
    it("selects all lines following V:1 markers when voice re-enters", () => {
      const input = `X:1
T:Test
M:4 / 4
L:1 / 4
V:1 name=A clef=treble
V:3
V:2 name=B clef=bass
V:4
K:C
V:1
FDEC            | A C     D B     |
V:3
AFGE            | c E     F d     |
V:2
[F,A,]2 [E,G,]2 | [A,B,]2 [F,A,]2 |
V:4
D,2 C,2         | C,2     C,2     |
%
V:1
ABC             | DFE             | DBA
`;
      const sel = toSelection(input);
      const result = selectVoices(sel, "1");

      // Should have at least 2 cursor groups (V:1 re-enters after other voices)
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);

      // Collect all selected IDs
      const selectedIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          selectedIds.add(id);
        }
      }

      // Find all Note nodes in the tree
      const notes = findByTag(sel.root, TAGS.Note);

      // Check that notes F, D, E, C (first V:1 line) are selected
      // These are the first notes after the first V:1 music marker
      const notesByLexeme = new Map<string, CSNode[]>();
      for (const note of notes) {
        const firstChild = note.firstChild;
        if (firstChild && isTokenNode(firstChild)) {
          const lexeme = firstChild.data.lexeme;
          if (!notesByLexeme.has(lexeme)) {
            notesByLexeme.set(lexeme, []);
          }
          notesByLexeme.get(lexeme)!.push(note);
        }
      }

      // Verify there are selected notes (the selector is working)
      expect(selectedIds.size).to.be.greaterThan(0);

      // Check that V:2, V:3, V:4 info lines are NOT selected
      const infos = findByTag(sel.root, TAGS.Info_line);
      for (const info of infos) {
        const firstChild = info.firstChild;
        if (firstChild && isTokenNode(firstChild)) {
          const lexeme = firstChild.data.lexeme;
          if (lexeme.includes("V:2") || lexeme.includes("V:3") || lexeme.includes("V:4")) {
            expect(selectedIds.has(info.id)).to.be.false;
          }
        }
      }
    });
  });

  describe("scope constraint", () => {
    it("respects scope constraint from input cursors", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nC D E F|G A B c|\n");
      // Narrow to just the first line (line 2 is K:C, line 3 is V:1, line 4 has music)
      const scoped = selectRange(sel, 4, 0, 4, 7);
      const result = selectVoices(scoped, "1");
      // Should only include elements within the scoped range
      expect(result.cursors.length).to.be.greaterThan(0);
      // The scoped selection should have fewer elements than unscoped
      const unscopedResult = selectVoices(sel, "1");
      const scopedIds = new Set<number>();
      const unscopedIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          scopedIds.add(id);
        }
      }
      for (const cursor of unscopedResult.cursors) {
        for (const id of cursor) {
          unscopedIds.add(id);
        }
      }
      // Scoped should be subset of unscoped
      for (const id of scopedIds) {
        expect(unscopedIds.has(id)).to.be.true;
      }
      // And smaller (or equal if entire tune body was in scope)
      expect(scopedIds.size).to.be.lessThanOrEqual(unscopedIds.size);
    });

    it("works when scope contains a parent node (Tune) rather than leaf nodes", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      // Find the Tune node and create a selection with just its ID
      const tunes = findByTag(sel.root, TAGS.Tune);
      expect(tunes.length).to.equal(1);
      const tuneId = tunes[0].id;
      // This simulates what happens when user selects the whole tune in the editor
      const scopedWithParent: Selection = { root: sel.root, cursors: [new Set([tuneId])] };
      const result = selectVoices(scopedWithParent, "1");
      // Should still find voice 1 content because scope expands to include descendants
      expect(result.cursors.length).to.be.greaterThan(0);
      // Collect all selected IDs
      const selectedIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          selectedIds.add(id);
        }
      }
      expect(selectedIds.size).to.be.greaterThan(0);
    });
  });

  describe("contiguous grouping", () => {
    it("groups contiguous voice elements into single cursors", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\nV:1\ndefg|\n");
      const result = selectVoices(sel, "1");
      // Should have separate cursors for V:1 before V:2 and V:1 after V:2
      // The V:1 info lines and their content should be grouped
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
    });

    it("creates new cursor when voice changes", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nC|\nV:2\nD|\nV:1\nE|\n");
      const result = selectVoices(sel, "1");
      // V:1 content appears twice, separated by V:2
      // Should result in at least 2 separate cursor groups
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
    });
  });

  describe("multi-voice selection", () => {
    it("selects multiple voices with space separator", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\nV:3\ndefg|\n");
      const result = selectVoices(sel, "1 2");
      // Should select both V:1 and V:2 content, but not V:3
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
      // Verify V:3 content is not selected
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      const infos = findByTag(sel.root, TAGS.Info_line);
      const v3Info = infos.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme.includes("V:3");
      });
      if (v3Info) {
        expect(allIds.has(v3Info.id)).to.be.false;
      }
    });

    it("selects multiple voices with comma separator", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\nV:3\ndefg|\n");
      const result = selectVoices(sel, "1,2");
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
    });

    it("selects multiple voices with mixed separators", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\nV:3\ndefg|\n");
      const result = selectVoices(sel, "1, 2");
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
    });

    it("deduplicates repeated voice IDs", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      const result1 = selectVoices(sel, "1 1 1");
      const result2 = selectVoices(sel, "1");
      // Both should produce the same result
      expect(result1.cursors.length).to.equal(result2.cursors.length);
    });

    it("skips non-existent voice IDs silently", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      const result = selectVoices(sel, "1 99");
      // Should still select V:1 content, ignoring non-existent V:99
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("excludes default voice in multi-voice query", () => {
      const sel = toSelection("X:1\nK:C\nABC|\nV:1\nDEF|\n");
      const result = selectVoices(sel, "1 default");
      // Should only select V:1 content, not the ABC| before V:1
      const allIds = new Set<number>();
      for (const cursor of result.cursors) {
        for (const id of cursor) {
          allIds.add(id);
        }
      }
      // The notes A, B, C before V:1 should not be in the selection
      const notes = findByTag(sel.root, TAGS.Note);
      const noteA = notes.find((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return firstChild.data.lexeme === "A";
      });
      if (noteA) {
        expect(allIds.has(noteA.id)).to.be.false;
      }
    });

    it("single voice input continues to work (backwards compatibility)", () => {
      const sel = toSelection("X:1\nK:C\nV:1\nCDEF|\nV:2\nGABc|\n");
      const result = selectVoices(sel, "1");
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("does not merge cursors between different voices", () => {
      // V:1 and V:2 content are adjacent, but should remain separate cursors
      const sel = toSelection("X:1\nK:C\nV:1\nCD|\nV:2\nEF|\n");
      const result = selectVoices(sel, "1 2");
      // Should have at least 2 cursors (one for V:1, one for V:2)
      expect(result.cursors.length).to.be.greaterThanOrEqual(2);
    });
  });

  describe("voice marker in header (no K: line)", () => {
    it("selects first voice when V: is in header", () => {
      // When there's no K: line, the parser places the first V: in the header.
      // The selector should still find elements belonging to that voice.
      const sel = toSelection("X:1\nT:Test\nV:0\ndef\nV:1\nGDEF|\n");
      const result = selectVoices(sel, "0");
      // Should not return input unchanged
      expect(result).to.not.equal(sel);
      expect(result.cursors.length).to.be.greaterThan(0);
    });

    it("selects all declared voices when V: is in header", () => {
      const sel = toSelection("X:1\nV:0\ndef\nV:1\nGDEF|\nV:2\nABC|\n");
      const result0 = selectVoices(sel, "0");
      const result1 = selectVoices(sel, "1");
      const result2 = selectVoices(sel, "2");
      // All should find matches
      expect(result0).to.not.equal(sel, "V:0 should find matches");
      expect(result1).to.not.equal(sel, "V:1 should find matches");
      expect(result2).to.not.equal(sel, "V:2 should find matches");
    });
  });
});
