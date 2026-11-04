import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { abc2midi, midi2abc } from "abcls-midi";
import { Scanner, parse, ABCContext, File_structure } from "abcls-parser";
import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fromAst, CSNode } from "../../editor/src/index";
import { AbcDocument } from "./AbcDocument";
import { AbcxDocument } from "./AbcxDocument";
import { ERROR_CODES } from "./constants";
import { SocketHandler, computeSocketPath } from "./socketHandler";

interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface SelectorResponse {
  id: number | string;
  result?: { ranges: LSPRange[] };
  error?: { code: number; message: string };
}

interface ErrorResponse {
  id: number | string;
  error: { code: number; message: string };
}

// Create a mock AbcDocument with a real instance
function createMockAbcDocument(source: string): AbcDocument {
  const textDoc = TextDocument.create("file:///test.abc", "abc", 1, source);
  const doc = new AbcDocument(textDoc);
  doc.analyze();
  return doc;
}

// Create a mock AbcxDocument with a real instance
function createMockAbcxDocument(): AbcxDocument {
  const source = "X:1\nK:C\nC D E F|\n";
  const textDoc = TextDocument.create("file:///test.abcx", "abcx", 1, source);
  const doc = new AbcxDocument(textDoc);
  doc.analyze();
  return doc;
}

