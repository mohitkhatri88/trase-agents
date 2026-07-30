import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:./data/app.db";

export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): {
  db: Db;
  client: Client;
} {
  if (url.startsWith("file:")) {
    // Create the directory before libsql tries to open the file, so a fresh
    // clone works with no setup step.
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** WAL plus a busy timeout: the two pragmas that stop readers blocking writers. */
export async function applyPragmas(client: Client): Promise<void> {
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA foreign_keys = ON");
}

/**
 * Connect, configure and migrate in one call, so every entry point — the
 * server, the seed CLI, and the tests — gets an identically prepared database.
 * Divergence here is exactly the kind of thing that produces a bug reproducible
 * only in one of them.
 */
export async function initDb(url?: string): Promise<{ db: Db; client: Client }> {
  const { db, client } = createDb(url);
  await applyPragmas(client);
  await runMigrations(db);
  return { db, client };
}

/**
 * Applied on boot rather than as a separate CLI step, so `pnpm dev` really is
 * one command. `../../drizzle` resolves the same from `src/db` under tsx and
 * from `dist/db` in the built output, because dist mirrors src depth.
 */
export async function runMigrations(db: Db): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: join(here, "../../drizzle") });
}
