import type { Queue } from "bullmq";
import type { CreationRunJob } from "@mediaforge/contracts";
import { enqueueCreationRun } from "./queue";
import type { CreationPersistence } from "./persistence";

export function createCreationDispatcher(
  persistence: CreationPersistence,
  queue: Queue<CreationRunJob>
) {
  let timer: NodeJS.Timeout | undefined;
  let dispatching = false;

  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      const items = await persistence.listPendingOutbox();
      for (const item of items) {
        try {
          await enqueueCreationRun(queue, item.payload_json);
          await persistence.markOutboxDispatched(item.id);
        } catch (error) {
          await persistence.markOutboxFailed(item.id, error);
        }
      }
    } finally {
      dispatching = false;
    }
  }

  return {
    dispatchPending,
    start(intervalMs = 2_000): void {
      if (timer) return;
      void dispatchPending();
      timer = setInterval(() => {
        void dispatchPending();
      }, intervalMs);
      timer.unref();
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    }
  };
}
