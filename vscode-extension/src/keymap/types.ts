/**
 * Types of the modal keymap.
 *
 * The keymap is plain data: the menus of the select and transform modes, with their keys
 * written in the Kakoune notation (see notation.ts). Nothing here imports vscode, so the
 * engine, the views and the tests can all use it.
 */

export type ActionKind = "selector" | "transform" | "command" | "mode";

/**
 * An argument that comes from the count typed in the transform menu:
 * the result is (count ?? default) * multiplier.
 */
export interface CountTemplate {
  count: { default: number; multiplier: number };
}

export type ArgTemplate = string | number | boolean | null | CountTemplate;

export interface Action {
  kind: ActionKind;
  name: string;
  args: ArgTemplate[];
}

export interface Leaf {
  type: "leaf";
  label: string;
  /** The name that fits a keyboard cell, about ten characters. When absent, the label is used. */
  short?: string;
  category: string;
  action: Action;
  isNew?: boolean;
}

export interface Group {
  type: "group";
  label: string;
  short?: string;
  category: string;
  children: Record<string, KeymapNode>;
}

export type KeymapNode = Leaf | Group;

export type MenuMode = "select" | "transform";

export interface Keymap {
  select: Group;
  transform: Group;
}

/** The shape of the setting abc.keymap. A null removes a default binding. */
export interface KeymapOverride {
  select?: Record<string, Partial<Leaf> | Partial<Group> | null>;
  transform?: Record<string, Partial<Leaf> | Partial<Group> | null>;
}

export const MODE_ACTION_NAMES = ["select", "transform", "toggle"];
