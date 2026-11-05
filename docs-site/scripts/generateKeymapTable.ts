/**
 * Writes the tables of keys of the modal keymap into the documentation page.
 *
 * The tables come from the default keymap of the extension, so the page cannot drift from the data. The docs build runs this
 * script first. With --check the script only reports whether the page is up to date.
 */

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_KEYMAP } from "../../vscode-extension/src/keymap/defaultKeymap";
import { buildKeymapTables, withTables } from "../../vscode-extension/src/keymap/docTables";

function main(): void {
  const pagePath = path.join(__dirname, "..", "src", "content", "docs", "user-guide", "modal-keymap.mdx");
  const original = fs.readFileSync(pagePath, "utf8");
  const updated = withTables(original, buildKeymapTables(DEFAULT_KEYMAP));
  if (updated === undefined) {
    console.error("The page has lost a marker of the tables of keys: both the start and the end marker must be in it, in that order.");
    process.exit(1);
  }
  if (updated === original) {
    console.log("The tables of keys of the modal keymap page are up to date.");
    return;
  }
  if (process.argv.includes("--check")) {
    console.error("The tables of keys of the modal keymap page are out of date. Run npm run generate in docs-site.");
    process.exit(1);
  }
  fs.writeFileSync(pagePath, updated);
  console.log("The tables of keys of the modal keymap page were updated.");
}

main();
