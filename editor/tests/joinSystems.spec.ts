import { ABCContext, AbcErrorReporter, Scanner, SemanticAnalyzer, parse } from "abcls-parser";
import { ContextInterpreter } from "abcls-parser/interpreter/ContextInterpreter";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { serializeCSTree } from "../src/runner/csTreeSerializer";
import { resolveSelectionRangesInText } from "../src/runner/cursorPositions";
import { createSelection, Selection } from "../src/selection";
import { joinSystems } from "../src/transforms/joinSystems";
import { splitSystems } from "../src/transforms/splitSystem";

interface Position {
  line: number;
  character: number;
}

/** Joins the systems under the cursors, the way the language server does, and serializes the result. */
function join(abc: string, cursors: Position[]): { text: string; result: Selection; ranges: ReturnType<typeof resolveSelectionRangesInText> } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const result = joinSystems(createSelection(fromAst(ast, ctx)), cursors, ctx);
  const text = serializeCSTree(result.root, ctx);
  return { text, result, ranges: resolveSelectionRangesInText(result, ctx, text) };
}

/** Splits the system under the cursor, the way the language server does, and serializes the result. */
function split(abc: string, cursor: Position): string {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx);
  const result = splitSystems(createSelection(fromAst(ast, ctx)), [cursor], ctx, snapshots);
  return serializeCSTree(result.root, ctx);
}

const textAt = (text: string, position: Position): string => text.split("\n")[position.line].slice(position.character);

