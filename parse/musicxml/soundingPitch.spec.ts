import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { getKeyAccidentalFor } from "../music-theory/harmonization";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { KeyAccidental, KeyRoot, KeySignature, Mode, Tune } from "../types/abcjs-ast";
import { NoteIR } from "./ir";
import { keySignatureToFifths } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { normalizeTune } from "./testSupport/unwrap";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

function interpretAbc(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

function pitchedNotes(abc: string): NoteIR[] {
  const ir = normalizeTune(interpretAbc(abc));
  return ir.parts[0].measures.flatMap((measure) => measure.content).filter((note) => note.kind === "note" && note.pitch !== undefined);
}

function alters(abc: string): number[] {
  return pitchedNotes(abc).map((note) => note.pitch!.alter ?? 0);
}

describe("MusicXML export: the attributes of the first measure", () => {
  it("writes the key, the meter and the clef that the header gives", () => {
    const ir = normalizeTune(interpretAbc("X:1\nM:3/4\nL:1/4\nK:G clef=bass\nG, A, B, |\n"));
    const attributes = ir.parts[0].measures[0].attributes!;
    expect(attributes.keyFifths).to.equal(1);
    expect(attributes.keyMode).to.equal("major");
    expect(attributes.timeBeats).to.equal("3");
    expect(attributes.timeBeatType).to.equal("4");
    expect(attributes.clefSign).to.equal("F");
    expect(attributes.clefLine).to.equal(4);
  });

  it("writes the signature of the mode, not the one of its tonic's major key", () => {
    const key = (root: KeyRoot, acc: KeyAccidental, mode: Mode): KeySignature => ({ root, acc, mode, accidentals: [] });
    expect(keySignatureToFifths(key(KeyRoot.D, KeyAccidental.None, Mode.Dorian))).to.equal(0);
    expect(keySignatureToFifths(key(KeyRoot.G, KeyAccidental.None, Mode.Mixolydian))).to.equal(0);
    expect(keySignatureToFifths(key(KeyRoot.E, KeyAccidental.None, Mode.Phrygian))).to.equal(0);
    expect(keySignatureToFifths(key(KeyRoot.A, KeyAccidental.None, Mode.Minor))).to.equal(0);
    expect(keySignatureToFifths(key(KeyRoot.F, KeyAccidental.Sharp, Mode.Minor))).to.equal(3);
    expect(keySignatureToFifths(key(KeyRoot.B, KeyAccidental.Flat, Mode.Major))).to.equal(-2);
  });
});

describe("MusicXML export: the alteration that a note sounds with", () => {
  it("takes the alteration of the key signature when the note has no accidental", () => {
    expect(alters("X:1\nL:1/4\nK:G\nF G A B |\n")).to.deep.equal([1, 0, 0, 0]);
    expect(alters("X:1\nL:1/4\nK:Bb\nB E F c |\n")).to.deep.equal([-1, -1, 0, 0]);
  });

  it("keeps an accidental in force until the end of its bar, on its own pitch only", () => {
    expect(alters("X:1\nL:1/4\nK:C\n^F F f F | F4 |\n")).to.deep.equal([1, 1, 0, 1, 0]);
    expect(alters("X:1\nL:1/4\nK:G\n=F F ^F F |\n")).to.deep.equal([0, 0, 1, 1]);
  });

  it("carries the alteration through a tie across the bar line", () => {
    expect(alters("X:1\nL:1/4\nK:C\nC2 D ^F- | F2 F2 |\n")).to.deep.equal([0, 0, 1, 1, 0]);
  });

  it("writes the accidental that is shown on the note", () => {
    const notes = pitchedNotes("X:1\nL:1/4\nK:G\n=F ^F _B B |\n");
    expect(notes.map((note) => note.accidental)).to.deep.equal(["natural", "sharp", "flat", undefined]);
  });

  it("matches the ABC reading of a bar for any key and any notes", () => {
    const keys: Array<[string, KeySignature]> = [
      ["C", { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] }],
      ["G", { root: KeyRoot.G, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] }],
      ["Eb", { root: KeyRoot.E, acc: KeyAccidental.Flat, mode: Mode.Major, accidentals: [] }],
      ["Bm", { root: KeyRoot.B, acc: KeyAccidental.None, mode: Mode.Minor, accidentals: [] }],
      ["DDor", { root: KeyRoot.D, acc: KeyAccidental.None, mode: Mode.Dorian, accidentals: [] }],
    ];
    const noteArb = fc.record({
      letter: fc.constantFrom("C", "D", "E", "F", "G", "A", "B", "c", "d", "e", "f"),
      accidental: fc.constantFrom("", "", "^", "_", "="),
    });
    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.array(noteArb, { minLength: 1, maxLength: 8 }), ([keyText, key], notes) => {
        const abc = `X:1\nL:1/8\nK:${keyText}\n${notes.map((n) => n.accidental + n.letter).join(" ")} |\n`;
        // The reference: the last accidental written on the same pitch in the bar, or else the key signature.
        const written = new Map<string, number>();
        const expected = notes.map((n) => {
          if (n.accidental !== "") written.set(n.letter, n.accidental === "^" ? 1 : n.accidental === "_" ? -1 : 0);
          return written.get(n.letter) ?? getKeyAccidentalFor(n.letter.toUpperCase(), key);
        });
        expect(alters(abc)).to.deep.equal(expected);
      }),
      { numRuns: 80 }
    );
  });
});

