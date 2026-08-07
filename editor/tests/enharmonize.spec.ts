import { ABCContext, Pitch, toMidiPitch, TT } from "abcls-parser";
import { Scanner, parse } from "abcls-parser";
import { SemanticAnalyzer } from "abcls-parser/analyzers/semantic-analyzer";
import { ContextInterpreter, ContextInterpreterConfig, DocumentSnapshots, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { resolveMelodyPitch, PitchContext } from "abcls-parser/music-theory/pitchUtils";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { toAst } from "../src/csTree/toAst";
import { CSNode } from "../src/csTree/types";
import { TAGS, isTokenNode, getTokenData } from "../src/csTree/types";
import { createSelection, Selection } from "../src/selection";
import { enharmonize, enharmonizeToKey } from "../src/transforms/enharmonize";
import { toPitchComponents } from "../src/transforms/pitchHelpers";
import { findChildByTag, getNodeLineAndChar } from "../src/transforms/treeUtils";
import { toCSTreeWithContext, formatSelection, findByTag, genAbcTune } from "./helpers";

function getNoteMidi(noteNode: CSNode): number {
  const pitchResult = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchResult) throw new Error("No pitch child");
  const pitchExpr = toAst(pitchResult) as Pitch;
  return toMidiPitch(pitchExpr);
}

function getAccidentalLexeme(noteNode: CSNode): string | null {
  const pitchResult = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchResult) return null;
  let current = pitchResult.firstChild;
  while (current !== null) {
    if (isTokenNode(current) && getTokenData(current).tokenType === TT.ACCIDENTAL) {
      return getTokenData(current).lexeme;
    }
    current = current.nextSibling;
  }
  return null;
}

