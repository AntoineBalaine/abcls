import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as readline from "readline";
import { fromAst, createSelection, Selection, selectRange, CSNode, TAGS } from "abcls-editor";
import { File_structure, ABCContext, Scanner, parse, SemanticAnalyzer } from "abcls-parser";
import { ChordPositionCollector } from "abcls-parser/interpreter/ChordPositionCollector";
import { AbcDocument } from "./AbcDocument";
import { AbcxDocument } from "./AbcxDocument";
import { ERROR_CODES, GROUPED_CURSOR_TRANSFORMS, TRANSFORM_NODE_TAGS, POSITION_BASED_TRANSFORMS } from "./constants";
import { serializeCSTree } from "./csTreeSerializer";
import { collectSurvivingCursorIds, computeCursorRangesFromFreshTree } from "./cursorPreservation";
import { PreviewManager } from "./PreviewManager";
import { findNodesInRange, resolveRanges, resolveSelectionRanges } from "./selectionRangeResolver";
import { lookupSelector, getAvailableSelectors } from "./selectorLookup";
import { computeTextEditsFromDiff } from "./textEditFromDiff";
import { lookupTransform, CONTEXT_AWARE_TRANSFORMS } from "./transformLookup";

// ============================================================================
// Types
// ============================================================================

interface LSPPosition {
  line: number;
  character: number;
}

interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

class SocketError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface SocketRequest {
  id: number | string;
  method: string;
  params?: {
    uri?: string;
    selector?: string;
    transform?: string;
    args?: unknown[];
    /** Editor selections as ranges - used to scope the selector/transform operation */
    ranges?: LSPRange[];
  };
}

interface SelectorResult {
  ranges: LSPRange[];
}

interface TransformResult {
  edits: Array<{ range: LSPRange; newText: string }>;
  cursorRanges: LSPRange[];
}

interface StartPreviewResult {
  port: number;
  slug: string;
  url: string;
}

interface SuccessResult {
  success: boolean;
}

interface ExportMidiResult {
  midi: string;
}

interface ImportMidiResult {
  abc: string;
}

type SocketResult = SelectorResult | TransformResult | StartPreviewResult | SuccessResult | ExportMidiResult | ImportMidiResult;

interface SocketResponse {
  id: number | string;
  result?: SocketResult;
  error?: {
    code: number;
    message: string;
  };
}

type DocumentGetter = (uri: string) => AbcDocument | AbcxDocument | undefined;
type CsTreeGetter = (ast: File_structure, ctx: ABCContext) => CSNode;
type ExportMidiFn = (uri: string, tuneNumbers?: number[]) => string;
type ImportMidiFn = (midiBase64: string, options?: { title?: string; composer?: string }) => string;

// ============================================================================
// Socket Path Computation
// ============================================================================

/**
 * Computes the socket path using the same logic as the Kakoune plugin.
 * Priority order:
 *   1. $XDG_RUNTIME_DIR/abc-lsp.sock
 *   2. /tmp/abc-lsp-$USER/lsp.sock (fallback)
 */
export function computeSocketPath(): string {
  const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntimeDir) {
    return path.join(xdgRuntimeDir, "abc-lsp.sock");
  }
  const user = process.env.USER || process.env.USERNAME || "unknown";
  return path.join("/tmp", `abc-lsp-${user}`, "lsp.sock");
}

/**
 * Ensures the parent directory for the socket exists with proper permissions.
 */
function ensureSocketDirectory(socketPath: string): void {
  const dir = path.dirname(socketPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Checks if a socket is stale by attempting to connect.
 * Returns true if the socket is stale (no server listening).
 */
function isSocketStale(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      // Connection succeeded, another server is running
      client.destroy();
      resolve(false);
    });
    client.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        resolve(true);
      } else {
        // Some other error, treat as stale
        resolve(true);
      }
    });
    // Timeout after 1 second
    client.setTimeout(1000, () => {
      client.destroy();
      resolve(true);
    });
  });
}

/**
 * Safely unlinks a stale socket file after verifying ownership.
 */
function safeUnlink(socketPath: string): void {
  try {
    const stats = fs.statSync(socketPath);
    if (stats.uid === process.getuid?.()) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // File doesn't exist or can't stat, ignore
  }
}

// ============================================================================
// Input Validation
// ============================================================================

