const esbuild = require("esbuild");
const fs = require("fs");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

/**
 * Copies the style sheet of the menu view next to its script after every build, so that a change of the style sheet
 * also reaches the extension in watch mode.
 * @type {import('esbuild').Plugin}
 */
const copyStylePlugin = {
  name: "copy-menu-view-style",

  setup(build) {
    build.onEnd(() => {
      fs.mkdirSync("dist/webview", { recursive: true });
      fs.copyFileSync("webview/menuView.css", "dist/webview/menuView.css");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: !production,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode", "abcls-native", "jazz-midi"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  const serverCtx = await esbuild.context({
    entryPoints: ["../abc-lsp-server/src/server.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: !production,
    platform: "node",
    outfile: "dist/server.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
    // Shim import.meta.url for svgdom which uses it to locate font files
    define: {
      "import.meta.url": "_importMetaUrl",
    },
    banner: {
      js: "const _importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
  });

  // The script of the menu view runs in a webview, which is a browser page, so it is bundled for the browser.
  const webviewCtx = await esbuild.context({
    entryPoints: ["webview/menuView.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: !production,
    platform: "browser",
    outfile: "dist/webview/menuView.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin, copyStylePlugin],
  });

  if (watch) {
    await ctx.watch();
    await serverCtx.watch();
    await webviewCtx.watch();
  } else {
    await ctx.rebuild();
    await serverCtx.rebuild();
    await webviewCtx.rebuild();
    await ctx.dispose();
    await serverCtx.dispose();
    await webviewCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
