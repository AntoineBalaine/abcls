/**
 * The key notation of the keymap: the Kakoune notation extended with modifiers.
 *
 * A text of one character is a plain key, including < and >. A longer text must be
 * "<" modifiers "-" key ">". The modifiers are "a-" (Alt) and "c-" (Ctrl), and "S-" (Shift)
 * is allowed only before a named key. They may come in any order, each at most once, and
 * formatNotation writes them in the order c, a, S. An uppercase letter already encodes the Shift key.
 */

export interface Notation {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export const NAMED_KEYS = ["up", "down", "left", "right", "tab", "esc", "bs"];

const WRAPPED = /^<((?:[ac]-|S-)*)(.+)>$/;

export function parseNotation(text: string): Notation | undefined {
  if (text.length === 1) {
    return { key: text, ctrl: false, alt: false, shift: false };
  }
  const match = WRAPPED.exec(text);
  if (!match) return undefined;

  const modifiers = match[1];
  const key = match[2];
  const named = NAMED_KEYS.includes(key);
  if (!named && key.length !== 1) return undefined;

  // Because a modifier may appear only once, the counts decide whether the text is well formed, and the order does not matter.
  const ctrl = countOf(modifiers, "c-") === 1;
  const alt = countOf(modifiers, "a-") === 1;
  const shift = countOf(modifiers, "S-") === 1;
  if (countOf(modifiers, "c-") > 1 || countOf(modifiers, "a-") > 1 || countOf(modifiers, "S-") > 1) return undefined;
  if (shift && !named) return undefined;
  // A single character with no modifier is written bare, so <x> is not a notation.
  if (modifiers === "" && !named) return undefined;
  return { key, ctrl, alt, shift };
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

function formatModifiers(ctrl: boolean, alt: boolean, shift: boolean): string {
  return (ctrl ? "c-" : "") + (alt ? "a-" : "") + (shift ? "S-" : "");
}

export function formatNotation(notation: Notation): string {
  const modifiers = formatModifiers(notation.ctrl, notation.alt, notation.shift);
  if (modifiers === "" && notation.key.length === 1) return notation.key;
  return `<${modifiers}${notation.key}>`;
}
