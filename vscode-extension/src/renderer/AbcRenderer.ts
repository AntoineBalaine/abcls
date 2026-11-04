/**
 * ABC Renderer - handles preview panel and ABCx conversion
 * Based on abcjs-vscode by Alen Siljak (GPL-3.0)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { ABCContext, AbcErrorReporter, filterVoicesInAbcWithDeletions } from "abcls-parser";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { createPreviewSyncState, documentRangeForPreviewClick, FilteredPreview, PreviewSyncState, previewRangesForSelections } from "./cursorSync";

let panel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;
let svgHandler: ((svg: string) => void) | undefined;
let _context: vscode.ExtensionContext;
let _client: LanguageClient | undefined;
// What the preview shows, so that an editor selection is only mirrored when
// its offsets point at the same notes in the rendered score.
let previewSyncState: PreviewSyncState | undefined;

/**
 * Set the LSP client for preview content requests
 */
export function setLspClient(client: LanguageClient | undefined) {
  _client = client;
}
/**
 * Get preview content for any ABC-family file via LSP request.
 * The server handles all conversions (linear to deferred, ABCx to ABC, etc.)
 */
async function getPreviewContent(uri: string): Promise<string> {
  if (!_client) {
    outputChannel.appendLine("Preview content: No LSP client available");
    return "";
  }

  try {
    const result = await _client.sendRequest<{
      content: string;
    }>("abc.getPreviewContent", { uri });
    return result.content ?? "";
  } catch (error) {
    outputChannel.appendLine(`Preview content error: ${error}`);
    return "";
  }
}

export function initRenderer(context: vscode.ExtensionContext) {
  _context = context;
  outputChannel = vscode.window.createOutputChannel("abc-renderer");
  outputChannel.appendLine("ABC Renderer initialized");
}

export function getOutputChannel(): vscode.OutputChannel {
  return outputChannel;
}

/**
 * Show the preview panel
 * @param context Extension context
 * @param theme Optional theme override ("light" or "dark")
 * @param viewColumn Optional view column for panel placement (default: Beside)
 */
export async function showPreview(context: vscode.ExtensionContext, theme?: "light" | "dark", viewColumn?: vscode.ViewColumn) {
  initializePanel(context, viewColumn);

  if (panel) {
    panel.webview.html = await getHtml(context, getFileNameFromEditor());
    // Send initial configuration after panel loads
    const options = readConfiguration();
    await panel.webview.postMessage({
      command: "configurationChange",
      content: options,
    });
    // Set theme if specified
    if (theme) {
      await panel.webview.postMessage({
        command: "setTheme",
        theme: theme,
      });
    }
    await postCursorPosition(getEditor());
  }
}

/**
 * Request HTML export - requires preview panel to be open
 */
export async function requestHtmlExport() {
  if (!panel) {
    vscode.window.showWarningMessage("The HTML Export requires the preview panel to be open, to render content.");
    return;
  }

  svgHandler = exportHtml;
  await panel.webview.postMessage({ command: "requestSvg" });
}

/**
 * Request SVG export - requires preview panel to be open
 */
export async function requestSvgExport() {
  if (!panel) {
    vscode.window.showWarningMessage("The SVG Export requires the preview panel to be open, to render content.");
    return;
  }

  svgHandler = exportSvg;
  await panel.webview.postMessage({ command: "requestSvg" });
}

/**
 * Print preview - opens in browser for printing
 */
export async function printPreview(context: vscode.ExtensionContext) {
  const filePath = path.join(context.extensionPath, "abcjs-renderer", "resources", "print.html");
  let html = await loadFileContent(filePath);

  const editorContent = await getCurrentEditorContent();
  html = html.replace("{{body}}", editorContent);

  const savePath = getHtmlFilenameForExport();
  const url = pathToFileURL(savePath).toString();
  const uri = vscode.Uri.parse(url);
  const content = Uint8Array.from(html.split("").map((x) => x.charCodeAt(0)));
  await vscode.workspace.fs.writeFile(uri, content);

  await vscode.env.openExternal(uri);
}

/**
 * Register event handlers for the renderer
 */
export function registerRendererEvents(context: vscode.ExtensionContext) {
  // Update preview when document changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((eventArgs) => {
      updatePreview(eventArgs);
    })
  );

  // Update preview when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (eventArgs) => {
      if (eventArgs && panel && vscode.window.activeTextEditor) {
        updatePreview(eventArgs);
      }
    })
  );

  // Highlight in the preview the notes under the editor's cursor or selection
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (eventArgs) => {
      await postCursorPosition(eventArgs.textEditor);
    })
  );

  // Handle configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async () => {
      if (panel) {
        const options = readConfiguration();
        await panel.webview.postMessage({
          command: "configurationChange",
          content: options,
        });
      }
    })
  );
}

