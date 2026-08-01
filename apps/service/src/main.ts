import { createServer } from "node:http";
import { startCreationRuntime, stopCreationRuntime } from "./creation-graph/runtime";
import { closeHttpServices, handleRequest } from "./http";

const port = Number(process.env.PORT ?? 4000);

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error: unknown) => {
    console.error("request_failed", error);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "INTERNAL_ERROR", message: "服务内部错误" }));
  });
});

startCreationRuntime();

server.listen(port, () => {
  console.log(`mediaforge-service listening on http://localhost:${port}`);
});

function shutdown(): void {
  server.close(() => {
    void Promise.all([stopCreationRuntime(), closeHttpServices()]).finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
