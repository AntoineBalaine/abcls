/**
 * The page of the webview.
 *
 * The page only loads the bundled script and the style sheet of the extension, with a content security policy that
 * allows nothing else, so no inline script can run.
 */

import { randomBytes } from "crypto";

export interface HtmlParts {
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
}

export function renderWebviewHtml(parts: HtmlParts): string {
  const policy = ["default-src 'none'", `style-src ${parts.cspSource}`, `script-src 'nonce-${parts.nonce}'`].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${parts.styleUri}">
<title>ABC keys</title>
</head>
<body>
<div id="root" aria-live="polite"></div>
<script nonce="${parts.nonce}" src="${parts.scriptUri}"></script>
</body>
</html>`;
}

/** A nonce for the content security policy: 32 hexadecimal characters from the random bytes of the system. */
export function makeNonce(): string {
  return randomBytes(16).toString("hex");
}
