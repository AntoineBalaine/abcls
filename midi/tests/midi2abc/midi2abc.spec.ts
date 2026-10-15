import { Scanner, parse, ABCContext, File_structure } from "abcls-parser";
import { expect } from "chai";
import { abc2midi } from "../../src/abc2midi/abc2midi";
import { midi2abc } from "../../src/midi2abc/midi2abc";
import { restateNaturals } from "../../src/midi2abc/tone2abc/tone2abc";

// =============================================================================
// Helpers
// =============================================================================

// Minimal Type 0 MIDI file: one track, 96 ppqn, one C4 note at velocity 96.
// Layout:
//   MThd (14 bytes): format 0, 1 track, 96 ppqn
//   MTrk (28 bytes): tempo 500000, note-on C4 v96, note-off C4 after 96 ticks, EOT
const MINIMAL_MIDI = new Uint8Array([
  // MThd
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
  // MTrk
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x14,
  // tempo 500000 (120 BPM)
  0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
  // note on C4 velocity 96
  0x00, 0x90, 0x3c, 0x60,
  // note off C4 after 96 ticks (1 quarter note)
  0x60, 0x80, 0x3c, 0x00,
  // end of track
  0x00, 0xff, 0x2f, 0x00,
]);

// Minimal MIDI file with only meta events (tempo + time sig) and no notes.
const META_ONLY_MIDI = new Uint8Array([
  // MThd
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
  // MTrk
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0e,
  // tempo 500000
  0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
  // time signature 4/4
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  // end of track
  0x00, 0xff, 0x2f, 0x00,
]);

function parseAbcString(abc: string): { ast: File_structure; ctx: ABCContext } {
  const ctx = new ABCContext();
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  return { ast, ctx };
}

// =============================================================================
// Example-based tests
// =============================================================================

describe("midi2abc", () => {
  it("writes a natural sign on a note that follows a sharp of the same pitch in the bar", () => {
    expect(restateNaturals("V:1\nC2^C2C2|C2\n")).to.equal("V:1\nC2^C2=C2|C2\n");
    // another octave of the same letter is restated too, and a bar line ends the accidental
    expect(restateNaturals("^C2c2|^C2C2|\n")).to.equal("^C2=c2|^C2=C2|\n");
    // headers are left alone
    expect(restateNaturals("K:C clef=F4\n")).to.equal("K:C clef=F4\n");
  });

  it("keeps a leading silence as a rest instead of moving the first note to the start", () => {
    // MINIMAL_MIDI with a delay of 96 ticks (one quarter note) before the note-on.
    const delayed = new Uint8Array(MINIMAL_MIDI);
    delayed[29] = 0x60;
    const abc = midi2abc(delayed);
    expect(abc).to.match(/z\d*\s*C/);
  });

  it("converts a minimal MIDI file with one note to ABC", () => {
    const result = midi2abc(MINIMAL_MIDI);
    expect(result).to.include("X:1");
    expect(result).to.include("K:");
    // the output should contain at least one note letter (a-g or A-G)
    expect(result).to.match(/[a-gA-G]/);
  });

  it("handles a MIDI file with only meta events (no notes) without throwing", () => {
    const result = midi2abc(META_ONLY_MIDI);
    expect(result).to.include("X:");
  });

  it("forwards title and composer options to the output", () => {
    const result = midi2abc(MINIMAL_MIDI, {
      title: "Test Title",
      composer: "Test Composer",
    });
    expect(result).to.include("T:Test Title");
    expect(result).to.include("C:Test Composer");
  });

  it("throws on bytes that are not a valid MIDI file", () => {
    const garbageBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(() => midi2abc(garbageBytes)).to.throw();
  });

  // =========================================================================
  // Roundtrip test: abc2midi then midi2abc
  // =========================================================================

  it("roundtrip: abc2midi output fed into midi2abc produces ABC starting with X:", () => {
    const abc = "X:1\nT:Roundtrip\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n";
    const { ast, ctx } = parseAbcString(abc);
    const midiBytes = abc2midi(ast, ctx);
    const result = midi2abc(midiBytes);
    expect(result).to.match(/^X:\s*1/);
  });
});
