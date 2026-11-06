import { TT } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../src/csTree/types";
import { resolveRanges } from "../src/runner/selectionRangeResolver";
import { Selection } from "../src/selection";
import {
  selectInsideChord,
  selectAroundChord,
  selectInsideGraceGroup,
  selectAroundGraceGroup,
  selectInsideInlineField,
  selectAroundInlineField,
} from "../src/selectors/delimiterSelectors";
import { selectChords } from "../src/selectors/typeSelectors";
import { toCSTree, toSelection, findByTag, findById, genAbcWithChords, genAbcWithGraceGroups } from "./helpers";

function getChildren(node: CSNode): CSNode[] {
  const children: CSNode[] = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

function findParent(root: CSNode, targetId: number): CSNode | undefined {
  const stack: CSNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    let child = node.firstChild;
    while (child) {
      if (child.id === targetId) return node;
      stack.push(child);
      child = child.nextSibling;
    }
  }
  return undefined;
}

describe("delimiterSelectors", () => {
  describe("Chord - property-based", () => {
    it("around is idempotent", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const chords = selectChords(sel);
          if (chords.cursors.length === 0) return true;
          const around1 = selectAroundChord(chords);
          const around2 = selectAroundChord(around1);
          if (around1.cursors.length !== around2.cursors.length) return false;
          for (let i = 0; i < around1.cursors.length; i++) {
            const ids1 = [...around1.cursors[i]].sort();
            const ids2 = [...around2.cursors[i]].sort();
            if (ids1.length !== ids2.length) return false;
            for (let j = 0; j < ids1.length; j++) {
              if (ids1[j] !== ids2[j]) return false;
            }
          }
          return true;
        })
      );
    });

    it("inside IDs are direct children of the Chord node", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const chords = selectChords(sel);
          if (chords.cursors.length === 0) return true;
          const inside = selectInsideChord(chords);
          for (const cursor of inside.cursors) {
            for (const id of cursor) {
              const parent = findParent(inside.root, id);
              if (!parent || parent.tag !== TAGS.Chord) return false;
            }
          }
          return true;
        })
      );
    });

    it("inside excludes delimiter tokens", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const sel = toSelection(abc);
          const chords = selectChords(sel);
          if (chords.cursors.length === 0) return true;
          const inside = selectInsideChord(chords);
          for (const cursor of inside.cursors) {
            for (const id of cursor) {
              const node = findById(inside.root, id);
              if (node && isTokenNode(node)) {
                const tt = getTokenData(node).tokenType;
                if (tt === TT.CHRD_LEFT_BRKT || tt === TT.CHRD_RIGHT_BRKT) return false;
              }
            }
          }
          return true;
        })
      );
    });

    it("deduplication within one cursor: multiple notes in the same chord produce exactly 1 output cursor", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const root = toCSTree(abc);
          const chords = findByTag(root, TAGS.Chord);
          for (const chord of chords) {
            const notes = getChildren(chord).filter((c) => c.tag === TAGS.Note);
            if (notes.length > 1) {
              const cursor = new Set(notes.map((n) => n.id));
              const sel: Selection = { root, cursors: [cursor] };
              const result = selectAroundChord(sel);
              if (result.cursors.length !== 1) return false;
            }
          }
          return true;
        })
      );
    });

    it("search-outward from any Note inside a Chord finds that Chord", () => {
      fc.assert(
        fc.property(genAbcWithChords, (abc) => {
          const root = toCSTree(abc);
          const chords = findByTag(root, TAGS.Chord);
          for (const chord of chords) {
            const notes = getChildren(chord).filter((c) => c.tag === TAGS.Note);
            if (notes.length > 0) {
              const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
              const result = selectAroundChord(sel);
              if (result.cursors.length !== 1) return false;
              if ([...result.cursors[0]][0] !== chord.id) return false;
            }
          }
          return true;
        })
      );
    });
  });

  describe("Grace group - property-based", () => {
    it("around is idempotent", () => {
      fc.assert(
        fc.property(genAbcWithGraceGroups, (abc) => {
          const root = toCSTree(abc);
          const graces = findByTag(root, TAGS.Grace_group);
          if (graces.length === 0) return true;
          const sel: Selection = { root, cursors: [new Set(graces.map((g) => g.id))] };
          const around1 = selectAroundGraceGroup(sel);
          const around2 = selectAroundGraceGroup(around1);
          if (around1.cursors.length !== around2.cursors.length) return false;
          for (let i = 0; i < around1.cursors.length; i++) {
            const ids1 = [...around1.cursors[i]].sort();
            const ids2 = [...around2.cursors[i]].sort();
            if (ids1.length !== ids2.length) return false;
            for (let j = 0; j < ids1.length; j++) {
              if (ids1[j] !== ids2[j]) return false;
            }
          }
          return true;
        })
      );
    });

    it("inside excludes delimiter tokens", () => {
      fc.assert(
        fc.property(genAbcWithGraceGroups, (abc) => {
          const root = toCSTree(abc);
          const graces = findByTag(root, TAGS.Grace_group);
          if (graces.length === 0) return true;
          const sel: Selection = { root, cursors: [new Set(graces.map((g) => g.id))] };
          const inside = selectInsideGraceGroup(sel);
          for (const cursor of inside.cursors) {
            for (const id of cursor) {
              const node = findById(inside.root, id);
              if (node && isTokenNode(node)) {
                const tt = getTokenData(node).tokenType;
                if (tt === TT.GRC_GRP_LEFT_BRACE || tt === TT.GRC_GRP_RGHT_BRACE) return false;
              }
            }
          }
          return true;
        })
      );
    });

    it("search-outward from a Note inside a grace group finds the Grace_group node", () => {
      fc.assert(
        fc.property(genAbcWithGraceGroups, (abc) => {
          const root = toCSTree(abc);
          const graces = findByTag(root, TAGS.Grace_group);
          for (const grace of graces) {
            const notes = getChildren(grace).filter((c) => c.tag === TAGS.Note);
            if (notes.length > 0) {
              const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
              const result = selectAroundGraceGroup(sel);
              if (result.cursors.length !== 1) return false;
              if ([...result.cursors[0]][0] !== grace.id) return false;
            }
          }
          return true;
        })
      );
    });
  });

  describe("Chord - example-based", () => {
    it("around - narrowing: cursor is the Chord node's ID", () => {
      const root = toCSTree("X:1\nK:C\n[CEG]2|\n");
      const chords = findByTag(root, TAGS.Chord);
      expect(chords.length).to.equal(1);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      const result = selectAroundChord(sel);
      expect(result.cursors.length).to.equal(1);
      expect([...result.cursors[0]][0]).to.equal(chords[0].id);
    });

    it("around - search-outward: cursor is a Note's ID inside a Chord", () => {
      const root = toCSTree("X:1\nK:C\n[CEG]2|\n");
      const chords = findByTag(root, TAGS.Chord);
      const notes = getChildren(chords[0]).filter((c) => c.tag === TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      const result = selectAroundChord(sel);
      expect(result.cursors.length).to.equal(1);
      expect([...result.cursors[0]][0]).to.equal(chords[0].id);
    });

    it("inside - narrowing: cursor is the Chord node's ID, output contains Note children only", () => {
      const root = toCSTree("X:1\nK:C\n[CEG]2|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      const result = selectInsideChord(sel);
      expect(result.cursors.length).to.equal(1);
      const insideIds = [...result.cursors[0]];
      // Should contain 3 Note children (C, E, G)
      expect(insideIds.length).to.equal(3);
      for (const id of insideIds) {
        const node = findById(root, id)!;
        expect(node.tag).to.equal(TAGS.Note);
      }
    });

    it("inside - search-outward: cursor is a Note's ID inside a Chord", () => {
      const root = toCSTree("X:1\nK:C\n[CEG]2|\n");
      const chords = findByTag(root, TAGS.Chord);
      const notes = getChildren(chords[0]).filter((c) => c.tag === TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      const result = selectInsideChord(sel);
      expect(result.cursors.length).to.equal(1);
      const insideIds = [...result.cursors[0]];
      expect(insideIds.length).to.equal(3);
    });

    it("no match: standalone Note with selectAroundChord returns no cursors", () => {
      const root = toCSTree("X:1\nK:C\nC D E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      const result = selectAroundChord(sel);
      expect(result.cursors.length).to.equal(0);
    });

    it("multiple chords: one Note from each chord produces two output cursors", () => {
      const root = toCSTree("X:1\nK:C\n[CE] [FA]|\n");
      const chords = findByTag(root, TAGS.Chord);
      expect(chords.length).to.equal(2);
      const note1 = getChildren(chords[0]).filter((c) => c.tag === TAGS.Note)[0];
      const note2 = getChildren(chords[1]).filter((c) => c.tag === TAGS.Note)[0];
      const sel: Selection = { root, cursors: [new Set([note1.id, note2.id])] };
      const result = selectAroundChord(sel);
      expect(result.cursors.length).to.equal(2);
    });
  });

  describe("Grace group - example-based", () => {
    it("around - narrowing: cursor is the Grace_group node's ID", () => {
      const root = toCSTree("X:1\nK:C\n{Bc}d|\n");
      const graces = findByTag(root, TAGS.Grace_group);
      expect(graces.length).to.equal(1);
      const sel: Selection = { root, cursors: [new Set([graces[0].id])] };
      const result = selectAroundGraceGroup(sel);
      expect(result.cursors.length).to.equal(1);
      expect([...result.cursors[0]][0]).to.equal(graces[0].id);
    });

    it("inside - narrowing: output contains children between braces", () => {
      const root = toCSTree("X:1\nK:C\n{Bc}d|\n");
      const graces = findByTag(root, TAGS.Grace_group);
      const sel: Selection = { root, cursors: [new Set([graces[0].id])] };
      const result = selectInsideGraceGroup(sel);
      expect(result.cursors.length).to.equal(1);
      const insideIds = [...result.cursors[0]];
      // Should contain the notes between braces (B and c)
      expect(insideIds.length).to.equal(2);
      for (const id of insideIds) {
        const node = findById(root, id)!;
        expect(node.tag).to.equal(TAGS.Note);
      }
    });

    it("around - search-outward: cursor is a Note inside the grace group", () => {
      const root = toCSTree("X:1\nK:C\n{Bc}d|\n");
      const graces = findByTag(root, TAGS.Grace_group);
      const notes = getChildren(graces[0]).filter((c) => c.tag === TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      const result = selectAroundGraceGroup(sel);
      expect(result.cursors.length).to.equal(1);
      expect([...result.cursors[0]][0]).to.equal(graces[0].id);
    });
  });

  describe("Inline field - example-based", () => {
    it("around - narrowing: cursor is the Inline_field node's ID", () => {
      const root = toCSTree("X:1\nK:C\nC [K:Bb] D|\n");
      const fields = findByTag(root, TAGS.Inline_field);
      expect(fields.length).to.equal(1);
      const sel: Selection = { root, cursors: [new Set([fields[0].id])] };
      const result = selectAroundInlineField(sel);
      expect(result.cursors.length).to.equal(1);
      expect([...result.cursors[0]][0]).to.equal(fields[0].id);
    });

    it("inside - narrowing: output contains children between brackets", () => {
      const root = toCSTree("X:1\nK:C\nC [K:Bb] D|\n");
      const fields = findByTag(root, TAGS.Inline_field);
      const sel: Selection = { root, cursors: [new Set([fields[0].id])] };
      const result = selectInsideInlineField(sel);
      expect(result.cursors.length).to.equal(1);
      const insideIds = [...result.cursors[0]];
      // Should have at least the field content between brackets
      expect(insideIds.length).to.be.greaterThan(0);
      // None of the inside IDs should be bracket tokens
      for (const id of insideIds) {
        const node = findById(root, id)!;
        if (isTokenNode(node)) {
          expect(getTokenData(node).tokenType).to.not.equal(TT.INLN_FLD_LFT_BRKT);
          expect(getTokenData(node).tokenType).to.not.equal(TT.INLN_FLD_RGT_BRKT);
        }
      }
    });
  });

  describe("Edge cases", () => {
    it("independent input cursors: two cursors resolving to the same Chord produce two output cursors", () => {
      const root = toCSTree("X:1\nK:C\n[CEG]2|\n");
      const chords = findByTag(root, TAGS.Chord);
      const notes = getChildren(chords[0]).filter((c) => c.tag === TAGS.Note);
      // Two independent cursors, each containing a different note from the same chord
      const sel: Selection = {
        root,
        cursors: [new Set([notes[0].id]), new Set([notes[1].id])],
      };
      const result = selectAroundChord(sel);
      // Each input cursor processes independently, so we get 2 output cursors
      expect(result.cursors.length).to.equal(2);
    });

    it("empty delimiter content: chord with no notes between brackets produces no inside cursors", () => {
      const root = toCSTree("X:1\nK:C\n[]|\n");
      const chords = findByTag(root, TAGS.Chord);
      if (chords.length === 0) return; // parser may not produce a Chord for empty brackets
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      const result = selectInsideChord(sel);
      expect(result.cursors.length).to.equal(0);
    });
  });

  describe("resolved ranges", () => {
    // Line 2: "C [DFA] E |". The bracket is at 2, D at 3, F at 4, A at 5, the closing bracket at 6.
    const source = "X:1\nK:C\nC [DFA] E |\n";

    it("resolves the inside of a chord to one range that spans all its notes, and not to its first note", () => {
      const result = selectInsideChord(selectChords(toSelection(source)));
      expect(resolveRanges({ selector: "selectInsideChord" }, result)).to.deep.equal([{ start: { line: 2, character: 3 }, end: { line: 2, character: 6 } }]);
    });

    it("resolves the around of a chord to the chord with its brackets", () => {
      const result = selectAroundChord(selectChords(toSelection(source)));
      expect(resolveRanges({ selector: "selectAroundChord" }, result)).to.deep.equal([{ start: { line: 2, character: 2 }, end: { line: 2, character: 7 } }]);
    });
  });
});
