import { expect } from "chai";
import { describe, it } from "mocha";
import { harmonizeVoices } from "../src/runner/harmonizeVoices";
import { runTransform, TransformError } from "../src/runner/runTransform";

const SCORE = 'X:1\nV:1\nV:2\nK:Cm\n[V:1] "Fm" x8 | "Cm" x4 "Bb6" x4 |\n[V:2] F3E G4 | G4 D4 |\n';

describe("runTransform", () => {
  it("applies a transform to the selected ranges only", () => {
    const source = "X:1\nK:C\nC D E F |\nG A B c |\n";
    const result = runTransform({
      source,
      transform: "transpose",
      args: [2],
      ranges: [{ start: { line: 3, character: 0 }, end: { line: 3, character: 100 } }],
    });
    expect(result.split("\n")[2]).to.equal("C D E F |");
    expect(result.split("\n")[3]).to.not.equal("G A B c |");
  });

  it("throws on an unknown transform", () => {
    expect(() => runTransform({ source: SCORE, transform: "nope", args: [], ranges: null })).to.throw(TransformError);
  });
});

describe("harmonizeVoices", () => {
  const result = harmonizeVoices(SCORE, { from: "2", into: ["3", "4", "5"], voicing: "close" });
  const lines = result.split("\n");

  it("declares the new voices in the header, with a bass clef for the lowest", () => {
    expect(lines).to.include("V:3 clef=treble");
    expect(lines).to.include("V:4 clef=treble");
    expect(lines).to.include("V:5 clef=bass");
  });

  it("keeps the melody and the chord voice untouched", () => {
    expect(lines).to.include('[V:1] "Fm" x8 | "Cm" x4 "Bb6" x4 |');
    expect(lines).to.include("[V:2] F3E G4 | G4 D4 |");
  });

  it("writes one line per new voice, and none for the work voice", () => {
    expect(lines.filter((l) => l.startsWith("[V:3]"))).to.have.length(1);
    expect(lines.filter((l) => l.startsWith("[V:4]"))).to.have.length(1);
    expect(lines.filter((l) => l.startsWith("[V:5]"))).to.have.length(1);
    expect(result).to.not.contain("HARMONIZE_WORK");
  });

  it("keeps the durations and follows the chord of each beat (Fm, then Cm, then Bb6)", () => {
    // Over Fm the lead F is the root of Fm7 (Ab C Eb F); over Bb6 the lead D is the third (F G Bb D).
    expect(lines).to.include("[V:3] E3C F4 | E4 B,4 |");
    expect(lines).to.include("[V:5] A,3F, D4 | B,4 F,4 |");
  });

  it("refuses to write into a voice id that the score already has", () => {
    expect(() => harmonizeVoices(SCORE, { from: "2", into: ["1", "4", "5"], voicing: "close" })).to.throw(TransformError, "already exists");
  });

  it("keeps a tie in a part only when the part repeats the pitch", () => {
    // C to Am under a tied e: the parts holding c and G repeat their pitch, the part holding B moves to A.
    const tied = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 | "Am" x8 |\n[V:2] e8- | e8 |\n';
    const parts = harmonizeVoices(tied, { from: "2", into: ["3", "4", "5"], voicing: "close" }).split("\n");
    expect(parts).to.include("[V:3] c8- | c8 |");
    expect(parts).to.include("[V:4] B8 | A8 |");
    expect(parts).to.include("[V:5] G8- | G8 |");
  });

  it("asks for 3 to 5 new voices", () => {
    expect(() => harmonizeVoices(SCORE, { from: "2", into: ["3"], voicing: "close" })).to.throw(TransformError, "between 3 and 5");
  });

  it("throws when the source voice has no line", () => {
    expect(() => harmonizeVoices(SCORE, { from: "9", into: ["3"], voicing: "close" })).to.throw(TransformError);
  });
});
