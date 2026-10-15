/**
 * xml2abc command: Convert a MusicXML file to ABC notation
 */

import { readFileSync } from "fs";
import { ABCContext, tuneToAbcText, TuneToAbcLineBreaks } from "abcls-parser";
import { importFromMusicSheet } from "abcls-parser/musicxml/importFromMusicSheet";
import { parseMusicXmlToSheet } from "abcls-parser/musicxml/testSupport/parseMusicXml";
import { Command } from "commander";
import { writeFile } from "../utils/shared";

export const xml2abcCommand = new Command("xml2abc")
  .description("Convert a MusicXML file to ABC notation")
  .argument("<file>", "MusicXML file to convert (.xml or .musicxml)")
  .option("-o, --output <file>", "Output ABC file path (writes to stdout if omitted)")
  .option("--bars-per-line <n>", "Break lines every <n> bars instead of following the MusicXML layout")
  .action((file: string, options: { output?: string; barsPerLine?: string }) => {
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
      const sheet = parseMusicXmlToSheet(xml);
      const tune = importFromMusicSheet(sheet);
      const abcText = tuneToAbcText(tune, new ABCContext(), { lineBreaks });

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
