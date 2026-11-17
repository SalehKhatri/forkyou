import { runMigrations } from "../src/db/migrate.js";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/forkyou_v2_test";
  if (!/test/.test(url)) {
    throw new Error(`Refusing to run tests against "${url}": database name must contain "test"`);
  }
  await runMigrations(url);
}
