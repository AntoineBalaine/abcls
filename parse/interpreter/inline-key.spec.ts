import * as abcjs from "abcjs";
import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner, TT } from "../parsers/scan";
import { KeyInfo, Tune } from "../types/abcjs-ast";
import { Inline_field } from "../types/Expr";
import { AbcFormatter } from "../Visitors/Formatter";
import { TuneInterpreter } from "./TuneInterpreter";

function tuneOf(body: string, header = "K:C"): string {
  return `X:1\nL:1/8\n${header}\n${body}\n`;
}

function interpret(abc: string): { tune: Tune; analyzer: SemanticAnalyzer; errors: number } {
  const reporter = new AbcErrorReporter();
  const ctx = new ABCContext(reporter);
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const tune = new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
  return { tune, analyzer, errors: reporter.getErrors().length };
}

interface RenderedElement {
  el_type: string;
  root?: string;
  acc?: string;
  mode?: string;
  type?: string;
  clefPos?: number;
}

/**
 * Returns the AbcLs clef name of an abcjs clef element. Because abcjs has no
 * tenor type, it represents a tenor clef as an alto clef on line 4
 * (clefPos 8), whereas AbcLs has a dedicated tenor type.
 */
function abcjsClefName(element: RenderedElement): string | undefined {
  if (element.type === "alto" && element.clefPos === 8) return "tenor";
  return element.type;
}

/** Lists the key, clef and note elements of the first voice as "key:Bb", "clef:bass" and "n". */
function elementSummary(elements: RenderedElement[]): string[] {
  const out: string[] = [];
  for (const e of elements) {
    if (e.el_type === "key") out.push(`key:${e.root}${e.acc}`);
    else if (e.el_type === "clef") out.push(`clef:${e.type}`);
    else if (e.el_type === "note") out.push("n");
  }
  return out;
}

function abclsSummary(abc: string): string[] {
  const elements: RenderedElement[] = [];
  for (const system of interpret(abc).tune.systems) {
    if (!("staff" in system)) continue;
    elements.push(...(system.staff[0].voices[0] as unknown as RenderedElement[]));
  }
  return elementSummary(elements);
}

function abcjsSummary(abc: string): string[] {
  const tune = abcjs.parseOnly(abc)[0] as unknown as { lines: Array<{ staff?: Array<{ voices: RenderedElement[][] }> }> };
  const elements: RenderedElement[] = [];
  for (const line of tune.lines) for (const staff of line.staff ?? []) elements.push(...staff.voices[0]);
  return elementSummary(elements.map((e) => (e.el_type === "clef" ? { ...e, type: abcjsClefName(e) } : e)));
}

