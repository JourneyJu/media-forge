import { createCreationRunWorker } from "./worker";
import { assertProductionModelMode } from "../model-mode";

assertProductionModelMode();

const worker = createCreationRunWorker();

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

process.on("SIGINT", () => {
  worker.close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  worker.close().finally(() => process.exit(0));
});

console.log("mediaforge-creation-worker listening", {
  queue: worker.name
});
