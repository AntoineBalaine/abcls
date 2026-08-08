import assert from "assert";
import { describe, it } from "mocha";
import { ABCContext } from "../parsers/Context";
import { TT, fileHeader, Scanner } from "../parsers/scan";
import { scanTune } from "../parsers/scan_tunebody";
import { Expr } from "../types/Expr";
import { createCtx } from "./scn_tuneBodyTokens.spec";

describe("fileHeader", () => {
  it("should parse a file header with info lines, comments, and stylesheet directives", () => {
    const ctx = createCtx(`%%directive
%comment
T:Title
`);
    fileHeader(ctx);

    // Check that we have the expected token types in the right order
    const expectedTypes = [TT.STYLESHEET_DIRECTIVE, TT.IDENTIFIER, TT.EOL, TT.COMMENT, TT.EOL, TT.INF_HDR, TT.INFO_STR, TT.EOL];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }
  });

  it("should stop parsing when it encounters a tune header start", () => {
    const ctx = createCtx(`%%directive
%comment
X:1
T:Title
`);
    fileHeader(ctx);

    // Check that we have the expected token types in the right order
    const expectedTypes: Array<TT | Expr> = [];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }
  });

  it("should handle free text lines correctly", () => {
    const ctx = createCtx(`This is free text
%%directive
`);
    fileHeader(ctx);

    // Check that we have the expected token types in the right order
    const expectedTypes = [TT.FREE_TXT, TT.EOL, TT.STYLESHEET_DIRECTIVE, TT.IDENTIFIER, TT.EOL];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }

    // Check the lexeme of the free text token
    assert.equal(ctx.tokens[0].lexeme, "This is free text");
  });
});

describe("scan tune", () => {
  it("should parse a tune header with info lines, comments, and stylesheet directives", () => {
    const ctx = createCtx(`X:1
T:Title
K:C
%%directive
%comment
`);
    scanTune(ctx);

    // Check that we have the expected token types in the right order
    const expectedTypes = [
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL,
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL,
      TT.INF_HDR,
      TT.KEY_SIGNATURE, // K:C produces KEY_SIGNATURE token
      TT.EOL,
      TT.STYLESHEET_DIRECTIVE,
      TT.IDENTIFIER,
      TT.EOL,
      TT.COMMENT,
      TT.EOL,
    ];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }
  });

  it("should tokenize a tune with both header and body content", () => {
    const ctx = createCtx(`X:1
T:Test Tune
K:C
ABC DEF|`);
    scanTune(ctx);

    // Check that we have tokens for both header and body content
    const headerTokenTypes = [
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL, // X:1
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL, // T:Test Tune
      TT.INF_HDR,
      TT.KEY_SIGNATURE, // K:C produces KEY_SIGNATURE token
      TT.EOL, // K:C
    ];

    const bodyTokenTypes = [
      TT.NOTE_LETTER,
      TT.NOTE_LETTER,
      TT.NOTE_LETTER, // ABC
      TT.WS, // space
      TT.NOTE_LETTER,
      TT.NOTE_LETTER,
      TT.NOTE_LETTER, // DEF
      TT.BARLINE, // |
    ];

    const expectedTypes = [...headerTokenTypes, ...bodyTokenTypes];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }
  });

  it("should stop parsing when it encounters a section break", () => {
    // Create a tune with a section break followed by more content
    const ctx = createCtx(`X:1
T:Test Tune
K:C
ABC DEF|

`);
    scanTune(ctx);

    // Check that we have tokens up to the section break
    const expectedTypes = [
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL, // X:1
      TT.INF_HDR,
      TT.INFO_STR,
      TT.EOL, // T:Test Tune
      TT.INF_HDR,
      TT.KEY_SIGNATURE, // K:C produces KEY_SIGNATURE token
      TT.EOL, // K:C
      TT.NOTE_LETTER,
      TT.NOTE_LETTER,
      TT.NOTE_LETTER, // ABC
      TT.WS, // space
      TT.NOTE_LETTER,
      TT.NOTE_LETTER,
      TT.NOTE_LETTER, // DEF
      TT.BARLINE, // |
      // TT.SCT_BRK, // \n\n
    ];

    assert.equal(ctx.tokens.length, expectedTypes.length, `Expected ${expectedTypes.length} tokens but got ${ctx.tokens.length}`);

    // Check the token types to make sure they match what we expect
    for (let i = 0; i < expectedTypes.length; i++) {
      assert.equal(ctx.tokens[i].type, expectedTypes[i], `Token at index ${i} should be ${expectedTypes[i]} but was ${ctx.tokens[i].type}`);
    }
  });
});

describe("section break line tracking", () => {
  // A section break can span more than one blank line (`pSectionBrk` matches
  // one newline followed by one-or-more further newlines). Each additional
  // blank line must still advance `ctx.line` by the actual number of newlines
  // consumed, or every token scanned afterwards reports the wrong line.
  function lineOf(source: string, needle: string): number {
    const idx = source.indexOf(needle);
    return source.slice(0, idx).split("\n").length - 1;
  }

  it("should advance the line count correctly across a single blank line", () => {
    const source = `X:1\nK:C\nABC|\n\nX:2\nK:C\nDEF|`;
    const ctx = new ABCContext();
    const tokens = Scanner(source, ctx);

    const secondTuneHeader = tokens.find((t) => t.type === TT.INF_HDR && t.lexeme === "X:" && t.line >= lineOf(source, "X:2"));
    assert.ok(secondTuneHeader, "expected to find the second tune's X: token");
    assert.equal(secondTuneHeader!.line, lineOf(source, "X:2"));
  });

  it("should advance the line count correctly across two blank lines", () => {
    const source = `X:1\nK:C\nABC|\n\n\nX:2\nK:C\nDEF|`;
    const ctx = new ABCContext();
    const tokens = Scanner(source, ctx);

    const sectBrk = tokens.find((t) => t.type === TT.SCT_BRK)!;
    assert.equal(sectBrk.lexeme, "\n\n\n");

    const secondTuneHeader = tokens.find((t) => t.type === TT.INF_HDR && t.lexeme === "X:" && t.position === 0 && t.line > sectBrk.line);
    assert.ok(secondTuneHeader, "expected to find the second tune's X: token");
    assert.equal(secondTuneHeader!.line, lineOf(source, "X:2"));
  });

  it("should advance the line count correctly across three blank lines", () => {
    const source = `X:1\nK:C\nABC|\n\n\n\nX:2\nK:C\nDEF|`;
    const ctx = new ABCContext();
    const tokens = Scanner(source, ctx);

    const sectBrk = tokens.find((t) => t.type === TT.SCT_BRK)!;
    assert.equal(sectBrk.lexeme, "\n\n\n\n");

    const secondTuneHeader = tokens.find((t) => t.type === TT.INF_HDR && t.lexeme === "X:" && t.position === 0 && t.line > sectBrk.line);
    assert.ok(secondTuneHeader, "expected to find the second tune's X: token");
    assert.equal(secondTuneHeader!.line, lineOf(source, "X:2"));
  });

  it("should keep every token's line number correct for content following a multi-blank-line section break", () => {
    const source = `X:1\nK:C\nABC|\n\n\nX:2\nT:try this\nK:C\nDEF|`;
    const ctx = new ABCContext();
    const tokens = Scanner(source, ctx);

    const titleInfoStr = tokens.find((t) => t.type === TT.INFO_STR && t.lexeme === "try this");
    assert.ok(titleInfoStr, "expected to find the second tune's T: value token");
    assert.equal(titleInfoStr!.line, lineOf(source, "try this"));
  });
});