const VALID_URI_REGEX = /^file:\/\/[^?#]*$/;

function validateUri(uri: unknown): uri is string {
  if (typeof uri !== "string") return false;
  if (!VALID_URI_REGEX.test(uri)) return false;
  // Reject path traversal
  if (uri.includes("..")) return false;
  return true;
}

function validateRequest(request: unknown): SocketRequest {
  if (typeof request !== "object" || request === null) {
    throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Request must be an object");
  }

  const req = request as Record<string, unknown>;

  if (req.id === undefined || req.id === null) {
    throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Request must have an id");
  }

  if (typeof req.method !== "string") {
    throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Request must have a method string");
  }

  return {
    id: req.id as number | string,
    method: req.method,
    params: req.params as SocketRequest["params"],
  };
}

function validateApplySelectorParams(params: SocketRequest["params"]): {
  uri: string;
  selector: string;
  args: (number | string)[];
  ranges: LSPRange[];
} {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  if (!validateUri(params.uri)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Invalid or missing URI");
  }

  if (typeof params.selector !== "string") {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing selector name");
  }

  const availableSelectors = getAvailableSelectors();
  if (!availableSelectors.includes(params.selector)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, `Unknown selector: "${params.selector}". Available: ${availableSelectors.join(", ")}`);
  }

  if (params.args !== undefined) {
    if (!Array.isArray(params.args)) {
      throw new SocketError(ERROR_CODES.INVALID_PARAMS, "args must be an array");
    }
    if (!params.args.every((arg) => typeof arg === "number" || typeof arg === "string")) {
      throw new SocketError(ERROR_CODES.INVALID_PARAMS, "args must be an array of numbers or strings");
    }
  }

  if (params.ranges !== undefined && !Array.isArray(params.ranges)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "ranges must be an array");
  }

  return {
    uri: params.uri,
    selector: params.selector,
    args: params.args ?? [],
    ranges: params.ranges ?? [],
  };
}

function validateApplyTransformParams(params: SocketRequest["params"]): {
  uri: string;
  transform: string;
  args: unknown[];
  ranges: LSPRange[];
} {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  if (!validateUri(params.uri)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Invalid or missing URI");
  }

  if (typeof params.transform !== "string") {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing transform name");
  }

  const transformFn = lookupTransform(params.transform);
  if (!transformFn) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, `Unknown transform: "${params.transform}"`);
  }

  if (params.args !== undefined && !Array.isArray(params.args)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "args must be an array");
  }

  if (params.ranges !== undefined && !Array.isArray(params.ranges)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "ranges must be an array");
  }

  return {
    uri: params.uri,
    transform: params.transform,
    args: params.args ?? [],
    ranges: params.ranges ?? [],
  };
}

function validatePreviewUriParams(params: SocketRequest["params"]): { uri: string } {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  if (!validateUri(params.uri)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Invalid or missing URI");
  }

  return { uri: params.uri };
}

function validatePreviewCursorParams(params: SocketRequest["params"]): { uri: string; positions: number[] } {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  if (!validateUri(params.uri)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Invalid or missing URI");
  }

  const rawParams = params as { uri?: string; positions?: unknown };
  if (!Array.isArray(rawParams.positions)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "positions must be an array");
  }

  if (!rawParams.positions.every((p) => typeof p === "number")) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "positions must be an array of numbers");
  }

  return { uri: params.uri!, positions: rawParams.positions as number[] };
}

function validateExportMidiParams(params: SocketRequest["params"]): { uri: string; tuneNumbers?: number[] } {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  const rawParams = params as { uri?: string; tuneNumbers?: number[] };
  if (!validateUri(rawParams.uri)) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Invalid or missing URI");
  }

  if (rawParams.tuneNumbers !== undefined) {
    if (!Array.isArray(rawParams.tuneNumbers) || !rawParams.tuneNumbers.every((n) => typeof n === "number")) {
      throw new SocketError(ERROR_CODES.INVALID_PARAMS, "tuneNumbers must be an array of numbers");
    }
  }

  return { uri: rawParams.uri!, tuneNumbers: rawParams.tuneNumbers };
}

export function validateImportMidiParams(params: SocketRequest["params"]): {
  midi: string;
  title?: string;
  composer?: string;
} {
  if (!params) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing params");
  }

  const rawParams = params as { midi?: string; title?: string; composer?: string };

  if (typeof rawParams.midi !== "string" || rawParams.midi.length === 0) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "Missing required 'midi' parameter");
  }

  if (rawParams.title !== undefined && typeof rawParams.title !== "string") {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "'title' must be a string");
  }

  if (rawParams.composer !== undefined && typeof rawParams.composer !== "string") {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, "'composer' must be a string");
  }

  return {
    midi: rawParams.midi,
    title: rawParams.title,
    composer: rawParams.composer,
  };
}

