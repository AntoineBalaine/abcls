import { ABCContext, Scanner, parse } from "abcls-parser";
import { SemanticAnalyzer } from "abcls-parser/analyzers/semantic-analyzer";
import { ContextInterpreter } from "abcls-parser/interpreter/ContextInterpreter";
import { KeyAccidental, KeyRoot, KeySignature, Mode } from "abcls-parser/types/abcjs-ast";
import { expect } from "chai";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { TAGS } from "../src/csTree/types";
import { serializeCSTree } from "../src/runner/csTreeSerializer";
import { transpose } from "../src/transforms/transpose";
import { keyTonicName, transposeKeySignature } from "../src/transforms/transposeKey";
import { getNodeLineAndChar } from "../src/transforms/treeUtils";
import { findByTag } from "./helpers";

const key = (root: KeyRoot, acc: KeyAccidental = KeyAccidental.None, mode: Mode = Mode.Major): KeySignature => ({ root, acc, mode, accidentals: [] });

function transposeWithKeys(abc: string, semitones: number, changeChords = false): string {
  const ctx = new ABCContext();
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });
  const root = fromAst(ast, ctx);
  const notes = findByTag(root, TAGS.Note);
  transpose({ root, cursors: [new Set(notes.map((n) => n.id))] }, semitones, ctx, snapshots, true, changeChords);
  return serializeCSTree(root, ctx);
}

describe("transposeKeySignature", () => {
  it("transposes D major down 2 semitones to C major", () => {
    expect(keyTonicName(transposeKeySignature(key(KeyRoot.D), -2)!)).to.equal("C");
  });

  it("chooses the name with fewer accidentals, so C major up 1 semitone is Db and not C#", () => {
    expect(keyTonicName(transposeKeySignature(key(KeyRoot.C), 1)!)).to.equal("Db");
  });

  it("keeps the mode, so A minor up 3 semitones is C minor", () => {
    const result = transposeKeySignature(key(KeyRoot.A, KeyAccidental.None, Mode.Minor), 3)!;
    expect(keyTonicName(result)).to.equal("C");
    expect(result.mode).to.equal(Mode.Minor);
  });

  it("prefers the flat name when going down and the sharp name when going up on a tie", () => {
    // Because F# major and Gb major both have six accidentals, the direction decides.
    expect(keyTonicName(transposeKeySignature(key(KeyRoot.C), -6)!)).to.equal("Gb");
    expect(keyTonicName(transposeKeySignature(key(KeyRoot.C), 6)!)).to.equal("F#");
  });

  it("returns null for a key without a tonic we can transpose", () => {
    expect(transposeKeySignature(key(KeyRoot.HP), 2)).to.equal(null);
  });
});

/**
 * Transposes, with the keys following, only the notes that sit on the lines that start with the given prefix.
 */
function transposeLinesWithKeys(abc: string, semitones: number, linePrefix: string): string {
  const ctx = new ABCContext();
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });
  const root = fromAst(ast, ctx);
  const lines = abc.split("\n");
  const notes = findByTag(root, TAGS.Note).filter((note) => lines[getNodeLineAndChar(note).line].startsWith(linePrefix));
  transpose({ root, cursors: [new Set(notes.map((n) => n.id))] }, semitones, ctx, snapshots, true, false);
  return serializeCSTree(root, ctx);
}

