/**
 * Render command: Render ABC files to SVG
 */

import { getXNumber } from "abcls-midi";
import { Scanner, parse, ABCContext, AbcFormatter, Tune } from "abcls-parser";
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { paginateSvgs } from "../svg-pagination";
import { renderAbcToSvg, SvgRenderError } from "../svg-renderer";
import { readAbcFile, parseTuneNumbers } from "../utils/shared";

export const renderCommand = new Command("render")
  .description("Render an ABC file to SVG")
  .argument("<file>", "ABC file to render")
  .option("-t, --tune <numbers...>", "Render only the specified tunes by X:number (supports comma-separated, dash-separated or repeated flags)")
  .option("--pages <dir>", "Write A4 pages as SVG files (page-001.svg, ...) into this directory instead of printing the SVG of the tunes")
  .option("--ignore-parse-errors", "Continue rendering even if the ABC file has parsing errors")
  .option("--ignore-missing-tunes", "Continue rendering even if some requested tunes are not found")
  .addHelpText(
    "after",
    "\nTo make a PDF, give the pages to an external tool:\n  abcls render score.abc --pages pages && rsvg-convert -f pdf -o score.pdf pages/page-*.svg"
  )
  .action(async (file: string, options: { tune?: string | string[]; pages?: string; ignoreParseErrors?: boolean; ignoreMissingTunes?: boolean }) => {
    // Read the ABC file
    const content = readAbcFile(file);

    try {
      // Parse tune numbers if specified
      const requestedTunes = parseTuneNumbers(options.tune);

      let contentToRender = content;

      // Because we need to filter tunes by their X: number,
      // we must parse the file and filter before rendering.
      if (requestedTunes.length > 0) {
        const ctx = new ABCContext();
        const tokens = Scanner(content, ctx);
        const ast = parse(tokens, ctx);

        // Because parsing might fail, we need to check for errors.
        if (ctx.errorReporter.hasErrors()) {
          const errors = ctx.errorReporter.getErrors();
          if (options.ignoreParseErrors) {
            console.error("Warning: ABC file has parsing errors (ignoring):");
            errors.forEach((err) => console.error(`  ${err}`));
          } else {
            console.error("Error parsing ABC file:");
            errors.forEach((err) => console.error(`  ${err}`));
            process.exit(1);
          }
        }

        // Because the AST contents can include non-tune items,
        // we need to filter for only Tune objects.
        const allTunes = ast.contents.filter((item): item is Tune => item instanceof Tune);

        // Because we want only specific tunes, we filter by X: number.
        const filteredTunes = allTunes.filter((tune) => {
          const xNumber = getXNumber(tune);
          return xNumber !== null && requestedTunes.includes(xNumber);
        });

        // Because the user might request non-existent tune numbers,
        // we need to report missing tunes.
        if (filteredTunes.length === 0) {
          const availableXNumbers = allTunes.map((t) => getXNumber(t)).filter((x): x is number => x !== null);
          if (options.ignoreMissingTunes) {
            console.error(`Warning: None of the requested tunes (${requestedTunes.join(", ")}) found (ignoring).`);
            console.error(`Available tunes: ${availableXNumbers.join(", ")}`);
            // Because we're ignoring missing tunes and no tunes were found,
            // we fall back to rendering the original content.
            contentToRender = content;
          } else {
            console.error(`Error: None of the requested tunes (${requestedTunes.join(", ")}) found.`);
            console.error(`Available tunes: ${availableXNumbers.join(", ")}`);
            process.exit(1);
          }
        } else {
          // Because we want to warn about partially missing tunes,
          // we check which requested tunes were found.
          const foundXNumbers = filteredTunes.map((t) => getXNumber(t)).filter((x): x is number => x !== null);
          const missingTunes = requestedTunes.filter((x) => !foundXNumbers.includes(x));
          if (missingTunes.length > 0) {
            console.error(`Warning: Tunes not found: \n${missingTunes.join("\n")}`);
          }

          // Because we need to convert the filtered tunes back to ABC notation,
          // we use the formatter with stringify (without formatting).
          const formatter = new AbcFormatter(ctx);
          const tuneStrings = filteredTunes.map((tune) => formatter.stringify(tune, true));
          contentToRender = tuneStrings.join("\n\n");
        }
      }

      // Render the content (either filtered or original)
      const result = await renderAbcToSvg(contentToRender, { oneSvgPerLine: options.pages !== undefined });

      // Output warnings to stderr
      if (result.metadata.warnings) {
        result.metadata.warnings.forEach((warning: string) => {
          console.error(`Warning: ${warning}`);
        });
      }

      if (options.pages !== undefined) {
        const pages = paginateSvgs(result.tunes);
        mkdirSync(options.pages, { recursive: true });
        pages.forEach((page, index) => {
          writeFileSync(join(options.pages as string, `page-${String(index + 1).padStart(3, "0")}.svg`), page);
        });
        console.error(`Wrote ${pages.length} page(s) to ${options.pages}`);
        return;
      }

      // Because we want all tunes rendered as a single output,
      // we concatenate all SVGs.
      const svgOutput = result.svgs.join("\n");

      // Output to stdout
      console.log(svgOutput);
    } catch (error: unknown) {
      if (error instanceof SvgRenderError) {
        console.error(error.toString());
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error rendering SVG: ${msg}`);
      }
      process.exit(1);
    }
  });
