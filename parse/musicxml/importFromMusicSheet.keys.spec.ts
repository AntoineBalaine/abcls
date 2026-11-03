import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { KeyAccidental, KeyRoot, StaffSystem, Tune } from "../types/abcjs-ast";
import { noteOnLineOfFifths } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./parseMusicXml";
import { serializeScorePartwise } from "./serialize";
import { importTune, normalizeTune } from "./testSupport/unwrap";

function interpretAbc(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

function firstStaffKey(tune: Tune): { root: string; acc: string; mode: string } {
  const key = (tune.systems[0] as StaffSystem).staff[0].key;
  return { root: key.root, acc: key.acc, mode: key.mode };
}

describe("importFromMusicSheet: key signatures", () => {
  describe("noteOnLineOfFifths", () => {
    const expected: [number, KeyRoot, KeyAccidental][] = [
      [0, KeyRoot.C, KeyAccidental.None],
      [1, KeyRoot.G, KeyAccidental.None],
      [-1, KeyRoot.F, KeyAccidental.None],
      [5, KeyRoot.B, KeyAccidental.None],
      [6, KeyRoot.F, KeyAccidental.Sharp],
      [12, KeyRoot.B, KeyAccidental.Sharp],
      [-2, KeyRoot.B, KeyAccidental.Flat],
      [-8, KeyRoot.F, KeyAccidental.Flat],
    ];
    for (const [position, root, acc] of expected) {
      it(`gives ${root}${acc} at position ${position}`, () => {
        expect(noteOnLineOfFifths(position)).to.deep.equal({ root, acc });
      });
    }

    it("gives null for a note that needs a double accidental", () => {
      expect(noteOnLineOfFifths(13)).to.equal(null);
      expect(noteOnLineOfFifths(-9)).to.equal(null);
    });
  });

  describe("keeps the key through ABC -> MusicXML -> Tune", () => {
    const keys = ["C", "Am", "DDor", "EPhr", "FLyd", "GMix", "BLoc", "F#Dor", "BbMix", "EbLyd", "C#Loc", "BbPhr", "F#m", "Cb"];
    for (const key of keys) {
      it(`K:${key}`, () => {
        const original = interpretAbc(`X:1\nL:1/4\nM:4/4\nK:${key}\nC D E F|\n`);
        const imported = importTune(parseMusicXmlToSheet(serializeScorePartwise(normalizeTune(original))));
        expect(firstStaffKey(imported)).to.deep.equal(firstStaffKey(original));
      });
    }
  });
});
