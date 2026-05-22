/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { fromAst, createSelection, Selection, CSNode, TAGS, selectRange } from "abcls-editor";
import { File_structure, Scanner, parse, ABCContext, SemanticAnalyzer } from "abcls-parser";
import { ChordPositionCollector } from "abcls-parser/interpreter/ChordPositionCollector";
import {
  CompletionItem,
  CompletionItemKind,
  FoldingRange,
  FoldingRangeParams,
  Hover,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  Range,
  ResponseError,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { AbcDocument } from "./AbcDocument";
import { AbcLspServer } from "./AbcLspServer";
import {
  DECORATION_SYMBOLS,
  getDirectiveCompletionContext,
  getDirectiveCompletions,
  getFontDirectiveCompletions,
  getMeasurementDirectiveCompletions,
  getBooleanFlagDirectiveCompletions,
  getPositionDirectiveCompletions,
  getBooleanValueDirectiveCompletions,
  getNumberDirectiveCompletions,
  getIdentifierDirectiveCompletions,
  getTextDirectiveCompletions,
  getComplexDirectiveCompletions,
  getMidiCommandCompletions,
  getMeasurementUnitCompletions,
  getPositionChoiceCompletions,
  getBooleanChoiceCompletions,
  ABCLS_DIRECTIVES,
  ABCLS_PARSE_OPTIONS,
  ABCLS_FMT_OPTIONS,
  ABCLS_VOICES_OPTIONS,
} from "./completions";
import { GROUPED_CURSOR_TRANSFORMS, POSITION_BASED_TRANSFORMS, TRANSFORM_NODE_TAGS } from "./constants";
import { serializeCSTree } from "./csTreeSerializer";
import { collectSurvivingCursorIds, computeCursorRangesFromFreshTree } from "./cursorPreservation";
import { computeFoldingRanges, DEFAULT_FOLDING_CONFIG } from "./foldingRangeProvider";
import { PreviewManager } from "./PreviewManager";
import { findNodesInRange, resolveRanges, resolveSelectionRanges } from "./selectionRangeResolver";
import { lookupSelector } from "./selectorLookup";
import { standardTokenScopes } from "./server_helpers";
import { SocketHandler, computeSocketPath, validateImportMidiParams } from "./socketHandler";
import { computeTextEditsFromDiff } from "./textEditFromDiff";
import { lookupTransform, CONTEXT_AWARE_TRANSFORMS } from "./transformLookup";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseSocketArg(): string | null {
  const socketArg = process.argv.find((arg) => arg.startsWith("--socket="));
  if (!socketArg) {
    return null;
  }
  const value = socketArg.substring("--socket=".length);
  if (value === "auto") {
    return computeSocketPath();
  }
  return value;
}

// ============================================================================
// Selector Command Request Types
// ============================================================================

interface ApplySelectorParams {
  uri: string;
  selector: string;
  args?: number[];
  ranges?: Range[];
}

interface ApplySelectorResult {
  ranges: Range[];
}

// ============================================================================
// Consolidate Selections Request Types
// ============================================================================

interface ConsolidateSelectionsParams {
  ranges: Range[];
}

interface ConsolidateSelectionsResult {
  ranges: Range[];
}

// ============================================================================
// Wrap Dynamic Request Types
// ============================================================================

interface WrapDynamicParams {
  uri: string;
  dynamicType: "crescendo" | "decrescendo";
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface WrapDynamicResult {
  text: string;
}

// ============================================================================
// Transform Command Request Types
// ============================================================================

interface ApplyTransformParams {
  uri: string;
  transform: string;
  args: unknown[];
  selections: Range[];
}

interface ApplyTransformResult {
  textEdits: Array<{ range: Range; newText: string }>;
  cursorRanges: Range[];
}

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * Instantiate an AbcServer, which will store the documents and handle the requests.
 */
const abcServer = new AbcLspServer(documents, (type, params) => {
  switch (type) {
    case "diagnostics":
      connection.sendDiagnostics(params);
      break;
    default:
      break;
  }
});

// CS tree cache: keyed by AST reference identity. A WeakMap handles
// multi-document scenarios without cache thrashing, and automatically
// garbage-collects stale trees when the AST is replaced.
const csTreeCache = new WeakMap<File_structure, CSNode>();

// Client capabilities stored during initialization
let clientCapabilities: InitializeParams["capabilities"] | null = null;

function supportsSnippets(): boolean {
  return clientCapabilities?.textDocument?.completion?.completionItem?.snippetSupport === true;
}

function getCsTree(ast: File_structure, ctx: ABCContext): CSNode {
  let tree = csTreeCache.get(ast);
  if (!tree) {
    tree = fromAst(ast, ctx);
    csTreeCache.set(ast, tree);
  }
  return tree;
}

/**
 * Check the capabilities of the client,
 * and return the capabilities of the server.
 * This is so the client knows what to ask from the server.
 */
connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;
  clientCapabilities = capabilities;
  const hasSemanticTokensCapability = !!capabilities.textDocument?.semanticTokens?.requests?.full;
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      definitionProvider: false,
      referencesProvider: false,
      hoverProvider: false,
      completionProvider: {
        resolveProvider: true,
        // Trigger characters: "!" for decorations, "%" for directives
        triggerCharacters: ["!", "%"],
      },
    },
  };
  result.capabilities.documentHighlightProvider = false;
  result.capabilities.renameProvider = {
    prepareProvider: false,
  };
  result.capabilities.documentSymbolProvider = false;
  result.capabilities.foldingRangeProvider = true;

  if (hasSemanticTokensCapability) {
    result.capabilities.semanticTokensProvider = {
      legend: {
        tokenTypes: Object.keys(standardTokenScopes).filter((val) => Number.isNaN(parseInt(val, 10))),
        tokenModifiers: [],
      },
      range: false,
      full: true,
    };
  }

  result.capabilities.documentFormattingProvider = true;

  return result;
});

