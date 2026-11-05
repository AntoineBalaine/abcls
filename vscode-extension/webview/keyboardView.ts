/**
 * The keyboard view, which runs inside the webview.
 *
 * Every cap is a grid of four cells, one for each layer of the key: Shift top left, AltGr and Shift top right, base bottom left,
 * AltGr bottom right. A cell shows the character that its layer types and the short name of its binding, and a click on it presses
 * that binding. The model comes from the extension, which resolves what each layer does, so this file only draws.
 */

import { CapView, KeyboardModel, LayerView } from "../src/keyboard/keyboardModel";
import { CATEGORY_ORDER, categoryName } from "../src/menu/categories";
import { ViewRow } from "../src/menu/menuViewModel";
import { ToExtension } from "../src/menu/viewMessages";

export type Post = (message: ToExtension) => void;

export type Show = "all" | "0" | "1" | "2" | "3";

export type Size = "small" | "medium" | "large";

/** What the user chose in the page, which survives a reload of the page. */
export interface UiState {
  view: "both" | "keyboard" | "list";
  show: Show;
  free: boolean;
  /** How large the page is drawn: the keys, and the text of the page. */
  size: Size;
  highlight: string | null;
}

export const DEFAULT_UI: UiState = { view: "both", show: "all", free: false, size: "small", highlight: null };

export const LAYER_NAMES = ["base", "Shift", "AltGr", "AltGr+Shift"];

/** The cell of each layer in a cap: base bottom left, Shift top left, AltGr bottom right, AltGr and Shift top right. */
const QUADRANT = ["bl", "tl", "br", "tr"];
/** The order in which the cells are drawn, so that the grid fills from the top left. */
const DRAW_ORDER = [1, 3, 0, 2];

function element(doc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function groupMark(row: ViewRow): string {
  return row.isGroup && !row.short.endsWith("›") ? `${row.short} ›` : row.short;
}

function renderCell(doc: Document, layer: LayerView, cap: CapView, ui: UiState, post: Post, hover: (cap: CapView, level: number) => void): HTMLElement {
  const classes = ["cell", QUADRANT[layer.level]];
  if (layer.row) classes.push("b", `c-${layer.row.category}`);
  if (layer.state === "dead") classes.push("dead");
  if (layer.state === "count") classes.push("count");
  if (ui.free && layer.state === "unbound") classes.push("free");
  if (ui.show !== "all") classes.push(Number(ui.show) === layer.level ? "on" : "off");
  if (ui.highlight && (!layer.row || layer.row.category !== ui.highlight)) classes.push("dim");

  const cell = element(doc, "span", classes.join(" "));
  const head = element(doc, "span", "q", layer.symbol);
  if (layer.row?.isNew) head.append(element(doc, "span", "nw", "new"));
  cell.append(head);
  if (layer.row) cell.append(element(doc, "span", "lab", groupMark(layer.row)));
  else if (layer.state === "count") cell.append(element(doc, "span", "lab", "count"));

  if (layer.state === "bound" || layer.state === "count") {
    // Because a cell that can be pressed must be reachable without a mouse, it is a button for the keyboard and for a screen reader.
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    cell.setAttribute("aria-label", `${LAYER_NAMES[layer.level]} ${layer.symbol}: ${layer.row ? layer.row.label : "count digit"}`);
    cell.addEventListener("click", () => post({ type: "press", notation: layer.notation }));
    cell.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        post({ type: "press", notation: layer.notation });
      }
    });
  }
  cell.addEventListener("mouseenter", () => hover(cap, layer.level));
  return cell;
}

function renderCap(doc: Document, cap: CapView, ui: UiState, post: Post, hover: (cap: CapView, level: number) => void): HTMLElement {
  const classes = ["cap", "four"];
  if (ui.highlight && !cap.layers.some((layer) => layer.row?.category === ui.highlight)) classes.push("dim");
  const button = element(doc, "div", classes.join(" "));
  button.setAttribute("role", "group");
  button.setAttribute(
    "aria-label",
    cap.layers
      .map((layer) => `${LAYER_NAMES[layer.level]} ${layer.symbol}: ${layer.row ? layer.row.label : layer.state === "dead" ? "dead key" : "unbound"}`)
      .join("; ")
  );
  for (const level of DRAW_ORDER) button.append(renderCell(doc, cap.layers[level], cap, ui, post, hover));
  return button;
}

