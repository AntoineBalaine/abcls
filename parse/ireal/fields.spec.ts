import { expect } from "chai";
import fc from "fast-check";
import { buildPlaylistLink, buildSongFieldString, parsePlaylistLink, parseSongFieldString, stripChordDataMarker, withChordDataMarker } from "./fields";

const REAL_SAMPLE_LINK =
  "irealb://%54%65%73%74=%46%6C%6F%72%69%6E==%4D%65%64%69%75%6D%20%53%77%69%6E%67=%43=%32=%31%72%33%34%4C%62%4B%63%75%37%41%59%59%7C%51%43%2C%20%4C%5A%79%58%7C%72%20%20%5A%4C%20%23%43%3E%70%70%59%6E%59%7C%51%79%58%51%79%58%4B%41%45%52%42%3C%51%7C%47%58%79%34%33%54%7B%59%20%4C%5A%43%2C%44%2C%45%2C%7C%57%2F%44%2C%57%2F%43%2C%57%2F%42%2C%7C%41%62%20%4C%5A%20%78%20%4C%5A%59%59%59%6E%70%70%7C%55%46%20%20%7D";

// A second, richer real sample ("After You've Gone", a real jazz standard),
// found and decoded independently of REAL_SAMPLE_LINK, specifically because
// it carries fields 7-9 (groove, bpm, repeats), which REAL_SAMPLE_LINK does
// not. Confirms groove (field 7, "Jazz-Gypsy Jazz") and style (field 3,
// "Up Tempo Swing") are genuinely distinct fields, not the same value under
// two names, and confirms bpm/repeats parse correctly from a real link.
const REAL_SAMPLE_LINK_WITH_GROOVE_BPM_REPEATS =
  "irealb://After%20You%27ve%20Gone%20dfb=Creamer%20Henry==Up%20Tempo%20Swing=G==1r34LbKcu77AZL%204CXyQX7EZL%20lcKQyXGZ%20LlcKQyX-CZL%20lcKyQKcl4TA*%5BQyXC,l%20LZD%20%20lcKQyX7GZL%20lKcQyXGZL%20lcKQyX7%5D%5B,*BcKQyXyX7E%7CZC-Xy%5B%5D%20%20lcKQyX7EZLx%20,%20%7CQyXGZL%20lcKQA-XyQL%20lcK%7CQyX7yQ%7CC-G%7CQyX7A%7CQyX7-EQ%7CyX7B%7CQyXG%7CQyX6XyQ%7CEX-A%7CQA-7XyQ%7CD7XyQ%7CGXyQKcl,U,%20LZG7XyQKcl%20%20Z%20=Jazz-Gypsy%20Jazz=180=3";