describe("Socket Handler", () => {
  let socketPath: string;
  let handler: SocketHandler;
  let documents: Map<string, AbcDocument | AbcxDocument>;
  let csTreeCache: WeakMap<File_structure, CSNode>;

  function getCsTree(ast: File_structure, ctx: ABCContext): CSNode {
    let tree = csTreeCache.get(ast);
    if (!tree) {
      tree = fromAst(ast, ctx);
      csTreeCache.set(ast, tree);
    }
    return tree;
  }

  beforeEach(() => {
    // Create a unique socket path for each test
    socketPath = path.join(os.tmpdir(), `abc-lsp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
    documents = new Map();
    csTreeCache = new WeakMap();

    handler = new SocketHandler(socketPath, (uri) => documents.get(uri), getCsTree);
  });

  afterEach(() => {
    handler.stop();
    // Clean up socket file if it exists
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  });

  describe("computeSocketPath", () => {
    it("uses XDG_RUNTIME_DIR when set", () => {
      const originalXdg = process.env.XDG_RUNTIME_DIR;
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
      try {
        const result = computeSocketPath();
        expect(result).to.equal("/run/user/1000/abc-lsp.sock");
      } finally {
        if (originalXdg !== undefined) {
          process.env.XDG_RUNTIME_DIR = originalXdg;
        } else {
          delete process.env.XDG_RUNTIME_DIR;
        }
      }
    });

    it("falls back to /tmp/abc-lsp-$USER when XDG_RUNTIME_DIR is not set", () => {
      const originalXdg = process.env.XDG_RUNTIME_DIR;
      delete process.env.XDG_RUNTIME_DIR;
      try {
        const result = computeSocketPath();
        const user = process.env.USER || process.env.USERNAME || "unknown";
        expect(result).to.equal(`/tmp/abc-lsp-${user}/lsp.sock`);
      } finally {
        if (originalXdg !== undefined) {
          process.env.XDG_RUNTIME_DIR = originalXdg;
        }
      }
    });
  });

  describe("start()", () => {
    it("creates socket and returns true when path is available", async () => {
      const isOwner = await handler.start();
      expect(isOwner).to.be.true;
      expect(fs.existsSync(socketPath)).to.be.true;
    });

    it("returns false when another server owns the socket", async () => {
      // Start first handler
      const isOwner1 = await handler.start();
      expect(isOwner1).to.be.true;

      // Try to start second handler on same path
      const handler2 = new SocketHandler(socketPath, (uri) => documents.get(uri), getCsTree);

      const isOwner2 = await handler2.start();
      expect(isOwner2).to.be.false;

      handler2.stop();
    });
  });

  describe("request handling", () => {
    beforeEach(async () => {
      await handler.start();
    });

    function sendRequest<T = SelectorResponse>(request: object): Promise<T> {
      return new Promise((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          client.write(JSON.stringify(request) + "\n");
        });

        let data = "";
        client.on("data", (chunk) => {
          data += chunk.toString();
          if (data.includes("\n")) {
            client.destroy();
            try {
              resolve(JSON.parse(data.trim()) as T);
            } catch {
              reject(new Error("Invalid JSON response"));
            }
          }
        });

        client.on("error", reject);
        setTimeout(() => {
          client.destroy();
          reject(new Error("Timeout"));
        }, 5000);
      });
    }

    it("returns error for invalid JSON", async () => {
      const response = await new Promise<ErrorResponse>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          client.write("not valid json\n");
        });

        let data = "";
        client.on("data", (chunk) => {
          data += chunk.toString();
          if (data.includes("\n")) {
            client.destroy();
            resolve(JSON.parse(data.trim()));
          }
        });
        client.on("error", reject);
      });

      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_REQUEST);
    });

    it("returns error for missing method", async () => {
      const response = await sendRequest<ErrorResponse>({ id: 1 });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_REQUEST);
    });

    it("returns error for unknown method", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "unknownMethod",
        params: {},
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.UNKNOWN_METHOD);
    });

    it("returns error for missing URI", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          selector: "selectChords",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_PARAMS);
    });

    it("returns error for invalid URI format", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "http://example.com/file.abc",
          selector: "selectChords",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_PARAMS);
    });

    it("returns error for path traversal in URI", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/../etc/passwd",
          selector: "selectChords",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_PARAMS);
    });

    it("returns error for unknown selector", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "nonExistentSelector",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.INVALID_PARAMS);
    });

    it("returns error when document is not found", async () => {
      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectChords",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.DOCUMENT_NOT_FOUND);
    });

    it("returns error for ABCx files", async () => {
      documents.set("file:///path/to/file.abcx", createMockAbcxDocument());

      const response = await sendRequest<ErrorResponse>({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abcx",
          selector: "selectChords",
        },
      });
      expect(response).to.have.property("error");
      expect(response.error.code).to.equal(ERROR_CODES.FILE_TYPE_NOT_SUPPORTED);
    });

    it("returns ranges for valid selector request", async () => {
      const source = "X:1\nK:C\n[CEG]2 C2 D2|\n";
      documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

      const response = await sendRequest({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectChords",
        },
      });

      expect(response).to.have.property("result");
      expect(response.result!.ranges).to.have.length(1);
    });

    it("supports scope filtering via ranges", async () => {
      const source = "X:1\nK:C\n[CEG] [FAC]|\n";
      documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

      // First get all chords (no ranges = select entire document)
      const fullResponse = await sendRequest({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectChords",
        },
      });
      expect(fullResponse.result!.ranges).to.have.length(2);

      // Now scope to only the first chord's range
      const scopedResponse = await sendRequest({
        id: 2,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectChords",
          ranges: [{ start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }],
        },
      });
      expect(scopedResponse.result!.ranges).to.have.length(1);
    });

    it("supports narrowing with ranges from previous response", async () => {
      const source = "X:1\nK:C\n[CEG]2 C2 D2|\n";
      documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

      // First select chords
      const chordsResponse = await sendRequest({
        id: 1,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectChords",
        },
      });

      const chordRanges = chordsResponse.result!.ranges;
      expect(chordRanges).to.have.length(1);

      // Now narrow to notes within those chord ranges
      const notesResponse = await sendRequest({
        id: 2,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectNotes",
          ranges: chordRanges,
        },
      });

      // Should get 3 notes (C, E, G) from within the chord
      expect(notesResponse.result!.ranges).to.have.length(3);
    });

    it("returns id from request in response", async () => {
      const source = "X:1\nK:C\nC2|\n";
      documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

      const response = await sendRequest({
        id: 42,
        method: "abc.applySelector",
        params: {
          uri: "file:///path/to/file.abc",
          selector: "selectNotes",
        },
      });

      expect(response.id).to.equal(42);
    });

    // Tests for selectVoices using resolveContiguousRanges
    describe("selectVoices with contiguous ranges", () => {
      it("returns full voice content for inline voice marker", async () => {
        const source = "X:1\nK:C\n[V:1]CDEF|[V:2]GABC|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectVoices",
            args: ["1"],
          },
        });

        expect(response).to.have.property("result");
        expect(response.result!.ranges).to.have.length(1);
        // Range should cover [V:1]CDEF| (not just [V:1])
        const range = response.result!.ranges[0];
        expect(range.start.line).to.equal(2);
        expect(range.start.character).to.equal(0);
        // End should be after the barline following CDEF
        expect(range.end.character).to.be.greaterThan(5);
      });

      it("returns full voice content for V: info line marker", async () => {
        const source = "X:1\nK:C\nV:1\nCDEF|\nV:2\nGABC|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectVoices",
            args: ["1"],
          },
        });

        expect(response).to.have.property("result");
        expect(response.result!.ranges).to.have.length(1);
        // Range should cover from V:1 through end of CDEF|
        const range = response.result!.ranges[0];
        expect(range.start.line).to.equal(2);
        expect(range.end.line).to.equal(3);
      });

      it("returns input selection unchanged for non-existent voice ID", async () => {
        // When a voice ID doesn't exist, selectVoices returns the input selection unchanged
        // (per the design: "If no matching voice IDs exist in the tune, returns the input selection unchanged")
        const source = "X:1\nK:C\n[V:1]CDEF|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectVoices",
            args: ["99"],
          },
        });

        expect(response).to.have.property("result");
        // Returns input selection (the root), so 1 range covering the document
        expect(response.result!.ranges).to.have.length(1);
      });

      it("groups same voice appearing in multiple sections into single range", async () => {
        // Same voice ID appearing multiple times is grouped into a single cursor
        const source = "X:1\nK:C\n[V:1]CDEF|\nV:1\nGABC|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectVoices",
            args: ["1"],
          },
        });

        expect(response).to.have.property("result");
        // All voice 1 content is grouped into a single cursor
        expect(response.result!.ranges).to.have.length(1);
        // The range should span from [V:1] through GABC|
        const range = response.result!.ranges[0];
        expect(range.start.line).to.equal(2);
        expect(range.end.line).to.equal(4);
      });

      it("returns range for voice marker with no music content", async () => {
        const source = "X:1\nK:C\nV:1\nV:2\nCDEF|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectVoices",
            args: ["1"],
          },
        });

        expect(response).to.have.property("result");
        // Should have a range covering only V:1 line
        expect(response.result!.ranges).to.have.length(1);
        const range = response.result!.ranges[0];
        expect(range.start.line).to.equal(2);
        expect(range.end.line).to.equal(2);
      });
    });

    // Tests for selectMeasures using resolveContiguousRanges
    describe("selectMeasures with contiguous ranges", () => {
      it("returns full measure content including barline", async () => {
        const source = "X:1\nK:C\nCDEF|GABC|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest({
          id: 1,
          method: "abc.applySelector",
          params: {
            uri: "file:///path/to/file.abc",
            selector: "selectMeasures",
          },
        });

        expect(response).to.have.property("result");
        // Should have two ranges, one for each measure
        expect(response.result!.ranges).to.have.length(2);
        // First measure should include CDEF|
        const firstRange = response.result!.ranges[0];
        expect(firstRange.start.line).to.equal(2);
        expect(firstRange.start.character).to.equal(0);
      });
    });

    describe("abc.applyTransform with a position-based transform", () => {
      interface TransformResponse {
        id: number | string;
        result?: { edits: Array<{ range: LSPRange; newText: string }>; cursorRanges: LSPRange[] };
        error?: { code: number; message: string };
      }

      it("puts the cursor where the split moved it in the new text, and not at the position that it had before", async () => {
        const source = "X:1\nK:C\nC D E F|G A B c|\nC D E F|G A B c|\n";
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest<TransformResponse>({
          id: 1,
          method: "abc.applyTransform",
          params: {
            uri: "file:///path/to/file.abc",
            transform: "splitSystems",
            args: [],
            ranges: [{ start: { line: 3, character: 4 }, end: { line: 3, character: 4 } }],
          },
        });

        expect(response).to.have.property("result");
        // The split puts E on a new line, so the cursor goes to the start of line 4. The old position was 3:4.
        expect(response.result!.cursorRanges).to.have.length(1);
        expect(response.result!.cursorRanges[0].start).to.deep.equal({ line: 4, character: 0 });
      });

      it("never puts the cursor at the top of the file for a split of a multi-voice system", async () => {
        const source = ["X:1", "V:1", "V:2", "K:C", "[V:1] C D E F | G A B c |", "[V:2] c B A G | F E D C |", ""].join("\n");
        documents.set("file:///path/to/file.abc", createMockAbcDocument(source));

        const response = await sendRequest<TransformResponse>({
          id: 1,
          method: "abc.applyTransform",
          params: {
            uri: "file:///path/to/file.abc",
            transform: "splitSystems",
            args: [],
            ranges: [{ start: { line: 4, character: 15 }, end: { line: 4, character: 15 } }],
          },
        });

        expect(response).to.have.property("result");
        expect(response.result!.cursorRanges).to.have.length(1);
        expect(response.result!.cursorRanges[0].start.line).to.be.greaterThan(4);
      });
    });

    describe("abc.importMidi dispatch", () => {
      beforeEach(() => {
        handler.setImportMidi((midiBase64, options) => {
          const bytes = Buffer.from(midiBase64, "base64");
          return midi2abc(new Uint8Array(bytes), options);
        });
      });

      it("returns ABC string for valid base64-encoded MIDI", async () => {
        const abc = "X:1\nT:Test\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n";
        const ctx = new ABCContext();
        const tokens = Scanner(abc, ctx);
        const ast = parse(tokens, ctx);
        const midiBytes = abc2midi(ast, ctx);
        const midiBase64 = Buffer.from(midiBytes).toString("base64");

        const response = await sendRequest<{ id: number; result?: { abc: string }; error?: { code: number; message: string } }>({
          id: 1,
          method: "abc.importMidi",
          params: { midi: midiBase64 },
        });

        expect(response).to.have.property("result");
        expect(response.result!.abc).to.be.a("string");
        expect(response.result!.abc).to.include("X:");
      });

      it("returns error for missing midi parameter", async () => {
        const response = await sendRequest<ErrorResponse>({
          id: 1,
          method: "abc.importMidi",
          params: {},
        });

        expect(response).to.have.property("error");
        expect(response.error.code).to.equal(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.message).to.include("midi");
      });

      it("returns error when importMidi is not initialized", async () => {
        handler.importMidiFn = null;

        const response = await sendRequest<ErrorResponse>({
          id: 1,
          method: "abc.importMidi",
          params: { midi: "AAAA" },
        });

        expect(response).to.have.property("error");
        expect(response.error.message).to.include("not initialized");
      });
    });
  });
});