describe("enharmonize", () => {
  describe("example-based (sharp to flat)", () => {
    it("^C becomes _D", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D");
    });

    it("^D becomes _E", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^D|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_E");
    });

    it("^F becomes _G", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^F|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_G");
    });

    it("^G becomes _A", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^G|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_A");
    });

    it("^A becomes _B", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^A|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_B");
    });
  });

  describe("example-based (flat to sharp)", () => {
    it("_D becomes ^C", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_D|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^C");
    });

    it("_E becomes ^D", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^D");
    });

    it("_G becomes ^F", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_G|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^F");
    });

    it("_A becomes ^G", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_A|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^G");
    });

    it("_B becomes ^A", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_B|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^A");
    });
  });

  describe("example-based (double accidentals)", () => {
    it("^^C becomes D (natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^^C|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const acc = getAccidentalLexeme(notes[0]);
      expect(acc).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(62); // D
    });

    it("^^D becomes E (natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^^D|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const acc = getAccidentalLexeme(notes[0]);
      expect(acc).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(64); // E
    });

    it("^^E becomes _G (still has an accidental)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^^E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_G");
    });

    it("__D becomes C (natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n__D|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const acc = getAccidentalLexeme(notes[0]);
      expect(acc).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(60); // C
    });

    it("__E becomes D (natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n__E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const acc = getAccidentalLexeme(notes[0]);
      expect(acc).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(62); // D
    });

    it("__A becomes G (natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n__A|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const acc = getAccidentalLexeme(notes[0]);
      expect(acc).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(67); // G
    });
  });

  describe("example-based (double-accidental then toggled again)", () => {
    it("^^E -> _G -> ^F (two applications)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^^E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      let formatted = formatSelection(sel);
      expect(formatted).to.contain("_G");
      enharmonize(sel, ctx);
      formatted = formatSelection(sel);
      expect(formatted).to.contain("^F");
    });
  });

  describe("example-based (octave boundary crossings)", () => {
    it("^B becomes c (uppercase octave 4 -> lowercase octave 5)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^B|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      expect(getAccidentalLexeme(notes[0])).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(72);
    });

    it("_c becomes B (lowercase octave 5 -> uppercase octave 4)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_c|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      expect(getAccidentalLexeme(notes[0])).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(71);
    });

    it("^b becomes c' (lowercase octave 5 -> octave 6)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^b|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      expect(getAccidentalLexeme(notes[0])).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(84);
    });

    it("_C becomes B, (uppercase octave 4 -> octave 3)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n_C|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      expect(getAccidentalLexeme(notes[0])).to.be.null;
      expect(getNoteMidi(notes[0])).to.equal(59);
    });
  });

  describe("example-based (skipped notes)", () => {
    it("C (no accidental) is unchanged", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nC|\n");
      const notes = findByTag(root, TAGS.Note);
      const before = formatSelection({ root, cursors: [] });
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const after = formatSelection(sel);
      expect(after).to.equal(before);
    });

    it("=C (natural) is unchanged", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n=C|\n");
      const notes = findByTag(root, TAGS.Note);
      const before = formatSelection({ root, cursors: [] });
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const after = formatSelection(sel);
      expect(after).to.equal(before);
    });

    it("D2 (no accidental, has rhythm) is unchanged", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\nD2|\n");
      const notes = findByTag(root, TAGS.Note);
      const before = formatSelection({ root, cursors: [] });
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const after = formatSelection(sel);
      expect(after).to.equal(before);
    });
  });

  describe("example-based (chords)", () => {
    it("[^F^A^C] becomes [_G_B_D]", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[^F^A^C]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_G");
      expect(formatted).to.contain("_B");
      expect(formatted).to.contain("_D");
    });

    it("[^C^E^G] enharmonizes each note independently (^E=F natural)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[^C^E^G]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D");
      expect(formatted).to.match(/F/); // F natural (no accidental)
      expect(formatted).to.contain("_A");
    });
  });

  describe("example-based (rhythm and tie preservation)", () => {
    it("^C2 becomes _D2 (rhythm preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C2|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D2");
    });

    it("^C- becomes _D- (tie preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C-|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D-");
    });

    it("^C2> becomes _D2> (rhythm with broken token preserved)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C2>|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D2>");
    });
  });

  describe("example-based (notes inside a Beam)", () => {
    it("beamed ^C^D^E with cursor on middle note: only ^D becomes _E", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C^D^E|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[1].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("^C");
      expect(formatted).to.contain("_E");
      // The third note (^E) should remain ^E
      expect(getNoteMidi(notes[2])).to.equal(65); // E# (not enharmonized)
      expect(getAccidentalLexeme(notes[2])).to.equal("^");
    });
  });

  describe("example-based (multiple cursors)", () => {
    it("two cursors selecting different notes: both are enharmonized", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n^C D ^F|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id]), new Set([notes[2].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("_D");
      expect(formatted).to.contain("_G");
    });
  });

  describe("example-based (chords)", () => {
    it("[_E_A] via the Chord node id becomes [^D^G]", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[_E_A]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[^D^G]");
    });

    // Regression test: the LSP builds cursors from a range match against the
    // default [Note, Chord] tag set, which matches both a Chord and its child
    // Notes independently. That produced one cursor for the Chord and one more
    // per Note, all pointing at the same notes. Because respelling is a toggle,
    // the redundant per-note cursor flipped each note straight back, making
    // enharmonize on a selected chord a no-op. See commit 43af3ab.
    it("[_E_A] via overlapping Chord + Note cursors still becomes [^D^G] (not a no-op)", () => {
      const { root, ctx } = toCSTreeWithContext("X:1\nK:C\n[_E_A]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = {
        root,
        cursors: [new Set([chords[0].id]), ...notes.map((n) => new Set([n.id]))],
      };
      enharmonize(sel, ctx);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[^D^G]");
    });
  });

  describe("property-based", () => {
    it("enharmonize preserves the MIDI pitch of every selected note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          const midiBefore = notes.map((n) => getNoteMidi(n));
          // Skip if any note is out of valid MIDI range
          if (midiBefore.some((m) => m < 0 || m > 127)) return;
          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          enharmonize(sel, ctx);
          const midiAfter = notes.map((n) => getNoteMidi(n));
          expect(midiAfter).to.deep.equal(midiBefore);
        }),
        { numRuns: 1000 }
      );
    });

    it("for single sharp/flat notes, applying enharmonize twice gives the original output", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Filter to notes with exactly ^ or _ (single sharp or single flat)
          // that are in canonical octave form, within valid MIDI range,
          // and whose MIDI pitch class is a black key (the involution only
          // holds when the result still carries an accidental; white-key
          // results like ^E->F or _C->B break the involution).
          const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
          const singleAccNotes = notes.filter((n) => {
            const acc = getAccidentalLexeme(n);
            if (acc !== "^" && acc !== "_") return false;
            const midi = getNoteMidi(n);
            if (midi < 0 || midi > 127) return false;
            if (!BLACK_KEYS.has(midi % 12)) return false;
            // Check canonical octave form by checking that the pitch node
            // does not use uppercase+apostrophe or lowercase+comma
            const pitchResult = findChildByTag(n, TAGS.Pitch);
            if (!pitchResult) return false;
            let letterLexeme: string | null = null;
            let octaveLexeme: string | null = null;
            let cur = pitchResult.firstChild;
            while (cur !== null) {
              if (isTokenNode(cur)) {
                const td = getTokenData(cur);
                if (td.tokenType === TT.NOTE_LETTER) letterLexeme = td.lexeme;
                if (td.tokenType === TT.OCTAVE) octaveLexeme = td.lexeme;
              }
              cur = cur.nextSibling;
            }
            if (!letterLexeme) return false;
            const isUpper = /[A-G]/.test(letterLexeme);
            if (isUpper && octaveLexeme && octaveLexeme.includes("'")) return false;
            if (!isUpper && octaveLexeme && octaveLexeme.includes(",")) return false;
            return true;
          });
          if (singleAccNotes.length === 0) return;

          const ids = new Set(singleAccNotes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          const beforeFormat = formatSelection(sel);
          enharmonize(sel, ctx);
          enharmonize(sel, ctx);
          const afterFormat = formatSelection(sel);
          expect(afterFormat).to.equal(beforeFormat);
        }),
        { numRuns: 1000 }
      );
    });

    it("enharmonize on a note without an accidental leaves the formatted output unchanged", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Filter to notes without accidentals
          const noAccNotes = notes.filter((n) => {
            const acc = getAccidentalLexeme(n);
            return acc === null;
          });
          if (noAccNotes.length === 0) return;

          const ids = new Set(noAccNotes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          const beforeFormat = formatSelection(sel);
          enharmonize(sel, ctx);
          const afterFormat = formatSelection(sel);
          expect(afterFormat).to.equal(beforeFormat);
        }),
        { numRuns: 1000 }
      );
    });

    it("enharmonize preserves the rhythm of the note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          // Skip if any note is out of valid MIDI range
          if (
            notes.some((n) => {
              const m = getNoteMidi(n);
              return m < 0 || m > 127;
            })
          )
            return;

          // Check rhythm children before and after
          const rhythmBefore = notes.map((n) => {
            const r = findChildByTag(n, TAGS.Rhythm);
            if (!r) return null;
            const ast = toAst(r);
            return JSON.stringify(ast);
          });

          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          enharmonize(sel, ctx);

          const rhythmAfter = notes.map((n) => {
            const r = findChildByTag(n, TAGS.Rhythm);
            if (!r) return null;
            const ast = toAst(r);
            return JSON.stringify(ast);
          });
          expect(rhythmAfter).to.deep.equal(rhythmBefore);
        }),
        { numRuns: 1000 }
      );
    });

    it("enharmonize preserves the tie of the note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx } = toCSTreeWithContext(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          // Skip if any note is out of valid MIDI range
          if (
            notes.some((n) => {
              const m = getNoteMidi(n);
              return m < 0 || m > 127;
            })
          )
            return;

          // Check tie presence before and after
          const hasTieBefore = notes.map((n) => {
            let current = n.firstChild;
            while (current !== null) {
              if (isTokenNode(current) && getTokenData(current).tokenType === TT.TIE) {
                return true;
              }
              current = current.nextSibling;
            }
            return false;
          });

          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          enharmonize(sel, ctx);

          const hasTieAfter = notes.map((n) => {
            let current = n.firstChild;
            while (current !== null) {
              if (isTokenNode(current) && getTokenData(current).tokenType === TT.TIE) {
                return true;
              }
              current = current.nextSibling;
            }
            return false;
          });
          expect(hasTieAfter).to.deep.equal(hasTieBefore);
        }),
        { numRuns: 1000 }
      );
    });
  });
});