describe("inline K: fields", () => {
  describe("scanner", () => {
    it("scans the key of an inline K: field as a single KEY_SIGNATURE token", () => {
      const tokens = Scanner(tuneOf("C8 | [K:Bb] B8 |"), new ABCContext());
      const start = tokens.findIndex((t) => t.type === TT.INLN_FLD_LFT_BRKT);
      expect(tokens.slice(start + 1, start + 3).map((t) => [TT[t.type], t.lexeme])).to.deep.equal([
        ["INF_HDR", "K:"],
        ["KEY_SIGNATURE", "Bb"],
      ]);
    });

    it("keeps scanning the modifiers that follow the key", () => {
      const tokens = Scanner(tuneOf("C8 | [K:F#m clef=bass] F8 |"), new ABCContext());
      const lexemes = tokens.filter((t) => t.type !== TT.WS).map((t) => t.lexeme);
      const start = lexemes.indexOf("F#m");
      expect(lexemes.slice(start, start + 5)).to.deep.equal(["F#m", "clef", "=", "bass", "]"]);
    });

    it("does not read a modifier name as a key", () => {
      const tokens = Scanner(tuneOf("C8 | [K:clef=bass] C8 |"), new ABCContext());
      expect(tokens.some((t) => t.type === TT.KEY_SIGNATURE && t.lexeme === "clef")).to.equal(false);
      expect(tokens.filter((t) => t.type === TT.KEY_SIGNATURE).map((t) => t.lexeme)).to.deep.equal(["C"]);
    });
  });

  describe("semantic analyzer", () => {
    function keyInfoOf(body: string): KeyInfo {
      const abc = tuneOf(body);
      const ctx = new ABCContext(new AbcErrorReporter());
      const ast = parse(Scanner(abc, ctx), ctx);
      const analyzer = new SemanticAnalyzer(ctx);
      ast.accept(analyzer);
      const field = (ast.contents[0] as unknown as { tune_body: { sequence: unknown[][] } }).tune_body.sequence
        .flat()
        .find((e) => e instanceof Inline_field) as Inline_field;
      return (analyzer.data.get(field.id) as { data: KeyInfo }).data;
    }

    it("reads the root and accidental of an inline key", () => {
      const info = keyInfoOf("C8 | [K:Bb] B8 |");
      expect([info.keySignature.root, info.keySignature.acc, info.keyOmitted]).to.deep.equal(["B", "b", undefined]);
    });

    it("marks a clef-only field as giving no key", () => {
      const info = keyInfoOf("C8 | [K:clef=bass] C8 |");
      expect(info.keyOmitted).to.equal(true);
      expect(info.clef?.type).to.equal("bass");
    });
  });

  describe("interpreter", () => {
    it("pushes a key element with the accidental of an inline key", () => {
      expect(abclsSummary(tuneOf("C8 | [K:Bb] B8 |"))).to.deep.equal(["n", "key:Bb", "n"]);
    });

    it("keeps the key in effect for a clef-only change, and pushes a clef element", () => {
      expect(abclsSummary(tuneOf("C8 | [K:clef=bass] C8 |", "K:Eb"))).to.deep.equal(["n", "clef:bass", "n"]);
    });

    it("pushes the clef before the key when both change", () => {
      expect(abclsSummary(tuneOf("C8 | [K:F#m clef=bass] F8 |"))).to.deep.equal(["n", "clef:bass", "key:F#", "n"]);
    });

    it("pushes a key element for a K: line in the tune body", () => {
      expect(abclsSummary(tuneOf("C8 |\nK:Bb\nB8 |"))).to.deep.equal(["n", "key:Bb", "n"]);
    });

    it("applies the new key to the voice", () => {
      const { tune } = interpret(tuneOf("C8 | [K:Bb] B8 |"));
      const voice = (tune.systems[0] as unknown as { staff: Array<{ voices: Array<Array<{ el_type: string; root?: string; acc?: string }>> }> }).staff[0]
        .voices[0];
      const key = voice.find((e) => e.el_type === "key");
      expect([key?.root, key?.acc]).to.deep.equal(["B", "b"]);
    });
  });

  describe("formatter", () => {
    for (const body of ["C8 | [K:Bb] B8 |", "C8 | [K:F#m clef=bass] F8 |", "C8 | [K:clef=bass] C8 |", "C8 | [K:none] C8 |"]) {
      it(`writes ${JSON.stringify(body)} back unchanged`, () => {
        const abc = tuneOf(body);
        const ctx = new ABCContext();
        const ast = parse(Scanner(abc, ctx), ctx);
        expect(new AbcFormatter(ctx).formatFile(ast)).to.equal(abc);
      });
    }
  });
});

const genKey = fc.constantFrom("C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Am", "F#m", "Bbm", "Dmix", "Edor", "Glyd");
const genClef = fc.constantFrom("treble", "bass", "alto", "tenor");
const genChange = fc.oneof(
  genKey.map((key) => `[K:${key}]`),
  genClef.map((clef) => `[K:clef=${clef}]`),
  fc.tuple(genKey, genClef).map(([key, clef]) => `[K:${key} clef=${clef}]`)
);

describe("inline K: field properties", () => {
  it("produces the same key and clef elements as abcjs", () => {
    fc.assert(
      fc.property(fc.array(genChange, { minLength: 1, maxLength: 5 }), (changes) => {
        const abc = tuneOf(changes.map((change) => `C8 | ${change} `).join("") + "C8 |");
        expect(abclsSummary(abc), abc).to.deep.equal(abcjsSummary(abc));
        expect(interpret(abc).errors, abc).to.equal(0);
      }),
      { numRuns: 100 }
    );
  });
});
