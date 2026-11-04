/**
 * Transform command: Run an editor transform on an ABC file, without a language server
 */

import { rangesOfVoices, runTransform } from "abcls-editor";
import { createRational, Range } from "abcls-parser";
import { Command } from "commander";
import { readAbcFile, writeFile } from "../utils/shared";

/**
 * The transforms whose rational arguments are written as "n/d" on the command line.
 */
const RATIONAL_ARG_TRANSFORMS = new Set(["setRhythm", "addToRhythm"]);

/**
 * The transforms whose first argument is a voice id. Because voice ids are often numbers ("2"),
 * we keep that argument as a string instead of reading it as a number.
 */
const VOICE_ID_FIRST_ARG_TRANSFORMS = new Set(["addVoice", "insertVoiceLine"]);

/**
 * Converts the strings of the command line into the values that the transforms expect.
 * Because the command line only has strings, we recognize integers, "n/d" rationals (for the rhythm transforms),
 * the word "null", and the "key=value,key=value" lists of the addVoice parameters.
 */
export function coerceArgs(transform: string, rawArgs: string[]): unknown[] {
  return rawArgs.map((raw, index) => {
    if (raw === "null") return null;
    if (index === 0 && VOICE_ID_FIRST_ARG_TRANSFORMS.has(transform)) return raw;
    if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
    const rational = /^(-?\d+)\/(\d+)$/.exec(raw);
    if (rational !== null && RATIONAL_ARG_TRANSFORMS.has(transform)) {
      return createRational(parseInt(rational[1], 10), parseInt(rational[2], 10));
    }
    if (transform === "addVoice" && index === 1) {
      const params: Record<string, string | number> = {};
      for (const pair of raw.split(",")) {
        // Because a value may hold an "=" itself, we split at the first one only.
        const separator = pair.indexOf("=");
        const key = separator < 0 ? pair : pair.slice(0, separator);
        const value = separator < 0 ? "" : pair.slice(separator + 1);
        params[key] = key === "transpose" ? parseInt(value, 10) : value;
      }
      return params;
    }
    return raw;
  });
}

/**
 * Gives the name of the transform that re-bars, for the --rebar flag.
 * Because only a multiplication or a division of the rhythm changes how many bars the music takes, no other transform has a re-barring version.
 */
export function rebarTransformName(name: string): string {
  if (name === "multiplyRhythm") return "multiplyRhythmRebar";
  if (name === "divideRhythm") return "divideRhythmRebar";
  throw new Error('The --rebar flag only applies to the "multiplyRhythm" and "divideRhythm" transforms.');
}

/**
 * Converts a "from-to" pair of 1-indexed positions into a range. Each position is a line ("10"), which covers the whole
 * line, or a line and a column ("10:5"), where columns also count from 1 and the end column is included.
 * So "10-20" covers lines 10 to 20, and "10:5-12:20" goes from the 5th character of line 10 to the 20th of line 12.
 * A single position ("10" or "10:5") is both the start and the end.
 */
export function parseLineRange(text: string): Range {
  const match = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(text);
  if (match === null) {
    throw new Error(`Invalid line range "${text}": we expect "10", "10-20" or "10:5-12:20".`);
  }
  const [, firstLine, firstColumn, lastLineText, lastColumnText] = match;
  const lastLine = lastLineText ?? firstLine;
  const lastColumn = lastLineText === undefined ? firstColumn : lastColumnText;
  const start = { line: parseInt(firstLine, 10) - 1, character: firstColumn === undefined ? 0 : parseInt(firstColumn, 10) - 1 };
  const end = { line: parseInt(lastLine, 10) - 1, character: lastColumn === undefined ? Number.MAX_SAFE_INTEGER : parseInt(lastColumn, 10) };
  if (start.line < 0 || start.character < 0 || end.character < 1 || !isBefore(start, end)) {
    throw new Error(`Invalid line range "${text}": lines and columns count from 1, and the end cannot come before the start.`);
  }
  return { start, end };
}

/** A tune of a file, with the line where it starts. */
interface TuneBlock {
  startLine: number;
  number: number;
  text: string;
}

/**
 * Splits a file into its header (everything before the first X: line) and its tunes.
 * Because a tune runs from its X: line to the next one, we split at the lines that start with "X:".
 */
export function splitTunes(source: string): { header: string; tunes: TuneBlock[] } {
  const lines = source.split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (/^X:/.test(line)) starts.push(index);
  });
  const header = lines.slice(0, starts.length > 0 ? starts[0] : lines.length).join("\n");
  const tunes = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    return { startLine: start, number: parseInt(lines[start].slice(2), 10), text: lines.slice(start, end).join("\n") };
  });
  return { header, tunes };
}

/** The copy of a tune that --as-new-tune transforms, and the line of the file where the original starts. */
export interface TuneCopy {
  text: string;
  lineOffset: number;
}

/**
 * Builds the copy of a tune that --as-new-tune transforms.
 * The copy gets the next free X: number, and its title gets the label in parentheses, so it is easy to tell apart.
 * Because the transform must see the copy as it will be written, the copy is renumbered and retitled before it is transformed.
 */
export function copyTune(source: string, label: string, tuneNumber: string | undefined): TuneCopy {
  const { tunes } = splitTunes(source);
  if (tunes.length === 0) {
    throw new Error("The file has no tune (no X: line) to copy.");
  }
  const original = tuneNumber === undefined ? tunes[0] : tunes.find((tune) => tune.number === parseInt(tuneNumber, 10));
  if (original === undefined) {
    throw new Error(`Tune ${tuneNumber} not found in the file.`);
  }

  const nextNumber = Math.max(...tunes.map((tune) => (Number.isFinite(tune.number) ? tune.number : 0))) + 1;
  let copy = original.text.replace(/\s+$/, "").replace(/^X:.*$/m, `X:${nextNumber}`);
  copy = copy.replace(/^T:(.*?)\s*$/m, (_match, title: string) => `T:${title.trim()} (${label})`);
  return { text: copy, lineOffset: original.startLine };
}

