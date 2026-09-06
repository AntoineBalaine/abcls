/**
 * abc2xml command: Export an ABC tune to MusicXML
 */

import { ABCContext, AbcErrorReporter, Scanner, parse, SemanticAnalyzer } from "abcls-parser";
import { TuneInterpreter } from "abcls-parser/interpreter/TuneInterpreter";
import { normalizeForMusicXML } from "abcls-parser/musicxml/normalize";
import { serializeScorePartwise } from "abcls-parser/musicxml/serialize";
import { Command } from "commander";
import { readAbcFile, writeFile } from "../utils/shared";

export const abc2xmlCommand = new Command("abc2xml")
  .description("Export an ABC file's tune to MusicXML")
  .argument("<file>", "ABC file to export")
  .option("-o, --output <file>", "Output MusicXML file path (writes to stdout if omitted)")
  .action((file: string, options: { output?: string }) => {
    const content = readAbcFile(file);
    const ctx = new ABCContext(new AbcErrorReporter());
    const tokens = Scanner(content, ctx);
    const ast = parse(tokens, ctx);

    if (ctx.errorReporter.hasErrors()) {
      const errors = ctx.errorReporter.getErrors();
      errors.forEach((err) => console.error(`Warning: ${err.message}`));
    }

    const analyzer = new SemanticAnalyzer(ctx);
    ast.accept(analyzer);
    const interpreter = new TuneInterpreter(analyzer, ctx, content);
    const { tunes } = interpreter.interpretFile(ast);

    if (tunes.length === 0) {
      console.error("Error: no tune found in file");
      process.exit(1);
    }
    if (tunes.length > 1) {
      console.error(
        `Error: file contains ${tunes.length} tunes; MusicXML export handles one tune at a time. Split the file or select a single tune before exporting.`
      );
      process.exit(1);
    }

    try {
      const ir = normalizeForMusicXML(tunes[0]);
      const xml = serializeScorePartwise(ir);

      if (options.output) {
        writeFile(options.output, xml);
      } else {
        process.stdout.write(xml);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
