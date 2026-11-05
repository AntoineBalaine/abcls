import { parseNotation } from "./notation";
import { Action, ActionKind, ArgTemplate, Group, Keymap, KeymapNode, Leaf, MenuMode } from "./types";

export interface MergeResult {
  keymap: Keymap;
  errors: string[];
}

type PlainObject = Record<string, unknown>;

function isObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: PlainObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneArg(arg: ArgTemplate): ArgTemplate {
  return typeof arg === "object" && arg !== null ? { count: { ...arg.count } } : arg;
}

function cloneAction(action: Action): Action {
  return { kind: action.kind, name: action.name, args: action.args.map(cloneArg) };
}

function cloneNode(node: KeymapNode): KeymapNode {
  if (node.type === "leaf") {
    return { ...node, action: cloneAction(node.action) };
  }
  const children: Record<string, KeymapNode> = {};
  for (const [key, child] of Object.entries(node.children)) children[key] = cloneNode(child);
  return { ...node, children };
}

/**
 * Reads a text field of a patch. Because a patch comes from the user's settings, a field of the wrong type
 * is reported as an error instead of being trusted.
 */
function readString(patch: PlainObject, field: string, fallback: string | undefined, where: string, errors: string[]): string | undefined {
  if (!hasOwn(patch, field)) return fallback;
  if (typeof patch[field] !== "string") {
    errors.push(`${where}.${field}: must be a string`);
    return fallback;
  }
  return patch[field] as string;
}

/** Reads the action of a patch: the whole action is replaced, so it must be complete, and args defaults to an empty list. */
function readAction(value: unknown, where: string, errors: string[]): Action | undefined {
  if (!isObject(value)) {
    errors.push(`${where}.action: must be an object`);
    return undefined;
  }
  const args = hasOwn(value, "args") ? value.args : [];
  if (typeof value.kind !== "string" || typeof value.name !== "string" || !Array.isArray(args)) {
    errors.push(`${where}.action: needs a string kind, a string name and an args list`);
    return undefined;
  }
  return { kind: value.kind as ActionKind, name: value.name, args: args.map((arg) => cloneArg(arg as ArgTemplate)) };
}

function inferType(patch: PlainObject, existing: KeymapNode | undefined, where: string, errors: string[]): "leaf" | "group" | undefined {
  if (hasOwn(patch, "type")) {
    if (patch.type === "leaf" || patch.type === "group") return patch.type;
    errors.push(`${where}.type: must be "leaf" or "group"`);
    return undefined;
  }
  if (hasOwn(patch, "action") && hasOwn(patch, "children")) {
    errors.push(`${where}: a binding cannot have both an action and children`);
    return undefined;
  }
  if (hasOwn(patch, "action")) return "leaf";
  if (hasOwn(patch, "children")) return "group";
  if (existing) return existing.type;
  errors.push(`${where}: a new binding needs an action, or children for a group`);
  return undefined;
}

function mergeLeaf(existing: Leaf | undefined, patch: PlainObject, where: string, errors: string[]): Leaf | undefined {
  const label = readString(patch, "label", existing?.label, where, errors);
  const category = readString(patch, "category", existing?.category, where, errors);
  const short = readString(patch, "short", existing?.short, where, errors);
  const action = hasOwn(patch, "action") ? readAction(patch.action, where, errors) : existing?.action;
  if (label === undefined || category === undefined || action === undefined) {
    if (!existing) errors.push(`${where}: a new binding needs a label, a category and an action`);
    return existing;
  }
  const leaf: Leaf = { type: "leaf", label, category, action: cloneAction(action) };
  if (short !== undefined) leaf.short = short;
  const isNew = hasOwn(patch, "isNew") ? patch.isNew === true : existing?.isNew;
  if (isNew) leaf.isNew = true;
  return leaf;
}

function mergeGroup(existing: Group | undefined, patch: PlainObject, where: string, errors: string[]): Group | undefined {
  const label = readString(patch, "label", existing?.label, where, errors);
  const category = readString(patch, "category", existing?.category, where, errors);
  const short = readString(patch, "short", existing?.short, where, errors);
  if (hasOwn(patch, "children") && !isObject(patch.children)) {
    errors.push(`${where}.children: must be an object`);
    return existing;
  }
  if (label === undefined || category === undefined) {
    if (!existing) errors.push(`${where}: a new group needs a label and a category`);
    return existing;
  }
  const group: Group = { type: "group", label, category, children: existing ? (cloneNode(existing) as Group).children : {} };
  if (short !== undefined) group.short = short;
  if (hasOwn(patch, "children")) mergeChildren(group, patch.children as PlainObject, where, errors);
  return group;
}

/** A patch of the same type merges into the existing node; a patch of the other type replaces it, so it must be complete. */
function mergeNode(existing: KeymapNode | undefined, patch: unknown, where: string, errors: string[]): KeymapNode | undefined {
  if (!isObject(patch)) {
    errors.push(`${where}: the override must be an object or null`);
    return existing;
  }
  const type = inferType(patch, existing, where, errors);
  if (type === undefined) return existing;
  const base = existing && existing.type === type ? existing : undefined;
  const merged = type === "leaf" ? mergeLeaf(base as Leaf | undefined, patch, where, errors) : mergeGroup(base as Group | undefined, patch, where, errors);
  return merged ?? existing;
}

function mergeChildren(group: Group, overrides: PlainObject, where: string, errors: string[]): void {
  for (const [key, patch] of Object.entries(overrides)) {
    const here = `${where}.${key}`;
    if (!parseNotation(key)) {
      errors.push(`${here}: "${key}" is not a valid key notation`);
      continue;
    }
    if (patch === null) {
      delete group.children[key];
      continue;
    }
    const merged = mergeNode(group.children[key], patch, here, errors);
    if (merged) group.children[key] = merged;
  }
}

/** Merges the user's overrides into the defaults. It never throws: the problems come back as messages. */
export function mergeKeymap(defaults: Keymap, override: unknown): MergeResult {
  const keymap: Keymap = { select: cloneNode(defaults.select) as Group, transform: cloneNode(defaults.transform) as Group };
  const errors: string[] = [];
  if (override === undefined || override === null) return { keymap, errors };
  if (!isObject(override)) {
    errors.push("abc.keymap must be an object");
    return { keymap, errors };
  }
  for (const mode of ["select", "transform"] as MenuMode[]) {
    if (!hasOwn(override, mode)) continue;
    const section = override[mode];
    if (!isObject(section)) {
      errors.push(`${mode}: must be an object`);
      continue;
    }
    mergeChildren(keymap[mode], section, mode, errors);
  }
  for (const key of Object.keys(override)) {
    if (key !== "select" && key !== "transform") errors.push(`${key}: unknown section, expected "select" or "transform"`);
  }
  return { keymap, errors };
}
