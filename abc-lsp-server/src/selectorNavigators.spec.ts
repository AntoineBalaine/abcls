import { fromAst } from "abcls-editor";
import { Scanner, parse, ABCContext } from "abcls-parser";
import { expect } from "chai";
import { describe, it } from "mocha";
import { Range } from "vscode-languageserver/node";
import { lookupNavigator, lookupSelector } from "./selectorLookup";

function rootOf(source: string) {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);
  return fromAst(ast, ctx);
}

function caret(line: number, character: number): Range {
  return { start: { line, character }, end: { line, character } };
}

describe("selector navigators", () => {
  const root = rootOf("X:1\nK:C\nC D E |\n");

  it("knows the navigators of the next and the previous note, and keeps them out of the selectors", () => {
    expect(lookupNavigator("selectNextNote")).to.not.equal(null);
    expect(lookupNavigator("selectPreviousNote")).to.not.equal(null);
    expect(lookupSelector("selectNextNote")).to.equal(null);
    expect(lookupNavigator("selectNotes")).to.equal(null);
  });

  it("moves a caret to the next note and to the previous note", () => {
    const next = lookupNavigator("selectNextNote")!(root, [caret(2, 2)], []);
    expect(next).to.deep.equal([{ start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }]);
    const previous = lookupNavigator("selectPreviousNote")!(root, [caret(2, 2)], []);
    expect(previous).to.deep.equal([{ start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }]);
  });

  it("selects the note, the measure and the system that hold a caret", () => {
    const rooted = rootOf("X:1\nK:C\nC [DFA] E | G A |\nC D |\n");
    expect(lookupNavigator("selectInsideNote")!(rooted, [caret(2, 4)], [])).to.deep.equal([
      { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } },
    ]);
    const measure = lookupNavigator("selectInsideMeasure")!(rooted, [caret(2, 4)], []);
    expect(measure).to.have.length(1);
    expect(measure[0].start.character).to.equal(0);
    const system = lookupNavigator("selectInsideSystem")!(rooted, [caret(3, 0)], []);
    expect(system).to.have.length(1);
    expect(system[0].start.line).to.equal(3);
  });

  it("moves a caret to the next chord and to the previous chord", () => {
    const rooted = rootOf("X:1\nK:C\n[CE] D [FA] |\n");
    const next = lookupNavigator("selectNextChord")!(rooted, [caret(2, 5)], []);
    expect(next).to.deep.equal([{ start: { line: 2, character: 7 }, end: { line: 2, character: 11 } }]);
    const previous = lookupNavigator("selectPreviousChord")!(rooted, [caret(2, 5)], []);
    expect(previous).to.deep.equal([{ start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }]);
  });

  it("moves a caret to the next and the previous chord, note or rest", () => {
    const rooted = rootOf("X:1\nK:C\nC [DF] z |\n");
    const next = lookupNavigator("selectNextElement")!(rooted, [caret(2, 0)], []);
    expect(next).to.deep.equal([{ start: { line: 2, character: 2 }, end: { line: 2, character: 6 } }]);
    const previous = lookupNavigator("selectPreviousElement")!(rooted, [caret(2, 7)], []);
    expect(previous).to.deep.equal([{ start: { line: 2, character: 2 }, end: { line: 2, character: 6 } }]);
  });

  it("moves several notes when it is given a count", () => {
    const next = lookupNavigator("selectNextNote")!(root, [caret(2, 0)], [], 2);
    expect(next).to.deep.equal([{ start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }]);
  });
});

describe("the around navigators", () => {
  it("widens the note that holds a caret with the spaces after it", () => {
    const source = "X:1\nK:C\nC D E |\n";
    const rooted = rootOf(source);
    const around = lookupNavigator("selectAroundNote")!(rooted, [caret(2, 2)], source.split("\n"));
    expect(around).to.deep.equal([{ start: { line: 2, character: 2 }, end: { line: 2, character: 4 } }]);
  });
});