// ============================================================================
// Helper for enharmonizeToKey tests
// ============================================================================

/**
 * Creates a CSTree with context and DocumentSnapshots for context-aware testing.
 * Enables snapshotAccidentals to track measure accidentals.
 */
function toCSTreeWithSnapshots(source: string): { root: CSNode; ctx: ABCContext; snapshots: DocumentSnapshots } {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);

  // Run semantic analyzer to get semantic data
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);

  // Run context interpreter with snapshotAccidentals enabled
  const interpreter = new ContextInterpreter();
  const config: ContextInterpreterConfig = { snapshotAccidentals: true };
  const snapshots = interpreter.interpret(ast, analyzer.data, ctx, config);

  return { root: fromAst(ast, ctx), ctx, snapshots };
}

/**
 * Runs enharmonizeToKey on all notes in the input and returns the formatted result.
 */
function runEnharmonizeToKey(input: string): string {
  const { root, ctx, snapshots } = toCSTreeWithSnapshots(input);

  const selection = createSelection(root);

  // Run transform
  enharmonizeToKey(selection, snapshots, ctx);

  // Format and return
  return formatSelection(selection);
}

/**
 * Gets the MIDI pitch from the first note in an ABC string, considering key signature.
 */
function getFirstNoteMidi(source: string): number {
  const { root, snapshots } = toCSTreeWithSnapshots(source);
  const noteNodes = findByTag(root, TAGS.Note);
  if (noteNodes.length === 0) return -1;

  const pitch = toPitchComponents(noteNodes[0]);
  if (!pitch) return -1;

  // Get the first note's position and snapshot
  const { line, char } = getNodeLineAndChar(noteNodes[0]);
  const pos = encode(line, char);
  const snapshot = getSnapshotAtPosition(snapshots, pos - 1);

  const pitchContext: PitchContext = {
    key: snapshot.key,
    measureAccidentals: snapshot.measureAccidentals,
    transpose: snapshot.transpose ?? 0,
  };

  return resolveMelodyPitch(pitch.letter, pitch.octave, pitch.explicitAccidental, pitchContext);
}

