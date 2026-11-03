import assert from "assert";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { ABCContext } from "../parsers/Context";
import { Ctx, TT, Token, user_symbol_decl, user_symbol_invocation } from "../parsers/scan";
import { genUserSymbolScenario } from "./scn_pbt.generators.spec";
import { createRoundTripPredicate } from "./scn_pbt.spec";

/** starts by pushing an EOL token to simulate being at the start of a line */
function createUserSymbolCtx(source: string): Ctx {
  const ctx = new Ctx(source, new ABCContext());
  ctx.tokens.push(new Token(TT.EOL, "\n", ctx.abcContext.generateId()));
  return ctx;
}

describe("userSymbol function", () => {
  it("should parse a simple user symbol definition", () => {
    const ctx = createUserSymbolCtx("U:T=!trill!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true, "userSymbol function should return true for valid user symbol");

    // Check tokens generated (excluding the initial EOL we added)
    const tokens = ctx.tokens.slice(1);
    assert.equal(tokens.length, 4);

    assert.equal(tokens[0].type, TT.USER_SY_HDR);
    assert.equal(tokens[0].lexeme, "U:");

    assert.equal(tokens[1].type, TT.USER_SY);
    assert.equal(tokens[1].lexeme, "T");

    assert.equal(tokens[2].type, TT.EQL);
    assert.equal(tokens[2].lexeme, "=");

    assert.equal(tokens[3].type, TT.DECORATION);
    assert.equal(tokens[3].lexeme, "!trill!");
  });

  it("should parse user symbol with spaces around equals sign", () => {
    const ctx = createUserSymbolCtx("U:h = !fermata!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);

    assert.equal(tokens[0].type, TT.USER_SY_HDR);
    assert.equal(tokens[0].lexeme, "U:");

    assert.equal(tokens[1].type, TT.USER_SY);
    assert.equal(tokens[1].lexeme, "h");

    assert.equal(tokens[2].type, TT.EQL);
    assert.equal(tokens[2].lexeme, "=");

    assert.equal(tokens[3].type, TT.DECORATION);
    assert.equal(tokens[3].lexeme, "!fermata!");
  });

  it("should parse user symbol with lowercase variable", () => {
    const ctx = createUserSymbolCtx("U:w=!accent!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const userSymToken = tokens.find((t) => t.type === TT.USER_SY);
    assert.equal(userSymToken?.lexeme, "w");

    const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
    assert.equal(symbolToken?.lexeme, "!accent!");
  });

  it("should parse user symbol with uppercase variable", () => {
    const ctx = createUserSymbolCtx("U:H=!staccato!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const userSymToken = tokens.find((t) => t.type === TT.USER_SY);
    assert.equal(userSymToken?.lexeme, "H");

    const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
    assert.equal(symbolToken?.lexeme, "!staccato!");
  });

  it("should parse user symbol with tilde variable", () => {
    const ctx = createUserSymbolCtx("U:~=!turn!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const userSymToken = tokens.find((t) => t.type === TT.USER_SY);
    assert.equal(userSymToken?.lexeme, "~");

    const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
    assert.equal(symbolToken?.lexeme, "!turn!");
  });

  it("should parse user symbol with plus notation", () => {
    const ctx = createUserSymbolCtx("U:T=+pizz+");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const symbolToken = tokens.find((t) => t.type === TT.SYMBOL);
    assert.equal(symbolToken?.lexeme, "+pizz+");
  });

  it("should handle user symbol with trailing comment", () => {
    const ctx = createUserSymbolCtx("U:T=!trill! % this is a comment");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
    assert.equal(symbolToken?.lexeme, "!trill!");
  });

  it("should handle user symbol with colon variation", () => {
    const ctx = createUserSymbolCtx("U: T=!trill!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    assert.equal(tokens[0].type, TT.USER_SY_HDR);
    assert.equal(tokens[0].lexeme, "U:");
  });

  it("should generate invalid token for user symbol without equals sign", () => {
    const ctx = createUserSymbolCtx("U:T !trill!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const invalidToken = tokens.find((t) => t.type === TT.INVALID);
    assert(invalidToken, "Should generate INVALID token for malformed user symbol");
  });

  it("should generate invalid token for user symbol without variable", () => {
    const ctx = createUserSymbolCtx("U:=!trill!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const invalidToken = tokens.find((t) => t.type === TT.INVALID);
    assert(invalidToken, "Should generate INVALID token for user symbol without variable");
  });

  it("should generate invalid token for invalid variable character", () => {
    const ctx = createUserSymbolCtx("U:x=!trill!");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const invalidToken = tokens.find((t) => t.type === TT.INVALID);
    assert(invalidToken, "Should generate INVALID token for invalid variable character");
  });

  it("should generate invalid token for user symbol without content", () => {
    const ctx = createUserSymbolCtx("U:T= %hello");
    const result = user_symbol_decl(ctx);

    assert.equal(result, true);

    const tokens = ctx.tokens.slice(1);
    const invalidToken = tokens.find((t) => t.type === TT.INVALID);
    assert(invalidToken, "Should generate INVALID token for user symbol without content");
  });

  it("should return false for non-user-symbol input", () => {
    const ctx = createUserSymbolCtx("X:1");
    const result = user_symbol_decl(ctx);

    assert.equal(result, false, "userSymbol function should return false for non-user-symbol input");

    // Should only have the initial EOL token
    assert.equal(ctx.tokens.length, 1);
    assert.equal(ctx.tokens[0].type, TT.EOL);
  });

  it("should return false when not preceded by EOL", () => {
    const ctx = new Ctx("U:T=!trill!", new ABCContext());
    // Don't add EOL token - user symbol should not be recognized
    const result = user_symbol_decl(ctx);

    assert.equal(result, false, "userSymbol function should return false when not preceded by EOL");
  });

  it("should return false for invalid user symbol pattern", () => {
    const ctx = createUserSymbolCtx("V:1");
    const result = user_symbol_decl(ctx);

    assert.equal(result, false, "userSymbol function");
  });
});

describe("user symbol invocation function", () => {
  it("should recognize user symbol invocation after declaration", () => {
    // First declare a user symbol
    const ctx = createUserSymbolCtx("U:T=!trill!");
    const declResult = user_symbol_decl(ctx);
    assert.equal(declResult, true, "user symbol declaration should succeed");

    // Now test invocation
    ctx.current = 0; // Reset position
    ctx.start = 0;
    ctx.source = "T"; // Set source to just the variable name

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "user symbol invocation should be recognized");

    // Check that USER_SY_INVOCATION token was created
    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert(invocationToken, "Should create USER_SY_INVOCATION token");
    assert.equal(invocationToken.lexeme, "T");
  });

  it("should not recognize undeclared user symbols", () => {
    const ctx = new Ctx("T", new ABCContext());
    const result = user_symbol_invocation(ctx);

    assert.equal(result, false, "should not recognize undeclared user symbols");
  });

  it("should match variable at word boundary", () => {
    // Declare a user symbol
    const ctx = createUserSymbolCtx("U:T=!trill!");
    user_symbol_decl(ctx);

    // Test with variable followed by space
    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "T ";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should match at word boundary");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "T");
  });

  it("should match variable followed by newline", () => {
    // Declare a user symbol
    const ctx = createUserSymbolCtx("U:H=!fermata!");
    user_symbol_decl(ctx);

    // Test with variable followed by newline
    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "H\n";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should match at end of line");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "H");
  });

  it("should match variable followed by y-spacer", () => {
    // Declare a user symbol
    const ctx = createUserSymbolCtx("U:T=!trill!");
    user_symbol_decl(ctx);

    // Test with variable followed by y-spacer
    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "Ty";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should match when followed by y-spacer");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "T");
  });

  it("should match variable at end of input", () => {
    // Declare a user symbol
    const ctx = createUserSymbolCtx("U:T=!trill!");
    user_symbol_decl(ctx);

    // Test with variable at end of input
    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "T";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should match at end of input");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "T");
  });

  it("should handle multiple user symbol declarations", () => {
    const ctx = new Ctx("", new ABCContext());

    // Manually add user symbols to test multiple declarations
    ctx.user_symbols = new Map();
    ctx.user_symbols.set("T", "!trill!");
    ctx.user_symbols.set("H", "!fermata!");

    // Test first symbol
    ctx.source = "T";
    ctx.current = 0;
    ctx.start = 0;

    let result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should recognize first symbol");

    // Test second symbol
    ctx.source = "H";
    ctx.current = 0;
    ctx.start = 0;

    result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should recognize second symbol");
  });

  it("should handle tilde user symbol", () => {
    const ctx = createUserSymbolCtx("U:~=!turn!");
    user_symbol_decl(ctx);

    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "~";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should recognize tilde symbol");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "~");
  });

  it("should handle uppercase user symbol", () => {
    const ctx = createUserSymbolCtx("U:H=!fermata!");
    user_symbol_decl(ctx);

    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "H ";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should recognize uppercase symbol");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "H");
  });

  it("should handle lowercase user symbol", () => {
    const ctx = createUserSymbolCtx("U:h=!accent!");
    user_symbol_decl(ctx);

    ctx.current = 0;
    ctx.start = 0;
    ctx.source = "h ";

    const result = user_symbol_invocation(ctx);
    assert.equal(result, true, "should recognize lowercase symbol");

    const invocationToken = ctx.tokens.find((t) => t.type === TT.USER_SY_INVOCATION);
    assert.equal(invocationToken?.lexeme, "h");
  });
});

// Property-based tests for user symbol round-trip scenarios
describe("user symbol round-trip property tests", () => {
  it("should produce equivalent tokens when rescanning user symbol scenarios", () => {
    fc.assert(fc.property(genUserSymbolScenario, createRoundTripPredicate), {
      verbose: false,
      numRuns: 100,
    });
  });
});
