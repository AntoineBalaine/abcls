/**
 * The script of the menu view, which runs inside the webview.
 *
 * It draws the model that the extension sends: the breadcrumb, the count, and the keys of the current menu grouped by category.
 * A click on a key sends it back to the extension, which handles it as a key press.
 */

import { CATEGORY_ORDER, categoryName } from "../src/menu/categories";
import { ViewModel, ViewRow } from "../src/menu/menuViewModel";
import { ToExtension, ToWebview } from "../src/menu/viewMessages";
import { DEFAULT_UI, Show, UiState, renderControls, renderKeyboard } from "./keyboardView";

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

function renderHeader(doc: Document, model: ViewModel): HTMLElement {
  const header = element(doc, "div", "header");
  const crumb = element(doc, "div", "crumb");
  model.breadcrumb.forEach((label, index) => {
    if (index > 0) crumb.append(element(doc, "span", "sep", "›"));
    crumb.append(element(doc, "span", index === model.breadcrumb.length - 1 ? "node current" : "node", label));
  });
  header.append(crumb);
  if (model.mode === "transform") header.append(element(doc, "span", "count", `count ${model.count === "" ? "–" : model.count}`));
  header.append(element(doc, "span", model.open ? "state open" : "state closed", model.open ? "menu open" : "menu closed"));
  return header;
}

function renderList(doc: Document, model: ViewModel, post: Post): HTMLElement {
  const list = element(doc, "div", "list");
  for (const group of groupByCategory(model.rows)) {
    const section = element(doc, "section", `category c-${group.category}`);
    section.append(element(doc, "h2", "category-name", categoryName(group.category)));
    const rows = element(doc, "div", "rows");
    for (const row of group.rows) rows.append(renderRow(doc, row, post));
    section.append(rows);
    list.append(section);
  }
  return list;
}

/** Draws the header and the list. */
export function renderModel(root: HTMLElement, model: ViewModel, post: Post): void {
  const doc = root.ownerDocument;
  root.replaceChildren(renderHeader(doc, model), renderList(doc, model, post));
}

/**
 * Draws the whole page: the header, then, when the extension sent a keyboard model, the controls and the keyboard, and the list.
 * The choices of the user are in ui, and a change of them draws the page again from the same message.
 */
export function renderApp(root: HTMLElement, message: ToWebview, ui: UiState, post: Post, availableWidth: number, onUiChange: (ui: UiState) => void): void {
  const doc = root.ownerDocument;
  const rerender = (): void => {
    onUiChange(ui);
    renderApp(root, message, ui, post, availableWidth, onUiChange);
  };
  // Because the chip of a category exists only while the model has keys of it, a highlight of a category that has gone would dim the whole board.
  if (ui.highlight !== null && !categoriesOf(message).has(ui.highlight)) ui.highlight = null;
  const scrollLeft = root.querySelector(".board-wrap")?.scrollLeft ?? 0;

  const parts: HTMLElement[] = [renderHeader(doc, message.model)];
  if (message.keyboard) {
    parts.push(renderControls(doc, ui, rerender));
    if (ui.view !== "list") parts.push(renderKeyboard(doc, message.keyboard, ui, post, rerender, availableWidth));
  }
  if (ui.view !== "keyboard" || !message.keyboard) parts.push(renderList(doc, message.model, post));
  root.replaceChildren(...parts);
  // A page that is drawn again must not throw the board back to its left edge, which is what happens in a narrow panel at every key.
  const wrap = root.querySelector(".board-wrap");
  if (wrap) wrap.scrollLeft = scrollLeft;
}

function categoriesOf(message: ToWebview): Set<string> {
  const categories = new Set<string>();
  for (const row of message.model.rows) categories.add(row.category);
  for (const cap of message.keyboard?.caps.flat() ?? []) for (const layer of cap.layers) if (layer.row) categories.add(layer.row.category);
  for (const row of message.keyboard?.tray ?? []) categories.add(row.category);
  return categories;
}

declare function acquireVsCodeApi(): unknown;

const VIEWS: UiState["view"][] = ["both", "keyboard", "list"];
const SHOWS: Show[] = ["all", "0", "1", "2", "3"];

/** Reads the saved choices. A field that is missing or has an unknown value gets its default, and the highlight is never kept. */
export function loadUi(saved: unknown): UiState {
  const source = typeof saved === "object" && saved !== null ? (saved as Partial<Record<keyof UiState, unknown>>) : {};
  return {
    view: VIEWS.includes(source.view as UiState["view"]) ? (source.view as UiState["view"]) : DEFAULT_UI.view,
    show: SHOWS.includes(source.show as Show) ? (source.show as Show) : DEFAULT_UI.show,
    free: typeof source.free === "boolean" ? source.free : DEFAULT_UI.free,
    highlight: null,
  };
}

/** True when a message from the extension has the shape that the page draws. */
export function isModelMessage(message: unknown): message is ToWebview {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; model?: { rows?: unknown; breadcrumb?: unknown }; keyboard?: { caps?: unknown; tray?: unknown } };
  if (candidate.type !== "model" || !candidate.model || !Array.isArray(candidate.model.rows) || !Array.isArray(candidate.model.breadcrumb)) return false;
  return candidate.keyboard === undefined || (Array.isArray(candidate.keyboard.caps) && Array.isArray(candidate.keyboard.tray));
}

function start(): void {
  const api = acquireVsCodeApi() as { postMessage(message: unknown): void; getState?: () => unknown; setState?: (state: unknown) => void };
  const root = document.getElementById("root");
  if (!root) return;
  const post: Post = (message) => api.postMessage(message);
  const ui = loadUi(api.getState ? api.getState() : undefined);
  const save = (state: UiState): void => api.setState?.({ view: state.view, show: state.show, free: state.free });
  let last: ToWebview | undefined;
  const draw = (): void => {
    if (last) renderApp(root, last, ui, post, root.clientWidth - 28, save);
  };
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isModelMessage(event.data)) return;
    last = event.data;
    draw();
  });
  // Because the size of the caps follows the width, the page is drawn again when its panel is resized.
  window.addEventListener("resize", draw);
  post({ type: "ready" });
}

if (typeof acquireVsCodeApi === "function") start();