describe("transpose with changeKey: the key of each field", () => {
  it("reads the key of a header K: field from its own tune, not from the tune before it", () => {
    const result = transposeWithKeys("X:1\nL:1/4\nK:D\nD F A d|\n\nX:2\nL:1/4\nK:Bb\nB d f b|\n", -2);
    expect(result).to.contain("K:C\nC E G c|");
    expect(result).to.contain("K:Ab\nA c e a|");
  });

  it("keeps a K: field that also governs notes that are not transposed, and spells the selected notes in that key", () => {
    const result = transposeLinesWithKeys("X:1\nL:1/4\nK:D\nV:1\nV:2\n[V:1] F c d f|\n[V:2] F c D F|\n", -2, "[V:1]");
    expect(result).to.contain("K:D");
    expect(result).to.contain("[V:1] E B =c e|");
    expect(result).to.contain("[V:2] F c D F|");
  });

  it("transposes the explicit accidentals of a K: field", () => {
    expect(transposeWithKeys("X:1\nL:1/4\nK:D exp ^f ^c\nf c d e|\n", 2)).to.contain("K:E exp ^f ^c ^g ^d");
    expect(transposeWithKeys("X:1\nL:1/4\nK:D ^g\nd e f g|\n", 2)).to.contain("K:E ^a");
  });

  it("gives minor keys and modes the tonic with the fewest accidentals, sharp ones included", () => {
    expect(transposeKeySignature(key(KeyRoot.E, KeyAccidental.None, Mode.Minor), 4)).to.deep.include({ root: KeyRoot.G, acc: KeyAccidental.Sharp });
    expect(transposeKeySignature(key(KeyRoot.B, KeyAccidental.None, Mode.Minor), 4)).to.deep.include({ root: KeyRoot.D, acc: KeyAccidental.Sharp });
    expect(transposeKeySignature(key(KeyRoot.F, KeyAccidental.Sharp, Mode.Minor), 2)).to.deep.include({ root: KeyRoot.G, acc: KeyAccidental.Sharp });
  });
});

describe("transpose with changeKey", () => {
  it("rewrites the K: field and spells the notes for the new key, with no stray naturals", () => {
    const result = transposeWithKeys("X:1\nK:D\nF G A c|\n", -2);
    expect(result).to.contain("K:C");
    expect(result).to.contain("E F G B|");
    expect(result).not.to.contain("=");
  });

  it("spells a chromatic note by interval, so a raised fifth stays a sharp (G# down a tone is F#, not Gb)", () => {
    expect(transposeWithKeys("X:1\nK:D\nD ^G E|\n", -2)).to.contain("C ^F D|");
  });

  it("transposes the chord symbols of the tune when asked, spelling them for the new key", () => {
    const result = transposeWithKeys('X:1\nK:F\n"Bb▵" B "F#m" F|\n', -2, true);
    expect(result).to.contain('"Ab▵"');
    expect(result).to.contain('"Em"');
  });

  it("leaves the chord symbols alone when only the keys follow", () => {
    expect(transposeWithKeys('X:1\nK:F\n"Bb▵" B|\n', -2)).to.contain('"Bb▵"');
  });

  it("does not take the key of a K: field from a note that belongs to another voice", () => {
    // Because the K:G line follows the [V:2] line, it sets the key of voice 2 only, and it must become K:F.
    const result = transposeWithKeys("X:1\nV:1\nV:2\nK:D\n[V:1] F|\n[V:2] x|\nK:G\n[V:1] F|\n[V:2] x|\n", -2);
    expect(result).to.contain("K:F");
  });

  it("keeps the mode text that follows the tonic", () => {
    expect(transposeWithKeys("X:1\nK:Ador\nA B c|\n", 2)).to.contain("K:Bdor");
  });

  it("rewrites an inline [K:] field and a key change in the body", () => {
    const result = transposeWithKeys("X:1\nK:D\nF|[K:G] F|\nK:A\nc|\n", -2);
    expect(result).to.contain("K:C");
    expect(result).to.contain("[K:F]");
    expect(result).to.contain("K:G");
  });

  it("leaves the K: field alone when changeKey is not requested", () => {
    const ctx = new ABCContext();
    const ast = parse(Scanner("X:1\nK:D\nF|\n", ctx), ctx);
    const analyzer = new SemanticAnalyzer(ctx);
    ast.accept(analyzer);
    const snapshots = new ContextInterpreter().interpret(ast, analyzer.data, ctx, { snapshotAccidentals: true });
    const root = fromAst(ast, ctx);
    const notes = findByTag(root, TAGS.Note);
    transpose({ root, cursors: [new Set(notes.map((n) => n.id))] }, -2, ctx, snapshots);
    expect(serializeCSTree(root, ctx)).to.contain("K:D");
  });

  it("keeps the key when the transposition is a whole number of octaves", () => {
    expect(transposeWithKeys("X:1\nK:D\nF|\n", -12)).to.contain("K:D");
  });
});
