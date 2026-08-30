/**
 * Transform commands for the VSCode extension.
 *
 * These commands apply editor transforms to the current editor selections.
 * The API is editor-agnostic: selections go in, text edits and result ranges come out.
 */

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { Range } from "vscode-languageserver-types";

interface ApplyTransformResult {
  textEdits: Array<{
    range: Range;
    newText: string;
  }>;
  cursorRanges: Range[];
}

function selectionsToRanges(selections: readonly vscode.Selection[]): Range[] {
  return selections.map((sel) => ({
    start: { line: sel.start.line, character: sel.start.character },
    end: { line: sel.end.line, character: sel.end.character },
  }));
}

interface WrapDynamicResult {
  text: string;
}

export function registerTransformCommands(context: vscode.ExtensionContext, client: LanguageClient, statusBarItem: vscode.StatusBarItem): void {
  // Wrap dynamic commands (crescendo/decrescendo)
  const wrapCommands: Array<[string, string]> = [
    ["abc.wrapCrescendo", "crescendo"],
    ["abc.wrapDecrescendo", "decrescendo"],
  ];

  for (const [commandId, dynamicType] of wrapCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "abc") return;

        const selection = editor.selection;
        if (selection.isEmpty) {
          vscode.window.showInformationMessage("Please select some notes first.");
          return;
        }

        const uri = editor.document.uri.toString();

        try {
          const result = await client.sendRequest<WrapDynamicResult>("abc.wrapDynamic", {
            uri,
            dynamicType,
            selection: {
              start: { line: selection.start.line, character: selection.start.character },
              end: { line: selection.end.line, character: selection.end.character },
            },
          });

          if (result.text) {
            const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
            await editor.edit((editBuilder) => {
              editBuilder.replace(fullRange, result.text);
            });
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Transform command failed: ${error}`);
        }
      })
    );
  }

  // Transforms without arguments
  const simpleTransforms: Array<[string, string]> = [
    ["abc.enharmonize", "enharmonize"],
    ["abc.enharmonizeToKey", "enharmonizeToKey"],
    ["abc.toRest", "toRest"],
    ["abc.unwrapSingle", "unwrapSingle"],
    ["abc.remove", "remove"],
    ["abc.consolidateRests", "consolidateRests"],
    ["abc.voiceInfoLineToInline", "voiceInfoLineToInline"],
    ["abc.voiceInlineToInfoLine", "voiceInlineToInfoLine"],
    ["abc.explode2", "explode2"],
    ["abc.explode3", "explode3"],
    ["abc.explode4", "explode4"],
    ["abc.multiplyRhythm", "multiplyRhythm"],
    ["abc.divideRhythm", "divideRhythm"],
    ["abc.addSharp", "addSharp"],
    ["abc.addFlat", "addFlat"],
    ["abc.legato", "legato"],
    ["abc.toSlashNotation", "toSlashNotation"],
  ];

  for (const [commandId, transformName] of simpleTransforms) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, transformName, [], statusBarItem)));
  }

  // transpose: prompt for semitones
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.transpose", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Semitones to transpose (negative = down)",
        validateInput: (v) => (isNaN(Number(v)) ? "Must be a number" : null),
      });
      if (input === undefined) return;
      await applyTransform(client, "transpose", [Number(input)], statusBarItem);
    })
  );

  // setRhythm: prompt for rational value
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.setRhythm", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Rhythm value (e.g., 1/4, 1/2, 3/8)",
        placeHolder: "1/4",
      });
      if (input === undefined) return;
      const rational = parseRational(input);
      if (!rational) {
        vscode.window.showErrorMessage("Invalid rational format");
        return;
      }
      await applyTransform(client, "setRhythm", [rational], statusBarItem);
    })
  );

  // addToRhythm: prompt for rational value
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.addToRhythm", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Value to add to rhythm (e.g., 1/8, -1/4)",
        placeHolder: "1/8",
      });
      if (input === undefined) return;
      const rational = parseRational(input);
      if (!rational) {
        vscode.window.showErrorMessage("Invalid rational format");
        return;
      }
      await applyTransform(client, "addToRhythm", [rational], statusBarItem);
    })
  );

  // addVoice: prompt for voice ID and optional params
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.addVoice", async () => {
      const voiceId = await vscode.window.showInputBox({
        prompt: "Voice ID (e.g., V1, T, S)",
      });
      if (!voiceId) return;

      const name = await vscode.window.showInputBox({
        prompt: "Voice name (optional)",
      });

      await applyTransform(client, "addVoice", [voiceId, { name: name || undefined }], statusBarItem);
    })
  );

  // insertVoiceLine: prompt for voice ID, duplicate lines with selected notes
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.insertVoiceLine", async () => {
      const voiceName = await vscode.window.showInputBox({
        prompt: "Enter voice identifier",
        placeHolder: "e.g., V2, Tenor, RH",
      });
      if (!voiceName) return;

      await applyTransform(client, "insertVoiceLine", [voiceName], statusBarItem);
    })
  );

  // explode: prompt for part count
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.explode", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Number of parts to explode into (2-8)",
        validateInput: (v) => {
          const n = Number(v);
          if (isNaN(n) || !Number.isInteger(n)) return "Must be an integer";
          if (n < 2 || n > 8) return "Must be between 2 and 8";
          return null;
        },
      });
      if (input === undefined) return;
      await applyTransform(client, "explode", [Number(input)], statusBarItem);
    })
  );

  // explosion: prompt for target voice IDs
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.explosion", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Target voice IDs (comma-separated, e.g., 1,2,3)",
        placeHolder: "1,2,3",
        validateInput: (v) => {
          const parts = v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (parts.length < 2) return "At least 2 target voices required";
          return null;
        },
      });
      if (input === undefined) return;
      const targetVoiceIds = input
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await applyTransform(client, "explosion", [targetVoiceIds], statusBarItem);
    })
  );

  // Quick-access transpose commands with preset values
  const transposePresets: Array<[string, number]> = [
    ["abc.transposeOctaveUp", 12],
    ["abc.transposeOctaveDown", -12],
    ["abc.transposeHalfStepUp", 1],
    ["abc.transposeHalfStepDown", -1],
  ];

  for (const [commandId, semitones] of transposePresets) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, "transpose", [semitones], statusBarItem)));
  }

  // Diatonic harmonize commands with preset intervals
  const harmonizePresets: Array<[string, number]> = [
    ["abc.harmonize3rdUp", 2],
    ["abc.harmonize3rdDown", -2],
    ["abc.harmonize4thUp", 3],
    ["abc.harmonize4thDown", -3],
    ["abc.harmonize5thUp", 4],
    ["abc.harmonize5thDown", -4],
    ["abc.harmonize6thUp", 5],
    ["abc.harmonize6thDown", -5],
  ];

  for (const [commandId, steps] of harmonizePresets) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, "harmonize", [steps], statusBarItem)));
  }

  // Chord-symbol-based harmonization commands. These build a chord under a
  // selected melody note; the drop voicings below rearrange a chord that is
  // already written, so they are separate commands on a separate transform.
  const voicingPresets: Array<[string, string]> = [
    ["abc.harmonizeClose", "close"],
    ["abc.harmonizeCluster", "cluster"],
  ];

  for (const [commandId, voicing] of voicingPresets) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, "harmonizeVoicing", [voicing, 4, null], statusBarItem)));
  }

  // Chord revoicing commands: these act on selected chords.
  const dropPresets: Array<[string, string]> = [
    ["abc.drop2", "drop2"],
    ["abc.drop24", "drop24"],
    ["abc.drop3", "drop3"],
  ];

  for (const [commandId, voicing] of dropPresets) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, "dropVoicing", [voicing], statusBarItem)));
  }

  // Chord-symbol voicing with voice count prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.harmonizeVoicing", async () => {
      const voicing = await vscode.window.showQuickPick(["close", "cluster"], {
        placeHolder: "Select voicing type",
      });
      if (!voicing) return;

      const voiceCountInput = await vscode.window.showInputBox({
        prompt: "Number of voices (4, 5, or 6)",
        value: "4",
        validateInput: (v) => {
          const n = Number(v);
          if (isNaN(n) || ![4, 5, 6].includes(n)) return "Must be 4, 5, or 6";
          return null;
        },
      });
      if (voiceCountInput === undefined) return;

      await applyTransform(client, "harmonizeVoicing", [voicing, Number(voiceCountInput), null], statusBarItem);
    })
  );

  // Parallel voicing commands with preset direction/mode
  const parallelPresets: Array<[string, string, string]> = [
    ["abc.parallelDiatonicPrev", "prev", "diatonic"],
    ["abc.parallelDiatonicNext", "next", "diatonic"],
    ["abc.parallelChromaticPrev", "prev", "chromatic"],
    ["abc.parallelChromaticNext", "next", "chromatic"],
  ];

  for (const [commandId, direction, mode] of parallelPresets) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => applyTransform(client, "parallelVoicing", [direction, mode], statusBarItem)));
  }

  // Parallel voicing with prompts
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.parallelVoicing", async () => {
      const direction = await vscode.window.showQuickPick(["prev", "next"], {
        placeHolder: "Reference chord direction",
      });
      if (!direction) return;

      const mode = await vscode.window.showQuickPick(["diatonic", "chromatic"], {
        placeHolder: "Shift mode",
      });
      if (!mode) return;

      await applyTransform(client, "parallelVoicing", [direction, mode], statusBarItem);
    })
  );

  // Split system at cursor position(s)
  // This is a position-based transform: it uses cursor positions directly
  // rather than requiring a selection of notes/chords
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.splitSystem", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "abc") return;

      const uri = editor.document.uri.toString();

      // Convert VSCode selections to LSP ranges (using cursor positions)
      // For position-based transforms, we use the cursor position (active) rather than the full selection
      const ranges = editor.selections.map((sel) => ({
        start: { line: sel.active.line, character: sel.active.character },
        end: { line: sel.active.line, character: sel.active.character },
      }));

      try {
        const result = await client.sendRequest<ApplyTransformResult>("abc.applyTransform", {
          uri,
          transform: "splitSystems",
          args: [],
          selections: ranges,
        });

        // Apply text edits
        if (result.textEdits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          for (const edit of result.textEdits) {
            const range = new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character);
            workspaceEdit.replace(editor.document.uri, range, edit.newText);
          }

          const editSuccess = await vscode.workspace.applyEdit(workspaceEdit);
          if (!editSuccess) {
            vscode.window.showErrorMessage("Failed to apply split system edits");
            return;
          }
        }

        // Update cursor positions to new system starts
        if (result.cursorRanges.length > 0) {
          editor.selections = result.cursorRanges.map((r) => {
            const pos = new vscode.Position(r.start.line, r.start.character);
            return new vscode.Selection(pos, pos);
          });
          statusBarItem.text = `$(split-horizontal) Split complete`;
          statusBarItem.show();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Split system failed: ${error}`);
      }
    })
  );
}

