import { expect } from "chai";
import { describe, it } from "mocha";
import { barLengthInUnits, blockChords, rhythmUnits, unitsToRhythm } from "../src/runner/blockChords";
import { TransformError } from "../src/runner/runTransform";

const SCORE = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" X | "Cm" x4 "Bb6" x4 |\n[V:2] F3E G4 | G4 D4 |\n';

describe("blockChords helpers", () => {
  it("reads rhythm suffixes as units", () => {
    expect(rhythmUnits("")).to.equal(1);
    expect(rhythmUnits("4")).to.equal(4);
    expect(rhythmUnits("/")).to.equal(0.5);
    expect(rhythmUnits("3/2")).to.equal(1.5);
  });

  it("writes units as rhythm suffixes", () => {
    expect(unitsToRhythm(1)).to.equal("");
    expect(unitsToRhythm(8)).to.equal("8");
    expect(unitsToRhythm(1.5)).to.equal("96/64");
  });

  it("reads a tune without meter as 8 eighth notes per bar", () => {
    expect(barLengthInUnits(SCORE)).to.equal(8);
  });

  it("reads a 3/4 tune with a quarter-note unit as 3 units per bar", () => {
    expect(barLengthInUnits("X:1\nM:3/4\nL:1/4\nK:C\nC D E |\n")).to.equal(3);
  });
});

describe("blockChords reading of the chord line", () => {
  const into = ["3", "4", "5", "6"];

  it("counts a bracket chord as one duration, and ignores decorations, comments and inline fields", () => {
    const source = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" !fermata![K:Cm] [CEG]4 z4 | % some comment with notes cab\n[V:2] F8 |\n';
    const lines = blockChords(source, { chordVoice: "1", into, voicing: "close" }).split("\n");
    expect(lines).to.include("[V:3] A8 |");
  });

  it("places a chord change after a broken pair at the right beat", () => {
    // B3>B lasts 4.5 + 0.5 = 5 units, so Ab lasts 5 units and Bb6 the remaining 3.
    const source = 'X:1\nV:1\nK:Cm\n[V:1] "Ab" B3>B "Bb6" B3 |\n';
    const lines = blockChords(source, { chordVoice: "1", into, voicing: "close" }).split("\n");
    expect(lines.find((l) => l.startsWith("[V:3]"))).to.match(/^\[V:3\] \S+5 \S+3 \|$/);
  });

  it("places a chord change after a triplet at the right beat", () => {
    // (3BBB lasts 2 units, so Ab lasts 2 units and Bb6 the remaining 6.
    const source = 'X:1\nV:1\nK:Cm\n[V:1] "Ab" (3BBB "Bb6" B6 |\n';
    const lines = blockChords(source, { chordVoice: "1", into, voicing: "close" }).split("\n");
    expect(lines.find((l) => l.startsWith("[V:3]"))).to.match(/^\[V:3\] \S+2 \S+6 \|$/);
  });

  it("refuses ids that are empty, repeated or malformed", () => {
    const source = 'X:1\nV:1\nK:C\n[V:1] "C" x8 |\n';
    expect(() => blockChords(source, { chordVoice: "1", into: ["3", "4", "5", ""], voicing: "close" })).to.throw(TransformError);
    expect(() => blockChords(source, { chordVoice: "1", into: ["3", "4", "5", "5"], voicing: "close" })).to.throw(TransformError, "twice");
    expect(() => blockChords(source, { chordVoice: "1", into: ["3", "4", "5", "[6]"], voicing: "close" })).to.throw(TransformError, "valid voice id");
  });
});

describe("blockChords with several lines", () => {
  const MULTI = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" X |\n[V:2] F8 |\n[V:1] "Cm" X |\n[V:2] G8 |\n';

  it("writes the new voices of each line right after the melody line of the same system", () => {
    const lines = blockChords(MULTI, { chordVoice: "1", into: ["3", "4", "5", "6"], voicing: "close" }).split("\n");
    const first = lines.indexOf('[V:1] "Fm" X |');
    expect(lines.slice(first, first + 6).map((l) => l.slice(0, 5))).to.deep.equal(["[V:1]", "[V:2]", "[V:3]", "[V:4]", "[V:5]", "[V:6]"]);
    const second = lines.indexOf('[V:1] "Cm" X |');
    expect(second).to.equal(first + 6);
    expect(lines.slice(second, second + 6).map((l) => l.slice(0, 5))).to.deep.equal(["[V:1]", "[V:2]", "[V:3]", "[V:4]", "[V:5]", "[V:6]"]);
  });
});

describe("blockChords", () => {
  const result = blockChords(SCORE, { chordVoice: "1", into: ["3", "4", "5", "6"], voicing: "close" });
  const lines = result.split("\n");

  it("writes one chord per symbol, for as long as the symbol lasts, one line per voice", () => {
    // Fm lasts a bar; Cm and Bb6 last half a bar each. The top voice stays close to its previous note.
    expect(lines).to.include("[V:3] A8 | G4 G4 |");
    expect(lines).to.include("[V:4] F8 | E4 F4 |");
    expect(lines).to.include("[V:5] E8 | C4 D4 |");
    expect(lines).to.include("[V:6] C8 | B,4 B,4 |");
  });

  it("does not harmonize the melody", () => {
    expect(lines).to.include("[V:2] F3E G4 | G4 D4 |");
  });

  it("writes the new voices below the melody, and declares them", () => {
    expect(lines.indexOf("[V:3] A8 | G4 G4 |")).to.be.greaterThan(lines.indexOf("[V:2] F3E G4 | G4 D4 |"));
    expect(lines).to.include("V:6 clef=bass");
    expect(result).to.not.contain("HARMONIZE_WORK");
  });

  it("builds the sixth of Bb6 (G) and not a major seventh", () => {
    expect(lines).to.include("[V:3] A8 | G4 G4 |");
    expect(lines.find((l) => l.startsWith("[V:5]"))).to.contain("D4");
  });

  it("asks for 4 to 6 voices", () => {
    expect(() => blockChords(SCORE, { chordVoice: "1", into: ["3", "4"], voicing: "close" })).to.throw(TransformError);
  });

  it("refuses to write into a voice id that the score already has", () => {
    expect(() => blockChords(SCORE, { chordVoice: "1", into: ["2", "4", "5", "6"], voicing: "close" })).to.throw(TransformError, "already exists");
  });

  it("throws when the chord voice has no line", () => {
    expect(() => blockChords(SCORE, { chordVoice: "9", into: ["3", "4", "5", "6"], voicing: "close" })).to.throw(TransformError);
  });
});
