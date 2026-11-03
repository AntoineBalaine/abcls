import { expect } from "chai";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { AbcDocument } from "./AbcDocument";
import { AbcLspServer } from "./AbcLspServer";

function createMockDocuments(): TextDocuments<TextDocument> {
  // Because the AbcLspServer constructor only registers the
  // onDidChangeContent and onDidClose hooks, a minimal mock is enough.
  return {
    onDidChangeContent: () => {},
    onDidClose: () => {},
  } as unknown as TextDocuments<TextDocument>;
}

function previewOf(content: string): string {
  const server = new AbcLspServer(createMockDocuments(), () => {});
  const uri = "file:///preview.abc";
  const abcDoc = new AbcDocument(TextDocument.create(uri, "abc", 1, content));
  abcDoc.analyze();
  server.abcDocuments.set(uri, abcDoc);
  return server.getPreviewContent(uri);
}

describe("AbcLspServer.getPreviewContent", () => {
  it("returns the exact source of an ABC file that needs no conversion, so that offsets match the editor", () => {
    // Re-stringifying would rewrite "Q:1/4=160" as "Q:1/4 = 160", "M: 4/4" as
    // "M:4/4", and drop the trailing blank lines.
    const source = 'X:1\nT:Tune\nM: 4/4\nL:1/8\nQ:1/4=160\nK:D\n"D"zFF/2 A2|\n\n\n';
    expect(previewOf(source)).to.equal(source);
  });

  it("returns the exact source of a file with several tunes", () => {
    const source = "X:1\nK:C\nCDEF|\n\nX:2\nQ:1/4=90\nK:G\nGABc|\n";
    expect(previewOf(source)).to.equal(source);
  });

  it("still sends a linear tune through the deferred conversion", () => {
    // Because the conversion re-stringifies the tune, its normalised header
    // ("Q:1/4 = 160") shows that the conversion path was taken.
    const source = "X:1\n%%abcls-parse linear\nQ:1/4=160\nK:C\nV:1\nCDEF|\nV:2\nC,D,E,F,|\n";
    const preview = previewOf(source);
    expect(preview).not.to.equal(source);
    expect(preview).to.contain("Q:1/4 = 160");
  });
});
