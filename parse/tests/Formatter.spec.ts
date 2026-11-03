import chai, { assert } from "chai";
import { ABCContext } from "../parsers/Context";
import { ParseCtx, parseTune } from "../parsers/parse";
import { Scanner, Token, TT } from "../parsers/scan";
import { Info_line, System } from "../types/Expr";
import { AbcFormatter } from "../Visitors/Formatter";

const expect = chai.expect;

function format(input: string, ctx: ABCContext, formatter: AbcFormatter): string {
  const tokens = Scanner(input, ctx);
  const parseCtx = new ParseCtx(tokens, ctx);
  const ast = parseTune(parseCtx);
  if (!ast) {
    throw new Error("Failed to parse");
  }
  return formatter.format(ast);
}

// Helper function to remove tune header for test assertions
function removeTuneHeader(testStr: string): string {
  return testStr.replace(/X:1\n/, "");
}

// Type for system line tests
type SystemLineTest = {
  title: string;
  test: (systems: System[] | string, expected: string) => void;
  input: string;
  expected: string;
};
describe("AbcFormatter", () => {
  describe("AbcFormatter.format() - single voice rules", () => {
    let formatter: AbcFormatter;
    let ctx: ABCContext;

    beforeEach(() => {
      ctx = new ABCContext();
      formatter = new AbcFormatter(ctx);
    });

    describe("basic spacing rules", () => {
      it("adds spaces around bar lines", () => {
        assert.equal(format("X:1\nCDEF|GABG|", ctx, formatter), "X:1\nCDEF | GABG |");
      });

      it("preserves beamed notes without internal spaces", () => {
        assert.equal(format("X:1\nCDEF GABG|", ctx, formatter), "X:1\nCDEF GABG |");
      });

      it("glues a bang-delimited decoration to the following note with no space, like single-character decorations", () => {
        assert.equal(format("X:1\n!p!CDEF|", ctx, formatter), "X:1\n!p!CDEF |");
      });
    });

    describe("edge cases", () => {
      it("handles multiple decorations", () => {
        assert.equal(format("X:1\n!p!!f!CDEF|", ctx, formatter), "X:1\n!p!!f!CDEF |");
      });

      it("handles grace notes", () => {
        assert.equal(format("X:1\n{ag}CDEF|", ctx, formatter), "X:1\n{ag}CDEF |");
      });

      it("handles inline fields", () => {
        assert.equal(format("X:1\n[K:C]CDEF|", ctx, formatter), "X:1\n[K:C] CDEF |");
      });

      it("preserves spaces in annotations", () => {
        assert.equal(format('X:1\n"swing feel"CDEF|', ctx, formatter), 'X:1\n"swing feel" CDEF |');
      });

      it("handles tuplets", () => {
        assert.equal(format("X:1\n(3CDE CDEF|", ctx, formatter), "X:1\n(3CDE CDEF |");
      });
    });

    describe("complex cases", () => {
      it("handles mix of beamed and single notes", () => {
        assert.equal(format("X:1\nCDEF G A|", ctx, formatter), "X:1\nCDEF G A |");
      });

      it("handles notes with rhythm", () => {
        assert.equal(format("X:1\nC2D/2E/2F|", ctx, formatter), "X:1\nC2D/E/F |");
      });

      it("handles broken rhythms", () => {
        assert.equal(format("X:1\nC>D E<F|", ctx, formatter), "X:1\nC>D E<F |");
      });

      it("handles zero-duration notes (B0)", () => {
        assert.equal(format("X:1\nB0 C D|", ctx, formatter), "X:1\nB0 C D |");
      });

      it("handles leading zero rhythm (C02)", () => {
        assert.equal(format("X:1\nC02 D E|", ctx, formatter), "X:1\nC02 D E |");
      });

      it("handles zero with fractional rhythm (C0/2)", () => {
        assert.equal(format("X:1\nC0/2 D E|", ctx, formatter), "X:1\nC0/ D E |");
      });

      it("handles zero-duration chord ([CEG]0)", () => {
        assert.equal(format("X:1\n[CEG]0 D E|", ctx, formatter), "X:1\n[CEG]0 D E |");
      });

      it("handles consecutive zero-duration notes (B0 B0 B0)", () => {
        assert.equal(format("X:1\nB0 B0 B0 B0|", ctx, formatter), "X:1\nB0 B0 B0 B0 |");
      });
    });

    describe("special notations", () => {
      it("handles multi-measure rests", () => {
        assert.equal(format("X:1\nZ2|", ctx, formatter), "X:1\nZ2 |");
      });

      it("handles symbol decorations", () => {
        assert.equal(format("X:1\n!trill!C!turn!D|", ctx, formatter), "X:1\n!trill!C!turn!D |");
      });

      it("handles multiple voice markers in single voice", () => {
        assert.equal(format("X:1\n[V:1]CDEF|[V:1]GABG|", ctx, formatter), "X:1\n[V:1] CDEF | [V:1] GABG |");
      });
    });

    describe("comments and whitespace", () => {
      it("preserves end-of-line comments", () => {
        assert.equal(format("X:1\nCDEF|% comment\nGABG|", ctx, formatter), "X:1\nCDEF | % comment\nGABG |");
      });

      it("handles stylesheet directives", () => {
        const fmt = format("X:1\n%%score 1\nCDEF|", ctx, formatter);
        assert.equal(fmt, "X:1\n%%score 1\nCDEF |");
      });

      it("preserves empty lines", () => {
        assert.equal(format("X:1\nCDEF|\nGABG|", ctx, formatter), "X:1\nCDEF |\nGABG |");
      });
    });
    describe("info lines in tune body", () => {
      it("preserves info lines in tune body", () => {
        assert.equal(
          format(
            `X:1
CDEF|
T: hello
GABG|`,
            ctx,
            formatter
          ),
          `X:1
CDEF |
T: hello
GABG |`
        );
      });
    });

    describe("single-note chord conversion", () => {
      it("converts single-note chord [a] to note a", () => {
        assert.equal(format("X:1\n[a]|", ctx, formatter), "X:1\na |");
      });

      it("preserves note rhythm when chord has no rhythm: [a2] -> a2", () => {
        assert.equal(format("X:1\n[a2]|", ctx, formatter), "X:1\na2 |");
      });

      it("chord rhythm takes priority over note rhythm: [a2]3 -> a3", () => {
        assert.equal(format("X:1\n[a2]3|", ctx, formatter), "X:1\na3 |");
      });

      it("note inherits chord rhythm when note has no rhythm: [a]3 -> a3", () => {
        assert.equal(format("X:1\n[a]3|", ctx, formatter), "X:1\na3 |");
      });

      it("preserves multi-note chords", () => {
        assert.equal(format("X:1\n[ceg]|", ctx, formatter), "X:1\n[ceg] |");
      });

      it("converts single-note chord in context with other notes (beamed)", () => {
        // Adjacent notes are beamed together, so no spaces between them
        assert.equal(format("X:1\nC[a]D|", ctx, formatter), "X:1\nCaD |");
      });

      it("handles multiple adjacent single-note chords (beamed)", () => {
        // Adjacent notes are beamed together, so no spaces between them
        assert.equal(format("X:1\n[c][d][e]|", ctx, formatter), "X:1\ncde |");
      });

      it("converts single-note chord with space separation", () => {
        assert.equal(format("X:1\nC [a] D|", ctx, formatter), "X:1\nC a D |");
      });
    });
  });

  describe("AbcFormatter multi-voice alignment", () => {
    let formatter: AbcFormatter;
    let ctx: ABCContext;

    beforeEach(() => {
      ctx = new ABCContext();
      formatter = new AbcFormatter(ctx);
    });

    describe("AbcFormatter - voice lines with metadata", () => {
      let formatter: AbcFormatter;
      let ctx: ABCContext;

      beforeEach(() => {
        ctx = new ABCContext();
        formatter = new AbcFormatter(ctx);
      });

      describe("voice lines with metadata", () => {
        it("preserves metadata in voice declaration", () => {
          const result = format(
            `
X:1
V:1 clef=treble
V:2 clef=bass
V:1
CDEF|GABC|
V:2
CDEF|GABC|`,
            ctx,
            formatter
          );

          assert.equal(
            result,
            `X:1
V:1 clef=treble
V:2 clef=bass
V:1
CDEF | GABC |
V:2
CDEF | GABC |`
          );
        });

        it("preserves complex metadata and comments", () => {
          const result = format(
            `X:1
V:RH clef=treble octave=4 % right hand
V:LH clef=bass octave=3 % left hand
V:RH
CDEF|GABC|
V:LH
C,D,E,F,|G,A,B,C,|`,
            ctx,
            formatter
          );

          assert.equal(
            result,
            `X:1
V:RH clef=treble octave=4 % right hand
V:LH clef=bass octave=3 % left hand
V:RH
CDEF     | GABC     |
V:LH
C,D,E,F, | G,A,B,C, |`
          );
        });

        it("handles voice names with spaces and metadata", () => {
          const result = format(
            `X:1
V:Right_Hand clef=treble % treble staff
V:Left_Hand clef=bass % bass staff
V:Right_Hand
CDEF|GABC|
V:Left_Hand
CDEF|GABC|`,
            ctx,
            formatter
          );

          assert.equal(
            result,
            `X:1
V:Right_Hand clef=treble % treble staff
V:Left_Hand clef=bass % bass staff
V:Right_Hand
CDEF | GABC |
V:Left_Hand
CDEF | GABC |`
          );
        });

        it("formats voice line with multiple key=value pairs without spaces around =", () => {
          const result = format(
            `X:1
V:RH clef=treble
V:LH clef=bass octave=-2
V:RH
CDEF|
V:LH
C,D,|`,
            ctx,
            formatter
          );

          assert.equal(
            result,
            `X:1
V:RH clef=treble
V:LH clef=bass octave=-2
V:RH
CDEF |
V:LH
C,D, |`
          );
        });
      });
    });

    describe("basic bar alignment", () => {
      it("aligns simple bars of equal length", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
   CDEF|    GABC|
V:2
CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
CDEF | GABC |
V:2
CDEF | GABC |`
        );
      });

      it("aligns bars of different lengths", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
CD|GABC|
V:2
CDEF|GA|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
CD   | GABC |
V:2
CDEF | GA   |`
        );
      });

      it("aligns bars with chords", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
[CEG]D|GABC|
V:2
   CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
[CEG]D | GABC |
V:2
CDEF   | GABC |`
        );
      });
    });

    describe("complex alignments", () => {
      it("aligns bars with decorations and grace notes", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
!p!C {ag}D|GABC|
V:2
C DEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
!p!C {ag}D   | GABC |
V:2
   C     DEF | GABC |`
        );
      });

      it("aligns bars with different note lengths", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
C2D2|GABC|
V:2
CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
C2D2 | GABC |
V:2
CDEF | GABC |`
        );
      });

      it("aligns bars with tuplets", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
(3CDE CDEF|GABC|
V:2
CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
(3CDE CDEF | GABC |
V:2
  CDEF     | GABC |`
        );
      });
      it("aligns bars that start with annotations", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
"hello"CDEF|GABC|"again" DE
V:2
CDEF|"world"GABC|DE`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
"hello" CDEF |         GABC | "again" DE
V:2
        CDEF | "world" GABC |         DE`
        );
      });
    });

    describe("multi-measure rests", () => {
      it("aligns with expanded multi-measure rests", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
Z4|
V:2
CDEF|GABC|CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
Z    | Z    | Z    | Z    |
V:2
CDEF | GABC | CDEF | GABC |`
        );
      });
    });

    describe("edge cases", () => {
      it("aligns chord symbol annotation with inline voice fields", () => {
        const result = format(
          `X:1
[V:1] [K:style=rhythm] "Cm" B0 B0 B0 B0 |
[V:2] [K:style=normal]      a2b2c2d2    |`,
          ctx,
          formatter
        );

        // The chord symbol "Cm" should stay attached to the note B0
        // Zero-length notes (B0) are treated as quarter notes for alignment purposes
        assert.equal(
          result,
          `X:1
[V:1] [K:style=rhythm] "Cm" B0 B0 B0 B0 |
[V:2] [K:style=normal]      a2b2c2d2    |`
        );
      });

      it("aligns zero-length notes with L:1/4 (quarter note default)", () => {
        const result = format(
          `X:1
L:1/4
[V:1] B0 B0 B0 B0 |
[V:2] a  b  c  d  |`,
          ctx,
          formatter
        );

        // With L:1/4, zero-length notes advance by 1/4 / (1/4) = 1 unit
        // Each B0 should align with each note a, b, c, d
        assert.equal(
          result,
          `X:1
L:1/4
[V:1] B0 B0 B0 B0 |
[V:2] a  b  c  d  |`
        );
      });

      it("aligns zero-length notes with L:1/16 (sixteenth note default)", () => {
        const result = format(
          `X:1
L:1/16
[V:1] B0 B0 B0 B0 |
[V:2] a4 b4 c4 d4 |`,
          ctx,
          formatter
        );

        // With L:1/16, zero-length notes advance by 1/4 / (1/16) = 4 units
        // Each B0 should align with quarter note durations (a4, b4, c4, d4)
        assert.equal(
          result,
          `X:1
L:1/16
[V:1] B0 B0 B0 B0 |
[V:2] a4 b4 c4 d4 |`
        );
      });

      it("handles empty bars", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
CDEF| GABC| CDE
V:2
CDEF| |GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
CDEF | GABC | CDE
V:2
CDEF |      | GABC |`
        );
      });

      it("handles different numbers of bars per voice in a system", () => {
        const result = format(
          `X:1
V:1
V:2
V:3
V:1
CDEF|GABC|
V:2
CDEF|GABC|
V:3
CDEF|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:3
V:1
CDEF | GABC |
V:2
CDEF | GABC |
V:3
CDEF |`
        );
      });

      it("preserves comments between voices", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
CDEF|GABC|
% middle comment
V:2
CDEF|GABC|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
CDEF | GABC |
% middle comment
V:2
CDEF | GABC |`
        );
      });

      it("handles bars with mixed note groupings", () => {
        const result = format(
          `X:1
V:1
V:2
V:1
CDEF GABC|CDEF|
V:2
CD EF GA|CDEF|`,
          ctx,
          formatter
        );

        assert.equal(
          result,
          `X:1
V:1
V:2
V:1
CDEF  GABC | CDEF |
V:2
CD EF GA   | CDEF |`
        );
      });
    });
  });

  describe("AbcFormatter - unmarked lines in multi-voice tunes", () => {
    let formatter: AbcFormatter;
    let ctx: ABCContext;

    beforeEach(() => {
      ctx = new ABCContext();
      formatter = new AbcFormatter(ctx);
    });

    it("preserves unmarked lines before voiced content", () => {
      const result = format(
        `X:1
% setup comment
This is some text
K:C
% another comment
V:1 name=voice1
V:2 name=voice2
CDEF|GABC|
EDC2|GFE2|
V:2
CDEF|GABC|`,
        ctx,
        formatter
      );

      assert.equal(
        result,
        `X:1
% setup comment
This is some text
K:C
% another comment
V:1 name=voice1
V:2 name=voice2
CDEF | GABC |
EDC2 | GFE2 |
V:2
CDEF | GABC |`
      );
    });
    it("preserves unmarked lines and line breaks", () => {
      const result = format(
        `X:1
V:SnareDrum stem=up
V:2 stem=up
K:C clef=perc stafflines=1
B8 z8 | 
CDEF|GABC|`,
        ctx,
        formatter
      );

      assert.equal(
        result,
        `X:1
V:SnareDrum stem=up
V:2 stem=up
K:C clef=perc stafflines=1
B8 z8 |
CDEF | GABC |`
      );
    });
  });
});

describe("Format Info Lines in Tune Header", function () {
  const SystemLineTests: SystemLineTest[] = [
    {
      title: "format a tune header containing info lines only",
      test: (input, expected) => {
        const ctx = new ABCContext();
        const tokens = Scanner(input as string, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const formatter = new AbcFormatter(ctx);
        const fmt = formatter.visitTuneHeaderExpr(ast.tune_header);
        expect(fmt).to.not.be.undefined;
        assert.equal(fmt, expected);
      },
      input: `X:1
M:4/4
L:1/8
K:C
`,
      expected: `X:1
M:4/4
L:1/8
K:C`,
    },
    {
      title: "format a tune header containing comments",
      test: (input, expected) => {
        const ctx = new ABCContext();
        const tokens = Scanner(input as string, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const formatter = new AbcFormatter(ctx);
        const fmt = formatter.visitTuneHeaderExpr(ast.tune_header);
        expect(fmt).to.not.be.undefined;
        assert.equal(fmt, expected);
      },
      input: `X:1
M:4/4
L:1/8
%surprise
K:C
`,
      expected: `X:1
M:4/4
L:1/8
%surprise
K:C`,
    },
  ];

  SystemLineTests.forEach(({ title, test, input, expected }) => {
    it(title, () => {
      test(input, expected);
    });
  });
});

describe("Format Info Lines in Tune Body", function () {
  const SystemLineTests: SystemLineTest[] = [
    {
      title: "format a tune body containing info lines",
      test: (input, expected) => {
        const ctx = new ABCContext();
        const tokens = Scanner(input as string, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast || !ast.tune_body) {
          throw new Error("Failed to parse or no tune body");
        }
        const formatter = new AbcFormatter(ctx);
        const fmt = formatter.visitTuneBodyExpr(ast.tune_body);
        expect(fmt).to.not.be.undefined;
        assert.equal(fmt, expected);
      },
      input: `X:1
abc
M:4/4
L:1/8
K:C
`,
      expected: `abc
M:4/4
L:1/8
K:C
`,
    },
  ];

  SystemLineTests.forEach(({ title, test, input, expected }) => {
    it(title, () => {
      test(input, expected);
    });
  });
});

describe("Formatter2", function () {
  describe("formats text", function () {
    const input = "X:1\n[V:T1] (B2c2 d2g2)   | f6e2   |   (d2c2 d2)e2 | d4 c2z2 |";
    const expected_no_format = "[V:T1] (B2c2 d2g2)   | f6e2   |   (d2c2 d2)e2 | d4 c2z2 |";
    const expected_fmt = "[V:T1] (B2c2 d2g2) | f6e2 | (d2c2 d2)e2 | d4 c2 z2 |";

    it("can visit the tree without modifying source", function () {
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);
      const parseCtx = new ParseCtx(tokens, ctx);
      const ast = parseTune(parseCtx);
      if (!ast) {
        throw new Error("Failed to parse");
      }
      const fmt = new AbcFormatter(ctx).stringify(ast);
      assert.equal(removeTuneHeader(fmt).trim(), expected_no_format);
    });

    it("removes useless double spaces", function () {
      const ctx = new ABCContext();
      const tokens = Scanner(input, ctx);
      const parseCtx = new ParseCtx(tokens, ctx);
      const ast = parseTune(parseCtx);
      if (!ast) {
        throw new Error("Failed to parse");
      }
      const fmt = new AbcFormatter(ctx).format(ast);
      assert.equal(removeTuneHeader(fmt).trim(), expected_fmt);
    });
  });
});

describe("Formatter2: Stringify", () => {
  describe("stringify grace groups", () => {
    const sample = [
      ["X:1\n{b}c", "{b}c"],
      ["X:1\n{/b}c", "{/b}c"],
    ];
    sample.forEach(([input, expected]) => {
      it(`should stringify ${input} into ${expected}`, () => {
        const ctx = new ABCContext();
        const tokens = Scanner(input, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const fmt = new AbcFormatter(ctx).stringify(ast);
        assert.equal(removeTuneHeader(fmt).trim(), expected);
      });
    });
  });

  describe("stringify notes with ties", () => {
    const sample = [["X:1\na-", "a-"]];
    sample.forEach(([input, expected]) => {
      it(`should stringify ${input} into ${expected}`, () => {
        const ctx = new ABCContext();
        const tokens = Scanner(input, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const fmt = new AbcFormatter(ctx).stringify(ast);
        assert.equal(removeTuneHeader(fmt).trim(), expected);
      });
    });
  });
});

describe("Formatter2: Whitespace handling", () => {
  const errorSamples = [
    {
      title: "removes trailing whitespaces",
      input: "X:1\nab | \\   ",
      expected: "ab | \\",
    },
    {
      title: "handles slurs correctly",
      input: "X:1\na| (d4 e2)|",
      expected: "a | (d4 e2) |",
    },
  ];

  describe("using format()", () => {
    errorSamples.forEach(({ title, input, expected }) => {
      it(title, () => {
        const ctx = new ABCContext();
        const formatter = new AbcFormatter(ctx);
        const tokens = Scanner(input, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const result = formatter.format(ast);
        assert.equal(removeTuneHeader(result).trim(), expected);
      });
    });
  });
});

describe("Formatter2: Error Preservation", () => {
  const errorSamples = [
    {
      title: "preserves invalid decoration",
      input: "X:1\n~23 abc",
      expected: "~23 abc",
    },
    {
      title: "preserves invalid escaped character",
      input: "X:1\nabc \\e def",
      expected: "abc \\e def",
    },
    {
      title: "preserves error tokens while formatting valid parts",
      input: "X:1\nabc ~23 | def",
      expected: "abc ~23 | def",
    },
    {
      title: "removes trailing whitespaces",
      input: "X:1\nab | \\   ",
      expected: "ab | \\",
    },
    { title: "error at end of input", input: "X:1\nabcî", expected: "abcî", fmt_expected: "abc î" },
  ];

  // Test both stringify and format methods
  describe("using stringify()", () => {
    errorSamples.forEach(({ title, input, expected }) => {
      it(title, () => {
        const ctx = new ABCContext();
        const formatter = new AbcFormatter(ctx);
        const tokens = Scanner(input, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const result = formatter.stringify(ast);
        assert.equal(removeTuneHeader(result).trim(), expected);
      });
    });
  });

  describe("using format()", () => {
    errorSamples.forEach(({ title, input, expected, fmt_expected }) => {
      it(title, () => {
        const ctx = new ABCContext();
        const formatter = new AbcFormatter(ctx);
        const tokens = Scanner(input, ctx);
        const parseCtx = new ParseCtx(tokens, ctx);
        const ast = parseTune(parseCtx);
        if (!ast) {
          throw new Error("Failed to parse");
        }
        const result = formatter.format(ast);
        assert.equal(removeTuneHeader(result).trim(), fmt_expected ?? expected);
      });
    });
  });

  // Test that errors are preserved even in complex contexts
  it("preserves errors in multi-voice context", () => {
    const input = `X:1\n[V:1]abc ~23 |\n[V:2]def \\e |\n`;
    // Note: V:2 has extra space before | due to alignment with V:1
    const expected = `[V:1] abc ~23 |\n[V:2] def \\e  |`;

    const ctx = new ABCContext();
    const formatter = new AbcFormatter(ctx);
    const tokens = Scanner(input, ctx);
    const parseCtx = new ParseCtx(tokens, ctx);
    const ast = parseTune(parseCtx);
    if (!ast) {
      throw new Error("Failed to parse");
    }
    const result = formatter.format(ast);
    assert.equal(removeTuneHeader(result).trim(), expected);
  });

  // Test that error nodes don't break formatting of surrounding valid code
  it("maintains formatting of valid code around errors", () => {
    const input = "X:1\nabc  ~23  def  |  ghi";
    const expected = "abc ~23 def | g hi";

    const ctx = new ABCContext();
    const formatter = new AbcFormatter(ctx);
    const tokens = Scanner(input, ctx);
    const parseCtx = new ParseCtx(tokens, ctx);
    const ast = parseTune(parseCtx);
    if (!ast) {
      throw new Error("Failed to parse");
    }
    const result = formatter.format(ast);
    assert.equal(removeTuneHeader(result).trim(), expected);
  });
});

describe("Formatter2: Info_line fallback path (no value2)", () => {
  // These tests exercise the fallback path in visitInfoLineExpr when value2 is not populated.
  // This happens when the AST is reconstructed from the CSTree (e.g., in the editor).

  it("preserves spacing around = in key-value pairs when value2 is not populated", () => {
    const ctx = new ABCContext();
    const formatter = new AbcFormatter(ctx);

    // Create an Info_line with tokens but WITHOUT value2 (simulating CSTree reconstruction).
    // The tokens represent "V:1 clef=treble" where there is no space around the = sign.
    const tokens = [
      new Token(TT.INF_HDR, "V:", ctx.generateId()),
      new Token(TT.IDENTIFIER, "1", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.IDENTIFIER, "clef", ctx.generateId()),
      new Token(TT.EQL, "=", ctx.generateId()),
      new Token(TT.IDENTIFIER, "treble", ctx.generateId()),
    ];

    // Create Info_line without value2 (the fourth parameter)
    const infoLine = new Info_line(ctx.generateId(), tokens);

    const result = formatter.visitInfoLineExpr(infoLine);
    assert.equal(result, "V:1 clef=treble");
  });

  it("preserves original spacing when there are spaces around = sign", () => {
    const ctx = new ABCContext();
    const formatter = new AbcFormatter(ctx);

    // Tokens for "V:1 clef = treble" (with spaces around =)
    const tokens = [
      new Token(TT.INF_HDR, "V:", ctx.generateId()),
      new Token(TT.IDENTIFIER, "1", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.IDENTIFIER, "clef", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.EQL, "=", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.IDENTIFIER, "treble", ctx.generateId()),
    ];

    const infoLine = new Info_line(ctx.generateId(), tokens);

    const result = formatter.visitInfoLineExpr(infoLine);
    // We expect the original spacing to be preserved
    assert.equal(result, "V:1 clef = treble");
  });

  it("handles multiple key-value pairs without adding extra spaces", () => {
    const ctx = new ABCContext();
    const formatter = new AbcFormatter(ctx);

    // Tokens for "V:RH clef=treble octave=-2"
    const tokens = [
      new Token(TT.INF_HDR, "V:", ctx.generateId()),
      new Token(TT.IDENTIFIER, "RH", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.IDENTIFIER, "clef", ctx.generateId()),
      new Token(TT.EQL, "=", ctx.generateId()),
      new Token(TT.IDENTIFIER, "treble", ctx.generateId()),
      new Token(TT.WS, " ", ctx.generateId()),
      new Token(TT.IDENTIFIER, "octave", ctx.generateId()),
      new Token(TT.EQL, "=", ctx.generateId()),
      new Token(TT.MINUS, "-", ctx.generateId()),
      new Token(TT.NUMBER, "2", ctx.generateId()),
    ];

    const infoLine = new Info_line(ctx.generateId(), tokens);

    const result = formatter.visitInfoLineExpr(infoLine);
    assert.equal(result, "V:RH clef=treble octave=-2");
  });

  describe("multi-voice system boundary detection", () => {
    let formatter: AbcFormatter;
    let ctx: ABCContext;

    beforeEach(() => {
      ctx = new ABCContext();
      formatter = new AbcFormatter(ctx);
    });

    it("should preserve spacing in multi-voice systems with inline voice markers", () => {
      const input = `X:1
L:1/4
V:1
[DG_B] "G7" =B
V:2
A           B
[V:1] "Fm7" c "BbM7" d |
[V:2]       C        d |`;

      const result = format(input, ctx, formatter);
      expect(result).to.equal(input);
    });

    it("should preserve spacing in multi-voice systems with info line voice markers", () => {
      const input = `%%gchordfont Times 16
X:1
L:1/4
V:1
[DG_B] "G7" =B
V:2
A           B
V:1
"Fm7" c "BbM7" d |
V:2
      c        d |`;

      const result = format(input, ctx, formatter);
      expect(result).to.equal(input);
    });
  });
});
