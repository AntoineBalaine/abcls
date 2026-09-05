import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { Tune } from "../types/abcjs-ast";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new TuneInterpreter(analyzer, ctx, abc);
  return interpreter.interpretFile(ast).tunes[0];
}

function exportToMusicXml(abc: string): string {
  const tune = interpretABC(abc);
  return serializeScorePartwise(normalizeForMusicXML(tune));
}

const fixtures: Array<{ name: string; abc: string }> = [
  {
    name: "simple lead sheet melody",
    abc: 'X:1\nT:Test Tune\nM:4/4\nL:1/8\nK:C\n"C"CDEF GABc | c2 c2 c4 |',
  },
  {
    name: "ties and slurs",
    abc: "X:1\nM:4/4\nL:1/4\nK:C\nC-C (DE) F2 |",
  },
  {
    name: "chords",
    abc: "X:1\nM:4/4\nL:1/4\nK:C\n[CEG]2 [DFA]2 |",
  },
  {
    name: "grace notes and decorations",
    abc: "X:1\nM:4/4\nL:1/4\nK:C\n{cd}e2 .F!trill!G |",
  },
  {
    name: "two voices sharing a staff",
    abc: "X:1\nM:4/4\nL:1/4\nV:1\nV:2 merge=true\nK:C\nV:1\nC D E F |\nV:2\nC, D, E, F, |",
  },
  {
    name: "flats and sharps",
    abc: "X:1\nM:4/4\nL:1/4\nK:F\n^F _B =c d |",
  },
  {
    name: "key and meter change mid-tune",
    abc: "X:1\nM:4/4\nL:1/4\nK:C\nC D E F | K:G M:3/4\nG A B |",
  },
];

describe("Tune to MusicXML round trip against the MusicXML 4.0 XSD", () => {
  for (const fixture of fixtures) {
    it(`produces XSD-valid output for: ${fixture.name}`, () => {
      const xml = exportToMusicXml(fixture.abc);
      const result = validateAgainstMusicXmlSchema(xml);
      expect(result.valid, `${fixture.name} failed validation:\n${result.errors.join("\n")}\n\n${xml}`).to.equal(true);
    });
  }

  it("preserves note count between the ABC source and the exported measure content", () => {
    const abc = "X:1\nM:4/4\nL:1/4\nK:C\nC D E F |";
    const xml = exportToMusicXml(abc);
    const noteOpenTags = xml.match(/<note>/g) ?? [];
    expect(noteOpenTags.length).to.equal(4);
  });
});
