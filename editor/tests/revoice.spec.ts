import { ABCContext, Scanner, parse } from "abcls-parser";
import { SemanticAnalyzer } from "abcls-parser/analyzers/semantic-analyzer";
import { ContextInterpreter, DocumentSnapshots } from "abcls-parser/interpreter/ContextInterpreter";
import { expect } from "chai";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { CSNode, TAGS } from "../src/csTree/types";
import { Selection } from "../src/selection";
import { DropVoicing, dropVoicing } from "../src/transforms/revoice";
import { formatSelection, findByTag } from "./helpers";

function toCSTreeWithSnapshots(source: string): { root: CSNode; ctx: ABCContext; snapshots: DocumentSnapshots } {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);

  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);

  const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });

  return { root: fromAst(ast, ctx), ctx, snapshots };
}

/** Applies a drop voicing to every chord in the source. */
function drop(source: string, voicing: DropVoicing): string {
  const { root, ctx, snapshots } = toCSTreeWithSnapshots(source);
  const chords = findByTag(root, TAGS.Chord);
  const sel: Selection = { root, cursors: [new Set(chords.map((c) => c.id))] };
  dropVoicing(sel, voicing, ctx, snapshots);
  return formatSelection(sel);
}

describe("dropVoicing", () => {
  describe("drop2", () => {
    it("lowers the second-highest note by an octave", () => {
      // [CEGB]: B is the top voice, G the second -- G4 becomes G3, written "G,".
      expect(drop("X:1\nK:C\n[CEGB]|\n", "drop2")).to.equal("X:1\nK:C\n[CEG,B]|\n");
    });

    it("works on a triad", () => {
      // [CEG]: G on top, E second -- E4 becomes E3, written "E,".
      expect(drop("X:1\nK:C\n[CEG]|\n", "drop2")).to.equal("X:1\nK:C\n[CE,G]|\n");
    });

    it("preserves an explicit accidental on the dropped note", () => {
      expect(drop("X:1\nK:C\n[C_EG]|\n", "drop2")).to.equal("X:1\nK:C\n[C_E,G]|\n");
    });

    it("ranks voices by sounding pitch, not by the order they are written in", () => {
      // Written high-to-low. The second-highest sounding note is still G.
      expect(drop("X:1\nK:C\n[BGEC]|\n", "drop2")).to.equal("X:1\nK:C\n[BG,EC]|\n");
    });

    it("leaves a two-note chord's lower voice alone only when it is the second voice", () => {
      // A dyad has a second voice, so drop2 applies to it.
      expect(drop("X:1\nK:C\n[CE]|\n", "drop2")).to.equal("X:1\nK:C\n[C,E]|\n");
    });

    it("leaves a single note untouched", () => {
      // A lone note is not a chord, so nothing is selected.
      expect(drop("X:1\nK:C\nC|\n", "drop2")).to.equal("X:1\nK:C\nC|\n");
    });
  });

  describe("drop24", () => {
    it("lowers the second and fourth-highest notes by an octave", () => {
      // [CEGB]: B top, G second, E third, C fourth -- G and C drop.
      expect(drop("X:1\nK:C\n[CEGB]|\n", "drop24")).to.equal("X:1\nK:C\n[C,EG,B]|\n");
    });

    it("leaves a chord with fewer than four notes untouched", () => {
      // A triad has no fourth voice to drop, so the voicing does not apply.
      expect(drop("X:1\nK:C\n[CEG]|\n", "drop24")).to.equal("X:1\nK:C\n[CEG]|\n");
    });
  });

  describe("drop3", () => {
    it("lowers the third-highest note by an octave", () => {
      // [CEGB]: B top, G second, E third -- E drops.
      expect(drop("X:1\nK:C\n[CEGB]|\n", "drop3")).to.equal("X:1\nK:C\n[CE,GB]|\n");
    });

    it("leaves a chord with fewer than three notes untouched", () => {
      expect(drop("X:1\nK:C\n[CE]|\n", "drop3")).to.equal("X:1\nK:C\n[CE]|\n");
    });
  });

  describe("multiple chords", () => {
    it("applies the voicing to every selected chord", () => {
      expect(drop("X:1\nK:C\n[CEG] [DFA]|\n", "drop2")).to.equal("X:1\nK:C\n[CE,G] [DF,A]|\n");
    });
  });

  describe("rhythm and ties", () => {
    it("leaves the chord's rhythm untouched", () => {
      expect(drop("X:1\nK:C\n[CEG]4|\n", "drop2")).to.equal("X:1\nK:C\n[CE,G]4|\n");
    });
  });
});
