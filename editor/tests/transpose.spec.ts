import { ABCContext, Pitch, toMidiPitch, Scanner, parse } from "abcls-parser";
import { SemanticAnalyzer } from "abcls-parser/analyzers/semantic-analyzer";
import { ContextInterpreter, DocumentSnapshots, ContextInterpreterConfig } from "abcls-parser/interpreter/ContextInterpreter";
import { NATURAL_SEMITONES, LETTERS } from "abcls-parser/music-theory/constants";
import { mergeAccidentals } from "abcls-parser/music-theory/harmonization";
import { spellPitch, resolveMelodyPitch, computeOctaveFromPitch, PitchContext } from "abcls-parser/music-theory/pitchUtils";
import { KeySignature, AccidentalType, KeyRoot, KeyAccidental, Mode } from "abcls-parser/types/abcjs-ast";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import * as ParserGen from "../../parse/tests/prs_pbt.generators.spec";
import { fromAst } from "../src/csTree/fromAst";
import { toAst } from "../src/csTree/toAst";
import { CSNode, TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { transpose } from "../src/transforms/transpose";
import { findChildByTag } from "../src/transforms/treeUtils";
import { formatSelection, findByTag, genAbcTune } from "./helpers";

// ============================================================================
// Generators for property tests (matching transpo_test.lua spec)
// ============================================================================

/**
 * Hardcoded major keys with their accidentals.
 * The accidentals array is populated to match what the parser would produce.
 * We use a cast because Accidental requires verticalPos which we don't need for tests.
 */
const genKeySignature: fc.Arbitrary<KeySignature> = fc.constantFrom(
  { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] },
  { root: KeyRoot.G, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [{ note: "F", acc: AccidentalType.Sharp }] },
  {
    root: KeyRoot.D,
    acc: KeyAccidental.None,
    mode: Mode.Major,
    accidentals: [
      { note: "F", acc: AccidentalType.Sharp },
      { note: "C", acc: AccidentalType.Sharp },
    ],
  },
  {
    root: KeyRoot.A,
    acc: KeyAccidental.None,
    mode: Mode.Major,
    accidentals: [
      { note: "F", acc: AccidentalType.Sharp },
      { note: "C", acc: AccidentalType.Sharp },
      { note: "G", acc: AccidentalType.Sharp },
    ],
  },
  {
    root: KeyRoot.E,
    acc: KeyAccidental.None,
    mode: Mode.Major,
    accidentals: [
      { note: "F", acc: AccidentalType.Sharp },
      { note: "C", acc: AccidentalType.Sharp },
      { note: "G", acc: AccidentalType.Sharp },
      { note: "D", acc: AccidentalType.Sharp },
    ],
  },
  {
    root: KeyRoot.B,
    acc: KeyAccidental.None,
    mode: Mode.Major,
    accidentals: [
      { note: "F", acc: AccidentalType.Sharp },
      { note: "C", acc: AccidentalType.Sharp },
      { note: "G", acc: AccidentalType.Sharp },
      { note: "D", acc: AccidentalType.Sharp },
      { note: "A", acc: AccidentalType.Sharp },
    ],
  },
  { root: KeyRoot.F, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [{ note: "B", acc: AccidentalType.Flat }] },
  {
    root: KeyRoot.B,
    acc: KeyAccidental.Flat,
    mode: Mode.Major,
    accidentals: [
      { note: "B", acc: AccidentalType.Flat },
      { note: "E", acc: AccidentalType.Flat },
    ],
  },
  {
    root: KeyRoot.E,
    acc: KeyAccidental.Flat,
    mode: Mode.Major,
    accidentals: [
      { note: "B", acc: AccidentalType.Flat },
      { note: "E", acc: AccidentalType.Flat },
      { note: "A", acc: AccidentalType.Flat },
    ],
  },
  {
    root: KeyRoot.A,
    acc: KeyAccidental.Flat,
    mode: Mode.Major,
    accidentals: [
      { note: "B", acc: AccidentalType.Flat },
      { note: "E", acc: AccidentalType.Flat },
      { note: "A", acc: AccidentalType.Flat },
      { note: "D", acc: AccidentalType.Flat },
    ],
  },
  {
    root: KeyRoot.D,
    acc: KeyAccidental.Flat,
    mode: Mode.Major,
    accidentals: [
      { note: "B", acc: AccidentalType.Flat },
      { note: "E", acc: AccidentalType.Flat },
      { note: "A", acc: AccidentalType.Flat },
      { note: "D", acc: AccidentalType.Flat },
      { note: "G", acc: AccidentalType.Flat },
    ],
  },
  {
    root: KeyRoot.G,
    acc: KeyAccidental.Flat,
    mode: Mode.Major,
    accidentals: [
      { note: "B", acc: AccidentalType.Flat },
      { note: "E", acc: AccidentalType.Flat },
      { note: "A", acc: AccidentalType.Flat },
      { note: "D", acc: AccidentalType.Flat },
      { note: "G", acc: AccidentalType.Flat },
      { note: "C", acc: AccidentalType.Flat },
    ],
  }
) as fc.Arbitrary<KeySignature>;

