import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { TAGS, CSNode, isTokenNode, getTokenData } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { addVoice } from "../src/transforms/addVoice";
import { toCSTreeWithContext, formatSelection, findByTag, genAbcTune } from "./helpers";

/**
 * Because addVoice resolves its target tune from the selection, a selection that identifies
 * no tune leaves the document untouched. Tests therefore scope the selection to a tune node.
 */
function selectionOnFirstTune(root: CSNode): Selection {
  const tunes = findByTag(root, TAGS.Tune);
  expect(tunes.length).to.be.greaterThan(0);
  return { root, cursors: [new Set([tunes[0].id])] };
}

function hasVoiceInfoLine(tuneHeader: CSNode, voiceId: string): boolean {
  let child = tuneHeader.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.Info_line) {
      const keyChild = child.firstChild;
      if (keyChild !== null && isTokenNode(keyChild) && getTokenData(keyChild).lexeme === "V:") {
        const valueChild = keyChild.nextSibling;
        if (valueChild !== null && isTokenNode(valueChild) && getTokenData(valueChild).lexeme.startsWith(voiceId)) {
          return true;
        }
      }
    }
    child = child.nextSibling;
  }
  return false;
}

describe("addVoice", () => {
  describe("example-based", () => {
    it("adds V:T1 before K:C in the header", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "T1", {}, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("V:T1");
      // V: line must appear before K:
      const vIndex = formatted.indexOf("V:T1");
      const kIndex = formatted.indexOf("K:");
      expect(vIndex).to.be.lessThan(kIndex);
    });

    it("adds voice with name and clef parameters", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "T1", { name: "Trumpet", clef: "treble" }, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain('V:T1 name="Trumpet" clef=treble');
    });

    it("adds voice with transpose parameter", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "id", { transpose: -2 }, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("V:id transpose=-2");
    });

    it("inserts V: line after M: and before K: in a multi-line header", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nT:My Tune\nM:4/4\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "V1", {}, ctx);
      const formatted = formatSelection(sel);
      const mIndex = formatted.indexOf("M:4/4");
      const vIndex = formatted.indexOf("V:V1");
      const kIndex = formatted.indexOf("K:C");
      expect(mIndex).to.be.lessThan(vIndex);
      expect(vIndex).to.be.lessThan(kIndex);
    });

    it("adds two voices in insertion order before K:", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "V1", {}, ctx);
      addVoice(sel, "V2", {}, ctx);
      const formatted = formatSelection(sel);
      const v1Index = formatted.indexOf("V:V1");
      const v2Index = formatted.indexOf("V:V2");
      const kIndex = formatted.indexOf("K:C");
      expect(v1Index).to.be.lessThan(v2Index);
      expect(v2Index).to.be.lessThan(kIndex);
    });

    it("appends V: line in the tune header when no K: line exists", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nT:Test\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      addVoice(sel, "V1", {}, ctx);
      // Verify the V: Info_line is a direct child of the Tune_header
      const tuneHeader = findByTag(root, TAGS.Tune_header)[0];
      expect(tuneHeader).to.not.be.undefined;
      expect(hasVoiceInfoLine(tuneHeader, "V1")).to.equal(true);
    });

    it("does not change the tune body after adding a voice", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nCDE|\n");
      const sel: Selection = selectionOnFirstTune(root);
      const beforeBody = formatSelection(sel).split("\n").slice(-1)[0];
      addVoice(sel, "V1", {}, ctx);
      const afterBody = formatSelection(sel).split("\n").slice(-1)[0];
      expect(afterBody).to.equal(beforeBody);
    });
  });

  describe("multi-tune documents", () => {
    const TWO_TUNES = "X:1\nT:first\nK:C\nCDE|\n\nX:2\nT:second\nK:C\nGAB|\n";

    it("adds the voice to the selected tune's header, not the first tune's", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const tunes = findByTag(root, TAGS.Tune);
      const sel: Selection = { root, cursors: [new Set([tunes[1].id])] };

      addVoice(sel, "V9", {}, ctx);

      const headers = findByTag(root, TAGS.Tune_header);
      expect(hasVoiceInfoLine(headers[0], "V9")).to.equal(false);
      expect(hasVoiceInfoLine(headers[1], "V9")).to.equal(true);
    });

    it("a selection spanning both tunes adds the voice to both headers", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const tunes = findByTag(root, TAGS.Tune);
      const sel: Selection = { root, cursors: [new Set([tunes[0].id]), new Set([tunes[1].id])] };

      addVoice(sel, "V9", {}, ctx);

      const headers = findByTag(root, TAGS.Tune_header);
      expect(hasVoiceInfoLine(headers[0], "V9")).to.equal(true);
      expect(hasVoiceInfoLine(headers[1], "V9")).to.equal(true);
    });

    it("a selection identifying no tune leaves the document untouched", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const before = formatSelection({ root, cursors: [] });

      // The root node itself sits outside every tune, so no tune is identified
      addVoice({ root, cursors: [new Set([root.id])] }, "V9", {}, ctx);

      expect(formatSelection({ root, cursors: [] })).to.equal(before);
    });

    it("a note selected inside the second tune resolves to that tune", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const notes = findByTag(root, TAGS.Note);
      // The second tune's notes are G, A, B, which follow the first tune's C, D, E
      const sel: Selection = { root, cursors: [new Set([notes[3].id])] };

      addVoice(sel, "V9", {}, ctx);

      const headers = findByTag(root, TAGS.Tune_header);
      expect(hasVoiceInfoLine(headers[0], "V9")).to.equal(false);
      expect(hasVoiceInfoLine(headers[1], "V9")).to.equal(true);
    });
  });

  describe("property-based", () => {
    it("adding a voice always produces output containing V:<voiceId>", () => {
      fc.assert(
        fc.property(
          genAbcTune,
          fc.string({ minLength: 1, maxLength: 4 }).filter((s) => /^[a-z0-9]+$/.test(s)),
          (source, voiceId) => {
            const { root, ctx } = toCSTreeWithContext(source);
            const sel: Selection = selectionOnFirstTune(root);
            addVoice(sel, voiceId, {}, ctx);
            const formatted = formatSelection(sel);
            expect(formatted).to.contain("V:" + voiceId);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("K: line is always the last Info_line in the header after adding a voice", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const sel: Selection = selectionOnFirstTune(root);
          addVoice(sel, "test", {}, ctx);
          const formatted = formatSelection(sel);
          const lines = formatted.split("\n");
          // Find all info lines (lines matching X: pattern)
          const infoLines = lines.filter((l) => /^[A-Za-z]:/.test(l));
          if (infoLines.length === 0) return;
          const lastInfoLine = infoLines[infoLines.length - 1];
          // If there was a K: line, it should be last among info lines in the header
          if (infoLines.some((l) => l.startsWith("K:"))) {
            expect(lastInfoLine).to.match(/^K:/);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("the V: Info_line is always a direct child of the Tune_header", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const sel: Selection = selectionOnFirstTune(root);
          addVoice(sel, "test", {}, ctx);
          const tuneHeader = findByTag(root, TAGS.Tune_header)[0];
          expect(tuneHeader).to.not.be.undefined;
          expect(hasVoiceInfoLine(tuneHeader, "test")).to.equal(true);
        }),
        { numRuns: 200 }
      );
    });

    it("adding a voice does not change the number of Note nodes in the tree", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notesBefore = findByTag(root, TAGS.Note).length;
          const sel: Selection = selectionOnFirstTune(root);
          addVoice(sel, "test", {}, ctx);
          const notesAfter = findByTag(root, TAGS.Note).length;
          expect(notesAfter).to.equal(notesBefore);
        }),
        { numRuns: 200 }
      );
    });
  });
});
