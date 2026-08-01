import { Pool } from "pg";
import { createObjectStore, type ObjectStore } from "./assets/object-store";

interface DeletionRow {
  id: string;
  conversation_id: string;
  object_keys_json: string[];
}

interface ExpiredSessionRow {
  id: string;
}

interface ResourceKeyRow {
  original_object_key: string;
  preview_object_key: string | null;
}

export function createMaintenanceWorker(
  databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge",
  objectStore: ObjectStore = createObjectStore()
) {
  const pool = new Pool({ connectionString: databaseUrl });
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function processConversationDeletions(): Promise<void> {
    const rows = await pool.query<DeletionRow>(
       `select id, conversation_id, object_keys_json
       from conversation_deletion_outbox
       where (
         status in ('pending', 'failed') and next_attempt_at <= now()
       ) or (
         status = 'processing' and updated_at <= now() - interval '5 minutes'
       )
       order by created_at limit 20`
    );
    for (const row of rows.rows) {
      try {
        await pool.query(
          "update conversation_deletion_outbox set status = 'processing', updated_at = now() where id = $1",
          [row.id]
        );
        await objectStore.deleteMany(row.object_keys_json);
        await pool.query("delete from conversations where id = $1 and status = 'deleting'", [row.conversation_id]);
      } catch (error) {
        await pool.query(
          `update conversation_deletion_outbox
           set status = 'failed', attempt_count = attempt_count + 1,
               next_attempt_at = now() + interval '30 seconds',
               last_error = $2, updated_at = now()
           where id = $1`,
          [row.id, error instanceof Error ? error.message.slice(0, 500) : "CONVERSATION_DELETE_FAILED"]
        );
      }
    }
  }

  async function processExpiredUploads(): Promise<void> {
    const sessions = await pool.query<ExpiredSessionRow>(
      `select id from upload_sessions
       where status in ('active', 'consumed') and expires_at <= now()
       order by expires_at limit 20`
    );
    for (const session of sessions.rows) {
      const keys = await pool.query<ResourceKeyRow>(
        `select original_object_key, preview_object_key
         from resources
         where upload_session_id = $1 and status in ('uploading', 'staged', 'failed', 'deleting')`,
        [session.id]
      );
      const objectKeys = [...new Set(keys.rows.flatMap((row) =>
        [row.original_object_key, row.preview_object_key].filter((value): value is string => Boolean(value))))];
      try {
        await objectStore.deleteMany(objectKeys);
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(
            `delete from resources
             where upload_session_id = $1 and status in ('uploading', 'staged', 'failed', 'deleting')`,
            [session.id]
          );
          await client.query(
            "update upload_sessions set status = 'expired' where id = $1 and status in ('active', 'consumed')",
            [session.id]
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error("expired_upload_cleanup_failed", {
          uploadSessionId: session.id,
          message: error instanceof Error ? error.message : "UNKNOWN"
        });
      }
    }
  }

  async function reconcileUsage(): Promise<void> {
    await pool.query(
      `update generation_usage_events g
       set status=case r.status
         when 'completed' then 'succeeded'
         when 'failed' then 'failed'
         when 'cancelled' then 'cancelled'
         else g.status
       end,
       completed_at=coalesce(g.completed_at,r.completed_at,now()),
       error_code=case when r.status='failed' then coalesce(g.error_code,'RUN_FAILED') else g.error_code end,
       updated_at=now()
       from runs r
       where g.run_id=r.id and g.status='running'
         and r.status in ('completed','failed','cancelled')`
    );
    await pool.query(
      `update model_usage_logs
       set status='failed',token_status='unavailable',
           error_code='STALE_RUNNING_RECONCILED',completed_at=now(),
           latency_ms=extract(epoch from (now()-started_at))*1000,
           duration_ms=extract(epoch from (now()-started_at))*1000,
           updated_at=now()
       where status='running' and started_at < now() - interval '15 minutes'`
    );
  }

  async function runOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await processConversationDeletions();
      await processExpiredUploads();
      await reconcileUsage();
    } finally {
      running = false;
    }
  }

  return {
    runOnce,
    start(intervalMs = 10_000): void {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => void runOnce(), intervalMs);
      timer.unref();
    },
    async close(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = undefined;
      objectStore.destroy();
      await pool.end();
    }
  };
}
