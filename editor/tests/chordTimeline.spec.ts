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

  it("counts a triplet as the time of two notes", () => {
    // (3cde lasts 2 units, so the f that follows starts at offset 2, where the F chord starts.
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x2 "F" x6 |\n[V:2] (3cde f6 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "C", "C", "F"]);
  });

  it("applies a tuplet to r notes only, with explicit p:q:r", () => {
    // (3:2:2 scales two notes by 2/3, so c and d last 4/3 units together and e starts before offset 2.
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x2 "F" x6 |\n[V:2] (3:2:2cd e f5 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "C", "C", "F"]);
  });

  it("lengthens the first note of a broken pair and shortens the second", () => {
    // c3>d lasts 3 * 1.5 = 4.5 then 0.5, so d starts at 4.5, after the F chord at offset 4.
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x4 "F" x4 |\n[V:2] c3>d e3 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "F", "F"]);
  });

  it("shortens the first note of a reversed broken pair", () => {
    // c4<d2 lasts 2 then 3 (d2 is 2 units long, so 2 * 1.5), so d starts at offset 2 under C, and e starts at 5 under F.
    const source = 'X:1\nV:1\nV:2\nK:C\n[V:1] "C" x4 "F" x4 |\n[V:2] c4<d2 e3 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["C", "C", "F"]);
  });

  it("does not let a tune read the chords of the previous tune", () => {
    const source = 'X:1\nK:C\n"G" c8 |\n\nX:2\nK:C\nc8 |\n';
    expect(chordRootsAtNotes(source)).to.deep.equal(["G", null]);
  });

  it("gives null to a note when no chord symbol precedes it", () => {
    expect(chordRootsAtNotes("X:1\nK:C\nc8 |\n")).to.deep.equal([null]);
  });
});
