import * as assert from "assert";
import * as vscode from "vscode";

interface MenuSnapshot {
  open: boolean;
  mode: string;
  path: string[];
  count: string;
}

async function state(): Promise<MenuSnapshot> {
  return (await vscode.commands.executeCommand("_abc.menu.state")) as MenuSnapshot;
}

async function key(notation: string): Promise<void> {
  await vscode.commands.executeCommand("abc.menu.key", { notation });
}

suite("The modal menu", () => {
  suiteSetup(async () => {
    const document = await vscode.workspace.openTextDocument({ language: "abc", content: "X:1\nK:C\nCDEF|\n" });
    await vscode.window.showTextDocument(document);
    // The extension registers the menu commands once its language server has started.
    for (let attempt = 0; attempt < 100; attempt++) {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes("abc.menu.transform")) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  teardown(async () => {
    await vscode.commands.executeCommand("abc.menu.close");
  });

  test("opens the transform menu and closes it on Esc", async () => {
    await vscode.commands.executeCommand("abc.menu.transform");
    assert.deepStrictEqual(await state(), { open: true, mode: "transform", path: [], count: "" });
    await key("<esc>");
    assert.strictEqual((await state()).open, false);
  });

  test("follows a count and a group, and switches the mode", async () => {
    await vscode.commands.executeCommand("abc.menu.transform");
    await key("5");
    await key("g");
    assert.deepStrictEqual(await state(), { open: true, mode: "transform", path: ["g"], count: "5" });
    await key("<");
    assert.deepStrictEqual(await state(), { open: true, mode: "select", path: [], count: "5" });
  });

  test("closes after a command and ignores the keys while it is closed", async () => {
    await vscode.commands.executeCommand("abc.menu.select");
    await key("c");
    assert.strictEqual((await state()).open, false);
    await key("c");
    assert.strictEqual((await state()).open, false);
  });

  test("reports a command that does not exist and closes, instead of rejecting", async () => {
    const configuration = vscode.workspace.getConfiguration("abc");
    await configuration.update(
      "keymap",
      { select: { q: { label: "broken", category: "history", action: { kind: "command", name: "abc.noSuchCommand" } } } },
      vscode.ConfigurationTarget.Global
    );
    try {
      await vscode.commands.executeCommand("abc.menu.select");
      await key("q");
      assert.strictEqual((await state()).open, false);
    } finally {
      await configuration.update("keymap", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("does not open in a file that is not ABC", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: "text" });
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("abc.menu.transform");
    assert.strictEqual((await state()).open, false);
  });
});
