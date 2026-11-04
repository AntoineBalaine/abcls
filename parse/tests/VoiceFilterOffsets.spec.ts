import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { filteredOffsetToOriginal, originalRangeToFiltered, applyDeletions } from "../Visitors/OffsetDeletionMap";
import { filterVoicesInAbcWithDeletions } from "../Visitors/VoiceFilterVisitor";

function filter(source: string) {
  return filterVoicesInAbcWithDeletions(source, new ABCContext(new AbcErrorReporter()));
}

/** Because the tune stops at a blank line in ABC, the lines of the filtered text must not contain one before the end. */
function hasBlankLineInside(text: string): boolean {
  const lines = text.split("\n");
  return lines.slice(0, -1).some((line) => line.trim() === "");
}

const ALWAYS_WITH_ME = [
  "%%abcls-voices show C 1 2",
  "X:1",
  "T:Always With Me",
  "%%score ( C 1 ) | ( 2 5 6 ) | ( 6b 5b )",
  'V:C name="Chords"',
  "V:1",
  "V:2",
  "V:5",
  "V:6",
  "V:6b clef=bass",
  "V:5b clef=bass",
  "L:1/8",
  "M:3/4",
  "K:E",
  '[V:C] "E" x6 | "E" x6 |',
  "[V:1]     z6  |     z6  |",
  "[V:2]     X   |     X   |",
  "[V:5]     X   |     X   |",
  "[V:6]     X   |     X   |",
  "[V:6b] z2 [B,E]2 [EG]2 | z2 [B,E]2 [EG]2 |",
  "[V:5b]  E,6 |  E,6 |",
].join("\n");

