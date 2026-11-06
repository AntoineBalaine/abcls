import * as assert from "assert";
import { makeNonce, renderWebviewHtml } from "./menuViewHtml";

const PARTS = {
  cspSource: "vscode-webview://abc",
  scriptUri: "vscode-webview://abc/dist/webview/menuView.js",
  styleUri: "vscode-webview://abc/dist/webview/menuView.css",
  nonce: "NONCE123",
};

describe("renderWebviewHtml", () => {
  it("allows only the scripts that carry the nonce, and nothing else by default", () => {
    const html = renderWebviewHtml(PARTS);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-NONCE123'"));
    assert.ok(html.includes(`<script nonce="NONCE123" src="${PARTS.scriptUri}">`));
  });

  it("has no inline script and loads the style sheet from the extension", () => {
    const html = renderWebviewHtml(PARTS);
    assert.strictEqual((html.match(/<script/g) ?? []).length, 1);
    assert.ok(!/<script(?![^>]*src=)/.test(html));
    assert.ok(html.includes(`href="${PARTS.styleUri}"`));
    assert.ok(html.includes("style-src vscode-webview://abc"));
  });
});

describe("makeNonce", () => {
  it("gives 32 hexadecimal characters, and a different one each time", () => {
    const first = makeNonce();
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(first, makeNonce());
  });
});