connection.onInitialized(() => {});

connection.languages.semanticTokens.on((params) => {
  return abcServer.onSemanticTokens(params.textDocument.uri);
});

connection.onDocumentFormatting((params) => abcServer.onFormat(params.textDocument.uri));

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
  const uri = params.textDocument.uri;
  const doc = abcServer.abcDocuments.get(uri);
  if (!doc || !(doc instanceof AbcDocument) || !doc.AST) {
    return [];
  }

  return computeFoldingRanges(doc.AST, doc.tokens, DEFAULT_FOLDING_CONFIG);
});

connection.onHover((_params: TextDocumentPositionParams): Hover | null => {
  return null;
});

// ============================================================================
// Selector Command Request Handlers
// ============================================================================

connection.onRequest("abc.applySelector", (params: ApplySelectorParams): ApplySelectorResult => {
  const doc = abcServer.abcDocuments.get(params.uri);
  if (!doc || !(doc instanceof AbcDocument) || !doc.AST || !doc.ctx) {
    return { ranges: [] };
  }

  const root = getCsTree(doc.AST, doc.ctx);

  const selectorFn = lookupSelector(params.selector);
  if (!selectorFn) {
    throw new ResponseError(-1, `Unknown selector: "${params.selector}"`);
  }

  let selection: Selection;
  if (params.ranges && params.ranges.length > 0) {
    // Constrain to nodes within the provided ranges
    const allCursors: Set<number>[] = [];
    for (const range of params.ranges) {
      const baseSelection = createSelection(root);
      const narrowed = selectRange(baseSelection, range.start.line, range.start.character, range.end.line, range.end.character);
      allCursors.push(...narrowed.cursors);
    }
    if (allCursors.length === 0) {
      // No nodes found within the selection ranges
      return { ranges: [] };
    }
    selection = { root, cursors: allCursors };
  } else {
    // No selections: start from root (select entire document)
    selection = createSelection(root);
  }

  const newSelection = selectorFn(selection, ...(params.args ?? []));
  const ranges = resolveRanges(params, newSelection);
  return { ranges };
});

// ============================================================================
// Consolidate Selections Request Handler
// ============================================================================

/**
 * Merge overlapping or contiguous ranges into minimal set of ranges.
 * Ranges are contiguous if one ends where another begins.
 */
