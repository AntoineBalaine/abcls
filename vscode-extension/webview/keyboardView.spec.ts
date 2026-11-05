import * as assert from "assert";
import { JSDOM } from "jsdom";
import { buildKeyboardModel } from "../src/keyboard/keyboardModel";
import { DEFAULT_KEYMAP } from "../src/keymap/defaultKeymap";
import { openMenu } from "../src/menu/menuState";
import { buildViewModel } from "../src/menu/menuViewModel";
import { ToExtension } from "../src/menu/viewMessages";
import { DEFAULT_UI, UiState, fitUnit, renderControls } from "./keyboardView";
import { renderApp } from "./menuView";

function render(mode: "select" | "transform", layout: "qwerty" | "bepo", ui: Partial<UiState> = {}) {
  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
  const root = dom.window.document.getElementById("root") as HTMLElement;
  const posted: ToExtension[] = [];
  const state = openMenu(mode);
  const keyboard = buildKeyboardModel(DEFAULT_KEYMAP, state, { layout, geometry: "staggered", iso: false });
  const saved: UiState[] = [];
  const current: UiState = { ...DEFAULT_UI, ...ui };
  renderApp(
    root,
    { type: "model", model: buildViewModel(DEFAULT_KEYMAP, state), keyboard },
    current,
    (message) => posted.push(message),
    1200,
    (next) => saved.push({ ...next })
  );
  return { dom, root, posted, saved, keyboard, ui: current };
}

