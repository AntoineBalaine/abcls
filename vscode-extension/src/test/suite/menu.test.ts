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

function menuViewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.label === "ABC keys");
}

async function waitFor(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
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

  test("opens the view beside the editor without taking the focus, and keeps it when the menu closes", async () => {
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.languageId === "abc");
    await vscode.commands.executeCommand("abc.menu.transform");
    assert.ok(await waitFor(() => menuViewTabs().length === 1), "the view must open");
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), editor.document.uri.toString(), "the focus must stay in the ABC editor");
    await key("<esc>");
    assert.strictEqual(menuViewTabs().length, 1, "the view stays open as a reference");
  });

  test("does not open the view when autoOpen is off, and opens it with the command", async () => {
    await vscode.commands.executeCommand("abc.menu.hideView");
    assert.ok(await waitFor(() => menuViewTabs().length === 0));
    const configuration = vscode.workspace.getConfiguration("abc");
    await configuration.update("menuView.autoOpen", false, vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand("abc.menu.select");
      assert.strictEqual(menuViewTabs().length, 0);
      await vscode.commands.executeCommand("abc.menu.close");
      await vscode.commands.executeCommand("abc.menu.showView");
      assert.ok(await waitFor(() => menuViewTabs().length === 1));
    } finally {
      await configuration.update("menuView.autoOpen", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("runs a key that is clicked in the view, and gives the focus back to the editor", async () => {
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.languageId === "abc");
    let ran = 0;
    const probe = vscode.commands.registerCommand("abc.testProbe", () => {
      ran++;
    });
    const configuration = vscode.workspace.getConfiguration("abc");
    await configuration.update(
      "keymap",
      { select: { q: { label: "probe", category: "history", action: { kind: "command", name: "abc.testProbe" } } } },
      vscode.ConfigurationTarget.Global
    );
    try {
      await vscode.commands.executeCommand("abc.menu.showView");
      assert.ok(await waitFor(() => menuViewTabs().length === 1));
      await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
      // The menu is closed here, so the click first opens the mode that the view shows, which is select.
      await vscode.commands.executeCommand("_abc.menu.viewMessage", { type: "press", notation: "q" });
      assert.strictEqual(ran, 1, "the clicked key must run its command once");
      assert.strictEqual((await state()).open, false);
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), editor.document.uri.toString(), "the focus must be back in the ABC editor");
    } finally {
      probe.dispose();
      await configuration.update("keymap", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("ignores a message of the view that has no valid shape", async () => {
    await vscode.commands.executeCommand("_abc.menu.viewMessage", null);
    await vscode.commands.executeCommand("_abc.menu.viewMessage", { type: "press", notation: 5 });
    await vscode.commands.executeCommand("_abc.menu.viewMessage", { type: "other" });
    assert.strictEqual((await state()).open, false);
  });

  test("does not open in a file that is not ABC", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: "text" });
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("abc.menu.transform");
    assert.strictEqual((await state()).open, false);
  });
});
