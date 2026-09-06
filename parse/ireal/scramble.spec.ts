import { expect } from "chai";
import fc from "fast-check";
import { scramble, unscramble } from "./scramble";

describe("iReal scramble/unscramble", () => {
  it("round-trips a short (unchunked) string unchanged through unscramble", () => {
    const plain = "C  |D-7 |G7  |C   |";
    expect(unscramble(scramble(plain))).to.equal(plain);
  });

  it("round-trips a string longer than one chunk (50 chars)", () => {
    const plain = "C  |D-7 |G7  |C   |A-7 |D7  |G^7 |C   |Bh7 |E7  |F   |";
    expect(plain.length).to.be.greaterThan(50);
    expect(unscramble(scramble(plain))).to.equal(plain);
  });

  it("round-trips a string containing the literal replacement targets", () => {
    const plain = "C | x | |   |D-7|";
    expect(unscramble(scramble(plain))).to.equal(plain);
  });

  it("matches the real sample link's decode of the metadata fields (fields 0-6 confirmed against a real irealb:// link)", () => {
    const encoded =
      "%54%65%73%74=%46%6C%6F%72%69%6E==%4D%65%64%69%75%6D%20%53%77%69%6E%67=%43=%32=%31%72%33%34%4C%62%4B%63%75%37%41%59%59%7C%51%43%2C%20%4C%5A%79%58%7C%72%20%20%5A%4C%20%23%43%3E%70%70%59%6E%59%7C%51%79%58%51%79%58%4B%41%45%52%42%3C%51%7C%47%58%79%34%33%54%7B%59%20%4C%5A%43%2C%44%2C%45%2C%7C%57%2F%44%2C%57%2F%43%2C%57%2F%42%2C%7C%41%62%20%4C%5A%20%78%20%4C%5A%59%59%59%6E%70%70%7C%55%46%20%20%7D";
    const decoded = decodeURIComponent(encoded);
    const fields = decoded.split("=");
    expect(fields[0]).to.equal("Test");
    expect(fields[1]).to.equal("Florin");
    expect(fields[2]).to.equal("");
    expect(fields[3]).to.equal("Medium Swing");
    expect(fields[4]).to.equal("C");
    expect(fields[5]).to.equal("2");
    expect(fields[6].startsWith("1r34LbKcu7")).to.equal(true);
    // The chord data after the marker is short (under the 50-char chunk
    // threshold), so this fixture only exercises the literal-replacement
    // step of unscramble, not the chunk-swap step; it does not by itself
    // confirm the chunk-swap indices against real data. See scramble.ts's
    // module comment and the plan's licensing section.
    const chordData = fields[6].slice("1r34LbKcu7".length);
    expect(unscramble(chordData)).to.be.a("string");
  });

  it("is stable under fast-check for arbitrary printable-ASCII strings with no coincidental collision substrings", () => {
    // The literal-replacement step (Kcl/LZ/XyQ <-> | x/ |/   ) is only a
    // safe round trip when the plain text does not itself coincidentally
    // contain "Kcl", "LZ", or "XyQ" as substrings; real chord-chart text
    // never does, but an arbitrary generator can, so those are excluded
    // here rather than treated as a bug in scramble/unscramble.
    const COLLISION_SUBSTRINGS = ["Kcl", "LZ", "XyQ"];
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme-ascii", minLength: 0, maxLength: 300 }).filter((s) => COLLISION_SUBSTRINGS.every((sub) => !s.includes(sub))),
        (s) => {
          expect(unscramble(scramble(s))).to.equal(s);
        }
      )
    );
  });
});
