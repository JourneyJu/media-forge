import { createServer } from "node:http";
import { Pool } from "pg";
import { loadAuthConfig, createGeneratedBootstrapPassword } from "./config";
import { migrateAuthDatabase } from "./migrate";
import { AuthRepository } from "./repository";
import { AuthService } from "./auth-service";
import { createTokenSigner } from "./tokens";
import { createRequestHandler } from "./http";
import { createPasswordDecryptor } from "./password-encryption";

const config = loadAuthConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const signer = createTokenSigner();
const passwordDecryptor = createPasswordDecryptor();
const repository = new AuthRepository(pool);
const authService = new AuthService(repository, config, signer);

const bootstrapPassword = config.bootstrapAdminPassword ?? createGeneratedBootstrapPassword();

await migrateAuthDatabase(pool);
const didBootstrapAdmin = await authService.bootstrapAdmin(bootstrapPassword);

if (didBootstrapAdmin && !config.bootstrapAdminPassword && config.allowGeneratedBootstrapPassword) {
  console.log("auth_bootstrap_admin_password", {
    account: config.bootstrapAdminAccount,
    password: bootstrapPassword,
    note: "local development only; change password after first login"
  });
}

const server = createServer((request, response) => {
  createRequestHandler({ authService, config, passwordDecryptor, signer })(request, response).catch((error: unknown) => {
    console.error("auth_request_failed", error);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "INTERNAL_ERROR", message: "认证服务内部错误" }));
  });
});

server.listen(config.port, () => {
  console.log(`mediaforge-auth listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