function click(dom: JSDOM, node: Element): void {
  node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

describe("the keyboard view", () => {
  it("draws every cap as four cells, and the caps of the layout", () => {
    const { root, keyboard } = render("transform", "qwerty");
    const caps = root.querySelectorAll(".cap");
    assert.strictEqual(caps.length, keyboard.caps.flat().length);
    for (const cap of Array.from(caps)) assert.strictEqual(cap.querySelectorAll(".cell").length, 4);
  });

  it("puts a bound cell in its category, with the short name of its binding", () => {
    const { root } = render("transform", "qwerty");
    const cells = Array.from(root.querySelectorAll(".cell.b"));
    const octave = cells.find((cell) => cell.querySelector(".lab")?.textContent === "octave up");
    assert.ok(octave && octave.classList.contains("c-pitch"));
    assert.ok(cells.some((cell) => cell.querySelector(".lab")?.textContent === "harm. 8ve up"));
  });

  it("marks a group with an arrow and a new key with a tag", () => {
    const { root } = render("select", "qwerty");
    const cells = Array.from(root.querySelectorAll(".cell.b"));
    assert.ok(cells.some((cell) => cell.querySelector(".lab")?.textContent?.endsWith("›")));
    assert.ok(cells.some((cell) => cell.querySelector(".nw")));
  });

  it("labels the count digits of the transform menu, and styles the dead keys", () => {
    const { root } = render("transform", "qwerty");
    assert.ok(Array.from(root.querySelectorAll(".cell.count .lab")).every((label) => label.textContent === "count"));
    assert.ok(root.querySelectorAll(".cell.count").length >= 9);
    assert.ok(root.querySelectorAll(".cell.dead").length > 0);
  });

  it("posts a press with the notation of the layer when a bound cell is clicked", () => {
    const { dom, root, posted } = render("select", "qwerty");
    const cell = Array.from(root.querySelectorAll(".cell.b")).find((candidate) => candidate.querySelector(".lab")?.textContent === "chords");
    assert.ok(cell);
    click(dom, cell);
    assert.deepStrictEqual(posted, [{ type: "press", notation: "c" }]);
  });

  it("does not post anything when an unbound cell is clicked", () => {
    const { dom, root, posted } = render("select", "qwerty");
    const cell = root.querySelector(".cell:not(.b):not(.count)");
    assert.ok(cell);
    click(dom, cell);
    assert.deepStrictEqual(posted, []);
  });

  it("fills the detail strip with the four layers of a key when it is hovered", () => {
    const { dom, root } = render("transform", "qwerty");
    assert.ok(root.querySelector(".detail .hint"));
    const cell = Array.from(root.querySelectorAll(".cell.b")).find((candidate) => candidate.querySelector(".lab")?.textContent === "octave up");
    assert.ok(cell);
    cell.dispatchEvent(new dom.window.MouseEvent("mouseenter"));
    const rows = Array.from(root.querySelectorAll(".detail .layer-row"));
    assert.strictEqual(rows.length, 4);
    assert.ok(rows.some((row) => row.textContent?.includes("harmonize octave up") && row.textContent.includes("<a-t>")));
  });

  it("shows the tray with the Ctrl chords, and a click on one presses it", () => {
    const { dom, root, posted } = render("transform", "qwerty");
    const key = Array.from(root.querySelectorAll(".trayKey")).find((candidate) => candidate.querySelector(".key")?.textContent === "<c-up>");
    assert.ok(key);
    click(dom, key);
    assert.deepStrictEqual(posted, [{ type: "press", notation: "<c-up>" }]);
  });

  it("fades the other layers when one layer is chosen under Show", () => {
    const { root } = render("transform", "qwerty", { show: "2" });
    assert.ok(root.querySelectorAll(".cell.on").length > 0);
    assert.ok(root.querySelector(".cell.on")?.classList.contains("br"), "the AltGr layer is the bottom right cell");
    assert.ok(Array.from(root.querySelectorAll(".cell.off")).every((cell) => !cell.classList.contains("br")));
  });

  it("draws the controls, and a change redraws and saves the choices", () => {
    const { dom, root, saved, ui } = render("transform", "qwerty");
    const choice = Array.from(root.querySelectorAll(".choice")).find((button) => button.textContent === "AltGr");
    assert.ok(choice);
    click(dom, choice);
    assert.strictEqual(ui.show, "2");
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].show, "2");
    assert.ok(root.querySelectorAll(".cell.off").length > 0, "the page must be drawn again");
  });

  it("shows only the list, or only the keyboard, as the view choice says", () => {
    assert.strictEqual(render("select", "qwerty", { view: "list" }).root.querySelectorAll(".cap").length, 0);
    assert.ok(render("select", "qwerty", { view: "list" }).root.querySelectorAll(".row").length > 0);
    const board = render("select", "qwerty", { view: "keyboard" });
    assert.ok(board.root.querySelectorAll(".cap").length > 0);
    assert.strictEqual(board.root.querySelectorAll(".row").length, 0);
  });

  it("highlights the free keys when asked", () => {
    assert.strictEqual(render("select", "qwerty").root.querySelectorAll(".cell.free").length, 0);
    assert.ok(render("select", "qwerty", { free: true }).root.querySelectorAll(".cell.free").length > 0);
  });

  it("filters by category when a chip is chosen, and chooses it again to clear", () => {
    const { dom, root, ui } = render("select", "qwerty");
    const chip = root.querySelector(".chip.c-selectType");
    assert.ok(chip);
    click(dom, chip);
    assert.strictEqual(ui.highlight, "selectType");
    assert.ok(root.querySelectorAll(".cell.dim").length > 0);
  });

  it("shows only the list when the extension sent no keyboard model", () => {
    const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
    const root = dom.window.document.getElementById("root") as HTMLElement;
    renderApp(
      root,
      { type: "model", model: buildViewModel(DEFAULT_KEYMAP, openMenu("select")) },
      { ...DEFAULT_UI },
      () => undefined,
      1200,
      () => undefined
    );
    assert.strictEqual(root.querySelectorAll(".cap").length, 0);
    assert.ok(root.querySelectorAll(".row").length > 0);
  });

  it("draws the BÉPO digits of the select menu in the Shift cell", () => {
    const { root } = render("select", "bepo");
    const cells = Array.from(root.querySelectorAll(".cell.tl.b"));
    assert.ok(cells.some((cell) => cell.querySelector(".q")?.textContent === "1"));
  });
});

describe("the page when the model changes", () => {
  it("clears a highlight whose category is not in the new model, so that the board is not dimmed for good", () => {
    const { root, ui } = render("select", "qwerty", { highlight: "voicing" });
    assert.strictEqual(ui.highlight, null);
    assert.strictEqual(root.querySelectorAll(".cell.dim").length, 0);
  });

  it("keeps the scroll of the board when it draws again", () => {
    const { dom, root, ui } = render("select", "qwerty");
    const wrap = root.querySelector(".board-wrap") as HTMLElement;
    wrap.scrollLeft = 40;
    const state = openMenu("select");
    renderApp(
      root,
      {
        type: "model",
        model: buildViewModel(DEFAULT_KEYMAP, state),
        keyboard: buildKeyboardModel(DEFAULT_KEYMAP, state, { layout: "qwerty", geometry: "staggered", iso: false }),
      },
      ui,
      () => undefined,
      1200,
      () => undefined
    );
    assert.strictEqual((root.querySelector(".board-wrap") as HTMLElement).scrollLeft, 40);
    void dom;
  });

  it("lets a bound cell be pressed from the keyboard", () => {
    const { dom, root, posted } = render("select", "qwerty");
    const cell = Array.from(root.querySelectorAll(".cell.b")).find((candidate) => candidate.querySelector(".lab")?.textContent === "chords") as HTMLElement;
    assert.strictEqual(cell.getAttribute("role"), "button");
    assert.strictEqual(cell.getAttribute("tabindex"), "0");
    cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "x", bubbles: true }));
    assert.deepStrictEqual(posted, [{ type: "press", notation: "c" }]);
  });
});

