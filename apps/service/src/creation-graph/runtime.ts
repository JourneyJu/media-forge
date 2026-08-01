import { createCreationDispatcher } from "./dispatcher";
import { createCreationPersistence } from "./persistence";
import { createCreationRunQueue } from "./queue";

let runtime: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const persistence = createCreationPersistence();
  const queue = createCreationRunQueue();
  const dispatcher = createCreationDispatcher(persistence, queue);
  return { persistence, queue, dispatcher };
}

export function getCreationRuntime() {
  runtime ??= createRuntime();
  return runtime;
}

export function startCreationRuntime(): void {
  getCreationRuntime().dispatcher.start();
}

export async function stopCreationRuntime(): Promise<void> {
  if (!runtime) return;
  runtime.dispatcher.stop();
  await runtime.queue.close();
  await runtime.persistence.close();
  runtime = undefined;
}
