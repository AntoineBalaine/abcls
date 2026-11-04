import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { Change, diffChars } from "../src/utils/diffToPatches";

/**
 * Turns a 1-based line and column into an offset of the text.
 */
function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    offset = text.indexOf("\n", offset) + 1;
  }
  return offset + column - 1;
}

/**
 * Applies the changes to the original text, the way an editor applies the edits that the server returns.
 * Because the changes refer to offsets of the original text, we apply them from the last to the first.
 */
function applyChanges(original: string, changes: readonly Change[]): string {
  let result = original;
  for (const change of [...changes].reverse()) {
    const start = offsetOf(original, change.originalStart.line, change.originalStart.column);
    const end = change.type === "insert" ? start : offsetOf(original, change.originalEnd.line, change.originalEnd.column) + 1;
    result = result.slice(0, start) + change.newContent + result.slice(end);
  }
  return result;
}

/** The length of the longest common subsequence, computed with a plain table, for texts that are small. */
function lcsLength(a: string, b: string): number {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[a.length][b.length];
}

/** How many characters of the original text the changes leave untouched. */
function keptCharacters(original: string, changes: readonly Change[]): number {
  let touched = 0;
  for (const change of changes) {
    if (change.type === "insert") continue;
    const start = offsetOf(original, change.originalStart.line, change.originalStart.column);
    const end = offsetOf(original, change.originalEnd.line, change.originalEnd.column) + 1;
    touched += end - start;
  }
  return original.length - touched;
}

