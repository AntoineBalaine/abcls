import { ABCContext, AbcErrorReporter, Scanner, SemanticAnalyzer, parse } from "abcls-parser";
import { ContextInterpreter, DocumentSnapshots } from "abcls-parser/interpreter/ContextInterpreter";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { CSNode, isTokenNode, getTokenData } from "../src/csTree/types";
import { serializeCSTree } from "../src/runner/csTreeSerializer";
import { resolveSelectionRangesInText } from "../src/runner/cursorPositions";
import { resolveSelectionRanges } from "../src/runner/selectionRangeResolver";
import { createSelection, Selection } from "../src/selection";
import { firstTokenData } from "../src/selectors/treeWalk";
import { splitSystems } from "../src/transforms/splitSystem";
import { collectAll } from "./helpers";

interface Split {
  result: Selection;
  ctx: ABCContext;
  newText: string;
}

/** Splits the system at the given positions, the way the language server does, and serializes the result. */
function splitAt(abc: string, positions: Array<{ line: number; character: number }>): Split {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const snapshots: DocumentSnapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx);
  const root = fromAst(ast, ctx);
  const result = splitSystems(createSelection(root), positions, ctx, snapshots);
  return { result, ctx, newText: serializeCSTree(result.root, ctx) };
}

/** Gives the text that starts at a line and a column of a text. */
function textAt(text: string, line: number, character: number): string {
  return text.split("\n")[line].slice(character);
}

function lexemes(root: CSNode): string[] {
  return collectAll(root)
    .filter((node) => isTokenNode(node))
    .map((node) => getTokenData(node).lexeme);
}

