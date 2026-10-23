import { SemanticAnalyzer } from "abcls-parser";
import { Scanner, parse } from "abcls-parser";
import { ContextInterpreter } from "abcls-parser/interpreter/ContextInterpreter";
import { KeyRoot, KeyAccidental, Mode, AccidentalType, NoteLetter } from "abcls-parser/types/abcjs-ast";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { ABCContext } from "../../parse/parsers/Context";
import { TT, Token } from "../../parse/parsers/scan";
import { Pitch } from "../../parse/types/Expr";
import { TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import {
  harmonize,
  harmonizeVoicing,
  repairChordTies,
  TieRepairState,
  pitchToDiatonic,
  diatonicToPitch,
  stepDiatonic,
  extractLead,
  formatNote,
  HarmonizeSnapshot,
} from "../src/transforms/harmonize";
import { buildChordTimeline } from "../src/transforms/chordTimeline";
import { toCSTreeWithContext, formatSelection, findByTag, genAbcTune, genAbcWithChords } from "./helpers";

function createPitch(ctx: ABCContext, letter: string, alteration?: string, octaveStr?: string): Pitch {
  const alterationToken = alteration ? new Token(TT.ACCIDENTAL, alteration, ctx.generateId()) : undefined;
  const noteLetterToken = new Token(TT.NOTE_LETTER, letter, ctx.generateId());
  const octaveToken = octaveStr ? new Token(TT.OCTAVE, octaveStr, ctx.generateId()) : undefined;
  return new Pitch(ctx.generateId(), {
    alteration: alterationToken,
    noteLetter: noteLetterToken,
    octave: octaveToken,
  });
}

describe("harmonize", () => {
  describe("helper functions", () => {
    describe("pitchToDiatonic", () => {
      it("C returns { index: 0, octave: 4 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "C");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 0, octave: 4 });
      });

      it("c returns { index: 0, octave: 5 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "c");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 0, octave: 5 });
      });

      it("G, returns { index: 4, octave: 3 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "G", undefined, ",");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 4, octave: 3 });
      });

      it("d' returns { index: 1, octave: 6 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "d", undefined, "'");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 1, octave: 6 });
      });

      it("B,, returns { index: 6, octave: 2 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "B", undefined, ",,");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 6, octave: 2 });
      });

      it("E returns { index: 2, octave: 4 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "E");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 2, octave: 4 });
      });

      it("a returns { index: 5, octave: 5 }", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "a");
        const result = pitchToDiatonic(pitch);
        expect(result).to.deep.equal({ index: 5, octave: 5 });
      });
    });

    describe("diatonicToPitch", () => {
      it("{ index: 0, octave: 4 } produces C", () => {
        const ctx = new ABCContext();
        const pitch = diatonicToPitch(0, 4, undefined, ctx);
        expect(pitch.noteLetter.lexeme).to.equal("C");
        expect(pitch.octave).to.be.undefined;
      });

      it("{ index: 0, octave: 5 } produces c", () => {
        const ctx = new ABCContext();
        const pitch = diatonicToPitch(0, 5, undefined, ctx);
        expect(pitch.noteLetter.lexeme).to.equal("c");
        expect(pitch.octave).to.be.undefined;
      });

      it("{ index: 4, octave: 3 } produces G,", () => {
        const ctx = new ABCContext();
        const pitch = diatonicToPitch(4, 3, undefined, ctx);
        expect(pitch.noteLetter.lexeme).to.equal("G");
        expect(pitch.octave?.lexeme).to.equal(",");
      });

      it("{ index: 1, octave: 6 } produces d'", () => {
        const ctx = new ABCContext();
        const pitch = diatonicToPitch(1, 6, undefined, ctx);
        expect(pitch.noteLetter.lexeme).to.equal("d");
        expect(pitch.octave?.lexeme).to.equal("'");
      });

      it("{ index: 6, octave: 2 } produces B,,", () => {
        const ctx = new ABCContext();
        const pitch = diatonicToPitch(6, 2, undefined, ctx);
        expect(pitch.noteLetter.lexeme).to.equal("B");
        expect(pitch.octave?.lexeme).to.equal(",,");
      });

      it("preserves alteration token", () => {
        const ctx = new ABCContext();
        const alteration = new Token(TT.ACCIDENTAL, "^", ctx.generateId());
        const pitch = diatonicToPitch(0, 4, alteration, ctx);
        expect(pitch.alteration).to.equal(alteration);
      });
    });

    describe("stepDiatonic", () => {
      it("C stepped by +2 produces E", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "C");
        const result = stepDiatonic(pitch, 2, ctx);
        expect(result.noteLetter.lexeme).to.equal("E");
        expect(result.octave).to.be.undefined;
      });

      it("A stepped by +2 produces c (octave wrap up)", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "A");
        const result = stepDiatonic(pitch, 2, ctx);
        expect(result.noteLetter.lexeme).to.equal("c");
        expect(result.octave).to.be.undefined;
      });

      it("c stepped by -2 produces A (octave wrap down)", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "c");
        const result = stepDiatonic(pitch, -2, ctx);
        expect(result.noteLetter.lexeme).to.equal("A");
        expect(result.octave).to.be.undefined;
      });

      it("B stepped by +1 produces c", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "B");
        const result = stepDiatonic(pitch, 1, ctx);
        expect(result.noteLetter.lexeme).to.equal("c");
        expect(result.octave).to.be.undefined;
      });

      it("c stepped by -1 produces B", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "c");
        const result = stepDiatonic(pitch, -1, ctx);
        expect(result.noteLetter.lexeme).to.equal("B");
        expect(result.octave).to.be.undefined;
      });

      it("accidentals preserved: ^C stepped by +2 produces ^E", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "C", "^");
        const result = stepDiatonic(pitch, 2, ctx);
        expect(result.noteLetter.lexeme).to.equal("E");
        expect(result.alteration?.lexeme).to.equal("^");
      });

      it("G stepped by +4 produces D (5th up, octave change)", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "G");
        const result = stepDiatonic(pitch, 4, ctx);
        expect(result.noteLetter.lexeme).to.equal("d");
        expect(result.octave).to.be.undefined;
      });

      it("D stepped by -4 produces G, (5th down, octave change)", () => {
        const ctx = new ABCContext();
        const pitch = createPitch(ctx, "D");
        const result = stepDiatonic(pitch, -4, ctx);
        expect(result.noteLetter.lexeme).to.equal("G");
        expect(result.octave?.lexeme).to.equal(",");
      });
    });
  });

  describe("single note harmonization", () => {
    it("C with steps +2 produces [CE]", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CE]");
    });

    it("A with steps +2 produces [Ac]", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nA|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[Ac]");
    });

    it("E with steps +4 produces [EB] (5th up)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nE|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 4, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[EB]");
    });

    it("G with steps -2 produces [GE] (3rd down)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nG|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, -2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[GE]");
    });

    it("D with steps +3 produces [DG] (4th up)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nD|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 3, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[DG]");
    });

    it("C with steps +5 produces [CA] (6th up)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 5, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CA]");
    });
  });

  describe("chord harmonization", () => {
    it("[CA] with steps +2 produces chord with C, A, E, c (original notes then harmonies)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CA]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      // Algorithm inserts all harmony notes after original notes: [CA] -> [CAEc]
      expect(formatted).to.contain("[CAEc]");
    });

    it("[CE] with steps +2 produces chord with C, E, G, B (original notes then harmonies)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[CE]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      // C + 2 = E, E + 2 = G -> [CE] + harmonies = [CEEG]
      expect(formatted).to.contain("[CEEG]");
    });
  });

  describe("note with rhythm", () => {
    it("C2 with steps +2 produces [CE]2 (rhythm on chord)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC2|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CE]2");
    });

    it("D/2 with steps +2 produces [DF]/2", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nD/2|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[DF]/2");
    });
  });

  describe("note with tie", () => {
    it("C- with steps +2 produces [CE]- (tie preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC-|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CE]-");
    });
  });

  describe("note with accidental", () => {
    it("^C with steps +2 produces [^C^E] (accidental preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[^C^E]");
    });

    it("_B with steps -2 produces [_B_G] (flat preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_B|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, -2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[_B_G]");
    });
  });

  describe("steps of 0 is identity", () => {
    it("does not modify the note when steps is 0", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC|\n");
      const notes = findByTag(root, TAGS.Note);
      const beforeFormat = formatSelection({ root, cursors: [] });
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 0, ctx);
      const afterFormat = formatSelection(sel);
      expect(afterFormat).to.equal(beforeFormat);
    });
  });

  describe("multiple cursors", () => {
    it("harmonizes multiple selected notes independently", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC D E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id]), new Set([notes[2].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[CE]");
      expect(formatted).to.contain("[EG]");
      expect(formatted).to.match(/D/);
    });
  });

  describe("octave boundary crossings", () => {
    it("B with steps +2 produces [Bd] (crosses into octave 5)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nB|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, 2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[Bd]");
    });

    it("c with steps -2 produces [cA] (crosses into octave 4)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nc|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      harmonize(sel, -2, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[cA]");
    });
  });

  describe("property-based tests", () => {
    it("stepping up then down by the same amount returns equivalent pitch", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 7 }), (steps) => {
          const ctx = new ABCContext();
          const pitch = createPitch(ctx, "C");
          const steppedUp = stepDiatonic(pitch, steps, ctx);
          const steppedBack = stepDiatonic(steppedUp, -steps, ctx);
          const original = pitchToDiatonic(pitch);
          const result = pitchToDiatonic(steppedBack);
          expect(result.index).to.equal(original.index);
          expect(result.octave).to.equal(original.octave);
        }),
        { numRuns: 100 }
      );
    });

    it("diatonic index is always in range [0, 6]", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant("C"),
            fc.constant("D"),
            fc.constant("E"),
            fc.constant("F"),
            fc.constant("G"),
            fc.constant("A"),
            fc.constant("B"),
            fc.constant("c"),
            fc.constant("d"),
            fc.constant("e"),
            fc.constant("f"),
            fc.constant("g"),
            fc.constant("a"),
            fc.constant("b")
          ),
          fc.integer({ min: -14, max: 14 }),
          (letter, steps) => {
            const ctx = new ABCContext();
            const pitch = createPitch(ctx, letter);
            const stepped = stepDiatonic(pitch, steps, ctx);
            const result = pitchToDiatonic(stepped);
            expect(result.index).to.be.at.least(0);
            expect(result.index).to.be.at.most(6);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("stepping preserves accidentals", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant("^"), fc.constant("_"), fc.constant("^^"), fc.constant("__")),
          fc.integer({ min: -7, max: 7 }),
          (accidental, steps) => {
            const ctx = new ABCContext();
            const pitch = createPitch(ctx, "C", accidental);
            const result = stepDiatonic(pitch, steps, ctx);
            expect(result.alteration?.lexeme).to.equal(accidental);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("harmonizing a note produces a chord", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          // Select the first note that is not inside a chord or grace group
          const standaloneNotes = notes.filter((n) => {
            // Check if the note is inside a Chord or Grace_group
            const chords = findByTag(root, TAGS.Chord);
            for (const chord of chords) {
              let child = chord.firstChild;
              while (child !== null) {
                if (child.id === n.id) return false;
                child = child.nextSibling;
              }
            }
            // Also exclude notes inside grace groups
            const graceGroups = findByTag(root, TAGS.Grace_group);
            for (const graceGroup of graceGroups) {
              let child = graceGroup.firstChild;
              while (child !== null) {
                if (child.id === n.id) return false;
                child = child.nextSibling;
              }
            }
            return true;
          });
          if (standaloneNotes.length === 0) return;
          const targetNote = standaloneNotes[0];
          const sel: Selection = { root, cursors: [new Set([targetNote.id])] };
          harmonize(sel, 2, ctx);
          // After harmonizing, the formatted output should contain a chord
          const formatted = formatSelection(sel);
          expect(formatted).to.match(/\[.*\]/);
        }),
        { numRuns: 200 }
      );
    });

    it("harmonizing a chord increases note count", () => {
      fc.assert(
        fc.property(genAbcWithChords, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const chords = findByTag(root, TAGS.Chord);
          if (chords.length === 0) return;
          const chord = chords[0];
          // Count notes before
          let noteCountBefore = 0;
          let current = chord.firstChild;
          while (current !== null) {
            if (current.tag === TAGS.Note) noteCountBefore++;
            current = current.nextSibling;
          }
          if (noteCountBefore === 0) return;
          const sel: Selection = { root, cursors: [new Set([chord.id])] };
          harmonize(sel, 2, ctx);
          // Count notes after
          let noteCountAfter = 0;
          current = chord.firstChild;
          while (current !== null) {
            if (current.tag === TAGS.Note) noteCountAfter++;
            current = current.nextSibling;
          }
          expect(noteCountAfter).to.equal(noteCountBefore * 2);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("Automatic harmonization helpers", () => {
    function makeSnapshot(
      keyRoot: KeyRoot = KeyRoot.C,
      keyAcc: KeyAccidental = KeyAccidental.None,
      measureAccidentals: Map<string, number> = new Map()
    ): HarmonizeSnapshot {
      return {
        key: {
          root: keyRoot,
          acc: keyAcc,
          mode: Mode.Major,
          accidentals: [],
        },
        currentChord: null,
        measureAccidentals,
      };
    }

    describe("extractLead", () => {
      it("extracts 'E' in key of C as { letter: 'E', midi: 64, alteration: 0 }", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\nE|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "E", midi: 64, alteration: 0 });
      });

      it("extracts 'c' (lowercase) in key of C as { letter: 'C', midi: 72, alteration: 0 }", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\nc|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "C", midi: 72, alteration: 0 });
      });

      it("extracts note with explicit accidental: ^F in C gives F# (midi 66, alteration: 1)", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\n^F|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "F", midi: 66, alteration: 1 });
      });

      it("applies key signature: F in G major gives F# (midi 66, alteration: 1)", () => {
        const { root } = toCSTreeWithContext("X:1\nK:G\nF|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot(KeyRoot.G, KeyAccidental.None);
        // In G major, F is sharp
        snapshot.key.accidentals = [{ note: NoteLetter.F, acc: AccidentalType.Sharp, verticalPos: 0 }];
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "F", midi: 66, alteration: 1 });
      });

      it("applies measure accidentals over key signature", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\nF|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        snapshot.measureAccidentals.set("F", 1); // F# in measure
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "F", midi: 66, alteration: 1 });
      });

      it("handles octave markers: C, (comma) gives midi 48", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\nC,|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "C", midi: 48, alteration: 0 });
      });

      it("handles octave markers: c' (apostrophe) gives midi 84", () => {
        const { root } = toCSTreeWithContext("X:1\nK:C\nc'|\n");
        const notes = findByTag(root, TAGS.Note);
        const snapshot = makeSnapshot();
        const result = extractLead(notes[0], snapshot);
        expect(result).to.deep.equal({ letter: "C", midi: 84, alteration: 0 });
      });
    });

    describe("formatNote", () => {
      it('formatNote("^", "F", 4) returns "^F"', () => {
        expect(formatNote("^", "F", 4)).to.equal("^F");
      });

      it('formatNote("", "c", 5) returns "c"', () => {
        expect(formatNote("", "C", 5)).to.equal("c");
      });

      it('formatNote("", "C", 3) returns "C,"', () => {
        expect(formatNote("", "C", 3)).to.equal("C,");
      });

      it('formatNote("", "C", 2) returns "C,,"', () => {
        expect(formatNote("", "C", 2)).to.equal("C,,");
      });

      it('formatNote("", "C", 6) returns "c\'"', () => {
        expect(formatNote("", "C", 6)).to.equal("c'");
      });

      it('formatNote("_", "B", 4) returns "_B"', () => {
        expect(formatNote("_", "B", 4)).to.equal("_B");
      });

      it('formatNote("=", "F", 5) returns "=f"', () => {
        expect(formatNote("=", "F", 5)).to.equal("=f");
      });
    });

    describe("formatNote property tests", () => {
      it("output always starts with accidental (if any), then letter, then octave markers", () => {
        fc.assert(
          fc.property(
            fc.constantFrom("", "^", "_", "=", "^^", "__"),
            fc.constantFrom("C", "D", "E", "F", "G", "A", "B"),
            fc.integer({ min: 1, max: 7 }),
            (accidental, letter, octave) => {
              const result = formatNote(accidental, letter, octave);
              // Should start with accidental
              if (accidental !== "") {
                expect(result.startsWith(accidental)).to.be.true;
              }
              // Should contain the letter (uppercase or lowercase depending on octave)
              const letterPart = octave <= 4 ? letter.toUpperCase() : letter.toLowerCase();
              expect(result).to.include(letterPart);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    describe("extractLead property tests", () => {
      it("extracted midi is always in valid MIDI range 0-127", () => {
        fc.assert(
          fc.property(genAbcTune, (source) => {
            const { root } = toCSTreeWithContext(source);
            const notes = findByTag(root, TAGS.Note);
            if (notes.length === 0) return;
            const snapshot = makeSnapshot();
            const result = extractLead(notes[0], snapshot);
            if (result) {
              expect(result.midi).to.be.at.least(0);
              expect(result.midi).to.be.at.most(127);
            }
          }),
          { numRuns: 100 }
        );
      });
    });
  });

  describe("harmonizeVoicing end-to-end", () => {
    // This helper mirrors production: harmonizeVoicing needs snapshotAccidentals: true
    function harmonizeClose(input: string, noteIndex: number = -1): string {
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);
      const ast = parse(tokens, ctx);

      const analyzer = new SemanticAnalyzer(ctx);
      ast.accept(analyzer);

      // harmonizeVoicing needs measure accidentals to spell chord notes correctly
      const interpreter = new ContextInterpreter();
      const snapshots = interpreter.interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });

      const { root } = toCSTreeWithContext(input);
      const notes = findByTag(root, TAGS.Note);

      if (notes.length === 0) return formatSelection({ root, cursors: [] });

      // Select specific note by index, or last note if -1
      const targetIndex = noteIndex === -1 ? notes.length - 1 : noteIndex;
      const sel: Selection = { root, cursors: [new Set([notes[targetIndex].id])] };
      harmonizeVoicing(sel, "close", 4, null, ctx, snapshots);

      return formatSelection(sel);
    }

    it('"Cm7"_B -> "Cm7"[C_EG_B]', () => {
      const result = harmonizeClose('X:1\nK:C\n"Cm7"_B|\n');
      expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]|\n');
    });

    it('"G7"=B -> "G7"[DFGB]', () => {
      const result = harmonizeClose('X:1\nK:C\n"G7"=B|\n');
      expect(result).to.equal('X:1\nK:C\n"G7"[DFGB]|\n');
    });

    it('"Cm7"_B "G7"=B -> "Cm7"_B "G7"[DFG=B] (only harmonize last note)', () => {
      // After _B in the measure, B is flat by default. The G7 chord needs =B to indicate natural.
      const result = harmonizeClose('X:1\nK:C\n"Cm7"_B "G7"=B|\n');
      expect(result).to.equal('X:1\nK:C\n"Cm7"_B "G7"[DFG=B]|\n');
    });

    it('"Fm7b5"_c -> "Fm7b5"[_EF_A_c] (lead note Cb5 on top, others below)', () => {
      // Lead note _c (Cb5, MIDI 71) on top, close voicing places other notes below:
      // Eb4 (63), F4 (65), Ab4 (68), Cb5 (71)
      const result = harmonizeClose('X:1\nK:C\n"Fm7b5"_c|\n');
      expect(result).to.equal('X:1\nK:C\n"Fm7b5"[_EF_A_c]|\n');
    });

    it('"Fm7b5"_C -> "Fm7b5"[_E,F,_A,_C] (lead note Cb4 on top, others in octave 3)', () => {
      // Lead note _C (Cb4, MIDI 59) on top, close voicing places other notes below:
      // Eb3 (51), F3 (53), Ab3 (56), Cb4 (59)
      const result = harmonizeClose('X:1\nK:C\n"Fm7b5"_C|\n');
      expect(result).to.equal('X:1\nK:C\n"Fm7b5"[_E,F,_A,_C]|\n');
    });

    it('"C"c -> "C"[EGBc] (a lead that is the root C stays on top of the chord)', () => {
      const result = harmonizeClose('X:1\nK:C\n"C"c|\n');
      expect(result).to.equal('X:1\nK:C\n"C"[EGBc]|\n');
    });

    it('"Bb6"D -> "Bb6"[F,GB,D] (the sixth chord holds a G, not an A natural)', () => {
      const result = harmonizeClose('X:1\nK:Cm\n"Bb6"D|\n');
      expect(result).to.equal('X:1\nK:Cm\n"Bb6"[F,G,B,D]|\n');
    });

    describe("chord symbols written in another voice", () => {
      // Every note of the document is harmonized, so the helper takes the whole text.
      function harmonizeAll(input: string): string {
        const ctx = new ABCContext();
        const ast = parse(Scanner(input, ctx), ctx);
        const analyzer = new SemanticAnalyzer(ctx);
        ast.accept(analyzer);
        const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });
        const { root } = toCSTreeWithContext(input);
        const cursors = findByTag(root, TAGS.Note).map((n) => new Set([n.id]));
        const sel: Selection = { root, cursors };
        harmonizeVoicing(sel, "close", 4, null, ctx, snapshots, null);
        return formatSelection(sel);
      }

      it("uses the chord of the same bar, not the last chord of the chord voice", () => {
        const input = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" x8 | "Cm" x8 |\n[V:2] F8 | G8 |\n';
        const result = harmonizeAll(input);
        expect(result).to.contain("[V:2] [A,CEF]8 | [B,CEG]8 |");
      });

      it("ties only the notes that the next chord repeats at the same place", () => {
        // C (G B c e) to Am (G A c e): G, c and e are repeated at the same place from the top, B becomes A.
        const input = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 | "Am" x8 |\n[V:2] e8- | e8 |\n';
        expect(harmonizeAll(input)).to.contain("[V:2] [G-Bc-e-]8 | [GAce]8 |");
      });

      it("ties every note of a chord that is repeated", () => {
        const input = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 |\n[V:2] e4- e4 |\n';
        expect(harmonizeAll(input)).to.contain("[V:2] [G-B-c-e-]4 [GBce]4 |");
      });

      it("follows a chord change in the middle of a bar", () => {
        const input = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" x4 "Cm" x4 |\n[V:2] F4 G4 |\n';
        const result = harmonizeAll(input);
        expect(result).to.contain("[V:2] [A,CEF]4 [B,CEG]4 |");
      });
    });

    it("does not harmonize a note that is already inside a chord", () => {
      // Running the transform over a line twice must not nest chords.
      const result = harmonizeClose('X:1\nK:C\n"Cm7"[C_EG_B]|\n');
      expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]|\n');
    });

    describe("repairChordTies", () => {
      // The pitches are given by hand, so the test does not depend on a voicing.
      function repair(source: string, firstPitches: number[], nextPitches: number[]): string {
        const { root, ctx } = toCSTreeWithContext(source);
        const timeline = buildChordTimeline(root);
        const [first, next] = findByTag(root, TAGS.Chord);
        const state: TieRepairState = {
          pitchesByNodeId: new Map([
            [first.id, firstPitches],
            [next.id, nextPitches],
          ]),
          tiedChords: new Map([[first.id, first]]),
        };
        repairChordTies(state, timeline, ctx);
        return formatSelection({ root, cursors: [] });
      }

      it("drops the tie of a pitch that moves to another place from the top", () => {
        // E and G are in both chords, but one place lower from the top in the second chord, so no part may tie them.
        expect(repair("X:1\nK:C\n[CEG]2- [EGc]2 |\n", [60, 64, 67], [64, 67, 72])).to.equal("X:1\nK:C\n[CEG]2 [EGc]2 |\n");
      });

      it("ties the pitches that stay at the same place from the top", () => {
        expect(repair("X:1\nK:C\n[CEG]2- [DEG]2 |\n", [60, 64, 67], [62, 64, 67])).to.equal("X:1\nK:C\n[CE-G-]2 [DEG]2 |\n");
      });
    });

    describe("rhythm and tie of the harmonized note", () => {
      it("keeps a plain duration: \"Cm7\"_B3 -> \"Cm7\"[C_EG_B]3", () => {
        const result = harmonizeClose('X:1\nK:C\n"Cm7"_B3|\n');
        expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]3|\n');
      });

      it("keeps a fractional duration: \"Cm7\"_B3/ -> \"Cm7\"[C_EG_B]3/", () => {
        const result = harmonizeClose('X:1\nK:C\n"Cm7"_B3/|\n');
        expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]3/|\n');
      });

      it("keeps a broken rhythm marker: \"Cm7\"_B2> -> \"Cm7\"[C_EG_B]2>", () => {
        const result = harmonizeClose('X:1\nK:C\n"Cm7"_B2>c|\n', 0);
        expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]2>c|\n');
      });

      it("ties every note when the next chord is the same", () => {
        const result = harmonizeClose('X:1\nK:C\n"C" e4- e4 |\n', 0);
        // Only the first note is harmonized, so the tie goes to a note that the pass did not look at, and it stays on the chord.
        expect(result).to.equal('X:1\nK:C\n"C" [GBce]4- e4 |\n');
      });

      it("keeps a tie: \"Cm7\"_B2- -> \"Cm7\"[C_EG_B]2-", () => {
        const result = harmonizeClose('X:1\nK:C\n"Cm7"_B2-|\n');
        expect(result).to.equal('X:1\nK:C\n"Cm7"[C_EG_B]2-|\n');
      });
    });
  });
});
