import { Scanner, parse, ABCContext, SemanticAnalyzer } from "abcls-parser";
import { ContextInterpreter, DocumentSnapshots } from "abcls-parser/interpreter/ContextInterpreter";
import { File_structure } from "abcls-parser/types/Expr";
import { expect } from "chai";
import { describe, it } from "mocha";
import { TAGS, Selection, fromAst, isTokenNode, getTokenData, serializeCSTree, lookupTransform, CONTEXT_AWARE_TRANSFORMS } from "../../editor";
import { toCSTreeWithContext, findByTag } from "../../editor/tests/helpers";
import { collectSurvivingCursorIds } from "./cursorPreservation";


/**
 * Test helper that mirrors production behavior (AbcDocument.getSnapshots).
 * Runs the semantic analyzer and context interpreter to get DocumentSnapshots.
 */
function interpretContext(ast: File_structure, ctx: ABCContext, snapshotAccidentals: boolean = false): DocumentSnapshots {
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new ContextInterpreter();
  return interpreter.interpret(ast, analyzer.data, ctx, { snapshotAccidentals });
}

/**
 * Simulates the full applyTransform flow without the LSP layer.
 */
function simulateApplyTransform(
  source: string,
  cursorNodeIds: number[],
  transformName: string,
  args: unknown[]
): { newText: string; survivingIds: number[]; rangeCount: number } {
  const { root, ctx } = toCSTreeWithContext(source);

  const selection: Selection =
    cursorNodeIds.length === 0 ? { root, cursors: [new Set([root.id])] } : { root, cursors: cursorNodeIds.map((id) => new Set([id])) };

  const transformFn = lookupTransform(transformName);
  if (!transformFn) throw new Error(`Unknown transform: ${transformName}`);

  const newSelection = transformFn(selection, ctx, ...args);
  const survivingIds = collectSurvivingCursorIds(newSelection);
  const newText = serializeCSTree(newSelection.root, ctx);

  return { newText, survivingIds, rangeCount: survivingIds.length };
}

/**
 * Applies a context-aware transform to all the notes, chords and rests of a source, the way the server does for a selection that covers them.
 */
function applyToWholeSource(source: string, transformName: string): string {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);
  const root = fromAst(ast, ctx);
  // Because the server selects the node types of TRANSFORM_NODE_TAGS, the selection holds the notes, the chords and every kind of rest.
  const tags = [TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.YSPACER, TAGS.MultiMeasureRest];
  const ids = new Set(tags.flatMap((tag) => findByTag(root, tag)).map((node) => node.id));
  const transformFn = lookupTransform(transformName);
  if (!transformFn) throw new Error(`Unknown transform: ${transformName}`);
  const result = transformFn({ root, cursors: [ids] }, ctx, interpretContext(ast, ctx));
  return serializeCSTree(result.root, ctx);
}

/**
 * Keeps the music lines of a result, with one space around each bar line, so that the spacing that the writer chooses does not matter.
 */
function musicOf(text: string): string {
  return text.split("\n").slice(4).join("\n").replace(/[ \t]+/g, " ").replace(/ ?\| ?/g, " | ").replace(/ +\n/g, "\n").trim();
}