describe("resolveSelectionRangesInText", () => {
  describe("Example-based tests", () => {
    it("gives the position that the split node has in the new text, and not the position that it had before", () => {
      const abc = "X:1\nK:C\nC D E F|G A B c|\nC D E F|G A B c|\n";
      const { result, ctx, newText } = splitAt(abc, [{ line: 3, character: 4 }]);

      const ranges = resolveSelectionRangesInText(result, ctx, newText);

      expect(newText).to.equal("X:1\nK:C\nC D E F|G A B c|\nC D \nE F|G A B c|\n");
      expect(ranges).to.deep.equal([{ start: { line: 4, character: 0 }, end: { line: 4, character: 1 } }]);
      // The old way pointed at the position of E before the split, which is one line too high.
      expect(resolveSelectionRanges(result)[0].start).to.deep.equal({ line: 3, character: 4 });
    });

    it("gives a position on the line of the new system when the split inserts voice markers", () => {
      const abc = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D E F | G A B c |", "[V:2] c B A G | F E D C |"].join("\n");
      const { result, ctx, newText } = splitAt(abc, [{ line: 4, character: 15 }]);

      const ranges = resolveSelectionRangesInText(result, ctx, newText);

      expect(ranges).to.have.length(1);
      const { start } = ranges![0];
      // Because the cursor lies on the node that starts the new system, the text there is the start of that node.
      const lexeme = firstTokenData(findCursorNode(result))!.lexeme;
      expect(textAt(newText, start.line, start.character).startsWith(lexeme)).to.equal(true);
      // and that node is on a line that the split created, below the first system
      expect(start.line).to.be.greaterThan(5);
    });

    it("gives one range for each cursor that the transform returns, each on the first token of its node", () => {
      const abc = "X:1\nK:C\nC D E F|G A B c|\nC D E F|G A B c|\n";
      const { result, ctx, newText } = splitAt(abc, [
        { line: 2, character: 4 },
        { line: 3, character: 4 },
      ]);

      const ranges = resolveSelectionRangesInText(result, ctx, newText);

      expect(ranges).to.have.length(result.cursors.length);
      result.cursors.forEach((cursor, i) => {
        const node = collectAll(result.root).find((candidate) => candidate.id === [...cursor][0])!;
        const lexeme = firstTokenData(node)!.lexeme;
        expect(textAt(newText, ranges![i].start.line, ranges![i].start.character).startsWith(lexeme)).to.equal(true);
      });
    });

    it("does not leave a sentinel in the tree, so that serializing it again gives the same text", () => {
      const abc = "X:1\nK:C\nC D E F|G A B c|\n";
      const { result, ctx, newText } = splitAt(abc, [{ line: 2, character: 4 }]);
      const before = lexemes(result.root);

      resolveSelectionRangesInText(result, ctx, newText);

      expect(lexemes(result.root)).to.deep.equal(before);
      expect(serializeCSTree(result.root, ctx)).to.equal(newText);
    });

    it("returns null when the text that it is given is not the text of the tree, so that the caller keeps its own ranges", () => {
      const abc = "X:1\nK:C\nC D E F|G A B c|\n";
      const { result, ctx } = splitAt(abc, [{ line: 2, character: 4 }]);
      expect(resolveSelectionRangesInText(result, ctx, "not the text of the tree")).to.equal(null);
    });

    it("returns null when there are more cursors than sentinels", () => {
      const abc = "X:1\nK:C\nC D E F|\n";
      const { result, ctx, newText } = splitAt(abc, [{ line: 2, character: 4 }]);
      const id = [...result.cursors[0]][0];
      const crowd: Selection = { root: result.root, cursors: Array.from({ length: 2049 }, () => new Set([id])) };
      expect(resolveSelectionRangesInText(crowd, ctx, newText)).to.equal(null);
    });

    it("returns no range for a selection without cursor", () => {
      const abc = "X:1\nK:C\nC D E F|\n";
      const { result, ctx, newText } = splitAt(abc, [{ line: 2, character: 4 }]);
      expect(resolveSelectionRangesInText({ root: result.root, cursors: [] }, ctx, newText)).to.deep.equal([]);
    });

    it("skips a cursor whose node is not in the tree", () => {
      const abc = "X:1\nK:C\nC D E F|\n";
      const { result, ctx, newText } = splitAt(abc, [{ line: 2, character: 4 }]);
      expect(resolveSelectionRangesInText({ root: result.root, cursors: [new Set([999999])] }, ctx, newText)).to.deep.equal([]);
    });
  });

  describe("Property-based tests", () => {
    const note = fc.constantFrom("C", "D", "E", "F", "G", "A", "B", "c", "d", "e");
    const bar = fc.array(note, { minLength: 2, maxLength: 5 }).map((notes) => notes.join(" ") + " |");
    const voiceLine = fc.array(bar, { minLength: 1, maxLength: 4 }).map((bars) => bars.join(" "));

    it("property: the range of the cursor starts on the first token of its node, in the new text", () => {
      fc.assert(
        fc.property(fc.array(voiceLine, { minLength: 1, maxLength: 3 }), fc.nat({ max: 1000 }), (lines, pick) => {
          const abc = ["X:1", "K:C", ...lines].join("\n");
          // Because a split needs a note to stand on, we take the position of the first note of a line, moved along the line.
          const lineIndex = 2 + (pick % lines.length);
          const text = lines[lineIndex - 2];
          const notePositions = [...text].map((c, i) => ({ c, i })).filter(({ c }) => /[A-Ga-g]/.test(c));
          const chosen = notePositions[pick % notePositions.length];
          const { result, ctx, newText } = splitAt(abc, [{ line: lineIndex, character: chosen.i }]);
          if (result.cursors.length === 0) return true;

          const ranges = resolveSelectionRangesInText(result, ctx, newText);
          if (ranges === null || ranges.length === 0) return true;

          const lexeme = firstTokenData(findCursorNode(result))!.lexeme;
          const { start } = ranges[0];
          return textAt(newText, start.line, start.character).startsWith(lexeme);
        })
      );
    });
  });
});

/** Finds the node of the first cursor of a selection. */
function findCursorNode(selection: Selection): CSNode {
  const id = [...selection.cursors[0]][0];
  const node = collectAll(selection.root).find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error("the cursor node is not in the tree");
  return node;
}