connection.onRequest("abc.consolidateSelections", (params: ConsolidateSelectionsParams): ConsolidateSelectionsResult => {
  if (params.ranges.length <= 1) {
    return { ranges: params.ranges };
  }

  // Sort by start position
  const sorted = [...params.ranges].sort((a, b) => {
    if (a.start.line !== b.start.line) return a.start.line - b.start.line;
    return a.start.character - b.start.character;
  });

  const merged: Range[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    // Check if ranges overlap or are contiguous
    const prevEndsAfterCurrStarts = prev.end.line > curr.start.line || (prev.end.line === curr.start.line && prev.end.character >= curr.start.character);

    if (prevEndsAfterCurrStarts) {
      // Merge: keep earlier start, take later end
      const newEnd = curr.end.line > prev.end.line || (curr.end.line === prev.end.line && curr.end.character > prev.end.character) ? curr.end : prev.end;
      merged[merged.length - 1] = Range.create(prev.start, newEnd);
    } else {
      merged.push(curr);
    }
  }

  return { ranges: merged };
});

// ============================================================================
// Wrap Dynamic Request Handler
// ============================================================================

const DYNAMIC_MARKERS: Record<string, { start: string; end: string }> = {
  crescendo: { start: "!<(!", end: "!<)!" },
  decrescendo: { start: "!>(!", end: "!>)!" },
};

connection.onRequest("abc.wrapDynamic", (params: WrapDynamicParams): WrapDynamicResult => {
  const textDoc = documents.get(params.uri);
  if (!textDoc) {
    throw new ResponseError(-1, "Document not found");
  }

  const markers = DYNAMIC_MARKERS[params.dynamicType];
  if (!markers) {
    throw new ResponseError(-1, `Unknown dynamic type: "${params.dynamicType}"`);
  }

  const text = textDoc.getText();
  const startOffset = textDoc.offsetAt(params.selection.start);
  const endOffset = textDoc.offsetAt(params.selection.end);

  // Insert end marker first (so start offset remains valid), then start marker
  const result = text.slice(0, startOffset) + markers.start + text.slice(startOffset, endOffset) + markers.end + text.slice(endOffset);

  return { text: result };
});

function handlePositionBasedTransform(
  params: ApplyTransformParams,
  doc: AbcDocument,
  transformFn: (selection: Selection, ctx: ABCContext, ...args: unknown[]) => Selection
): ApplyTransformResult {
  if (!doc.AST || !doc.ctx) {
    return { textEdits: [], cursorRanges: [] };
  }

  if (!params.selections || params.selections.length === 0) {
    return { textEdits: [], cursorRanges: [] };
  }

  const root = fromAst(doc.AST, doc.ctx);
  const selection: Selection = { root, cursors: [] };

  // Extract positions from selection ranges
  const positions = params.selections.map((r) => ({
    line: r.start.line,
    character: r.start.character,
  }));

  // Build transform arguments
  let transformArgs: unknown[];
  if (CONTEXT_AWARE_TRANSFORMS.has(params.transform)) {
    const snapshots = doc.getSnapshots(false);
    if (!snapshots) {
      return { textEdits: [], cursorRanges: [] };
    }
    transformArgs = [snapshots, positions, ...params.args];
  } else {
    transformArgs = [positions, ...params.args];
  }

  const newSelection = transformFn(selection, doc.ctx, ...transformArgs);

  // Serialize and diff
  const newText = serializeCSTree(newSelection.root, doc.ctx);
  const oldText = doc.document.getText();
  const textEdits = computeTextEditsFromDiff(oldText, newText);

  // Position-based transforms populate cursors correctly
  const cursorRanges = resolveSelectionRanges(newSelection);

  return { textEdits, cursorRanges };
}

