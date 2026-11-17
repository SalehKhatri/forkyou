import { defineConfig } from "vitest/config";

// Unit tests cover the modules that don't import `vscode`; that module only exists inside the editor.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
