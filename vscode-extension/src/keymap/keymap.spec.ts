import * as assert from "assert";
import * as fc from "fast-check";
import { DEFAULT_KEYMAP } from "./defaultKeymap";
import { mergeKeymap } from "./loadKeymap";
import { formatNotation, parseNotation } from "./notation";
import { expandArgs, resolveGroup, resolveKey } from "./resolve";
import { Group, Keymap, KeymapNode } from "./types";
import { validateKeymap } from "./validate";

const COUNT_TWELVE = { count: { default: 1, multiplier: 12 } };

describe("parseNotation", () => {
  it("reads a plain key, including the angle brackets", () => {
    assert.deepStrictEqual(parseNotation("o"), { key: "o", ctrl: false, alt: false, shift: false });
    assert.deepStrictEqual(parseNotation("<"), { key: "<", ctrl: false, alt: false, shift: false });
    assert.deepStrictEqual(parseNotation(">"), { key: ">", ctrl: false, alt: false, shift: false });
  });

  it("reads the Alt and Ctrl chords", () => {
    assert.deepStrictEqual(parseNotation("<a-O>"), { key: "O", ctrl: false, alt: true, shift: false });
    assert.deepStrictEqual(parseNotation("<c-up>"), { key: "up", ctrl: true, alt: false, shift: false });
  });

  it("reads Shift only on a named key", () => {
    assert.deepStrictEqual(parseNotation("<c-S-up>"), { key: "up", ctrl: true, alt: false, shift: true });
    assert.strictEqual(parseNotation("<S-t>"), undefined);
  });

  it("reads the named keys without modifiers", () => {
    assert.deepStrictEqual(parseNotation("<tab>"), { key: "tab", ctrl: false, alt: false, shift: false });
  });

  it("reads the modifiers in any order", () => {
    assert.deepStrictEqual(parseNotation("<S-c-up>"), parseNotation("<c-S-up>"));
    assert.deepStrictEqual(parseNotation("<a-c-t>"), parseNotation("<c-a-t>"));
  });

  it("rejects the texts that are not notations", () => {
    for (const text of ["<x>", "<a->", "", "<>", "ab", "<a-ab>", "<c-c-up>", "<S-t>"]) {
      assert.strictEqual(parseNotation(text), undefined, text);
    }
  });
});

describe("notation properties", () => {
  const notations = fc.oneof(
    fc.string({ minLength: 1, maxLength: 1 }),
    fc.string({ minLength: 1, maxLength: 1 }).map((c) => `<a-${c}>`),
    fc.string({ minLength: 1, maxLength: 1 }).map((c) => `<c-${c}>`),
    fc
      .constantFrom("up", "down", "left", "right", "tab", "esc", "bs")
      .chain((name) => fc.constantFrom(`<${name}>`, `<c-${name}>`, `<a-${name}>`, `<c-S-${name}>`, `<a-S-${name}>`, `<c-a-S-${name}>`))
  );

  it("formatNotation reverses parseNotation for every valid notation", () => {
    fc.assert(
      fc.property(notations, (text) => {
        const parsed = parseNotation(text);
        if (parsed === undefined) return true;
        return formatNotation(parsed) === text;
      })
    );
  });
});

describe("resolveKey", () => {
  it("finds a key of the root and a key inside a group", () => {
    const chords = resolveKey(DEFAULT_KEYMAP.select, [], "c");
    assert.ok(chords && chords.type === "leaf" && chords.action.name === "selectChords");
    const closeVoicing = resolveKey(DEFAULT_KEYMAP.transform, ["g"], "c");
    assert.ok(closeVoicing && closeVoicing.type === "leaf" && closeVoicing.action.name === "harmonizeVoicing");
  });

  it("resolves g t of the transform mode to the chord scale close voicing, next to the old voicings", () => {
    const scaleClose = resolveKey(DEFAULT_KEYMAP.transform, ["g"], "t");
    assert.ok(scaleClose && scaleClose.type === "leaf" && scaleClose.action.name === "harmonizeVoicing");
    assert.strictEqual((scaleClose.action.args as unknown[])[0], "scaleClose");
    for (const oldKey of ["c", "k", "s"]) {
      assert.ok(resolveKey(DEFAULT_KEYMAP.transform, ["g"], oldKey), `the key g ${oldKey} must stay`);
    }
  });

  it("returns undefined for an unknown key or path", () => {
    assert.strictEqual(resolveKey(DEFAULT_KEYMAP.select, [], "@"), undefined);
    assert.strictEqual(resolveKey(DEFAULT_KEYMAP.select, ["c"], "x"), undefined);
    assert.strictEqual(resolveKey(DEFAULT_KEYMAP.select, ["nope"], "x"), undefined);
  });

  it("does not take a property of Object.prototype for a key", () => {
    assert.strictEqual(resolveKey(DEFAULT_KEYMAP.select, [], "constructor"), undefined);
    assert.strictEqual(resolveGroup(DEFAULT_KEYMAP.select, ["toString"]), undefined);
  });

  it("never throws, whatever the path and the key", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 3 }), { maxLength: 4 }), fc.string({ maxLength: 3 }), (path, key) => {
        resolveKey(DEFAULT_KEYMAP.transform, path, key);
        return true;
      })
    );
  });
});

