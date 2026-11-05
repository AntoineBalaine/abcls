import * as assert from "assert";
import * as fc from "fast-check";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { Group } from "../keymap/types";
import { MENU_KEY_SUPERSET, keybindingSnippet, keysOutsideSuperset, outsideSupersetWarning, toVsCodeKey, toVsCodeKeys } from "./keybindingKeys";

describe("toVsCodeKey", () => {
  it("writes a plain letter as itself and an uppercase letter with shift", () => {
    assert.strictEqual(toVsCodeKey("a"), "a");
    assert.strictEqual(toVsCodeKey("A"), "shift+a");
  });

  it("writes the Alt chords", () => {
    assert.strictEqual(toVsCodeKey("<a-t>"), "alt+t");
    assert.strictEqual(toVsCodeKey("<a-T>"), "alt+shift+t");
  });

  it("writes the Ctrl arrows", () => {
    assert.strictEqual(toVsCodeKey("<c-up>"), "ctrl+up");
    assert.strictEqual(toVsCodeKey("<c-S-up>"), "ctrl+shift+up");
    assert.strictEqual(toVsCodeKey("<c-S-down>"), "ctrl+shift+down");
  });

  it("writes the named keys", () => {
    assert.strictEqual(toVsCodeKey("<tab>"), "tab");
    assert.strictEqual(toVsCodeKey("<esc>"), "escape");
    assert.strictEqual(toVsCodeKey("<bs>"), "backspace");
  });

  it("writes the symbols with their US spelling", () => {
    assert.strictEqual(toVsCodeKey("{"), "shift+[");
    assert.strictEqual(toVsCodeKey("+"), "shift+=");
    assert.strictEqual(toVsCodeKey("-"), "-");
    assert.strictEqual(toVsCodeKey("("), "shift+9");
  });

  it("binds the angle brackets as the US spelling and as the character itself", () => {
    assert.deepStrictEqual(toVsCodeKeys("<"), ["shift+,", "<"]);
    assert.deepStrictEqual(toVsCodeKeys(">"), ["shift+.", ">"]);
  });

  it("gives no default keybinding to an accented letter, which VS Code does not accept in a contributed keybinding", () => {
    assert.deepStrictEqual(toVsCodeKeys("é"), []);
    assert.ok(!MENU_KEY_SUPERSET.includes("é"));
  });

  it("gives nothing for what is not a notation or has no key", () => {
    assert.deepStrictEqual(toVsCodeKeys("<x>"), []);
    assert.deepStrictEqual(toVsCodeKeys("😀"), []);
    assert.strictEqual(toVsCodeKey(""), undefined);
  });
});

describe("the superset of menu keys", () => {
  it("has a keybinding for every notation of the default keymap", () => {
    assert.deepStrictEqual(keysOutsideSuperset(DEFAULT_KEYMAP), []);
    assert.strictEqual(outsideSupersetWarning(DEFAULT_KEYMAP), undefined);
  });

  it("gives every notation of the superset at least one key string", () => {
    for (const notation of MENU_KEY_SUPERSET) assert.ok(toVsCodeKeys(notation).length > 0, notation);
  });

  it("never gives the same key string to two notations", () => {
    const seen = new Map<string, string>();
    for (const notation of MENU_KEY_SUPERSET) {
      for (const key of toVsCodeKeys(notation)) {
        assert.strictEqual(seen.get(key), undefined, `${key} is used by ${seen.get(key)} and ${notation}`);
        seen.set(key, notation);
      }
    }
  });

  it("has no duplicate", () => {
    assert.strictEqual(new Set(MENU_KEY_SUPERSET).size, MENU_KEY_SUPERSET.length);
  });

  it("warns, with the snippet, about a key outside the superset", () => {
    const transform: Group = { ...DEFAULT_KEYMAP.transform, children: { ...DEFAULT_KEYMAP.transform.children, "<a-<>": DEFAULT_KEYMAP.transform.children.t } };
    const keymap = { select: DEFAULT_KEYMAP.select, transform };
    assert.deepStrictEqual(keysOutsideSuperset(keymap), ["<a-<>"]);
    const warning = outsideSupersetWarning(keymap);
    assert.ok(warning && warning.includes("keybindings.json") && warning.includes('"command":"abc.menu.key"') && warning.includes("<a-<>"));
  });

  it("writes a snippet that names the command, the notation and the context", () => {
    const snippet = JSON.parse(keybindingSnippet("<a-é>"));
    assert.strictEqual(snippet.key, "<the key>");
    assert.strictEqual(snippet.command, "abc.menu.key");
    assert.deepStrictEqual(snippet.args, { notation: "<a-é>" });
    assert.ok(snippet.when.includes("abc.modeMenuOpen"));
  });

  it("never throws, whatever the text", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), (text) => {
        toVsCodeKeys(text);
        return true;
      })
    );
  });
});
