import { expect } from "chai";
import { buildPlaylistLink, IrealSongFields } from "./fields";
import { importIrealLinkToAbcx } from "./importFromIreal";
import { scramble } from "./scramble";
import { withChordDataMarker } from "./fields";

function linkWithKey(key: string): string {
  const fields: IrealSongFields = {
    title: "Test",
    composer: "Composer",
    style: "Medium Swing",
    key,
    transpose: "0",
    rawChordData: withChordDataMarker(scramble("C |")),
  };
  return buildPlaylistLink({ songs: [fields] });
}

function linkWithChordData(chordData: string): string {
  const fields: IrealSongFields = {
    title: "Test",
    composer: "Composer",
    style: "Medium Swing",
    key: "C",
    transpose: "0",
    rawChordData: withChordDataMarker(scramble(chordData)),
  };
  return buildPlaylistLink({ songs: [fields] });
}

/**
 * The tune-body (chord grid) lines of a generated ABCx tune, joined back
 * into one line for easy assertion — everything that isn't a header
 * field ("X:", "T:", "K:", ...) or a comment ("% iReal Pro source: ...",
 * which embeds the original raw link and so legitimately contains raw
 * grid text that assertions must not match against).
 */
function tuneBody(abcx: string): string {
  return abcx
    .split("\n")
    .filter((line) => line.trim().length > 0 && !/^[A-Za-z]:/.test(line) && !line.startsWith("%"))
    .join(" ");
}

describe("importIrealLinkToAbcx key field translation", () => {
  it('translates iReal Pro\'s own "-" minor-key suffix to ABC\'s "m" suffix', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("A-"));
    expect(abcx).to.include("K:Am");
    expect(abcx).to.not.include("K:A-");
  });

  it('translates a flat minor key ("Bb-") the same way', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("Bb-"));
    expect(abcx).to.include("K:Bbm");
  });

  it('leaves an already-ABC-style minor key ("Cm") unchanged', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("Cm"));
    expect(abcx).to.include("K:Cm");
  });

  it("leaves a major key unchanged", () => {
    const abcx = importIrealLinkToAbcx(linkWithKey("C"));
    expect(abcx).to.include("K:C");
  });

  it('defaults to "K:C" when the key field is empty', () => {
    const abcx = importIrealLinkToAbcx(linkWithKey(""));
    expect(abcx).to.include("K:C");
  });
});

describe("importIrealLinkToAbcx with a repeat-bar cell mixed into a multi-cell bar", () => {
  it("does not throw, and still imports the chart's other chords", () => {
    // "C x G" is one bar containing three cells: a chord, a repeat-bar
    // marker, and another chord — not the whole-bar-repeat shape
    // gridTokensToAbcxBody's resolution pass handles, found in a real
    // user library backup.
    expect(() => importIrealLinkToAbcx(linkWithChordData("C x G | D-7 |"))).to.not.throw();
    const abcx = importIrealLinkToAbcx(linkWithChordData("C x G | D-7 |"));
    expect(abcx).to.include("C");
    expect(abcx).to.include("Dm7");
  });
});

describe("importIrealLinkToAbcx with a chain of separate-bar repeat cells", () => {
  it('resolves "repeat 3 times" (three separate one-cell "x" bars) to the same plain chord repeated as ordinary bars', () => {
    // "Eb-7 | x | x | x | Ab-7 |" ("-7" is iReal Pro's own minor-seventh
    // shorthand, not ABC's "m7"): each repeat is its own bar-delimited
    // "x" cell — confirmed against a real chart's raw grid text to be how
    // iReal Pro actually encodes a multi-bar repeat. A single-bar "x"
    // means "this bar holds the same chord as the previous one", which
    // iReal Pro itself shows as a plain repeated chord, not a music-
    // notation repeat sign — wrapping it in "|: ... :|" (confirmed
    // against a real chart, "A Felicidade", to be wrong: iReal Pro only
    // shows a repeat sign around its one genuinely repeated section, not
    // around every held chord) littered the chart with spurious repeat
    // barlines.
    const abcx = importIrealLinkToAbcx(linkWithChordData("Eb-7 | x | x | x | Ab-7 |"));
    // No trailing barline after the final bar: the chart's own trailing
    // "|" leaves an empty bar behind, which carries no musical
    // information and is dropped rather than printed as a stray bar.
    expect(tuneBody(abcx)).to.equal("Ebm7 | Ebm7 | Ebm7 | Ebm7 | Abm7");
    expect(abcx).to.not.include("|:");
  });
});