/**
 * Appends a transformed copy of a tune to the file, after a blank line.
 */
export function appendTune(source: string, tuneText: string): string {
  return `${source.replace(/\s+$/, "")}\n\n${tuneText.replace(/\s+$/, "")}\n`;
}

/**
 * Returns whether the position a comes before the position b.
 */
function isBefore(a: Range["start"], b: Range["start"]): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/**
 * Keeps the part of each range that lies inside the line range.
 * Because a voice range may span many lines, keeping every range that only touches the line range would transform
 * the lines of the voice outside it, so each range is cut down to the lines that were asked for.
 */
export function clipRangesToLines(ranges: Range[], lineRange: Range): Range[] {
  const clipped: Range[] = [];
  for (const range of ranges) {
    const start = isBefore(range.start, lineRange.start) ? lineRange.start : range.start;
    const end = isBefore(lineRange.end, range.end) ? lineRange.end : range.end;
    if (isBefore(end, start)) continue;
    clipped.push({ start: { ...start }, end: { ...end } });
  }
  return clipped;
}

/**
 * Computes the ranges that --voice and --lines select in a text.
 * Because the copy of --as-new-tune starts at line 0 while --lines counts the lines of the file, the line range is
 * shifted by `lineOffset`, the line where the copied tune starts in the file.
 *
 * @returns The ranges, or null when neither option is given (the whole text is selected)
 */
export function selectedRanges(text: string, voice: string | undefined, lines: string | undefined, lineOffset: number): Range[] | null {
  let ranges: Range[] | null = null;
  if (voice !== undefined) {
    const voiceRanges = rangesOfVoices(text, voice);
    if (!voiceRanges.ok) throw new Error(voiceRanges.error);
    ranges = voiceRanges.value;
  }
  if (lines !== undefined) {
    const lineRange = parseLineRange(lines);
    // The columns are kept, except when the range starts before the copied tune: it then starts at the top of the tune.
    const startLine = lineRange.start.line - lineOffset;
    const shifted: Range = {
      start: startLine < 0 ? { line: 0, character: 0 } : { line: startLine, character: lineRange.start.character },
      end: { line: lineRange.end.line - lineOffset, character: lineRange.end.character },
    };
    ranges = ranges === null ? [shifted] : clipRangesToLines(ranges, shifted);
  }
  return ranges;
}

export const transformCommand = new Command("transform")
  .description("Run an editor transform (harmonizeVoicing, explode, addVoice, transpose, ...) on an ABC file")
  .argument("<file>", "ABC file to transform")
  .argument("<name>", "Name of the transform")
  .argument("[args...]", "Arguments of the transform, e.g. close 4 null for harmonizeVoicing")
  .option("--voice <ids>", "Only transform the music of these voices (comma-separated ids)")
  .option("--lines <range>", "Only transform these lines, or this text range (1-indexed, e.g. 10-20 or 10:5-12:20)")
  .option("--keys", "With transpose, also transpose the key signatures (the K: fields) so they follow the notes")
  .option("--chords", "With transpose, also transpose the chord symbols")
  .option(
    "--rebar",
    "With multiplyRhythm or divideRhythm, also re-bar: multiplying cuts each bar into bars of the meter's length (with ties), dividing merges the bars again"
  )
  .option("--as-new-tune <label>", 'Apply the transform to a copy of the tune, and append that copy to the file as a new tune titled "<title> (<label>)"')
  .option("--tune <number>", "With --as-new-tune, the X: number of the tune to copy (default: the first tune)")
  .option("-w, --write", "Write the result back to the file")
  .addHelpText("after", '\nBecause a negative number looks like an option, write it after "--": abcls transform file.abc transpose -- -2')
  .action(
    (
      file: string,
      name: string,
      args: string[],
      options: { voice?: string; lines?: string; write?: boolean; keys?: boolean; chords?: boolean; rebar?: boolean; asNewTune?: string; tune?: string }
    ) => {
      const source = readAbcFile(file);

      try {
        const transformArgs = coerceArgs(name, args);
        if (options.keys || options.chords) {
          if (name !== "transpose") {
            throw new Error('The --keys and --chords flags only apply to the "transpose" transform.');
          }
          // Because the transform reads its options by position, the keys flag always comes before the chords flag.
          transformArgs.push(options.keys === true, options.chords === true);
        }

        // Because --as-new-tune transforms a copy of one tune, the ranges are computed on that copy rather than on the file.
        const copy = options.asNewTune !== undefined ? copyTune(source, options.asNewTune, options.tune) : null;
        const target = copy === null ? source : copy.text;
        const ranges = selectedRanges(target, options.voice, options.lines, copy === null ? 0 : copy.lineOffset);
        const transformName = options.rebar ? rebarTransformName(name) : name;
        const transformed = runTransform({ source: target, transform: transformName, args: transformArgs, ranges });
        if (!transformed.ok) throw new Error(transformed.error);
        const result = copy === null ? transformed.value : appendTune(source, transformed.value);

        if (options.write) {
          writeFile(file, result);
          console.log(`Transformed ${file}`);
        } else {
          process.stdout.write(result);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Transform failed: ${message}`);
        process.exit(1);
      }
    }
  );