describe("expandArgs", () => {
  it("replaces a count template by the typed count times the multiplier", () => {
    assert.deepStrictEqual(expandArgs(["close", { count: { default: 4, multiplier: 1 } }, null], 5), ["close", 5, null]);
    assert.deepStrictEqual(expandArgs([COUNT_TWELVE], 2), [24]);
  });

  it("uses the default when no count was typed", () => {
    assert.deepStrictEqual(expandArgs([COUNT_TWELVE], undefined), [12]);
    assert.deepStrictEqual(expandArgs([{ count: { default: 1, multiplier: -12 } }], undefined), [-12]);
  });

  it("leaves a list without a count template unchanged, for any count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))),
        fc.option(fc.integer({ min: 1, max: 999 }), { nil: undefined }),
        (args, count) => {
          assert.deepStrictEqual(expandArgs(args, count), args);
          return true;
        }
      )
    );
  });
});

describe("mergeKeymap", () => {
  it("adds a key that the override defines", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { d: { label: "drop 2", category: "voicing", action: { kind: "transform", name: "dropVoicing", args: ["drop2"] } } },
    });
    assert.deepStrictEqual(errors, []);
    const added = resolveKey(keymap.transform, [], "d");
    assert.ok(added && added.type === "leaf" && added.action.name === "dropVoicing");
  });

  it("removes a default binding with null", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, { select: { c: null } });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(resolveKey(keymap.select, [], "c"), undefined);
    assert.ok(resolveKey(DEFAULT_KEYMAP.select, [], "c"), "the defaults must stay untouched");
  });

  it("merges a partial override into an existing leaf", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, { select: { c: { label: "all chords" } } });
    assert.deepStrictEqual(errors, []);
    const node = resolveKey(keymap.select, [], "c");
    assert.ok(node && node.type === "leaf");
    assert.strictEqual(node.label, "all chords");
    assert.strictEqual(node.action.name, "selectChords");
  });

  it("merges the children of an existing group", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { g: { children: { z: { type: "leaf", label: "zed", category: "voicing", action: { kind: "command", name: "abc.zed", args: [] } } } } },
    });
    assert.deepStrictEqual(errors, []);
    assert.ok(resolveKey(keymap.transform, ["g"], "z"));
    assert.ok(resolveKey(keymap.transform, ["g"], "c"), "the existing children must stay");
  });

  it("lets a leaf replace a group", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { g: { type: "leaf", label: "g", category: "voicing", action: { kind: "command", name: "abc.g", args: [] } } },
    });
    assert.deepStrictEqual(errors, []);
    const node = resolveKey(keymap.transform, [], "g");
    assert.ok(node && node.type === "leaf");
  });

  it("reports the problems and does not throw", () => {
    const bad = mergeKeymap(DEFAULT_KEYMAP, { select: { "<x>": { label: "x" } }, nope: {} });
    assert.ok(bad.errors.length >= 2);
    assert.ok(mergeKeymap(DEFAULT_KEYMAP, "text").errors.length === 1);
    assert.ok(mergeKeymap(DEFAULT_KEYMAP, { select: { q: { label: "incomplete" } } }).errors.length === 1);
  });

  it("turns a group into a leaf when the patch has an action and no type", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, {
      transform: { g: { label: "g", category: "voicing", action: { kind: "command", name: "abc.g" } } },
    });
    assert.deepStrictEqual(errors, []);
    const node = resolveKey(keymap.transform, [], "g");
    assert.ok(node && node.type === "leaf" && node.action.name === "abc.g");
    assert.deepStrictEqual(node.action.args, []);
  });

  it("turns a leaf into a group when the patch has children and no type", () => {
    const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, {
      select: {
        c: { label: "c", category: "selectType", children: { x: { label: "x", category: "selectType", action: { kind: "selector", name: "selectChords" } } } },
      },
    });
    assert.deepStrictEqual(errors, []);
    const node = resolveKey(keymap.select, [], "c");
    assert.ok(node && node.type === "group" && "x" in node.children);
  });

  it("reports a malformed binding instead of throwing", () => {
    const malformed: unknown[] = [
      { select: { q: { label: "q", category: "c", action: { kind: "command" } } } },
      { select: { q: { type: "foo", label: "q", action: {} } } },
      { select: { q: { children: { a: null } } } },
      { select: { q: { label: "q", category: "c", children: "text" } } },
      { select: { q: { label: "q", category: "c", action: { kind: "command", name: "x", args: "no" } } } },
      { select: { c: { action: { name: "selectChords" } } } },
    ];
    for (const override of malformed) {
      const result = mergeKeymap(DEFAULT_KEYMAP, override);
      assert.ok(result.errors.length >= 1, JSON.stringify(override));
      validateKeymap(result.keymap);
    }
  });

  it("does not let a __proto__ key change a prototype", () => {
    const override = JSON.parse(
      '{"select":{"c":{"__proto__":{"polluted":1},"label":"c2"},"q":{"label":"q","category":"c","action":{"kind":"command","name":"x"},"__proto__":{"polluted":2}}}}'
    );
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, override);
    const node = resolveKey(keymap.select, [], "c");
    assert.ok(node && !("polluted" in node));
    const added = resolveKey(keymap.select, [], "q");
    assert.ok(added && !("polluted" in added));
    assert.strictEqual(({} as { polluted?: number }).polluted, undefined);
  });

  it("does not alias the settings object or the defaults", () => {
    const action = { kind: "transform", name: "transpose", args: [{ count: { default: 1, multiplier: 1 } }] };
    const { keymap } = mergeKeymap(DEFAULT_KEYMAP, { select: { q: { label: "q", category: "c", action } } });
    action.args[0].count.default = 99;
    const node = resolveKey(keymap.select, [], "q");
    assert.ok(node && node.type === "leaf");
    assert.deepStrictEqual(node.action.args, [{ count: { default: 1, multiplier: 1 } }]);
    const octave = resolveKey(keymap.transform, [], "t");
    assert.ok(octave && octave.type === "leaf");
    (octave.action.args[0] as { count: { default: number } }).count.default = 77;
    const original = resolveKey(DEFAULT_KEYMAP.transform, [], "t");
    assert.ok(original && original.type === "leaf");
    assert.strictEqual((original.action.args[0] as { count: { default: number } }).count.default, 1);
  });

  it("never throws, whatever the override", () => {
    fc.assert(
      fc.property(fc.anything({ maxDepth: 4 }), (override) => {
        const result = mergeKeymap(DEFAULT_KEYMAP, override);
        validateKeymap(result.keymap);
        resolveKey(result.keymap.select, ["i"], "c");
        return true;
      }),
      { numRuns: 300 }
    );
  });

  it("never throws for an override made of plausible but wrong bindings", () => {
    const wrongNode = fc.oneof(
      fc.constant(null),
      fc.string(),
      fc.record({ label: fc.anything(), category: fc.anything(), action: fc.anything(), children: fc.anything(), type: fc.anything() }, { requiredKeys: [] })
    );
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom("c", "g", "q", "<a-t>", "<x>", "i"), wrongNode), (section) => {
        const result = mergeKeymap(DEFAULT_KEYMAP, { select: section, transform: section });
        validateKeymap(result.keymap);
        return true;
      }),
      { numRuns: 300 }
    );
  });

  it("is the identity when there is nothing to merge", () => {
    assert.deepStrictEqual(mergeKeymap(DEFAULT_KEYMAP, {}).keymap, DEFAULT_KEYMAP);
    assert.deepStrictEqual(mergeKeymap(DEFAULT_KEYMAP, undefined).keymap, DEFAULT_KEYMAP);
  });

  it("gives the same result when the same override is merged twice", () => {
    const override = { select: { c: null, q: { label: "q", category: "selectType", action: { kind: "selector", name: "selectChords", args: [] } } } };
    const once = mergeKeymap(DEFAULT_KEYMAP, override).keymap;
    const twice = mergeKeymap(once, override).keymap;
    assert.deepStrictEqual(twice, once);
  });
});

