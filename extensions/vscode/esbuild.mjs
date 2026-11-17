// Bundles the extension, including @forkyou/shared and zod, into one CommonJS file. VS Code
// 1.90 loads extensions with require() and provides the `vscode` module at runtime.
//   node esbuild.mjs               development build
//   node esbuild.mjs --watch       rebuild on change
//   node esbuild.mjs --production  minified, for packaging
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  // The Node version in VS Code 1.90's extension host.
  target: "node20",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
