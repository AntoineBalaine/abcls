import { Range } from "abcls-parser";
import { VoicingType } from "../transforms/harmonize";
import { fail, runTransform, RunnerResult, succeed } from "./runTransform";

export interface HarmonizeVoicesOptions {
  /** The id of the voice that carries the melody to harmonize. */
  from: string;
  /** The ids of the new voices, from the highest harmony part to the lowest. */
  into: string[];
  /** The voicing that the first pass builds. The leads that are not chord tones then get a cluster voicing. */
  voicing: VoicingType;
}

/**
 * The id of the temporary voice that holds the chords before they are split into parts.
 */
export const WORK_VOICE_ID = "HARMONIZE_WORK";

/**
 * Returns the index of every line that is written in the given voice with an inline marker, such as "[V:2] ...".
 */
export function findVoiceLines(lines: string[], voiceId: string): number[] {
  const marker = `[V:${voiceId}]`;
  const found: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith(marker)) found.push(index);
  }
  return found;
}

export function rangesOfLines(lineIndexes: number[]): Range[] {
  return lineIndexes.map((line) => ({ start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } }));
}

/**
 * Copies every line of the source voice into the work voice, right below the original line.
 * It returns the new text and the indexes of the work lines in that text.
 */
export function copyVoiceLines(lines: string[], from: string): { lines: string[]; workLines: number[] } {
  const marker = `[V:${from}]`;
  const result: string[] = [];
  const workLines: number[] = [];
  for (const line of lines) {
    result.push(line);
    if (line.startsWith(marker)) {
      workLines.push(result.length);
      result.push(`[V:${WORK_VOICE_ID}]${line.slice(marker.length)}`);
    }
  }
  return { lines: result, workLines };
}

/**
 * After the explode, every work line is followed by one line per part, with the highest part first.
 * We drop the parts before `firstKept` (the melody harmonization drops the highest part, because it repeats the melody),
 * and we relabel the parts we keep with the new voice ids.
 */
export function relabelParts(lines: string[], partCount: number, into: string[], firstKept: number = 1): RunnerResult<string[]> {
  const marker = `[V:${WORK_VOICE_ID}]`;
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith(marker)) {
      result.push(lines[index]);
      index += 1;
      continue;
    }
    // The first line of the group is the chord line, which the parts replace.
    for (let part = firstKept; part < partCount; part++) {
      const partLine = lines[index + 1 + part];
      if (partLine === undefined || !partLine.startsWith(marker)) {
        return fail("The explode did not produce one line per part.");
      }
      result.push(`[V:${into[part - firstKept]}]${partLine.slice(marker.length)}`);
    }
    index += 1 + partCount;
  }
  return succeed(result);
}

/**
 * Checks the list of new voice ids: it must hold between `min` and `max` ids, and every id must be a non-empty word
 * without spaces or brackets, and appear only once.
 *
 * @returns The message of the first problem, or null when the ids are valid
 */
export function voiceIdsProblem(into: string[], min: number, max: number): string | null {
  if (into.length < min || into.length > max) {
    return `--into must name between ${min} and ${max} voices (got ${into.length}).`;
  }
  const seen = new Set<string>();
  for (const id of into) {
    if (!/^[A-Za-z0-9_]+$/.test(id)) {
      return `"${id}" is not a valid voice id: use letters, digits or underscores.`;
    }
    if (seen.has(id)) {
      return `The voice id "${id}" appears twice in --into.`;
    }
    seen.add(id);
  }
  return null;
}

/**
 * Because a voice id that is already used would receive a second set of lines and a second declaration,
 * we refuse to write into an id that the score already has, in the header or in the music.
 */
export function takenVoiceProblem(source: string, into: string[]): string | null {
  const lines = source.split("\n");
  for (const id of into) {
    const declared = lines.some((line) => line.startsWith(`V:${id} `) || line === `V:${id}` || line.startsWith(`[V:${id}]`));
    if (declared) {
      return `The voice "${id}" already exists in the score. Choose other ids for --into, or remove that voice first.`;
    }
  }
  return null;
}

/**
 * Adds the new voices to the header, and the new staves to the %%score line when there is one.
 * The upper parts share a treble staff, and the lowest part gets a bass staff of its own.
 */
export function declareVoices(source: string, into: string[]): RunnerResult<string> {
  let text = source;
  for (let index = 0; index < into.length; index++) {
    const isLowest = index === into.length - 1 && into.length > 1;
    const added = runTransform({
      source: text,
      transform: "addVoice",
      args: [into[index], { clef: isLowest ? "bass" : "treble" }],
      ranges: null,
    });
    if (!added.ok) return added;
    text = added.value;
  }

  const upper = into.length > 1 ? into.slice(0, -1) : into;
  const staves = [`( ${upper.join(" ")} )`];
  if (into.length > 1) staves.push(`( ${into[into.length - 1]} )`);
  return succeed(
    text
      .split("\n")
      .map((line) => (line.startsWith("%%score") ? `${line.trimEnd()} ${staves.join(" ")}` : line))
      .join("\n")
  );
}

/**
 * Runs the transforms of a list one after the other on a text, and stops at the first one that fails.
 */
export function runTransformChain(source: string, steps: Array<{ transform: string; args: unknown[] }>, ranges: Range[]): RunnerResult<string> {
  let text = source;
  for (const step of steps) {
    const result = runTransform({ source: text, transform: step.transform, args: step.args, ranges });
    if (!result.ok) return result;
    text = result.value;
  }
  return succeed(text);
}

/**
 * Harmonizes the melody of a voice into new voices, using the chord symbols of the score.
 *
 * Because the chord symbols may sit in another voice, the transform reads them by position in time.
 * The steps are: copy the melody lines into a work voice, build a chord under each melody note,
 * split the chords into one line per part, then keep the lower parts as the new voices.
 */
export function harmonizeVoices(source: string, options: HarmonizeVoicesOptions): RunnerResult<string> {
  const problem = voiceIdsProblem(options.into, 3, 5) ?? takenVoiceProblem(source, options.into);
  if (problem !== null) return fail(problem);
  const partCount = options.into.length + 1;
  const sourceLines = source.split("\n");
  if (findVoiceLines(sourceLines, options.from).length === 0) {
    return fail(`No line starts with the inline voice marker "[V:${options.from}]".`);
  }

  const copied = copyVoiceLines(sourceLines, options.from);
  const workRanges = rangesOfLines(copied.workLines);

  // First pass: the voicing that was asked for. Second pass: a cluster voicing for the leads it skipped.
  const exploded = runTransformChain(
    copied.lines.join("\n"),
    [
      { transform: "harmonizeVoicing", args: [options.voicing, partCount, null] },
      { transform: "harmonizeVoicing", args: ["cluster", partCount, null] },
      { transform: "explode", args: [partCount] },
    ],
    workRanges
  );
  if (!exploded.ok) return exploded;

  const parts = relabelParts(exploded.value.split("\n"), partCount, options.into);
  if (!parts.ok) return parts;
  return declareVoices(parts.value.join("\n"), options.into);
}