describe("joinSystems", () => {
  describe("Example-based tests", () => {
    it("joins a system with the next one in a score of one voice", () => {
      const { text } = join("X:1\nK:C\nC D E F|\nG A B c|\n", [{ line: 2, character: 2 }]);
      expect(text).to.equal("X:1\nK:C\nC D E F|G A B c|\n");
    });

    it("puts the cursor on the first note that was appended", () => {
      const { text, ranges } = join("X:1\nK:C\nC D E F|\nG A B c|\n", [{ line: 2, character: 2 }]);
      expect(ranges).to.have.length(1);
      expect(textAt(text, ranges![0].start).startsWith("G A B c|")).to.equal(true);
    });

    it("joins each voice with the same voice of the next system, and drops the voice marker that it repeats", () => {
      const abc = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D | E F |", "[V:2] c B | A G |", "[V:1] G A | B c |", "[V:2] F E | D C |", ""].join("\n");
      const { text } = join(abc, [{ line: 4, character: 10 }]);
      expect(text).to.equal(["X:1", "V:1", "V:2", "K:C", "[V:1] C D | E F |G A | B c |", "[V:2] c B | A G |F E | D C |", ""].join("\n"));
    });

    it("matches the voices by their ids, and not by their place, when the next system has only some of them", () => {
      // Because the second system holds only voice 2, joining by place would append its line to voice 1.
      const abc = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D |", "[V:2] c B |", "[V:2] F E |", ""].join("\n");
      const { text } = join(abc, [{ line: 4, character: 8 }]);
      expect(text).to.equal(["X:1", "V:1", "V:2", "K:C", "[V:1] C D |", "[V:2] c B |F E |", ""].join("\n"));
    });

    it("keeps after the joined lines a voice that only the next system has", () => {
      const abc = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D |", "[V:1] G A |", "[V:2] F E |", ""].join("\n");
      const { text } = join(abc, [{ line: 4, character: 8 }]);
      expect(text).to.equal(["X:1", "V:1", "V:2", "K:C", "[V:1] C D |G A |", "[V:2] F E |", ""].join("\n"));
    });

    it("keeps the P: lines and the text directives of both systems", () => {
      const abc = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D |", "[V:2] c B |", "P:B", "%%text first", "[V:1] G A |", "[V:2] F E |", "%%text second", ""].join(
        "\n"
      );
      const { text } = join(abc, [{ line: 4, character: 8 }]);
      expect(text).to.equal(["X:1", "V:1", "V:2", "K:C", "[V:1] C D |G A |", "[V:2] c B |F E |", "P:B", "%%text first", "%%text second", ""].join("\n"));
    });

    it("does nothing in the last system, because there is no next system", () => {
      const abc = "X:1\nK:C\nC D E F|\nG A B c|\n";
      const { text, result } = join(abc, [{ line: 3, character: 2 }]);
      expect(text).to.equal(abc);
      expect(result.cursors).to.deep.equal([]);
    });

    it("does nothing for a cursor that is not in a system", () => {
      const abc = "X:1\nK:C\nC D E F|\nG A B c|\n";
      const { text } = join(abc, [{ line: 0, character: 1 }]);
      expect(text).to.equal(abc);
    });

    it("joins a system once when several cursors are in it", () => {
      const abc = "X:1\nK:C\nC D E F|\nG A B c|\nc B A G|\n";
      const { text } = join(abc, [
        { line: 2, character: 0 },
        { line: 2, character: 4 },
      ]);
      expect(text).to.equal("X:1\nK:C\nC D E F|G A B c|\nc B A G|\n");
    });

    it("joins one system with the next for each cursor, when the cursors are in different systems", () => {
      const abc = "X:1\nK:C\nC D|\nE F|\nG A|\nB c|\n";
      const { text, result } = join(abc, [
        { line: 2, character: 0 },
        { line: 4, character: 0 },
      ]);
      expect(text).to.equal("X:1\nK:C\nC D|E F|\nG A|B c|\n");
      expect(result.cursors).to.have.length(2);
    });
  });

  describe("The inverse of splitSystems", () => {
    it("gives back the text of a score of one voice that was split", () => {
      const original = "X:1\nK:C\nC D E F|G A B c|\n";
      const splitText = split(original, { line: 2, character: 4 });
      expect(splitText).to.not.equal(original);
      expect(join(splitText, [{ line: 2, character: 2 }]).text).to.equal(original);
    });

    it("gives back the text of a score of two voices that was split, apart from the spaces that the split drops", () => {
      const original = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D E F | G A B c |", "[V:2] c B A G | F E D C |", ""].join("\n");
      const splitText = split(original, { line: 4, character: 15 });
      const joined = join(splitText, [{ line: 4, character: 10 }]).text;
      expect(joined.replace(/[ \t]+/g, "")).to.equal(original.replace(/[ \t]+/g, ""));
    });
  });

  describe("Property-based tests", () => {
    const note = fc.constantFrom("C", "D", "E", "F", "G", "A", "B", "c", "d", "e");
    const bar = fc.array(note, { minLength: 2, maxLength: 4 }).map((notes) => notes.join(" ") + " |");
    const line = fc.array(bar, { minLength: 1, maxLength: 3 }).map((bars) => bars.join(" "));
    const unspaced = (text: string): string => text.replace(/[ \t]+/g, "");

    it("property: joining the systems of a score of one voice keeps every note, in order", () => {
      fc.assert(
        fc.property(fc.array(line, { minLength: 2, maxLength: 4 }), fc.nat({ max: 10 }), (lines, pick) => {
          const abc = ["X:1", "K:C", ...lines, ""].join("\n");
          const at = pick % (lines.length - 1);
          const { text } = join(abc, [{ line: 2 + at, character: 0 }]);
          const notes = (t: string): string => t.replace(/[^A-Ga-g]/g, "");
          return notes(text) === notes(abc) && text.split("\n").length === abc.split("\n").length - 1;
        })
      );
    });

    it("property: splitting a system and then joining the halves gives back the text, apart from spaces", () => {
      fc.assert(
        fc.property(fc.array(line, { minLength: 1, maxLength: 3 }), fc.nat({ max: 1000 }), (lines, pick) => {
          const abc = ["X:1", "K:C", ...lines, ""].join("\n");
          const lineIndex = pick % lines.length;
          const text = lines[lineIndex];
          // Because a split needs a note that is not the first of its line, we choose among the others.
          const positions = [...text].map((c, i) => ({ c, i })).filter(({ c, i }) => /[A-Ga-g]/.test(c) && i > 0);
          if (positions.length === 0) return true;
          const chosen = positions[pick % positions.length];
          const splitText = split(abc, { line: 2 + lineIndex, character: chosen.i });
          if (splitText === abc) return true;
          // The first half is on the line of the original and the second on the next line, so the join starts on the original line.
          const joined = join(splitText, [{ line: 2 + lineIndex, character: 0 }]).text;
          return unspaced(joined) === unspaced(abc);
        })
      );
    });
  });
});
