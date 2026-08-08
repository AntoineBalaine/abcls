import { assert } from "chai";
import { ABCContext } from "../parsers/Context";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { File_structure } from "../types/Expr";
import { AbcFormatter } from "../Visitors/Formatter";

function parseFile(input: string, ctx: ABCContext): File_structure {
  const tokens = Scanner(input, ctx);
  return parse(tokens, ctx);
}

describe("AbcFormatter.formatFile()", () => {
  let formatter: AbcFormatter;
  let ctx: ABCContext;

  beforeEach(() => {
    ctx = new ABCContext();
    formatter = new AbcFormatter(ctx);
  });

  describe("basic functionality", () => {
    it("formats a simple file with a header and one tune", () => {
      const input = `%% Sample file
X:1
T:Simple Tune
K:C
CDEF|GABC|`;

      const expected = `%%Sample file
X:1
T:Simple Tune
K:C
CDEF | GABC |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("preserves whitespace around barlines", () => {
      const input = `X:1
K:C
CDEF|GABC|`;

      const expected = `X:1
K:C
CDEF | GABC |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("formats a file with multiple tunes", () => {
      const input = `X:1
T:First Tune
K:C
CDEF|GABC|

X:2
T:Second Tune
K:G
DEFG|ABCD|`;

      const expected = `X:1
T:First Tune
K:C
CDEF | GABC |

X:2
T:Second Tune
K:G
DEFG | ABCD |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("formats a file with free text", () => {
      const input = `This is some free text

X:1
T:Tune with Text
K:C
CDEF|GABC|

More free text here`;

      const expected = `This is some free text

X:1
T:Tune with Text
K:C
CDEF | GABC |

More free text here`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("formats a complex file with all elements", () => {
      const input = `%% File header
This is free text in the header

X:1
T:First Tune
K:C
CDEF|GABC|

Some text between tunes

X:2
T:Second Tune with Comments
K:G
% Comment in tune
DEFG|ABCD|`;

      const expected = `%%File header
This is free text in the header

X:1
T:First Tune
K:C
CDEF | GABC |

Some text between tunes

X:2
T:Second Tune with Comments
K:G
% Comment in tune
DEFG | ABCD |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });
  });

  describe("edge cases", () => {
    it("handles a file with only a header", () => {
      const input = "%%pagewidth \nThis is free text in the header";

      const expected = "%%pagewidth\nThis is free text in the header";

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("handles a file with only free text", () => {
      const input = `This is some free text`;

      const expected = `This is some free text`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("handles a file with only tunes", () => {
      const input = `X:1
T:First Tune
K:C
CDEF|GABC|

X:2
T:Second Tune
K:G
DEFG|ABCD|`;

      const expected = `X:1
T:First Tune
K:C
CDEF | GABC |

X:2
T:Second Tune
K:G
DEFG | ABCD |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("handles a file with empty tunes", () => {
      const input = `X:1
T:Empty Tune
K:C

X:2
T:Another Empty Tune
K:G`;

      const expected = `X:1
T:Empty Tune
K:C

X:2
T:Another Empty Tune
K:G`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });
  });

  describe("formatting features", () => {
    it("formats tunes with complex musical elements", () => {
      const input = `X:1
T:Complex Tune
K:C
(3ABC DEF|"Chord"[CEG]2|{fg}a2|!trill!B2|`;

      const expected = `X:1
T:Complex Tune
K:C
(3ABC DEF | "Chord" [CEG]2 | {fg}a2 | !trill! B2 |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("precedes a standalone y-spacer with a space, even when glued to a barline in the input", () => {
      const input = `X:1
K:C
A |y`;

      const expected = `X:1
K:C
A | y`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("leaves a y-spacer glued inside a beam alone (beam joining is unaffected)", () => {
      const input = `X:1
K:C
Ay2B|`;

      const expected = `X:1
K:C
Ay2B |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("preserves comments in tunes", () => {
      const input = `X:1
T:Tune with Comments
K:C
CDEF|%comment
GABC|`;

      const expected = `X:1
T:Tune with Comments
K:C
CDEF | %comment
GABC |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("formats tunes with inline fields", () => {
      const input = `X:1
T:Tune with Inline Fields
K:C
[K:G]DEFG|[M:3/4]ABC|`;

      const expected = `X:1
T:Tune with Inline Fields
K:C
[K:G] DEFG | [M:3/4] ABC |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });

    it("formats tunes with voice markers", () => {
      const input = `X:1
T:Tune with Voices
V:1 clef=treble
V:2 clef=bass
V:1
CDEF|GABC|
V:2
C,D,E,F,|G,A,B,C,|`;

      const expected = `X:1
T:Tune with Voices
V:1 clef=treble
V:2 clef=bass
V:1
CDEF     | GABC     |
V:2
C,D,E,F, | G,A,B,C, |`;

      const ast = parseFile(input, ctx);
      const result = formatter.formatFile(ast);
      assert.equal(result, expected);
    });
  });
});