// --- Internal functions ---

function initializePanel(context: vscode.ExtensionContext, viewColumn?: vscode.ViewColumn) {
  // Reuse existing panel if available, just reveal it in the target column
  if (panel) {
    panel.reveal(viewColumn);
    return;
  }

  panel = createPanel(context, viewColumn);

  panel.webview.onDidReceiveMessage((message) => {
    switch (message.name) {
      case "click":
        void select(message.startChar, message.endChar);
        break;

      case "svgExport":
        if (svgHandler) {
          svgHandler(message.content);
        }
        break;
    }
  });

  panel.onDidDispose(() => {
    panel = undefined;
    previewSyncState = undefined;
  });
}

function createPanel(context: vscode.ExtensionContext, viewColumn?: vscode.ViewColumn): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel("abcPreview", "ABC Preview", viewColumn ?? vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "abcjs-renderer", "resources"))],
  });
}

async function getHtml(context: vscode.ExtensionContext, fileName: string): Promise<string> {
  const editorContent = await getCurrentEditorContent();
  const filePath = path.join(context.extensionPath, "abcjs-renderer", "resources", "viewer.html");
  let html = await loadFileContent(filePath);

  // Inject initial configuration
  const config = readConfiguration();
  html = html.replace("{initialConfig}", JSON.stringify(config));

  html = html.replace("{editorContent}", editorContent);
  html = html.replace("${fileName}", fileName);
  html = html.replace("${title}", fileName);

  return html;
}

async function updatePreview(eventArgs: vscode.TextEditor | vscode.TextDocumentChangeEvent) {
  const editor = getEditor();

  if (!editor || !panel) {
    return;
  }

  const language = eventArgs.document.languageId;
  if (language !== "abc" && language !== "plaintext") {
    return;
  }

  const editorContent = await getCurrentEditorContent();

  await panel.webview.postMessage({
    command: "contentChange",
    content: editorContent,
  });

  panel.title = "abc: " + getFileNameFromEditor();

  // Because the re-rendered score has lost its highlight, and the cursor
  // offsets were not valid while the new content was being computed, the
  // cursor is sent again once the content is in place.
  await postCursorPosition(editor);
}

/**
 * Sends the editor's selections to the preview, which highlights the notes they
 * cover. Because an editor can hold several cursors, every selection is sent, and not only the first one.
 * Nothing is sent when the preview's offsets do not match the document's, or when
 * no selection lies in a shown voice, so that a highlight made by clicking in the preview is kept.
 */
async function postCursorPosition(editor: vscode.TextEditor | undefined) {
  if (!panel || !editor) return;
  const document = editor.document;
  const ranges = previewRangesForSelections(
    previewSyncState,
    document.uri.toString(),
    document.version,
    editor.selections.map((selection) => ({ anchor: document.offsetAt(selection.anchor), active: document.offsetAt(selection.active) }))
  );
  if (!ranges || ranges.length === 0) return;
  await panel.webview.postMessage({ command: "cursorMove", ranges });
}

/**
 * Get editor content for preview.
 * Uses the LSP server to get properly converted content for all ABC-family files.
 */
async function getCurrentEditorContent(): Promise<string> {
  const editor = getEditor();
  if (!editor) {
    return "";
  }

  const filePath = editor.document.fileName;
  const uri = editor.document.uri.toString();

  if (filePath.endsWith(".abc") || filePath.endsWith(".abcx")) {
    // Because the document may change while the content is being computed,
    // its version and text are read before the request.
    const version = editor.document.version;
    const documentText = editor.document.getText();
    const serverContent = await getPreviewContent(uri);
    // Apply voice filter if %%abcls-voices directive is present
    const filtered = applyVoiceFilter(serverContent);
    previewSyncState = createPreviewSyncState(uri, version, documentText, serverContent, filtered ?? undefined);
    return filtered?.text ?? serverContent;
  }

  return "";
}

/**
 * Apply voice filter to ABC content based on %%abcls-voices directives.
 * Because the directive is embedded in the ABC content, we process it here
 * to filter out voices before rendering.
 *
 * Because a click in the preview must land on the same note in the editor, the result also holds the ranges
 * that the filter removed. It is null when there is nothing to filter, or when the filter failed,
 * in which case the content is shown as it is.
 */
