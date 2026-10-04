import { assert } from "chai";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { scanGrid } from "./gridScanner";
import { GridToken, GridTT, tokensToGridText } from "./gridTokens";

/**
 * Example-based tests for the iReal Pro grid scanner.
 *
 * Fixtures are written in iReal Pro's own chord dialect, not ABC's: minor
 * seventh is `D-7`, major seventh is `C^7`, half-diminished is `Ch7`. A
 * fixture in ABC's dialect would make correct code look broken.
 *
 * Fixtures are also raw grid text, as `unscramble` produces it. They are
 * deliberately not round-tripped through `scramble`, which performs its
 * own substitutions on `| x`, ` |` and three-space runs and so would not
 * return the text written here.
 */
describe("iReal Pro grid scanner", () => {
  let ctx: ABCContext;

  beforeEach(() => {
    ctx = new ABCContext(new AbcErrorReporter());
  });

  function scan(source: string): GridToken[] {
    return scanGrid(source, ctx);
  }

  function types(source: string): GridTT[] {
    return scan(source).map((t) => t.type);
  }

  /** Asserts the token types and, with them, that no character was lost. */
  function expectTypes(source: string, expected: GridTT[]): void {
    const tokens = scan(source);
    assert.deepStrictEqual(
      tokens.map((t) => t.type),
      expected,
      `scanning ${JSON.stringify(source)} gave ${JSON.stringify(tokens.map((t) => [t.type, t.lexeme]))}`
    );
    assert.strictEqual(tokensToGridText(tokens), source, "token lexemes must reproduce the source");
  }

  describe("chord cells", () => {
    const cases: Array<[string, string]> = [
      ["a bare triad", "C"],
      ["a dominant seventh", "C7"],
      ["a minor seventh", "C-7"],
      ["a major seventh", "C^7"],
      ["a half-diminished seventh", "Ch7"],
      ["a diminished seventh", "Co7"],
      ["an augmented triad", "C+"],
      ["a flat root", "Bb7"],
      ["a sharp root", "F#-7"],
      ["an altered extension", "Bb7#11"],
      ["two alterations", "G7b9#11"],
      ["an added degree", "Cadd9"],
    ];
    for (const [name, text] of cases) {
      it(`scans ${name} as one chord token`, () => {
        expectTypes(text, [GridTT.CHORD]);
        assert.strictEqual(scan(text)[0].lexeme, text);
      });
    }

    it("keeps the minor-major symbol in one token rather than splitting it", () => {
      // "-^" has to be matched ahead of "-" and "^" alone, or the chord
      // loses its quality and a stray "^" is left behind.
      expectTypes("C-^7", [GridTT.CHORD]);
      assert.strictEqual(scan("C-^7")[0].lexeme, "C-^7");
    });

    it("keeps a suspended chord's extension and its sus together", () => {
      // The chord rule has to run before the cue-size rule, or the "s" of
      // "sus" is taken for the "s" decoration marker.
      expectTypes("G7sus", [GridTT.CHORD]);
      assert.strictEqual(scan("G7sus")[0].lexeme, "G7sus");
      expectTypes("A9sus", [GridTT.CHORD]);
    });

    it("scans a bare sus, which means sus4, as one chord token", () => {
      expectTypes("Csus", [GridTT.CHORD]);
    });

    it("keeps an altered dominant's alt together", () => {
      // The chord rule has to run before the layout rule, or the "l" of
      // "alt" is taken for the "l" layout hint.
      expectTypes("C7alt", [GridTT.CHORD]);
      assert.strictEqual(scan("C7alt")[0].lexeme, "C7alt");
    });

    it("scans a slash bass as part of the chord", () => {
      expectTypes("C-7/F", [GridTT.CHORD]);
      assert.strictEqual(scan("C-7/F")[0].lexeme, "C-7/F");
      expectTypes("Bb-7/Ab", [GridTT.CHORD]);
    });

    it("does not swallow a slash that no root follows", () => {
      // Because the slash belongs to whatever comes next rather than to
      // this chord, it is left for the following rules and ends up
      // reported rather than silently attached.
      const tokens = scan("C-7/|");
      assert.strictEqual(tokens[0].lexeme, "C-7");
      assert.strictEqual(tokens[1].type, GridTT.UNKNOWN);
      assert.strictEqual(tokens[2].type, GridTT.BAR);
      assert.strictEqual(tokensToGridText(tokens), "C-7/|");
    });

    it("separates two chords glued together with no space", () => {
      expectTypes("C7F7", [GridTT.CHORD, GridTT.CHORD]);
      assert.deepStrictEqual(
        scan("C7F7").map((t) => t.lexeme),
        ["C7", "F7"]
      );
    });
  });

  describe("cells and separators", () => {
    it("scans a bar separator", () => {
      expectTypes("|", [GridTT.BAR]);
    });

    it("scans n as no chord", () => {
      expectTypes("n", [GridTT.NO_CHORD]);
    });

    it("scans x as the repeat-one-bar shorthand", () => {
      expectTypes("| x", [GridTT.BAR, GridTT.WHITESPACE, GridTT.REPEAT_ONE_BAR]);
    });

    it("scans r as the repeat-two-bars shorthand", () => {
      expectTypes("| r |", [GridTT.BAR, GridTT.WHITESPACE, GridTT.REPEAT_TWO_BARS, GridTT.WHITESPACE, GridTT.BAR]);
    });

    it("scans p as the same-chord shorthand, including the doubled form", () => {
      expectTypes("pp", [GridTT.SAME_CHORD, GridTT.SAME_CHORD]);
    });

    it("scans a comma pad as its own token", () => {
      expectTypes("C7,F7,", [GridTT.CHORD, GridTT.PAD, GridTT.CHORD, GridTT.PAD]);
    });

    it("scans a whole bar of chords", () => {
      expectTypes("|C-7 G7|", [GridTT.BAR, GridTT.CHORD, GridTT.WHITESPACE, GridTT.CHORD, GridTT.BAR]);
    });
  });

  describe("structure", () => {
    it("scans a repeat section's braces", () => {
      expectTypes("{C7}", [GridTT.REPEAT_OPEN, GridTT.CHORD, GridTT.REPEAT_CLOSE]);
    });

    it("tolerates a repeat opening that is never closed", () => {
      // Across the sample library 788 opening braces face only 755
      // closing ones, so an unclosed repeat is ordinary data rather than
      // a one-off; the scanner must not assume the two pair up.
      expectTypes("{C7 |D-7 Z", [
        GridTT.REPEAT_OPEN,
        GridTT.CHORD,
        GridTT.WHITESPACE,
        GridTT.BAR,
        GridTT.CHORD,
        GridTT.WHITESPACE,
        GridTT.END,
      ]);
      assert.isFalse(ctx.errorReporter.hasErrors());
    });

    it("scans numbered ending markers", () => {
      expectTypes("N1", [GridTT.ENDING]);
      expectTypes("N2", [GridTT.ENDING]);
      expectTypes("N3", [GridTT.ENDING]);
      assert.strictEqual(scan("N2C^7")[0].lexeme, "N2");
    });

    it("scans section brackets", () => {
      expectTypes("[C7]", [GridTT.SECTION_OPEN, GridTT.CHORD, GridTT.SECTION_CLOSE]);
    });

    it("scans every section label letter the sample library uses", () => {
      for (const letter of ["A", "B", "C", "D", "i", "v"]) {
        expectTypes(`*${letter}`, [GridTT.SECTION_LABEL]);
        assert.strictEqual(scan(`*${letter}`)[0].lexeme, `*${letter}`);
      }
    });

    it("scans a time signature", () => {
      expectTypes("T44", [GridTT.TIME_SIGNATURE]);
      expectTypes("T34", [GridTT.TIME_SIGNATURE]);
      assert.strictEqual(scan("T68C^7")[0].lexeme, "T68");
    });

    it("scans a time signature that does not start the chart", () => {
      expectTypes("|C7 |T34 D-7", [
        GridTT.BAR,
        GridTT.CHORD,
        GridTT.WHITESPACE,
        GridTT.BAR,
        GridTT.TIME_SIGNATURE,
        GridTT.WHITESPACE,
        GridTT.CHORD,
      ]);
    });

    it("scans the segno, coda and part markers", () => {
      expectTypes("S", [GridTT.SEGNO]);
      expectTypes("Q", [GridTT.CODA]);
      expectTypes("U", [GridTT.PART_MARKER]);
    });

    it("scans the end-of-chart marker", () => {
      expectTypes("C7 Z", [GridTT.CHORD, GridTT.WHITESPACE, GridTT.END]);
    });
  });

  describe("annotations and decoration", () => {
    it("consumes a text annotation whole, delimiters included", () => {
      expectTypes("<Solos>", [GridTT.ANNOTATION]);
      assert.strictEqual(scan("<Solos>")[0].lexeme, "<Solos>");
    });

    it("keeps an annotation's size code inside the annotation", () => {
      // The size code is "*" followed by two digits, which the section
      // label rule would otherwise claim; consuming the annotation as one
      // token is what keeps the label rule away from it.
      expectTypes("<*64Open Feel>", [GridTT.ANNOTATION]);
      assert.strictEqual(scan("<*64Open Feel>")[0].lexeme, "<*64Open Feel>");
    });

    it("does not scan an annotation's text as grid content", () => {
      // "Even 8's" holds an apostrophe and an "s"; "Arturo LLedó" holds
      // non-ASCII and an "l"; "rit....." holds dots and an "r". None of
      // them may surface as grid tokens.
      for (const text of ["<Even 8's>", "<Arturo LLedó>", "<rit.....>", "<D.C. al Coda>", "<Optional Bb pedal in A sections>"]) {
        expectTypes(text, [GridTT.ANNOTATION]);
      }
    });

    it("reports an unterminated annotation and still covers its text", () => {
      const tokens = scan("<Fine");
      assert.deepStrictEqual(
        tokens.map((t) => t.type),
        [GridTT.ANNOTATION]
      );
      assert.strictEqual(tokensToGridText(tokens), "<Fine");
      assert.isTrue(ctx.errorReporter.hasErrors());
    });

    it("stops an unterminated annotation at the next bar separator", () => {
      // Because an unterminated annotation would otherwise absorb every
      // remaining bar of the chart into one token and put the whole tail
      // of the chart out of the parser's reach, a bar separator bounds it:
      // a stray "<" costs at most the bar it sits in. No annotation in the
      // sample library contains a bar separator, so the bound never cuts a
      // real annotation short.
      expectTypes("<Fine |C7 Z", [GridTT.ANNOTATION, GridTT.BAR, GridTT.CHORD, GridTT.WHITESPACE, GridTT.END]);
      assert.strictEqual(scan("<Fine |C7 Z")[0].lexeme, "<Fine ");
      assert.isTrue(ctx.errorReporter.hasErrors());
    });

    it("does not let an unterminated annotation reach a later annotation's closing delimiter", () => {
      const tokens = scan("<Fine |C7 <Solos>");
      assert.deepStrictEqual(
        tokens.map((t) => t.lexeme),
        ["<Fine ", "|", "C7", " ", "<Solos>"]
      );
      assert.strictEqual(tokensToGridText(tokens), "<Fine |C7 <Solos>");
    });

    it("consumes an alternative chord whole, delimiters included", () => {
      expectTypes("D-(D7)", [GridTT.CHORD, GridTT.ALTERNATIVE_CHORD]);
      assert.strictEqual(scan("D-(D7)")[1].lexeme, "(D7)");
    });

    it("reports an unterminated alternative chord and still covers its text", () => {
      const tokens = scan("(D7");
      assert.deepStrictEqual(
        tokens.map((t) => t.type),
        [GridTT.ALTERNATIVE_CHORD]
      );
      assert.strictEqual(tokensToGridText(tokens), "(D7");
      assert.isTrue(ctx.errorReporter.hasErrors());
    });

    it("stops an unterminated alternative chord at the next bar separator", () => {
      expectTypes("(D7 |G7 Z", [GridTT.ALTERNATIVE_CHORD, GridTT.BAR, GridTT.CHORD, GridTT.WHITESPACE, GridTT.END]);
      assert.strictEqual(scan("(D7 |G7 Z")[0].lexeme, "(D7 ");
    });

    it("keeps a stray opening delimiter that a bar separator follows at one character", () => {
      expectTypes("<|C7", [GridTT.ANNOTATION, GridTT.BAR, GridTT.CHORD]);
      assert.strictEqual(scan("<|C7")[0].lexeme, "<");
    });

    it("scans the fermata, cue-size, layout and spacer markers", () => {
      expectTypes("f", [GridTT.FERMATA]);
      expectTypes("s", [GridTT.SMALL]);
      expectTypes("l", [GridTT.LAYOUT]);
      expectTypes("Y", [GridTT.SPACER]);
    });

    it("scans a decoration marker glued to the chord it decorates", () => {
      expectTypes("sC7", [GridTT.SMALL, GridTT.CHORD]);
      expectTypes("lF-7", [GridTT.LAYOUT, GridTT.CHORD]);
      expectTypes("fA-", [GridTT.FERMATA, GridTT.CHORD]);
    });
  });

  describe("regressions for the defects the scanner exists to prevent", () => {
    it("does not fuse an unmatched repeat opening onto the chord that follows", () => {
      // Defect: "{C-7" used to be handed to the chord parser as one cell,
      // rejected, and dropped, losing the chord entirely.
      expectTypes("{C-7", [GridTT.REPEAT_OPEN, GridTT.CHORD]);
      assert.strictEqual(scan("{C-7")[1].lexeme, "C-7");
    });

    it("does not let a vertical spacer leak into chord text", () => {
      // Defect: "Y" used to survive the cleanup passes and end up inside
      // the chord cell next to it.
      expectTypes("Y C-7", [GridTT.SPACER, GridTT.WHITESPACE, GridTT.CHORD]);
      expectTypes("YC-7", [GridTT.SPACER, GridTT.CHORD]);
    });

    it("keeps a barline out of bar content", () => {
      // Defect: barlines written into bar content strings were doubled by
      // the step that joins bars with separators, giving ":| |" and
      // friends. A barline being its own token leaves no text for a later
      // pass to re-read.
      const tokens = scan("|C-7|G7|");
      assert.deepStrictEqual(
        tokens.filter((t) => t.type === GridTT.BAR).map((t) => t.position),
        [0, 4, 7]
      );
      assert.isTrue(tokens.filter((t) => t.type === GridTT.CHORD).every((t) => !t.lexeme.includes("|")));
    });

    it("keeps an empty bar visible as two separators rather than as content", () => {
      // Defect: an emitted bar with no content printed a stray barline and
      // shifted the rest of the layout. The scanner reports the structure
      // faithfully and leaves dropping the empty bar to the parser.
      expectTypes("| |", [GridTT.BAR, GridTT.WHITESPACE, GridTT.BAR]);
    });

    it("scans a section label glued to a repeat opening, a time signature and a chord", () => {
      // Defect: a section label immediately before a repeat section was
      // given a bar of its own. "{*AT44C^7" is the real glued form, and
      // all four constructs have to come out separately.
      expectTypes("{*AT44C^7", [GridTT.REPEAT_OPEN, GridTT.SECTION_LABEL, GridTT.TIME_SIGNATURE, GridTT.CHORD]);
      assert.deepStrictEqual(
        scan("{*AT44C^7").map((t) => t.lexeme),
        ["{", "*A", "T44", "C^7"]
      );
    });

    it("keeps a section label whose letter the old cleanup passes deleted", () => {
      // Defect: a label built on "f", "l", "s", "Y", "U", "S" or "Q"
      // decayed to an empty sentinel, because those letters were deleted
      // by whole-string passes, and was dropped silently.
      for (const letter of ["f", "l", "s", "Y", "U", "S", "Q"]) {
        expectTypes(`*${letter}C^7`, [GridTT.SECTION_LABEL, GridTT.CHORD]);
        assert.strictEqual(scan(`*${letter}C^7`)[0].lexeme, `*${letter}`);
      }
    });
  });

  describe("unrecognized input", () => {
    it("keeps an unrecognized character as a token and reports it", () => {
      const tokens = scan("C7 ~ G7");
      const unknown = tokens.filter((t) => t.type === GridTT.UNKNOWN);
      assert.strictEqual(unknown.length, 1);
      assert.strictEqual(unknown[0].lexeme, "~");
      assert.strictEqual(unknown[0].position, 3);
      assert.strictEqual(tokensToGridText(tokens), "C7 ~ G7");
      assert.strictEqual(ctx.errorReporter.getErrors().length, 1);
    });

    it("reports no error for a chart made only of recognized constructs", () => {
      types("[*AT44C^7 |D-7 G7 |x |N1 Eb^7 ]{*BF-7 <Solos> |x }Z");
      assert.isFalse(ctx.errorReporter.hasErrors());
    });
  });

  describe("positions", () => {
    it("gives every token the offset of its first character", () => {
      const tokens = scan("{*AT44C^7 |x");
      assert.deepStrictEqual(
        tokens.map((t) => t.position),
        [0, 1, 3, 6, 9, 10, 11]
      );
    });
  });
});