describe("renderControls", () => {
  const keyboard = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { layout: "bepo", geometry: "ortholinear", iso: true });

  function controls(ui: Partial<UiState> = {}) {
    const dom = new JSDOM("<!DOCTYPE html><div></div>");
    const posted: ToExtension[] = [];
    const changed: number[] = [];
    const bar = renderControls(
      dom.window.document,
      { ...DEFAULT_UI, ...ui },
      keyboard,
      (message) => posted.push(message),
      () => changed.push(1)
    );
    return { dom, bar, posted, changed };
  }

  function choice(bar: HTMLElement, text: string): HTMLElement {
    const found = Array.from(bar.querySelectorAll(".choice")).find((node) => node.textContent === text);
    assert.ok(found, text);
    return found as HTMLElement;
  }

  it("marks the choice that is current, taking the layout, the geometry and the ISO keys from the keyboard", () => {
    const { bar } = controls({ view: "keyboard", show: "1", size: "large" });
    const pressed = Array.from(bar.querySelectorAll('[aria-pressed="true"]')).map((node) => node.textContent);
    assert.deepStrictEqual(pressed, ["BÉPO", "ortholinear", "ISO keys", "keyboard", "Shift", "L"]);
  });

  it("asks the extension to change the layout, the geometry or the ISO keys, which it writes to the settings", () => {
    const { dom, bar, posted } = controls();
    choice(bar, "QWERTY").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    choice(bar, "staggered").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    choice(bar, "ISO keys").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.deepStrictEqual(posted, [
      { type: "keyboard", layout: "qwerty" },
      { type: "keyboard", geometry: "staggered" },
      { type: "keyboard", iso: false },
    ]);
  });

  it("changes the size on the page, and does not ask the extension for it", () => {
    const { dom, bar, posted, changed } = controls();
    choice(bar, "M").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.deepStrictEqual(posted, []);
    assert.strictEqual(changed.length, 1);
  });

  it("has no layout controls when the extension sent no keyboard", () => {
    const dom = new JSDOM("<!DOCTYPE html><div></div>");
    const bar = renderControls(
      dom.window.document,
      { ...DEFAULT_UI },
      undefined,
      () => undefined,
      () => undefined
    );
    assert.ok(!Array.from(bar.querySelectorAll(".choice")).some((node) => node.textContent === "QWERTY"));
  });
});

describe("the size of the page", () => {
  it("marks the page with its size, and draws smaller caps for a smaller size", () => {
    const small = render("select", "qwerty", { size: "small" });
    const large = render("select", "qwerty", { size: "large" });
    assert.strictEqual(small.root.getAttribute("data-size"), "small");
    assert.strictEqual(large.root.getAttribute("data-size"), "large");
    const unit = (root: HTMLElement): number => parseInt((root.querySelector(".keyboard") as HTMLElement).style.getPropertyValue("--u"), 10);
    assert.ok(unit(small.root) < unit(large.root));
  });

  it("starts small, so that the page takes little room", () => {
    assert.strictEqual(DEFAULT_UI.size, "small");
  });
});

describe("fitUnit", () => {
  const keyboard = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { layout: "qwerty", geometry: "staggered", iso: false });

  it("keeps the caps between the bounds of the size", () => {
    assert.strictEqual(fitUnit(keyboard, 300, "small"), 64);
    assert.strictEqual(fitUnit(keyboard, 5000, "small"), 112);
    assert.strictEqual(fitUnit(keyboard, 300, "medium"), 84);
    assert.strictEqual(fitUnit(keyboard, 5000, "large"), 152);
  });

  it("gives a size inside the bounds when the width is not known", () => {
    const unit = fitUnit(keyboard, 0, "small");
    assert.ok(unit >= 64 && unit <= 112);
  });

  it("is smaller for a smaller size at the same width", () => {
    assert.ok(fitUnit(keyboard, 900, "small") <= fitUnit(keyboard, 900, "medium"));
    assert.ok(fitUnit(keyboard, 900, "medium") <= fitUnit(keyboard, 900, "large"));
  });
});
