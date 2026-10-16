import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { Range } from "vscode-languageserver-types";

interface ApplySelectorResult {
  ranges: Range[];
}

/**
 * Extracts non-empty selections from the editor to use as scope constraints.
 * Returns undefined if there are no non-empty selections (just cursors).
 */
function getSelectionRanges(editor: vscode.TextEditor): Range[] | undefined {
  const nonEmptySelections = editor.selections.filter((s) => !s.isEmpty);
  if (nonEmptySelections.length === 0) {
    return undefined;
  }
  return nonEmptySelections.map((s) => ({
    start: { line: s.start.line, character: s.start.character },
    end: { line: s.end.line, character: s.end.character },
  }));
}

function applySelectionsToEditor(editor: vscode.TextEditor, ranges: ApplySelectorResult["ranges"]): void {
  if (ranges.length === 0) {
    vscode.window.showInformationMessage("No matches found.");
    return;
  }

  editor.selections = ranges.map((r) => {
    const start = new vscode.Position(r.start.line, r.start.character);
    const end = new vscode.Position(r.end.line, r.end.character);
    return new vscode.Selection(start, end);
  });

  editor.revealRange(editor.selections[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function updateStatusBar(statusBarItem: vscode.StatusBarItem, selectionCount: number): void {
  if (selectionCount > 0) {
    statusBarItem.text = `$(selection) ${selectionCount} selection${selectionCount > 1 ? "s" : ""}`;
    statusBarItem.tooltip = "ABC selections active";
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

export function registerSelectorCommands(context: vscode.ExtensionContext, client: LanguageClient, statusBarItem: vscode.StatusBarItem): void {
  const selectorCommands: Array<[string, string]> = [
    ["abc.selectChords", "selectChords"],
    ["abc.selectNotes", "selectNotes"],
    ["abc.selectNonChordNotes", "selectNonChordNotes"],
    ["abc.selectChordNotes", "selectChordNotes"],
    ["abc.selectRests", "selectRests"],
    ["abc.selectAnnotations", "selectAnnotations"],
    ["abc.selectTune", "selectTune"],
    ["abc.selectTop", "selectTop"],
    ["abc.selectBottom", "selectBottom"],
    ["abc.selectAllButTop", "selectAllButTop"],
    ["abc.selectAllButBottom", "selectAllButBottom"],
    ["abc.selectRhythm", "selectRhythm"],
    ["abc.selectRhythmParent", "selectRhythmParent"],
    ["abc.selectMeasures", "selectMeasures"],
    ["abc.selectSystem", "selectSystem"],
  ];

  for (const [commandId, selectorName] of selectorCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "abc") return;

        const uri = editor.document.uri.toString();
        const ranges = getSelectionRanges(editor);

        try {
          const result = await client.sendRequest<ApplySelectorResult>("abc.applySelector", {
            uri,
            selector: selectorName,
            ranges,
          });

          if (result.ranges.length > 0) {
            applySelectionsToEditor(editor, result.ranges);
            updateStatusBar(statusBarItem, result.ranges.length);
          } else if (ranges) {
            // Silent no-op: selection provided but no matches found
            // Leave the original selection intact
          } else {
            statusBarItem.hide();
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Selector command failed: ${error}`);
        }
      })
    );
  }

  // selectNthFromTop requires a numeric argument from user input
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.selectNthFromTop", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "abc") return;

      const input = await vscode.window.showInputBox({
        prompt: "Enter n (0 = top, 1 = second from top, ...)",
        validateInput: (v) => (isNaN(Number(v)) ? "Must be a number" : null),
      });
      if (input === undefined) return;

      const uri = editor.document.uri.toString();
      const ranges = getSelectionRanges(editor);

      try {
        const result = await client.sendRequest<ApplySelectorResult>("abc.applySelector", {
          uri,
          selector: "selectNthFromTop",
          args: [Number(input)],
          ranges,
        });

        if (result.ranges.length > 0) {
          applySelectionsToEditor(editor, result.ranges);
          updateStatusBar(statusBarItem, result.ranges.length);
        } else if (ranges) {
          // Silent no-op: selection provided but no matches found
        } else {
          statusBarItem.hide();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Selector command failed: ${error}`);
      }
    })
  );

  // selectVoices requires voice ID(s) from user input
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.selectVoices", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "abc") return;

      const input = await vscode.window.showInputBox({
        prompt: "Enter voice ID(s) separated by space or comma (e.g., '1 2' or '1,2')",
      });
      if (input === undefined) return;

      const uri = editor.document.uri.toString();
      const ranges = getSelectionRanges(editor);

      try {
        const result = await client.sendRequest<ApplySelectorResult>("abc.applySelector", {
          uri,
          selector: "selectVoices",
          args: [input],
          ranges,
        });

        if (result.ranges.length > 0) {
          applySelectionsToEditor(editor, result.ranges);
          updateStatusBar(statusBarItem, result.ranges.length);
        } else if (ranges) {
          // Silent no-op: selection provided but no matches found
        } else {
          statusBarItem.hide();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Selector command failed: ${error}`);
      }
    })
  );

  // resetSelection clears selections and hides the status bar
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.resetSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "abc") return;

      // Collapse all selections to their start positions (cursors only)
      editor.selections = editor.selections.map((s) => new vscode.Selection(s.start, s.start));
      statusBarItem.hide();
    })
  );

  // consolidateSelections merges overlapping/contiguous selections
  context.subscriptions.push(
    vscode.commands.registerCommand("abc.consolidateSelections", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "abc") return;

      const ranges = editor.selections.map((s) => ({
        start: { line: s.start.line, character: s.start.character },
        end: { line: s.end.line, character: s.end.character },
      }));

      if (ranges.length <= 1) return;

      try {
        const result = await client.sendRequest<ApplySelectorResult>("abc.consolidateSelections", { ranges });

        if (result.ranges.length > 0) {
          applySelectionsToEditor(editor, result.ranges);
          updateStatusBar(statusBarItem, result.ranges.length);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Consolidate selections failed: ${error}`);
      }
    })
  );
}
