import { Range } from "abcls-parser";
import { expect } from "chai";
import { describe, it } from "mocha";
import { extendAround } from "../src/selectors/aroundExtension";
import { selectContaining } from "../src/selectors/containingSelectors";
import { toCSTree } from "./helpers";

function range(line: number, start: number, endLine: number, end: number): Range {
  return { start: { line, character: start }, end: { line: endLine, character: end } };
}

function caret(line: number, character: number): Range {
  return range(line, character, line, character);
}

function textOf(lines: string[], selected: Range): string {
  const first = lines[selected.start.line];
  if (selected.start.line === selected.end.line) return first.slice(selected.start.character, selected.end.character);
  const middle = lines.slice(selected.start.line + 1, selected.end.line);
  const last = (lines[selected.end.line] ?? "").slice(0, selected.end.character);
  return [first.slice(selected.start.character), ...middle, last].join("\n");
}

describe("aroundExtension", () => {
  const source = "X:1\nK:C\n%%MIDI program 1\n!trill!C DE | F G % note\n% alone\n\nX:2\nK:C\nE F |\n";
  const lines = source.split("\n");
  const root = toCSTree(source);

  it("takes the spaces after a note", () => {
    expect(textOf(lines, extendAround(range(3, 7, 3, 8), "note", lines))).to.equal("C ");
  });

  it("takes the spaces after a decoration", () => {
    const [decoration] = selectContaining(root, [caret(3, 2)], "decoration", lines);
    expect(textOf(lines, decoration)).to.equal("!trill!");
  });

  it("takes the spaces and the closing bar line of a measure", () => {
    const [measure] = selectContaining(root, [caret(3, 9)], "measure", lines);
    expect(textOf(lines, measure)).to.equal("C DE |");
  });

  it("takes the whole line, line break included, of a directive", () => {
    const [directive] = selectContaining(root, [caret(2, 4)], "directive", lines);
    expect(directive).to.deep.equal(range(2, 0, 3, 0));
  });

  it("takes the spaces before a trailing comment", () => {
    const [comment] = selectContaining(root, [caret(3, 20)], "comment", lines);
    expect(textOf(lines, comment)).to.equal(" % note");
  });

  it("takes the whole line of a comment that is alone on its line", () => {
    const [comment] = selectContaining(root, [caret(4, 3)], "comment", lines);
    expect(comment).to.deep.equal(range(4, 0, 5, 0));
  });

  it("takes the line break of a system", () => {
    const [system] = selectContaining(root, [caret(3, 9)], "system", lines);
    expect(system.end).to.deep.equal({ line: 4, character: 0 });
  });

  it("takes the blank lines after a tune, and the end of the text for the last tune", () => {
    const tunes = selectContaining(root, [caret(3, 0), caret(8, 0)], "tune", lines);
    expect(tunes[0].end).to.deep.equal({ line: 6, character: 0 });
    expect(tunes[1].end.line).to.equal(lines.length - 1);
  });

  it("stays as the element is when nothing follows it", () => {
    expect(extendAround(range(0, 0, 0, 3), "note", ["abc"])).to.deep.equal(range(0, 0, 0, 3));
  });
});