describe("MusicXML export: tuplets", () => {
  it("scales the duration of the tuplet notes and writes their time modification", () => {
    const ir = normalizeTune(interpretAbc("X:1\nM:2/4\nL:1/8\nK:C\n(3ABc d2 |\n"));
    const notes = ir.parts[0].measures[0].content;
    const durations = notes.map((note) => note.duration);
    // Because a quarter note is `divisions` long, two eighths fill a quarter and the triplet fills the same quarter.
    const quarter = ir.parts[0].measures[0].attributes!.divisions!;
    expect(durations[0]! + durations[1]! + durations[2]!).to.equal(quarter);
    expect(durations[3]).to.equal(quarter);
    expect(notes[0].timeModification).to.deep.equal({ actualNotes: 3, normalNotes: 2 });
    expect(notes[3].timeModification).to.equal(undefined);
    expect(notes[0].notations?.tupletStart).to.equal(true);
    expect(notes[2].notations?.tupletStop).to.equal(true);
  });

  it("fills every bar with exactly the length of its meter", () => {
    fc.assert(
      fc.property(fc.constantFrom("(3ABc d2", "(3A2B2c2 d2 z2", "A>B (3cde", "(5ABcde f2 z2 z2"), (bar) => {
        const meter = bar.includes("z2") ? "4/4" : "2/4";
        const ir = normalizeTune(interpretAbc(`X:1\nM:${meter}\nL:1/8\nK:C\n${bar} |\n`));
        const measure = ir.parts[0].measures[0];
        const quarter = measure.attributes!.divisions!;
        const total = measure.content.reduce((sum, note) => sum + (note.grace || note.chord ? 0 : (note.duration ?? 0)), 0);
        expect(total).to.equal(quarter * (meter === "4/4" ? 4 : 2));
      })
    );
  });
});

describe("MusicXML export: schema", () => {
  it("writes accidentals, time modifications and tuplets in the order the schema requires", () => {
    const xml = serializeScorePartwise(normalizeTune(interpretAbc("X:1\nM:2/4\nL:1/8\nK:D\n(3^AB=c d2 |\n")));
    const result = validateAgainstMusicXmlSchema(xml);
    expect(result.errors).to.deep.equal([]);
    expect(result.valid).to.equal(true);
  });
});

describe("MusicXML export: line continuation", () => {
  it("does not start a new system after a line that ends with a backslash", () => {
    const ir = normalizeTune(interpretAbc("X:1\nM:4/4\nL:1/4\nK:C\nA B c d |\\\ne f g a |\nc4 |\n"));
    expect(ir.parts[0].measures.map((measure) => measure.newSystem === true)).to.deep.equal([false, false, true]);
  });
});
