// Checks the packaged .vsix before it can reach users. Run after `pnpm package`:
//   node scripts/check-package.mjs
// A broken package only shows up once people install it, and published versions can't be pulled
// back from everyone's editor, so CI runs this on every change.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Module, { builtinModules } from "node:module";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const vsix = `forkyou-${version}.vsix`;
const failures = [];

// 1. Exactly the files .vscodeignore means to ship: no sources, source maps or node_modules.
const expected = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/changelog.md",
  "extension/dist/extension.js",
  "extension/media/icon.png",
  "extension/package.json",
  "extension/readme.md",
];
const entries = execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const sorted = (list) => [...list].sort();
if (JSON.stringify(sorted(entries)) !== JSON.stringify(sorted(expected))) {
  failures.push(
    `unexpected files in ${vsix}:\n  got      ${sorted(entries).join(", ")}\n  expected ${sorted(expected).join(", ")}`,
  );
}

// 2. The bundle may only require `vscode` (provided by the editor) and Node built-ins. Anything
// else wasn't bundled, and `vsce package --no-dependencies` ships no node_modules.
const source = execFileSync("unzip", ["-p", vsix, "extension/dist/extension.js"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const required = [...new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))];
const unbundled = required.filter(
  (name) => name !== "vscode" && !builtinModules.includes(name.replace(/^node:/, "")),
);
if (unbundled.length > 0)
  failures.push(`bundle requires unbundled modules: ${unbundled.join(", ")}`);

// 3. The bundle loads and exports activate/deactivate. `vscode` is stubbed with a proxy that
// accepts any property access or call, so this only catches errors in the bundle's own top level.
const stub = new Proxy(function vscode() {}, {
  get: (_target, key) => (key === "then" ? undefined : stub),
  apply: () => stub,
  construct: () => stub,
});
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "vscode" ? stub : load.call(this, request, ...rest);
};
try {
  const filename = `${process.cwd()}/dist/extension.js`;
  const bundle = new Module(filename);
  bundle.filename = filename;
  bundle._compile(source, filename);
  for (const name of ["activate", "deactivate"]) {
    if (typeof bundle.exports[name] !== "function")
      failures.push(`bundle doesn't export ${name}()`);
  }
} catch (error) {
  failures.push(`bundle throws when loaded: ${error.stack ?? error}`);
} finally {
  Module._load = load;
}

if (failures.length > 0) {
  console.error(`${vsix} failed its checks:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `${vsix}: ${entries.length} files, requires ${required.join(", ")}; loads and exports activate/deactivate`,
);
