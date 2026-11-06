import * as assert from "assert";
import * as fc from "fast-check";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { resolveKey } from "../keymap/resolve";
import { Group, KeymapNode } from "../keymap/types";
import { MenuState, closedState, openMenu, step } from "./menuState";

function press(state: MenuState, ...keys: string[]) {
  let current = state;
  let effect: ReturnType<typeof step>["effect"] = { kind: "none" };
  for (const key of keys) {
    const result = step(current, DEFAULT_KEYMAP, { notation: key });
    current = result.state;
    effect = result.effect;
  }
  return { state: current, effect };
}

describe("step", () => {
  it("runs a selector and closes the menu", () => {
    const { state, effect } = press(openMenu("select"), "c");
    assert.ok(effect.kind === "run" && effect.leaf.action.name === "selectChords");
    assert.strictEqual(state.open, false);
  });

  it("passes the typed count through a group to the leaf", () => {
    const { effect } = press(openMenu("transform"), "5", "g", "c");
    assert.ok(effect.kind === "run" && effect.leaf.action.name === "harmonizeVoicing");
    assert.strictEqual(effect.kind === "run" && effect.count, 5);
  });

  it("stays open after a command when the menu is sticky, with the path and the count cleared", () => {
    const first = step(openMenu("transform"), DEFAULT_KEYMAP, { notation: "5" }, true).state;
    const grouped = step(first, DEFAULT_KEYMAP, { notation: "g" }, true).state;
    const result = step(grouped, DEFAULT_KEYMAP, { notation: "c" }, true);
    assert.ok(result.effect.kind === "run" && result.effect.count === 5);
    assert.deepStrictEqual(result.state, { open: true, mode: "transform", path: [], count: "" });
    const next = step(result.state, DEFAULT_KEYMAP, { notation: "t" }, true);
    assert.ok(next.effect.kind === "run" && next.effect.leaf.action.name === "transpose");
    assert.strictEqual(step(next.state, DEFAULT_KEYMAP, { notation: "<esc>" }, true).state.open, false);
  });

  it("does not take a bound digit for a count", () => {
    const { effect } = press(openMenu("transform"), "g", "2");
    assert.ok(effect.kind === "run" && effect.leaf.action.name === "dropVoicing" && effect.leaf.action.args[0] === "drop2");
    assert.strictEqual(effect.kind === "run" && effect.count, undefined);
  });

  it("selects the top note with f 1 in the select menu, where the digits of the group f are bound", () => {
    const { effect, state } = press(openMenu("select"), "f", "1");
    assert.ok(effect.kind === "run" && effect.leaf.action.name === "selectNthFromTop" && effect.leaf.action.args[0] === 0);
    assert.strictEqual(state.count, "");
  });

  it("takes a count in the select menu, and gives it to the next note key", () => {
    const { effect, state } = press(openMenu("select"), "3", ">");
    assert.ok(effect.kind === "run" && effect.leaf.action.name === "selectNextNote" && effect.count === 3);
    assert.strictEqual(state.count, "");
    assert.strictEqual(press(openMenu("select"), "1", "2").state.count, "12");
  });

  it("ignores a leading zero in the select menu", () => {
    const { state, effect } = press(openMenu("select"), "0");
    assert.strictEqual(effect.kind, "none");
    assert.strictEqual(state.count, "");
    assert.strictEqual(state.open, true);
  });

  it("closes on Esc, and goes back one step on Backspace before it closes", () => {
    assert.strictEqual(press(openMenu("transform"), "<esc>").state.open, false);
    const afterGroup = press(openMenu("transform"), "g");
    assert.deepStrictEqual(afterGroup.state.path, ["g"]);
    assert.deepStrictEqual(press(afterGroup.state, "<bs>").state.path, []);
    assert.strictEqual(press(afterGroup.state, "<bs>", "<bs>").state.open, false);
    assert.strictEqual(press(openMenu("transform"), "4", "2", "<bs>").state.count, "4");
  });

  it("switches the mode with the mode keys, clears the path and keeps the count", () => {
    const { state } = press(openMenu("transform"), "7", "g", "<tab>");
    assert.strictEqual(state.mode, "select");
    assert.deepStrictEqual(state.path, []);
    assert.strictEqual(state.count, "7");
    assert.strictEqual(state.open, true);
    assert.strictEqual(press(openMenu("select"), "h").state.mode, "transform");
    assert.strictEqual(press(openMenu("transform"), "k").state.mode, "select");
    assert.strictEqual(press(openMenu("select"), "<tab>").state.mode, "transform");
    assert.strictEqual(press(openMenu("transform"), "<tab>").state.mode, "select");
  });

  it("keeps the menu open and does nothing on an unbound key", () => {
    const { state, effect } = press(openMenu("select"), "@");
    assert.strictEqual(effect.kind, "none");
    assert.strictEqual(state.open, true);
  });

  it("ignores a fourth digit and a leading zero", () => {
    assert.strictEqual(press(openMenu("transform"), "1", "2", "3", "4").state.count, "123");
    assert.strictEqual(press(openMenu("transform"), "0", "5").state.count, "5");
  });

  it("ignores every key when the menu is closed", () => {
    const { state, effect } = press(closedState("transform"), "c", "5");
    assert.strictEqual(effect.kind, "none");
    assert.strictEqual(state.open, false);
    assert.strictEqual(state.count, "");
  });

  it("keeps the mode when it closes, so the view can show the last mode", () => {
    assert.strictEqual(press(openMenu("transform"), "t").state.mode, "transform");
  });

  it("reports a mode leaf with an unknown name as an error", () => {
    const keymap = {
      select: {
        type: "group",
        label: "s",
        category: "c",
        children: { q: { type: "leaf", label: "q", category: "mode", action: { kind: "mode", name: "other", args: [] } } },
      },
      transform: DEFAULT_KEYMAP.transform,
    } as typeof DEFAULT_KEYMAP;
    assert.strictEqual(step(openMenu("select"), keymap, { notation: "q" }).effect.kind, "error");
  });
});

