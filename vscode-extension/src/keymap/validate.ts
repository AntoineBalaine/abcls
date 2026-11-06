import { formatNotation, parseNotation } from "./notation";
import { Group, Keymap, KeymapNode, MODE_ACTION_NAMES, MenuMode } from "./types";

const ACTION_KINDS = ["selector", "transform", "command", "mode"];

function isCountTemplate(arg: unknown): boolean {
  if (typeof arg !== "object" || arg === null || !("count" in arg)) return false;
  const count = (arg as { count: unknown }).count;
  return (
    typeof count === "object" &&
    count !== null &&
    typeof (count as { default: unknown }).default === "number" &&
    typeof (count as { multiplier: unknown }).multiplier === "number"
  );
}

function isCountLike(arg: unknown): boolean {
  return typeof arg === "object" && arg !== null;
}

function validateLeaf(node: KeymapNode & { type: "leaf" }, here: string, errors: string[]): void {
  if (typeof node.label !== "string" || typeof node.category !== "string") errors.push(`${here}: the label and the category must be strings`);
  const action = node.action;
  if (typeof action !== "object" || action === null || typeof action.name !== "string" || action.name === "") {
    errors.push(`${here}: the action has no name`);
    return;
  }
  if (!ACTION_KINDS.includes(action.kind)) errors.push(`${here}: "${action.kind}" is not an action kind`);
  if (action.kind === "mode" && !MODE_ACTION_NAMES.includes(action.name)) {
    errors.push(`${here}: "${action.name}" is not a mode, expected select, transform or toggle`);
  }
  if (!Array.isArray(action.args)) {
    errors.push(`${here}: the action args must be a list`);
    return;
  }
  for (const arg of action.args) {
    if (isCountLike(arg) && !isCountTemplate(arg)) errors.push(`${here}: a count argument needs a numeric default and a numeric multiplier`);
  }
  if (action.args.some(isCountTemplate) && action.kind !== "transform" && action.kind !== "selector") {
    errors.push(`${here}: a count argument is only meaningful on a transform or a selector`);
  }
}

function validateGroup(group: Group, where: string, errors: string[]): void {
  if (typeof group.children !== "object" || group.children === null) {
    errors.push(`${where}: the group has no children`);
    return;
  }
  const entries = Object.entries(group.children);
  if (entries.length === 0) errors.push(`${where}: the group is empty`);

  const seen = new Map<string, string>();
  for (const [key, node] of entries) {
    const here = `${where}.${key}`;
    const parsed = parseNotation(key);
    if (!parsed) {
      errors.push(`${here}: "${key}" is not a valid key notation`);
    } else {
      const canonical = formatNotation(parsed);
      const earlier = seen.get(canonical);
      if (earlier !== undefined) errors.push(`${here}: the key is already used by "${earlier}"`);
      seen.set(canonical, key);
    }
    if (typeof node !== "object" || node === null) {
      errors.push(`${here}: the binding must be an object`);
    } else if (node.type === "group") {
      validateGroup(node, here, errors);
    } else if (node.type === "leaf") {
      validateLeaf(node, here, errors);
    } else {
      errors.push(`${here}: the binding type must be "leaf" or "group"`);
    }
  }
}

/** Returns the problems of a keymap as messages, and an empty list when it is sound. It never throws. */
export function validateKeymap(keymap: Keymap): string[] {
  const errors: string[] = [];
  for (const mode of ["select", "transform"] as MenuMode[]) validateGroup(keymap[mode], mode, errors);
  return errors;
}
