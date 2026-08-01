import { describe, expect, it } from "vitest";
import { creationRunQueueName, parseRedisConnection } from "./queue";

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

  it("defaults to redis port 6379", () => {
    expect(parseRedisConnection("redis://localhost")).toMatchObject({
      host: "localhost",
      port: 6379
    });
  });
});
