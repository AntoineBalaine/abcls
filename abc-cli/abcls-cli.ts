#!/usr/bin/env node
/**
 * ABC CLI Tool - Main entry point
 *
 * Command-line interface for ABC music notation processing
 */

import * as path from "path";
import { Command } from "commander";
import { abc2midiCommand } from "./commands/abc2midi";
import { abc2xmlCommand } from "./commands/abc2xml";
import { abcx2abcCommand } from "./commands/abcx2abc";
import { checkCommand } from "./commands/check";
import { formatCommand } from "./commands/format";
import { midi2abcCommand } from "./commands/midi2abc";
import { renderCommand } from "./commands/render";
import { xml2abcCommand } from "./commands/xml2abc";

const program = new Command();

program.name("abcls").description("ABC notation language server and CLI tools").version("0.1.0");

// Add commands
program.addCommand(formatCommand);
program.addCommand(checkCommand);
program.addCommand(renderCommand);
program.addCommand(abcx2abcCommand);
program.addCommand(abc2midiCommand);
program.addCommand(midi2abcCommand);
program.addCommand(abc2xmlCommand);
program.addCommand(xml2abcCommand);

// The lsp subcommand loads the LSP server bundle, which is built as a
// separate esbuild entry point to avoid increasing CLI startup time.
const lspCommand = new Command("lsp")
  .description("Start the ABC language server")
  .option("--stdio", "Use stdio transport (default)")
  .option("--socket <path>", "Use Unix socket transport at the given path")
  .action((options: { stdio?: boolean; socket?: string }) => {
    // Forward --socket as a process.argv entry so the server can parse it,
    // because the server reads process.argv directly for --socket=<path>.
    if (options.socket) {
      process.argv.push(`--socket=${options.socket}`);
    }
    // The server entry point is co-located next to this file in the bundle.
    require(path.join(__dirname, "abcls-server.js"));
  });
program.addCommand(lspCommand);

// Parse command-line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
