import * as assert from "assert";
import * as fc from "fast-check";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { mergeKeymap } from "../keymap/loadKeymap";
import { resolveKey } from "../keymap/resolve";
import { MenuState, openMenu } from "../menu/menuState";
import { CapView, KeyboardOptions, buildKeyboardModel, resolveLayer, rowOffset } from "./keyboardModel";
import { KeyCap, LAYOUTS } from "./layouts";

const QWERTY: KeyboardOptions = { layout: "qwerty", geometry: "staggered", iso: false };
const BEPO: KeyboardOptions = { layout: "bepo", geometry: "staggered", iso: false };

function capWith(model: ReturnType<typeof buildKeyboardModel>, symbol: string, level = 0): CapView | undefined {
  return model.caps.flat().find((cap) => cap.layers[level].symbol === symbol);
}

describe("buildKeyboardModel on QWERTY", () => {
  it("resolves the four layers of the t key in the transform menu", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), QWERTY);
    const cap = capWith(model, "t");
    assert.ok(cap);
    assert.strictEqual(cap.layers[0].row?.label, "octave up");
    assert.strictEqual(cap.layers[1].row?.label, "octave down");
    assert.strictEqual(cap.layers[2].notation, "<a-t>");
    assert.strictEqual(cap.layers[2].row?.label, "harmonize octave up");
    assert.strictEqual(cap.layers[3].notation, "<a-T>");
    assert.strictEqual(cap.layers[3].row?.label, "harmonize octave down");
  });

  it("shows the keys of the select menu on their base layer", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), QWERTY);
    assert.strictEqual(capWith(model, "c")?.layers[0].row?.label, "chords");
    assert.strictEqual(capWith(model, "c")?.layers[1].row?.label, "chord notes");
  });

  it("marks the digits as count digits in the transform menu, and as bound in the select menu", () => {
    assert.strictEqual(capWith(buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), QWERTY), "5")?.layers[0].state, "count");
    assert.strictEqual(capWith(buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), QWERTY), "5")?.layers[0].state, "bound");
  });

  it("has the number of keys of an ANSI keyboard, with no ISO key", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), QWERTY);
    assert.deepStrictEqual(
      model.caps.map((row) => row.length),
      [13, 12, 11, 10]
    );
  });

  it("flags a dead key, and gives its symbol no binding", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), QWERTY);
    const cap = capWith(model, "e");
    assert.strictEqual(cap?.layers[2].state, "dead");
    assert.strictEqual(cap?.layers[2].row, undefined);
  });
});

describe("buildKeyboardModel on BÉPO", () => {
  it("resolves the digits of the select menu on the Shift layer, where BÉPO types them", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), BEPO);
    const one = capWith(model, "1", 1);
    assert.ok(one);
    assert.strictEqual(one.layers[1].state, "bound");
    assert.strictEqual(one.layers[1].row?.label, "top note (same as t)");
  });

  it("puts the mode switches on the AltGr layers that type < and >", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), BEPO);
    const less = capWith(model, "<", 2);
    assert.ok(less);
    assert.strictEqual(less.layers[2].state, "bound");
    assert.strictEqual(less.layers[2].row?.label, "go to select mode");
    assert.ok(!model.tray.some((row) => row.notation === "<"), "a key that a cap carries is not in the tray");
  });

  it("resolves the layer that types a symbol that is not bound as the Alt chord of the key", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), BEPO);
    const o = capWith(model, "o");
    assert.ok(o);
    assert.strictEqual(o.layers[2].symbol, "œ");
    assert.strictEqual(o.layers[2].notation, "<a-o>");
  });

  it("leaves out the ISO-only keys unless they are asked for", () => {
    const without = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), BEPO)
      .caps.flat()
      .map((cap) => cap.layers[0].symbol);
    assert.ok(!without.includes("$") && !without.includes("ç"));
    const withIso = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { ...BEPO, iso: true })
      .caps.flat()
      .map((cap) => cap.layers[0].symbol);
    assert.ok(withIso.includes("$") && withIso.includes("ç"));
  });
});

