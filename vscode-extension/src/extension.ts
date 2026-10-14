// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { registerCommands } from "./extensionCommands";
import { registerRendererCommands, setLspClient } from "./renderer";
import { registerSelectorCommands } from "./selectorCommands";
import { registerTransformCommands } from "./transformCommands";
import { registerUriHandler } from "./uriHandler";

let client: LanguageClient;

/**
 * This method is called when the extension is activated.
 *
 * The extension is activated the very first time the command is executed
 */
export async function activate(context: ExtensionContext) {
  const playbackEnabled = vscode.workspace.getConfiguration("abc").get<boolean>("experimental.playback", false);

  if (playbackEnabled) {
    try {
      const { setMscorePath } = await import("abcls-native");
      const binaryName = os.platform() === "win32" ? "mscore.exe" : "mscore";
      setMscorePath(context.asAbsolutePath(path.join("bin", binaryName)));
    } catch {
      vscode.window.showWarningMessage("Playback is enabled but the native module could not be loaded. See MUSESAMPLER_SETUP.md.");
    }
  }

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for abc documents
    documentSelector: [{ scheme: "file", language: "abc" }],
  };

  // Create the language client and start the client.
  client = new LanguageClient("abcLanguageServer", "ABC Language Server", serverOptions, clientOptions);

  // Set the LSP client for the renderer
  setLspClient(client);

  // register list of extension's commands
  registerCommands(context, client);

  // register renderer commands (preview, export, print)
  registerRendererCommands(context);

  // let outside programs open a score and its preview through vscode:// links
  registerUriHandler(context);

  // register playback commands (play, stop, pause) only if experimental playback is enabled
  if (playbackEnabled) {
    const { registerPlaybackCommands } = await import("./playback");
    registerPlaybackCommands(context);
  }

  // Start the client. This will also launch the server
  await client.start();

  // Create shared statusBarItem for selector and transform commands
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "abc.resetSelection";
  context.subscriptions.push(statusBarItem);

  // Register selector commands (depends on client being ready)
  registerSelectorCommands(context, client, statusBarItem);

  // Register transform commands (depends on client being ready)
  registerTransformCommands(context, client, statusBarItem);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
