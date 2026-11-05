/**
 * The webview that shows the menu.
 *
 * The view lives in an editor column beside the current one, or in the bottom panel (the setting abc.menuView.location).
 * It opens without taking the keyboard focus, so the keybindings of the menu keep working in the editor.
 * Because a message that arrives before the page has loaded would be lost, each page says when it is ready and the extension
 * then sends it the current model. The two possible pages are tracked apart, so one cannot hide the other's state.
 */

import * as vscode from "vscode";
import { KeyboardOptions, buildKeyboardModel } from "../keyboard/keyboardModel";
import { Keymap } from "../keymap/types";
import { MenuState } from "./menuState";
import { makeNonce, renderWebviewHtml } from "./menuViewHtml";
import { buildViewModel } from "./menuViewModel";
import { MenuContext, handleKey, openMode } from "./modalMenu";
import { ToExtension, ToWebview } from "./viewMessages";

export const VIEW_TYPE = "abcMenuView";
export const PANEL_VIEW_ID = "abcMenuView";

/** One page that shows the menu, and whether it has said that it is ready to receive the model. */
export interface Host {
  webview: vscode.Webview;
  ready: boolean;
}

export interface MenuViewContext {
  menu: MenuContext;
  extensionUri: vscode.Uri;
  panel: vscode.WebviewPanel | undefined;
  panelHost: Host | undefined;
  viewHost: Host | undefined;
  previous: MenuState;
  /** The last ABC editor, to which the focus goes back after a click in the view. */
  lastEditor: vscode.TextEditor | undefined;
}

function liveHosts(view: MenuViewContext): Host[] {
  const hosts: Host[] = [];
  if (view.panelHost) hosts.push(view.panelHost);
  if (view.viewHost) hosts.push(view.viewHost);
  return hosts;
}

function htmlFor(view: MenuViewContext, webview: vscode.Webview): string {
  const base = vscode.Uri.joinPath(view.extensionUri, "dist", "webview");
  return renderWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(base, "menuView.js")).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(base, "menuView.css")).toString(),
    nonce: makeNonce(),
  });
}

function sendModel(host: Host, keymap: Keymap, state: MenuState): void {
  // Before the page is ready the message would be lost, and the ready message makes the extension send the current model.
  if (!host.ready) return;
  const message: ToWebview = { type: "model", model: buildViewModel(keymap, state), keyboard: buildKeyboardModel(keymap, state, keyboardOptions()) };
  void host.webview.postMessage(message);
}

export function postModel(view: MenuViewContext, keymap: Keymap, state: MenuState): void {
  for (const host of liveHosts(view)) sendModel(host, keymap, state);
}

/** Gives the focus back to the last ABC editor, because after a click the keys of the menu only work where the editor has the focus. */
async function restoreEditorFocus(view: MenuViewContext): Promise<void> {
  const editor = view.lastEditor;
  if (!editor || editor.document.isClosed) return;
  await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
}

function isToExtension(message: unknown): message is ToExtension {
  if (typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;
  if (type === "ready") return true;
  return type === "press" && typeof (message as { notation?: unknown }).notation === "string";
}

/**
 * A click in the view is a key press. When the menu is closed, the click first opens the mode that the view shows,
 * and the focus goes back to the editor before the key is handled. A message of another shape is ignored.
 */
export async function handleViewMessage(view: MenuViewContext, host: Host, message: unknown): Promise<void> {
  if (!isToExtension(message)) return;
  if (message.type === "ready") {
    host.ready = true;
    sendModel(host, view.menu.keymap, view.menu.state);
    return;
  }
  // A click leaves the focus in the webview, where there is no active editor and the menu cannot run a selector or a transform,
  // so the focus goes back to the editor first. The menu stays open: it closes only when another document becomes active.
  await restoreEditorFocus(view);
  if (!view.menu.state.open) await openMode(view.menu, view.menu.state.mode);
  await handleKey(view.menu, message.notation);
}

function attach(view: MenuViewContext, webview: vscode.Webview): Host {
  const host: Host = { webview, ready: false };
  webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(view.extensionUri, "dist", "webview")] };
  webview.html = htmlFor(view, webview);
  webview.onDidReceiveMessage((message: unknown) => void handleViewMessage(view, host, message));
  return host;
}

