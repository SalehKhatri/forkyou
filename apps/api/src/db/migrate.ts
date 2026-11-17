import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

/** Apply pending migrations from apps/api/drizzle. Safe to run on every deploy. */
export async function runMigrations(url: string) {
  const { db, close } = createDb(url);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  await runMigrations(url);
  console.log("migrations applied");
}
