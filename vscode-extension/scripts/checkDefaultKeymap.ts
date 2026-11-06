/**
 * Build-time check of the default keymap.
 *
 * Because a leaf of the keymap names its selector, transform or command as a string, renaming the real
 * function would leave a dead key in the menu. This script fails the build with the list of such keys.
 * Only the default keymap is checked: the user's abc.keymap is the user's responsibility.
 *
 * It is a script and not a test, and it sits outside the tsc project, so it may import from the other packages.
 */

import * as fs from "fs";
import * as path from "path";
import { lookupNavigator, lookupSelector } from "../../abc-lsp-server/src/selectorLookup";
import { lookupTransform } from "../../editor/src/runner/transformLookup";
import { DEFAULT_KEYMAP } from "../src/keymap/defaultKeymap";
import { Group, Keymap } from "../src/keymap/types";
import { validateKeymap } from "../src/keymap/validate";

/** The commands that the keymap may name without package.json contributing them: the built-in undo, and the menu commands. */
const BUILT_IN_COMMANDS = ["undo"];
const BUILT_IN_PREFIXES = ["abc.menu."];

export function checkKeymap(keymap: Keymap, contributedCommands: string[]): string[] {
  const problems: string[] = [...validateKeymap(keymap)];
  const known = new Set<string>(contributedCommands);
  collectProblems(keymap.select, "select", known, problems);
  collectProblems(keymap.transform, "transform", known, problems);
  return problems;
}

function collectProblems(group: Group, where: string, known: Set<string>, problems: string[]): void {
  for (const [key, node] of Object.entries(group.children)) {
    const here = `${where} ${key}`;
    if (node.type === "group") {
      collectProblems(node, here, known, problems);
      continue;
    }
    const { kind, name } = node.action;
    if (kind === "selector" && lookupSelector(name) === null && lookupNavigator(name) === null) problems.push(`${here}: the selector "${name}" does not exist`);
    if (kind === "transform" && lookupTransform(name) === null) problems.push(`${here}: the transform "${name}" does not exist`);
    if (kind === "command" && !known.has(name) && !BUILT_IN_COMMANDS.includes(name) && !BUILT_IN_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      problems.push(`${here}: the command "${name}" is not contributed by package.json`);
    }
  }
}

function contributedCommandsOf(packageJsonPath: string): string[] {
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const commands: Array<{ command: string }> = manifest.contributes?.commands ?? [];
  return commands.map((entry) => entry.command);
}

function main(): void {
  const problems = checkKeymap(DEFAULT_KEYMAP, contributedCommandsOf(path.join(__dirname, "..", "package.json")));
  if (problems.length > 0) {
    console.error("The default keymap has problems:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log("The default keymap is sound.");
}

if (require.main === module) main();
