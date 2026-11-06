/**
 * The keybindings that the extension contributes for the modal menu.
 *
 * scripts/generateMenuKeybindings.ts writes them into package.json, so that the list of keys is never edited by hand.
 * Nothing here imports vscode.
 */

import { LAYOUTS } from "../keyboard/layouts";
import { MENU_BEPO_CONTEXT, MENU_COMMAND_KEY, MENU_KEY_SUPERSET, MENU_KEY_WHEN, MENU_OPEN_CONTEXT, toVsCodeKeys } from "./keybindingKeys";

export interface KeybindingEntry {
  key: string;
  command: string;
  args?: { notation: string };
  when: string;
}

/**
 * The menu opens from the Normal and Visual modes of VSCodeVim. Without VSCodeVim there is no default entry key,
 * because h and k would otherwise stop typing in every ABC file, and the user binds abc.menu.select and abc.menu.transform.
 */
export const ENTRY_WHEN = `editorLangId == abc && editorTextFocus && !${MENU_OPEN_CONTEXT} && (vim.mode == 'Normal' || vim.mode == 'Visual' || vim.mode == 'VisualLine')`;

export const SELECT_ENTRY_KEY = "k";
export const TRANSFORM_ENTRY_KEY = "h";

/** The positions of the number row that hold the keys 1 to 0, then - and =, in the rows of the layouts. */
const NUMBER_ROW_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * The keybindings that the BÉPO layout needs on its number row.
 * Because VS Code names these keys by their physical place, the key that types * sends 0, and the key that types 0 sends Shift and 0,
 * so the keybindings of the US layout would read the wrong notation. Each physical key gets the notations of its BÉPO layers instead,
 * and they apply only while the setting abc.keyboardLayout is bepo.
 */
export function buildBepoKeybindings(): KeybindingEntry[] {
  const entries: KeybindingEntry[] = [];
  const when = `${MENU_KEY_WHEN} && ${MENU_BEPO_CONTEXT}`;
  for (const position of NUMBER_ROW_POSITIONS) {
    const physical = LAYOUTS.qwerty.rows[0][position][0];
    const bepo = LAYOUTS.bepo.rows[0][position];
    const layers: Array<[string, string]> = [
      [physical, bepo[0]],
      [`shift+${physical}`, bepo[1]],
      [`alt+${physical}`, bepo[2]],
    ];
    for (const [key, notation] of layers) {
      if (MENU_KEY_SUPERSET.includes(notation)) entries.push({ key, command: MENU_COMMAND_KEY, args: { notation }, when });
    }
  }
  return entries;
}

/** The keys of the number row, which the BÉPO keybindings take over while that layout is chosen. */
const NUMBER_ROW_KEYS: string[] = NUMBER_ROW_POSITIONS.flatMap((position) => {
  const physical = LAYOUTS.qwerty.rows[0][position][0];
  return [physical, `shift+${physical}`];
});

export function buildMenuKeybindings(): KeybindingEntry[] {
  const entries: KeybindingEntry[] = [
    { key: SELECT_ENTRY_KEY, command: "abc.menu.select", when: ENTRY_WHEN },
    { key: TRANSFORM_ENTRY_KEY, command: "abc.menu.transform", when: ENTRY_WHEN },
  ];
  for (const notation of MENU_KEY_SUPERSET) {
    for (const key of toVsCodeKeys(notation)) {
      // Because the BÉPO keybindings own the number row while that layout is chosen, the US ones step aside there.
      const when = NUMBER_ROW_KEYS.includes(key) ? `${MENU_KEY_WHEN} && !${MENU_BEPO_CONTEXT}` : MENU_KEY_WHEN;
      entries.push({ key, command: MENU_COMMAND_KEY, args: { notation }, when });
    }
  }
  entries.push(...buildBepoKeybindings());
  return entries;
}

export function isMenuKeybinding(entry: { command?: unknown }): boolean {
  return typeof entry.command === "string" && entry.command.startsWith("abc.menu.");
}

/** Replaces the menu keybindings of a manifest and keeps the other ones, so that the user's additions in package.json survive. */
export function withMenuKeybindings(existing: Array<{ command?: unknown }>, generated: KeybindingEntry[]): unknown[] {
  return [...existing.filter((entry) => !isMenuKeybinding(entry)), ...generated];
}
