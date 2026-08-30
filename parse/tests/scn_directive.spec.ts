import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { scanDirective } from "../parsers/infoLines/scanDirective";
import { Ctx, TT } from "../parsers/scan";
import {
  genMeasurementUnit,
  genNumberWithUnit,
  genDirectiveIdentifier,
  genDirectiveAssignment,
  genDirectiveRational,
  genDirectiveContent,
  genStylesheetDirective,
} from "./scn_infoln_generators";

describe("Directive Scanner Tests", () => {
  function createCtx(source: string): Ctx {
    return new Ctx(source, new ABCContext(new AbcErrorReporter()));
  }

  describe("Basic directive scanning", () => {
    it("should scan simple directive with identifier", () => {
      const ctx = createCtx("%%scale 0.75");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("scale");
      expect(ctx.tokens[2].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[2].lexeme).to.equal("0.75");
    });

    it("should scan directive with decimal number without leading zero", () => {
      const ctx = createCtx("%%scale .9");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("scale");
      expect(ctx.tokens[2].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[2].lexeme).to.equal(".9");
    });

    it("should scan directive with string literal", () => {
      const ctx = createCtx('%%title "My Song"');
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("title");
      expect(ctx.tokens[2].type).to.equal(TT.ANNOTATION);
      expect(ctx.tokens[2].lexeme).to.equal('"My Song"');
    });

    it("should scan directive with number and unit", () => {
      const ctx = createCtx("%%pagewidth 21cm");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("pagewidth");
      expect(ctx.tokens[2].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[2].lexeme).to.equal("21");
      expect(ctx.tokens[3].type).to.equal(TT.MEASUREMENT_UNIT);
      expect(ctx.tokens[3].lexeme).to.equal("cm");
    });

    it("should scan directive with rational number", () => {
      const ctx = createCtx("%%scale 3/4");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[2].lexeme).to.equal("3");
      expect(ctx.tokens[3].type).to.equal(TT.SLASH);
      expect(ctx.tokens[3].lexeme).to.equal("/");
      expect(ctx.tokens[4].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[4].lexeme).to.equal("4");
    });

    it("should scan directive with assignment", () => {
      const ctx = createCtx("%%transpose=2");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("transpose");
      expect(ctx.tokens[2].type).to.equal(TT.EQL);
      expect(ctx.tokens[2].lexeme).to.equal("=");
      expect(ctx.tokens[3].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[3].lexeme).to.equal("2");
    });

    it("should scan directive with tune-body pitch", () => {
      const ctx = createCtx("%%key ^c");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("key");
      expect(ctx.tokens[2].type).to.equal(TT.ACCIDENTAL);
      expect(ctx.tokens[2].lexeme).to.equal("^");
      expect(ctx.tokens[3].type).to.equal(TT.NOTE_LETTER);
      expect(ctx.tokens[3].lexeme).to.equal("c");
    });

    it("should handle directive with hyphens in identifier", () => {
      const ctx = createCtx("%%font-size 12pt");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("font-size");
      expect(ctx.tokens[2].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[2].lexeme).to.equal("12");
      expect(ctx.tokens[3].type).to.equal(TT.MEASUREMENT_UNIT);
      expect(ctx.tokens[3].lexeme).to.equal("pt");
    });
  });

  describe("Complex directive patterns", () => {
    it("should scan directive with multiple parameters", () => {
      const ctx = createCtx('%%margin 1in 2cm "left" top=5pt');
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      const tokenTypes = ctx.tokens.map((t) => TT[t.type]);
      expect(tokenTypes).to.contain("STYLESHEET_DIRECTIVE");
      expect(tokenTypes).to.contain("IDENTIFIER");
      expect(tokenTypes).to.contain("NUMBER");
      expect(tokenTypes).to.contain("MEASUREMENT_UNIT");
      expect(tokenTypes).to.contain("ANNOTATION");
      expect(tokenTypes).to.contain("EQL");
    });

    it("should handle whitespace correctly", () => {
      const ctx = createCtx("%%scale   0.75   ");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      const nonWsTokens = ctx.tokens.filter((t) => t.type !== TT.WS);
      expect(nonWsTokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(nonWsTokens[1].type).to.equal(TT.IDENTIFIER);
      expect(nonWsTokens[2].type).to.equal(TT.NUMBER);
    });

    it("should stop at comment", () => {
      const ctx = createCtx("%%scale 0.75 % this is a comment");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      // Should stop before the comment
      const lastToken = ctx.tokens[ctx.tokens.length - 1];
      expect(lastToken.lexeme).not.to.contain("%");
    });

    it("should stop at end of line", () => {
      const ctx = createCtx("%%scale 0.75\nnext line");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      // Should not include content from next line
      const tokenLexemes = ctx.tokens.map((t) => t.lexeme).join("");
      expect(tokenLexemes).not.to.contain("next");
    });
  });

  describe("Edge cases", () => {
    it("should return false for non-directive content", () => {
      const ctx = createCtx("not a directive");
      const result = scanDirective(ctx);

      expect(result).to.equal(false);
    });

    it("should handle empty directive", () => {
      const ctx = createCtx("%%");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
    });

    it("should handle directive with only whitespace", () => {
      const ctx = createCtx("%%   ");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
    });
  });

  describe("Text directives (%%text, %%center)", () => {
    it("should scan %%text directive with FREE_TXT token", () => {
      const ctx = createCtx("%%text This is some text");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("text");
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("This is some text");
    });

    it("should scan %%center directive with FREE_TXT token", () => {
      const ctx = createCtx("%%center Centered text");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("center");
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Centered text");
    });

    it("should handle %%text with special characters", () => {
      const ctx = createCtx("%%text Hello, world! This is a test.");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Hello, world! This is a test.");
    });

    it("should capture text content including trailing spaces", () => {
      const ctx = createCtx("%%text Some text with spaces");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Some text with spaces");
    });

    it("should handle empty text directive with FREE_TXT token", () => {
      const ctx = createCtx("%%text");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("text");
      // FREE_TXT token is created even for empty text
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("");
    });

    it("should handle %%text with numbers and punctuation", () => {
      const ctx = createCtx("%%text Version 2.0 - updated 2024");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Version 2.0 - updated 2024");
    });
  });

  describe("Parse directive (%%abcls-parse)", () => {
    it("should scan %%abcls-parse linear with expected token sequence", () => {
      const ctx = createCtx("%%abcls-parse linear");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-parse");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("linear");
    });

    it("should scan %%abcls-parse LINEAR with expected token sequence", () => {
      const ctx = createCtx("%%abcls-parse LINEAR");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-parse");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("LINEAR");
    });

    it("should scan %%abcls-parse without parameter", () => {
      const ctx = createCtx("%%abcls-parse");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-parse");
      expect(ctx.tokens.length).to.equal(2);
    });

    it("should scan %%abcls-parse with unknown option", () => {
      const ctx = createCtx("%%abcls-parse foo");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-parse");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("foo");
    });
  });

  describe("Voices directive (%%abcls-voices)", () => {
    it("should scan a note-letter voice id as an identifier, not a pitch", () => {
      const ctx = createCtx("%%abcls-voices show B");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-voices");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("show");
      expect(ctx.tokens[3].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[3].lexeme).to.equal("B");
    });

    it("should scan multiple note-letter voice ids as identifiers", () => {
      const ctx = createCtx("%%abcls-voices show A B C");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      const contentTokens = ctx.tokens.slice(1).filter((t) => t.type !== TT.WS);
      expect(contentTokens.every((t) => t.type === TT.IDENTIFIER)).to.equal(true);
      expect(contentTokens.map((t) => t.lexeme)).to.deep.equal(["abcls-voices", "show", "A", "B", "C"]);
    });

    it("should still scan a non-voice-letter directive's pitch normally alongside abcls-voices in the same document", () => {
      // Regression guard: the abcls-voices gate must be scoped to that
      // directive only, not disable pitch scanning for other directives.
      const ctx = createCtx("%%key ^c");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.ACCIDENTAL);
      expect(ctx.tokens[3].type).to.equal(TT.NOTE_LETTER);
      expect(ctx.tokens[3].lexeme).to.equal("c");
    });
  });

  describe("Formatter directive (%%abcls-fmt)", () => {
    it("should scan %%abcls-fmt system-comments with expected token sequence", () => {
      const ctx = createCtx("%%abcls-fmt system-comments");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-fmt");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("system-comments");
    });

    it("should scan %%abcls-fmt without parameter", () => {
      const ctx = createCtx("%%abcls-fmt");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-fmt");
      expect(ctx.tokens.length).to.equal(2);
    });
  });

  describe("Header/Footer directives (%%header, %%footer)", () => {
    it("should scan %%header directive with FREE_TXT token", () => {
      const ctx = createCtx("%%header Page $P");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("header");
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Page $P");
    });

    it("should scan %%header with tab-separated sections", () => {
      const ctx = createCtx("%%header Left\tCenter\tRight");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Left\tCenter\tRight");
    });

    it("should scan %%footer directive with FREE_TXT token", () => {
      const ctx = createCtx("%%footer Page $P of $N");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].lexeme).to.equal("footer");
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("Page $P of $N");
    });

    it("should handle empty header/footer", () => {
      const ctx = createCtx("%%header");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("");
    });

    it("should preserve field codes in header", () => {
      const ctx = createCtx("%%header $T\t\tPage $P");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[2].type).to.equal(TT.FREE_TXT);
      expect(ctx.tokens[2].lexeme).to.equal("$T\t\tPage $P");
    });
  });

  describe("Property-based testing", () => {
    it("measurement unit generator creates valid tokens", () => {
      fc.assert(
        fc.property(genMeasurementUnit, (token) => {
          expect(token.type).to.equal(TT.MEASUREMENT_UNIT);
          expect(token.lexeme).to.match(/^[a-zA-Z%]+$/);
          expect(token.lexeme.length).to.be.greaterThan(0);
          expect(token.lexeme.length).to.be.lessThan(4);
        })
      );
    });

    it("number with unit generator creates valid token pairs", () => {
      fc.assert(
        fc.property(genNumberWithUnit, (tokens) => {
          expect(tokens[0].type).to.equal(TT.NUMBER);
          expect(tokens[1].type).to.equal(TT.MEASUREMENT_UNIT);
          expect(tokens[0].lexeme).to.match(/^[1-9][0-9]*$/);
          expect(tokens[1].lexeme).to.match(/^[a-zA-Z%]+$/);
        })
      );
    });

    it("directive identifier generator creates valid identifiers", () => {
      fc.assert(
        fc.property(genDirectiveIdentifier, (token) => {
          expect(token.type).to.equal(TT.IDENTIFIER);
          expect(token.lexeme).to.match(/^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z][a-zA-Z0-9]*)?$/);
        })
      );
    });

    it("directive assignment generator creates valid assignments", () => {
      fc.assert(
        fc.property(genDirectiveAssignment, (tokens) => {
          expect(tokens[0].type).to.equal(TT.IDENTIFIER);
          expect(tokens[1].type).to.equal(TT.EQL);
          expect(tokens[2].type).to.equal(TT.NUMBER);
          expect(["transpose", "octave"]).to.contain(tokens[0].lexeme);
          expect(tokens[1].lexeme).to.equal("=");
        })
      );
    });

    it("directive rational generator creates valid fractions", () => {
      fc.assert(
        fc.property(genDirectiveRational, (tokens) => {
          expect(tokens[0].type).to.equal(TT.NUMBER);
          expect(tokens[1].type).to.equal(TT.SLASH);
          expect(tokens[2].type).to.equal(TT.NUMBER);
          expect(tokens[1].lexeme).to.equal("/");
        })
      );
    });

    it("complete stylesheet directive generator creates valid directives", () => {
      fc.assert(
        fc.property(genStylesheetDirective, (tokens) => {
          expect(tokens.length).to.be.greaterThan(2); // At least header, content, EOL
          expect(tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
          expect(tokens[0].lexeme).to.equal("%%");
          expect(tokens[tokens.length - 1].type).to.equal(TT.EOL);
          expect(tokens[tokens.length - 1].lexeme).to.equal("\n");
        })
      );
    });
  });

  describe("Round-trip testing", () => {
    it("scanner can parse its own generated content", () => {
      fc.assert(
        fc.property(genDirectiveContent, (generatedTokens) => {
          // Create source string from generated tokens (don't add extra spaces since generator includes them)
          const source = "%%" + generatedTokens.map((t) => t.lexeme).join("");

          // Scan the generated source
          const ctx = createCtx(source);
          const result = scanDirective(ctx);

          expect(result).to.equal(true);
          expect(ctx.tokens.length).to.be.greaterThan(0);
          expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);

          // The generated tokens should match the scanned ones (excluding header and WS)
          const scannedContent = ctx.tokens.slice(1).filter((t) => t.type !== TT.WS);
          const expectedContent = generatedTokens.filter((t) => t.type !== TT.WS);

          // Should have same number of non-whitespace tokens
          expect(scannedContent.length).to.equal(expectedContent.length);

          // Token types should match
          scannedContent.forEach((token, i) => {
            if (i < expectedContent.length) {
              expect(token.type).to.equal(expectedContent[i].type);
            }
          });
        })
      );
    });

    it("scanner can parse specific example tokens", () => {
      // Example based on the provided tokens:
      // pagewidth (IDENTIFIER, type 13), musicspace (IDENTIFIER, type 13),
      // 5 (NUMBER, type 14), cm (MEASUREMENT_UNIT, type 42)
      const source = "%%pagewidth musicspace 5cm";

      const ctx = createCtx(source);
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens.length).to.be.greaterThan(0);

      // Verify the directive header
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");

      // Filter out whitespace tokens for easier verification
      const contentTokens = ctx.tokens.slice(1).filter((t) => t.type !== TT.WS);

      // Verify we have the expected number of content tokens
      expect(contentTokens.length).to.equal(4);

      // Verify each token matches the expected type and lexeme
      expect(contentTokens[0].type).to.equal(TT.IDENTIFIER);
      expect(contentTokens[0].lexeme).to.equal("pagewidth");
      expect(contentTokens[0].id).to.be.a("number");

      expect(contentTokens[1].type).to.equal(TT.IDENTIFIER);
      expect(contentTokens[1].lexeme).to.equal("musicspace");
      expect(contentTokens[1].id).to.be.a("number");

      expect(contentTokens[2].type).to.equal(TT.NUMBER);
      expect(contentTokens[2].lexeme).to.equal("5");
      expect(contentTokens[2].id).to.be.a("number");

      expect(contentTokens[3].type).to.equal(TT.MEASUREMENT_UNIT);
      expect(contentTokens[3].lexeme).to.equal("cm");
      expect(contentTokens[3].id).to.be.a("number");

      // Verify toString method works as expected
      expect(contentTokens[0].toString()).to.match(/^pagewidth \(id: \d+\)$/);
      expect(contentTokens[1].toString()).to.match(/^musicspace \(id: \d+\)$/);
      expect(contentTokens[2].toString()).to.match(/^5 \(id: \d+\)$/);
      expect(contentTokens[3].toString()).to.match(/^cm \(id: \d+\)$/);
    });

    it("scanner round-trips %%abcls-voices show B without misreading the voice id as a pitch", () => {
      const source = "%%abcls-voices show B";

      const ctx = createCtx(source);
      const result = scanDirective(ctx);

      expect(result).to.equal(true);

      const contentTokens = ctx.tokens.slice(1).filter((t) => t.type !== TT.WS);
      expect(contentTokens.map((t) => t.type)).to.deep.equal([TT.IDENTIFIER, TT.IDENTIFIER, TT.IDENTIFIER]);
      expect(contentTokens.map((t) => t.lexeme)).to.deep.equal(["abcls-voices", "show", "B"]);
    });
  });
});
