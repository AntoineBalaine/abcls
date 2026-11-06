/**
 * The modal menu of the extension.
 *
 * The keys reach it through the keybindings that package.json contributes while the context key abc.modeMenuOpen is set.
 * The state machine decides what a key means, and this module carries out the result: it keeps the context key,
 * the status bar item and the view in step with the state, and runs the leaf that the menu chose.
 */

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { DEFAULT_KEYMAP } from "../keymap/defaultKeymap";
import { mergeKeymap } from "../keymap/loadKeymap";
import { Keymap, MenuMode } from "../keymap/types";
import { validateKeymap } from "../keymap/validate";
import { runLeaf } from "./dispatch";
import { MENU_BEPO_CONTEXT, MENU_OPEN_CONTEXT, outsideSupersetWarning } from "./keybindingKeys";
import { MenuState, closedState, openMenu, step } from "./menuState";

/** What the engine tells the view after every change. */
export type MenuListener = (state: MenuState, keymap: Keymap) => void;

export interface MenuContext {
  client: LanguageClient;
  statusBarItem: vscode.StatusBarItem;
  menuStatusItem: vscode.StatusBarItem;
  state: MenuState;
  keymap: Keymap;
  shownWarning: string;
  /** True while a leaf runs, so that a second menu cannot start a second command on the same document. */
  busy: boolean;
  /** The keys that were pressed are handled one after the other, because a command may take a while and the menu stays open. */
  queue: Promise<void>;
  /** The document in which the menu was opened: a change to another document closes the menu, and a change back to this one does not. */
  openedIn: vscode.TextDocument | undefined;
  listeners: MenuListener[];
}

/** Reads abc.keymap, merges it into the defaults, and returns the keymap with the problems that the user should know about. */
export function loadKeymapFromSettings(): { keymap: Keymap; problems: string[] } {
  const override = vscode.workspace.getConfiguration("abc").get<unknown>("keymap");
  const { keymap, errors } = mergeKeymap(DEFAULT_KEYMAP, override);
  const problems = [...errors, ...validateKeymap(keymap)];
  const outside = outsideSupersetWarning(keymap);
  if (outside !== undefined) problems.push(outside);
  return { keymap, problems };
}

function describeState(state: MenuState): string {
  const parts: string[] = [state.mode, ...state.path];
  if (state.count !== "") parts.push(state.count);
  return `$(keyboard) ${parts.join(" › ")}`;
}

function notify(ctx: MenuContext): void {
  for (const listener of ctx.listeners) listener(ctx.state, ctx.keymap);
}

async function applyState(ctx: MenuContext, next: MenuState): Promise<void> {
  const wasOpen = ctx.state.open;
  ctx.state = next;
  if (wasOpen !== next.open) await vscode.commands.executeCommand("setContext", MENU_OPEN_CONTEXT, next.open);
  if (next.open) {
    ctx.menuStatusItem.text = describeState(next);
    ctx.menuStatusItem.show();
  } else {
    ctx.menuStatusItem.hide();
  }
  notify(ctx);
}

export async function openMode(ctx: MenuContext, mode: MenuMode): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "abc" || ctx.busy) return;
  ctx.openedIn = editor.document;
  await applyState(ctx, openMenu(mode));
}

export async function closeMenu(ctx: MenuContext): Promise<void> {
  if (!ctx.state.open) return;
  await applyState(ctx, closedState(ctx.state.mode));
}

/** Whether the menu stays open after a command (abc.menu.sticky, on by default). */
function isSticky(): boolean {
  return vscode.workspace.getConfiguration("abc").get<boolean>("menu.sticky", true);
}

/** Handles a key after the keys that came before it, so that two quick keys never run two commands at the same time. */
export function handleKey(ctx: MenuContext, notation: string): Promise<void> {
  const handled = ctx.queue.then(() => processKey(ctx, notation));
  ctx.queue = handled.catch(() => undefined);
  return handled;
}