function applyVoiceFilter(content: string): FilteredPreview | null {
  // Quick check: only process if %%abcls-voices directive is present
  if (!content.includes("%%abcls-voices")) {
    return null;
  }

  try {
    const errorReporter = new AbcErrorReporter();
    const ctx = new ABCContext(errorReporter);
    return filterVoicesInAbcWithDeletions(content, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Voice filter error: ${message}`);
    // Show the original content if the filter fails
    return null;
  }
}

function getEditor(): vscode.TextEditor | undefined {
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    editor = vscode.window.visibleTextEditors[0];
  }
  return editor;
}

function getEditorFilePath(): string {
  const editor = getEditor();
  return editor?.document.fileName ?? "";
}

function getFileNameFromEditor(): string {
  const filePath = getEditorFilePath();
  const arr = filePath.split(path.sep);
  return arr[arr.length - 1];
}

/**
 * Returns the editor of the document that the preview shows.
 * Because a click in the preview gives the focus to the preview, there is then no active text editor, and the first
 * visible editor may hold another file; the preview's own document is therefore looked up first.
 */
function getPreviewedEditor(): vscode.TextEditor | undefined {
  const uri = previewSyncState?.uri;
  const previewed = uri === undefined ? undefined : vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri);
  return previewed ?? getEditor();
}

/**
 * Selects the text of the note that was clicked in the preview, and gives the focus back to its editor,
 * so that the user can type right away without clicking into the editor first.
 */
async function select(start: number, end: number) {
  const editor = getPreviewedEditor();
  if (!editor) return;

  // Because the preview may show the document without its hidden voices, the offsets of the click are converted first.
  const range = documentRangeForPreviewClick(previewSyncState, start, end);
  const startPos = editor.document.positionAt(range.start);
  const endPos = editor.document.positionAt(range.end);
  const selection = new vscode.Selection(startPos, endPos);

  const focused = await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false, selection });
  focused.revealRange(selection);
}

function readConfiguration(): object {
  const editor = getEditor();
  const currentDocument = editor?.document;
  const configuration = vscode.workspace.getConfiguration("abc", currentDocument?.uri);

  const tablatureValue: string | undefined = configuration.get("renderer.tablature");
  const tablature = tablatureValue ? [{ instrument: tablatureValue.toLowerCase() }] : undefined;

  return {
    oneSvgPerLine: configuration.get("renderer.oneSvgPerLine"),
    responsive: configuration.get("renderer.responsive"),
    print: configuration.get("renderer.print"),
    showDebug: configuration.get("renderer.showDebug") ? ["grid", "box"] : [],
    jazzchords: configuration.get("renderer.jazzchords"),
    tablature: tablature,
    visualTranspose: configuration.get("renderer.visualTranspose"),
    showTransposedSource: configuration.get("renderer.showTransposedSource"),
  };
}

async function exportHtml(svg: string) {
  const templatePath = path.join(_context.extensionPath, "abcjs-renderer", "resources", "export.html");
  let html = await loadFileContent(templatePath);
  html = html.replace("{{body}}", svg);

  const editorFilePath = getEditorFilePath();
  const filePath = editorFilePath + ".html";
  saveToFile(filePath, html);

  vscode.window.showInformationMessage("HTML exported to", filePath);

  let url = filePath.replaceAll("\\", "/");
  url = "file:///" + url;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

function exportSvg(svg: string) {
  const editorFilePath = getEditorFilePath();
  const filePath = editorFilePath + ".svg";

  saveToFile(filePath, svg);

  vscode.window.showInformationMessage("SVG exported to", filePath);
}

function getHtmlFilenameForExport(): string {
  const editor = getEditor();

  if (editor?.document.isUntitled) {
    return getTempFilePath("abc-printPreview.html");
  }

  const filePath = editor?.document.fileName;
  if (filePath && path.isAbsolute(filePath)) {
    return filePath + ".html";
  }

  return getTempFilePath("abc-printPreview.html");
}

function getTempFilePath(filename: string): string {
  const tempDir = os.tmpdir();
  return path.join(tempDir, filename);
}

function saveToFile(filePath: string, content: string) {
  fs.writeFileSync(filePath, content);
}

async function loadFileContent(filePath: string): Promise<string> {
  const onDiskPath = vscode.Uri.file(filePath);
  const fileContent = await vscode.workspace.fs.readFile(onDiskPath);
  return fileContent.toString();
}
