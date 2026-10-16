import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { tuneToAbcText } from "../tuneToAst";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

function interpretAbc(abc: string) {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

function abcToAbc(abc: string): string {
  return tuneToAbcText(interpretAbc(abc), new ABCContext());
}

function body(abc: string): string {
  return bodyLines(abc).join("\n");
}

function bodyLines(abc: string): string[] {
  return abc.split("\n").filter((line) => line.trim().length > 0 && !/^([A-Za-z]:|%%)/.test(line));
}

describe("MusicXML line breaks on export", () => {
  it("emits <print new-system> on the first measure of every ABC line after the first", () => {
    const tune = interpretAbc("X:1\nL:1/4\nM:4/4\nK:C\nC D E F|G A B c|\nc B A G|F E D C|\n");
    const xml = serializeScorePartwise(normalizeForMusicXML(tune));
    expect(xml.match(/<print new-system="yes"\/>/g)!.length).to.equal(1);
    expect(xml).to.match(/<measure number="3">\s*<print new-system="yes"\/>/);
  });

  it("emits no <print> element for a single-line tune", () => {
    const tune = interpretAbc("X:1\nL:1/4\nM:4/4\nK:C\nC D E F|G A B c|\n");
    expect(serializeScorePartwise(normalizeForMusicXML(tune))).not.to.contain("<print");
  });

  it("keeps the line structure through ABC -> XML -> ABC", () => {
    const tune = interpretAbc("X:1\nL:1/4\nM:4/4\nK:C\nC D E F|G A B c|\nc B A G|F E D C|\nC C C C|D D D D|\n");
    const xml = serializeScorePartwise(normalizeForMusicXML(tune));
    const abc = tuneToAbcText(importFromMusicSheet(parseMusicXmlToSheet(xml)), new ABCContext(), {
      lineBreaks: { mode: "source", fallbackBarsPerLine: 4 },
    });
    expect(bodyLines(abc).length).to.equal(3);
  });
});

describe("empty measures written as X", () => {
  it("writes an invisible rest that fills a whole 4/4 measure as X", () => {
    const abc = abcToAbc("X:1\nM:4/4\nL:1/8\nK:C\nx8|C8|\n");
    expect(body(abc)).to.match(/\bX\b/);
    expect(abc).not.to.contain("x8");
  });

  it("keeps x4 when the invisible rest fills only half of a 4/4 measure", () => {
    const abc = abcToAbc("X:1\nM:4/4\nL:1/8\nK:C\nx4 C4|C8|\n");
    expect(abc).to.contain("x4");
    expect(body(abc)).not.to.match(/\bX\b/);
  });

  it("measures a whole measure against the meter, so x6 becomes X in 6/8", () => {
    const abc = abcToAbc("X:1\nM:6/8\nL:1/8\nK:C\nx6|C6|\n");
    expect(body(abc)).to.match(/\bX\b/);
  });

  it("keeps x6 in 4/4, where six eighths do not fill a measure", () => {
    const abc = abcToAbc("X:1\nM:4/4\nL:1/8\nK:C\nx6 C2|C8|\n");
    expect(abc).to.contain("x6");
  });
});