function leaves(group: Group, out: KeymapNode[]): void {
  for (const node of Object.values(group.children)) {
    out.push(node);
    if (node.type === "group") leaves(node, out);
  }
}

describe("the default keymap", () => {
  it("has no validation error", () => {
    assert.deepStrictEqual(validateKeymap(DEFAULT_KEYMAP), []);
  });

  it("has the three mode switches in both menus", () => {
    for (const mode of [DEFAULT_KEYMAP.select, DEFAULT_KEYMAP.transform]) {
      for (const key of ["<", ">", "<tab>"]) {
        const node = resolveKey(mode, [], key);
        assert.ok(node && node.type === "leaf" && node.action.kind === "mode", key);
      }
    }
  });

  it("selects the top note with 1 and with t", () => {
    const one = resolveKey(DEFAULT_KEYMAP.select, [], "1");
    assert.ok(one && one.type === "leaf" && one.action.name === "selectNthFromTop" && one.action.args[0] === 0);
    const t = resolveKey(DEFAULT_KEYMAP.select, [], "t");
    assert.ok(t && t.type === "leaf" && t.action.name === "selectTop");
  });

  it("puts a short name on every label longer than 18 characters", () => {
    const all: KeymapNode[] = [];
    leaves(DEFAULT_KEYMAP.select, all);
    leaves(DEFAULT_KEYMAP.transform, all);
    const tooLong = all.filter((node) => node.label.length > 18 && !node.short).map((node) => node.label);
    assert.deepStrictEqual(tooLong, []);
  });
});

