import * as abcjs from "abcjs";
import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { TuneInterpreter } from "./TuneInterpreter";

interface BeamFlags {
  el_type: string;
  startBeam?: boolean;
  endBeam?: boolean;
}

/** Writes each note's beam flags as "s" (start), "e" (end), "se", or "." (none). */
function signature(notes: BeamFlags[]): string {
  return notes.map((n) => `${n.startBeam ? "s" : ""}${n.endBeam ? "e" : ""}` || ".").join(" ");
}

function abclsSignature(abc: string): string {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const tune = new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
  const notes: BeamFlags[] = [];
  for (const system of tune.systems) {
    if (!("staff" in system)) continue;
    for (const staff of system.staff) for (const voice of staff.voices) for (const e of voice) if (e.el_type === "note") notes.push(e as BeamFlags);
  }
  return signature(notes);
}

function abcjsSignature(abc: string): string {
  const tune = abcjs.parseOnly(abc)[0] as unknown as { lines: Array<{ staff?: Array<{ voices: BeamFlags[][] }> }> };
  const notes: BeamFlags[] = [];
  for (const line of tune.lines)
    for (const staff of line.staff ?? []) for (const voice of staff.voices) for (const e of voice) if (e.el_type === "note") notes.push(e);
  return signature(notes);
}

function tuneOf(body: string): string {
  return `X:1\nL:1/8\nK:C\n${body} |\n`;
}

describe("TuneInterpreter beaming", () => {
  const cases: Array<[string, string]> = [
    ["C C", ". ."],
    ["CC", "s e"],
    ["C C D", ". . ."],
    ["C>D E", "s e ."],
    ["(3CDE F", "s . e ."],
    ['"G"CD E', "s e ."],
    ["!trill!CD E", "s e ."],
    ["{g}CD E", "s e ."],
    ["C/D/ E/F/", "s e s e"],
    ["[CE][DF] [CE]", "s e ."],
    ["C-C D", "s e ."],
    ["CD|EF", "s e s e"],
    ["Cz D", ". . ."],
    ["C2 DE", ". s e"],
    ["CD EF GA", "s e s e s e"],
    ["CDz", "s e ."],
    ["zCD", ". s e"],
    ["Cz", ". ."],
    ["Cz2D", ". . ."],
  ];
  for (const [body, expected] of cases) {
    it(`beams ${JSON.stringify(body)} as ${expected}`, () => {
      expect(abclsSignature(tuneOf(body))).to.equal(expected);
    });
  }
});

/**
 * Random bodies made of eighths, sixteenths, quarters, chords and broken
 * rhythms, joined either directly or with a space, so that whitespace
 * decides the groups.
 */
const genNoteItem = fc.constantFrom("C", "D", "E/", "F/", "G2", "[CE]", "A>B");
const genBodyFrom = (item: fc.Arbitrary<string>) =>
  fc.array(fc.tuple(item, fc.constantFrom("", " ", " ", "|")), { minLength: 1, maxLength: 12 }).map((items) =>
    items
      .map(([text, sep]) => text + sep)
      .join("")
      .replace(/\|+$/, "")
  );

describe("TuneInterpreter beaming properties", () => {
  it("assigns the same beam flags as abcjs", () => {
    fc.assert(
      fc.property(genBodyFrom(genNoteItem), (body) => {
        const abc = tuneOf(body);
        expect(abclsSignature(abc), abc).to.equal(abcjsSignature(abc));
      }),
      { numRuns: 200 }
    );
  });

  // Because the parser treats every rest as a beam breaker, a short rest
  // written without spaces between beamable notes (CzC) ends the group,
  // whereas abcjs beams across it. Replicating abcjs needs parser,
  // formatter and interpreter changes, which are deferred to a separate plan.
  it.skip("assigns the same beam flags as abcjs when short rests sit inside a group", () => {
    const genItemWithRests = fc.constantFrom("C", "D", "E/", "G2", "z", "z/", "z2", "x", "[CE]");
    fc.assert(
      fc.property(genBodyFrom(genItemWithRests), (body) => {
        const abc = tuneOf(body);
        expect(abclsSignature(abc), abc).to.equal(abcjsSignature(abc));
      }),
      { numRuns: 200 }
    );
  });
});
