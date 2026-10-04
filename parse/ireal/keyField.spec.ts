import { expect } from "chai";
import { KeyAccidental, KeyRoot, Mode } from "../types/abcjs-ast";
import { parseIrealKey } from "./keyField";

describe("iReal Pro key field", () => {
  it("reads a bare major key", () => {
    expect(parseIrealKey("C")).to.deep.equal({
      root: KeyRoot.C,
      acc: KeyAccidental.None,
      mode: Mode.Major,
      accidentals: [],
    });
  });

  it("reads an accidental in the tonic", () => {
    expect(parseIrealKey("Eb").acc).to.equal(KeyAccidental.Flat);
    expect(parseIrealKey("F#").acc).to.equal(KeyAccidental.Sharp);
  });

  it("reads iReal Pro's trailing hyphen as minor", () => {
    const key = parseIrealKey("C-");
    expect(key.root).to.equal(KeyRoot.C);
    expect(key.mode).to.equal(Mode.Minor);
  });

  it("reads an accidental and a minor together", () => {
    const key = parseIrealKey("Ab-");
    expect(key.root).to.equal(KeyRoot.A);
    expect(key.acc).to.equal(KeyAccidental.Flat);
    expect(key.mode).to.equal(Mode.Minor);
  });

  it("falls back to C major for an absent or unreadable field", () => {
    for (const field of [undefined, "", "   ", "H", "Cmaj", "C--"]) {
      const key = parseIrealKey(field);
      expect(key.root, `for ${JSON.stringify(field)}`).to.equal(KeyRoot.C);
      expect(key.mode, `for ${JSON.stringify(field)}`).to.equal(Mode.Major);
      expect(key.acc, `for ${JSON.stringify(field)}`).to.equal(KeyAccidental.None);
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(parseIrealKey(" Bb- ").mode).to.equal(Mode.Minor);
  });
});