describe("dead keys and spellings", () => {
  it("lets a dead AltGr layer carry the Alt chord, because a keybinding fires on the physical key whatever it types", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), BEPO);
    const t = capWith(model, "t");
    assert.ok(t);
    assert.strictEqual(t.layers[2].symbol, "ᵉ");
    assert.strictEqual(t.layers[2].state, "bound");
    assert.strictEqual(t.layers[2].notation, "<a-t>");
  });

  it("never matches the symbol of a dead layer to a binding", () => {
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { "´": { label: "acute", category: "pitch", action: { kind: "command", name: "abc.acute" } } },
    });
    const model = buildKeyboardModel(keymap, openMenu("transform"), QWERTY);
    const e = capWith(model, "e");
    assert.ok(e && e.layers[2].symbol.includes("´"));
    assert.notStrictEqual(e.layers[2].row?.label, "acute");
  });

  it("keeps the spelling of the keymap in the notation that a press sends, so that the menu finds the key again", () => {
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { "<a-c-x>": { label: "ctrl alt x", category: "pitch", action: { kind: "command", name: "abc.x" } } },
    });
    const model = buildKeyboardModel(keymap, openMenu("transform"), QWERTY);
    const x = capWith(model, "x");
    assert.ok(x);
    assert.strictEqual(model.tray.find((row) => row.label === "ctrl alt x")?.notation, "<a-c-x>");
    const state = { ...openMenu("transform") };
    assert.ok(
      resolveKey(keymap.transform, state.path, model.tray.find((row) => row.label === "ctrl alt x")?.notation ?? ""),
      "the menu must find the key by the notation of the tray"
    );
  });

  it("gives a layer with no character of its own the Alt chord, and not the binding of the layer below", () => {
    const empty = ["x", "X", "", "", undefined] as unknown as KeyCap;
    const bindings = new Map([["x", { key: "x", node: DEFAULT_KEYMAP.transform.children["*"] }]]);
    assert.notStrictEqual(resolveLayer(empty, 2, "transform", bindings).state, "bound");
  });
});

describe("the tray", () => {
  it("holds the Ctrl chords and Tab in the transform menu", () => {
    const tray = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("transform"), QWERTY).tray.map((row) => row.notation);
    for (const key of ["<c-up>", "<c-down>", "<c-S-up>", "<c-S-down>", "<tab>"]) assert.ok(tray.includes(key), key);
  });

  it("holds the mode keys inside a group, where they still work", () => {
    const state: MenuState = { ...openMenu("transform"), path: ["g"] };
    const model = buildKeyboardModel(DEFAULT_KEYMAP, state, QWERTY);
    assert.ok(capWith(model, "c")?.layers[0].row?.label === "close voicing");
    assert.ok(model.tray.some((row) => row.notation === "<tab>"));
  });

  it("follows an override that removes a key", () => {
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, { select: { c: null } });
    assert.strictEqual(capWith(buildKeyboardModel(keymap, openMenu("select"), QWERTY), "c")?.layers[0].state, "unbound");
  });
});

describe("the options in the model", () => {
  it("carries the layout, the geometry and the ISO keys that it was built with, for the controls of the page", () => {
    const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { layout: "bepo", geometry: "ortholinear", iso: true });
    assert.strictEqual(model.layout, "bepo");
    assert.strictEqual(model.geometry, "ortholinear");
    assert.strictEqual(model.iso, true);
  });
});

describe("rowOffset", () => {
  it("staggers the rows of a staggered keyboard", () => {
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((row) => rowOffset(row, false, QWERTY)),
      [0, 0.5, 0.75, 1.25]
    );
  });

  it("aligns the rows of an ortholinear keyboard", () => {
    const ortho: KeyboardOptions = { ...QWERTY, geometry: "ortholinear" };
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((row) => rowOffset(row, false, ortho)),
      [0, 1, 1, 1]
    );
  });

  it("moves a row left by one when it starts with an ISO key that is shown", () => {
    assert.strictEqual(rowOffset(3, true, { ...BEPO, iso: true }), 0.25);
    assert.strictEqual(rowOffset(3, true, BEPO), 1.25);
  });
});