function renderTray(doc: Document, keyboard: KeyboardModel, post: Post): HTMLElement {
  const tray = element(doc, "div", "tray");
  for (const row of keyboard.tray) {
    const button = element(doc, "button", `trayKey c-${row.category}`);
    button.setAttribute("type", "button");
    button.append(element(doc, "kbd", "key", row.notation), element(doc, "span", "label", row.label));
    button.addEventListener("click", () => post({ type: "press", notation: row.notation }));
    tray.append(button);
  }
  return tray;
}

function renderLegend(doc: Document, keyboard: KeyboardModel, ui: UiState, rerender: () => void): HTMLElement {
  const legend = element(doc, "div", "legend");
  const present = new Set<string>();
  for (const cap of keyboard.caps.flat()) for (const layer of cap.layers) if (layer.row) present.add(layer.row.category);
  for (const row of keyboard.tray) present.add(row.category);
  for (const category of CATEGORY_ORDER.filter((id) => present.has(id))) {
    const chip = element(doc, "button", `chip c-${category}`, categoryName(category));
    chip.setAttribute("type", "button");
    chip.setAttribute("aria-pressed", String(ui.highlight === category));
    chip.addEventListener("click", () => {
      ui.highlight = ui.highlight === category ? null : category;
      rerender();
    });
    legend.append(chip);
  }
  return legend;
}

/** The detail of a key: its four layers, each with the character, the full name, the Alt chord it stands for, and the action. */
export function renderDetail(doc: Document, hovered: { cap: CapView; level: number } | null): HTMLElement {
  const detail = element(doc, "div", "detail");
  if (!hovered) {
    detail.append(element(doc, "div", "hint", "Hover a key to read the four layers of it. A click on a cell presses it."));
    return detail;
  }
  detail.append(element(doc, "div", "detail-title", "the four layers of this key"));
  for (const level of [1, 0, 3, 2]) {
    const layer = hovered.cap.layers[level];
    const row = element(doc, "div", `layer-row${level === hovered.level ? " on" : ""}${layer.row ? ` c-${layer.row.category}` : ""}`);
    row.append(element(doc, "span", "where", LAYER_NAMES[level]), element(doc, "kbd", "key", layer.symbol));
    if (layer.row) {
      row.append(element(doc, "span", "label", layer.row.label));
      if (layer.notation !== layer.symbol) row.append(element(doc, "code", "chord", layer.notation));
      row.append(element(doc, "span", "pill", categoryName(layer.row.category)));
      if (layer.row.isNew) row.append(element(doc, "span", "pill", "new, not in Kakoune"));
      row.append(element(doc, "code", "action", layer.row.action));
    } else {
      row.append(
        element(doc, "span", "dash", layer.state === "dead" ? "dead key, it waits for a letter" : layer.state === "count" ? "count digit" : "unbound")
      );
    }
    detail.append(row);
  }
  return detail;
}

function button(doc: Document, label: string, pressed: boolean, onClick: () => void): HTMLElement {
  const node = element(doc, "button", "choice", label);
  node.setAttribute("type", "button");
  node.setAttribute("aria-pressed", String(pressed));
  node.addEventListener("click", onClick);
  return node;
}

/** Makes a group of buttons of which one is pressed. */
function choiceGroup<T extends string>(doc: Document, options: Array<[T, string]>, current: T, onChoose: (value: T) => void): HTMLElement {
  const group = element(doc, "div", "choices");
  for (const [value, label] of options) group.append(button(doc, label, current === value, () => onChoose(value)));
  return group;
}

/**
 * The controls. The first row is what the keyboard is: its layout, its geometry and the ISO keys, which the page writes to the
 * settings through the extension. The second row is what the page shows: the view, the layer to emphasize, the size, and the free keys.
 */
