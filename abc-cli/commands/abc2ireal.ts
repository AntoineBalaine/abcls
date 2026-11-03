/**
 * abc2ireal command: Export the chords of an ABC score, or an ABCx chord sheet, as an iReal Pro link
 */

import { writeFileSync } from "fs";
import { ABCContext, exportAbcToIrealLink, exportAbcxToIrealLink } from "abcls-parser";
import { Command } from "commander";
import { readAbcFile, parseTuneNumbers } from "../utils/shared";

/**
 * Percent-encodes one piece of a link.
 *
 * Because encodeURIComponent leaves "*", "!", "'", "(", ")" and "~" as they are, and the chord data holds the
 * star of a section label, we encode those characters as well.
 */
export function encodeLinkPiece(piece: string): string {
  return encodeURIComponent(piece).replace(/[!'()*~]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Percent-encodes the fields of an iReal Pro link.
 *
 * Because iReal Pro reads the link as a URL, the title, the style and the chord data must not hold raw spaces,
 * bars, brackets or stars. The fields stay separated by "=" (and the songs by "==="), so we encode each piece
 * between the separators and keep the separators themselves.
 */
export function encodeIrealLink(link: string): string {
  const scheme = "irealb://";
  if (!link.startsWith(scheme)) return link;
  return scheme + link.slice(scheme.length).split("=").map(encodeLinkPiece).join("=");
}

/**
 * Wraps a link in a page that iReal Pro can import by opening it.
 */
function linkPage(link: string): string {
  const escaped = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>iReal Pro</title></head><body><a href="${escaped}">Open in iReal Pro</a></body></html>\n`;
}

export const abc2irealCommand = new Command("abc2ireal")
  .description("Export the chords of an ABC file (or an ABCx chord sheet) as an iReal Pro link")
  .argument("<file>", "ABC or ABCx file to export")
  .option("-o, --output <file>", "Write the link to this file (an .html extension writes a page that iReal Pro can open); writes to stdout if omitted")
  .option("-t, --tune <numbers...>", "Export only the specified tunes by X:number (supports comma-separated, dash-separated or repeated flags)")
  .option("--voice <id>", "ABC only: the voice that carries the chords (defaults to the voice with the most chord symbols)")
  .option("--cells <n>", "ABC only: the number of iReal Pro cells to give each bar (default 4, so that four bars fill a row of 16 cells)")
  .option("--tempo <bpm>", "ABC only: the tempo in beats per minute to use when the tune has no Q: line, e.g. 120")
  .option("--style <name>", 'ABC only: the iReal Pro style to use when the tune has no %%irealstyle directive, e.g. "Medium Swing"')
  .action((file: string, options: { output?: string; tune?: string | string[]; voice?: string; style?: string; tempo?: string; cells?: string }) => {
    const content = readAbcFile(file);
    const ctx = new ABCContext();
    const tuneNumbers = parseTuneNumbers(options.tune);

    try {
      const exportOptions = { tunes: tuneNumbers.length > 0 ? tuneNumbers : undefined, voice: options.voice, style: options.style, tempo: options.tempo === undefined ? undefined : parseInt(options.tempo, 10), cellsPerBar: options.cells === undefined ? undefined : parseInt(options.cells, 10) };
      const exported = file.endsWith(".abcx") ? exportAbcxToIrealLink(content, ctx) : exportAbcToIrealLink(content, exportOptions, ctx);
      const link = exported === null ? null : encodeIrealLink(exported);

      // Because the export reports what it could not express rather than failing, we show those conditions as warnings,
      // unless no link came out at all, in which case they are the reason of the failure.
      for (const error of ctx.errorReporter.getErrors()) {
        console.error(`${link === null ? "Error" : "Warning"}: ${error.message}`);
      }
      if (link === null) process.exit(1);

      if (options.output) {
        writeFileSync(options.output, options.output.endsWith(".html") ? linkPage(link) : `${link}\n`);
      } else {
        process.stdout.write(`${link}\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
