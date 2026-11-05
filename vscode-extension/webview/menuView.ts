/**
 * The script of the menu view, which runs inside the webview.
 *
 * It draws the model that the extension sends: the breadcrumb, the count, and the keys of the current menu grouped by category.
 * A click on a key sends it back to the extension, which handles it as a key press.
 */

import { CATEGORY_ORDER, categoryName } from "../src/menu/categories";
import { ViewModel, ViewRow } from "../src/menu/menuViewModel";
import { ToExtension } from "../src/menu/viewMessages";

export type Post = (message: ToExtension) => void;

function element(doc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The notation as it is written in the keymap, with the arrows spelled as arrows, which a reader finds easier. */
export function displayNotation(notation: string): string {
  return notation
    .replace(/up>/, "↑>")
    .replace(/down>/, "↓>")
    .replace(/left>/, "←>")
    .replace(/right>/, "→>");
}

function groupByCategory(rows: ViewRow[]): Array<{ category: string; rows: ViewRow[] }> {
  const known = CATEGORY_ORDER.filter((category) => rows.some((row) => row.category === category));
  const unknown = Array.from(new Set(rows.map((row) => row.category))).filter((category) => !CATEGORY_ORDER.includes(category));
  const groups: Array<{ category: string; rows: ViewRow[] }> = [];
  for (const category of [...known, ...unknown]) {
    groups.push({ category, rows: rows.filter((row) => row.category === category) });
  }
  return groups;
}

function renderRow(doc: Document, row: ViewRow, post: Post): HTMLElement {
  const button = element(doc, "button", `row c-${row.category}`);
  button.setAttribute("type", "button");
  button.setAttribute("data-notation", row.notation);
  button.append(element(doc, "kbd", "key", displayNotation(row.notation)));
  button.append(element(doc, "span", "label", row.label));
  if (row.isGroup) button.append(element(doc, "span", "marker", "›"));
  if (row.isNew) button.append(element(doc, "span", "tag", "new"));
  button.addEventListener("click", () => post({ type: "press", notation: row.notation }));
  return button;
}

export function renderModel(root: HTMLElement, model: ViewModel, post: Post): void {
  const doc = root.ownerDocument;
  root.replaceChildren();

  const header = element(doc, "div", "header");
  const crumb = element(doc, "div", "crumb");
  model.breadcrumb.forEach((label, index) => {
    if (index > 0) crumb.append(element(doc, "span", "sep", "›"));
    crumb.append(element(doc, "span", index === model.breadcrumb.length - 1 ? "node current" : "node", label));
  });
  header.append(crumb);
  if (model.mode === "transform") header.append(element(doc, "span", "count", `count ${model.count === "" ? "–" : model.count}`));
  header.append(element(doc, "span", model.open ? "state open" : "state closed", model.open ? "menu open" : "menu closed"));
  root.append(header);

  for (const group of groupByCategory(model.rows)) {
    const section = element(doc, "section", `category c-${group.category}`);
    section.append(element(doc, "h2", "category-name", categoryName(group.category)));
    const list = element(doc, "div", "rows");
    for (const row of group.rows) list.append(renderRow(doc, row, post));
    section.append(list);
    root.append(section);
  }
}

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

function start(): void {
  const api = acquireVsCodeApi();
  const root = document.getElementById("root");
  if (!root) return;
  const post: Post = (message) => api.postMessage(message);
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; model?: ViewModel } | null | undefined;
    if (message && message.type === "model" && message.model) renderModel(root, message.model, post);
  });
  post({ type: "ready" });
}

if (typeof acquireVsCodeApi === "function") start();