export function renderControls(
  doc: Document,
  ui: UiState,
  keyboard: KeyboardModel | undefined,
  post: Post,
  rerender: () => void,
  lead?: HTMLElement
): HTMLElement {
  const bar = element(doc, "div", "controls");
  if (lead) bar.append(lead);
  const label = (text: string): HTMLElement => element(doc, "span", "label", text);

  if (keyboard) {
    bar.append(
      label("Layout"),
      choiceGroup(
        doc,
        [
          ["qwerty", "QWERTY"],
          ["bepo", "BÉPO"],
        ],
        keyboard.layout,
        (value) => post({ type: "keyboard", layout: value })
      ),
      label("Keys"),
      choiceGroup(
        doc,
        [
          ["staggered", "staggered"],
          ["ortholinear", "ortholinear"],
        ],
        keyboard.geometry,
        (value) => post({ type: "keyboard", geometry: value })
      ),
      button(doc, "ISO keys", keyboard.iso, () => post({ type: "keyboard", iso: !keyboard.iso }))
    );
  }
  bar.append(
    label("View"),
    choiceGroup(
      doc,
      [
        ["both", "keyboard and list"],
        ["keyboard", "keyboard"],
        ["list", "list"],
      ] as Array<[UiState["view"], string]>,
      ui.view,
      (value) => {
        ui.view = value;
        rerender();
      }
    ),
    label("Show"),
    choiceGroup(
      doc,
      [
        ["all", "all layers"],
        ["0", "base"],
        ["1", "Shift"],
        ["2", "AltGr"],
        ["3", "AltGr+Shift"],
      ] as Array<[Show, string]>,
      ui.show,
      (value) => {
        ui.show = value;
        rerender();
      }
    ),
    label("Size"),
    choiceGroup(
      doc,
      [
        ["small", "S"],
        ["medium", "M"],
        ["large", "L"],
      ] as Array<[Size, string]>,
      ui.size,
      (value) => {
        ui.size = value;
        rerender();
      }
    ),
    button(doc, "highlight free keys", ui.free, () => {
      ui.free = !ui.free;
      rerender();
    })
  );
  return bar;
}

/** The smallest and the largest width of a cap, in pixels, for each size of the page. */
const UNIT_RANGE: Record<Size, [number, number]> = { small: [64, 112], medium: [84, 132], large: [104, 152] };

/** The size of the caps: the width that the board has allows, between the bounds of the size, and below the minimum the board scrolls. */
export function fitUnit(keyboard: KeyboardModel, availableWidth: number, size: Size = "medium"): number {
  const [least, most] = UNIT_RANGE[size];
  const widest = Math.max(1, ...keyboard.caps.map((row) => (row[0]?.offset ?? 0) + row.length));
  if (availableWidth <= 0) return Math.round((least + most) / 2);
  return Math.max(least, Math.min(most, Math.floor((availableWidth - 12 * 4) / widest)));
}

export function renderKeyboard(doc: Document, keyboard: KeyboardModel, ui: UiState, post: Post, rerender: () => void, availableWidth: number): HTMLElement {
  const section = element(doc, "section", "keyboard");
  const unit = fitUnit(keyboard, availableWidth, ui.size);
  section.style.setProperty("--u", `${unit}px`);
  // The text of the cells follows the width of the caps and does not get smaller than what can be read. The height of a cap is what two
  // lines of text need in each of its two rows of cells, because most names fit in two lines and a third line would be empty space.
  const fontSize = Math.max(7.5, Math.round(unit * 0.085 * 10) / 10);
  const height = Math.round(fontSize * 4.4 + 14);
  section.style.setProperty("--ch", `${height}px`);
  section.style.setProperty("--fs", `${fontSize}px`);

  const detailSlot = element(doc, "div", "detail-slot");
  detailSlot.append(renderDetail(doc, null));
  const hover = (cap: CapView, level: number): void => {
    detailSlot.replaceChildren(renderDetail(doc, { cap, level }));
  };

  if (keyboard.tray.length > 0) section.append(renderTray(doc, keyboard, post));
  const wrap = element(doc, "div", "board-wrap");
  const board = element(doc, "div", "board");
  for (const row of keyboard.caps) {
    const rowNode = element(doc, "div", "row-of-caps");
    rowNode.style.marginLeft = `calc(${row[0]?.offset ?? 0} * (var(--u) + var(--gap)))`;
    for (const cap of row) rowNode.append(renderCap(doc, cap, ui, post, hover));
    board.append(rowNode);
  }
  wrap.append(board);
  section.append(wrap, renderLegend(doc, keyboard, ui, rerender), detailSlot);
  return section;
}
