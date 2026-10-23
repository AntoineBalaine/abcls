import { expect } from "chai";
import { describe, it } from "mocha";
import { TAGS } from "../src/csTree/types";
import { buildChordTimeline, chordAtNode } from "../src/transforms/chordTimeline";
import { findByTag, toCSTreeWithContext } from "./helpers";

/**
 * Returns the root of the chord (as "C", "F", ...) that sounds at each note, in document order.
 */
function chordRootsAtNotes(source: string): (string | null)[] {
  const { root } = toCSTreeWithContext(source);
  const timeline = buildChordTimeline(root);
  return findByTag(root, TAGS.Note).map((note) => {
    const chord = chordAtNode(timeline, note.id);
    return chord === null ? null : chord.root;
  });
}

describe("chordTimeline", () => {
  it("gives a note the chord of its own bar, whatever the order of the voices", () => {
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 | "F" x8 |\n[V:2] c8 | f8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F"]);
  });

  it("follows a chord change in the middle of a bar", () => {
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x4 "F" x4 |\n[V:2] c4 f4 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F"]);
  });

  it("does not count a barline that opens a line as a bar", () => {
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] | "C" x8 | "F" x8 |\n[V:2] c8 | f8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F"]);
  });

  it("does not count a barline that follows another barline as a bar", () => {
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 || "F" x8 |\n[V:2] c8 | f8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F"]);
  });

  it("keeps counting the bars of a voice over several lines", () => {
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x8 |\n[V:2] c8 |\n[V:1] "F" x8 |\n[V:2] f8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F"]);
  });

  it("does not let a tune read the chords of the previous tune", () => {
    const source = 'X:1\nK:C\n"G" c8 |\n\nX:2\nK:C\nc8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["G", null]);
  });

  it("gives null to a note when no chord symbol precedes it", () => {
    expect(chordRootsAtNotes("X:1\nK:C\nc8 |\n")).to.deep.equal([null]);
  });
});
