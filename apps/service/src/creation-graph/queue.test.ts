import { afterEach, describe, expect, it } from "vitest";
import { createCreationRunQueue, creationRunQueueName, parseRedisConnection } from "./queue";

afterEach(() => {
  delete process.env.CREATION_RUN_QUEUE_ATTEMPTS;
});

describe("creation run queue", () => {
  it("uses the product queue name", () => {
    expect(creationRunQueueName).toBe("creation-run");
  });

  it("parses a redis url for BullMQ", () => {
    expect(parseRedisConnection("redis://user:pass@localhost:6380/2")).toEqual({
      host: "localhost",
      port: 6380,
      username: "user",
      password: "pass",
      db: 2
    });
  });

  it("enables tls for rediss urls", () => {
    expect(parseRedisConnection("rediss://default:secret@example.upstash.io:6379")).toEqual({
      host: "example.upstash.io",
      port: 6379,
      username: "default",
      password: "secret",
      db: undefined,
      tls: {}
    });
  });

  it("defaults to redis port 6379", () => {
    expect(parseRedisConnection("redis://localhost")).toMatchObject({
      host: "localhost",
      port: 6379
    });
  });

  it("does not retry the whole graph by default", async () => {
    const queue = createCreationRunQueue("redis://localhost:6379");

    expect(queue.opts.defaultJobOptions?.attempts).toBe(1);
    await queue.close();
  });

  it("keeps queue-level retry behind an explicit escape hatch", async () => {
    process.env.CREATION_RUN_QUEUE_ATTEMPTS = "3";
    const queue = createCreationRunQueue("redis://localhost:6379");

    expect(queue.opts.defaultJobOptions?.attempts).toBe(3);
    await queue.close();
  });
});