describe("validateKeymap", () => {
  function withTransform(children: Group["children"]): Keymap {
    return { select: DEFAULT_KEYMAP.select, transform: { type: "group", label: "t", category: "pitch", children } };
  }
  const aLeaf = (name: string): KeymapNode => ({ type: "leaf", label: "x", category: "pitch", action: { kind: "transform", name, args: [] } });

  it("reports a key that is not a notation", () => {
    assert.ok(validateKeymap(withTransform({ "<x>": aLeaf("a") })).some((m) => m.includes("not a valid key notation")));
  });

  it("reports an empty group", () => {
    assert.ok(validateKeymap(withTransform({ g: { type: "group", label: "g", category: "pitch", children: {} } })).some((m) => m.includes("empty")));
  });

  it("reports an action without a name and an unknown mode", () => {
    const errors = validateKeymap(
      withTransform({ a: aLeaf(""), b: { type: "leaf", label: "b", category: "mode", action: { kind: "mode", name: "other", args: [] } } })
    );
    assert.ok(errors.some((m) => m.includes("no name")));
    assert.ok(errors.some((m) => m.includes("not a mode")));
  });

  it("reports two keys that are the same notation written in another order", () => {
    const errors = validateKeymap(withTransform({ "<a-c-t>": aLeaf("a"), "<c-a-t>": aLeaf("b") }));
    assert.ok(errors.some((m) => m.includes("already used")));
  });

  it("reports an action kind that does not exist, missing args and a badly shaped count", () => {
    const badKind: KeymapNode = { type: "leaf", label: "k", category: "pitch", action: { kind: "nope" as never, name: "x", args: [] } };
    const noArgs = { type: "leaf", label: "n", category: "pitch", action: { kind: "transform", name: "x" } } as unknown as KeymapNode;
    const badCount = { type: "leaf", label: "b", category: "pitch", action: { kind: "transform", name: "x", args: [{ count: {} }] } } as unknown as KeymapNode;
    const errors = validateKeymap(withTransform({ a: badKind, b: noArgs, c: badCount }));
    assert.ok(errors.some((m) => m.includes("not an action kind")));
    assert.ok(errors.some((m) => m.includes("must be a list")));
    assert.ok(errors.some((m) => m.includes("numeric default")));
  });

  it("reports a count argument on something that is not a transform", () => {
    const leaf: KeymapNode = { type: "leaf", label: "c", category: "pitch", action: { kind: "command", name: "abc.x", args: [COUNT_TWELVE] } };
    assert.ok(validateKeymap(withTransform({ c: leaf })).some((m) => m.includes("count")));
  });
});