/** Opens the panel beside the editor, or shows it again, without taking the focus. */
export function showBesidePanel(view: MenuViewContext): void {
  if (view.panel) {
    view.panel.reveal(undefined, true);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    "ABC keys",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { retainContextWhenHidden: true }
  );
  view.panel = panel;
  view.panelHost = attach(view, panel.webview);
  panel.onDidDispose(() => {
    view.panel = undefined;
    view.panelHost = undefined;
  });
}

/** Closes the beside panel, or the bottom panel when the view lives there. */
export async function hideView(view: MenuViewContext): Promise<void> {
  view.panel?.dispose();
  if (view.viewHost) await vscode.commands.executeCommand("workbench.action.closePanel");
}

/** The layout, the geometry and the ISO keys that the settings ask the keyboard view to draw. A value that is not valid gives the default. */
export function keyboardOptions(): KeyboardOptions {
  const configuration = vscode.workspace.getConfiguration("abc");
  const layout = configuration.get<string>("keyboardLayout", "qwerty");
  const geometry = configuration.get<string>("keyboardGeometry", "staggered");
  return {
    layout: layout === "bepo" ? "bepo" : "qwerty",
    geometry: geometry === "ortholinear" ? "ortholinear" : "staggered",
    iso: configuration.get<boolean>("keyboardIsoKeys", false) === true,
  };
}

function location(): string {
  return vscode.workspace.getConfiguration("abc").get<string>("menuView.location", "beside");
}

function autoOpens(): boolean {
  return vscode.workspace.getConfiguration("abc").get<boolean>("menuView.autoOpen", true);
}

/** Called after every change of the menu: it opens the view when a menu opens or the mode switches, and keeps the model current. */
export function onMenuChanged(view: MenuViewContext, state: MenuState, keymap: Keymap): void {
  const justOpened = state.open && (!view.previous.open || view.previous.mode !== state.mode);
  view.previous = state;
  if (justOpened && autoOpens() && location() === "beside") showBesidePanel(view);
  if (state.open && vscode.window.activeTextEditor?.document.languageId === "abc") view.lastEditor = vscode.window.activeTextEditor;
  postModel(view, keymap, state);
}

export function registerMenuView(context: vscode.ExtensionContext, menu: MenuContext): MenuViewContext {
  const view: MenuViewContext = {
    menu,
    extensionUri: context.extensionUri,
    panel: undefined,
    panelHost: undefined,
    viewHost: undefined,
    previous: menu.state,
    lastEditor: vscode.window.activeTextEditor,
  };

  menu.listeners.push((state, keymap) => onMenuChanged(view, state, keymap));

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      view.viewHost = attach(view, webviewView.webview);
      webviewView.onDidDispose(() => {
        view.viewHost = undefined;
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PANEL_VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    // Because the keyboard model depends on the settings of the layout, a change of them draws the view again.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("abc.keyboardLayout") ||
        event.affectsConfiguration("abc.keyboardGeometry") ||
        event.affectsConfiguration("abc.keyboardIsoKeys")
      ) {
        postModel(view, menu.keymap, menu.state);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "abc") view.lastEditor = editor;
    }),
    vscode.commands.registerCommand("abc.menu.showView", () =>
      location() === "panel" ? vscode.commands.executeCommand(`${PANEL_VIEW_ID}.focus`) : showBesidePanel(view)
    ),
    vscode.commands.registerCommand("abc.menu.hideView", () => hideView(view)),
    // An internal command (the underscore keeps it out of the palette) that lets the extension host tests send a message as the page would.
    vscode.commands.registerCommand("_abc.menu.viewMessage", (message: unknown) =>
      handleViewMessage(view, view.panelHost ?? view.viewHost ?? { webview: undefined as never, ready: false }, message)
    )
  );
  return view;
}
