/**
 * The tables of keys for the documentation.
 *
 * Because the keymap is data, the documentation page takes its tables from it, and a test fails when the page falls behind.
 * Nothing here imports vscode.
 */

import { CATEGORY_ORDER, categoryName } from "../menu/categories";
import { Group, Keymap, KeymapNode, MenuMode } from "./types";

export const TABLES_START = "{/* keymap-tables:start */}";
export const TABLES_END = "{/* keymap-tables:end */}";

interface TableRow {
  keys: string;
  label: string;
  category: string;
  isNew: boolean;
}

function collectRows(group: Group, prefix: string[], out: TableRow[]): void {
  for (const [key, node] of Object.entries(group.children)) {
    const keys = [...prefix, key].join(" ");
    out.push({ keys, label: describe(node), category: node.category, isNew: node.type === "leaf" && node.isNew === true });
    if (node.type === "group") collectRows(node, [...prefix, key], out);
  }
}

/** A key that opens a smaller menu ends with the arrow, as it does in the view. */
function describe(node: KeymapNode): string {
  return node.type === "group" ? `${node.label.replace(/…/g, "").trim()} ›` : node.label;
}

/**
 * The text of a table cell. The pipe would break the table, and in MDX a less-than sign starts a tag and a brace starts an
 * expression, so those characters are escaped. A key in backticks is code and needs none of this.
 */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function tableOf(group: Group): string {
  const rows: TableRow[] = [];
  collectRows(group, [], rows);
  const order = (category: string): number => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  // The sort is stable, so inside a category the keys stay in the order of the keymap.
  const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => order(a.row.category) - order(b.row.category) || a.index - b.index);
  const header = ["Key", "What it does", "Category"];
  const body = sorted.map(({ row }) => [
    `\`${row.keys.replace(/\|/g, "\\|")}\``,
    `${cell(row.label)}${row.isNew ? " (new, not in Kakoune)" : ""}`,
    cell(categoryName(row.category)),
  ]);
  return formatTable(header, body);
}

/** Writes a table with its columns padded to the widest cell, which is the shape that prettier gives a markdown table, so that the two never disagree. */
function formatTable(header: string[], body: string[][]): string {
  const widths = header.map((title, column) => Math.max(title.length, 3, ...body.map((row) => row[column].length)));
  const line = (cells: string[]): string => `| ${cells.map((text, column) => text.padEnd(widths[column])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(header), separator, ...body.map(line)].join("\n");
}

/** The two tables, each under its heading, in the markdown of the documentation page. */
export function buildKeymapTables(keymap: Keymap): string {
  const modes: MenuMode[] = ["select", "transform"];
  const parts: string[] = [];
  for (const mode of modes) {
    parts.push(`### Keys of the ${mode} menu\n\n${tableOf(keymap[mode])}`);
  }
  return parts.join("\n\n");
}

/**
 * Replaces the part of a page between the markers. When a marker is missing, or the end comes before the start, it returns undefined,
 * so that a page that lost a marker is reported and not taken for a page that is up to date.
 */
export function withTables(page: string, tables: string): string | undefined {
  const start = page.indexOf(TABLES_START);
  const end = start === -1 ? -1 : page.indexOf(TABLES_END, start + TABLES_START.length);
  if (start === -1 || end === -1) return undefined;
  return `${page.slice(0, start + TABLES_START.length)}\n\n${tables}\n\n${page.slice(end)}`;
}
