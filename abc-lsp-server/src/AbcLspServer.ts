import { abc2midi, midi2abc } from "abcls-midi";
import type { ConversionOptions } from "abcls-midi";
import { AbcFormatter, convertTuneToDeferred, File_structure, Tune } from "abcls-parser";
import { Token } from "abcls-parser";
import { ResponseError } from "vscode-languageserver";
import { HandlerResult, Position, Range, SemanticTokens, SemanticTokensBuilder, TextDocuments, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { AbcDocument } from "./AbcDocument";
import { AbcxDocument } from "./AbcxDocument";
import { PreviewManager } from "./PreviewManager";
import { LspEventListener, mapTTtoStandardScope } from "./server_helpers";

/** Common interface for ABC and ABCx documents */
type DocumentType = AbcDocument | AbcxDocument;

/** Type guard to check if a document is an AbcDocument (has ctx property) */
function isAbcDocument(doc: DocumentType): doc is AbcDocument {
  return doc instanceof AbcDocument;
}

/** Type guard to check if a document is an AbcxDocument (has ctx property) */
function isAbcxDocument(doc: DocumentType): doc is AbcxDocument {
  return doc instanceof AbcxDocument;
}

/** Type guard to check if a document has ctx property (AbcDocument or AbcxDocument) */
function hasCtx(doc: DocumentType): doc is AbcDocument | AbcxDocument {
  return isAbcDocument(doc) || isAbcxDocument(doc);
}

/**
 * Storage for abc scores, their diagnostics,
 * and access for handlers for SemanticTokens, Formatting, and RhythmTransform.
 */
export class AbcLspServer {
  /**
   * A hashmap of abc scores stored by the server.
   * Uses the document's uri as key to index the scores.
   * Supports both ABC (.abc) and ABCx (.abcx) documents.
   */
  abcDocuments: Map<string, DocumentType> = new Map();
  previewManager: PreviewManager | null = null;
  documents: TextDocuments<TextDocument>;
  listener: LspEventListener;

  constructor(documents: TextDocuments<TextDocument>, listener: LspEventListener) {
    this.documents = documents;
    this.listener = listener;

    this.documents.onDidChangeContent((change) => {
      this.onDidChangeContent(change.document.uri);
    });

    this.documents.onDidClose((event) => {
      this.abcDocuments.delete(event.document.uri);
    });
  }

  // Checks if a URI refers to an ABCx file
  isAbcxFile(uri: string): boolean {
    return uri.toLowerCase().endsWith(".abcx");
  }

  /**
   * Get the updated changes in the document,
   * parse it and send diagnostics to the client.
   * @param uri
   */
  onDidChangeContent(uri: string) {
    let abcDocument = this.abcDocuments.get(uri);
    const document = this.documents.get(uri);

    if (!abcDocument) {
      if (document) {
        // Create appropriate document type based on file extension
        if (this.isAbcxFile(uri)) {
          abcDocument = new AbcxDocument(document);
        } else {
          abcDocument = new AbcDocument(document);
        }
        this.abcDocuments.set(uri, abcDocument);
      }
    } else if (document) {
      // Update the document reference because TextDocuments creates new immutable
      // TextDocument objects on each content change
      abcDocument.document = document;
    }

    if (abcDocument) {
      abcDocument.analyze();
      this.listener("diagnostics", {
        uri: uri,
        diagnostics: abcDocument.diagnostics,
      });

      // Push content update to preview server if preview is enabled for this URI
      if (this.previewManager?.isPreviewEnabled(uri)) {
        this.previewManager.pushContentUpdate(uri);
      }
    }
  }

  /**
   * Handler for Semantic Tokens request
   *
   * Find the requested document and build its semantic tokens for syntax highlighting.
   * @param uri of the document
   * @returns SemanticTokens
   */
  onSemanticTokens(uri: string): HandlerResult<SemanticTokens, void> {
    const abcDocument = this.abcDocuments.get(uri); // find doc in previously parsed docs
    if (!abcDocument || !abcDocument.tokens) {
      return { data: [] };
    }

    const builder = new SemanticTokensBuilder();

    for (const token of abcDocument.tokens) {
      const scope = mapTTtoStandardScope(token.type);
      if (scope === -1) continue; // Skip whitespace, punctuation, etc.

      // Handle multi-line tokens by splitting them across lines
      if (token.lexeme.includes("\n")) {
        const lines = token.lexeme.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length === 0) continue;
          builder.push(token.line + i, i === 0 ? token.position : 0, lines[i].length, scope, 0);
        }
      } else {
        builder.push(token.line, token.position, token.lexeme.length, scope, 0);
      }
    }

    // Return only the data array, without resultId (kak-lsp compatibility)
    const built = builder.build();
    return { data: built.data };
  }

  /**
   * Handler for Formatting request
   *
   * Find the requested document and format it using the appropriate formatter.
   * Uses {@link AbcFormatter} for ABC/ABCx documents.
   * Returns an array of {@link TextEdit}s.
   */
  onFormat(uri: string): HandlerResult<TextEdit[], void> {
    const abcDocument = this.abcDocuments.get(uri); // find doc in previously parsed docs
    if (!abcDocument || !abcDocument.tokens) {
      return [];
    }

    // Need hasCtx for ctx property access
    if (!hasCtx(abcDocument)) {
      return [];
    }
    if (abcDocument.ctx.errorReporter.hasErrors()) {
      return [];
    }

    const formatted = new AbcFormatter(abcDocument.ctx).formatFile(abcDocument.AST!);
    const edit = TextEdit.replace(Range.create(Position.create(0, 0), Position.create(Number.MAX_VALUE, Number.MAX_VALUE)), formatted);
    return [edit];
  }

  /**
   * Helper for onCompletion handler.
   * Use the uri to find the document and the character at line and char position.
   * @param uri
   * @param char
   * @param line
   * @returns string
   */
  findCharInDoc(uri: string, char: number, line: number) {
    const abcDocument = this.abcDocuments.get(uri); // find doc in previously parsed docs
    if (!abcDocument || !abcDocument.tokens) {
      return [];
    }
    const doc = abcDocument.document;
    const lineText = doc.getText().split("\n")[line];
    const _charIndex = lineText.indexOf(String.fromCharCode(char));
    return lineText.charAt(char);
  }

  /**
   * Get preview content for any ABC-family document.
   * Handles the appropriate conversion based on document type:
   * - ABCx files: returns formatted content directly
   * - ABC files: converts linear tunes to deferred style, leaves others unchanged
   *
   * Because the preview maps clicks to the editor, and the editor's cursor to
   * the preview, through character offsets, an ABC file that needs no
   * conversion is returned as its exact source text. Re-stringifying it would
   * normalise header lines (for instance "Q:1/4=160" into "Q:1/4 = 160") and
   * shift every offset that follows.
   */
  getPreviewContent(uri: string): string {
    const abcDocument = this.abcDocuments.get(uri);
    if (!abcDocument || !abcDocument.AST) {
      return "";
    }

    // ABCx files: return formatted content directly
    if (isAbcxDocument(abcDocument)) {
      const formatter = new AbcFormatter(abcDocument.ctx);
      return formatter.stringify(abcDocument.AST);
    }

    // ABC files: convert linear tunes to deferred style
    // TypeScript's narrowing doesn't handle the DocumentType union well here,
    // so we use type assertion since we know this is AbcDocument after the AbcxDocument check.
    const doc = abcDocument as AbcDocument;
    const ast = doc.AST!;
    const hasLinearTune = ast.contents.some((content) => content instanceof Tune && content.linear === true);
    if (!hasLinearTune) {
      return doc.document.getText();
    }
    const convertedContents: Array<Tune | Token> = [];

    for (const content of ast.contents) {
      if (content instanceof Tune) {
        if (content.linear === true) {
          convertedContents.push(convertTuneToDeferred(content, doc.ctx));
        } else {
          convertedContents.push(content);
        }
      } else {
        convertedContents.push(content);
      }
    }

    const convertedAst = new File_structure(doc.ctx.generateId(), ast.file_header, convertedContents, ast.linear);

    const formatter = new AbcFormatter(doc.ctx);
    return formatter.stringify(convertedAst);
  }

  /**
   * Export a document to MIDI, returning base64-encoded MIDI bytes.
   * Because the LSP JSON protocol cannot transport raw binary, we encode as base64.
   */
  exportMidi(uri: string, tuneNumbers?: number[]): string {
    const doc = this.abcDocuments.get(uri);
    if (!doc) {
      throw new ResponseError(-1, "Document not found");
    }

    if (doc instanceof AbcxDocument) {
      throw new ResponseError(-1, "MIDI export is not supported for ABCx chord sheet files");
    }

    if (!(doc instanceof AbcDocument)) {
      throw new ResponseError(-1, "Document has not been analyzed yet");
    }

    if (!doc.AST) {
      doc.analyze();
    }

    if (!doc.AST) {
      throw new ResponseError(-1, "Document could not be parsed");
    }

    const options = tuneNumbers && tuneNumbers.length > 0 ? { tuneNumbers } : undefined;
    const midiBytes = abc2midi(doc.AST, doc.ctx, options);

    return Buffer.from(midiBytes).toString("base64");
  }

  /**
   * Import MIDI bytes into ABC notation.
   * The input is base64-encoded MIDI data; the output is an ABC string.
   */
  importMidi(midiBase64: string, options?: ConversionOptions): string {
    const bytes = Buffer.from(midiBase64, "base64");
    return midi2abc(new Uint8Array(bytes), options);
  }
}