async function applyTransform(client: LanguageClient, transform: string, args: unknown[], statusBarItem: vscode.StatusBarItem): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "abc") return;

  const selections = editor.selections;
  if (selections.every((s) => s.isEmpty)) {
    // Silently return - no selection means nothing to transform
    return;
  }

  const uri = editor.document.uri.toString();

  try {
    const result = await client.sendRequest<ApplyTransformResult>("abc.applyTransform", {
      uri,
      transform,
      args,
      selections: selectionsToRanges(selections),
    });

    // Apply text edits
    if (result.textEdits.length > 0) {
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const edit of result.textEdits) {
        const range = new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character);
        workspaceEdit.replace(editor.document.uri, range, edit.newText);
      }

      const editSuccess = await vscode.workspace.applyEdit(workspaceEdit);
      if (!editSuccess) {
        vscode.window.showErrorMessage("Failed to apply transform edits");
        return;
      }
    }

    // Update editor selections to the result ranges
    if (result.cursorRanges.length > 0) {
      editor.selections = result.cursorRanges.map(
        (r) => new vscode.Selection(new vscode.Position(r.start.line, r.start.character), new vscode.Position(r.end.line, r.end.character))
      );
      statusBarItem.text = `$(selection) ${result.cursorRanges.length} cursor${result.cursorRanges.length > 1 ? "s" : ""}`;
      statusBarItem.show();
    } else {
      // No result cursors (e.g., after remove)
      statusBarItem.hide();
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Transform failed: ${error}`);
  }
}

function parseRational(input: string): { numerator: number; denominator: number } | null {
  const match = input.match(/^(-?\d+)(?:\/(\d+))?$/);
  if (!match) return null;
  const numerator = parseInt(match[1], 10);
  const denominator = match[2] ? parseInt(match[2], 10) : 1;
  if (denominator === 0) return null;
  return { numerator, denominator };
}
