import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database and truncate it between tests.
    fileParallelism: false,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/forkyou_v2_test",
    },
  },
});