describe("filterVoicesInAbcWithDeletions", () => {
  describe("Example-based tests", () => {
    it("removes the directive, the declarations, the lines of the hidden voices, and the hidden voices of the %%score line", () => {
      const { text } = filter(ALWAYS_WITH_ME);
      expect(text).to.equal(
        [
          "X:1",
          "T:Always With Me",
          "%%score ( C 1 ) | ( 2 )",
          'V:C name="Chords"',
          "V:1",
          "V:2",
          "L:1/8",
          "M:3/4",
          "K:E",
          '[V:C] "E" x6 | "E" x6 |',
          "[V:1]     z6  |     z6  |",
          "[V:2]     X   |     X   |",
        ].join("\n")
      );
    });

    it("never prints the text again, so the text is the original one with spans cut out", () => {
      const { text, deletions } = filter(ALWAYS_WITH_ME);
      expect(applyDeletions(ALWAYS_WITH_ME, deletions)).to.equal(text);
    });

    it("maps a click on a note of a shown voice to the same note in the original text", () => {
      const { text, deletions } = filter(ALWAYS_WITH_ME);
      const clickedAt = text.indexOf("z6");
      const originalAt = filteredOffsetToOriginal(clickedAt, deletions);
      expect(originalAt).to.equal(ALWAYS_WITH_ME.indexOf("z6"));
      expect(ALWAYS_WITH_ME.slice(originalAt, originalAt + 2)).to.equal("z6");
    });

    it("maps a click on the last note of the last shown line to the original text, past the deleted lines above it", () => {
      const { text, deletions } = filter(ALWAYS_WITH_ME);
      const clickedAt = text.lastIndexOf("X");
      expect(ALWAYS_WITH_ME[filteredOffsetToOriginal(clickedAt, deletions)]).to.equal("X");
      const lastShownLine = "[V:2]     X   |     X   |";
      expect(filteredOffsetToOriginal(clickedAt, deletions)).to.equal(ALWAYS_WITH_ME.indexOf(lastShownLine) + lastShownLine.lastIndexOf("X"));
    });

    it("shows nothing in the preview for a cursor that is inside a hidden voice", () => {
      const { deletions } = filter(ALWAYS_WITH_ME);
      const insideHiddenVoice = ALWAYS_WITH_ME.indexOf("E,6");
      expect(originalRangeToFiltered(insideHiddenVoice, insideHiddenVoice, deletions)).to.equal(null);
      expect(originalRangeToFiltered(insideHiddenVoice, insideHiddenVoice + 3, deletions)).to.equal(null);
    });

    it("maps a selection of a shown voice to the position of the same notes in the filtered text", () => {
      const { text, deletions } = filter(ALWAYS_WITH_ME);
      const start = ALWAYS_WITH_ME.indexOf("z6");
      const mapped = originalRangeToFiltered(start, start + 2, deletions);
      expect(mapped).to.not.equal(null);
      expect(text.slice(mapped!.start, mapped!.end)).to.equal("z6");
    });

    it("leaves no blank line inside the tune, because a blank line ends a tune", () => {
      expect(hasBlankLineInside(filter(ALWAYS_WITH_ME).text)).to.equal(false);
    });

    it("removes only the hidden part of a line that switches voices in the middle", () => {
      const source = ["%%abcls-voices show 1", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF | [V:2] GABc | [V:1] cBAG |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "[V:1] CDEF | [V:1] cBAG |"].join("\n"));
    });

    it("removes a chord of a hidden voice with its brackets", () => {
      const source = ["%%abcls-voices show 1", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF |", "[V:2] [CEG]2 [DFA]2 |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "[V:1] CDEF |"].join("\n"));
    });

    it("removes a hidden voice that is the last line, which has no newline after it", () => {
      const source = ["%%abcls-voices show 1", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF |", "[V:2] GABc |"].join("\n");
      const { text } = filter(source);
      expect(text.endsWith("\n")).to.equal(false);
      expect(text.split("\n").pop()).to.equal("[V:1] CDEF |");
    });

    it("removes the lines of a hidden voice that is declared with a V: line, and keeps the next shown voice", () => {
      const source = ["%%abcls-voices show 2", "X:1", "V:1", "V:2", "K:C", "V:1", "CDEF |", "GABc |", "V:2", "cBAG |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:2", "K:C", "V:2", "cBAG |"].join("\n"));
    });

    it("supports the hide mode", () => {
      const source = ["%%abcls-voices hide 2", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF |", "[V:2] GABc |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "[V:1] CDEF |"].join("\n"));
    });

    it("keeps the P: lines, even when they follow the lines of a hidden voice", () => {
      const source = ["%%abcls-voices show 1", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF |", "[V:2] GABc |", "P:B", "[V:1] cBAG |", "[V:2] FEDC |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "[V:1] CDEF |", "P:B", "[V:1] cBAG |"].join("\n"));
    });

    it("keeps the %%text, %%center and %%begintext directives, even when they follow the lines of a hidden voice", () => {
      const source = [
        "%%abcls-voices show 1",
        "X:1",
        "V:1",
        "V:2",
        "K:C",
        "[V:1] CDEF |",
        "[V:2] GABc |",
        "%%text A free text line",
        "[V:2] FEDC |",
        "%%center Centered",
        "[V:2] CDEF |",
        "%%begintext",
        "two lines",
        "of text",
        "%%endtext",
        "[V:1] cBAG |",
      ].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(
        [
          "X:1",
          "V:1",
          "K:C",
          "[V:1] CDEF |",
          "%%text A free text line",
          "%%center Centered",
          "%%begintext",
          "two lines",
          "of text",
          "%%endtext",
          "[V:1] cBAG |",
        ].join("\n")
      );
    });

    it("keeps a P: line that is the last line of the text, and removes the lines of a hidden voice before it", () => {
      const source = ["%%abcls-voices show 1", "X:1", "V:1", "V:2", "K:C", "[V:1] CDEF |", "[V:2] GABc |", "P:End"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "[V:1] CDEF |", "P:End"].join("\n"));
    });

    it("keeps the score-level lines in the hide mode too", () => {
      const source = ["%%abcls-voices hide 2", "X:1", "V:1", "V:2", "K:C", "[V:2] GABc |", "P:B", "%%text A free text line", "[V:1] CDEF |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:1", "K:C", "P:B", "%%text A free text line", "[V:1] CDEF |"].join("\n"));
    });

    it("shows a voice whose id starts with a digit and ends with a letter, such as 6b", () => {
      const source = ["%%abcls-voices show 6b", "X:1", "V:5b", "V:6b", "K:C", "[V:5b] CDEF |", "[V:6b] GABc |"].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "V:6b", "K:C", "[V:6b] GABc |"].join("\n"));
    });

    it("takes the hidden voices out of the %%score line, so that the first staff still has a voice", () => {
      const source = [
        "%%abcls-voices show 5",
        "X:1",
        "%%score ( 1 2 ) | ( 5 6 ) | ( 5b 6b )",
        "V:1",
        "V:2",
        "V:5",
        "V:6",
        "V:5b",
        "V:6b",
        "K:C",
        "[V:1] CDEF |",
        "[V:5] GABc |",
        "",
      ].join("\n");
      const { text } = filter(source);
      expect(text).to.equal(["X:1", "%%score ( 5 )", "V:5", "K:C", "[V:5] GABc |", ""].join("\n"));
    });

    it("takes the whole %%score line out when no voice stays, and keeps the voices that are shown in a group with others", () => {
      const none = ["%%abcls-voices show 9", "X:1", "%%score ( 1 2 ) | 3", "V:1", "K:C", "[V:1] C |", ""].join("\n");
      expect(filter(none).text).to.equal(["X:1", "K:C", ""].join("\n"));

      const some = ["%%abcls-voices hide 2", "X:1", "%%staves { ( 1 2 ) | 3 }", "V:1", "V:2", "V:3", "K:C", "[V:1] C |", ""].join("\n");
      expect(filter(some).text).to.equal(["X:1", "%%staves { ( 1 ) | 3 }", "V:1", "V:3", "K:C", "[V:1] C |", ""].join("\n"));
    });

    it("follows the filter of the file for a %%score line of the file header", () => {
      const source = ["%%abcls-voices show 1", "%%score ( 1 2 ) | 3", "", "X:1", "V:1", "V:2", "K:C", "[V:1] C |", ""].join("\n");
      expect(filter(source).text).to.contain("%%score ( 1 )");
    });

    it("leaves a %%score line without trailing spaces, and the other lines untouched", () => {
      const source = ["%%abcls-voices show 5", "X:1", "T:Title", "%%score ( 1 2 ) | ( 5 6 ) | ( 5b 6b )", "V:5", "K:C", "[V:5] GABc |", ""].join("\n");
      const lines = filter(source).text.split("\n");
      expect(lines).to.deep.equal(["X:1", "T:Title", "%%score ( 5 )", "V:5", "K:C", "[V:5] GABc |", ""]);
      expect(lines.some((l) => l.endsWith(" "))).to.equal(false);
    });

    it("leaves a text without directive as it is, with no deletion", () => {
      const source = ["X:1", "V:1", "K:C", "[V:1] CDEF |"].join("\n");
      const { text, deletions } = filter(source);
      expect(text).to.equal(source);
      expect(deletions).to.deep.equal([]);
    });

    it("keeps the offsets of the lines that come before the first deletion", () => {
      const { text, deletions } = filter(ALWAYS_WITH_ME);
      const at = text.indexOf("T:Always");
      expect(filteredOffsetToOriginal(at, deletions)).to.equal(ALWAYS_WITH_ME.indexOf("T:Always"));
    });
  });

  describe("Property-based tests", () => {
    interface GeneratedScore {
      source: string;
      mode: "show" | "hide";
      listed: string[];
      shown: string[];
      scoreLevelLines: string[];
    }

    const ALL_VOICES = ["1", "2", "3", "C"];
    const musicLine = fc.constantFrom("CDEF |", "z6 |", "[CEG]2 [DFA]2 |", "GABc | cBAG |", "X |", "x6 |");

    const generatedScore: fc.Arbitrary<GeneratedScore> = fc
      .record({
        mode: fc.constantFrom<"show" | "hide">("show", "hide"),
        listed: fc.subarray(ALL_VOICES, { minLength: 1, maxLength: 3 }),
        style: fc.constantFrom("inline", "info-line"),
        systems: fc.array(fc.array(fc.tuple(fc.constantFrom(...ALL_VOICES), musicLine), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
        directiveAtTop: fc.boolean(),
        scoreLevel: fc.array(fc.tuple(fc.nat({ max: 20 }), fc.constantFrom("P:A", "P:Coda", "%%text some words", "%%center a title")), { maxLength: 3 }),
      })
      .map(({ mode, listed, style, systems, directiveAtTop, scoreLevel }) => {
        const directive = `%%abcls-voices ${mode} ${listed.join(" ")}`;
        const body = systems.flatMap((system) => system.map(([id, music]) => (style === "inline" ? `[V:${id}] ${music}` : `V:${id}\n${music}`)));
        // Because the lines of the info-line style hold a voice line and its music, the score-level lines go between the entries of the body.
        const entries = [...body];
        for (const [at, line] of scoreLevel) {
          entries.splice(Math.min(at, entries.length), 0, line);
        }
        const lines = [
          ...(directiveAtTop ? [directive] : []),
          "X:1",
          ...(directiveAtTop ? [] : [directive]),
          ...ALL_VOICES.map((id) => `V:${id}`),
          "K:C",
          ...entries,
        ];
        const shown = ALL_VOICES.filter((id) => (mode === "show" ? listed.includes(id) : !listed.includes(id)));
        return { source: lines.join("\n"), mode, listed, shown, scoreLevelLines: scoreLevel.map(([, line]) => line) };
      });

    it("property: the filtered text is the original text with the deletions cut out", () => {
      fc.assert(
        fc.property(generatedScore, ({ source }) => {
          const { text, deletions } = filter(source);
          return applyDeletions(source, deletions) === text;
        })
      );
    });

    it("property: every character of the filtered text is the character that its converted offset points at in the original text", () => {
      fc.assert(
        fc.property(generatedScore, ({ source }) => {
          const { text, deletions } = filter(source);
          for (let i = 0; i < text.length; i++) {
            if (source[filteredOffsetToOriginal(i, deletions)] !== text[i]) return false;
          }
          return true;
        })
      );
    });

    it("property: only the voices that are shown are still declared or used in the filtered text", () => {
      fc.assert(
        fc.property(generatedScore, ({ source, shown }) => {
          const { text } = filter(source);
          const used = [...text.matchAll(/^\[?V:(\w+)/gm)].map((m) => m[1]);
          return used.every((id) => shown.includes(id));
        })
      );
    });

    it("property: every P: line and text directive of the score is kept", () => {
      fc.assert(
        fc.property(generatedScore, ({ source, scoreLevelLines }) => {
          const { text } = filter(source);
          const kept = text.split("\n").filter((line) => line.startsWith("P:") || line.startsWith("%%text") || line.startsWith("%%center"));
          return [...kept].sort().join("|") === [...scoreLevelLines].sort().join("|");
        })
      );
    });

    it("property: the directive is removed, and no blank line is left inside the tune", () => {
      fc.assert(
        fc.property(generatedScore, ({ source }) => {
          const { text } = filter(source);
          return !text.includes("abcls-voices") && !hasBlankLineInside(text);
        })
      );
    });

    it("property: an original offset that is visible comes back to itself through the filtered text", () => {
      fc.assert(
        fc.property(generatedScore, ({ source }) => {
          const { deletions } = filter(source);
          for (let o = 0; o < source.length; o++) {
            const mapped = originalRangeToFiltered(o, o + 1, deletions);
            if (mapped !== null && filteredOffsetToOriginal(mapped.start, deletions) !== o) return false;
          }
          return true;
        })
      );
    });
  });
});
