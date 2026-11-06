import { expect } from "chai";
import { describe, it } from "mocha";
import { Range } from "vscode-languageserver/node";
import { CARET_AWARE_SELECTORS, expandCarets } from "./caretScope";
import { getAvailableSelectors } from "./selectorLookup";

describe("caretScope", () => {
  it("widens a caret to the character that follows it, and keeps a range with text as it is", () => {
    const caret: Range = { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } };
    const text: Range = { start: { line: 2, character: 3 }, end: { line: 2, character: 6 } };
    expect(expandCarets([caret, text])).to.deep.equal([{ start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }, text]);
  });

  it("names only selectors that exist", () => {
    const known = new Set(getAvailableSelectors());
    for (const name of CARET_AWARE_SELECTORS) expect(known.has(name), name).to.equal(true);
  });
});