connection.onRequest("abc.applyTransform", (params: ApplyTransformParams): ApplyTransformResult => {
  const doc = abcServer.abcDocuments.get(params.uri);
  if (!doc || !(doc instanceof AbcDocument) || !doc.AST || !doc.ctx) {
    return { textEdits: [], cursorRanges: [] };
  }

  const transformFn = lookupTransform(params.transform);
  if (!transformFn) {
    throw new ResponseError(-1, `Unknown transform: "${params.transform}"`);
  }

  // Position-based transforms need special handling
  if (POSITION_BASED_TRANSFORMS.has(params.transform)) {
    return handlePositionBasedTransform(params, doc, transformFn);
  }

  // Build a fresh CSTree from the AST (we do not cache because transforms mutate in place)
  const root = fromAst(doc.AST, doc.ctx);

  // Convert editor selections to cursors
  if (!params.selections || params.selections.length === 0) {
    // No selections provided - nothing to transform
    return { textEdits: [], cursorRanges: [] };
  }

  // Determine which node tags this transform operates on
  const tags = TRANSFORM_NODE_TAGS[params.transform] ?? [TAGS.Note, TAGS.Chord];

  // Convert each editor selection range to a cursor containing nodes of the appropriate type.
  // For transforms that need to see sequential relationships between nodes (like legato),
  // we put all nodes in a single cursor. For other transforms, each node gets its own cursor.
  const allCursors: Set<number>[] = [];
  const needsGroupedCursor = GROUPED_CURSOR_TRANSFORMS.has(params.transform);

  if (needsGroupedCursor) {
    const groupedIds = new Set<number>();
    for (const range of params.selections) {
      const nodeIds = findNodesInRange(root, range, tags);
      for (const id of nodeIds) {
        groupedIds.add(id);
      }
    }
    if (groupedIds.size > 0) {
      allCursors.push(groupedIds);
    }
  } else {
    for (const range of params.selections) {
      const nodeIds = findNodesInRange(root, range, tags);
      for (const id of nodeIds) {
        allCursors.push(new Set([id]));
      }
    }
  }

  if (allCursors.length === 0) {
    // No nodes found within the selection ranges
    return { textEdits: [], cursorRanges: [] };
  }

  const selection: Selection = { root, cursors: allCursors };

  // Apply transform (mutates tree in place, returns updated Selection)
  let transformArgs = params.args;
  if (CONTEXT_AWARE_TRANSFORMS.has(params.transform)) {
    const needsAccidentals =
      params.transform === "harmonizeVoicing" ||
      params.transform === "transpose" ||
      params.transform === "parallelVoicing" ||
      params.transform === "enharmonizeToKey";
    const snapshots = doc.getSnapshots(needsAccidentals);
    if (!snapshots) {
      return { textEdits: [], cursorRanges: [] };
    }
    transformArgs = [snapshots, ...transformArgs];

    // Append chord positions for harmonizeVoicing (for voice leading)
    if (params.transform === "harmonizeVoicing") {
      const chordPositions = doc.getChordPositions();
      transformArgs = [...transformArgs, chordPositions];
    }

    // Append chord positions for parallelVoicing (needs AST chord for diatonic mode)
    if (params.transform === "parallelVoicing") {
      if (!doc.AST) {
        return { textEdits: [], cursorRanges: [] };
      }
      const analyzer = new SemanticAnalyzer(doc.ctx);
      doc.AST.accept(analyzer);
      const collector = new ChordPositionCollector(analyzer.data, {
        minVoices: 1,
        includeAstChord: true,
      });
      const chordPositions = collector.collect(doc.AST);
      transformArgs = [...transformArgs, chordPositions];
    }
  }
  const newSelection = transformFn(selection, doc.ctx, ...transformArgs);

  // Collect surviving cursor node IDs from the modified tree
  const survivingCursorIds = collectSurvivingCursorIds(newSelection);

  // Serialize modified tree to text
  const newText = serializeCSTree(newSelection.root, doc.ctx);
  const oldText = doc.document.getText();

  // Compute minimal TextEdits using LCS-based diff
  const textEdits = computeTextEditsFromDiff(oldText, newText);

  // Re-parse new text to get accurate token positions for cursor highlighting
  const freshCtx = new ABCContext();
  const freshTokens = Scanner(newText, freshCtx);
  const freshAST = parse(freshTokens, freshCtx);
  const freshRoot = fromAst(freshAST, freshCtx);

  // Map surviving cursor IDs to their positions in the fresh tree
  const cursorRanges = computeCursorRangesFromFreshTree(survivingCursorIds, newSelection.root, freshRoot);

  return { textEdits, cursorRanges };
});

