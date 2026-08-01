import { createCreationRunWorker } from "@mediaforge/service/creation-worker";
import { createMaintenanceWorker } from "@mediaforge/service/maintenance-worker";

const worker = createCreationRunWorker();
const maintenanceWorker = createMaintenanceWorker();
maintenanceWorker.start();

worker.on("completed", (job, result) => {
  console.log("creation_run_completed", {
    jobId: job.id,
    runId: job.data.runId,
    status: result.status
  });
});

worker.on("failed", (job, error) => {
  console.error("creation_run_failed", {
    jobId: job?.id,
    runId: job?.data.runId,
    message: error.message
  });
});

async function shutdown(): Promise<void> {
  await Promise.all([worker.close(), maintenanceWorker.close()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

console.log("mediaforge-creation-worker listening", {
  queue: worker.name
});
