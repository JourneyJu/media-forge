import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge";
const migrationsDirectory = resolve(process.cwd(), "migrations");
const pool = new Pool({ connectionString: databaseUrl });

async function migrate(): Promise<void> {
  await pool.query(
    `create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`
  );
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const existing = await pool.query("select 1 from schema_migrations where name = $1", [file]);
    if (existing.rowCount) continue;
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("migration_applied", { file });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

void migrate()
  .finally(() => pool.end())
  .catch((error: unknown) => {
    console.error("migration_failed", error);
    process.exitCode = 1;
  });
