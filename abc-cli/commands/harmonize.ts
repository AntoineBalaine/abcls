/**
 * Harmonize command: Build harmony voices under a melody voice, from the chord symbols of the score
 */

import { blockChords, harmonizeVoices, LeadKind, TopNoteRule, VoicingType } from "abcls-editor";
import { Command } from "commander";
import { readAbcFile, writeFile } from "../utils/shared";

const VOICINGS = new Set(["close", "cluster", "spread"]);
const TOP_NOTE_RULES = new Set(["nearest", "voicing"]);
const LEAD_KINDS = new Set(["guide-tones", "tensions"]);

export const harmonizeCommand = new Command("harmonize")
  .description("Harmonize into new voices, using the chord symbols of the score (a melody voice, or one block chord per symbol)")
  .argument("<file>", "ABC file to harmonize")
  .option("--from <voice>", "Id of the voice that carries the melody, to harmonize note by note")
  .option("--chords-from <voice>", "Id of the voice that carries the chord symbols, to write one block chord per symbol")
  .requiredOption("--into <ids>", "Comma-separated ids of the new voices, from the highest part to the lowest")
  .option("--voicing <type>", "Voicing of the chords: close, cluster or spread", "close")
  .option("--top-note <rule>", "With --chords-from: how the top note of each chord is chosen: nearest or voicing", "nearest")
  .option("--prefer-lead <kinds>", "With --chords-from: prefer these kinds of top note: guide-tones, tensions, or both (comma-separated)")
  .option("-w, --write", "Write the result back to the file")
  .action((file: string, options: { from?: string; chordsFrom?: string; into: string; voicing: string; topNote: string; preferLead?: string; write?: boolean }) => {
    if (!VOICINGS.has(options.voicing)) {
      console.error(`Error: --voicing must be one of close, cluster, spread (got "${options.voicing}")`);
      process.exit(1);
    }

    if ((options.from === undefined) === (options.chordsFrom === undefined)) {
      console.error("Error: give exactly one of --from (harmonize a melody) or --chords-from (one block chord per chord symbol)");
      process.exit(1);
    }

    if (!TOP_NOTE_RULES.has(options.topNote)) {
      console.error(`Error: --top-note must be nearest or voicing (got "${options.topNote}")`);
      process.exit(1);
    }
    const preferLead = options.preferLead === undefined ? [] : options.preferLead.split(",").map((kind) => kind.trim());
    for (const kind of preferLead) {
      if (!LEAD_KINDS.has(kind)) {
        console.error(`Error: --prefer-lead takes guide-tones, tensions, or both (got "${kind}")`);
        process.exit(1);
      }
    }
    if (options.from !== undefined && (options.preferLead !== undefined || options.topNote !== "nearest")) {
      console.error("Error: --top-note and --prefer-lead only apply with --chords-from, because --from keeps the melody on top");
      process.exit(1);
    }

    const source = readAbcFile(file);
    const warnings: string[] = [];
    try {
      const into = options.into.split(",").map((id) => id.trim());
      const voicing = options.voicing as VoicingType;
      const result =
        options.chordsFrom !== undefined
          ? blockChords(source, {
              chordVoice: options.chordsFrom,
              into,
              voicing,
              topNote: options.topNote as TopNoteRule,
              preferLead: preferLead as LeadKind[],
              warnings,
            })
          : harmonizeVoices(source, { from: options.from!, into, voicing });
      for (const warning of warnings) {
        console.error(`Warning: ${warning}`);
      }
      if (options.write) {
        writeFile(file, result);
        console.log(`Harmonized ${file}`);
      } else {
        process.stdout.write(result);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Harmonize failed: ${message}`);
      process.exit(1);
    }
  });
