/**
 * Remote control through vscode:// links.
 *
 * Because an outside program (a DAW script, for instance) cannot call
 * VS Code commands directly, we register a URI handler, so that a link such as
 *
 *   vscode://antoinebalaine.abc-ls/open?file=%2Ftmp%2Fscore.abc&preview=1
 *
 * opens the file in the running window and, when `preview` is set, shows the
 * score preview beside it.
 */
import * as vscode from "vscode";

export class AbcUriHandler implements vscode.UriHandler {
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== "/open") {
      vscode.window.showWarningMessage(`abc-ls: unknown link "${uri.path}".`);
      return;
    }

    const params = new URLSearchParams(uri.query);
    const file = params.get("file");
    // Because any web page can hold a vscode:// link, we only ever open files
    // that look like ABC scores, and never run anything from the link.
    if (!file || !/\.abcx?$/i.test(file)) {
      vscode.window.showWarningMessage("abc-ls: the link must name an .abc file.");
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
    if (params.get("preview") === "1") {
      await vscode.commands.executeCommand("abc.showPreview");
    }
  }
}

export function registerUriHandler(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerUriHandler(new AbcUriHandler()));
}
