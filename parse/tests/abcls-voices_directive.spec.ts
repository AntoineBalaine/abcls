import { expect } from "chai";
import * as fc from "fast-check";
import { analyzeDirective } from "../analyzers/directive-analyzer";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parseDirective } from "../parsers/infoLines/parseDirective";
import { scanDirective } from "../parsers/infoLines/scanDirective";
import { ParseCtx, parse } from "../parsers/parse";
import { Scanner, Ctx, Token, TT } from "../parsers/scan";
import { AbclsVoicesDirectiveData } from "../types/directive-specs";
import { Directive, File_structure, Tune } from "../types/Expr";
import { genAbclsVoicesDirective } from "./scn_infoln_generators";

describe("%%abcls-voices Directive Tests", () => {
  let context: ABCContext;

  beforeEach(() => {
    context = new ABCContext(new AbcErrorReporter());
  });

  function createScanCtx(source: string): Ctx {
    return new Ctx(source, context);
  }

  describe("Scanner: tokenization of %%abcls-voices directive", () => {
    it("should scan %%abcls-voices show V1 V2", () => {
      const ctx = createScanCtx("%%abcls-voices show V1 V2");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[0].type).to.equal(TT.STYLESHEET_DIRECTIVE);
      expect(ctx.tokens[0].lexeme).to.equal("%%");
      expect(ctx.tokens[1].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-voices");
      expect(ctx.tokens[2].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[2].lexeme).to.equal("show");
      expect(ctx.tokens[3].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[3].lexeme).to.equal("V1");
      expect(ctx.tokens[4].type).to.equal(TT.IDENTIFIER);
      expect(ctx.tokens[4].lexeme).to.equal("V2");
    });

    it("should scan %%abcls-voices hide Melody", () => {
      const ctx = createScanCtx("%%abcls-voices hide Melody");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-voices");
      expect(ctx.tokens[2].lexeme).to.equal("hide");
      expect(ctx.tokens[3].lexeme).to.equal("Melody");
    });

    it("should scan %%abcls-voices show with numeric voice IDs", () => {
      const ctx = createScanCtx("%%abcls-voices show 1 2 3");
      const result = scanDirective(ctx);

      expect(result).to.equal(true);
      expect(ctx.tokens[1].lexeme).to.equal("abcls-voices");
      expect(ctx.tokens[2].lexeme).to.equal("show");
      // Numeric IDs are tokenized as NUMBERs
      expect(ctx.tokens[3].type).to.equal(TT.NUMBER);
      expect(ctx.tokens[3].lexeme).to.equal("1");
    });
  });

  describe("Parser: AST structure for %%abcls-voices directive", () => {
    it("should parse %%abcls-voices show V1 V2 into Directive AST", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "show", context.generateId()),
        new Token(TT.IDENTIFIER, "V1", context.generateId()),
        new Token(TT.IDENTIFIER, "V2", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const result = parseDirective(ctx);

      expect(result).to.be.an.instanceof(Directive);
      expect(result!.key.lexeme).to.equal("abcls-voices");
      expect(result!.values).to.have.length(3);
      expect((result!.values[0] as Token).lexeme).to.equal("show");
      expect((result!.values[1] as Token).lexeme).to.equal("V1");
      expect((result!.values[2] as Token).lexeme).to.equal("V2");
    });

    it("should parse %%abcls-voices hide Soprano Alto Bass into Directive AST", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "hide", context.generateId()),
        new Token(TT.IDENTIFIER, "Soprano", context.generateId()),
        new Token(TT.IDENTIFIER, "Alto", context.generateId()),
        new Token(TT.IDENTIFIER, "Bass", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const result = parseDirective(ctx);

      expect(result).to.be.an.instanceof(Directive);
      expect(result!.key.lexeme).to.equal("abcls-voices");
      expect(result!.values).to.have.length(4);
      expect((result!.values[0] as Token).lexeme).to.equal("hide");
    });
  });

  describe("Semantic Analyzer: data extraction for %%abcls-voices directive", () => {
    it("should extract show mode and voice IDs", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "show", context.generateId()),
        new Token(TT.IDENTIFIER, "V1", context.generateId()),
        new Token(TT.IDENTIFIER, "V2", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      expect(semanticData!.type).to.equal("abcls-voices");
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("show");
      expect(data.voiceIds).to.deep.equal(["V1", "V2"]);
    });

    it("should extract hide mode and voice IDs", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "hide", context.generateId()),
        new Token(TT.IDENTIFIER, "Melody", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      expect(semanticData!.type).to.equal("abcls-voices");
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("hide");
      expect(data.voiceIds).to.deep.equal(["Melody"]);
    });

    it("should handle case-insensitive mode (SHOW, Hide)", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "SHOW", context.generateId()),
        new Token(TT.IDENTIFIER, "V1", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("show");
    });

    it("should handle numeric voice IDs", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "show", context.generateId()),
        new Token(TT.NUMBER, "1", context.generateId()),
        new Token(TT.NUMBER, "2", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.voiceIds).to.deep.equal(["1", "2"]);
    });

    it("should report error for invalid mode", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "invalid", context.generateId()),
        new Token(TT.IDENTIFIER, "V1", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.be.null;
      expect(context.errorReporter.getErrors().length).to.be.greaterThan(0);
    });

    it("should report error for missing voice IDs", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "show", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.be.null;
      expect(context.errorReporter.getErrors().length).to.be.greaterThan(0);
    });

    it("should report error for missing mode", () => {
      const tokens = [new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()), new Token(TT.IDENTIFIER, "abcls-voices", context.generateId())];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.be.null;
      expect(context.errorReporter.getErrors().length).to.be.greaterThan(0);
    });

    it("should handle mixed identifier and numeric voice IDs", () => {
      const tokens = [
        new Token(TT.STYLESHEET_DIRECTIVE, "%%", context.generateId()),
        new Token(TT.IDENTIFIER, "abcls-voices", context.generateId()),
        new Token(TT.IDENTIFIER, "show", context.generateId()),
        new Token(TT.IDENTIFIER, "V1", context.generateId()),
        new Token(TT.NUMBER, "2", context.generateId()),
        new Token(TT.IDENTIFIER, "Soprano", context.generateId()),
      ];

      const ctx = new ParseCtx(tokens, context);
      const directive = parseDirective(ctx);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("show");
      expect(data.voiceIds).to.deep.equal(["V1", "2", "Soprano"]);
    });
  });

  describe("Full pipeline integration", () => {
    it("should handle full pipeline from source to semantic data", () => {
      const source = "%%abcls-voices show V1 V2";
      const scanCtx = createScanCtx(source);
      const scanResult = scanDirective(scanCtx);

      expect(scanResult).to.equal(true);

      const parseCtx = new ParseCtx(scanCtx.tokens, context);
      const directive = parseDirective(parseCtx);

      expect(directive).to.be.an.instanceof(Directive);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      expect(semanticData!.type).to.equal("abcls-voices");
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("show");
      expect(data.voiceIds).to.deep.equal(["V1", "V2"]);
    });

    it("should handle a voice ID that collides with a note letter (e.g. 'B')", () => {
      // "B" is a valid ABC note name, so scanDirective() special-cases the
      // abcls-voices directive to scan it as TT.IDENTIFIER instead of running
      // it through pitch scanning (which would otherwise produce TT.NOTE_LETTER).
      const source = "%%abcls-voices show B";
      const scanCtx = createScanCtx(source);
      const scanResult = scanDirective(scanCtx);

      expect(scanResult).to.equal(true);

      const parseCtx = new ParseCtx(scanCtx.tokens, context);
      const directive = parseDirective(parseCtx);

      expect(directive).to.be.an.instanceof(Directive);

      const analyzer = new SemanticAnalyzer(context);
      const semanticData = analyzeDirective(directive!, analyzer);

      expect(semanticData).to.not.be.null;
      const data = semanticData!.data as AbclsVoicesDirectiveData;
      expect(data.mode).to.equal("show");
      expect(data.voiceIds).to.deep.equal(["B"]);
    });
  });

  describe("Property-based tests", () => {
    it("should always parse generated abcls-voices directives into valid Directive AST", () => {
      fc.assert(
        fc.property(genAbclsVoicesDirective, (tokens) => {
          const ctx = new ABCContext(new AbcErrorReporter());
          // Filter out EOL and WS tokens for parsing (parser expects clean token stream)
          const parseTokens = tokens.filter((t) => t.type !== TT.EOL && t.type !== TT.WS);
          const parseCtx = new ParseCtx(parseTokens, ctx);
          const result = parseDirective(parseCtx);

          // Property: parsing should always succeed
          if (!(result instanceof Directive)) return false;

          // Property: directive key should be "abcls-voices"
          if (result.key.lexeme !== "abcls-voices") return false;

          // Property: values array should have at least 2 elements (mode + at least one voice ID)
          if (result.values.length < 2) return false;

          // Property: first value (mode) should be "show" or "hide"
          const mode = (result.values[0] as Token).lexeme.toLowerCase();
          if (mode !== "show" && mode !== "hide") return false;

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should always produce valid semantic data from generated abcls-voices directives", () => {
      fc.assert(
        fc.property(genAbclsVoicesDirective, (tokens) => {
          const ctx = new ABCContext(new AbcErrorReporter());
          // Filter out EOL and WS tokens for parsing
          const parseTokens = tokens.filter((t) => t.type !== TT.EOL && t.type !== TT.WS);
          const parseCtx = new ParseCtx(parseTokens, ctx);
          const directive = parseDirective(parseCtx);

          if (!directive) return false;

          const analyzer = new SemanticAnalyzer(ctx);
          const semanticData = analyzeDirective(directive, analyzer);

          // Property: semantic analysis should always succeed for valid directives
          if (!semanticData) return false;

          // Property: type should be "abcls-voices"
          if (semanticData.type !== "abcls-voices") return false;

          const data = semanticData.data as AbclsVoicesDirectiveData;

          // Property: mode should be "show" or "hide"
          if (data.mode !== "show" && data.mode !== "hide") return false;

          // Property: voiceIds should be non-empty array
          if (!Array.isArray(data.voiceIds) || data.voiceIds.length === 0) return false;

          // Property: all voice IDs should be non-empty strings
          if (!data.voiceIds.every((id) => typeof id === "string" && id.length > 0)) return false;

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it("should preserve voice ID count through parsing and semantic analysis", () => {
      fc.assert(
        fc.property(genAbclsVoicesDirective, (tokens) => {
          const ctx = new ABCContext(new AbcErrorReporter());
          // Filter out EOL and WS tokens, count IDENTIFIER tokens after mode
          const parseTokens = tokens.filter((t) => t.type !== TT.EOL && t.type !== TT.WS);

          // Count voice IDs in generated tokens (all IDENTIFIER tokens after position 2)
          // Position 0: %%, Position 1: abcls-voices, Position 2: mode, Position 3+: voice IDs
          const generatedVoiceIdCount = parseTokens.slice(3).filter((t) => t.type === TT.IDENTIFIER).length;

          const parseCtx = new ParseCtx(parseTokens, ctx);
          const directive = parseDirective(parseCtx);

          if (!directive) return false;

          const analyzer = new SemanticAnalyzer(ctx);
          const semanticData = analyzeDirective(directive, analyzer);

          if (!semanticData) return false;

          const data = semanticData.data as AbclsVoicesDirectiveData;

          // Property: voice ID count should be preserved
          return data.voiceIds.length === generatedVoiceIdCount;
        }),
        { numRuns: 100 }
      );
    });

    it("should handle mode case-insensitively in generated directives", () => {
      // Generate directives with random case for mode
      const genMixedCaseMode = fc.constantFrom("show", "SHOW", "Show", "hide", "HIDE", "Hide");

      fc.assert(
        fc.property(genMixedCaseMode, (mode) => {
          const ctx = new ABCContext(new AbcErrorReporter());
          const tokens = [
            new Token(TT.STYLESHEET_DIRECTIVE, "%%", ctx.generateId()),
            new Token(TT.IDENTIFIER, "abcls-voices", ctx.generateId()),
            new Token(TT.IDENTIFIER, mode, ctx.generateId()),
            new Token(TT.IDENTIFIER, "V1", ctx.generateId()),
          ];

          const parseCtx = new ParseCtx(tokens, ctx);
          const directive = parseDirective(parseCtx);

          if (!directive) return false;

          const analyzer = new SemanticAnalyzer(ctx);
          const semanticData = analyzeDirective(directive, analyzer);

          if (!semanticData) return false;

          const data = semanticData.data as AbclsVoicesDirectiveData;

          // Property: mode should be normalized to lowercase
          const expectedMode = mode.toLowerCase();
          return data.mode === expectedMode;
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("Full tune property-based tests", () => {
    // Generator for voice IDs. Includes single-letter IDs (e.g. "B") that collide
    // with ABC note names -- scanDirective() special-cases abcls-voices so these
    // still scan as plain identifiers rather than pitches.
    const genVoiceId = fc.stringMatching(/^[A-Z][a-zA-Z0-9]*$/).filter((id) => id.length >= 1 && id.length <= 10);

    // Generator for a minimal tune body
    const genTuneBodyContent = fc.constantFrom("CDEF|", "GABc|", "defg|", "abcd|");

    it("should parse %%abcls-voices directive in file header of full tune", () => {
      fc.assert(
        fc.property(fc.constantFrom("show", "hide"), fc.array(genVoiceId, { minLength: 1, maxLength: 3 }), genTuneBodyContent, (mode, voiceIds, body) => {
          const ctx = new ABCContext(new AbcErrorReporter());

          // Build a full ABC file with %%abcls-voices in file header
          const source = `%%abcls-voices ${mode} ${voiceIds.join(" ")}

X:1
T:Test Tune
M:4/4
L:1/4
K:C
${body}
`;
          // Parse the full file
          const tokens = Scanner(source, ctx);
          const ast = parse(tokens, ctx);

          // Property: parsing should succeed
          if (!(ast instanceof File_structure)) return false;

          // Property: file header should exist and contain the directive
          if (!ast.file_header) return false;

          const directives = ast.file_header.contents.filter((item) => item instanceof Directive && item.key.lexeme === "abcls-voices");

          // Property: exactly one %%abcls-voices directive in file header
          if (directives.length !== 1) return false;

          const directive = directives[0] as Directive;

          // Property: directive should have correct mode and voice IDs
          const modeToken = directive.values[0] as Token;
          if (modeToken.lexeme.toLowerCase() !== mode) return false;

          // Property: voice ID count should match
          const directiveVoiceIds = directive.values.slice(1).map((t) => (t as Token).lexeme);
          if (directiveVoiceIds.length !== voiceIds.length) return false;

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("should parse %%abcls-voices directive in tune header of full tune", () => {
      fc.assert(
        fc.property(fc.constantFrom("show", "hide"), fc.array(genVoiceId, { minLength: 1, maxLength: 3 }), genTuneBodyContent, (mode, voiceIds, body) => {
          const ctx = new ABCContext(new AbcErrorReporter());

          // Build a full ABC file with %%abcls-voices in tune header
          const source = `X:1
T:Test Tune
M:4/4
L:1/4
%%abcls-voices ${mode} ${voiceIds.join(" ")}
K:C
${body}
`;
          // Parse the full file
          const tokens = Scanner(source, ctx);
          const ast = parse(tokens, ctx);

          // Property: parsing should succeed
          if (!(ast instanceof File_structure)) return false;

          // Property: should have at least one tune
          const tunes = ast.contents.filter((item) => item instanceof Tune);
          if (tunes.length === 0) return false;

          const tune = tunes[0] as Tune;

          // Property: tune header should contain the directive
          const directives = tune.tune_header.info_lines.filter((item) => item instanceof Directive && item.key.lexeme === "abcls-voices");

          // Property: exactly one %%abcls-voices directive in tune header
          if (directives.length !== 1) return false;

          const directive = directives[0] as Directive;

          // Property: directive should have correct mode
          const modeToken = directive.values[0] as Token;
          if (modeToken.lexeme.toLowerCase() !== mode) return false;

          // Property: voice ID count should match
          const directiveVoiceIds = directive.values.slice(1).map((t) => (t as Token).lexeme);
          if (directiveVoiceIds.length !== voiceIds.length) return false;

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it("should parse multiple tunes with different %%abcls-voices directives", () => {
      fc.assert(
        fc.property(fc.constantFrom("show", "hide"), fc.constantFrom("show", "hide"), genVoiceId, genVoiceId, (mode1, mode2, voiceId1, voiceId2) => {
          const ctx = new ABCContext(new AbcErrorReporter());

          // Build a file with file-level directive and tune-level override
          const source = `%%abcls-voices ${mode1} ${voiceId1}

X:1
T:Tune 1
M:4/4
K:C
CDEF|

X:2
T:Tune 2
%%abcls-voices ${mode2} ${voiceId2}
M:4/4
K:C
GABc|
`;
          const tokens = Scanner(source, ctx);
          const ast = parse(tokens, ctx);

          if (!(ast instanceof File_structure)) return false;

          // Property: file header should have directive
          if (!ast.file_header) return false;
          const fileDirectives = ast.file_header.contents.filter((item) => item instanceof Directive && item.key.lexeme === "abcls-voices");
          if (fileDirectives.length !== 1) return false;

          // Property: tune 2 should have its own directive
          const tunes = ast.contents.filter((item) => item instanceof Tune) as Tune[];
          if (tunes.length !== 2) return false;

          const tune2Directives = tunes[1].tune_header.info_lines.filter((item) => item instanceof Directive && item.key.lexeme === "abcls-voices");
          if (tune2Directives.length !== 1) return false;

          // Property: tune 2's directive should have the second mode
          const tune2Directive = tune2Directives[0] as Directive;
          const tune2Mode = (tune2Directive.values[0] as Token).lexeme.toLowerCase();
          if (tune2Mode !== mode2) return false;

          return true;
        }),
        { numRuns: 30 }
      );
    });

    it("should preserve voice IDs through full parse pipeline", () => {
      fc.assert(
        fc.property(fc.constantFrom("show", "hide"), fc.array(genVoiceId, { minLength: 1, maxLength: 5 }), (mode, voiceIds) => {
          const ctx = new ABCContext(new AbcErrorReporter());

          const source = `X:1
T:Test
%%abcls-voices ${mode} ${voiceIds.join(" ")}
K:C
C|
`;
          const tokens = Scanner(source, ctx);
          const ast = parse(tokens, ctx);

          if (!(ast instanceof File_structure)) return false;

          const tunes = ast.contents.filter((item) => item instanceof Tune) as Tune[];
          if (tunes.length === 0) return false;

          const directives = tunes[0].tune_header.info_lines.filter((item) => item instanceof Directive && item.key.lexeme === "abcls-voices") as Directive[];
          if (directives.length !== 1) return false;

          const directive = directives[0];
          const parsedVoiceIds = directive.values.slice(1).map((t) => (t as Token).lexeme);

          // Property: all voice IDs should be preserved exactly
          if (parsedVoiceIds.length !== voiceIds.length) return false;

          for (let i = 0; i < voiceIds.length; i++) {
            if (parsedVoiceIds[i] !== voiceIds[i]) return false;
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });
  });
});
