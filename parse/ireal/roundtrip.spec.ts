import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { parseAbcx } from "../parsers/parse_abcx";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { ChordSymbol, Tune } from "../types/Expr";
import { exportAbcxToIrealLink } from "./exportToIreal";
import { importIrealLinkToAbcx } from "./importFromIreal";
import { parsePlaylistLink } from "./fields";

function chordSequence(abcxSource: string): string[] {
  const ctx = new ABCContext();
  const tokens = ScannerAbcx(abcxSource, ctx);
  const fileStructure = parseAbcx(tokens, ctx);
  expect(ctx.errorReporter.hasErrors(), `parse errors: ${ctx.errorReporter.getErrors().map((e) => e.message).join(", ")}`).to.equal(false);
  const tune = fileStructure.contents.find((c): c is Tune => c instanceof Tune);
  expect(tune, "expected a Tune in the parsed ABCx").to.not.be.undefined;
  const chords: string[] = [];
  for (const system of tune!.tune_body!.sequence) {
    for (const item of system) {
      if (item instanceof ChordSymbol) chords.push(item.token.lexeme);
    }
  }
  return chords;
}

describe("ABCx <-> iReal Pro round trip", () => {
  it("preserves the chord sequence through export then import (Autumn Leaves changes)", () => {
    const abcx = `X:1
T:Autumn Leaves
C:Kosma
K:Cm
Cm7 F7 | Bbmaj7 Ebmaj7 | Am7b5 D7 | Gm7 Gm7 |
`;
    const originalChords = chordSequence(abcx);
    const link = exportAbcxToIrealLink(abcx);
    const reimportedAbcx = importIrealLinkToAbcx(link);
    const reimportedChords = chordSequence(reimportedAbcx);
    expect(reimportedChords).to.deep.equal(originalChords);
  });

  it("preserves title, composer, and key through the round trip", () => {
    const abcx = `X:1
T:My Tune
C:A. Composer
K:F
C7 F7 |
`;
    const link = exportAbcxToIrealLink(abcx);
    const reimportedAbcx = importIrealLinkToAbcx(link);
    expect(reimportedAbcx).to.include("T:My Tune");
    expect(reimportedAbcx).to.include("C:A. Composer");
    expect(reimportedAbcx).to.include("K:F");
  });

  it("extracts only the trailing bpm digits from a \"note-length=bpm\" Q: line, not every digit in the field", () => {
    const abcx = `X:1\nT:Test\nQ:1/4=140\nK:C\nC7 |\n`;
    const link = exportAbcxToIrealLink(abcx);
    const parsed = parsePlaylistLink(link);
    expect(parsed.songs[0].bpm).to.equal("140");
  });

  it("throws a clear error when there are no tunes to export", () => {
    expect(() => exportAbcxToIrealLink("")).to.throw(/No tunes found/);
  });

  it("throws a clear error when there are no songs to import", () => {
    expect(() => importIrealLinkToAbcx("irealb://")).to.throw(/No songs found/);
  });

  it("embeds the exact source link as a comment immediately after X:, and it survives a real reparse with no errors", () => {
    const abcx = `X:1\nT:Test\nK:C\nC7 |\n`;
    const link = exportAbcxToIrealLink(abcx);
    const reimportedAbcx = importIrealLinkToAbcx(link);
    const lines = reimportedAbcx.split("\n");
    expect(lines[0]).to.equal("X:1");
    expect(lines[1]).to.equal(`% iReal Pro source: ${link}`);

    const ctx = new ABCContext();
    const tokens = ScannerAbcx(reimportedAbcx, ctx);
    parseAbcx(tokens, ctx);
    expect(ctx.errorReporter.hasErrors(), `parse errors: ${ctx.errorReporter.getErrors().map((e) => e.message).join(", ")}`).to.equal(false);
  });

  it("embeds the same whole-playlist source link on every tune in a multi-song playlist, not just the first", () => {
    const songA = `X:1\nT:Song A\nK:C\nC7 |\n`;
    const songB = `X:2\nT:Song B\nK:F\nF7 |\n`;
    const link = exportAbcxToIrealLink(`${songA}\n${songB}`);
    const reimportedAbcx = importIrealLinkToAbcx(link);
    const sourceCommentLines = reimportedAbcx.split("\n").filter((l) => l.startsWith("% iReal Pro source: "));
    expect(sourceCommentLines).to.have.length(2);
    expect(sourceCommentLines[0]).to.equal(`% iReal Pro source: ${link}`);
    expect(sourceCommentLines[1]).to.equal(`% iReal Pro source: ${link}`);
  });

  it("scans an altered-dominant ABCx chord symbol ('Calt7') as a single chord, not fragments", () => {
    // Regression guard for parsers/scan_abcx_tunebody.ts's pChordSymbol:
    // it has its own, separate quality-word list from chordShorthand.ts's
    // iReal-text patterns, and "alt" was missing from it even after the
    // iReal-side parsing was fixed, silently fragmenting every
    // altered-dominant chord's ABCx text into garbage annotations.
    const abcx = `X:1\nT:Test\nK:C\nCalt7 Gsus4 |\n`;
    expect(chordSequence(abcx)).to.deep.equal(["Calt7", "Gsus4"]);
  });

  it("scans a minor-major-7 ABCx chord symbol ('C-^7') as a single chord, not fragments", () => {
    const abcx = `X:1\nT:Test\nK:C\nC-^7 Dm7 |\n`;
    expect(chordSequence(abcx)).to.deep.equal(["C-^7", "Dm7"]);
  });
});
