import { expect } from "chai";
import { KeyAccidental, KeyRoot, KeySignature, Mode } from "../types/abcjs-ast";
import { formatDegree, nashvilleDegree, regularDegree } from "./numberNotation";

function key(root: KeyRoot, acc: KeyAccidental, mode: Mode): KeySignature {
  return { root, acc, mode, accidentals: [] };
}

describe("numberNotation", () => {
  describe("nashvilleDegree", () => {
    const cMajor = key(KeyRoot.C, KeyAccidental.None, Mode.Major);

    it("tonic is 1", () => {
      expect(formatDegree(nashvilleDegree(KeyRoot.C, KeyAccidental.None, cMajor))).to.equal("1");
    });
    it("major third above tonic is 3", () => {
      expect(formatDegree(nashvilleDegree(KeyRoot.E, KeyAccidental.None, cMajor))).to.equal("3");
    });
    it("a minor key's own tonic reads as 6, not 1 — Nashville numbers off the relative major", () => {
      // A minor's relative major is C major: A is the diatonic vi of C
      // major, so the i chord of an A-minor tune reads as "6".
      const aMinor = key(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(nashvilleDegree(KeyRoot.A, KeyAccidental.None, aMinor))).to.equal("6");
    });
    it("a minor key's relative major tonic reads as 1", () => {
      // C minor's relative major is Eb major: Eb reads as "1" even though
      // the song's own tonic is C.
      const cMinor = key(KeyRoot.C, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(nashvilleDegree(KeyRoot.E, KeyAccidental.Flat, cMinor))).to.equal("1");
    });
    it("tritone above tonic is #4", () => {
      expect(formatDegree(nashvilleDegree(KeyRoot.F, KeyAccidental.Sharp, cMajor))).to.equal("#4");
    });
    it("flat seventh above tonic is b7", () => {
      expect(formatDegree(nashvilleDegree(KeyRoot.B, KeyAccidental.Flat, cMajor))).to.equal("b7");
    });
    it("handles a flat key as tonic", () => {
      const bbMajor = key(KeyRoot.B, KeyAccidental.Flat, Mode.Major);
      expect(formatDegree(nashvilleDegree(KeyRoot.E, KeyAccidental.Flat, bbMajor))).to.equal("4");
    });
  });

  describe("regularDegree", () => {
    it("reads a minor key against its parallel major, so a minor third is b3", () => {
      // A minor is read against A major, whose third is C sharp, so C is a
      // semitone below it. Reading a minor key against the minor scale
      // instead printed a plain 3, which makes the same digit mean
      // different notes depending on the key's mode.
      const aMinor = key(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(regularDegree(KeyRoot.C, KeyAccidental.None, aMinor))).to.equal("b3");
    });
    it("reads a minor key's minor seventh as b7 for the same reason", () => {
      const aMinor = key(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(regularDegree(KeyRoot.G, KeyAccidental.None, aMinor))).to.equal("b7");
    });
    it("keeps a minor key's tonic at 1, which is what separates it from Nashville", () => {
      // Both read against a major scale; they differ in which tonic. This
      // one uses the parallel major, Nashville the relative major.
      const aMinor = key(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(regularDegree(KeyRoot.A, KeyAccidental.None, aMinor))).to.equal("1");
      expect(formatDegree(nashvilleDegree(KeyRoot.A, KeyAccidental.None, aMinor))).to.equal("6");
    });
    it("reads a minor key's major sixth as a plain 6", () => {
      // A chart in A minor writing F sharp means A major's own sixth.
      const aMinor = key(KeyRoot.A, KeyAccidental.None, Mode.Minor);
      expect(formatDegree(regularDegree(KeyRoot.F, KeyAccidental.Sharp, aMinor))).to.equal("6");
    });
    it("major key behaves the same as Nashville", () => {
      const cMajor = key(KeyRoot.C, KeyAccidental.None, Mode.Major);
      expect(formatDegree(regularDegree(KeyRoot.E, KeyAccidental.Flat, cMajor))).to.equal(
        formatDegree(nashvilleDegree(KeyRoot.E, KeyAccidental.Flat, cMajor)),
      );
    });
    it("dorian key reads its own flat seventh as plain 7", () => {
      const dDorian = key(KeyRoot.D, KeyAccidental.None, Mode.Dorian);
      expect(formatDegree(regularDegree(KeyRoot.C, KeyAccidental.None, dDorian))).to.equal("7");
    });
    it("raises a degree the scale lowers rather than flattening the one above it", () => {
      // Only a modal key reaches this rule now that a minor key is read
      // against its parallel major, and no iReal Pro chart can be in one.
      // It still holds for an ABC-sourced modal key: the dorian scale
      // lowers its third, so the note above that is the major third,
      // written "#3". Flattening the degree above instead gave "b4", which
      // no chart writes.
      const dDorian = key(KeyRoot.D, KeyAccidental.None, Mode.Dorian);
      expect(formatDegree(regularDegree(KeyRoot.F, KeyAccidental.Sharp, dDorian))).to.equal("#3");
    });
    it("spells a major key's chromatic degrees as flattened upper degrees still", () => {
      // The rule above must not disturb a major key, where every gap but
      // the tritone is read as a flattened upper degree.
      const cMajor = key(KeyRoot.C, KeyAccidental.None, Mode.Major);
      const spell = (root: KeyRoot, acc: KeyAccidental) => formatDegree(regularDegree(root, acc, cMajor));
      expect(spell(KeyRoot.D, KeyAccidental.Flat)).to.equal("b2");
      expect(spell(KeyRoot.E, KeyAccidental.Flat)).to.equal("b3");
      expect(spell(KeyRoot.G, KeyAccidental.Flat)).to.equal("#4");
      expect(spell(KeyRoot.A, KeyAccidental.Flat)).to.equal("b6");
      expect(spell(KeyRoot.B, KeyAccidental.Flat)).to.equal("b7");
    });
  });
});