describe("diffChars", () => {
  describe("Example-based tests", () => {
    it("returns no change for equal texts", () => {
      expect(diffChars("X:1\nK:C\n", "X:1\nK:C\n")).to.deep.equal([]);
    });

    it("replaces a character", () => {
      expect(diffChars("abc", "aXc")).to.deep.equal([
        { type: "replace", originalStart: { line: 1, column: 2 }, originalEnd: { line: 1, column: 2 }, newContent: "X" },
      ]);
    });

    it("inserts characters after the position that they follow", () => {
      expect(diffChars("ac", "abc")).to.deep.equal([
        { type: "insert", originalStart: { line: 1, column: 2 }, originalEnd: { line: 1, column: 2 }, newContent: "b" },
      ]);
    });

    it("deletes characters", () => {
      expect(diffChars("abc", "ac")).to.deep.equal([
        { type: "delete", originalStart: { line: 1, column: 2 }, originalEnd: { line: 1, column: 2 }, newContent: "" },
      ]);
    });

    it("gives the line and the column of a change on a later line", () => {
      expect(diffChars("X:1\nK:C\nCDEF|", "X:1\nK:C\nCzEF|")).to.deep.equal([
        { type: "replace", originalStart: { line: 3, column: 2 }, originalEnd: { line: 3, column: 2 }, newContent: "z" },
      ]);
    });

    it("inserts the whole text into an empty one, and deletes the whole text of one that becomes empty", () => {
      expect(diffChars("", "abc")).to.deep.equal([
        { type: "insert", originalStart: { line: 1, column: 1 }, originalEnd: { line: 1, column: 1 }, newContent: "abc" },
      ]);
      expect(diffChars("ab\nc", "")).to.deep.equal([
        { type: "delete", originalStart: { line: 1, column: 1 }, originalEnd: { line: 2, column: 1 }, newContent: "" },
      ]);
    });

    it("reports several separate changes in order", () => {
      const changes = diffChars("C D E F", "z D z F");
      expect(changes).to.have.length(2);
      expect(changes.map((c) => c.originalStart.column)).to.deep.equal([1, 5]);
    });
  });

  describe("Large texts, which used to exhaust the memory of the language server", () => {
    /** A score of the size that crashed the server: many lines of several voices, over 30,000 characters. */
    function largeScore(lines: number, transformLine: (line: string, index: number) => string): { original: string; modified: string } {
      const original: string[] = [];
      const modified: string[] = [];
      for (let i = 0; i < lines; i++) {
        const line = `[V:${i % 6}] "E" z2 [B,E]2 [EG]2 | z2 [B,E]2 [EG]2 | z2 [DG]2 [GB]2 | z2 [EA]2 [Ac]2 |`;
        original.push(line);
        modified.push(transformLine(line, i));
      }
      return { original: original.join("\n"), modified: modified.join("\n") };
    }

    it("handles over 30,000 characters with changes in a third of the lines, correctly, and quickly", () => {
      const { original, modified } = largeScore(400, (line, i) => (i % 3 === 0 ? line.replace(/\[[A-G,]+\]/g, "z") : line));
      expect(original.length).to.be.greaterThan(30000);
      const started = Date.now();
      const changes = diffChars(original, modified);
      expect(Date.now() - started).to.be.lessThan(3000);
      expect(changes.length).to.be.greaterThan(100);
      expect(applyChanges(original, changes)).to.equal(modified);
    });

    it("handles over 30,000 characters that all change, by replacing whatever is too large for a table", () => {
      const { original, modified } = largeScore(400, (line) => line.replace(/\[[A-G,]+\]/g, "z").replace(/\|/g, "!"));
      const started = Date.now();
      const changes = diffChars(original, modified);
      expect(Date.now() - started).to.be.lessThan(3000);
      expect(applyChanges(original, changes)).to.equal(modified);
    });

    it("handles two large texts that have nothing in common", () => {
      const original = "a".repeat(40000);
      const modified = "b".repeat(40000);
      const changes = diffChars(original, modified);
      expect(applyChanges(original, changes)).to.equal(modified);
    });

    it("handles one very long line", () => {
      const original = "CDEF ".repeat(8000);
      const modified = original.replace(/D/g, "z");
      const changes = diffChars(original, modified);
      expect(applyChanges(original, changes)).to.equal(modified);
    });

    it("handles a text with a change only at its start, and one only at its end", () => {
      const body = "CDEF|GABc|\n".repeat(3000);
      expect(applyChanges("X" + body, diffChars("X" + body, "Y" + body))).to.equal("Y" + body);
      expect(applyChanges(body + "X", diffChars(body + "X", body + "Y"))).to.equal(body + "Y");
    });
  });

  describe("Property-based tests", () => {
    const text = fc.string({ unit: fc.constantFrom("a", "b", "c", "\n", " "), maxLength: 40 });

    it("property: applying the changes to the original text gives the modified text", () => {
      fc.assert(
        fc.property(text, text, (original, modified) => {
          return applyChanges(original, diffChars(original, modified)) === modified;
        })
      );
    });

    it("property: for texts that fit in one table, the characters that stay are a longest common subsequence", () => {
      fc.assert(
        fc.property(text, text, (original, modified) => {
          const changes = diffChars(original, modified);
          return keptCharacters(original, changes) === lcsLength(original, modified);
        })
      );
    });

    it("property: the changes are in order, and none of them overlaps the next", () => {
      fc.assert(
        fc.property(text, text, (original, modified) => {
          const changes = diffChars(original, modified);
          let previousEnd = -1;
          for (const change of changes) {
            const start = offsetOf(original, change.originalStart.line, change.originalStart.column);
            const end = change.type === "insert" ? start : offsetOf(original, change.originalEnd.line, change.originalEnd.column) + 1;
            if (start < previousEnd) return false;
            previousEnd = end;
          }
          return true;
        })
      );
    });

    it("property: a text that grew only by an insertion gives changes that make the insertion again", () => {
      fc.assert(
        fc.property(text, fc.nat({ max: 40 }), fc.string({ unit: fc.constantFrom("x", "y"), minLength: 1, maxLength: 5 }), (original, at, inserted) => {
          const position = Math.min(at, original.length);
          const modified = original.slice(0, position) + inserted + original.slice(position);
          return applyChanges(original, diffChars(original, modified)) === modified;
        })
      );
    });
  });
});
