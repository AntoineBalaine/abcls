import * as abcjs from "abcjs";
import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { Font } from "../types/abcjs-ast";
import { FontSpec } from "../types/directive-specs";
import { fontSpecToFont } from "./helpers";
import { TuneInterpreter } from "./TuneInterpreter";

describe("fontSpecToFont", () => {
  it("returns all-default Font when given empty spec", () => {
    const result = fontSpecToFont({});
    expect(result).to.deep.equal({
      face: "",
      size: 12,
      weight: "normal",
      style: "normal",
      decoration: "none",
    });
  });

  it("uses all fields from a fully specified FontSpec", () => {
    const spec: FontSpec = {
      face: "Helvetica",
      size: 20,
      weight: "bold",
      style: "italic",
      decoration: "underline",
    };
    const result = fontSpecToFont(spec);
    expect(result).to.deep.equal({
      face: "Helvetica",
      size: 20,
      weight: "bold",
      style: "italic",
      decoration: "underline",
    });
  });

  it("fills missing fields from defaults when provided", () => {
    const spec: FontSpec = { size: 24 };
    const defaults: Font = {
      face: "Times",
      size: 14,
      weight: "bold",
      style: "italic",
      decoration: "underline",
    };
    const result = fontSpecToFont(spec, defaults);
    expect(result).to.deep.equal({
      face: "Times",
      size: 24,
      weight: "bold",
      style: "italic",
      decoration: "underline",
    });
  });

  it("prefers spec values over defaults", () => {
    const spec: FontSpec = { face: "Arial", weight: "normal" };
    const defaults: Font = {
      face: "Times",
      size: 14,
      weight: "bold",
      style: "italic",
      decoration: "none",
    };
    const result = fontSpecToFont(spec, defaults);
    expect(result.face).to.equal("Arial");
    expect(result.weight).to.equal("normal");
    expect(result.size).to.equal(14);
    expect(result.style).to.equal("italic");
  });

  it("ignores the box field from FontSpec", () => {
    const spec: FontSpec = { face: "Courier", box: true };
    const result = fontSpecToFont(spec);
    expect(result).to.not.have.property("box");
    expect(result.face).to.equal("Courier");
  });

  it("falls back to hardcoded defaults when no defaults parameter given", () => {
    const spec: FontSpec = { face: "Mono" };
    const result = fontSpecToFont(spec);
    expect(result.face).to.equal("Mono");
    expect(result.size).to.equal(12);
    expect(result.weight).to.equal("normal");
    expect(result.style).to.equal("normal");
    expect(result.decoration).to.equal("none");
  });
});

describe("bar types, compared with abcjs", () => {
  const barlines = ["|", "||", "|:", ":|", "::", "|]", "[|", "[|]"];

  function barTypes(systems: { staff?: { voices: { el_type: string; type?: string }[][] }[] }[]): string[] {
    const types: string[] = [];
    for (const system of systems) {
      for (const element of system.staff?.[0].voices[0] ?? []) {
        if (element.el_type === "bar") types.push(element.type!);
      }
    }
    return types;
  }

  for (const barline of barlines) {
    it(`reads "${barline}" as abcjs does`, () => {
      const abc = `X:1\nL:1/4\nK:C\nC D ${barline} E F |\n`;
      const ctx = new ABCContext(new AbcErrorReporter());
      const ast = parse(Scanner(abc, ctx), ctx);
      const analyzer = new SemanticAnalyzer(ctx);
      ast.accept(analyzer);
      const ours = new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const theirs = (abcjs as any).parseOnly(abc)[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(barTypes(ours.systems as any)).to.deep.equal(barTypes(theirs.lines));
    });
  }
});