describe("buildKeyboardModel properties", () => {
  const options = fc.record({
    layout: fc.constantFrom<"qwerty" | "bepo">("qwerty", "bepo"),
    geometry: fc.constantFrom<"staggered" | "ortholinear">("staggered", "ortholinear"),
    iso: fc.boolean(),
  });
  const states = fc.record({
    open: fc.boolean(),
    mode: fc.constantFrom<"select" | "transform">("select", "transform"),
    path: fc.constantFrom<string[]>([], ["g"], ["i"], ["a"], ["nope"]),
    count: fc.constant(""),
  });

  it("never throws and gives equal models for equal inputs", () => {
    fc.assert(
      fc.property(states, options, (state, option) => {
        const first = buildKeyboardModel(DEFAULT_KEYMAP, state, option);
        assert.deepStrictEqual(buildKeyboardModel(DEFAULT_KEYMAP, state, option), first);
        return true;
      })
    );
  });

  it("puts every key of the current menu on a cap or in the tray, and never on both", () => {
    fc.assert(
      fc.property(states, options, (state, option) => {
        const model = buildKeyboardModel(DEFAULT_KEYMAP, state, option);
        const onCaps = new Set(model.caps.flat().flatMap((cap) => cap.layers.filter((layer) => layer.state === "bound").map((layer) => layer.notation)));
        for (const row of model.tray) assert.ok(!onCaps.has(row.notation), `${row.notation} is on a cap and in the tray`);
        return true;
      })
    );
  });

  it("loses no key: every key of the current menu is on a cap or in the tray", () => {
    fc.assert(
      fc.property(states, options, (state, option) => {
        const model = buildKeyboardModel(DEFAULT_KEYMAP, state, option);
        const onCaps = new Set(model.caps.flat().flatMap((cap) => cap.layers.filter((layer) => layer.state === "bound").map((layer) => layer.notation)));
        const inTray = new Set(model.tray.map((row) => row.notation));
        const root = DEFAULT_KEYMAP[state.mode];
        const group = resolveKey(root, state.path.slice(0, -1), state.path[state.path.length - 1] ?? "");
        const children = state.path.length > 0 && group && group.type === "group" ? group.children : root.children;
        for (const key of Object.keys(children)) assert.ok(onCaps.has(key) || inTray.has(key), `${key} is lost`);
        return true;
      })
    );
  });

  it("counts the columns from the first key that is drawn, with or without the ISO key", () => {
    const withIso = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { ...BEPO, iso: true });
    assert.deepStrictEqual(
      withIso.caps[3].map((cap) => cap.col),
      withIso.caps[3].map((_, index) => index)
    );
    assert.strictEqual(withIso.caps[3][0].layers[0].symbol, "$");
  });

  it("gives an offset of 0 to the first row and equal offsets to the other rows of an ortholinear keyboard", () => {
    fc.assert(
      fc.property(options, (option) => {
        const model = buildKeyboardModel(DEFAULT_KEYMAP, openMenu("select"), { ...option, geometry: "ortholinear", iso: false });
        assert.strictEqual(model.caps[0][0].offset, 0);
        const others = new Set(model.caps.slice(1).map((row) => row[0].offset));
        assert.strictEqual(others.size, 1);
        return true;
      })
    );
  });
});

describe("the layouts", () => {
  it("name their sources and have the rows of a keyboard", () => {
    assert.ok(LAYOUTS.qwerty.source.includes("US"));
    assert.ok(LAYOUTS.bepo.source.includes("bepo"));
    for (const layout of [LAYOUTS.qwerty, LAYOUTS.bepo]) {
      assert.strictEqual(layout.rows.length, 4);
      for (const row of layout.rows) for (const cap of row) assert.ok(cap.length >= 4 && cap.slice(0, 4).every((text) => typeof text === "string"));
    }
  });

  it("have the keys of the ISO rows on BÉPO and none on QWERTY", () => {
    assert.strictEqual(LAYOUTS.bepo.rows.flat().filter((cap) => cap[4]?.iso === true).length, 2);
    assert.strictEqual(LAYOUTS.qwerty.rows.flat().filter((cap) => cap[4]?.iso === true).length, 0);
  });
});
