import * as assert from "assert";
import { JSDOM } from "jsdom";
import { ViewModel } from "../src/menu/menuViewModel";
import { ToExtension } from "../src/menu/viewMessages";
import { displayNotation, renderModel } from "./menuView";

const MODEL: ViewModel = {
  mode: "transform",
  open: true,
  breadcrumb: ["transform", "voicing menu (count = voices)"],
  count: "5",
  rows: [
    { notation: "c", label: "close voicing", short: "close voicing", category: "voicing", isGroup: false, isNew: false },
    { notation: "s", label: "spread voicing", short: "spread", category: "voicing", isGroup: false, isNew: true },
    { notation: "t", label: "octave up", short: "octave up", category: "pitch", isGroup: false, isNew: false },
    { notation: "g", label: "voicing menu", short: "voicings", category: "voicing", isGroup: true, isNew: false },
    { notation: "<c-up>", label: "octave up", short: "octave up", category: "pitch", isGroup: false, isNew: false },
    { notation: "z", label: "custom", short: "custom", category: "madeUpByTheUser", isGroup: false, isNew: false },
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

  it("says whether the menu is open", () => {
    assert.strictEqual(render().root.querySelector(".state")?.textContent, "menu open");
    assert.strictEqual(render({ ...MODEL, open: false }).root.querySelector(".state")?.textContent, "menu closed");
  });

  it("replaces the previous content when it renders again", () => {
    const { root } = render();
    renderModel(root, { ...MODEL, rows: MODEL.rows.slice(0, 1) }, () => undefined);
    assert.strictEqual(root.querySelectorAll(".row").length, 1);
  });

  it("writes text as text, so that a label cannot inject markup", () => {
    const { root } = render({
      ...MODEL,
      rows: [{ notation: "q", label: "<img src=x onerror=alert(1)>", short: "x", category: "pitch", isGroup: false, isNew: false }],
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
