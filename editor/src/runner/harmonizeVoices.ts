import { Range } from "abcls-parser";
import { VoicingType } from "../transforms/harmonize";
import { runTransform, TransformError } from "./runTransform";

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
export function relabelParts(lines: string[], partCount: number, into: string[], firstKept: number = 1): string[] {
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
        throw new TransformError("The explode did not produce one line per part.");
      }
      result.push(`[V:${into[part - firstKept]}]${partLine.slice(marker.length)}`);
    }
    index += 1 + partCount;
  }
  return result;
}

/**
 * Checks the list of new voice ids: it must hold between `min` and `max` ids, and every id must be a non-empty word
 * without spaces or brackets, and appear only once.
 */
export function assertValidVoiceIds(into: string[], min: number, max: number): void {
  if (into.length < min || into.length > max) {
    throw new TransformError(`--into must name between ${min} and ${max} voices (got ${into.length}).`);
  }
  const seen = new Set<string>();
  for (const id of into) {
    if (!/^[A-Za-z0-9_]+$/.test(id)) {
      throw new TransformError(`"${id}" is not a valid voice id: use letters, digits or underscores.`);
    }
    if (seen.has(id)) {
      throw new TransformError(`The voice id "${id}" appears twice in --into.`);
    }
    seen.add(id);
  }
}

/**
 * Because a voice id that is already used would receive a second set of lines and a second declaration,
 * we refuse to write into an id that the score already has, in the header or in the music.
 */
export function assertVoicesAreFree(source: string, into: string[]): void {
  const lines = source.split("\n");
  for (const id of into) {
    const declared = lines.some((line) => line.startsWith(`V:${id} `) || line === `V:${id}` || line.startsWith(`[V:${id}]`));
    if (declared) {
      throw new TransformError(`The voice "${id}" already exists in the score. Choose other ids for --into, or remove that voice first.`);
    }
  }
}

/**
 * Adds the new voices to the header, and the new staves to the %%score line when there is one.
 * The upper parts share a treble staff, and the lowest part gets a bass staff of its own.
 */
export function declareVoices(source: string, into: string[]): string {
  let text = source;
  for (let index = 0; index < into.length; index++) {
    const isLowest = index === into.length - 1 && into.length > 1;
    text = runTransform({
      source: text,
      transform: "addVoice",
      args: [into[index], { clef: isLowest ? "bass" : "treble" }],
      ranges: null,
    });
  }

  const upper = into.length > 1 ? into.slice(0, -1) : into;
  const staves = [`( ${upper.join(" ")} )`];
  if (into.length > 1) staves.push(`( ${into[into.length - 1]} )`);
  return text
    .split("\n")
    .map((line) => (line.startsWith("%%score") ? `${line.trimEnd()} ${staves.join(" ")}` : line))
    .join("\n");
}

/**
 * Harmonizes the melody of a voice into new voices, using the chord symbols of the score.
 *
 * Because the chord symbols may sit in another voice, the transform reads them by position in time.
 * The steps are: copy the melody lines into a work voice, build a chord under each melody note,
 * split the chords into one line per part, then keep the lower parts as the new voices.
 */
export function harmonizeVoices(source: string, options: HarmonizeVoicesOptions): string {
  assertValidVoiceIds(options.into, 3, 5);
  assertVoicesAreFree(source, options.into);
  const partCount = options.into.length + 1;
  const sourceLines = source.split("\n");
  if (findVoiceLines(sourceLines, options.from).length === 0) {
    throw new TransformError(`No line starts with the inline voice marker "[V:${options.from}]".`);
  }

  const copied = copyVoiceLines(sourceLines, options.from);
  let text = copied.lines.join("\n");
  const workRanges = rangesOfLines(copied.workLines);

  // First pass: the voicing that was asked for. Second pass: a cluster voicing for the leads it skipped.
  text = runTransform({ source: text, transform: "harmonizeVoicing", args: [options.voicing, partCount, null], ranges: workRanges });
  text = runTransform({ source: text, transform: "harmonizeVoicing", args: ["cluster", partCount, null], ranges: workRanges });
  text = runTransform({ source: text, transform: "explode", args: [partCount], ranges: workRanges });

  text = relabelParts(text.split("\n"), partCount, options.into).join("\n");
  return declareVoices(text, options.into);
}