/**
 * Generator for measure accidentals map (0-3 entries).
 * Values are converted to semitones for use with mergeAccidentals.
 */
const genMeasureAccidentals: fc.Arbitrary<Map<string, number>> = fc
  .array(fc.tuple(fc.constantFrom("C", "D", "E", "F", "G", "A", "B"), fc.constantFrom(-2, -1, 0, 1, 2)), { minLength: 0, maxLength: 3 })
  .map((pairs) => new Map(pairs));

/**
 * Non-zero semitone offset for testing spellPitch.
 */
const genSemitoneOffset: fc.Arbitrary<number> = fc.integer({ min: -11, max: 11 });

/**
 * Non-octave offset (not a multiple of 12).
 * Defined in transpo_test.lua spec for potential future use.
 * Currently unused because P1-P4 use genSemitoneOffset.
 */
const _genNonOctaveOffset: fc.Arbitrary<number> = fc.integer({ min: -23, max: 23 }).filter((n) => n % 12 !== 0);

/**
 * Octave offset (±12, ±24).
 */
const genOctaveOffset: fc.Arbitrary<number> = fc.constantFrom(-24, -12, 12, 24);

/**
 * Safe note expression filtered to MIDI range 24-103.
 * Uses the existing genNoteExpr from parser generators.
 */
const genSafeNoteExpr = ParserGen.genNoteExpr.filter(({ expr }) => {
  const midi = toMidiPitch(expr.pitch);
  return midi >= 24 && midi <= 103;
});

/**
 * Helper to extract pitch components from a Pitch AST node.
 */
function extractPitchComponents(pitchExpr: Pitch): {
  letter: string;
  octave: number;
  explicitAcc: string | null;
} {
  const letter = pitchExpr.noteLetter.lexeme.toUpperCase();
  const octave = computeOctaveFromPitch(pitchExpr);
  const explicitAcc = pitchExpr.alteration ? pitchExpr.alteration.lexeme : null;
  return { letter, octave, explicitAcc };
}

/**
 * Safe modulo that handles negative numbers correctly.
 */
function safeMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Converts a Map<string, number> (semitones) to Map<string, AccidentalType>.
 * This is needed because genMeasureAccidentals produces semitones, but
 * PitchContext.measureAccidentals expects AccidentalType.
 */
function semitonesToAccidentalTypeMap(semitoneMap: Map<string, number>): Map<string, AccidentalType> {
  return new Map(
    Array.from(semitoneMap.entries()).map(([k, semitone]) => {
      let accidentalType;
      if (semitone === 2) {
        accidentalType = AccidentalType.DblSharp;
      } else if (semitone === 1) {
        accidentalType = AccidentalType.Sharp;
      } else if (semitone === 0) {
        accidentalType = AccidentalType.Natural;
      } else if (semitone === -1) {
        accidentalType = AccidentalType.Flat;
      } else {
        accidentalType = AccidentalType.DblFlat;
      }
      return [k, accidentalType];
    })
  );
}