describe("iReal Pro link fields", () => {
  it("parses a real sample link's fields 0-6 correctly", () => {
    const playlist = parsePlaylistLink(REAL_SAMPLE_LINK);
    expect(playlist.songs).to.have.length(1);
    const song = playlist.songs[0];
    expect(song.title).to.equal("Test");
    expect(song.composer).to.equal("Florin");
    expect(song.style).to.equal("Medium Swing");
    expect(song.key).to.equal("C");
    expect(song.transpose).to.equal("2");
    expect(song.rawChordData.startsWith("1r34LbKcu7")).to.equal(true);
    expect(song.groove).to.be.undefined;
    expect(song.bpm).to.be.undefined;
    expect(song.repeats).to.be.undefined;
  });

  it("parses a second real sample link's style, groove, bpm, and repeats, confirming style and groove are distinct fields", () => {
    const playlist = parsePlaylistLink(REAL_SAMPLE_LINK_WITH_GROOVE_BPM_REPEATS);
    expect(playlist.songs).to.have.length(1);
    const song = playlist.songs[0];
    expect(song.title).to.equal("After You've Gone dfb");
    expect(song.composer).to.equal("Creamer Henry");
    expect(song.style).to.equal("Up Tempo Swing");
    expect(song.key).to.equal("G");
    expect(song.groove).to.equal("Jazz-Gypsy Jazz");
    expect(song.bpm).to.equal("180");
    expect(song.repeats).to.equal("3");
    expect(song.style).to.not.equal(song.groove);
  });

  it("round-trips a song whose title and composer are both empty, without corrupting composer into a guard placeholder", () => {
    const fields = {
      title: "",
      composer: "",
      style: "Ballad",
      key: "C",
      transpose: "0",
      rawChordData: withChordDataMarker("C |"),
    };
    const roundTripped = parseSongFieldString(buildSongFieldString(fields));
    expect(roundTripped.title).to.equal("");
    expect(roundTripped.composer).to.equal("");
  });

  it("round-trips a song's fields through build and parse", () => {
    const fields = {
      title: "My Tune",
      composer: "A. Composer",
      style: "Ballad",
      key: "Bb-",
      transpose: "0",
      rawChordData: withChordDataMarker("C  |D-7 |"),
      groove: "Medium Swing",
      bpm: "120",
      repeats: "2",
    };
    const roundTripped = parseSongFieldString(buildSongFieldString(fields));
    expect(roundTripped).to.deep.equal(fields);
  });

  it("round-trips a multi-song playlist with a playlist name", () => {
    const playlist = {
      songs: [
        { title: "Song A", composer: "X", style: "Swing", key: "C", transpose: "0", rawChordData: withChordDataMarker("C |") },
        { title: "Song B", composer: "Y", style: "Ballad", key: "F", transpose: "0", rawChordData: withChordDataMarker("F |") },
      ],
      playlistName: "My Set",
    };
    const roundTripped = parsePlaylistLink(buildPlaylistLink(playlist));
    expect(roundTripped.songs.map((s) => s.title)).to.deep.equal(["Song A", "Song B"]);
    expect(roundTripped.playlistName).to.equal("My Set");
  });

  it("strips and re-adds the chord-data marker", () => {
    const scrambled = "AYY|QC,";
    expect(stripChordDataMarker(withChordDataMarker(scrambled))).to.equal(scrambled);
  });

  it("throws a clear error when the chord-data marker is missing", () => {
    expect(() => stripChordDataMarker("no marker here")).to.throw(/marker/);
  });

  it("throws a clear error on a malformed song string with too few fields", () => {
    expect(() => parseSongFieldString("Title=Composer")).to.throw(/at least 7 fields/);
  });

  it("round-trips a multi-song playlist regardless of which optional fields are empty (regression: adjacent empty fields collide with the \"===\" separator)", () => {
    // A field that is exactly a single space is indistinguishable from
    // buildSongFieldString's own empty-field placeholder (EMPTY_FIELD_GUARD).
    // A field that contains a valid percent-encoding sequence (e.g. "%00")
    // is indistinguishable from a real percent-encoded link by
    // parsePlaylistLink's decode-with-fallback (it decodes successfully,
    // just like a genuinely encoded link would). Neither is realistic
    // real-world field content, so both are excluded here the same way
    // scramble.spec.ts excludes coincidental collisions with its own
    // literal replacement substrings; see KNOWN_GAPS.md.
    const notJustASpace = (s: string) => s !== " " && !s.includes("=") && !/%[0-9a-fA-F]{2}/.test(s);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 10 }).filter(notJustASpace),
            composer: fc.string({ maxLength: 10 }).filter(notJustASpace),
            style: fc.string({ maxLength: 10 }).filter(notJustASpace),
            key: fc.constant("C"),
            transpose: fc.constant("0"),
            rawChordData: fc.constant(withChordDataMarker("C |")),
            groove: fc.option(fc.string({ minLength: 1, maxLength: 10 }).filter(notJustASpace), { nil: undefined }),
            bpm: fc.option(fc.string({ minLength: 1, maxLength: 5 }).filter(notJustASpace), { nil: undefined }),
            repeats: fc.option(fc.string({ minLength: 1, maxLength: 3 }).filter(notJustASpace), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 4 }
        ),
        (songs) => {
          const link = buildPlaylistLink({ songs });
          const roundTripped = parsePlaylistLink(link);
          expect(roundTripped.songs).to.deep.equal(songs);
        }
      )
    );
  });
});
