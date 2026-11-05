/**
 * The keybindings that the extension contributes for the modal menu.
 *
 * scripts/generateMenuKeybindings.ts writes them into package.json, so that the list of keys is never edited by hand.
 * Nothing here imports vscode.
 */

import { MENU_COMMAND_KEY, MENU_KEY_SUPERSET, MENU_KEY_WHEN, MENU_OPEN_CONTEXT, toVsCodeKeys } from "./keybindingKeys";

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

export const SELECT_ENTRY_KEY = "h";
export const TRANSFORM_ENTRY_KEY = "k";

export function buildMenuKeybindings(): KeybindingEntry[] {
  const entries: KeybindingEntry[] = [
    { key: SELECT_ENTRY_KEY, command: "abc.menu.select", when: ENTRY_WHEN },
    { key: TRANSFORM_ENTRY_KEY, command: "abc.menu.transform", when: ENTRY_WHEN },
  ];
  for (const notation of MENU_KEY_SUPERSET) {
    for (const key of toVsCodeKeys(notation)) {
      entries.push({ key, command: MENU_COMMAND_KEY, args: { notation }, when: MENU_KEY_WHEN });
    }
  }
  return entries;
}

export function isMenuKeybinding(entry: { command?: unknown }): boolean {
  return typeof entry.command === "string" && entry.command.startsWith("abc.menu.");
}

/** Replaces the menu keybindings of a manifest and keeps the other ones, so that the user's additions in package.json survive. */
export function withMenuKeybindings(existing: Array<{ command?: unknown }>, generated: KeybindingEntry[]): unknown[] {
  return [...existing.filter((entry) => !isMenuKeybinding(entry)), ...generated];
}