/**
 * Builds a PitchContext from a key signature and measure accidentals map.
 */
function buildPitchContext(key: KeySignature, measureAcc: Map<string, number>): PitchContext {
  return {
    key,
    measureAccidentals: semitonesToAccidentalTypeMap(measureAcc),
    transpose: 0,
  };
}

// ============================================================================
// Helper functions
// ============================================================================

function getNoteMidi(noteNode: CSNode): number {
  const pitchResult = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchResult) throw new Error("No pitch child");
  const pitchExpr = toAst(pitchResult) as Pitch;
  return toMidiPitch(pitchExpr);
}

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
 * Gets the accidental string from a note node (e.g., "^", "_", "=", or "").
 */
function getNoteAccidental(noteNode: CSNode): string {
  const pitchResult = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchResult) return "";
  const pitchExpr = toAst(pitchResult) as Pitch;
  return pitchExpr.alteration?.lexeme ?? "";
}

/**
 * Gets the note letter from a note node (preserving case).
 */
function getNoteLetter(noteNode: CSNode): string {
  const pitchResult = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchResult) return "";
  const pitchExpr = toAst(pitchResult) as Pitch;
  return pitchExpr.noteLetter.lexeme;
}

describe("transpose", () => {
  describe("example-based", () => {
    it("transposes C by 2 semitones to D", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      transpose(sel, 2, ctx, snapshots);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("D");
    });

    it("transposes B by 1 semitone to c (crosses octave boundary)", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nB|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      transpose(sel, 1, ctx, snapshots);
      const midi = getNoteMidi(notes[0]);
      expect(midi).to.equal(72); // c (one octave above middle C)
    });

    it("transposes a chord [CEG] by 7 semitones", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n[CEG]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      transpose(sel, 7, ctx, snapshots);
      const chordNotes = findByTag(chords[0], TAGS.Note);
      const midis = chordNotes.map((n) => getNoteMidi(n));
      expect(midis[0]).to.equal(67); // G
      expect(midis[1]).to.equal(71); // B
      expect(midis[2]).to.equal(74); // d
    });

    it("octave-down on [fa] yields [FA]", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n[fa]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
      transpose(sel, -12, ctx, snapshots);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[FA]");
    });

    // Regression test: the LSP builds cursors from a range match against the
    // default [Note, Chord] tag set, which matches both a Chord and its child
    // Notes independently. That produced one cursor for the Chord and one more
    // per Note, all pointing at the same notes. Since transposition is additive
    // (not a toggle like enharmonize), the redundant per-note cursor applied
    // the shift a second time, so octave-down on a selected chord shifted it
    // down two octaves instead of one (e.g. [fa] -> [F,A,] instead of [FA]).
    // See commit 43af3ab.
    it("octave-down on [fa] via overlapping Chord + Note cursors still yields [FA] (not a double shift)", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n[fa]|\n");
      const chords = findByTag(root, TAGS.Chord);
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = {
        root,
        cursors: [new Set([chords[0].id]), ...notes.map((n) => new Set([n.id]))],
      };
      transpose(sel, -12, ctx, snapshots);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("[FA]");
    });

    it("transposes only the selected note when cursor selects one note", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC D E|\n");
      const notes = findByTag(root, TAGS.Note);
      const midiBefore = notes.map((n) => getNoteMidi(n));
      const sel: Selection = { root, cursors: [new Set([notes[1].id])] };
      transpose(sel, 2, ctx, snapshots);
      expect(getNoteMidi(notes[0])).to.equal(midiBefore[0]);
      expect(getNoteMidi(notes[1])).to.equal(midiBefore[1] + 2);
      expect(getNoteMidi(notes[2])).to.equal(midiBefore[2]);
    });

    it("two cursors selecting different notes transposes both independently", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC D E|\n");
      const notes = findByTag(root, TAGS.Note);
      const midiBefore = notes.map((n) => getNoteMidi(n));
      const sel: Selection = { root, cursors: [new Set([notes[0].id]), new Set([notes[2].id])] };
      transpose(sel, 3, ctx, snapshots);
      expect(getNoteMidi(notes[0])).to.equal(midiBefore[0] + 3);
      expect(getNoteMidi(notes[1])).to.equal(midiBefore[1]);
      expect(getNoteMidi(notes[2])).to.equal(midiBefore[2] + 3);
    });

    it("transpose preserves rhythm: C2 transposed by 2 gives D2", () => {
      const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC2|\n");
      const notes = findByTag(root, TAGS.Note);
      const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
      transpose(sel, 2, ctx, snapshots);
      const formatted = formatSelection(sel);
      expect(formatted).to.contain("D2");
    });
  });

  describe("property-based", () => {
    it("transpose(0) produces formatted output identical to the input", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
          const before = formatSelection({ root, cursors: [] });
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          transpose(sel, 0, ctx, snapshots);
          const after = formatSelection(sel);
          expect(after).to.equal(before);
        }),
        { numRuns: 1000 }
      );
    });

    it("transpose(12) shifts all selected notes up by one octave", () => {
      fc.assert(
        fc.property(genAbcTune, (source) => {
          const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
          const notes = findByTag(root, TAGS.Note);
          if (notes.length === 0) return;
          const midiBefore = notes.map((n) => getNoteMidi(n));
          // Skip if any note would go out of valid MIDI range after transposition
          if (midiBefore.some((m) => m + 12 > 127 || m < 0)) return;
          const ids = new Set(notes.map((n) => n.id));
          const sel: Selection = { root, cursors: [ids] };
          transpose(sel, 12, ctx, snapshots);
          const midiAfter = notes.map((n) => getNoteMidi(n));
          for (let i = 0; i < notes.length; i++) {
            expect(midiAfter[i]).to.equal(midiBefore[i] + 12);
          }
        }),
        { numRuns: 1000 }
      );
    });
  });

  describe("context-aware (with snapshots)", () => {
    describe("example-based", () => {
      // E1: Diatonic transposition in C major
      it("transposes C up 2 semitones to D in C major (no accidental)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 2, ctx, snapshots);
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("D");
        expect(getNoteAccidental(notes[0])).to.equal("");
      });

      // E2: Landing on natural not in key (F major: A+2 -> =B)
      it("transposes A up 2 semitones to =B in F major (explicit natural)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:F\nA|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 2, ctx, snapshots);
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("B");
        // Because F major has Bb, transposing to B natural requires explicit natural
        expect(getNoteAccidental(notes[0])).to.equal("=");
      });

      // E3: Chromatic up (C major: C+1 -> ^C)
      it("transposes C up 1 semitone to ^C in C major (chromatic sharp)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nC|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 1, ctx, snapshots);
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("C");
        expect(getNoteAccidental(notes[0])).to.equal("^");
      });

      // E4: Chromatic down (C major: D-1 -> _D)
      it("transposes D down 1 semitone to _D in C major (chromatic flat)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nD|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, -1, ctx, snapshots);
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("D");
        expect(getNoteAccidental(notes[0])).to.equal("_");
      });

      // E6: Chord transposition
      // C+2=D, E+2=F# (66, needs explicit sharp in C major), G+2=A
      it("transposes [CEG] up 2 semitones to [D^FA] in C major", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n[CEG]|\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
        transpose(sel, 2, ctx, snapshots);
        const chordNotes = findByTag(chords[0], TAGS.Note);
        expect(getNoteLetter(chordNotes[0]).toUpperCase()).to.equal("D");
        expect(getNoteLetter(chordNotes[1]).toUpperCase()).to.equal("F");
        expect(getNoteLetter(chordNotes[2]).toUpperCase()).to.equal("A");
        // D and A are natural, but E+2=F# needs explicit sharp in C major
        expect(getNoteAccidental(chordNotes[0])).to.equal("");
        expect(getNoteAccidental(chordNotes[1])).to.equal("^");
        expect(getNoteAccidental(chordNotes[2])).to.equal("");
      });

      // E7: Chord with chromatic result
      it("transposes [CEG] up 1 semitone to [^CF^G] in C major", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n[CEG]|\n");
        const chords = findByTag(root, TAGS.Chord);
        const sel: Selection = { root, cursors: [new Set([chords[0].id])] };
        transpose(sel, 1, ctx, snapshots);
        const chordNotes = findByTag(chords[0], TAGS.Note);
        // C+1 -> C# (chromatic)
        expect(getNoteLetter(chordNotes[0]).toUpperCase()).to.equal("C");
        expect(getNoteAccidental(chordNotes[0])).to.equal("^");
        // E+1 -> F (diatonic)
        expect(getNoteLetter(chordNotes[1]).toUpperCase()).to.equal("F");
        expect(getNoteAccidental(chordNotes[1])).to.equal("");
        // G+1 -> G# (chromatic)
        expect(getNoteLetter(chordNotes[2]).toUpperCase()).to.equal("G");
        expect(getNoteAccidental(chordNotes[2])).to.equal("^");
      });

      // E9: Key with sharps (G major diatonic)
      // E+2 = F# (66), which is diatonic in G major (no explicit accidental needed)
      // Note: We only check spelling, not MIDI, because toMidiPitch doesn't use key context
      it("transposes E up 2 semitones to F in G major (F# from key, no accidental)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:G\nE|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 2, ctx, snapshots);
        // E (64) + 2 = F# (66), which is diatonic in G major
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("F");
        expect(getNoteAccidental(notes[0])).to.equal("");
      });

      // E10: Key with flats (Bb major diatonic)
      // A+1 = Bb (70), which is diatonic in Bb major (no explicit accidental needed)
      // Note: We only check spelling, not MIDI, because toMidiPitch doesn't use key context
      it("transposes A up 1 semitone to B in Bb major (Bb from key, no accidental)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:Bb\nA|\n");
        const notes = findByTag(root, TAGS.Note);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 1, ctx, snapshots);
        // A (69) + 1 = Bb (70), which is diatonic in Bb major
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("B");
        expect(getNoteAccidental(notes[0])).to.equal("");
      });

      // E11: Octave transposition preserves explicit accidental
      it("transposes ^C up 12 semitones preserving the sharp", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\n^C|\n");
        const notes = findByTag(root, TAGS.Note);
        const midiBefore = getNoteMidi(notes[0]);
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 12, ctx, snapshots);
        // Letter should still be C, accidental should still be sharp
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("C");
        expect(getNoteAccidental(notes[0])).to.equal("^");
        expect(getNoteMidi(notes[0])).to.equal(midiBefore + 12);
      });

      // E12: Octave transposition preserves diatonic note
      it("transposes F up 12 semitones in G major (F# from key preserved)", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:G\nF|\n");
        const notes = findByTag(root, TAGS.Note);
        const midiBefore = getNoteMidi(notes[0]); // F# = 66
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, 12, ctx, snapshots);
        // Letter should still be F (lowercase for octave 5), no explicit accidental
        expect(getNoteLetter(notes[0]).toLowerCase()).to.equal("f");
        expect(getNoteAccidental(notes[0])).to.equal("");
        expect(getNoteMidi(notes[0])).to.equal(midiBefore + 12);
      });

      // Octave down transposition
      it("transposes c down 12 semitones preserving spelling", () => {
        const { root, ctx, snapshots } = toCSTreeWithSnapshots("X:1\nK:C\nc|\n");
        const notes = findByTag(root, TAGS.Note);
        const midiBefore = getNoteMidi(notes[0]); // c = 72
        const sel: Selection = { root, cursors: [new Set([notes[0].id])] };
        transpose(sel, -12, ctx, snapshots);
        // Letter should still be C (uppercase for octave 4)
        expect(getNoteLetter(notes[0]).toUpperCase()).to.equal("C");
        expect(getNoteAccidental(notes[0])).to.equal("");
        expect(getNoteMidi(notes[0])).to.equal(midiBefore - 12);
      });
    });

    describe("property-based (spellPitch)", () => {
      // P1: Pitch class preservation
      // spellPitch produces a spelling that resolves to the correct pitch class
      it("P1: spellPitch preserves pitch class", () => {
        fc.assert(
          fc.property(genKeySignature, genMeasureAccidentals, genSafeNoteExpr, genSemitoneOffset, (key, measureAcc, { expr }, offset) => {
            // Build note spellings from key and measure accidentals
            const noteSpellings = mergeAccidentals(key, measureAcc);

            // Extract pitch components and get original MIDI
            const { letter, octave, explicitAcc } = extractPitchComponents(expr.pitch);
            const ctx = buildPitchContext(key, measureAcc);
            const originalMidi = resolveMelodyPitch(letter, octave, explicitAcc, ctx);
            const targetMidi = originalMidi + offset;

            // Skip if target is out of range
            if (targetMidi < 0 || targetMidi > 127) return true;

            // Get spelling for the target pitch
            const spelling = spellPitch(targetMidi, noteSpellings, offset);

            // Verify: spelling resolves to the correct pitch class
            const resultDegree = safeMod(NATURAL_SEMITONES[spelling.letter] + spelling.alteration, 12);
            expect(resultDegree).to.equal(safeMod(targetMidi, 12));
          }),
          { numRuns: 500 }
        );
      });

      // P2: In-scale yields context spelling
      // When target lands on a scale degree, spelling matches noteSpellings
      it("P2: in-scale targets match noteSpellings", () => {
        fc.assert(
          fc.property(genKeySignature, genMeasureAccidentals, genSafeNoteExpr, genSemitoneOffset, (key, measureAcc, { expr }, offset) => {
            const noteSpellings = mergeAccidentals(key, measureAcc);

            const { letter, octave, explicitAcc } = extractPitchComponents(expr.pitch);
            const ctx = buildPitchContext(key, measureAcc);
            const originalMidi = resolveMelodyPitch(letter, octave, explicitAcc, ctx);
            const targetMidi = originalMidi + offset;

            if (targetMidi < 0 || targetMidi > 127) return true;

            const targetDegree = safeMod(targetMidi, 12);

            // Check if target is in scale
            for (const scaleLetter of LETTERS) {
              const alteration = noteSpellings[scaleLetter] ?? 0;
              const noteDegree = safeMod(NATURAL_SEMITONES[scaleLetter] + alteration, 12);
              if (noteDegree === targetDegree) {
                // Target is in scale, verify spelling matches
                const spelling = spellPitch(targetMidi, noteSpellings, offset);
                expect(spelling.letter).to.equal(scaleLetter);
                expect(spelling.alteration).to.equal(alteration);
                return true;
              }
            }

            // Target not in scale, property doesn't apply
            return true;
          }),
          { numRuns: 500 }
        );
      });

      // P3: Chromatic direction
      // For true chromatic notes, upward yields sharp, downward yields flat
      it("P3: chromatic direction matches transposition direction", () => {
        fc.assert(
          fc.property(
            genKeySignature,
            genMeasureAccidentals,
            genSafeNoteExpr,
            genSemitoneOffset.filter((n) => n !== 0),
            (key, measureAcc, { expr }, offset) => {
              const noteSpellings = mergeAccidentals(key, measureAcc);

              const { letter, octave, explicitAcc } = extractPitchComponents(expr.pitch);
              const ctx = buildPitchContext(key, measureAcc);
              const originalMidi = resolveMelodyPitch(letter, octave, explicitAcc, ctx);
              const targetMidi = originalMidi + offset;

              if (targetMidi < 0 || targetMidi > 127) return true;

              const targetDegree = safeMod(targetMidi, 12);

              // Check if target is in scale
              let inScale = false;
              for (const scaleLetter of LETTERS) {
                const alteration = noteSpellings[scaleLetter] ?? 0;
                const noteDegree = safeMod(NATURAL_SEMITONES[scaleLetter] + alteration, 12);
                if (noteDegree === targetDegree) {
                  inScale = true;
                  break;
                }
              }

              // Check if target is a natural pitch class
              let isNatural = false;
              for (const naturalLetter of LETTERS) {
                if (NATURAL_SEMITONES[naturalLetter] === targetDegree) {
                  isNatural = true;
                  break;
                }
              }

              // Only test true chromatic notes (skip if in scale or is a natural)
              if (inScale || isNatural) return true;

              // True chromatic: verify direction
              const spelling = spellPitch(targetMidi, noteSpellings, offset);

              if (offset > 0) {
                expect(spelling.alteration).to.equal(1); // sharp
              } else {
                expect(spelling.alteration).to.equal(-1); // flat
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      // P4: Natural notes not in scale yield natural spelling
      it("P4: natural notes not in scale yield natural spelling", () => {
        fc.assert(
          fc.property(genKeySignature, genMeasureAccidentals, genSafeNoteExpr, genSemitoneOffset, (key, measureAcc, { expr }, offset) => {
            const noteSpellings = mergeAccidentals(key, measureAcc);

            const { letter, octave, explicitAcc } = extractPitchComponents(expr.pitch);
            const ctx = buildPitchContext(key, measureAcc);
            const originalMidi = resolveMelodyPitch(letter, octave, explicitAcc, ctx);
            const targetMidi = originalMidi + offset;

            if (targetMidi < 0 || targetMidi > 127) return true;

            const targetDegree = safeMod(targetMidi, 12);

            // Check if target is in scale
            let inScale = false;
            for (const scaleLetter of LETTERS) {
              const alteration = noteSpellings[scaleLetter] ?? 0;
              const noteDegree = safeMod(NATURAL_SEMITONES[scaleLetter] + alteration, 12);
              if (noteDegree === targetDegree) {
                inScale = true;
                break;
              }
            }

            if (inScale) return true; // covered by P2

            // Check if target is a natural pitch class
            let naturalLetter: string | null = null;
            for (const checkLetter of LETTERS) {
              if (NATURAL_SEMITONES[checkLetter] === targetDegree) {
                naturalLetter = checkLetter;
                break;
              }
            }

            if (naturalLetter === null) return true; // true chromatic, covered by P3

            // Target is natural but not in scale: verify spelling is that natural
            const spelling = spellPitch(targetMidi, noteSpellings, offset);
            expect(spelling.letter).to.equal(naturalLetter);
            expect(spelling.alteration).to.equal(0);
          }),
          { numRuns: 500 }
        );
      });

      // P5: Octave transposition preserves letter identity (via full transpose)
      it("P5: octave transposition preserves letter and accidental", () => {
        fc.assert(
          fc.property(genAbcTune, genOctaveOffset, (source, octaveOffset) => {
            const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
            const notes = findByTag(root, TAGS.Note);
            if (notes.length === 0) return;
            const midiBefore = notes.map((n) => getNoteMidi(n));
            // Skip if any note would go out of range
            if (midiBefore.some((m) => m + octaveOffset < 0 || m + octaveOffset > 127)) return;

            const lettersBefore = notes.map((n) => getNoteLetter(n).toUpperCase());
            const accidentalsBefore = notes.map((n) => getNoteAccidental(n));

            const ids = new Set(notes.map((n) => n.id));
            const sel: Selection = { root, cursors: [ids] };
            transpose(sel, octaveOffset, ctx, snapshots);

            const lettersAfter = notes.map((n) => getNoteLetter(n).toUpperCase());
            const accidentalsAfter = notes.map((n) => getNoteAccidental(n));

            // Letter and accidental should be preserved
            for (let i = 0; i < notes.length; i++) {
              expect(lettersAfter[i]).to.equal(lettersBefore[i]);
              expect(accidentalsAfter[i]).to.equal(accidentalsBefore[i]);
            }
          }),
          { numRuns: 500 }
        );
      });
    });
  });
});
