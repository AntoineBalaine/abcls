const path = require("path");
const esbuild = require("esbuild");

const CLI_DIR = __dirname;
const REPO_ROOT = path.resolve(CLI_DIR, "..");

// Third-party dependencies that should NOT be bundled.
// These are listed as runtime dependencies in publish-package.json
// and will be resolved from node_modules at runtime.
const external = [
  "abcjs",
  "commander",
  "jsdom",
  "svgdom",
  "@svgdotjs/svg.js",
  "vscode-languageserver",
  "vscode-languageserver/node",
  "vscode-languageserver-textdocument",
  "vscode-languageserver-protocol",
  "vscode-uri",
  "abcls-preview-server",
];

// Shim for import.meta.url, which svgdom uses internally to locate font files.
const importMetaShim = {
  define: { "import.meta.url": "_importMetaUrl" },
  banner: {
    js: "const _importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
};

async function main() {
  // Bundle the CLI entry point
  await esbuild.build({
    entryPoints: [path.join(CLI_DIR, "abcls-cli.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: path.join(CLI_DIR, "dist/abcls.js"),
    external,
    banner: {
      js: importMetaShim.banner.js,
    },
    define: importMetaShim.define,
    tsconfig: path.join(CLI_DIR, "tsconfig.json"),
    absWorkingDir: REPO_ROOT,
  });

  // Bundle the LSP server as a separate entry point.
  // The CLI's `lsp` subcommand requires this file at runtime,
  // so it is not loaded unless the user runs `abcls lsp`.
  await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, "abc-lsp-server/src/server.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: path.join(CLI_DIR, "dist/abcls-server.js"),
    external,
    ...importMetaShim,
    tsconfig: path.join(REPO_ROOT, "abc-lsp-server/tsconfig.json"),
    absWorkingDir: REPO_ROOT,
  });

  console.log("abcls bundle built successfully");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
