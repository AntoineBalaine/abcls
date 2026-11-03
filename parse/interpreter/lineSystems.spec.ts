import * as abcjs from "abcjs";
import { expect } from "chai";
import { convertFileToDeferred } from "../abcl/AbclToAbcConverter";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { Tune } from "../types/abcjs-ast";
import { AbcFormatter } from "../Visitors/Formatter";
import { TuneInterpreter } from "./TuneInterpreter";

/**
 * These specs check that the interpreter groups the lines of music into systems the way abcjs does:
 * the nth line of each voice goes into the nth system. A linear tune is compared against abcjs reading
 * the deferred text that the converter writes for it, because abcjs only reads deferred ABC.
 */

function interpret(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

function toDeferredText(abc: string): string {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  return new AbcFormatter(ctx).stringify(convertFileToDeferred(ast, ctx));
}

/**
 * Describes the systems as text: the number of notes and rests of each voice, with "+" between the voices of a staff,
 * " / " between the staves of a system, and " || " between the systems.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeSystems(systems: any[]): string {
  return systems
    .filter((system) => system.staff)
    .map((system) =>
      system.staff
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((staff: any) => staff.voices.map((voice: any[]) => voice.filter((element) => element.el_type === "note").length).join("+"))
        .join(" / ")
    )
    .join(" || ");
}

function abcjsSystems(abc: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return describeSystems((abcjs as any).parseOnly(abc)[0].lines);
}

const deferredCases: Record<string, string> = {
  "one voice on two lines": "X:1\nL:1/4\nK:C\nCDEF|GABc|\ncBAG|FEDC|\n",
  "one voice, a line that does not end with a barline": "X:1\nL:1/4\nK:C\nCDEF|GA\nBc|\n",
  "one voice, a K: line between two lines": "X:1\nL:1/4\nK:C\nCDEF|\nK:G\nGABc|\n",
  "one voice, lines joined by a backslash": "X:1\nL:1/4\nK:C\nCDEF|\\\nGABc|\n",
  "two voices that alternate line by line": "X:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nCDEF|\nV:2\nC,D,E,F,|\nV:1\nGABc|\nV:2\nG,A,B,C|\n",
  "two voices with inline markers": "X:1\nL:1/4\nV:1\nV:2\nK:C\n[V:1]CDEF|\n[V:2]C,D,E,F,|\n[V:1]GABc|\n[V:2]G,A,B,C|\n",
  "two voices written one block at a time": "X:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nCDEF|\nGABc|\nV:2\nC,D,E,F,|\nG,A,B,C|\n",
  "two voices with lines joined by a backslash": "X:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nCDEF|\\\nGABc|\nV:2\nC,D,E,F,|\\\nG,A,B,C|\n",
};

const linearCases: Record<string, string> = {
  "two voices in each system": "%%abcls-parse linear\nX:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nCDEF|GABc|\nV:2\nE,F,G,A,|B,CDE|\n%\nV:1\ncBAG|FEDC|\nV:2\nEDCB,|A,G,F,E,|\n",
  "a voice that continues on a new line without a marker": "%%abcls-parse linear\nX:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nCDEF|\nGABc|\nV:2\nC,D,E,F,|\n",
  "one voice on two lines": "%%abcls-parse linear\nX:1\nL:1/4\nK:C\nCDEF|GABc|\ncBAG|FEDC|\n",
};

describe("Interpreter: lines of music and systems", () => {
  describe("deferred tunes give the systems of abcjs", () => {
    for (const [name, abc] of Object.entries(deferredCases)) {
      it(name, () => {
        expect(describeSystems(interpret(abc).systems)).to.equal(abcjsSystems(abc));
      });
    }
  });

  describe("linear tunes give the systems of abcjs reading their deferred conversion", () => {
    for (const [name, abc] of Object.entries(linearCases)) {
      it(name, () => {
        expect(describeSystems(interpret(abc).systems)).to.equal(abcjsSystems(toDeferredText(abc)));
      });
    }
  });

  it("puts the line of a linear voice that a new system starts with into that system, after a rest in the first one", () => {
    const tune = interpret(linearCases["a voice that continues on a new line without a marker"]);
    expect(describeSystems(tune.systems)).to.equal("4 / 1 || 4 / 4");
  });
});
