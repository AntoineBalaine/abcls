import { TT, Tune, Tune_Body, File_structure } from "abcls-parser";
import { expect } from "chai";
import fc from "fast-check";
import { describe, it } from "mocha";
import { toAst } from "../src/csTree/toAst";
import { CSNode, TAGS, createCSNode, isTokenNode, FormattingData } from "../src/csTree/types";
import { toCSTree, findByTag, formatSelection } from "./helpers";

describe("EditorDataMap narrowing", () => {
  it("narrows data to TokenData when tag is checked against TAGS.Token", () => {
    const node: CSNode = createCSNode(TAGS.Token, 0, {
      lexeme: "C",
      tokenType: TT.NOTE_LETTER,
      line: 0,
      position: 0,
    });

    if (node.tag === TAGS.Token) {
      // After the tag check, node.data should be narrowed to TokenData
      expect(node.data.lexeme).to.equal("C");
      expect(node.data.tokenType).to.equal(TT.NOTE_LETTER);
    } else {
      expect.fail("node.tag should be TAGS.Token");
    }
  });

  it("narrows data to TokenData when isTokenNode predicate is used", () => {
    const node: CSNode = createCSNode(TAGS.Token, 0, {
      lexeme: "D",
      tokenType: TT.NOTE_LETTER,
      line: 1,
      position: 5,
    });

    if (isTokenNode(node)) {
      // After the predicate, node.data should be narrowed to TokenData
      expect(node.data.lexeme).to.equal("D");
      expect(node.data.line).to.equal(1);
    } else {
      expect.fail("isTokenNode should return true");
    }
  });

  it("narrows data to TuneBodyData when tag is checked against TAGS.Tune_Body", () => {
    const root = toCSTree("X:1\nV:1\nV:2\nK:C\n[V:1]C D|[V:2]E F|\n");
    const tuneBodyNodes = findByTag(root, TAGS.Tune_Body);
    expect(tuneBodyNodes).to.have.length(1);

    const tuneBody: CSNode = tuneBodyNodes[0];
    if (tuneBody.tag === TAGS.Tune_Body) {
      expect(tuneBody.data.voices).to.deep.equal(["1", "2"]);
    } else {
      expect.fail("node.tag should be TAGS.Tune_Body");
    }
  });

  it("preserves voices through the CSTree roundtrip (fromAst -> toAst)", () => {
    const root = toCSTree("X:1\nV:Soprano\nV:Alto\nK:C\n[V:Soprano]C D|[V:Alto]E F|\n");
    const tuneBodyNodes = findByTag(root, TAGS.Tune_Body);
    const tuneBodyAst = toAst(tuneBodyNodes[0]) as Tune_Body;
    expect(tuneBodyAst.voices).to.deep.equal(["Soprano", "Alto"]);
  });

  it("stores an empty voices array when there are no voice markers", () => {
    const root = toCSTree("X:1\nK:C\nC D E|\n");
    const tuneBodyNodes = findByTag(root, TAGS.Tune_Body);
    const tuneBody: CSNode = tuneBodyNodes[0];
    if (tuneBody.tag === TAGS.Tune_Body) {
      expect(tuneBody.data.voices).to.deep.equal([]);
    } else {
      expect.fail("node.tag should be TAGS.Tune_Body");
    }
  });

  it("narrows data to FormattingData when tag is checked against TAGS.Tune", () => {
    const root = toCSTree("X:1\n%%abcls-parse linear\nK:C\nC D E|\n");
    const tuneNodes = findByTag(root, TAGS.Tune);
    expect(tuneNodes).to.have.length(1);

    const tune: CSNode = tuneNodes[0];
    if (tune.tag === TAGS.Tune) {
      expect(tune.data.linear).to.equal(true);
      expect(tune.data.formatterConfig).to.not.be.undefined;
    } else {
      expect.fail("node.tag should be TAGS.Tune");
    }
  });
});

