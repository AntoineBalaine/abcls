import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { Meter, MeterType } from "../types/abcjs-ast";
import { Info_line, Tune } from "../types/Expr";
import { SemanticAnalyzer } from "./semantic-analyzer";

function meterOf(text: string): Meter | undefined {
  const ctx = new ABCContext();
  const ast = parse(Scanner(`X:1\nM:${text}\nK:C\nc|\n`, ctx), ctx);
  const tune = ast.contents[0] as Tune;
  const info = tune.tune_header.info_lines.find((line) => line instanceof Info_line && line.key.lexeme === "M:") as Info_line;
  const result = new SemanticAnalyzer(ctx).visitInfoLineExpr(info);
  return result && result.type === "meter" ? result.data : undefined;
}

describe("Meter with groups", () => {
  it("reads (3+2)/8 as the meter 5/8 with the groups 3/8 and 2/8", () => {
    const meter = meterOf("(3+2)/8");
    expect(meter?.type).to.equal(MeterType.Specified);
    expect(meter?.value).to.deep.equal([{ numerator: 5, denominator: 8 }]);
    expect(meter?.beat_division).to.deep.equal([
      { numerator: 3, denominator: 8 },
      { numerator: 2, denominator: 8 },
    ]);
  });

  it("reads (2+3+2)/8 with three groups", () => {
    expect(meterOf("(2+3+2)/8")?.beat_division).to.have.length(3);
  });

  it("reads 5/8 (3/8+2/8) as the meter 5/8 with the groups 3/8 and 2/8", () => {
    const meter = meterOf("5/8 (3/8+2/8)");
    expect(meter?.value).to.deep.equal([{ numerator: 5, denominator: 8 }]);
    expect(meter?.beat_division).to.deep.equal([
      { numerator: 3, denominator: 8 },
      { numerator: 2, denominator: 8 },
    ]);
  });

  it("tells 6/8 (3/8+3/8) from 6/8 (2/8+2/8+2/8) by their groups", () => {
    expect(meterOf("6/8 (3/8+3/8)")?.beat_division).to.have.length(2);
    expect(meterOf("6/8 (2/8+2/8+2/8)")?.beat_division).to.have.length(3);
  });

  it("keeps a meter without groups as it was, with no groups", () => {
    const meter = meterOf("6/8");
    expect(meter?.value).to.deep.equal([{ numerator: 6, denominator: 8 }]);
    expect(meter?.beat_division).to.equal(undefined);
  });

  it("ignores groups that do not add up to the meter", () => {
    expect(meterOf("5/8 (3/8+3/8)")?.beat_division).to.equal(undefined);
  });

  it("property: the value is the sum of the groups, for any (a+b+...)/d", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 2, maxLength: 5 }), fc.constantFrom(4, 8, 16), (numerators, denominator) => {
        const meter = meterOf(`(${numerators.join("+")})/${denominator}`);
        const total = numerators.reduce((sum, n) => sum + n, 0);
        return (
          meter?.value?.[0].numerator === total &&
          meter.value[0].denominator === denominator &&
          meter.beat_division?.length === numerators.length &&
          meter.beat_division.every((group, index) => group.numerator === numerators[index] && group.denominator === denominator)
        );
      })
    );
  });
});
