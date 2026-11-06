import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { Group } from "../keymap/types";
import { MENU_KEY_WHEN, toVsCodeKeys } from "./keybindingKeys";
import { KeybindingEntry, buildMenuKeybindings, isMenuKeybinding } from "./menuKeybindings";

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
const contributed: KeybindingEntry[] = (manifest.contributes.keybindings ?? []).filter(isMenuKeybinding);

function notationsOf(group: Group, out: string[]): void {
  for (const [key, node] of Object.entries(group.children)) {
    out.push(key);
    if (node.type === "group") notationsOf(node, out);
  }
}

describe("the menu keybindings of package.json", () => {
  it("are what the generator would write, so that the script has been run after a change of the superset", () => {
    assert.deepStrictEqual(contributed, buildMenuKeybindings());
  });

  it("route every notation of the default keymap to the menu, while the menu is open", () => {
    const notations: string[] = [];
    notationsOf(DEFAULT_KEYMAP.select, notations);
    notationsOf(DEFAULT_KEYMAP.transform, notations);
    for (const notation of notations) {
      const keys = toVsCodeKeys(notation);
      assert.ok(keys.length > 0, notation);
      for (const key of keys) {
        const entry = contributed.find((candidate) => candidate.key === key && candidate.command === "abc.menu.key");
        assert.ok(entry, `${notation} (${key})`);
        assert.strictEqual(entry.args?.notation, notation);
        assert.ok(entry.when.startsWith(MENU_KEY_WHEN), `${notation} (${key})`);
      }
    }
  });

  it("open the select menu with k and the transform menu with h, only outside a menu and in an abc file", () => {
    const select = contributed.find((entry) => entry.command === "abc.menu.select");
    const transform = contributed.find((entry) => entry.command === "abc.menu.transform");
    assert.strictEqual(select?.key, "k");
    assert.strictEqual(transform?.key, "h");
    for (const entry of [select, transform]) {
      assert.ok(entry?.when.includes("editorLangId == abc"));
      assert.ok(entry?.when.includes("!abc.modeMenuOpen"));
      assert.ok(!entry?.when.includes("!vim.active"), "h and k must not be taken from the users who have no VSCodeVim");
      assert.ok(entry?.when.includes("vim.mode == 'Normal'") && entry?.when.includes("vim.mode == 'Visual'"));
    }
  });

  it("only apply where the menu can be used, so that the menu keys type normally in other widgets", () => {
    for (const entry of contributed.filter((candidate) => candidate.command === "abc.menu.key")) {
      assert.ok(entry.when.includes("editorTextFocus") && entry.when.includes("editorLangId == abc") && entry.when.includes("abc.modeMenuOpen"), entry.key);
    }
  });

  it("have no two entries with the same key and the same when clause", () => {
    const seen = new Set<string>();
    for (const entry of contributed) {
      const id = `${entry.key} | ${entry.when}`;
      assert.ok(!seen.has(id), id);
      seen.add(id);
    }
  });
});

describe("the BÉPO keybindings of the digit row", () => {
  const entries = buildMenuKeybindings();
  const notationOf = (key: string): string | undefined => entries.find((entry) => entry.key === key && entry.when.endsWith("&& abc.menuBepo"))?.args?.notation;

  it("reads the key that types * as * and the key that types 0 as 0, while the BÉPO layout is chosen", () => {
    assert.strictEqual(notationOf("0"), "*");
    assert.strictEqual(notationOf("shift+0"), "0");
    assert.strictEqual(notationOf("shift+5"), "5");
  });

  it("keeps the US keybindings of the digit row away from the BÉPO layout", () => {
    const us = entries.find((entry) => entry.key === "0" && entry.args?.notation === "0");
    assert.ok(us && us.when.includes("!abc.menuBepo"));
  });

  it("leaves the keys outside the digit row for every layout", () => {
    const comma = entries.find((entry) => entry.key === "shift+," && entry.args?.notation === "<");
    assert.ok(comma && !comma.when.includes("abc.menuBepo"));
  });
});
