/**
 * The state machine of the modal menu.
 *
 * It is pure: it receives a state, the keymap and one key, and returns the next state and what to do.
 * Because it never imports vscode, the tests can drive it key by key, and the engine only has to carry out the effect.
 */

import { resolveKey } from "../keymap/resolve";
import { Keymap, Leaf, MenuMode } from "../keymap/types";

export interface MenuState {
  open: boolean;
  mode: MenuMode;
  /** The keys of the groups that were opened, from the root of the mode's menu. */
  path: string[];
  /** The digits typed as a count, at most three. */
  count: string;
}

export interface MenuInput {
  notation: string;
}

export type MenuEffect = { kind: "none" } | { kind: "run"; leaf: Leaf; count: number | undefined } | { kind: "error"; message: string };

export interface StepResult {
  state: MenuState;
  effect: MenuEffect;
}

const MAX_COUNT_DIGITS = 3;
const NOTHING: MenuEffect = { kind: "none" };

export function closedState(mode: MenuMode = "select"): MenuState {
  return { open: false, mode, path: [], count: "" };
}

export function openMenu(mode: MenuMode): MenuState {
  return { open: true, mode, path: [], count: "" };
}

export function countOf(state: MenuState): number | undefined {
  return state.count === "" ? undefined : Number(state.count);
}

function close(state: MenuState): MenuState {
  return closedState(state.mode);
}

function otherMode(mode: MenuMode): MenuMode {
  return mode === "select" ? "transform" : "select";
}

function stepBack(state: MenuState): MenuState {
  if (state.count !== "") return { ...state, count: state.count.slice(0, -1) };
  if (state.path.length > 0) return { ...state, path: state.path.slice(0, -1) };
  return close(state);
}

/** Because the mode keys must work inside a group too, a key that is unbound there falls back to the mode keys of the root. */
function rootModeKey(keymap: Keymap, state: MenuState, notation: string): Leaf | undefined {
  if (state.path.length === 0) return undefined;
  const root = resolveKey(keymap[state.mode], [], notation);
  return root !== undefined && root.type === "leaf" && root.action.kind === "mode" ? root : undefined;
}

function isDigit(notation: string): boolean {
  return notation.length === 1 && notation >= "0" && notation <= "9";
}

/**
 * Takes one key in an open menu. A closed menu ignores every key.
 *
 * The rules, in order: Esc closes; Backspace goes back by one count digit, then one group, then closes;
 * a key bound at the current path wins, so that a bound digit is never taken for a count, and a mode key of the root works inside a group;
 * an unbound digit extends the count, in both menus; anything else is ignored and the menu stays open.
 * A leaf runs and closes the menu, unless the menu is sticky, which keeps it open for the next key.
 */
export function step(state: MenuState, keymap: Keymap, input: MenuInput, sticky = false): StepResult {
  if (!state.open) return { state, effect: NOTHING };

  if (input.notation === "<esc>") return { state: close(state), effect: NOTHING };
  if (input.notation === "<bs>") {
    const next = stepBack(state);
    return { state: next, effect: NOTHING };
  }

  const node = resolveKey(keymap[state.mode], state.path, input.notation) ?? rootModeKey(keymap, state, input.notation);
  if (node === undefined) {
    if (isDigit(input.notation) && state.count.length < MAX_COUNT_DIGITS) {
      // A count that starts with zero means nothing, so the first zero is ignored.
      if (state.count === "" && input.notation === "0") return { state, effect: NOTHING };
      return { state: { ...state, count: state.count + input.notation }, effect: NOTHING };
    }
    return { state, effect: NOTHING };
  }

  if (node.type === "group") {
    return { state: { ...state, path: [...state.path, input.notation] }, effect: NOTHING };
  }

  if (node.action.kind === "mode") {
    const name = node.action.name;
    if (name === "select" || name === "transform") return { state: { ...state, mode: name, path: [] }, effect: NOTHING };
    if (name === "toggle") return { state: { ...state, mode: otherMode(state.mode), path: [] }, effect: NOTHING };
    return { state, effect: { kind: "error", message: `"${name}" is not a mode` } };
  }

  // A sticky menu stays open after a command, ready for the next key, with the path and the count cleared. Otherwise the command closes it.
  const next = sticky ? { ...state, path: [], count: "" } : close(state);
  return { state: next, effect: { kind: "run", leaf: node, count: countOf(state) } };
}