describe("Transform integration (simulated LSP flow)", () => {
  describe("multiplyRhythmRebar and divideRhythmRebar", () => {
    const source = 'X:1\nM:C\nL:1/8\nK:F\n[V:1] G2 G2 _B2 f2- | f4 g4 |\n[V:2] "Gm" x4 "Dm" x4 | "F" X |\n';

    it("are context-aware, so that the server gives them the snapshots that tell the length of a bar", () => {
      expect(CONTEXT_AWARE_TRANSFORMS.has("multiplyRhythmRebar")).to.equal(true);
      expect(CONTEXT_AWARE_TRANSFORMS.has("divideRhythmRebar")).to.equal(true);
    });

    it("double the lengths and cut the bars to the length of the meter, with the factor that the server leaves out", () => {
      const doubled = applyToWholeSource(source, "multiplyRhythmRebar");
      expect(musicOf(doubled)).to.equal('[V:1] G4 G4 | _B4 f4- | f8 | g8 |\n[V:2] "Gm" x8 | "Dm" x8 | "F" X | X |');
    });

    it("halve the lengths and merge the bars again", () => {
      const doubled = applyToWholeSource(source, "multiplyRhythmRebar");
      expect(musicOf(applyToWholeSource(doubled, "divideRhythmRebar"))).to.equal(musicOf(source));
    });
  });

  describe("transpose", () => {
    it("transposes all notes and preserves cursor state", () => {
      const source = "X:1\nK:C\nCDE|\n";
      const ctx = new ABCContext();
      const tokens = Scanner(source, ctx);
      const ast = parse(tokens, ctx);
      const root = fromAst(ast, ctx);

      const notes = findByTag(root, TAGS.Note);
      const noteIds = new Set(notes.map((n) => n.id));
      const selection: Selection = { root, cursors: [noteIds] };

      // transpose is context-aware, so we need to pass snapshots
      const snapshots = interpretContext(ast, ctx, true);
      const transformFn = lookupTransform("transpose");
      // args[0] = snapshots, args[1] = semitones (server prepends snapshots)
      const newSelection = transformFn!(selection, ctx, snapshots, 2);

      const newText = serializeCSTree(newSelection.root, ctx);
      expect(newText).to.equal("X:1\nK:C\nDE^F|\n");
      expect(collectSurvivingCursorIds(newSelection).length).to.equal(3);
    });
  });

  describe("enharmonize", () => {
    it("toggles sharp to flat", () => {
      const source = "X:1\nK:C\n^C|\n";
      const { root } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const cursorIds = notes.map((n) => n.id);

      const result = simulateApplyTransform(source, cursorIds, "enharmonize", []);

      expect(result.newText).to.equal("X:1\nK:C\n_D|\n");
      expect(result.survivingIds.length).to.equal(1);
    });
  });

  describe("error handling", () => {
    it("unknown transform name throws error", () => {
      expect(() => simulateApplyTransform("X:1\nK:C\nC|\n", [], "nonExistent", [])).to.throw("Unknown transform");
    });
  });

  describe("legato with grouped cursor", () => {
    /**
     * The legato transform requires all notes and rests to be in a single cursor
     * so that it can traverse them sequentially and replace rests with tied copies
     * of the preceding note. This test verifies that the grouped cursor approach works.
     */
    it("extends note through following rests when using grouped cursor", () => {
      const source = "X:1\nK:C\nC z z z|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const rests = findByTag(root, TAGS.Rest);

      const groupedIds = new Set<number>();
      for (const n of notes) groupedIds.add(n.id);
      for (const r of rests) groupedIds.add(r.id);

      const selection: Selection = { root, cursors: [groupedIds] };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      expect(newText).to.equal("X:1\nK:C\nC4   |\n");
    });

    it("does not work when each node has its own cursor (old behavior)", () => {
      const source = "X:1\nK:C\nC z z z|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const rests = findByTag(root, TAGS.Rest);

      const individualCursors = [...notes.map((n) => new Set([n.id])), ...rests.map((r) => new Set([r.id]))];

      const selection: Selection = { root, cursors: individualCursors };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      // With individual cursors, the source remains unchanged
      expect(newText).to.equal("X:1\nK:C\nC z z z|\n");
    });

    it("extends chord through following rest", () => {
      const source = "X:1\nK:C\n[CE] z G|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const chords = findByTag(root, TAGS.Chord);
      const notes = findByTag(root, TAGS.Note);
      const rests = findByTag(root, TAGS.Rest);

      const groupedIds = new Set<number>();
      for (const c of chords) groupedIds.add(c.id);
      for (const n of notes) groupedIds.add(n.id);
      for (const r of rests) groupedIds.add(r.id);

      const selection: Selection = { root, cursors: [groupedIds] };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      expect(newText).to.equal("X:1\nK:C\n[CE]2  G|\n");
    });

    it("creates tied notes across bar boundary", () => {
      const source = "X:1\nK:C\nC z | z z D|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const rests = findByTag(root, TAGS.Rest);

      const groupedIds = new Set<number>();
      for (const n of notes) groupedIds.add(n.id);
      for (const r of rests) groupedIds.add(r.id);

      const selection: Selection = { root, cursors: [groupedIds] };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      expect(newText).to.equal("X:1\nK:C\nC2-  | C2  D|\n");
    });

    it("handles multiple notes with interleaved rests", () => {
      const source = "X:1\nK:C\nC z D z|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const rests = findByTag(root, TAGS.Rest);

      const groupedIds = new Set<number>();
      for (const n of notes) groupedIds.add(n.id);
      for (const r of rests) groupedIds.add(r.id);

      const selection: Selection = { root, cursors: [groupedIds] };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      expect(newText).to.equal("X:1\nK:C\nC2  D2 |\n");
    });

    it("extends note through y-spacer", () => {
      const source = "X:1\nK:C\nC y D|\n";
      const { root, ctx } = toCSTreeWithContext(source);
      const notes = findByTag(root, TAGS.Note);
      const yspacers = findByTag(root, TAGS.YSPACER);

      const groupedIds = new Set<number>();
      for (const n of notes) groupedIds.add(n.id);
      for (const y of yspacers) groupedIds.add(y.id);

      const selection: Selection = { root, cursors: [groupedIds] };

      const transformFn = lookupTransform("legato");
      if (!transformFn) throw new Error("legato transform not found");

      const newSelection = transformFn(selection, ctx);
      const newText = serializeCSTree(newSelection.root, ctx);

      expect(newText).to.equal("X:1\nK:C\nC2  D|\n");
    });
  });

  describe("voiceInfoLineToInline", () => {
    it("converts V: info line to [V:] inline field", () => {
      const source = "X:1\nK:C\nV:1\nCDE|\n";
      const { root } = toCSTreeWithContext(source);
      const infoLines = findByTag(root, TAGS.Info_line).filter((n) => {
        const firstChild = n.firstChild;
        if (!firstChild || !isTokenNode(firstChild)) return false;
        return getTokenData(firstChild).lexeme === "V:";
      });
      const cursorIds = infoLines.map((n) => n.id);

      const result = simulateApplyTransform(source, cursorIds, "voiceInfoLineToInline", []);

      expect(result.newText).to.equal("X:1\nK:C\n[V:1] CDE|\n");
    });
  });

  describe("voiceInlineToInfoLine", () => {
    it("converts [V:] inline field to V: info line", () => {
      const source = "X:1\nK:C\n[V:1] CDE|\n";
      const { root } = toCSTreeWithContext(source);
      const inlineFields = findByTag(root, TAGS.Inline_field).filter((n) => {
        let child = n.firstChild;
        while (child) {
          if (isTokenNode(child) && getTokenData(child).lexeme === "V:") {
            return true;
          }
          child = child.nextSibling;
        }
        return false;
      });
      const cursorIds = inlineFields.map((n) => n.id);

      const result = simulateApplyTransform(source, cursorIds, "voiceInlineToInfoLine", []);

      expect(result.newText).to.equal("X:1\nK:C\nV:1\nCDE|\n");
    });
  });

  describe("toSlashNotation", () => {
    it("is recognized as a context-aware transform", () => {
      expect(CONTEXT_AWARE_TRANSFORMS.has("toSlashNotation")).to.be.true;
      expect(CONTEXT_AWARE_TRANSFORMS.has("transpose")).to.be.true;
    });

    it("converts quarter notes to slash notation in 4/4 (treble clef uses B)", () => {
      const source = "X:1\nM:4/4\nL:1/4\nK:C\n|C D E F|\n";
      const expected = "X:1\nM:4/4\nL:1/4\nK:C\n|[K: style=rhythm]B0B0B0B0[K: style=normal]   |\n";

      const ctx = new ABCContext();
      const tokens = Scanner(source, ctx);
      const ast = parse(tokens, ctx);
      const root = fromAst(ast, ctx);

      const notes = findByTag(root, TAGS.Note);
      const noteIds = new Set(notes.map((n) => n.id));
      const selection: Selection = { root, cursors: [noteIds] };

      const snapshots = interpretContext(ast, ctx);
      const transformFn = lookupTransform("toSlashNotation");
      const newSelection = transformFn!(selection, ctx, snapshots);

      const newText = serializeCSTree(newSelection.root, ctx);
      expect(newText).to.equal(expected);
    });

    it("converts quarter notes to slash notation (bass clef uses D)", () => {
      const source = "X:1\nM:4/4\nL:1/4\nK:C clef=bass\n|C, D, E, F,|\n";
      const expected = "X:1\nM:4/4\nL:1/4\nK:C clef=bass\n|[K: style=rhythm]D0D0D0D0[K: style=normal]   |\n";

      const ctx = new ABCContext();
      const tokens = Scanner(source, ctx);
      const ast = parse(tokens, ctx);
      const root = fromAst(ast, ctx);

      const notes = findByTag(root, TAGS.Note);
      const noteIds = new Set(notes.map((n) => n.id));
      const selection: Selection = { root, cursors: [noteIds] };

      const snapshots = interpretContext(ast, ctx);
      const transformFn = lookupTransform("toSlashNotation");
      const newSelection = transformFn!(selection, ctx, snapshots);

      const newText = serializeCSTree(newSelection.root, ctx);
      expect(newText).to.equal(expected);
    });

    it("converts beamed notes across multiple bars", () => {
      // Notes without spaces form beams - this tests the bug where beamed notes in later bars disappeared
      // Note: whitespace is preserved from the original source between nodes
      const source = "X:1\nM:4/4\nL:1/4\nK:C\n|a a a a| dcga|\n";
      const expected = "X:1\nM:4/4\nL:1/4\nK:C\n|[K: style=rhythm]B0B0B0B0   | B0B0B0B0[K: style=normal]|\n";

      const ctx = new ABCContext();
      const tokens = Scanner(source, ctx);
      const ast = parse(tokens, ctx);
      const root = fromAst(ast, ctx);

      const notes = findByTag(root, TAGS.Note);
      const noteIds = new Set(notes.map((n) => n.id));
      const selection: Selection = { root, cursors: [noteIds] };

      const snapshots = interpretContext(ast, ctx);
      const transformFn = lookupTransform("toSlashNotation");
      const newSelection = transformFn!(selection, ctx, snapshots);

      const newText = serializeCSTree(newSelection.root, ctx);
      expect(newText).to.equal(expected);
    });
  });
});
