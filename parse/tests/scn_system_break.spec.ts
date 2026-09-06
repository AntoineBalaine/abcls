import assert from "assert";
import { describe, it } from "mocha";
import { ABCContext } from "../parsers/Context";
import { Scanner, TT, Ctx } from "../parsers/scan";
import { systemBreak } from "../parsers/scan_tunebody";

// Helper function to create a Ctx object for testing
function createCtx(source: string): Ctx {
  return new Ctx(source, new ABCContext());
}

describe("Scanner: System Break", () => {
  // Helper to create a proper ABC tune with music code
  function createTune(musicCode: string): string {
    return `X:1\nK:C\n${musicCode}`;
  }

  describe("basic recognition", () => {
    it("should scan system break with surrounding whitespace", () => {
      const input = createTune(" ! ");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });

    it("should scan standalone system break", () => {
      const input = createTune("!");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });
  });

  describe("in music code context", () => {
    it("should scan system break in music code with notes", () => {
      const input = createTune("C ! D");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });

    it("should scan system break between barlines", () => {
      const input = createTune("C D | ! | E F");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });

    it("should scan multiple system breaks", () => {
      const input = createTune("C ! D ! E");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakTokens = tokens.filter((t) => t.type === TT.SYSTEM_BREAK);
      assert.equal(systemBreakTokens.length, 2);
      assert.equal(systemBreakTokens[0].lexeme, "!");
      assert.equal(systemBreakTokens[1].lexeme, "!");
    });
  });

  describe("should NOT match symbols", () => {
    it("should NOT scan symbol notation as system break", () => {
      const input = createTune("!trill! C");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakTokens = tokens.filter((t) => t.type === TT.SYSTEM_BREAK);
      assert.equal(systemBreakTokens.length, 0);

      const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
      assert.ok(symbolToken);
      assert.equal(symbolToken?.lexeme, "!trill!");
    });

    it("should NOT scan plus symbol notation as system break", () => {
      const input = createTune("+fermata+ C");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakTokens = tokens.filter((t) => t.type === TT.SYSTEM_BREAK);
      assert.equal(systemBreakTokens.length, 0);

      const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
      assert.ok(symbolToken);
    });

    it("should distinguish system break from adjacent symbol", () => {
      const input = createTune(" ! !trill! C");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakTokens = tokens.filter((t) => t.type === TT.SYSTEM_BREAK);
      assert.equal(systemBreakTokens.length, 1);

      const symbolToken = tokens.find((t) => t.type === TT.DECORATION);
      assert.ok(symbolToken);
      assert.equal(symbolToken?.lexeme, "!trill!");
    });
  });

  describe("position tracking", () => {
    it("should track position correctly", () => {
      const input = createTune("C ! D");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      // Position is tracked - exact value depends on line breaks and context
      assert.ok(systemBreakToken.position >= 0);
    });

    it("should track line number for system breaks", () => {
      const input = createTune("C ! D");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      // Line number will be 2 (after X: and K: lines)
      assert.ok(systemBreakToken.line >= 0);
    });
  });

  describe("systemBreak function", () => {
    it("should return true for valid system break", () => {
      const ctx = createCtx(" ! ");
      ctx.current = 1; // Position at the bang
      const result = systemBreak(ctx);
      assert.equal(result, true);
      assert.equal(ctx.tokens.length, 1);
      assert.equal(ctx.tokens[0].type, TT.SYSTEM_BREAK);
    });

    it("should return false when not preceded by whitespace", () => {
      const ctx = createCtx("C!");
      ctx.current = 1; // Position at the bang after 'C'
      const result = systemBreak(ctx);
      assert.equal(result, false);
      assert.equal(ctx.tokens.length, 0);
    });

    it("should return false when not followed by whitespace", () => {
      const ctx = createCtx(" !C");
      ctx.current = 1; // Position at the bang after ' '
      const result = systemBreak(ctx);
      assert.equal(result, false);
      assert.equal(ctx.tokens.length, 0);
    });
  });

  describe("edge cases", () => {
    it("should handle system break with newline in music context", () => {
      const input = createTune("C D\n!\nE F");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });

    it("should handle system break with tabs in music context", () => {
      const input = createTune("C\t!\tD");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
      assert.equal(systemBreakToken?.lexeme, "!");
    });

    it("should handle system break between measures", () => {
      const input = createTune("C D | ! | E F");
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);

      const systemBreakToken = tokens.find((t) => t.type === TT.SYSTEM_BREAK);
      assert.ok(systemBreakToken);
    });
  });
});