describe("tune formatting data", () => {
  it("records a linear tune as linear and a deferred tune as deferred", () => {
    const linearRoot = toCSTree("X:1\n%%abcls-parse linear\nK:C\nC D E|\n");
    const deferredRoot = toCSTree("X:1\nK:C\nC D E|\n");

    const linearTune = findByTag(linearRoot, TAGS.Tune)[0];
    const deferredTune = findByTag(deferredRoot, TAGS.Tune)[0];

    expect((linearTune.data as FormattingData).linear).to.equal(true);
    expect((deferredTune.data as FormattingData).linear).to.equal(false);
  });

  it("keeps each tune's own style in a mixed document rather than the last tune's", () => {
    // Because ctx.tuneLinear is reset per tune while parsing, it ends up holding only the
    // last tune's value. Each Tune node must carry its own.
    const root = toCSTree("X:1\nT:deferred\nK:C\nC D E|\n\nX:2\nT:linear\n%%abcls-parse linear\nK:C\nG A B|\n");
    const tunes = findByTag(root, TAGS.Tune);
    expect(tunes).to.have.length(2);

    expect((tunes[0].data as FormattingData).linear).to.equal(false);
    expect((tunes[1].data as FormattingData).linear).to.equal(true);
  });

  it("preserves a tune's linear flag through the CSTree roundtrip (fromAst -> toAst)", () => {
    const root = toCSTree("X:1\n%%abcls-parse linear\nK:C\nC D E|\n");
    const tuneAst = toAst(findByTag(root, TAGS.Tune)[0]) as Tune;
    expect(tuneAst.linear).to.equal(true);
  });

  it("preserves each tune's linear flag through the roundtrip in a mixed document", () => {
    const root = toCSTree("X:1\nT:deferred\nK:C\nC D E|\n\nX:2\nT:linear\n%%abcls-parse linear\nK:C\nG A B|\n");
    const tunes = findByTag(root, TAGS.Tune);

    expect((toAst(tunes[0]) as Tune).linear).to.equal(false);
    expect((toAst(tunes[1]) as Tune).linear).to.equal(true);
  });

  it("preserves a tune's non-default formatter config through the roundtrip", () => {
    const root = toCSTree("X:1\n%%abcls-parse linear\n%%abcls-fmt system-comments\nK:C\nC D E|\n");
    const tuneNode = findByTag(root, TAGS.Tune)[0];
    const configOnNode = (tuneNode.data as FormattingData).formatterConfig;

    // The config must differ from the default, otherwise the roundtrip assertion below
    // would hold even if the config were dropped and rebuilt from defaults
    expect(configOnNode.systemComments).to.equal(true);

    const tuneAst = toAst(tuneNode) as Tune;
    expect(tuneAst.formatterConfig.systemComments).to.equal(true);
    expect(tuneAst.formatterConfig).to.deep.equal(configOnNode);
  });

  it("preserves the file-level linear flag through the roundtrip", () => {
    const root = toCSTree("%%abcls-parse linear\n\nX:1\nK:C\nC D E|\n");
    expect((root.data as FormattingData).linear).to.equal(true);

    const fileAst = toAst(root) as File_structure;
    expect(fileAst.linear).to.equal(true);
  });

  it("re-serializes a linear tune unchanged when nothing is transformed", () => {
    const source = "X:1\n%%abcls-parse linear\nK:C\nC D E|\n";
    const root = toCSTree(source);
    expect(formatSelection({ root, cursors: [] })).to.equal(source);
  });

  describe("property-based", () => {
    it("every tune's linear flag survives the roundtrip for any mix of styles", () => {
      fc.assert(
        fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), (styles) => {
          const source = styles.map((isLinear, i) => `X:${i + 1}\nT:tune${i + 1}\n${isLinear ? "%%abcls-parse linear\n" : ""}K:C\nC D E|\n`).join("\n");
          const root = toCSTree(source);
          const tunes = findByTag(root, TAGS.Tune);
          if (tunes.length !== styles.length) return true;

          for (let i = 0; i < tunes.length; i++) {
            if ((tunes[i].data as FormattingData).linear !== styles[i]) return false;
            if ((toAst(tunes[i]) as Tune).linear !== styles[i]) return false;
          }
          return true;
        }),
        { numRuns: 50 }
      );
    });
  });
});
