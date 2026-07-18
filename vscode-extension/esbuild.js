const esbuild = require("esbuild");

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

  if (watch) {
    await ctx.watch();
    await serverCtx.watch();
  } else {
    await ctx.rebuild();
    await serverCtx.rebuild();
    await ctx.dispose();
    await serverCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
