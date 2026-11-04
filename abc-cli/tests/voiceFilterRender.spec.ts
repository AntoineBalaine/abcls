import { ABCContext, AbcErrorReporter, filterVoicesInAbcWithDeletions } from "abcls-parser";
import { expect } from "chai";
import { renderAbcToSvg } from "../svg-renderer";

/**
 * Because abcjs fails with "Cannot read properties of undefined (reading 'meter')" when the first staff of the %%score
 * directive has no voice that has music, a filtered score that still named the hidden voices could not be drawn, and the
 * preview kept showing its previous drawing. These specs draw the filtered text, which is what the preview does.
 */
function filteredScore(directive: string, scoreLine: string): string {
  const source = [
    directive,
    "X:1",
    scoreLine,
    "V:1",
    "V:2",
    "V:5",
    "V:6",
    "V:5b clef=bass",
    "V:6b clef=bass",
    "M:3/4",
    "L:1/8",
    "K:E",
    "[V:1] ef ge b2 | f2 b2 f2 |",
    "[V:2] X | X |",
    "[V:5] X | X |",
    "[V:6] z2 [B,E]2 [EG]2 | z2 [B,E]2 [EG]2 |",
    "[V:5b] E,6 | D,6 |",
    "[V:6b] z2 [B,E]2 [EG]2 | z2 [B,D]2 [DF]2 |",
    "",
  ].join("\n");
  return filterVoicesInAbcWithDeletions(source, new ABCContext(new AbcErrorReporter())).text;
}

describe("drawing a score that the voice filter has filtered", () => {
  it("draws the score when the %%score line starts with voices that are hidden", async () => {
    const text = filteredScore("%%abcls-voices show 5", "%%score ( 1 2 ) | ( 5 6 ) | ( 5b 6b )");
    expect(text).to.contain("%%score ( 5 )");
    const result = await renderAbcToSvg(text);
    expect(result.svgs.length).to.be.greaterThan(0);
  });

  it("draws the score when a voice with an id such as 6b is the one that is shown", async () => {
    const text = filteredScore("%%abcls-voices show 6b", "%%score ( 1 2 ) | ( 5 6 ) | ( 5b 6b )");
    expect(text).to.contain("%%score ( 6b )");
    const result = await renderAbcToSvg(text);
    expect(result.svgs.length).to.be.greaterThan(0);
  });

  it("draws the score when several voices are shown, in staves that were not the first ones", async () => {
    const text = filteredScore("%%abcls-voices show 6 5b", "%%score { ( 1 2 ) | ( 5 6 ) } ( 5b 6b )");
    const result = await renderAbcToSvg(text);
    expect(result.svgs.length).to.be.greaterThan(0);
  });
});
