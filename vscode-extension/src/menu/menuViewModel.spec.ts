import * as assert from "assert";
import * as fc from "fast-check";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { mergeKeymap } from "../keymap/loadKeymap";
import { resolveGroup, resolveKey } from "../keymap/resolve";
import { closedState, openMenu } from "./menuState";
import { buildViewModel } from "./menuViewModel";

describe("buildViewModel", () => {
  it("lists the keys of the root of select mode, with the groups and the mode keys", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, openMenu("select"));
    const notations = model.rows.map((row) => row.notation);
    assert.ok(notations.includes("c") && notations.includes("f") && notations.includes("<tab>"));
    assert.ok(model.rows.find((row) => row.notation === "i")?.isGroup);
    assert.deepStrictEqual(model.breadcrumb, ["select"]);
    assert.strictEqual(model.open, true);
  });

  it("shows the group that was opened, and the mode keys of the root that still work there", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, { ...openMenu("transform"), path: ["g"] });
    assert.deepStrictEqual(model.breadcrumb, ["transform", "voicing menu (count = voices)"]);
    const notations = model.rows.map((row) => row.notation);
    for (const key of ["2", "3", "4", "c", "k", "s", "t"]) assert.ok(notations.includes(key), key);
    // Because k is bound inside the group g (the cluster voicing), only Tab of the mode keys of the root still works there.
    assert.ok(notations.includes("<tab>"));
    assert.ok(!notations.includes("+"), "the other keys of the root must not be listed inside a group");
  });

  it("carries the typed count and the open state", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, { ...openMenu("transform"), count: "5" });
    assert.strictEqual(model.count, "5");
    assert.strictEqual(buildViewModel(DEFAULT_KEYMAP, closedState("transform")).open, false);
  });

  it("falls back to the root when the path does not resolve", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, { ...openMenu("select"), path: ["nope", "x"] });
    assert.deepStrictEqual(model.breadcrumb, ["select"]);
    assert.ok(model.rows.some((row) => row.notation === "c"));
  });

  it("follows an override: a removed key has no row", () => {
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, { select: { c: null } });
    assert.ok(!buildViewModel(keymap, openMenu("select")).rows.some((row) => row.notation === "c"));
  });

  it("uses the short name of a node, or its label when it has none", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, openMenu("transform"));
    assert.strictEqual(model.rows.find((row) => row.notation === "<a-t>")?.short, "harm. 8ve up");
    assert.strictEqual(model.rows.find((row) => row.notation === "+")?.short, "semitone up");
  });

  it("marks the keys that Kakoune does not have", () => {
    const model = buildViewModel(DEFAULT_KEYMAP, openMenu("select"));
    assert.strictEqual(model.rows.find((row) => row.notation === "A")?.isNew, true);
    assert.strictEqual(model.rows.find((row) => row.notation === "c")?.isNew, false);
  });
});

describe("buildViewModel properties", () => {
  it("has as many rows as the group has children, when the path is at the root", () => {
    for (const mode of ["select", "transform"] as const) {
      const model = buildViewModel(DEFAULT_KEYMAP, openMenu(mode));
      assert.strictEqual(model.rows.length, Object.keys(DEFAULT_KEYMAP[mode].children).length);
    }
  });

  it("resolves every row with resolveKey at the same path", () => {
    for (const mode of ["select", "transform"] as const) {
      for (const path of [[], ["i"], ["a"], ["g"]]) {
        const state = { ...openMenu(mode), path };
        const model = buildViewModel(DEFAULT_KEYMAP, state);
        const group = resolveGroup(DEFAULT_KEYMAP[mode], path);
        const used = group ? path : [];
        for (const row of model.rows) {
          const here = resolveKey(DEFAULT_KEYMAP[mode], used, row.notation) ?? resolveKey(DEFAULT_KEYMAP[mode], [], row.notation);
          assert.ok(here, `${mode} ${path.join(" ")} ${row.notation}`);
        }
      }
    }
  });

  it("never throws, whatever the state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"select" | "transform">("select", "transform"),
        fc.array(fc.string({ maxLength: 2 }), { maxLength: 4 }),
        fc.string({ maxLength: 4 }),
        fc.boolean(),
        (mode, path, count, open) => {
          buildViewModel(DEFAULT_KEYMAP, { open, mode, path, count });
          return true;
        }
      )
    );
  });
});
