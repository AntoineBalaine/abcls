import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { MIDIIn } from "./Midi/midi-in";

/**
 * This functionality is ripped from LilyPond's extension.
 * Allows for taking MIDI input and converting it to ABC notation.
 */
const registerMidiInputs = (context: vscode.ExtensionContext) => {
  // start midi input
  const startInputMidiCmd = vscode.commands.registerCommand("abc.startMIDIInput", () => {
    MIDIIn.startMIDIInput();
  });
  context.subscriptions.push(startInputMidiCmd);

  // stop midi input
  const stopInputMidiCmd = vscode.commands.registerCommand("abc.stopMIDIInput", () => {
    MIDIIn.stopMIDIInput();
  });
  context.subscriptions.push(stopInputMidiCmd);

  // set midi input device
  const setInputMidiDeviceCmd = vscode.commands.registerCommand("abc.setInputMIDIDevice", () => {
    MIDIIn.setInputMIDIDevice();
  });
  context.subscriptions.push(setInputMidiDeviceCmd);

  // restart midi input
  const restartMIDIInputCmd = vscode.commands.registerCommand("abc.restartMIDIInput", () => {
    MIDIIn.restartMIDIInput();
  });
  context.subscriptions.push(restartMIDIInputCmd);

  const setPedalModeCmd = vscode.commands.registerCommand("abc.setMIDIInputPedalMode", () => {
    MIDIIn.setPedalMode();
  });
  context.subscriptions.push(setPedalModeCmd);

  const writeRestCmd = vscode.commands.registerCommand("abc.writeMIDIInputRest", () => MIDIIn.writeRest());
  const writeBarLineCmd = vscode.commands.registerCommand("abc.writeMIDIInputBarLine", () => MIDIIn.writeBarLine());
  const undoInputCmd = vscode.commands.registerCommand("abc.undoMIDIInput", () => MIDIIn.undoInput());
  context.subscriptions.push(writeRestCmd, writeBarLineCmd, undoInputCmd);

  const toggleSelectLatestInputCmd = vscode.commands.registerCommand("abc.toggleMIDIInputSelectLatest", () => {
    MIDIIn.toggleSelectLatestInput();
  });
  context.subscriptions.push(toggleSelectLatestInputCmd);

  const toggleMIDIInputGateCmd = vscode.commands.registerCommand("abc.toggleMIDIInputGate", () => {
    MIDIIn.toggleInputGate();
  });
  context.subscriptions.push(toggleMIDIInputGateCmd);

  // status bar items for MIDI playback
  MIDIIn.initMIDIStatusBarItems();
};

function registerMidiExport(context: vscode.ExtensionContext, client: LanguageClient) {
  const exportMidiCmd = vscode.commands.registerCommand("abc.exportToMidi", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "abc") return;

    const sourcePath = editor.document.fileName;
    const defaultUri = vscode.Uri.file(sourcePath.replace(/\.abc$/, ".mid"));

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "MIDI files": ["mid", "midi"] },
    });
    if (!saveUri) return;

    try {
      const result = await client.sendRequest<{ midi: string }>("abc.exportMidi", {
        uri: editor.document.uri.toString(),
      });

      const bytes = Buffer.from(result.midi, "base64");
      await vscode.workspace.fs.writeFile(saveUri, bytes);
      vscode.window.showInformationMessage(`MIDI exported to ${saveUri.fsPath}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`MIDI export failed: ${msg}`);
    }
  });
  context.subscriptions.push(exportMidiCmd);
}

function registerMidiImport(context: vscode.ExtensionContext, client: LanguageClient) {
  const importMidiCmd = vscode.commands.registerCommand("abc.importFromMidi", async () => {
    const fileUri = await vscode.window.showOpenDialog({
      filters: { "MIDI files": ["mid", "midi"] },
      canSelectMany: false,
    });
    if (!fileUri || fileUri.length === 0) return;

    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri[0]);
      const midiBase64 = Buffer.from(bytes).toString("base64");

      const result = await client.sendRequest<{ abc: string }>("abc.importMidi", {
        midi: midiBase64,
      });
      const doc = await vscode.workspace.openTextDocument({ content: result.abc, language: "abc" });
      await vscode.window.showTextDocument(doc);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`MIDI import failed: ${msg}`);
    }
  });
  context.subscriptions.push(importMidiCmd);
}

/**
 * Register the commands that the extension will use to ask the server to do special things.
 * The old transform commands (divideRhythm, multiplyRhythm, transposeUp, transposeDn) have been
 * replaced by the new editor-based transform commands in transformCommands.ts.
 */
export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient) {
  registerMidiInputs(context);
  registerMidiExport(context, client);
  registerMidiImport(context, client);
}
