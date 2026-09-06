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
});
