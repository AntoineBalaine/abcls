/**
 * The link between the notation of the keymap and the keybindings of VS Code.
 *
 * Because VS Code keybindings are static and have no catch-all, the extension contributes one keybinding for
 * each notation of MENU_KEY_SUPERSET, and generateMenuKeybindings.ts writes them into package.json.
 * Nothing here imports vscode.
 */

import { Notation, parseNotation } from "../keymap/notation";
import { Keymap, Group } from "../keymap/types";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");
/** The ASCII symbols that a US keyboard types without Shift, which are their own key. */
const PLAIN_SYMBOLS = ["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"];

/** The ASCII symbols that a US keyboard types with Shift, with the key that carries them. */
const SHIFTED_SYMBOLS: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

/** The chords that type < and > on the BÉPO layout, where AltGr is the Option key of a Mac. */
const BEPO_ALTGR_LESS = "alt+2";
const BEPO_ALTGR_GREATER = "alt+3";
/** The chords that type [ and ] on the BÉPO layout. */
const BEPO_ALTGR_OPEN_BRACKET = "alt+4";
const BEPO_ALTGR_CLOSE_BRACKET = "alt+5";

const NAMED_TO_VSCODE: Record<string, string> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  tab: "tab",
  esc: "escape",
  bs: "backspace",
};

const ARROWS = ["up", "down", "left", "right"];

function buildSuperset(): string[] {
  const keys: string[] = [];
  for (const letter of LETTERS) {
    const upper = letter.toUpperCase();
    keys.push(letter, upper, `<a-${letter}>`, `<a-${upper}>`);
  }
  keys.push(...DIGITS, ...PLAIN_SYMBOLS, ...Object.keys(SHIFTED_SYMBOLS));
  for (const arrow of ARROWS) keys.push(`<c-${arrow}>`, `<c-S-${arrow}>`);
  keys.push("<tab>", "<esc>", "<bs>");
  return keys;
}

/** The notations that get a keybinding while a menu is open. */
export const MENU_KEY_SUPERSET: string[] = buildSuperset();

function baseKeyStrings(notation: Notation): string[] | undefined {
  const key = notation.key;
  if (key in NAMED_TO_VSCODE) return [NAMED_TO_VSCODE[key]];
  if (key.length !== 1) return undefined;
  if (key >= "a" && key <= "z") return [key];
  if (key >= "A" && key <= "Z") return [`shift+${key.toLowerCase()}`];
  if (key === "[" || key === "]") {
    // Because the BÉPO layout types the square brackets with AltGr on the keys 4 and 5, those chords are bound too.
    const keys = [key];
    if (!notation.ctrl && !notation.shift && !notation.alt) keys.push(key === "[" ? BEPO_ALTGR_OPEN_BRACKET : BEPO_ALTGR_CLOSE_BRACKET);
    return keys;
  }
  if (DIGITS.includes(key) || PLAIN_SYMBOLS.includes(key)) return [key];
  if (key in SHIFTED_SYMBOLS) {
    const shifted = [`shift+${SHIFTED_SYMBOLS[key]}`];
    // Because the angle brackets sit on other keys on other layouts, the character itself is bound as well.
    if (key === "<" || key === ">") shifted.push(key);
    // Because the BÉPO layout types the angle brackets with AltGr (the Option key of a Mac) on the keys 2 and 3, those chords are bound too.
    // A notation with a modifier of its own would get the modifier twice, so only the bare angle brackets get them.
    if (!notation.ctrl && !notation.shift && !notation.alt) {
      if (key === "<") shifted.push(BEPO_ALTGR_LESS);
      if (key === ">") shifted.push(BEPO_ALTGR_GREATER);
    }
    return shifted;
  }
  return undefined;
}

/**
 * The key strings of the keybindings that stand for a notation, or an empty list when none can.
 * VS Code reads modifiers in any order, and the strings here use the order ctrl, shift, alt.
 */
export function toVsCodeKeys(text: string): string[] {
  const notation = parseNotation(text);
  if (!notation) return [];
  const bases = baseKeyStrings(notation);
  if (!bases) return [];
  const keys: string[] = [];
  for (const base of bases) {
    const parts: string[] = [];
    if (notation.ctrl) parts.push("ctrl");
    if (notation.shift) parts.push("shift");
    if (notation.alt) parts.push("alt");
    keys.push([...parts, base].join("+"));
  }
  return keys;
}

/** The first key string of a notation. */
export function toVsCodeKey(text: string): string | undefined {
  return toVsCodeKeys(text)[0];
}

function collectKeys(group: Group, out: string[]): void {
  for (const [key, node] of Object.entries(group.children)) {
    out.push(key);
    if (node.type === "group") collectKeys(node, out);
  }
}

/** The notations that the keymap binds and that have no keybinding, so that no key of the menu is silently dead. */
export function keysOutsideSuperset(keymap: Keymap): string[] {
  const all: string[] = [];
  collectKeys(keymap.select, all);
  collectKeys(keymap.transform, all);
  const outside: string[] = [];
  for (const key of all) {
    if (!MENU_KEY_SUPERSET.includes(key) && !outside.includes(key)) outside.push(key);
  }
  return outside;
}

/** The entry of keybindings.json that makes a key outside the superset reach the menu. */
export function keybindingSnippet(notation: string): string {
  const key = toVsCodeKey(notation) ?? "<the key>";
  return JSON.stringify({ key, command: MENU_COMMAND_KEY, args: { notation }, when: MENU_KEY_WHEN });
}

export function outsideSupersetWarning(keymap: Keymap): string | undefined {
  const outside = keysOutsideSuperset(keymap);
  if (outside.length === 0) return undefined;
  const snippets = outside.map(keybindingSnippet).join("\n");
  return `abc.keymap binds keys that have no keybinding, so they cannot be pressed: ${outside.join(", ")}. Add an entry such as the following to keybindings.json for each of them:\n${snippets}`;
}

export const MENU_COMMAND_KEY = "abc.menu.key";
export const MENU_OPEN_CONTEXT = "abc.modeMenuOpen";
/** The context key that is true while the setting abc.keyboardLayout is bepo. */
export const MENU_BEPO_CONTEXT = "abc.menuBepo";

/**
 * The when clause of the menu keys. Because the keys are swallowed only where the menu can be used, a focus in the terminal,
 * the explorer or the command palette still types normally, even if the menu was left open.
 */
export const MENU_KEY_WHEN = `${MENU_OPEN_CONTEXT} && editorTextFocus && editorLangId == abc`;