describe("importIrealLinkToAbcx with an unmatched repeat-section brace", () => {
  it("does not glue the unmatched brace onto the following chord (confirmed against a real chart with no closing brace at all)", () => {
    const abcx = importIrealLinkToAbcx(linkWithChordData("{C7 | x | x | x |F7 |"));
    // tuneBody deliberately excludes the "% iReal Pro source:" comment
    // line, which legitimately embeds the original, still-brace-prefixed
    // raw link.
    expect(tuneBody(abcx)).to.equal("C7 | C7 | C7 | C7 | F7");
  });
});

describe("importIrealLinkToAbcx barlines around a repeated section", () => {
  // Eight bars written twice in a row (what gridAnnotations.ts's
  // fillRepeats produces from a "{...}" section) collapse into one
  // repeat-barline-wrapped section, and the barline on each side of it
  // is derived from the bars either side rather than glued into a bar's
  // own text — so a repeat landing at a line boundary, next to a plain
  // bar, or immediately next to another repeated section each produce
  // exactly one correct barline, never a doubled "| |".
  // Each run ends with its own bar separator so that concatenating two
  // of them leaves a real bar boundary at the seam (without it, the last
  // chord of one copy and the first of the next land in the same bar).
  const eightBars = "C7 | D-7 | E-7 | F7 | G7 | A-7 | B-7 | C7 | ";

  it("wraps the repeated section once, with no doubled barline at the line break it ends on", () => {
    const abcx = importIrealLinkToAbcx(linkWithChordData(`${eightBars}${eightBars}F7 |`));
    expect(tuneBody(abcx)).to.equal("|: C7 | Dm7 | Em7 | F7 | G7 | Am7 | Bm7 | C7 :| F7");
  });

  it("uses a single plain barline before a repeat that starts mid-chart", () => {
    const abcx = importIrealLinkToAbcx(linkWithChordData(`F7 | ${eightBars}${eightBars}`));
    expect(tuneBody(abcx)).to.include("F7 |: C7");
    expect(tuneBody(abcx)).to.not.match(/\|\s*\|:/);
  });

  it('merges a repeat ending where the next begins into the single ":|:" symbol', () => {
    const first = "C7 | D-7 | E-7 | F7 | ";
    const second = "G7 | A-7 | B-7 | C7 | ";
    const abcx = importIrealLinkToAbcx(linkWithChordData(`${first}${first}${second}${second}`));
    expect(tuneBody(abcx)).to.include("F7 :|: G7");
    expect(tuneBody(abcx)).to.not.match(/:\|\s*\|:/);
  });
});

describe("importIrealLinkToAbcx with an empty bar in the grid", () => {
  it("drops a bar with no content rather than printing a stray barline for it", () => {
    // Two adjacent bar separators with nothing between them, which real
    // charts do contain (found in "African Queen, The").
    const abcx = importIrealLinkToAbcx(linkWithChordData("C7 | | F7 |"));
    expect(tuneBody(abcx)).to.equal("C7 | F7");
  });

  it("attaches a label to the next bar with content instead of giving it a bar of its own", () => {
    // A section label immediately before a repeat section ("*A{...")
    // ends up separated from the chord it introduces, which used to
    // leave the label sitting in a chordless measure of its own — and,
    // being one bar wide, shifted every following line of the chart by
    // one. Found in 8 charts of a real library, e.g. "Afternoon In
    // Paris" and "26-2".
    const abcx = importIrealLinkToAbcx(linkWithChordData("*A{T44C^7 |C-7 F7 |Bb^7 |Bb-7 Eb7 |"));
    expect(tuneBody(abcx)).to.include("[P:A] Cmaj7 | Cm7 F7");
    expect(tuneBody(abcx)).to.not.include("[P:A] |");
  });
});

describe("importIrealLinkToAbcx with section labels", () => {
  it('shows a section label inline as ABC\'s own "[P:X]" part-marker field, instead of dropping it', () => {
    // "D-7" is iReal Pro's own minor-seventh shorthand, not ABC's "Dm7".
    // "[P:X]" (not a bare "[X]", which looks similar but collides with
    // ABC's own bracket/inline-field syntax and corrupts the chord that
    // follows once this text is converted to real ABC) is ABC's standard
    // inline part-marker field, rendered by renderers like abcjs as a
    // proper boxed section letter above the staff.
    const abcx = importIrealLinkToAbcx(linkWithChordData("*AC7 | D-7 | *BG7 | C7 |"));
    expect(tuneBody(abcx)).to.include("[P:A] C7");
    expect(tuneBody(abcx)).to.include("[P:B] G7");
  });

  it("only shows the label on the bar that introduces the section, not on later repeats of its chord", () => {
    const abcx = importIrealLinkToAbcx(linkWithChordData("*AC7 | x | x |"));
    const occurrences = tuneBody(abcx).match(/\[P:A\]/g) ?? [];
    expect(occurrences).to.have.length(1);
  });
});
