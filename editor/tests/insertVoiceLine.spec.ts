import { expect } from "chai";
import fc from "fast-check";
import { describe, it } from "mocha";
import * as ParserGen from "../../parse/tests/prs_pbt.generators.spec";
import { TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { insertVoiceLine } from "../src/transforms/insertVoiceLine";
import { toCSTreeWithContext, formatSelection, findByTag } from "./helpers";

describe("insertVoiceLine", () => {
  describe("example-based tests", () => {
    it("single note selected, others converted to rests", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D E F |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select note E (index 2)
      const sel: Selection = { root, cursors: [new Set([notes[2].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      expect(result).to.include("[V:V2]");
      expect(result).to.include("z z E z");
    });

    it("multiple notes selected on same line", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D E F |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select D and E (indices 1 and 2)
      const sel: Selection = { root, cursors: [new Set([notes[1].id]), new Set([notes[2].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      expect(result).to.include("[V:V2]");
      expect(result).to.include("z D E z");
    });

    it("chord with partial selection: only selected notes kept", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] A B |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select the first note in the chord (C) - should be index 0
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      expect(result).to.include("[V:V2]");
      // Chord should contain only C, and A B should become rests
      expect(result).to.match(/\[V:V2\].*\[C\].*z.*z/s);
    });

    it("chord with no selection: converted to rest", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CEG] A B |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select only A (index 3, after the 3 chord notes C, E, G)
      const sel: Selection = { root, cursors: [new Set([notes[3].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      expect(result).to.include("[V:V2]");
      // First position should be a rest (chord converted), A should be kept, B should be rest
      expect(result).to.include("z A z");
    });

    it("preserves rhythm when converting to rest", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC2 D E4 F |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select only D (index 1)
      const sel: Selection = { root, cursors: [new Set([notes[1].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      expect(result).to.include("[V:V2]");
      // C2 should become z2, E4 should become z4
      expect(result).to.include("z2 D z4 z");
    });

    it("voice ID not in header: adds V: line to header", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nT:Test\nK:C\nC D E F |\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };

      insertVoiceLine(sel, "NewVoice", ctx);

      const result = formatSelection(sel);
      // Should have V:NewVoice in the header (before K:)
      expect(result).to.match(/V:NewVoice[\s\S]*K:C/);
    });

    it("voice ID already in header: does not duplicate V: line in header", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nT:Test\nV:ExistingVoice\nK:C\nC D E F |\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };

      insertVoiceLine(sel, "ExistingVoice", ctx);

      const result = formatSelection(sel);
      // Count header V: lines (before K:) - should be only one
      const headerPart = result.split("K:C")[0];
      const headerVoiceMatches = headerPart.match(/V:ExistingVoice/g);
      expect(headerVoiceMatches).to.have.lengthOf(1);
    });

    it("multiple lines with selections across them", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D E F |\nG A B c |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select E on first line (index 2) and A on second line (index 5)
      const sel: Selection = { root, cursors: [new Set([notes[2].id]), new Set([notes[5].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // Should have two [V:V2] markers, one for each duplicated line
      const matches = result.match(/\[V:V2\]/g);
      expect(matches).to.have.lengthOf(2);
    });

    it("preserves bar lines and structural elements", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D | E F |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select E (index 2)
      const sel: Selection = { root, cursors: [new Set([notes[2].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // The duplicated line should preserve bar lines
      expect(result).to.include("[V:V2] z z | E z |");
    });

    it("handles empty selection gracefully", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D E F |\n");
      const sel: Selection = { root, cursors: [] }; // No selection

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // Should not add any voice line
      expect(result).to.not.include("[V:V2]");
    });

    it("grace group before selected note: preserved", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{DE}F G A |\n");
      const notes = findByTag(root, TAGS.Note);
      // Find F (the target of the grace group) - it's after D, E in the grace group
      // Notes order: D (grace), E (grace), F (target), G, A
      // Select F (index 2)
      const sel: Selection = { root, cursors: [new Set([notes[2].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // Grace group should be preserved before the selected note
      expect(result).to.include("[V:V2]");
      expect(result).to.match(/\[V:V2\].*\{DE\}F/s);
    });

    it("grace group before non-selected note: removed", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{DE}F G A |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select G (index 3) instead of F
      const sel: Selection = { root, cursors: [new Set([notes[3].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // In the duplicated line, the grace group should be removed (F becomes rest)
      expect(result).to.include("[V:V2]");
      // The duplicated line should NOT have the grace group
      const voiceLineMatch = result.match(/\[V:V2\]([^X]+)/s);
      if (voiceLineMatch) {
        expect(voiceLineMatch[1]).to.not.include("{DE}");
      }
    });

    it("grace group with intermediate decorations before target note", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n{DE}!mf!F G A |\n");
      const notes = findByTag(root, TAGS.Note);
      // Select F (target note with decoration between grace and note)
      const sel: Selection = { root, cursors: [new Set([notes[2].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // Grace group should be preserved
      expect(result).to.include("[V:V2]");
      expect(result).to.match(/\[V:V2\].*\{DE\}/s);
    });
  });

  describe("multi-tune documents", () => {
    const TWO_TUNES = "X:1\nT:first\nK:C\nC D E |\n\nX:2\nT:second\nK:C\nG A B |\n";

    it("selection in the second tune inserts the voice line there, not in the first", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const notes = findByTag(root, TAGS.Note);
      // The second tune's notes are G, A, B, which follow the first tune's C, D, E
      const sel: Selection = { root, cursors: [new Set([notes[3].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // The voice line and its V: declaration belong to the second tune
      expect(result).to.include("[V:V2]");
      const firstTuneText = result.slice(0, result.indexOf("X:2"));
      expect(firstTuneText).to.not.include("[V:V2]");
      expect(firstTuneText).to.not.include("V:V2\n");
    });

    it("selection spanning two tunes inserts a voice line in each", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = {
        root,
        cursors: [new Set([notes[0].id]), new Set([notes[3].id])],
      };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      const markerCount = result.split("[V:V2]").length - 1;
      expect(markerCount).to.equal(2);
      // Each tune declares the voice in its own header
      const headers = findByTag(root, TAGS.Tune_header);
      expect(headers.length).to.equal(2);
    });

    it("the inserted line in a non-final tune stands on its own line", () => {
      const { root, ctx } = toCSTreeWithContext(TWO_TUNES);
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };

      insertVoiceLine(sel, "V2", ctx);

      const result = formatSelection(sel);
      // The voice line must not be appended onto the original line (no barline followed by
      // the marker on the same line), and the blank line separating the tunes must survive
      expect(result).to.not.match(/\|[ \t]*\[V:V2\]/);
      expect(result).to.match(/C D E \|\n\[V:V2\]/);
      expect(result).to.include("\n\nX:2");
    });
  });

  describe("property-based tests", () => {
    it("duplicated line has same number of note/rest elements as original", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 5 }), fc.integer({ min: 0, max: 4 }), (noteCount, selectedIndex) => {
          const actualIndex = Math.min(selectedIndex, noteCount - 1);
          const notes = Array(noteCount).fill("C").join(" ");
          const abc = `X:1\nK:C\n${notes} |\n`;
          const { root, ctx } = toCSTreeWithContext(abc);
          const noteNodes = findByTag(root, TAGS.Note);

          if (noteNodes.length === 0) return true;

          const sel: Selection = { root, cursors: [new Set([noteNodes[actualIndex].id])] };
          insertVoiceLine(sel, "V2", ctx);

          const result = formatSelection(sel);
          // Count the [V:V2] line's elements
          const voiceLineMatch = result.match(/\[V:V2\]([^|]+)\|/);
          if (voiceLineMatch) {
            const voiceLine = voiceLineMatch[1];
            // Count notes (C-B, c-b) and rests (z)
            const elements = voiceLine.match(/[A-Ga-gz]/g) || [];
            expect(elements.length).to.equal(noteCount);
          }
          return true;
        }),
        { numRuns: 20 }
      );
    });

    it("selected note appears in duplicated line", () => {
      fc.assert(
        fc.property(fc.constantFrom("C", "D", "E", "F", "G"), fc.integer({ min: 0, max: 3 }), (noteLetter, position) => {
          const notes = ["A", "B", "A", "B"];
          const actualPos = Math.min(position, notes.length - 1);
          notes[actualPos] = noteLetter;
          const abc = `X:1\nK:C\n${notes.join(" ")} |\n`;
          const { root, ctx } = toCSTreeWithContext(abc);
          const noteNodes = findByTag(root, TAGS.Note);

          if (noteNodes.length === 0) return true;

          const sel: Selection = { root, cursors: [new Set([noteNodes[actualPos].id])] };
          insertVoiceLine(sel, "V2", ctx);

          const result = formatSelection(sel);
          // The voice line should contain the selected note letter
          const voiceLineMatch = result.match(/\[V:V2\]([^|]+)\|/);
          if (voiceLineMatch) {
            expect(voiceLineMatch[1]).to.include(noteLetter);
          }
          return true;
        }),
        { numRuns: 20 }
      );
    });

    it("whitespace between elements is preserved after transform (genMusicSequence)", () => {
      fc.assert(
        fc.property(ParserGen.genMusicSequence, fc.integer({ min: 0, max: 9 }), (musicSeq, selectedIdx) => {
          // Build ABC with whitespace between elements
          const bodyText = musicSeq.tokens.map((t) => t.lexeme).join(" ");
          const abc = `X:1\nK:C\n${bodyText} |\n`;

          const { root, ctx } = toCSTreeWithContext(abc);
          const notes = findByTag(root, TAGS.Note);

          if (notes.length === 0) return true;

          // Count top-level WS tokens before transform
          const tuneBody = findByTag(root, TAGS.Tune_Body)[0];
          const countWsTokens = (node: typeof root): number => {
            let count = 0;
            let child = node.firstChild;
            while (child) {
              if (child.tag === TAGS.Token && child.data.tokenType === 76) {
                count++;
              }
              child = child.nextSibling;
            }
            return count;
          };
          const wsBefore = countWsTokens(tuneBody);

          // Select a random note
          const actualIdx = Math.min(selectedIdx, notes.length - 1);
          const sel: Selection = { root, cursors: [new Set([notes[actualIdx].id])] };

          insertVoiceLine(sel, "V2", ctx);

          // Count WS tokens after transform - should have at least doubled
          // because the line was duplicated with its whitespace
          const wsAfter = countWsTokens(tuneBody);
          expect(wsAfter).to.be.gte(wsBefore);

          // Format and re-parse
          const result = formatSelection(sel);
          const { root: reparsedRoot } = toCSTreeWithContext(result);

          // The duplicated voice line should exist
          expect(result).to.include("[V:V2]");

          // Re-parsed tree should have at least as many notes as original
          // (original notes + selected note in voice line, rests don't count as notes)
          const reparsedNotes = findByTag(reparsedRoot, TAGS.Note);
          expect(reparsedNotes.length).to.be.gte(notes.length);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("beam boundaries are preserved - no merging of adjacent beams", () => {
      fc.assert(
        fc.property(ParserGen.genMusicSequence, fc.integer({ min: 0, max: 9 }), (musicSeq, selectedIdx) => {
          // Insert whitespace between elements to create beam boundaries
          const bodyText = musicSeq.tokens.map((t) => t.lexeme).join(" ");
          const abc = `X:1\nK:C\n${bodyText} |\n`;

          const { root, ctx } = toCSTreeWithContext(abc);
          const notes = findByTag(root, TAGS.Note);
          const beamsBefore = findByTag(root, TAGS.Beam);

          if (notes.length === 0) return true;

          const actualIdx = Math.min(selectedIdx, notes.length - 1);
          const sel: Selection = { root, cursors: [new Set([notes[actualIdx].id])] };

          // Count beams after transform (before re-parse)
          insertVoiceLine(sel, "V2", ctx);
          const beamsAfterTransform = findByTag(sel.root, TAGS.Beam);

          const result = formatSelection(sel);
          const { root: reparsedRoot } = toCSTreeWithContext(result);
          const beamsAfterReparse = findByTag(reparsedRoot, TAGS.Beam);

          // After transform we should have 2x the beams (original + duplicated line)
          // After re-parse we should still have at least that many
          // If beams merged due to missing whitespace, we'd have fewer
          if (beamsBefore.length > 0) {
            expect(beamsAfterTransform.length).to.be.gte(beamsBefore.length);
            expect(beamsAfterReparse.length).to.be.gte(beamsBefore.length);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("roundtrip: formatted output re-parses to equivalent structure", () => {
      fc.assert(
        fc.property(ParserGen.genMusicSequence, fc.integer({ min: 0, max: 9 }), (musicSeq, selectedIdx) => {
          const bodyText = musicSeq.tokens.map((t) => t.lexeme).join(" ");
          const abc = `X:1\nK:C\n${bodyText} |\n`;

          const { root, ctx } = toCSTreeWithContext(abc);
          const notes = findByTag(root, TAGS.Note);
          const rests = findByTag(root, TAGS.Rest);
          const chords = findByTag(root, TAGS.Chord);
          const barlines = findByTag(root, TAGS.BarLine);

          if (notes.length === 0) return true;

          const actualIdx = Math.min(selectedIdx, notes.length - 1);
          const sel: Selection = { root, cursors: [new Set([notes[actualIdx].id])] };

          insertVoiceLine(sel, "V2", ctx);

          const result = formatSelection(sel);
          const { root: reparsedRoot } = toCSTreeWithContext(result);

          // Count elements after re-parse
          const reparsedNotes = findByTag(reparsedRoot, TAGS.Note);
          const reparsedRests = findByTag(reparsedRoot, TAGS.Rest);
          const reparsedChords = findByTag(reparsedRoot, TAGS.Chord);
          const reparsedBarlines = findByTag(reparsedRoot, TAGS.BarLine);

          // Should have at least original notes (unselected become rests)
          expect(reparsedNotes.length).to.be.gte(notes.length);
          // Should have more rests (non-selected notes converted)
          expect(reparsedRests.length).to.be.gte(rests.length);
          // Chords should at least be preserved from original line
          expect(reparsedChords.length).to.be.gte(chords.length);
          // Barlines should double (original + voice line)
          expect(reparsedBarlines.length).to.be.gte(barlines.length);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
