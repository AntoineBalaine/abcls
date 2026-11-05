/**
 * Carries out the leaf that the menu chose.
 *
 * The count typed in the menu is expanded into the arguments first, and then the action goes to the selector,
 * the transform or the command that the leaf names. A leaf of kind mode never gets here, because the state machine handles it.
 */

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { expandArgs } from "../keymap/resolve";
import { Leaf } from "../keymap/types";
import { applySelectorByName } from "../selectorCommands";
import { applyTransform } from "../transformCommands";

export interface DispatchDeps {
  client: LanguageClient;
  statusBarItem: vscode.StatusBarItem;
}

/** True when the active editor has only cursors, with no selected text. */
function hasNothingSelected(): boolean {
  const editor = vscode.window.activeTextEditor;
  return editor !== undefined && editor.selections.every((selection) => selection.isEmpty);
}

export async function runLeaf(leaf: Leaf, count: number | undefined, deps: DispatchDeps): Promise<void> {
  const args = expandArgs(leaf.action.args, count);
  switch (leaf.action.kind) {
    case "selector":
      await applySelectorByName(deps.client, leaf.action.name, args, deps.statusBarItem);
      return;
    case "transform":
      // Because a transform acts on the selection, a bare cursor leaves it nothing to work on, and the command would return without a word.
      if (hasNothingSelected()) {
        vscode.window.showInformationMessage(
          "Nothing is selected, so there is nothing to transform. Switch to the select menu with < or Tab, choose what to select, and switch back with > or Tab."
        );
        return;
      }
      await applyTransform(deps.client, leaf.action.name, args, deps.statusBarItem);
      return;
    case "command":
      await vscode.commands.executeCommand(leaf.action.name, ...args);
      return;
    default:
      return;
  }
}
