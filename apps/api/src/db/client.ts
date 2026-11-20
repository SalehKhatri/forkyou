import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction from `db.transaction()`. Functions that accept `Db | Tx` can run inside one. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