// ============================================================================
// Request Handler
// ============================================================================

function handleApplySelector(
  params: {
    uri: string;
    selector: string;
    args: (number | string)[];
    ranges: LSPRange[];
  },
  getDocument: DocumentGetter,
  getCsTree: CsTreeGetter
): SelectorResult {
  const doc = getDocument(params.uri);

  if (!doc) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not yet opened");
  }

  if (doc instanceof AbcxDocument) {
    throw new SocketError(ERROR_CODES.FILE_TYPE_NOT_SUPPORTED, "Selectors are not supported for ABCx files");
  }

  if (!(doc instanceof AbcDocument) || !doc.AST) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document has no parsed AST");
  }

  const root = getCsTree(doc.AST, doc.ctx);
  const selectorFn = lookupSelector(params.selector);

  if (!selectorFn) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, `Unknown selector: "${params.selector}"`);
  }

  // Stateless approach: use provided ranges to create initial selection
  let selection: Selection;
  if (params.ranges.length > 0) {
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

  const newSelection = selectorFn(selection, ...params.args);

  const resultRanges = resolveRanges(params, newSelection);

  return { ranges: resultRanges };
}

function handleApplyTransform(
  params: {
    uri: string;
    transform: string;
    args: unknown[];
    ranges: LSPRange[];
  },
  getDocument: DocumentGetter
): TransformResult {
  const doc = getDocument(params.uri);

  if (!doc) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not yet opened");
  }

  if (doc instanceof AbcxDocument) {
    throw new SocketError(ERROR_CODES.FILE_TYPE_NOT_SUPPORTED, "Transforms are not supported for ABCx files");
  }

  if (!(doc instanceof AbcDocument) || !doc.AST) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document has no parsed AST");
  }

  const transformFn = lookupTransform(params.transform);
  if (!transformFn) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, `Unknown transform: "${params.transform}"`);
  }

  // Build a fresh CSTree from the AST (transforms mutate in place)
  const root = fromAst(doc.AST, doc.ctx);

  // Determine which node tags this transform operates on
  const tags = TRANSFORM_NODE_TAGS[params.transform] ?? [TAGS.Note, TAGS.Chord];

  // Convert each editor selection range to a cursor containing nodes of the appropriate type.
  // For transforms that need to see sequential relationships between nodes (like legato),
  // we put all nodes in a single cursor. For other transforms, each node gets its own cursor.
  const allCursors: Set<number>[] = [];
  const needsGroupedCursor = GROUPED_CURSOR_TRANSFORMS.has(params.transform);

  if (needsGroupedCursor) {
    const groupedIds = new Set<number>();
    for (const range of params.ranges) {
      const nodeIds = findNodesInRange(root, range, tags);
      for (const id of nodeIds) {
        groupedIds.add(id);
      }
    }
    if (groupedIds.size > 0) {
      allCursors.push(groupedIds);
    }
  } else {
    for (const range of params.ranges) {
      const nodeIds = findNodesInRange(root, range, tags);
      for (const id of nodeIds) {
        allCursors.push(new Set([id]));
      }
    }
  }

  if (allCursors.length === 0) {
    // No nodes found within the selection ranges
    return { edits: [], cursorRanges: [] };
  }

  const selection: Selection = { root, cursors: allCursors };

  // Apply transform (mutates tree in place, returns updated Selection)
  // For context-aware transforms, we get DocumentSnapshots from the document and prepend to args
  let transformArgs = params.args ?? [];
  if (CONTEXT_AWARE_TRANSFORMS.has(params.transform)) {
    const needsAccidentals =
      params.transform === "harmonizeVoicing" ||
      params.transform === "transpose" ||
      params.transform === "dropVoicing" ||
      params.transform === "parallelVoicing" ||
      params.transform === "enharmonizeToKey";
    const snapshots = doc.getSnapshots(needsAccidentals);
    if (!snapshots) {
      return { edits: [], cursorRanges: [] };
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
        return { edits: [], cursorRanges: [] };
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

  // Convert TextEdit[] to the simpler format for socket response
  const edits = textEdits.map((edit) => ({
    range: edit.range,
    newText: edit.newText,
  }));

  // Re-parse new text to get accurate token positions for cursor ranges
  const freshCtx = new ABCContext();
  const freshTokens = Scanner(newText, freshCtx);
  const freshAST = parse(freshTokens, freshCtx);
  const freshRoot = fromAst(freshAST, freshCtx);

  // Map surviving cursor IDs to their positions in the fresh tree
  const cursorRanges = computeCursorRangesFromFreshTree(survivingCursorIds, newSelection.root, freshRoot);

  return { edits, cursorRanges };
}

/**
 * Handles position-based transforms that operate on cursor positions rather than selected nodes.
 * These transforms (like splitSystems) take raw cursor positions as input.
 *
 * Position-based transforms MUST populate selection.cursors with the node IDs of result nodes.
 * The cursor nodes will have valid token positions from the original source, allowing direct
 * range computation via resolveSelectionRanges() without ordinal mapping.
 */
function handlePositionBasedTransform(
  params: {
    uri: string;
    transform: string;
    args: unknown[];
    ranges: LSPRange[];
  },
  getDocument: DocumentGetter
): TransformResult {
  const doc = getDocument(params.uri);

  if (!doc) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not yet opened");
  }

  if (doc instanceof AbcxDocument) {
    throw new SocketError(ERROR_CODES.FILE_TYPE_NOT_SUPPORTED, "Transforms are not supported for ABCx files");
  }

  if (!(doc instanceof AbcDocument) || !doc.AST) {
    throw new SocketError(ERROR_CODES.DOCUMENT_NOT_FOUND, "Document has no parsed AST");
  }

  // Position-based transforms require at least one range to determine the position
  if (params.ranges.length === 0) {
    return { edits: [], cursorRanges: [] };
  }

  // Build a fresh CSTree from the AST (transforms mutate in place)
  const root = fromAst(doc.AST, doc.ctx);

  // Create a selection from the root (no specific nodes selected for position-based transforms)
  const selection: Selection = createSelection(root);

  // Extract all cursor positions from ranges
  const positions = params.ranges.map((r) => ({
    line: r.start.line,
    character: r.start.character,
  }));

  const transformFn = lookupTransform(params.transform);
  if (!transformFn) {
    throw new SocketError(ERROR_CODES.INVALID_PARAMS, `Unknown transform: "${params.transform}"`);
  }

  // Build transform arguments: [snapshots, positions, ...additionalArgs]
  // Position-based transforms that are context-aware need snapshots
  let transformArgs: unknown[] = [];
  if (CONTEXT_AWARE_TRANSFORMS.has(params.transform)) {
    const snapshots = doc.getSnapshots(false);
    if (!snapshots) {
      return { edits: [], cursorRanges: [] };
    }
    transformArgs = [snapshots, positions, ...(params.args ?? [])];
  } else {
    transformArgs = [positions, ...(params.args ?? [])];
  }

  const newSelection = transformFn(selection, doc.ctx, ...transformArgs);

  // Serialize modified tree to text
  const newText = serializeCSTree(newSelection.root, doc.ctx);
  const oldText = doc.document.getText();

  // Compute minimal TextEdits using LCS-based diff
  const textEdits = computeTextEditsFromDiff(oldText, newText);

  // Convert TextEdit[] to the simpler format for socket response
  const edits = textEdits.map((edit) => ({
    range: edit.range,
    newText: edit.newText,
  }));

  // Position-based transforms populate selection.cursors with result node IDs
  // Use resolveSelectionRanges for direct range computation
  const cursorRanges = resolveSelectionRanges(newSelection);

  return { edits, cursorRanges };
}