async function processKey(ctx: MenuContext, notation: string): Promise<void> {
  const result = step(ctx.state, ctx.keymap, { notation }, isSticky());
  // A menu that closes does so before the leaf runs, so that a command that prompts the user does not run with the menu still open.
  await applyState(ctx, result.state);
  if (result.effect.kind === "run") {
    ctx.busy = true;
    try {
      await runLeaf(result.effect.leaf, result.effect.count, { client: ctx.client, statusBarItem: ctx.statusBarItem });
    } catch (error) {
      // A leaf may name a command that does not exist, for example after a typo in abc.keymap, and the key must not fail silently.
      vscode.window.showErrorMessage(`ABC menu: the command of ${result.effect.leaf.label} failed: ${error}`);
    } finally {
      ctx.busy = false;
    }
  } else if (result.effect.kind === "error") {
    vscode.window.showErrorMessage(`ABC menu: ${result.effect.message}`);
  }
}

export function reloadKeymap(ctx: MenuContext): void {
  const { keymap, problems } = loadKeymapFromSettings();
  ctx.keymap = keymap;
  const text = problems.join("\n");
  // The same problems are shown once, not at every change of an unrelated setting.
  if (problems.length > 0 && text !== ctx.shownWarning) {
    vscode.window.showWarningMessage(`The setting abc.keymap has problems:\n${text}`);
  }
  ctx.shownWarning = text;
  notify(ctx);
}

/** Tells the keybindings whether the BÉPO layout is chosen, because the digit row of that layout sends other keys than the US one. */
function updateBepoContext(): void {
  const layout = vscode.workspace.getConfiguration("abc").get<string>("keyboardLayout", "qwerty");
  void vscode.commands.executeCommand("setContext", MENU_BEPO_CONTEXT, layout === "bepo");
}

/**
 * Registers the menu commands and returns the context, so that the view can listen to it.
 * The commands are abc.menu.select, abc.menu.transform, abc.menu.close and abc.menu.key (with the argument { notation }).
 */
export function registerModalMenu(context: vscode.ExtensionContext, client: LanguageClient, statusBarItem: vscode.StatusBarItem): MenuContext {
  const menuStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(menuStatusItem);

  const ctx: MenuContext = {
    client,
    statusBarItem,
    menuStatusItem,
    state: closedState(),
    keymap: DEFAULT_KEYMAP,
    shownWarning: "",
    busy: false,
    queue: Promise.resolve(),
    openedIn: undefined,
    listeners: [],
  };
  reloadKeymap(ctx);
  // Because the workbench keeps a context key across a restart of the extension host, the key is reset, so that no stale open menu survives.
  void vscode.commands.executeCommand("setContext", MENU_OPEN_CONTEXT, false);
  updateBepoContext();

  context.subscriptions.push(
    vscode.commands.registerCommand("abc.menu.select", () => openMode(ctx, "select")),
    vscode.commands.registerCommand("abc.menu.transform", () => openMode(ctx, "transform")),
    vscode.commands.registerCommand("abc.menu.close", () => closeMenu(ctx)),
    // An internal command (the underscore keeps it out of the palette) that lets the extension host tests read the state.
    vscode.commands.registerCommand("_abc.menu.state", () => ({ open: ctx.state.open, mode: ctx.state.mode, path: ctx.state.path, count: ctx.state.count })),
    vscode.commands.registerCommand("abc.menu.key", (args?: { notation?: unknown }) => {
      if (typeof args?.notation !== "string") return undefined;
      return handleKey(ctx, args.notation);
    }),
    // Because the menu holds the keyboard only for one command, switching editors drops it, and the context key never stays set.
    // The event also fires with no editor when the focus moves to a webview, and when the view hands the focus back to the same document,
    // and neither must close the menu: only another document does.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined && editor.document !== ctx.openedIn) void closeMenu(ctx);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("abc.keymap")) reloadKeymap(ctx);
      if (event.affectsConfiguration("abc.keyboardLayout")) updateBepoContext();
    })
  );
  return ctx;
}
