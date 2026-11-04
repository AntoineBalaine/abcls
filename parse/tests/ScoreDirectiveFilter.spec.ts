import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner, Token, TT } from "../parsers/scan";
import { Directive } from "../types/Expr";
import { filterScoreDirective } from "../Visitors/ScoreDirectiveFilter";

/** Gives the values of the %%score directive of a tune whose header holds the given line. */
function valuesOf(line: string): unknown[] {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(`X:1\n${line}\nK:C\nC|\n`, ctx), ctx);
  const tune = ast.contents[0] as { tune_header: { info_lines: unknown[] } };
  const directive = tune.tune_header.info_lines.find((item) => item instanceof Directive) as Directive;
  return directive.values;
}

const lexemes = (tokens: Token[]): string => tokens.map((t) => t.lexeme).join(" ");

function filterLine(line: string, hidden: string[]) {
  return filterScoreDirective(valuesOf(line), (id) => hidden.includes(id));
}

describe("filterScoreDirective", () => {
  describe("Example-based tests", () => {
    it("takes the hidden voices out of the groups, and the groups that hold no voice any more", () => {
      const result = filterLine("%%score ( 1 2 ) | ( 5 6 ) | ( 5b 6b )", ["1", "2", "6", "5b", "6b"]);
      expect(lexemes(result!.kept)).to.equal("( 5 )");
      expect(result!.allRemoved).to.equal(false);
    });

    it("cleans the separators that are left first, last, or doubled", () => {
      const first = filterLine("%%score { ( 1 2 ) | ( 3 4 ) | ( 5 6 ) }", ["1", "2"]);
      expect(lexemes(first!.kept)).to.equal("{ ( 3 4 ) | ( 5 6 ) }");
      const middle = filterLine("%%score { ( 1 2 ) | ( 3 4 ) | ( 5 6 ) }", ["3", "4"]);
      expect(lexemes(middle!.kept)).to.equal("{ ( 1 2 ) | ( 5 6 ) }");
      const last = filterLine("%%score { ( 1 2 ) | ( 3 4 ) | ( 5 6 ) }", ["5", "6"]);
      expect(lexemes(last!.kept)).to.equal("{ ( 1 2 ) | ( 3 4 ) }");
    });

    it("keeps the parentheses of a group that still holds a voice", () => {
      expect(lexemes(filterLine("%%score ( 1 2 )", ["2"])!.kept)).to.equal("( 1 )");
    });

    it("takes the hidden voices out of a list of plain voices", () => {
      expect(lexemes(filterLine("%%score 1 2 3", ["2"])!.kept)).to.equal("1 3");
    });

    it("takes a group of staves out when all its voices are hidden, and keeps the others", () => {
      expect(lexemes(filterLine("%%score [ ( 1 2 ) 3 ] 4", ["1", "2"])!.kept)).to.equal("[ 3 ] 4");
      expect(lexemes(filterLine("%%score [ ( 1 2 ) 3 ] 4", ["1", "2", "3"])!.kept)).to.equal("4");
    });

    it("says that everything is removed when no voice stays", () => {
      const result = filterLine("%%score { ( 1 2 ) | 3 }", ["1", "2", "3"]);
      expect(result!.allRemoved).to.equal(true);
      expect(result!.kept).to.deep.equal([]);
    });

    it("changes nothing when no voice is hidden", () => {
      const values = valuesOf("%%score { ( 1 2 ) | 3 }");
      const result = filterScoreDirective(values, () => false);
      expect(result!.removed).to.deep.equal([]);
      expect(result!.kept).to.deep.equal(values);
    });

    it("returns null for values that are not a score layout, so that the directive stays as it is", () => {
      expect(filterScoreDirective([new Token(TT.IDENTIFIER, "x", 1), new Token(TT.EQL, "=", 2)], () => true)).to.equal(null);
      expect(filterLine("%%score ( 1 2", ["1"])).to.equal(null);
    });

    it("returns each token in the list that it belongs to, in the order of the directive", () => {
      const values = valuesOf("%%score ( 1 2 ) | 3") as Token[];
      const result = filterScoreDirective(values, (id) => id === "1")!;
      expect([...result.kept, ...result.removed].sort((a, b) => values.indexOf(a) - values.indexOf(b))).to.deep.equal(values);
    });
  });

  describe("Property-based tests", () => {
    const voice = fc.constantFrom("1", "2", "3", "4", "5", "6", "5b", "6b", "C");
    const staff = fc.oneof(
      voice,
      fc.array(voice, { minLength: 1, maxLength: 3 }).map((voices) => `( ${voices.join(" ")} )`)
    );
    const staves = fc
      .tuple(fc.array(staff, { minLength: 1, maxLength: 4 }), fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }))
      .map(([items, pipes]) => items.map((item, i) => (i < items.length - 1 ? `${item} ${pipes[i] ? "|" : ""}` : item)).join(" "));
    const layout = fc
      .tuple(staves, fc.constantFrom("", "{", "["), fc.subarray(["1", "2", "3", "4", "5", "6", "5b", "6b", "C"]))
      .map(([body, wrap, hidden]) => ({
        line: wrap === "" ? `%%score ${body}` : `%%score ${wrap} ${body} ${wrap === "{" ? "}" : "]"}`,
        hidden,
      }));

    const voicesOf = (tokens: Token[]): string[] => tokens.filter((t) => t.type === TT.NUMBER || t.type === TT.IDENTIFIER).map((t) => t.lexeme);

    it("property: the voices that stay are the voices that were not hidden, in the same order", () => {
      fc.assert(
        fc.property(layout, ({ line, hidden }) => {
          const values = valuesOf(line) as Token[];
          const result = filterScoreDirective(values, (id) => hidden.includes(id))!;
          return JSON.stringify(voicesOf(result.kept)) === JSON.stringify(voicesOf(values).filter((id) => !hidden.includes(id)));
        })
      );
    });

    it("property: no group is empty, and no separator is first, last, or next to another one", () => {
      fc.assert(
        fc.property(layout, ({ line, hidden }) => {
          const values = valuesOf(line) as Token[];
          const kept = filterScoreDirective(values, (id) => hidden.includes(id))!.kept;
          for (let i = 0; i < kept.length; i++) {
            const type = kept[i].type;
            const next = kept[i + 1]?.type;
            if ((type === TT.LPAREN || type === TT.LBRACE || type === TT.LBRACKET) && (next === TT.RPAREN || next === TT.RBRACE || next === TT.RBRACKET))
              return false;
            if (type === TT.PIPE && (next === TT.PIPE || next === undefined || i === 0)) return false;
            if (type === TT.PIPE && (next === TT.RPAREN || next === TT.RBRACE || next === TT.RBRACKET)) return false;
            if ((type === TT.LBRACE || type === TT.LBRACKET || type === TT.LPAREN) && next === TT.PIPE) return false;
          }
          return true;
        })
      );
    });

    it("property: the tokens that stay are balanced", () => {
      fc.assert(
        fc.property(layout, ({ line, hidden }) => {
          const kept = filterScoreDirective(valuesOf(line), (id) => hidden.includes(id))!.kept;
          const count = (type: TT): number => kept.filter((t) => t.type === type).length;
          return count(TT.LPAREN) === count(TT.RPAREN) && count(TT.LBRACE) === count(TT.RBRACE) && count(TT.LBRACKET) === count(TT.RBRACKET);
        })
      );
    });

    it("property: filtering what stays with the same hidden voices changes nothing", () => {
      fc.assert(
        fc.property(layout, ({ line, hidden }) => {
          const first = filterScoreDirective(valuesOf(line), (id) => hidden.includes(id))!;
          const again = filterScoreDirective(first.kept, (id) => hidden.includes(id))!;
          return again.removed.length === 0 && again.kept.length === first.kept.length;
        })
      );
    });
  });
});
