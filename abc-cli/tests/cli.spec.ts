import { execFileSync, spawnSync } from "child_process";
import * as path from "path";
import { expect } from "chai";
import { clipRangesToLines, coerceArgs, parseLineRange } from "../commands/transform";

/**
 * The CLI bundle that `npm test` builds with esbuild before the specs run.
 * The end-to-end specs run it the way a user does, so that they also cover the argument parsing of commander.
 */
const CLI = path.join(__dirname, "..", "dist", "abcls.js");
const CHORDS = path.join(__dirname, "chords.abc");
const LINES = path.join(__dirname, "lines.abc");

/** Runs the CLI and returns its standard output. Throws when the command fails. */
function runCli(args: string[]): string {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

/** Runs a CLI command that must fail, and returns its error output. */
function failingCliErrors(args: string[]): string {
  const result = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  expect(result.status, `"abcls ${args.join(" ")}" should fail`).to.not.equal(0);
  return result.stderr;
}

/** Returns the lines 5 to 7 of a text (the music lines of tests/lines.abc), joined by spaces. */
function musicLinesOf(text: string): string {
  return text.split("\n").slice(4, 7).join(" ");
}

const END_OF_LINE = Number.MAX_SAFE_INTEGER;

describe("abcls CLI", () => {
  describe("parseLineRange", () => {
    it("reads a single line as the whole line", () => {
      expect(parseLineRange("10")).to.deep.equal({ start: { line: 9, character: 0 }, end: { line: 9, character: END_OF_LINE } });
    });

    it("reads a range of lines as whole lines", () => {
      expect(parseLineRange("10-20")).to.deep.equal({ start: { line: 9, character: 0 }, end: { line: 19, character: END_OF_LINE } });
    });

    it("reads line:column positions, with 1-indexed columns and the end column included", () => {
      expect(parseLineRange("10:5-12:20")).to.deep.equal({ start: { line: 9, character: 4 }, end: { line: 11, character: 20 } });
    });

    it("reads a single line:column position as one character", () => {
      expect(parseLineRange("6:5")).to.deep.equal({ start: { line: 5, character: 4 }, end: { line: 5, character: 5 } });
    });

    it("lets one end give a column and the other not", () => {
      expect(parseLineRange("6:3-7")).to.deep.equal({ start: { line: 5, character: 2 }, end: { line: 6, character: END_OF_LINE } });
    });

    for (const text of ["0", "6:0", "6:4-6:3", "7-6", "abc", "6:", "-6"]) {
      it(`refuses "${text}"`, () => {
        expect(() => parseLineRange(text)).to.throw(/Invalid line range/);
      });
    }
  });

  describe("clipRangesToLines", () => {
    it("cuts each range down to the part inside the line range, and drops the ranges outside it", () => {
      const ranges = [
        { start: { line: 0, character: 0 }, end: { line: 3, character: 5 } },
        { start: { line: 8, character: 0 }, end: { line: 9, character: 0 } },
      ];
      const lineRange = { start: { line: 2, character: 0 }, end: { line: 5, character: END_OF_LINE } };
      expect(clipRangesToLines(ranges, lineRange)).to.deep.equal([{ start: { line: 2, character: 0 }, end: { line: 3, character: 5 } }]);
    });
  });

  describe("coerceArgs", () => {
    it("reads integers and the word null", () => {
      expect(coerceArgs("harmonizeVoicing", ["close", "4", "null"])).to.deep.equal(["close", 4, null]);
    });

    it("reads n/d as a rational for the rhythm transforms only", () => {
      expect(coerceArgs("setRhythm", ["1/2"])).to.deep.equal([{ numerator: 1, denominator: 2 }]);
      expect(coerceArgs("transpose", ["1/2"])).to.deep.equal(["1/2"]);
    });

    it("keeps the voice id of addVoice as a string, and reads its key=value parameters", () => {
      expect(coerceArgs("addVoice", ["2", "name=Alto,transpose=-3"])).to.deep.equal(["2", { name: "Alto", transpose: -3 }]);
    });
  });

  describe("commands, run from the built bundle", () => {
    it("prints its help", () => {
      expect(runCli(["--help"])).to.include("Usage");
    });

    it("transposes a whole file", () => {
      expect(runCli(["transform", CHORDS, "transpose", "--", "-2"])).to.include("[V:1]");
    });

    it("harmonizes the chord symbols of voice 1 into four new voices", () => {
      expect(runCli(["harmonize", CHORDS, "--chords-from", "1", "--into", "3,4,5,6"])).to.match(/^\[V:6\]/m);
    });

    it("harmonizes into six voices with a spread voicing and lead preferences", () => {
      const output = runCli([
        "harmonize",
        CHORDS,
        "--chords-from",
        "1",
        "--into",
        "3,4,5,6,7,8",
        "--voicing",
        "spread",
        "--top-note",
        "voicing",
        "--prefer-lead",
        "guide-tones,tensions",
      ]);
      expect(output).to.match(/^\[V:8\]/m);
    });

    it("refuses an unknown --top-note value", () => {
      expect(failingCliErrors(["harmonize", CHORDS, "--chords-from", "1", "--into", "3,4,5,6", "--top-note", "highest"])).to.include(
        "--top-note must be nearest or voicing"
      );
    });

    it("fails when --voice names a voice that the file does not have", () => {
      expect(failingCliErrors(["transform", CHORDS, "transpose", "2", "--voice", "9"])).to.include('Voice "9" not found');
    });

    it("transposes only the line that --lines gives", () => {
      expect(musicLinesOf(runCli(["transform", LINES, "transpose", "2", "--voice", "1", "--lines", "6"]))).to.equal("C D E F| D E ^F G| C D E F|");
    });

    it("transposes only the text between the line:column positions that --lines gives", () => {
      expect(musicLinesOf(runCli(["transform", LINES, "transpose", "2", "--voice", "1", "--lines", "6:3-7:3"]))).to.equal("C D E F| C E ^F G| D E E F|");
    });

    it("fails on an invalid --lines range", () => {
      expect(failingCliErrors(["transform", LINES, "transpose", "2", "--lines", "6:4-6:3"])).to.include('Invalid line range "6:4-6:3"');
    });
  });
});
