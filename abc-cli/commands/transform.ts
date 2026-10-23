/**
 * Transform command: Run an editor transform on an ABC file, without a language server
 */

import { createRational, Range } from "abcls-parser";
import { rangesOfVoices, runTransform, TransformError } from "abcls-editor";
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
 * Converts a "from-to" pair of 1-indexed line numbers into a range that covers those lines.
 */
export function parseLineRange(text: string): Range {
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (match === null) {
    throw new TransformError(`Invalid line range "${text}": we expect "10" or "10-20".`);
  }
  const first = parseInt(match[1], 10) - 1;
  const last = (match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10)) - 1;
  if (first < 0 || last < first) {
    throw new TransformError(`Invalid line range "${text}": lines count from 1, and the end cannot come before the start.`);
  }
  return { start: { line: first, character: 0 }, end: { line: last, character: Number.MAX_SAFE_INTEGER } };
}

export const transformCommand = new Command("transform")
  .description("Run an editor transform (harmonizeVoicing, explode, addVoice, transpose, ...) on an ABC file")
  .argument("<file>", "ABC file to transform")
  .argument("<name>", "Name of the transform")
  .argument("[args...]", "Arguments of the transform, e.g. close 4 null for harmonizeVoicing")
  .option("--voice <ids>", "Only transform the music of these voices (comma-separated ids)")
  .option("--lines <range>", "Only transform these lines (1-indexed, e.g. 10-20)")
  .option("-w, --write", "Write the result back to the file")
  .addHelpText("after", "\nBecause a negative number looks like an option, write it after \"--\": abcls transform file.abc transpose -- -2")
  .action((file: string, name: string, args: string[], options: { voice?: string; lines?: string; write?: boolean }) => {
    const source = readAbcFile(file);

    try {
      let ranges: Range[] | null = null;
      if (options.voice !== undefined) {
        ranges = rangesOfVoices(source, options.voice);
      }
      if (options.lines !== undefined) {
        const lineRange = parseLineRange(options.lines);
        ranges = ranges === null ? [lineRange] : ranges.filter((r) => r.end.line >= lineRange.start.line && r.start.line <= lineRange.end.line);
      }

      const result = runTransform({ source, transform: name, args: coerceArgs(name, args), ranges });

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
  });
