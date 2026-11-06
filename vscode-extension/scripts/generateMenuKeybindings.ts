/**
 * Writes the keybindings of the modal menu into package.json.
 *
 * Because VS Code keybindings are static, one entry per key of the menu has to be contributed. The extension build runs this
 * script first, so the entries follow MENU_KEY_SUPERSET. With --check the script only reports whether package.json is up to date.
 */

import * as fs from "fs";
import * as path from "path";
import { buildMenuKeybindings, withMenuKeybindings } from "../src/menu/menuKeybindings";

function main(): void {
  const manifestPath = path.join(__dirname, "..", "package.json");
  const original = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(original);
  manifest.contributes.keybindings = withMenuKeybindings(manifest.contributes.keybindings ?? [], buildMenuKeybindings());
  const updated = JSON.stringify(manifest, null, 2) + "\n";

  if (updated === original) {
    console.log("The menu keybindings of package.json are up to date.");
    return;
  }
  if (process.argv.includes("--check")) {
    console.error("The menu keybindings of package.json are out of date. Run npm run generate-keybindings.");
    process.exit(1);
  }
  fs.writeFileSync(manifestPath, updated);
  console.log("The menu keybindings of package.json were updated.");
}

main();
