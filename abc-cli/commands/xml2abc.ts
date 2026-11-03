/**
 * xml2abc command: Convert a MusicXML file to ABC notation
 */

import { readFileSync } from "fs";
import { ABCContext, tuneToAbcText, TuneToAbcLineBreaks } from "abcls-parser";
import { Command } from "commander";
import { writeFile } from "../utils/shared";

export const xml2abcCommand = new Command("xml2abc")
  .description("Convert a MusicXML file to ABC notation")
  .argument("<file>", "MusicXML file to convert (.xml or .musicxml)")
  .option("-o, --output <file>", "Output ABC file path (writes to stdout if omitted)")
  .option("--bars-per-line <n>", "Break lines every <n> bars instead of following the MusicXML layout")
  .action(async (file: string, options: { output?: string; barsPerLine?: string }) => {
    if (file.endsWith(".mxl")) {
      console.error("Error: compressed MusicXML (.mxl) is not supported; extract it to raw .xml/.musicxml first");
      process.exit(1);
    }

    // Because a source without <print new-system> would otherwise come out
    // as one long line per voice, the source layout falls back to 4 bars.
    let lineBreaks: TuneToAbcLineBreaks = { mode: "source", fallbackBarsPerLine: 4 };
    if (options.barsPerLine !== undefined) {
      const barsPerLine = Number(options.barsPerLine);
      if (!Number.isInteger(barsPerLine) || barsPerLine < 1) {
        console.error("Error: --bars-per-line must be a positive integer");
        process.exit(1);
      }
      lineBreaks = { mode: "fixed", barsPerLine };
    }

    let xml: string;
    try {
      xml = readFileSync(file, "utf-8");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error reading file: ${msg}`);
      process.exit(1);
    }

    try {
      // Because the MusicXML reader loads jsdom and opensheetmusicdisplay, which are large, we load it only for this
      // command, so that the other commands do not pay for it at startup.
      const { parseMusicXmlToSheet } = await import("abcls-parser/musicxml/parseMusicXml");
      const { importFromMusicSheet } = await import("abcls-parser/musicxml/importFromMusicSheet");
      const sheet = parseMusicXmlToSheet(xml);
      const imported = importFromMusicSheet(sheet);
      if (!imported.ok) {
        imported.errors.forEach((message) => console.error(`Error: ${message}`));
        process.exit(1);
      }
      const abcText = tuneToAbcText(imported.tune, new ABCContext(), { lineBreaks });

      if (options.output) {
        writeFile(options.output, abcText);
      } else {
        process.stdout.write(abcText);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