function allKeySequences(group: Group, prefix: string[], out: Array<{ keys: string[]; node: KeymapNode }>): void {
  for (const [key, node] of Object.entries(group.children)) {
    out.push({ keys: [...prefix, key], node });
    if (node.type === "group") allKeySequences(node, [...prefix, key], out);
  }
}

describe("step properties", () => {
  const anyKey = fc.oneof(
    fc.constantFrom("c", "g", "2", "5", "0", "<", ">", "<tab>", "<esc>", "<bs>", "<a-t>", "<c-up>", "t", "@"),
    fc.string({ maxLength: 3 })
  );

  it("never throws and always leaves a count of at most three digits", () => {
    fc.assert(
      fc.property(fc.constantFrom<"select" | "transform">("select", "transform"), fc.array(anyKey, { maxLength: 25 }), (mode, keys) => {
        let state = openMenu(mode);
        for (const key of keys) {
          state = step(state, DEFAULT_KEYMAP, { notation: key }).state;
          if (state.count.length > 3 || !/^[0-9]*$/.test(state.count)) return false;
        }
        return true;
      })
    );
  });

  it("closes the menu after a run effect", () => {
    fc.assert(
      fc.property(fc.constantFrom<"select" | "transform">("select", "transform"), fc.array(anyKey, { maxLength: 25 }), (mode, keys) => {
        let state = openMenu(mode);
        for (const key of keys) {
          const result = step(state, DEFAULT_KEYMAP, { notation: key });
          if (result.effect.kind === "run" && result.state.open) return false;
          state = result.state;
        }
        return true;
      })
    );
  });

  it("reaches every leaf of the default keymap by its key sequence", () => {
    for (const mode of ["select", "transform"] as const) {
      const sequences: Array<{ keys: string[]; node: KeymapNode }> = [];
      allKeySequences(DEFAULT_KEYMAP[mode], [], sequences);
      for (const { keys, node } of sequences) {
        if (node.type !== "leaf" || node.action.kind === "mode") continue;
        const { effect } = press(openMenu(mode), ...keys);
        assert.ok(effect.kind === "run", `${mode} ${keys.join(" ")}`);
        assert.strictEqual(effect.kind === "run" && effect.leaf, resolveKey(DEFAULT_KEYMAP[mode], keys.slice(0, -1), keys[keys.length - 1]));
      }
    }
  });
});
