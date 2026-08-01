import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge";
const migrationsDirectory = resolve(process.cwd(), "migrations");
const migrationLockKey = 410001;

export async function migrateAuthDatabase(pool = new Pool({ connectionString: databaseUrl })): Promise<void> {
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query("select pg_advisory_lock($1)", [migrationLockKey]);
    await migrationClient.query(
      `create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`
    );

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const migrationName = `auth/${file}`;
      const existing = await migrationClient.query("select 1 from schema_migrations where name = $1", [migrationName]);
      if (existing.rowCount) continue;

      const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
      await migrationClient.query("begin");
      await migrationClient.query(sql);
      await migrationClient.query("insert into schema_migrations (name) values ($1)", [migrationName]);
      await migrationClient.query("commit");
      console.log("auth_migration_applied", { file });
    }
  } catch (error) {
    try {
      await migrationClient.query("rollback");
    } catch {
      // Ignore rollback errors and surface the original migration failure.
    }
    throw error;
  } finally {
    await migrationClient.query("select pg_advisory_unlock($1)", [migrationLockKey]);
    migrationClient.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: databaseUrl });
  void migrateAuthDatabase(pool)
    .finally(() => pool.end())
    .catch((error: unknown) => {
      console.error("auth_migration_failed", error);
      process.exitCode = 1;
    });
}
