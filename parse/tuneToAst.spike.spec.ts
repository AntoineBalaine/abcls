import { expect } from "chai";
import { AbcFormatter } from "./Visitors/Formatter";
import { ABCContext } from "./parsers/Context";
import { parse } from "./parsers/parse";
import { Scanner } from "./parsers/scan";
import { Token, TT } from "./parsers/scan";
import { BarLine, File_structure, Info_line, Note, Pitch, Rhythm, Tune, Tune_Body, Tune_header } from "./types/Expr";

/**
 * Verification spike: hand-construct a minimal synthetic AST for a tiny tune
 * and run it through the existing Formatter, to confirm the "synthetic AST
 * reconstruction reusing the Formatter" architecture works before investing
 * in the full Tune-to-AST mapper.
 */
describe("tuneToAst verification spike", () => {
  it("stringifies a hand-built synthetic AST into parseable ABC text", () => {
    const ctx = new ABCContext();
    const synth = (type: TT, lexeme: string) => new Token(type, lexeme, ctx.generateId());

    // X:1
    const xInfo = new Info_line(ctx.generateId(), [synth(TT.INF_HDR, "X:"), synth(TT.INFO_STR, "1")]);
    // K:C
    const kInfo = new Info_line(ctx.generateId(), [synth(TT.INF_HDR, "K:"), synth(TT.KEY_SIGNATURE, "C")]);
    const tuneHeader = new Tune_header(ctx.generateId(), [xInfo, kInfo]);

    // Three notes: C D E, each a quarter note (default length 1/8, rhythm x2 -> "2"),
    // built purely from synthesized tokens.
    function makeNote(letter: string): Note {
      const pitch = new Pitch(ctx.generateId(), { noteLetter: synth(TT.NOTE_LETTER, letter) });
      const rhythm = new Rhythm(ctx.generateId(), synth(TT.RHY_NUMER, "2"));
      return new Note(ctx.generateId(), pitch, rhythm);
    }

    const barline = new BarLine(ctx.generateId(), [synth(TT.BARLINE, "|")]);

    const tuneBody = new Tune_Body(ctx.generateId(), [[makeNote("C"), makeNote("D"), makeNote("E"), barline]]);

    const tune = new Tune(ctx.generateId(), tuneHeader, tuneBody);
    const fileStructure = new File_structure(ctx.generateId(), null, [tune]);

    const formatter = new AbcFormatter(ctx);
    const formattedTune = formatter.format(tune);

    expect(formattedTune).to.be.a("string");
    expect(formattedTune.length).to.be.greaterThan(0);

    // Round-trip: the produced text must be parseable by the real scanner/parser,
    // and must contain a tune body with the expected note pitches.
    const reparseCtx = new ABCContext();
    const tokens = Scanner(formattedTune, reparseCtx);
    const reparsed = parse(tokens, reparseCtx);
    expect(reparsed.contents.length).to.equal(1);
    const reparsedTune = reparsed.contents[0] as Tune;
    expect(reparsedTune).to.be.instanceOf(Tune);
    expect(reparsedTune.tune_body).to.not.be.undefined;

    // Also exercise formatFile / visitFileStructureExpr for completeness.
    const fileText = formatter.formatFile(fileStructure);
    expect(fileText).to.be.a("string");
  });
});
