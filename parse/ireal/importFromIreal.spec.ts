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
