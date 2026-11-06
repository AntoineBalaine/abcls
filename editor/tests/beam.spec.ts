import { Range } from "abcls-parser";
import { expect } from "chai";
import { runTransform } from "../src/runner/runTransform";

function beam(meter: string, body: string, length: string = "1/8", ranges: Range[] | null = null): string {
  const result = runTransform({ source: `X:1\nM:${meter}\nL:${length}\nK:C\n${body}`, transform: "autoBeam", args: [], ranges });
  if (!result.ok) throw new Error(result.error);
  return result.value.split("\n").slice(4).join("\n").trim();
}

describe("autoBeam", () => {
  it("beams eight eighth notes of 4/4 in pairs, whatever the spacing was", () => {
    expect(beam("4/4", "cdefgabc|\n")).to.equal("cd ef ga bc|");
    expect(beam("4/4", "c d e f g a b c|\n")).to.equal("cd ef ga bc|");
  });

  it("beams the eighth notes of 6/8 by three", () => {
    expect(beam("6/8", "cdefga|\n")).to.equal("cde fga|");
  });

  it("tells 6/8 (3/8+3/8) from 6/8 (2/8+2/8+2/8)", () => {
    expect(beam("6/8 (3/8+3/8)", "cdefga|\n")).to.equal("cde fga|");
    expect(beam("6/8 (2/8+2/8+2/8)", "cdefga|\n")).to.equal("cd ef ga|");
  });

  it("beams 5/8 as three and two, and follows the groups that the meter gives", () => {
    expect(beam("5/8", "cdefg|\n")).to.equal("cde fg|");
    expect(beam("5/8 (2/8+3/8)", "cdefg|\n")).to.equal("cd efg|");
    expect(beam("(2+3)/8", "cdefg|\n")).to.equal("cd efg|");
  });

  it("does not beam quarter notes, and a quarter note ends a beam", () => {
    expect(beam("4/4", "cdE2fg ab|\n")).to.equal("cd E2 fg ab|");
  });

  it("breaks a beam at a rest, and puts a space on both sides of it", () => {
    expect(beam("4/4", "cdzfgab|\n")).to.equal("cd z f ga b|");
  });

  it("keeps decorations and chord symbols with the note that follows them", () => {
    expect(beam("4/4", '!trill!c d "G"e f|\n')).to.equal('!trill!cd "G"ef|');
  });

  it("beams chords like notes", () => {
    expect(beam("4/4", "[ce][df]gb|\n")).to.equal("[ce][df] gb|");
  });

  it("works on each bar by itself, and leaves the bar lines", () => {
    expect(beam("4/4", "cdef|cdef|\n")).to.equal("cd ef|cd ef|");
  });

  it("leaves the bars outside the selection as they are", () => {
    const first: Range = { start: { line: 4, character: 0 }, end: { line: 4, character: 4 } };
    expect(beam("4/4", "cdef|c d e f|\n", "1/8", [first])).to.equal("cd ef|c d e f|");
  });

  it("leaves a tune with no meter to the composer", () => {
    const result = runTransform({ source: "X:1\nK:C\ncdef|\n", transform: "autoBeam", args: [], ranges: null });
    expect(result.ok && result.value.trim().split("\n").pop()).to.equal("cdef|");
  });

  it("is idempotent", () => {
    const once = beam("6/8", "c d e f g a|\n");
    const twice = beam("6/8", once + "\n");
    expect(twice).to.equal(once);
  });
});
