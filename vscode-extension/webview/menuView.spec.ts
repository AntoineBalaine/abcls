import * as assert from "assert";
import { JSDOM } from "jsdom";
import { ViewModel } from "../src/menu/menuViewModel";
import { ToExtension } from "../src/menu/viewMessages";
import { displayNotation, isModelMessage, loadUi, renderModel } from "./menuView";

const MODEL: ViewModel = {
  mode: "transform",
  open: true,
  breadcrumb: ["transform", "voicing menu (count = voices)"],
  count: "5",
  rows: [
    { notation: "c", label: "close voicing", short: "close voicing", category: "voicing", isGroup: false, isNew: false, action: "x" },
    { notation: "s", label: "spread voicing", short: "spread", category: "voicing", isGroup: false, isNew: true, action: "x" },
    { notation: "t", label: "octave up", short: "octave up", category: "pitch", isGroup: false, isNew: false, action: "x" },
    { notation: "g", label: "voicing menu", short: "voicings", category: "voicing", isGroup: true, isNew: false, action: "menu of 3 keys" },
    { notation: "<c-up>", label: "octave up", short: "octave up", category: "pitch", isGroup: false, isNew: false, action: "x" },
    { notation: "z", label: "custom", short: "custom", category: "madeUpByTheUser", isGroup: false, isNew: false, action: "x" },
  ],
};

function render(model: ViewModel = MODEL) {
  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
  const root = dom.window.document.getElementById("root") as HTMLElement;
  const posted: ToExtension[] = [];
  renderModel(root, model, (message) => posted.push(message));
  return { dom, root, posted };
}

describe("renderModel", () => {
  it("draws one row for each key of the model", () => {
    const { root } = render();
    assert.strictEqual(root.querySelectorAll(".row").length, MODEL.rows.length);
  });

  it("draws the breadcrumb and marks the last element as the current one", () => {
    const { root } = render();
    const nodes = Array.from(root.querySelectorAll(".crumb .node")).map((node) => node.textContent);
    assert.deepStrictEqual(nodes, ["transform", "voicing menu (count = voices)"]);
    assert.strictEqual(root.querySelectorAll(".crumb .current").length, 1);
  });

  it("shows the count in the transform mode only", () => {
    assert.ok(render().root.querySelector(".count")?.textContent?.includes("5"));
    assert.strictEqual(render({ ...MODEL, mode: "select" }).root.querySelector(".count"), null);
  });

  it("groups the rows by category, in the order of the table, and puts an unknown category last", () => {
    const { root } = render();
    const names = Array.from(root.querySelectorAll(".category-name")).map((node) => node.textContent);
    assert.deepStrictEqual(names, ["pitch", "voicings", "madeUpByTheUser"]);
  });

  it("marks a group and a new key", () => {
    const { root } = render();
    assert.ok(root.querySelector('[data-notation="g"] .marker'));
    assert.ok(root.querySelector('[data-notation="s"] .tag'));
    assert.strictEqual(root.querySelector('[data-notation="c"] .marker'), null);
  });

  it("posts a press with the notation when a row is clicked", () => {
    const { dom, root, posted } = render();
    (root.querySelector('[data-notation="g"]') as HTMLElement).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.deepStrictEqual(posted, [{ type: "press", notation: "g" }]);
  });

  it("replaces the previous content when it renders again", () => {
    const { root } = render();
    renderModel(root, { ...MODEL, rows: MODEL.rows.slice(0, 1) }, () => undefined);
    assert.strictEqual(root.querySelectorAll(".row").length, 1);
  });

  it("writes text as text, so that a label cannot inject markup", () => {
    const { root } = render({
      ...MODEL,
      rows: [{ notation: "q", label: "<img src=x onerror=alert(1)>", short: "x", category: "pitch", isGroup: false, isNew: false, action: "x" }],
    });
    assert.strictEqual(root.querySelector("img"), null);
  });
});

describe("displayNotation", () => {
  it("spells the arrows as arrows", () => {
    assert.strictEqual(displayNotation("<c-up>"), "<c-↑>");
    assert.strictEqual(displayNotation("<c-S-down>"), "<c-S-↓>");
    assert.strictEqual(displayNotation("t"), "t");
  });
});

describe("loadUi", () => {
  it("keeps the valid saved choices, and never the highlight", () => {
    assert.deepStrictEqual(loadUi({ view: "keyboard", show: "2", free: true, size: "large", highlight: "pitch" }), {
      view: "keyboard",
      show: "2",
      free: true,
      size: "large",
      highlight: null,
    });
  });

  it("gives the default to a field that is missing or has an unknown value", () => {
    assert.deepStrictEqual(loadUi({ view: "other", show: "9", free: "yes", size: "huge" }), {
      view: "both",
      show: "all",
      free: false,
      size: "small",
      highlight: null,
    });
    assert.deepStrictEqual(loadUi(undefined), { view: "both", show: "all", free: false, size: "small", highlight: null });
    assert.deepStrictEqual(loadUi(null), { view: "both", show: "all", free: false, size: "small", highlight: null });
    assert.deepStrictEqual(loadUi("text"), { view: "both", show: "all", free: false, size: "small", highlight: null });
  });
});

describe("isModelMessage", () => {
  it("accepts a model, with or without a keyboard", () => {
    assert.ok(isModelMessage({ type: "model", model: MODEL }));
    assert.ok(isModelMessage({ type: "model", model: MODEL, keyboard: { caps: [], tray: [] } }));
  });

  it("rejects a message that the page could not draw, without throwing", () => {
    for (const message of [
      null,
      undefined,
      "x",
      5,
      {},
      { type: "model" },
      { type: "model", model: {} },
      { type: "model", model: { rows: [], breadcrumb: [] }, keyboard: {} },
      { type: "other", model: MODEL },
    ]) {
      assert.strictEqual(isModelMessage(message), false, JSON.stringify(message));
    }
  });
});
