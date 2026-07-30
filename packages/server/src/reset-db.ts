import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DATABASE_URL } from "./db/client.js";

/**
 * Deletes the local database so the next boot starts from fresh seed data.
 *
 * Seeding is `seedIfEmpty` — it runs only when there are no agents, so an
 * existing database is never overwritten and your own tasks and runs survive
 * restarts. This is the escape hatch when you want the sample data back.
 */
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

if (!url.startsWith("file:")) {
  console.error(`Refusing to reset a non-file database: ${url}`);
  process.exit(1);
}

const path = url.slice("file:".length);
const dir = dirname(path);

// WAL mode leaves -shm and -wal siblings; removing the directory takes all
// three, so no stale write-ahead log survives to resurrect old rows.
rmSync(dir, { recursive: true, force: true });

console.log(`Removed ${dir}. The next 'pnpm dev' will reseed.`);
