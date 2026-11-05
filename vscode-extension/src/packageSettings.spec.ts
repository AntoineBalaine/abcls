import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface SettingSchema {
  type: string;
  default: unknown;
  enum?: string[];
  enumDescriptions?: string[];
  scope?: string;
  description?: string;
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const settings: Record<string, SettingSchema> = manifest.contributes.configuration.properties;

describe("the settings of the modal keymap in package.json", () => {
  it("declares abc.keymap as an object that is empty by default", () => {
    assert.strictEqual(settings["abc.keymap"].type, "object");
    assert.deepStrictEqual(settings["abc.keymap"].default, {});
  });

  it("declares abc.keyboardLayout with the layouts qwerty and bepo, qwerty by default", () => {
    assert.strictEqual(settings["abc.keyboardLayout"].type, "string");
    assert.deepStrictEqual(settings["abc.keyboardLayout"].enum, ["qwerty", "bepo"]);
    assert.strictEqual(settings["abc.keyboardLayout"].default, "qwerty");
  });

  it("declares abc.keyboardGeometry with staggered and ortholinear, staggered by default", () => {
    assert.strictEqual(settings["abc.keyboardGeometry"].type, "string");
    assert.deepStrictEqual(settings["abc.keyboardGeometry"].enum, ["staggered", "ortholinear"]);
    assert.strictEqual(settings["abc.keyboardGeometry"].default, "staggered");
  });

  it("keeps every default inside its enum and describes every value of the enum", () => {
    for (const name of ["abc.keyboardLayout", "abc.keyboardGeometry"]) {
      const setting = settings[name];
      assert.ok(setting.enum && setting.enum.includes(setting.default as string), name);
      assert.strictEqual(setting.enumDescriptions?.length, setting.enum?.length, name);
    }
  });

  it("lets a workspace carry its own keymap, and keeps the layout and the geometry per machine", () => {
    assert.strictEqual(settings["abc.keymap"].scope, "window");
    assert.strictEqual(settings["abc.keyboardLayout"].scope, "application");
    assert.strictEqual(settings["abc.keyboardGeometry"].scope, "application");
  });

  it("declares the settings of the menu view: it opens by itself, and sits beside the editor by default", () => {
    assert.strictEqual(settings["abc.menuView.autoOpen"].type, "boolean");
    assert.strictEqual(settings["abc.menuView.autoOpen"].default, true);
    assert.deepStrictEqual(settings["abc.menuView.location"].enum, ["beside", "panel"]);
    assert.strictEqual(settings["abc.menuView.location"].default, "beside");
    assert.strictEqual(settings["abc.menuView.location"].enumDescriptions?.length, 2);
  });

  it("contributes the webview of the bottom panel only when the location is the panel", () => {
    const containers = manifest.contributes.viewsContainers.panel;
    assert.ok(containers.some((container: { id: string }) => container.id === "abcKeys"));
    const view = manifest.contributes.views.abcKeys.find((entry: { id: string }) => entry.id === "abcMenuView");
    assert.strictEqual(view.type, "webview");
    assert.ok(String(view.when).includes("config.abc.menuView.location == panel"));
  });

  it("contributes the commands that show and hide the menu view", () => {
    const commands: Array<{ command: string }> = manifest.contributes.commands;
    assert.ok(commands.some((entry) => entry.command === "abc.menu.showView"));
    assert.ok(commands.some((entry) => entry.command === "abc.menu.hideView"));
  });

  it("describes every setting", () => {
    for (const name of ["abc.keymap", "abc.keyboardLayout", "abc.keyboardGeometry", "abc.menuView.autoOpen", "abc.menuView.location"]) {
      assert.ok(settings[name].description && settings[name].description.length > 10, name);
    }
  });
});
