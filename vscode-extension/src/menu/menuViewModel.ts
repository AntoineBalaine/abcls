/**
 * The model that the views draw: the rows of the menu at the current path.
 * It is pure, so the extension and the tests build the same model.
 */

import { resolveGroup } from "../keymap/resolve";
import { Group, Keymap, KeymapNode } from "../keymap/types";
import { MenuState } from "./menuState";

export interface ViewRow {
  notation: string;
  label: string;
  /** The name that fits a keyboard cell: the short name of the node, or its label. */
  short: string;
  category: string;
  isGroup: boolean;
  isNew: boolean;
  /** What the key does, for the detail of a key: the kind and name of the action, or the size of a group. */
  action: string;
}

export interface ViewModel {
  mode: "select" | "transform";
  open: boolean;
  /** The mode, then the labels of the groups that were opened. */
  breadcrumb: string[];
  count: string;
  rows: ViewRow[];
}

function describeAction(node: KeymapNode): string {
  if (node.type === "group") return `menu of ${Object.keys(node.children).length} keys`;
  return node.action.kind === "mode" ? `switch to ${node.action.name}` : `${node.action.kind} ${node.action.name}`;
}

export function toRow(notation: string, node: KeymapNode): ViewRow {
  return {
    notation,
    label: node.label,
    short: node.short ?? node.label,
    category: node.category,
    isGroup: node.type === "group",
    isNew: node.type === "leaf" && node.isNew === true,
    action: describeAction(node),
  };
}

function isModeLeaf(node: KeymapNode): boolean {
  return node.type === "leaf" && node.action.kind === "mode";
}

function rowsOf(group: Group, modeKeysOnly: boolean): ViewRow[] {
  const rows: ViewRow[] = [];
  for (const [notation, node] of Object.entries(group.children)) {
    if (modeKeysOnly && !isModeLeaf(node)) continue;
    rows.push(toRow(notation, node));
  }
  return rows;
}

function cleanLabel(label: string): string {
  return label.replace(/…/g, "").trim();
}

/**
 * Builds the model for a state. A path that no longer resolves, for example after a change of abc.keymap,
 * gives the rows of the root and no group in the breadcrumb. Inside a group the mode keys of the root are listed too,
 * because they work there.
 */
export function buildViewModel(keymap: Keymap, state: MenuState): ViewModel {
  const root = keymap[state.mode];
  const group = resolveGroup(root, state.path);
  const path = group ? state.path : [];
  const current = group ?? root;

  const breadcrumb: string[] = [state.mode];
  let node: Group = root;
  for (const key of path) {
    const child = node.children[key];
    if (child.type !== "group") break;
    breadcrumb.push(cleanLabel(child.label));
    node = child;
  }

  const rows = rowsOf(current, false);
  if (path.length > 0) {
    for (const row of rowsOf(root, true)) {
      if (!rows.some((existing) => existing.notation === row.notation)) rows.push(row);
    }
  }
  return { mode: state.mode, open: state.open, breadcrumb, count: state.count, rows };
}