connection.onCompletion((textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
  const uri = textDocumentPosition.textDocument.uri;
  const doc = abcServer.abcDocuments.get(uri);
  if (!doc) {
    return [];
  }

  const position = textDocumentPosition.position;
  const lineText = doc.document.getText().split("\n")[position.line] || "";
  const charPosition = position.character;

  // Check for directive completion (takes precedence)
  const directiveContext = getDirectiveCompletionContext(lineText, charPosition);

  switch (directiveContext.type) {
    case "directive-name":
      return [
        ...getDirectiveCompletions(ABCLS_DIRECTIVES, directiveContext.prefix, CompletionItemKind.Keyword),
        ...getFontDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getMeasurementDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getBooleanFlagDirectiveCompletions(directiveContext.prefix),
        ...getPositionDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getBooleanValueDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getNumberDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getIdentifierDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getTextDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
        ...getComplexDirectiveCompletions(directiveContext.prefix, supportsSnippets()),
      ];
    case "abcls-parse-options":
      return getDirectiveCompletions(ABCLS_PARSE_OPTIONS, directiveContext.prefix, CompletionItemKind.Value);
    case "abcls-fmt-options":
      return getDirectiveCompletions(ABCLS_FMT_OPTIONS, directiveContext.prefix, CompletionItemKind.Value);
    case "abcls-voices-options":
      return getDirectiveCompletions(ABCLS_VOICES_OPTIONS, directiveContext.prefix, CompletionItemKind.Value);
    case "midi-command":
      return getMidiCommandCompletions(directiveContext.prefix, supportsSnippets());
    case "measurement-unit":
      return getMeasurementUnitCompletions(directiveContext.prefix);
    case "position-choice":
      return getPositionChoiceCompletions(directiveContext.prefix);
    case "boolean-choice":
      return getBooleanChoiceCompletions(directiveContext.prefix);
    case "none":
      // Fall through to decoration completion
      break;
  }

  // Decoration completion logic
  // Check if the character just typed (at charPosition - 1) is "!"
  // We check charPosition - 1 because the cursor is positioned after the trigger character
  if (charPosition > 0 && lineText.charAt(charPosition - 1) === "!") {
    // TODO check that the char is in the body.
    return DECORATION_SYMBOLS.map((symbol, index) => {
      return <CompletionItem>{
        data: index + 1,
        documentation: symbol.documentation,
        kind: CompletionItemKind.Text,
        insertText: symbol.label.replace(/[!]/g, ""),
        label: symbol.label,
        labelDetails: "decoration",
      };
    });
  }

  return [];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

connection.onRequest("abc.getPreviewContent", (params: { uri: string }): { content: string } => {
  const content = abcServer.getPreviewContent(params.uri);
  return { content };
});

connection.onRequest("abc.exportMidi", (params: { uri: string; tuneNumbers?: number[] }): { midi: string } => {
  const midi = abcServer.exportMidi(params.uri, params.tuneNumbers);
  return { midi };
});

connection.onRequest("abc.importMidi", (params: Record<string, unknown>): { abc: string } => {
  const { midi, ...options } = validateImportMidiParams(params as unknown as Parameters<typeof validateImportMidiParams>[0]);
  const abc = abcServer.importMidi(midi, options);
  return { abc };
});

documents.listen(connection);
connection.listen();

// ============================================================================
// Socket Initialization
// ============================================================================

const socketPath = parseSocketArg();
let socketHandler: SocketHandler | null = null;

// Create PreviewManager and wire it to abcServer
const previewManager = new PreviewManager((uri) => abcServer.getPreviewContent(uri));
abcServer.previewManager = previewManager;

if (socketPath) {
  socketHandler = new SocketHandler(socketPath, (uri) => abcServer.abcDocuments.get(uri), getCsTree);
  socketHandler.setPreviewManager(previewManager);
  socketHandler.setExportMidi((uri, tuneNumbers) => abcServer.exportMidi(uri, tuneNumbers));
  socketHandler.setImportMidi((midiBase64, options) => abcServer.importMidi(midiBase64, options));

  socketHandler
    .start()
    .then((isOwner) => {
      if (isOwner) {
        console.error(`[abc-lsp] Socket handler started as owner at ${socketPath}`);
      } else {
        console.error(`[abc-lsp] Another server owns the socket, skipping socket creation`);
      }
    })
    .catch((err) => {
      console.error(`[abc-lsp] Failed to start socket handler: ${err.message}`);
    });
}

// Cleanup on exit
process.on("exit", () => {
  previewManager.shutdown();
  if (socketHandler) {
    socketHandler.stop();
  }
});

process.on("SIGINT", () => {
  previewManager.shutdown();
  if (socketHandler) {
    socketHandler.stop();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  previewManager.shutdown();
  if (socketHandler) {
    socketHandler.stop();
  }
  process.exit(0);
});
