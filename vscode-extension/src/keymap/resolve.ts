import { ArgTemplate, CountTemplate, Group, KeymapNode } from "./types";

/** Follows a path of group keys from the root, then looks up the key in the group that the path reaches. */
export function resolveKey(root: Group, path: string[], key: string): KeymapNode | undefined {
  const group = resolveGroup(root, path);
  if (!group) return undefined;
  return hasChild(group, key) ? group.children[key] : undefined;
}

/** Because a keymap that comes from the settings may lack the children of a group, the lookup checks them first. */
function hasChild(group: Group, key: string): boolean {
  return typeof group.children === "object" && group.children !== null && Object.prototype.hasOwnProperty.call(group.children, key);
}

export function resolveGroup(root: Group, path: string[]): Group | undefined {
  let node: KeymapNode = root;
  for (const key of path) {
    if (node.type !== "group") return undefined;
    if (!hasChild(node, key)) return undefined;
    node = node.children[key];
  }
  return node.type === "group" ? node : undefined;
}

function isCountTemplate(arg: ArgTemplate): arg is CountTemplate {
  return typeof arg === "object" && arg !== null && "count" in arg;
}

/** Because a count template stands for the number typed in the menu, we replace it by (count ?? default) * multiplier. */
export function expandArgs(args: ArgTemplate[], count: number | undefined): unknown[] {
  const expanded: unknown[] = [];
  for (const arg of args) {
    if (isCountTemplate(arg)) {
      expanded.push((count ?? arg.count.default) * arg.count.multiplier);
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
}
