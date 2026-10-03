import { expect } from "chai";
import { buildPlaylistLink, IrealSongFields } from "./fields";
import { importIrealLinkToAbcx } from "./importFromIreal";
import { scramble } from "./scramble";
import { withChordDataMarker } from "./fields";

function linkWithKey(key: string): string {
  const fields: IrealSongFields = {
    title: "Test",
    composer: "Composer",
    style: "Medium Swing",
    key,
    transpose: "0",
    rawChordData: withChordDataMarker(scramble("C |")),
  };
  return buildPlaylistLink({ songs: [fields] });
}

function linkWithChordData(chordData: string): string {
  const fields: IrealSongFields = {
    title: "Test",
    composer: "Composer",
    style: "Medium Swing",
    key: "C",
    transpose: "0",
    rawChordData: withChordDataMarker(scramble(chordData)),
  };
  return buildPlaylistLink({ songs: [fields] });
}

describe("importIrealLinkToAbcx key field translation", () => {
  it('translates iReal Pro\'s own "-" minor-key suffix to ABC\'s "m" suffix', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("A-"));
    expect(abcx).to.include("K:Am");
    expect(abcx).to.not.include("K:A-");
  });

  it('translates a flat minor key ("Bb-") the same way', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("Bb-"));
    expect(abcx).to.include("K:Bbm");
  });

  it('leaves an already-ABC-style minor key ("Cm") unchanged', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("Cm"));
    expect(abcx).to.include("K:Cm");
  });

  it("leaves a major key unchanged", () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("C"));
    expect(abcx).to.include("K:C");
  });

  it('defaults to "K:C" when the key field is empty', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey(""));
    expect(abcx).to.include("K:C");
  });
});

describe("importIrealLinkToAbcx with a repeat-bar cell mixed into a multi-cell bar", () => {
  it("does not throw, and still imports the chart's other chords", () => {
    // "C x G" is one bar containing three cells: a chord, a repeat-bar
    // marker, and another chord — not the whole-bar-repeat shape
    // gridTokensToAbcxBody's resolution pass handles, found in a real
    // user library backup.
    expect(() => importIrealLinkToAbcx(linkWithChordData("C x G | D-7 |"))).to.not.throw();
    const abcx = importIrealLinkToAbcx(linkWithChordData("C x G | D-7 |"));
    expect(abcx).to.include("C");
    expect(abcx).to.include("Dm7");
  });
});

describe("importIrealLinkToAbcx with a chain of separate-bar repeat cells", () => {
  it('resolves "repeat 3 times" (three separate one-cell "x" bars) to three real repeat pairs', () => {
    // "Eb-7 | x | x | x | Ab-7 |" ("-7" is iReal Pro's own minor-seventh
    // shorthand, not ABC's "m7"): each repeat is its own bar-delimited
    // "x" cell — confirmed against a real chart's raw grid text (see
    // commit message) to be how iReal Pro actually encodes a multi-bar
    // repeat, rather than bundling multiple repeat cells into one bar
    // slot with no separators, which was an unverified assumption this
    // test previously made.
    const abcx = importIrealLinkToAbcx(linkWithChordData("Eb-7 | x | x | x | Ab-7 |"));
    const repeatPairs = abcx.match(/\|: Ebm7 :\|/g) ?? [];
    expect(repeatPairs).to.have.length(3);
    expect(abcx).to.not.include("|:  :|");
  });
});
