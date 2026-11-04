import { ABCContext, AbcErrorReporter, Scanner, parse } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import { describe, it } from "mocha";
import { fromAst } from "../src/csTree/fromAst";
import { serializeCSTree } from "../src/runner/csTreeSerializer";
import { createSelection } from "../src/selection";
import { interleaveVoices } from "../src/transforms/interleaveVoices";

/** Interleaves the voices of the tune under a cursor, the way the language server does, and serializes the result. */
function interleave(abc: string, barsPerSystem: number, line = 0): { text: string; cursors: number } {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const result = interleaveVoices(createSelection(fromAst(ast, ctx)), [{ line, character: 0 }], barsPerSystem, ctx);
  return { text: serializeCSTree(result.root, ctx), cursors: result.cursors.length };
}

const HEADER = ["X:1", "V:1", "V:2", "M:4/4", "K:C"];
const body = (...lines: string[]): string => [...HEADER, ...lines, ""].join("\n");

describe("interleaveVoices", () => {
  describe("Example-based tests", () => {
    it("cuts every voice every N bars, and puts the pieces side by side, system by system", () => {
      const abc = body("[V:1] C | D | E | F | G | A |", "[V:2] c | d | e | f | g | a |");
      const { text } = interleave(abc, 2, 5);
      expect(text).to.equal(body("[V:1] C | D |", "[V:2] c | d |", "[V:1] E | F |", "[V:2] e | f |", "[V:1] G | A |", "[V:2] g | a |"));
    });

    it("gives the lines of a system the same number of bars, whatever the lines of the source were", () => {
      // Voice 1 is written in lines of 3 bars and voice 2 in lines of 2 bars.
      const abc = body("[V:1] C | D | E |", "[V:1] F | G | A |", "[V:2] c | d |", "[V:2] e | f |", "[V:2] g | a |");
      const { text } = interleave(abc, 3, 5);
      expect(text).to.equal(body("[V:1] C | D | E |", "[V:2] c | d | e |", "[V:1] F | G | A |", "[V:2] f | g | a |"));
    });

    it("stops writing a voice that has fewer bars, and keeps the last bars of the longer one", () => {
      const abc = body("[V:1] C | D | E | F | G |", "[V:2] c | d |");
      const { text } = interleave(abc, 2, 5);
      expect(text).to.equal(body("[V:1] C | D |", "[V:2] c | d |", "[V:1] E | F |", "[V:1] G |"));
    });

    it("keeps the voices in the order in which they first appear", () => {
      const abc = body("[V:2] c | d |", "[V:1] C | D |");
      const { text } = interleave(abc, 1, 5);
      expect(text).to.equal(body("[V:2] c |", "[V:1] C |", "[V:2] d |", "[V:1] D |"));
    });

    it("accepts voices that are declared with V: lines, and writes them with inline markers", () => {
      const abc = ["X:1", "V:1", "V:2", "K:C", "V:1", "C | D |", "V:2", "c | d |", ""].join("\n");
      const { text } = interleave(abc, 1, 4);
      expect(text).to.equal(["X:1", "V:1", "V:2", "K:C", "[V:1] C |", "[V:2] c |", "[V:1] D |", "[V:2] d |", ""].join("\n"));
    });

    it("reads a voice that is written in several blocks as one voice", () => {
      const abc = body("[V:1] C | D |", "[V:2] c | d |", "[V:1] E | F |", "[V:2] e | f |");
      const { text } = interleave(abc, 4, 5);
      expect(text).to.equal(body("[V:1] C | D | E | F |", "[V:2] c | d | e | f |"));
    });

    it("counts a bar line only when music comes before it, so that doubled bar lines and repeats do not count twice", () => {
      const abc = body("[V:1] |: C | D :| E || F |", "[V:2] c | d | e | f |");
      const { text } = interleave(abc, 2, 5);
      const lines = text.split("\n").filter((l) => l.startsWith("[V:"));
      expect(lines).to.have.length(4);
      expect(lines[0]).to.equal("[V:1] |: C | D :|");
      expect(lines[2]).to.equal("[V:1] E || F |");
    });

    it("keeps a P: line and a text directive before the system that holds the bar that they come before", () => {
      const abc = body("[V:1] C | D | E | F |", "[V:2] c | d | e | f |", "P:B", "%%text second part", "[V:1] G | A |", "[V:2] g | a |");
      const { text } = interleave(abc, 2, 5);
      expect(text.split("\n").slice(HEADER.length)).to.deep.equal([
        "[V:1] C | D |",
        "[V:2] c | d |",
        "[V:1] E | F |",
        "[V:2] e | f |",
        "P:B",
        "%%text second part",
        "[V:1] G | A |",
        "[V:2] g | a |",
        "",
      ]);
    });

    it("drops the empty comments that separate the systems, because the formatter writes its own", () => {
      const abc = body("[V:1] C | D |", "%", "[V:1] E | F |", "[V:2] c | d |", "%", "[V:2] e | f |");
      const { text } = interleave(abc, 2, 5);
      expect(text).to.not.contain("%");
      expect(text).to.equal(body("[V:1] C | D |", "[V:2] c | d |", "[V:1] E | F |", "[V:2] e | f |"));
    });

    it("puts the cursor on the first token of the first system, and reports no cursor when nothing changed", () => {
      expect(interleave(body("[V:1] C |", "[V:2] c |"), 1, 5).cursors).to.equal(1);
      expect(interleave("X:1\nK:C\nC | D |\n", 1, 2).cursors).to.equal(0);
    });
  });

  describe("Cases that are left as they are", () => {
    it("does not touch a tune of one voice", () => {
      const abc = "X:1\nK:C\nC | D | E | F |\n";
      expect(interleave(abc, 2, 2).text).to.equal(abc);
    });

    it("does not touch a tune that has lines of lyrics, which would have to move with their notes", () => {
      const abc = body("[V:1] C | D |", "w: one two", "[V:2] c | d |");
      expect(interleave(abc, 1, 5).text).to.equal(abc);
    });

    it("does not touch a tune that is in linear mode, where the voices are interleaved already", () => {
      const abc = ["%%abcls-parse linear", "X:1", "V:1", "V:2", "K:C", "[V:1] C | D |", "[V:2] c | d |", ""].join("\n");
      expect(interleave(abc, 1, 5).text).to.equal(abc);
    });

    it("does nothing for a number of bars that is not a whole number of at least 1", () => {
      const abc = body("[V:1] C | D |", "[V:2] c | d |");
      for (const invalid of [0, -2, 1.5, Number.NaN]) {
        expect(interleave(abc, invalid, 5).text).to.equal(abc);
      }
    });

    it("interleaves only the tune under the cursor", () => {
      const first = body("[V:1] C | D |", "[V:2] c | d |");
      const second = "X:2\nV:1\nV:2\nK:C\n[V:1] E | F |\n[V:2] e | f |\n";
      const { text } = interleave(first + "\n" + second, 1, 5);
      expect(text.endsWith("\n" + second)).to.equal(true);
      expect(text).to.not.equal(first + "\n" + second);
    });
  });

  describe("Property-based tests", () => {
    const note = fc.constantFrom("C", "D", "E", "F", "G", "A", "B");
    const bar = fc.array(note, { minLength: 1, maxLength: 3 }).map((notes) => notes.join(" "));
    const voiceBars = fc.array(bar, { minLength: 1, maxLength: 9 });
    const score = fc
      .record({
        voices: fc.array(voiceBars, { minLength: 2, maxLength: 3 }),
        blockSize: fc.integer({ min: 1, max: 4 }),
        barsPerSystem: fc.integer({ min: 1, max: 5 }),
      })
      .map(({ voices, blockSize, barsPerSystem }) => {
        const lines: string[] = [];
        voices.forEach((bars, index) => {
          for (let i = 0; i < bars.length; i += blockSize) {
            lines.push(`[V:${index + 1}] ${bars.slice(i, i + blockSize).join(" | ")} |`);
          }
        });
        const header = ["X:1", ...voices.map((_, i) => `V:${i + 1}`), "M:4/4", "K:C"];
        return { abc: [...header, ...lines, ""].join("\n"), voices, barsPerSystem, firstMusicLine: header.length };
      });

    /** Reads the lines of a text into the music of each voice, in order, without the markers, spaces and bar lines. */
    function musicByVoice(text: string): Map<string, string> {
      const music = new Map<string, string>();
      for (const line of text.split("\n")) {
        const match = /^\[V:(\w+)\] (.*)$/.exec(line);
        if (match) music.set(match[1], (music.get(match[1]) ?? "") + match[2].replace(/[\s|]/g, ""));
      }
      return music;
    }

    /** Groups the voice lines of a text into systems: a system ends when a voice comes back. */
    function systemsOf(text: string): Array<Map<string, string>> {
      const systems: Array<Map<string, string>> = [];
      let current = new Map<string, string>();
      for (const line of text.split("\n")) {
        const match = /^\[V:(\w+)\] (.*)$/.exec(line);
        if (!match) continue;
        if (current.has(match[1])) {
          systems.push(current);
          current = new Map();
        }
        current.set(match[1], match[2]);
      }
      if (current.size > 0) systems.push(current);
      return systems;
    }

    const barCount = (line: string): number => (line.match(/\|+/g) ?? []).length;

    it("property: every voice keeps its music, in order", () => {
      fc.assert(
        fc.property(score, ({ abc, barsPerSystem, firstMusicLine }) => {
          const { text } = interleave(abc, barsPerSystem, firstMusicLine);
          const before = musicByVoice(abc);
          const after = musicByVoice(text);
          return [...before.keys()].every((voice) => before.get(voice) === after.get(voice));
        })
      );
    });

    it("property: every line of a voice has exactly N bars, except the last line of that voice", () => {
      fc.assert(
        fc.property(score, ({ abc, barsPerSystem, firstMusicLine }) => {
          const systems = systemsOf(interleave(abc, barsPerSystem, firstMusicLine).text);
          return systems.every((system, index) =>
            [...system.entries()].every(([voice, line]) => {
              const comesBackLater = systems.slice(index + 1).some((later) => later.has(voice));
              return comesBackLater ? barCount(line) === barsPerSystem : barCount(line) <= barsPerSystem;
            })
          );
        })
      );
    });

    it("property: the number of systems is the number of bars of the longest voice divided by N, rounded up", () => {
      fc.assert(
        fc.property(score, ({ abc, voices, barsPerSystem, firstMusicLine }) => {
          const systems = systemsOf(interleave(abc, barsPerSystem, firstMusicLine).text);
          return systems.length === Math.ceil(Math.max(...voices.map((bars) => bars.length)) / barsPerSystem);
        })
      );
    });

    it("property: interleaving the result again with the same N changes nothing", () => {
      fc.assert(
        fc.property(score, ({ abc, barsPerSystem, firstMusicLine }) => {
          const once = interleave(abc, barsPerSystem, firstMusicLine).text;
          return interleave(once, barsPerSystem, firstMusicLine).text === once;
        })
      );
    });
  });
});
