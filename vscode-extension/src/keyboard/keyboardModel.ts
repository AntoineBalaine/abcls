/**
 * The model of the keyboard view.
 *
 * Because VS Code gives an extension no event for a held Shift or Alt, the view cannot follow the modifiers, so every key
 * is drawn with its four layers at once: base, Shift, AltGr and AltGr with Shift. This module decides what each layer
 * of each key does in the current menu. It is pure, so the extension builds the model and the tests check it.
 */

import { formatNotation, parseNotation } from "../keymap/notation";
import { resolveGroup } from "../keymap/resolve";
import { KeymapNode, Keymap } from "../keymap/types";
import { MenuState } from "../menu/menuState";
import { ViewRow, toRow } from "../menu/menuViewModel";
import { KeyCap, LAYOUTS } from "./layouts";

export interface KeyboardOptions {
  layout: "qwerty" | "bepo";
  geometry: "staggered" | "ortholinear";
  iso: boolean;
}

export type LayerLevel = 0 | 1 | 2 | 3;
export type LayerState = "bound" | "unbound" | "dead" | "count";

export interface LayerView {
  level: LayerLevel;
  /** The character that the layer types. */
  symbol: string;
  state: LayerState;
  /** The notation that a press of this layer sends, which is the symbol or the Alt chord of the key. */
  notation: string;
  row?: ViewRow;
}

export interface CapView {
  row: number;
  col: number;
  /** Where the row starts, in units of one key. */
  offset: number;
  layers: [LayerView, LayerView, LayerView, LayerView];
}

export interface KeyboardModel {
  layout: "qwerty" | "bepo";
  geometry: "staggered" | "ortholinear";
  /** Whether the keys that only ISO keyboards have are drawn. */
  iso: boolean;
  caps: CapView[][];
  /** The keys of the current menu that no cap carries: the Ctrl chords, Tab, and the mode keys on a layout that does not type them. */
  tray: ViewRow[];
}

/** The offsets of the four rows of a staggered keyboard, in units of one key. */
const STAGGER = [0, 0.5, 0.75, 1.25];

function canonical(notation: string): string {
  const parsed = parseNotation(notation);
  return parsed ? formatNotation(parsed) : notation;
}

/** A binding of the current menu, with the key as the keymap spells it: the press that the menu receives must use that spelling. */
interface Entry {
  key: string;
  node: KeymapNode;
}

/**
 * The keys that work at the current path: the group's own keys, and inside a group the mode keys of the root.
 * They are indexed by the canonical notation, so that two spellings of the same key meet, and each keeps its own spelling.
 */
function bindingsAt(keymap: Keymap, state: MenuState): Map<string, Entry> {
  const root = keymap[state.mode];
  const group = resolveGroup(root, state.path) ?? root;
  const bindings = new Map<string, Entry>();
  for (const [key, node] of Object.entries(group.children)) bindings.set(canonical(key), { key, node });
  if (group !== root) {
    for (const [key, node] of Object.entries(root.children)) {
      if (node.type === "leaf" && node.action.kind === "mode" && !bindings.has(canonical(key))) bindings.set(canonical(key), { key, node });
    }
  }
  return bindings;
}

function isDigit(symbol: string): boolean {
  return symbol.length === 1 && symbol >= "0" && symbol <= "9";
}

/**
 * What one layer of a key does. A symbol that is itself bound wins, such as the < that the AltGr layer of BÉPO types.
 * Otherwise the two AltGr layers are the Alt chords of the key: <a-x> with the base or Shift character x.
 * A dead key types no symbol of its own, so its symbol never matches a binding. Its Alt chord still can, because a keybinding
 * fires on the physical key whatever the key types, so a dead AltGr layer may be bound to the chord.
 */
export function resolveLayer(cap: KeyCap, level: LayerLevel, mode: MenuState["mode"], bindings: Map<string, Entry>): LayerView {
  const own = cap[level];
  // A layer with no character of its own is drawn with the character of the base or Shift layer, but it never takes that layer's binding.
  const symbol = own || cap[(level % 2) as 0 | 1];
  const dead = cap[4]?.dead?.[level] === true;
  const typed = dead || !own ? undefined : bindings.get(canonical(own));
  if (level < 2 || typed) {
    return finish(level, symbol, typed?.key ?? symbol, typed?.node, dead, mode);
  }
  const chord = bindings.get(canonical(`<a-${cap[(level - 2) as 0 | 1]}>`));
  return finish(level, symbol, chord?.key ?? `<a-${cap[(level - 2) as 0 | 1]}>`, chord?.node, dead, mode);
}

function finish(level: LayerLevel, symbol: string, notation: string, node: KeymapNode | undefined, dead: boolean, mode: MenuState["mode"]): LayerView {
  if (node) return { level, symbol, notation, state: "bound", row: toRow(notation, node) };
  if (dead) return { level, symbol, notation, state: "dead" };
  if (mode === "transform" && level < 2 && isDigit(symbol)) return { level, symbol, notation, state: "count" };
  return { level, symbol, notation, state: "unbound" };
}

/** Where a row starts. An ortholinear keyboard puts the first letter of every row in the same column, one to the right of the number row's first key. */
export function rowOffset(rowIndex: number, firstKeyIsIso: boolean, options: KeyboardOptions): number {
  const base = options.geometry === "ortholinear" ? (rowIndex === 0 ? 0 : 1) : (STAGGER[rowIndex] ?? 0);
  // A leading ISO key takes the column on the left of the row.
  return firstKeyIsIso && options.iso ? base - 1 : base;
}

export function buildKeyboardModel(keymap: Keymap, state: MenuState, options: KeyboardOptions): KeyboardModel {
  const layout = LAYOUTS[options.layout];
  const bindings = bindingsAt(keymap, state);
  const caps: CapView[][] = [];
  const placed = new Set<string>();

  layout.rows.forEach((keys, rowIndex) => {
    const leadingIso = keys.length > 0 && keys[0][4]?.iso === true;
    const offset = rowOffset(rowIndex, leadingIso, options);
    const row: CapView[] = [];
    for (const cap of keys) {
      if (cap[4]?.iso === true && !options.iso) continue;
      const layers = [0, 1, 2, 3].map((level) => resolveLayer(cap, level as LayerLevel, state.mode, bindings)) as CapView["layers"];
      for (const layer of layers) if (layer.state === "bound") placed.add(canonical(layer.notation));
      row.push({ row: rowIndex, col: row.length, offset, layers });
    }
    caps.push(row);
  });

  const tray: ViewRow[] = [];
  for (const [canon, entry] of bindings) {
    if (!placed.has(canon)) tray.push(toRow(entry.key, entry.node));
  }
  return { layout: options.layout, geometry: options.geometry, iso: options.iso, caps, tray };
}