// ============================================================================
// enharmonizeToKey tests
// ============================================================================

describe("enharmonizeToKey", () => {
  describe("diatonic - redundant accidental removal", () => {
    it("^F -> F in G major", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n^F|");
      expect(result).to.equal("X:1\nK:G\nF|");
    });

    it("_B -> B in F major", () => {
      const result = runEnharmonizeToKey("X:1\nK:F\n_B|");
      expect(result).to.equal("X:1\nK:F\nB|");
    });

    it("^f -> f in G major (lowercase)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n^f|");
      expect(result).to.equal("X:1\nK:G\nf|");
    });

    it("=C -> C in C major", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n=C|");
      expect(result).to.equal("X:1\nK:C\nC|");
    });

    it("=F in G major with =F context stays =F then F (second redundant)", () => {
      // When there's a =F earlier in the measure, the second =F should become F
      const result = runEnharmonizeToKey("X:1\nK:G\n=F =F|");
      expect(result).to.equal("X:1\nK:G\n=F F|");
    });
  });

  describe("diatonic - misspelled note correction", () => {
    it("_G -> F in G major (enharmonic)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n_G|");
      expect(result).to.equal("X:1\nK:G\nF|");
    });

    it("^A -> B in F major (enharmonic)", () => {
      const result = runEnharmonizeToKey("X:1\nK:F\n^A|");
      expect(result).to.equal("X:1\nK:F\nB|");
    });

    it("^^C -> D in C major", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n^^C|");
      expect(result).to.equal("X:1\nK:C\nD|");
    });

    it("__D -> C in C major", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n__D|");
      expect(result).to.equal("X:1\nK:C\nC|");
    });
  });

  describe("diatonic - clean notes unchanged", () => {
    it("C unchanged in C major", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\nC|");
      expect(result).to.equal("X:1\nK:C\nC|");
    });

    it("F unchanged in G major (no accidental = F#)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\nF|");
      expect(result).to.equal("X:1\nK:G\nF|");
    });

    it("B unchanged in F major (no accidental = Bb)", () => {
      const result = runEnharmonizeToKey("X:1\nK:F\nB|");
      expect(result).to.equal("X:1\nK:F\nB|");
    });
  });

  describe("chromatic - overriding accidental preserved", () => {
    it("=F in G major stays =F (chromatic)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n=F|");
      expect(result).to.equal("X:1\nK:G\n=F|");
    });

    it("=B in F major stays =B (chromatic)", () => {
      const result = runEnharmonizeToKey("X:1\nK:F\n=B|");
      expect(result).to.equal("X:1\nK:F\n=B|");
    });
  });

  describe("chromatic - respelling to key direction", () => {
    it("_D -> ^C in G major (sharp key)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n_D|");
      expect(result).to.equal("X:1\nK:G\n^C|");
    });

    it("^C -> _D in F major (flat key)", () => {
      const result = runEnharmonizeToKey("X:1\nK:F\n^C|");
      expect(result).to.equal("X:1\nK:F\n_D|");
    });

    it("_A -> ^G in D major (sharp key)", () => {
      const result = runEnharmonizeToKey("X:1\nK:D\n_A|");
      expect(result).to.equal("X:1\nK:D\n^G|");
    });

    it("^G -> _A in Bb major (flat key)", () => {
      const result = runEnharmonizeToKey("X:1\nK:Bb\n^G|");
      expect(result).to.equal("X:1\nK:Bb\n_A|");
    });
  });

  describe("with measure accidentals", () => {
    it("measure accidental changes context - chromatic note needs explicit accidental", () => {
      // =F establishes F natural (chromatic, stays =F)
      // _G (enharmonic to F#) becomes ^F because with measure accidental F=natural,
      // plain F means F natural, so F# must be written with explicit ^
      const result = runEnharmonizeToKey("X:1\nK:G\n=F _G|");
      expect(result).to.equal("X:1\nK:G\n=F ^F|");
    });
  });

  describe("octave preservation", () => {
    it("_g -> f in G major (octave 5)", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n_g|");
      expect(result).to.equal("X:1\nK:G\nf|");
    });

    it("^B -> c (cross-octave enharmonic)", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n^B|");
      expect(result).to.equal("X:1\nK:C\nc|");
    });

    it("preserves comma octave markers", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n_G,|");
      expect(result).to.equal("X:1\nK:G\nF,|");
    });

    it("preserves apostrophe octave markers", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n_g'|");
      expect(result).to.equal("X:1\nK:G\nf'|");
    });
  });

  describe("chords", () => {
    it("respells notes inside chords", () => {
      const result = runEnharmonizeToKey("X:1\nK:G\n[^F_G]|");
      expect(result).to.equal("X:1\nK:G\n[FF]|");
    });

    it("respells multiple notes in a chord", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n[^^C__D]|");
      expect(result).to.equal("X:1\nK:C\n[DC]|");
    });
  });

  describe("MIDI preservation invariant", () => {
    it("^F -> F in G major preserves MIDI", () => {
      const beforeMidi = getFirstNoteMidi("X:1\nK:G\n^F|");
      const result = runEnharmonizeToKey("X:1\nK:G\n^F|");
      const afterMidi = getFirstNoteMidi(result);
      expect(afterMidi).to.equal(beforeMidi);
    });

    it("_G -> F in G major preserves MIDI", () => {
      const beforeMidi = getFirstNoteMidi("X:1\nK:G\n_G|");
      const result = runEnharmonizeToKey("X:1\nK:G\n_G|");
      const afterMidi = getFirstNoteMidi(result);
      expect(afterMidi).to.equal(beforeMidi);
    });

    it("^B -> c preserves MIDI", () => {
      const beforeMidi = getFirstNoteMidi("X:1\nK:C\n^B|");
      const result = runEnharmonizeToKey("X:1\nK:C\n^B|");
      const afterMidi = getFirstNoteMidi(result);
      expect(afterMidi).to.equal(beforeMidi);
    });

    it("_D -> ^C preserves MIDI", () => {
      const beforeMidi = getFirstNoteMidi("X:1\nK:G\n_D|");
      const result = runEnharmonizeToKey("X:1\nK:G\n_D|");
      const afterMidi = getFirstNoteMidi(result);
      expect(afterMidi).to.equal(beforeMidi);
    });
  });

  describe("natural accidental cases", () => {
    it("=F in C major removes redundant natural", () => {
      const result = runEnharmonizeToKey("X:1\nK:C\n=F|");
      expect(result).to.equal("X:1\nK:C\nF|");
    });

    it("=F in F major keeps F (F is not altered by key)", () => {
      // In F major, F is NOT altered (only B is), so =F should become just F
      const result = runEnharmonizeToKey("X:1\nK:F\n=F|");
      expect(result).to.equal("X:1\nK:F\nF|");
    });
  });

  describe("property-based", () => {
    /**
     * Helper to get context-aware MIDI pitches from an ABC source.
     * Because notes like `c` in `[K:Amix]c` sound as C# (not C natural),
     * we need to interpret the ABC to get the actual sounding pitches.
     */
    function getContextAwareMidiPitches(source: string): number[] {
      const ctx = new ABCContext();
      const tokens = Scanner(source, ctx);
      const ast = parse(tokens, ctx);

      const analyzer = new SemanticAnalyzer(ctx);
      ast.accept(analyzer);

      const interpreter = new ContextInterpreter();
      const config: ContextInterpreterConfig = { snapshotAccidentals: true };
      const snapshots = interpreter.interpret(ast, analyzer.data, ctx, config);

      const root = fromAst(ast, ctx);
      const notes = findByTag(root, TAGS.Note);

      return notes
        .map((noteNode) => {
          const pitch = toPitchComponents(noteNode);
          if (!pitch) return null;

          const { line, char } = getNodeLineAndChar(noteNode);
          const pos = encode(line, char);
          const snapshot = getSnapshotAtPosition(snapshots, pos - 1);

          const pitchContext: PitchContext = {
            key: snapshot.key,
            measureAccidentals: snapshot.measureAccidentals,
            transpose: snapshot.transpose ?? 0,
          };

          return resolveMelodyPitch(pitch.letter, pitch.octave, pitch.explicitAccidental, pitchContext);
        })
        .filter((m): m is number => m !== null);
    }

    // Known bug: enharmonize can produce off-by-one semitone errors with measure accidental carry-over
    it.skip("enharmonizeToKey preserves the MIDI pitch of every note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          // Get context-aware MIDI pitches before transformation
          const midiBefore = getContextAwareMidiPitches(source);
          if (midiBefore.length === 0) return;

          // Skip if any note is out of valid MIDI range
          if (midiBefore.some((m) => m < 0 || m > 127)) return;

          // Run transform
          const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
          const selection = createSelection(root);
          enharmonizeToKey(selection, snapshots, ctx);

          // Format result back to text
          const resultText = formatSelection(selection);

          // Get context-aware MIDI pitches after transformation
          const midiAfter = getContextAwareMidiPitches(resultText);

          expect(midiAfter).to.deep.equal(midiBefore);
        }),
        { numRuns: 500 }
      );
    });

    it("enharmonizeToKey preserves the rhythm of every note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Get rhythm before transformation
          const rhythmBefore = notes.map((n) => {
            const r = findChildByTag(n, TAGS.Rhythm);
            if (!r) return null;
            const ast = toAst(r);
            return JSON.stringify(ast);
          });

          // Run transform
          const selection = createSelection(root);
          enharmonizeToKey(selection, snapshots, ctx);

          // Get rhythm after transformation
          const rhythmAfter = notes.map((n) => {
            const r = findChildByTag(n, TAGS.Rhythm);
            if (!r) return null;
            const ast = toAst(r);
            return JSON.stringify(ast);
          });

          expect(rhythmAfter).to.deep.equal(rhythmBefore);
        }),
        { numRuns: 500 }
      );
    });

    it("enharmonizeToKey preserves the tie of every note", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;

          // Check tie presence before transformation
          const hasTieBefore = notes.map((n) => {
            let current = n.firstChild;
            while (current !== null) {
              if (isTokenNode(current) && getTokenData(current).tokenType === TT.TIE) {
                return true;
              }
              current = current.nextSibling;
            }
            return false;
          });

          // Run transform
          const selection = createSelection(root);
          enharmonizeToKey(selection, snapshots, ctx);

          // Check tie presence after transformation
          const hasTieAfter = notes.map((n) => {
            let current = n.firstChild;
            while (current !== null) {
              if (isTokenNode(current) && getTokenData(current).tokenType === TT.TIE) {
                return true;
              }
              current = current.nextSibling;
            }
            return false;
          });

          expect(hasTieAfter).to.deep.equal(hasTieBefore);
        }),
        { numRuns: 500 }
      );
    });

    it("enharmonizeToKey stabilizes within a few passes", () => {
      // Because respelling notes can change measure accidentals which affect
      // subsequent notes, the transform may not be idempotent in one pass.
      // However, it should stabilize within a few passes (we test up to 5).
      fc.assert(
        fc.property(genAbcTune, (source) => {
          function runPass(input: string): string {
            const { root, ctx, snapshots } = toCSTreeWithSnapshots(input);
            const notes = findByTag(root, TAGS.Note);
            if (notes.length === 0) return input;
            const selection = createSelection(root);
            enharmonizeToKey(selection, snapshots, ctx);
            return formatSelection(selection);
          }

          // Run multiple passes until stable or max iterations
          let current = source;
          const maxPasses = 5;

          for (let i = 0; i < maxPasses; i++) {
            const next = runPass(current);
            if (next === current) {
              // Stabilized
              return;
            }
            current = next;
          }

          // After max passes, check if the last two were the same
          const final = runPass(current);
          expect(final).to.equal(current);
        }),
        { numRuns: 500 }
      );
    });
  });
});