// ============================================================================
// Socket Handler Class
// ============================================================================

export class SocketHandler {
  server: net.Server | null = null;
  socketPath: string;
  getDocument: DocumentGetter;
  getCsTree: CsTreeGetter;
  isOwner = false;
  previewManager: PreviewManager | null = null;
  exportMidiFn: ExportMidiFn | null = null;
  importMidiFn: ImportMidiFn | null = null;

  constructor(socketPath: string, getDocument: DocumentGetter, getCsTree: CsTreeGetter) {
    this.socketPath = socketPath;
    this.getDocument = getDocument;
    this.getCsTree = getCsTree;
  }

  setPreviewManager(previewManager: PreviewManager): void {
    this.previewManager = previewManager;
  }

  setExportMidi(fn: ExportMidiFn): void {
    this.exportMidiFn = fn;
  }

  setImportMidi(fn: ImportMidiFn): void {
    this.importMidiFn = fn;
  }

  /**
   * Attempts to start the socket server using "first server wins" pattern.
   * Returns true if this server owns the socket, false if another server already has it.
   */
  async start(): Promise<boolean> {
    // Check if socket file exists
    if (fs.existsSync(this.socketPath)) {
      const stale = await isSocketStale(this.socketPath);
      if (!stale) {
        // Another server is running, skip socket creation
        console.error(`[abc-lsp] Socket ${this.socketPath} already in use by another server`);
        return false;
      }
      // Socket is stale, unlink it
      safeUnlink(this.socketPath);
    }

    ensureSocketDirectory(this.socketPath);

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(`[abc-lsp] Socket ${this.socketPath} already in use`);
          resolve(false);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        this.isOwner = true;
        resolve(true);
      });
    });
  }

  handleConnection(socket: net.Socket): void {
    const rl = readline.createInterface({
      input: socket,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      this.processLine(socket, line);
    });

    socket.on("error", (err) => {
      console.error("[abc-lsp] Socket client error:", err.message);
    });
  }

  // Process a single line from the socket, handling async methods
  async processLine(socket: net.Socket, line: string): Promise<void> {
    let request: SocketRequest;
    let response: SocketResponse;

    try {
      const parsed = JSON.parse(line);
      request = validateRequest(parsed);
    } catch (err) {
      if (err instanceof SyntaxError) {
        response = {
          id: 0,
          error: { code: ERROR_CODES.INVALID_REQUEST, message: "Invalid JSON" },
        };
      } else if (typeof err === "object" && err !== null && "code" in err) {
        response = {
          id: 0,
          error: err as { code: number; message: string },
        };
      } else {
        response = {
          id: 0,
          error: { code: ERROR_CODES.INVALID_REQUEST, message: String(err) },
        };
      }
      socket.write(JSON.stringify(response) + "\n");
      return;
    }

    try {
      let result: SocketResult;

      if (request.method === "abc.applySelector") {
        const validatedParams = validateApplySelectorParams(request.params);
        result = handleApplySelector(validatedParams, this.getDocument, this.getCsTree);
      } else if (request.method === "abc.applyTransform") {
        const validatedParams = validateApplyTransformParams(request.params);
        // Position-based transforms (like splitSystem) receive cursor positions directly
        // rather than selecting nodes within ranges
        if (POSITION_BASED_TRANSFORMS.has(validatedParams.transform)) {
          result = handlePositionBasedTransform(validatedParams, this.getDocument);
        } else {
          result = handleApplyTransform(validatedParams, this.getDocument);
        }
      } else if (request.method === "abc.startPreview") {
        if (!this.previewManager) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Preview manager not initialized");
        }
        const validatedParams = validatePreviewUriParams(request.params);
        result = await this.previewManager.startPreview(validatedParams.uri);
      } else if (request.method === "abc.stopPreview") {
        if (!this.previewManager) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Preview manager not initialized");
        }
        const validatedParams = validatePreviewUriParams(request.params);
        this.previewManager.stopPreview(validatedParams.uri);
        result = { success: true };
      } else if (request.method === "abc.previewCursor") {
        if (!this.previewManager) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Preview manager not initialized");
        }
        const validatedParams = validatePreviewCursorParams(request.params);
        this.previewManager.pushCursorUpdate(validatedParams.uri, validatedParams.positions);
        result = { success: true };
      } else if (request.method === "abc.shutdownPreview") {
        if (!this.previewManager) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "Preview manager not initialized");
        }
        this.previewManager.shutdown();
        result = { success: true };
      } else if (request.method === "abc.exportMidi") {
        if (!this.exportMidiFn) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "MIDI export not initialized");
        }
        const validatedParams = validateExportMidiParams(request.params);
        const midi = this.exportMidiFn(validatedParams.uri, validatedParams.tuneNumbers);
        result = { midi };
      } else if (request.method === "abc.importMidi") {
        if (!this.importMidiFn) {
          throw new SocketError(ERROR_CODES.INVALID_REQUEST, "MIDI import not initialized");
        }
        const { midi, ...options } = validateImportMidiParams(request.params);
        const abc = this.importMidiFn(midi, options);
        result = { abc };
      } else {
        throw new SocketError(ERROR_CODES.UNKNOWN_METHOD, `Unknown method: "${request.method}"`);
      }

      response = { id: request.id, result };
    } catch (err) {
      if (err instanceof SocketError) {
        response = {
          id: request.id,
          error: { code: err.code, message: err.message },
        };
      } else {
        response = {
          id: request.id,
          error: { code: ERROR_CODES.INVALID_REQUEST, message: String(err) },
        };
      }
    }

    socket.write(JSON.stringify(response) + "\n");
  }

  /**
   * Stops the socket server and cleans up the socket file.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.isOwner && fs.existsSync(this.socketPath)) {
      safeUnlink(this.socketPath);
    }
  }

  get isSocketOwner(): boolean {
    return this.isOwner;
  }
}
