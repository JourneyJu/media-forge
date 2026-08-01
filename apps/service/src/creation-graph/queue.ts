import { Queue, type QueueOptions } from "bullmq";
import type { CreationRunJob } from "@mediaforge/contracts";

export const creationRunQueueName = "creation-run";

export type RedisConnectionOptions = NonNullable<QueueOptions["connection"]>;

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    ...(url.protocol === "rediss:" ? { tls: {} } : {})
  };
}

export function createCreationRunQueue(redisUrl = getRedisUrl()): Queue<CreationRunJob> {
  return new Queue<CreationRunJob>(creationRunQueueName, {
    connection: parseRedisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });
}

export async function enqueueCreationRun(
  queue: Queue<CreationRunJob>,
  job: CreationRunJob
): Promise<void> {
  const existing = await queue.getJob(job.runId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed" || state === "waiting-children") {
      return;
    }
    await existing.remove();
  }
  await queue.add(job.graphName, job, {
    jobId: job.runId
  });
}
