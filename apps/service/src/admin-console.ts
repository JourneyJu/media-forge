import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  ModelConfig,
  ModelConnection,
  ModelRoute,
  ModelRouteKey,
  UsageDashboardResponse
} from "@mediaforge/contracts";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge";
const pool = new Pool({ connectionString: databaseUrl });

type SecretParts = { ciphertext: string; nonce: string; authTag: string };

function encryptionKey(): Buffer {
  const encoded = process.env.MODEL_CONFIG_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("MODEL_ENCRYPTION_KEY_REQUIRED");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("MODEL_ENCRYPTION_KEY_INVALID");
  return key;
}

function encryptSecret(secret: string): SecretParts {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptSecret(row: { api_key_ciphertext: string; api_key_nonce: string; api_key_auth_tag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.api_key_nonce, "base64"));
  decipher.setAuthTag(Buffer.from(row.api_key_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.api_key_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function assertBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("MODEL_BASE_URL_INVALID");
  const allowPrivate = process.env.MODEL_CONFIG_ALLOW_PRIVATE_NETWORK === "true";
  const privateHostname = url.hostname === "localhost"
    || url.hostname.endsWith(".local")
    || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(url.hostname)
    || (isIP(url.hostname) === 6 && (url.hostname === "::1" || url.hostname.startsWith("fc") || url.hostname.startsWith("fd")));
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("MODEL_BASE_URL_HTTPS_REQUIRED");
  if (!allowPrivate && privateHostname) throw new Error("MODEL_BASE_URL_PRIVATE_FORBIDDEN");
  return value.replace(/\/+$/u, "");
}

function date(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function successRate(succeeded: unknown, failed: unknown): number | null {
  const successCount = Number(succeeded ?? 0);
  const failedCount = Number(failed ?? 0);
  return successCount + failedCount === 0 ? null : successCount / (successCount + failedCount);
}

function mapConnection(row: Record<string, unknown>): ModelConnection {
  return {
    id: String(row.id),
    name: String(row.name),
    adapterType: "openai_compatible",
    baseUrl: String(row.base_url),
    secretConfigured: Boolean(row.api_key_ciphertext),
    status: row.status as ModelConnection["status"],
    lastTestedAt: date(row.last_tested_at),
    lastTestStatus: row.last_test_status as ModelConnection["lastTestStatus"],
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    version: Number(row.version),
    createdAt: date(row.created_at)!,
    updatedAt: date(row.updated_at)!
  };
}

function mapConfig(row: Record<string, unknown>): ModelConfig {
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    displayName: String(row.display_name),
    modelId: String(row.model_id),
    modality: row.modality as ModelConfig["modality"],
    supportsTextInput: Boolean(row.supports_text_input),
    supportsImageInput: Boolean(row.supports_image_input),
    supportsStructuredOutput: Boolean(row.supports_structured_output),
    contextWindow: row.context_window === null ? null : Number(row.context_window),
    maxOutputTokens: row.max_output_tokens === null ? null : Number(row.max_output_tokens),
    temperatureDefault: Number(row.temperature_default),
    timeoutMs: Number(row.timeout_ms),
    status: row.status as ModelConfig["status"],
    lastValidatedAt: date(row.last_validated_at),
    lastValidationStatus: row.last_validation_status as ModelConfig["lastValidationStatus"],
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    version: Number(row.version),
    createdAt: date(row.created_at)!,
    updatedAt: date(row.updated_at)!
  };
}

async function audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown = {}): Promise<void> {
  await pool.query(
    `insert into audit_events
      (id,tenant_id,actor_user_id,action,target_type,target_id,metadata_json)
     values ($1,null,$2,$3,$4,$5,$6::jsonb)`,
    [`audit_${randomUUID()}`, actorId, action, targetType, targetId, JSON.stringify(metadata)]
  );
}

export type ResolvedModel = {
  modelConfigId: string;
  displayName: string;
  adapterType: "openai_compatible";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modality: "text" | "multimodal";
  timeoutMs: number;
  temperatureDefault: number;
};

type ModelConfigInput = {
  connectionId: string;
  displayName: string;
  modelId: string;
  modality: "text" | "multimodal";
  supportsTextInput: boolean;
  supportsImageInput: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  temperatureDefault: number;
  timeoutMs: number;
  version?: number;
};

export const adminConsole = {
  async close(): Promise<void> {
    await pool.end();
  },

  async listConnections(): Promise<ModelConnection[]> {
    const result = await pool.query("select * from model_connections order by created_at desc");
    return result.rows.map((row) => mapConnection(row as Record<string, unknown>));
  },

  async createConnection(actorId: string, input: {
    name: string; adapterType: "openai_compatible"; baseUrl: string; apiKey?: string;
  }): Promise<ModelConnection> {
    const secret = input.apiKey ? encryptSecret(input.apiKey) : null;
    const result = await pool.query(
      `insert into model_connections
        (id, name, adapter_type, base_url, api_key_ciphertext, api_key_nonce, api_key_auth_tag, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning *`,
      [
        `connection_${randomUUID()}`, input.name, input.adapterType, assertBaseUrl(input.baseUrl),
        secret?.ciphertext ?? null, secret?.nonce ?? null, secret?.authTag ?? null, actorId
      ]
    );
    const connection = mapConnection(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_connection.create", "model_connection", connection.id);
    return connection;
  },

  async updateConnection(actorId: string, id: string, input: {
    name: string; adapterType: "openai_compatible"; baseUrl: string; apiKey?: string; version?: number;
  }): Promise<ModelConnection> {
    const secret = input.apiKey ? encryptSecret(input.apiKey) : null;
    const result = await pool.query(
      `update model_connections set
        name = $2, adapter_type = $3, base_url = $4,
        api_key_ciphertext = coalesce($5, api_key_ciphertext),
        api_key_nonce = coalesce($6, api_key_nonce),
        api_key_auth_tag = coalesce($7, api_key_auth_tag),
        last_test_status = 'untested', last_error_code = null, status = 'draft',
        updated_by = $8, updated_at = now(), version = version + 1
       where id = $1 and ($9::integer is null or version = $9) returning *`,
      [
        id, input.name, input.adapterType, assertBaseUrl(input.baseUrl),
        secret?.ciphertext ?? null, secret?.nonce ?? null, secret?.authTag ?? null,
        actorId, input.version ?? null
      ]
    );
    if (!result.rows[0]) throw new Error("MODEL_CONFIG_CONFLICT");
    const connection = mapConnection(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_connection.update", "model_connection", id, { secretReplaced: Boolean(input.apiKey) });
    return connection;
  },

  async testConnection(actorId: string, id: string): Promise<ModelConnection> {
    const result = await pool.query("select * from model_connections where id = $1", [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || !row.api_key_ciphertext || !row.api_key_nonce || !row.api_key_auth_tag) {
      throw new Error("MODEL_CONNECTION_NOT_FOUND");
    }
    let errorCode: string | null = null;
    try {
      const response = await fetch(`${String(row.base_url)}/models`, {
        headers: { authorization: `Bearer ${decryptSecret(row as never)}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) errorCode = `HTTP_${response.status}`;
    } catch {
      errorCode = "CONNECTION_FAILED";
    }
    const updated = await pool.query(
      `update model_connections set
        last_tested_at = now(), last_test_status = $2,
        last_error_code = $3, status = case when $2 = 'success' then 'active' else 'draft' end,
        updated_at = now(), version = version + 1
       where id = $1 returning *`,
      [id, errorCode ? "failed" : "success", errorCode]
    );
    const connection = mapConnection(updated.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_connection.test", "model_connection", id, { result: connection.lastTestStatus });
    return connection;
  },

  async disableConnection(actorId: string, id: string): Promise<ModelConnection> {
    const activeModels = await pool.query(
      `select 1 from model_configs
       where connection_id = $1 and status = 'active'
       limit 1`,
      [id]
    );
    if (activeModels.rowCount) throw new Error("MODEL_CONNECTION_IN_USE");
    const result = await pool.query(
      "update model_connections set status = 'disabled', updated_at = now(), version = version + 1 where id = $1 returning *",
      [id]
    );
    if (!result.rows[0]) throw new Error("MODEL_CONNECTION_NOT_FOUND");
    const connection = mapConnection(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_connection.disable", "model_connection", id);
    return connection;
  },

  async listConfigs(): Promise<ModelConfig[]> {
    const result = await pool.query("select * from model_configs order by created_at desc");
    return result.rows.map((row) => mapConfig(row as Record<string, unknown>));
  },

  async getConfig(id: string): Promise<ModelConfig> {
    const result = await pool.query("select * from model_configs where id = $1", [id]);
    if (!result.rows[0]) throw new Error("MODEL_CONFIG_NOT_FOUND");
    return mapConfig(result.rows[0] as Record<string, unknown>);
  },

  async createConfig(actorId: string, input: ModelConfigInput): Promise<ModelConfig> {
    const result = await pool.query(
      `insert into model_configs
        (id, connection_id, display_name, model_id, modality, supports_text_input,
         supports_image_input, supports_structured_output, context_window, max_output_tokens,
         temperature_default, timeout_ms, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) returning *`,
      [
        `model_${randomUUID()}`, input.connectionId, input.displayName, input.modelId, input.modality,
        input.supportsTextInput, input.supportsImageInput, input.supportsStructuredOutput,
        input.contextWindow, input.maxOutputTokens, input.temperatureDefault, input.timeoutMs, actorId
      ]
    );
    const model = mapConfig(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_config.create", "model_config", model.id, { modality: model.modality });
    return model;
  },

  async updateConfig(actorId: string, id: string, input: ModelConfigInput): Promise<ModelConfig> {
    const result = await pool.query(
      `update model_configs set
        connection_id=$2, display_name=$3, model_id=$4, modality=$5,
        supports_text_input=$6, supports_image_input=$7, supports_structured_output=$8,
        context_window=$9, max_output_tokens=$10, temperature_default=$11, timeout_ms=$12,
        last_validation_status='untested', status='draft', updated_by=$13,
        updated_at=now(), version=version+1
       where id=$1 and ($14::integer is null or version=$14) returning *`,
      [
        id, input.connectionId, input.displayName, input.modelId, input.modality,
        input.supportsTextInput, input.supportsImageInput, input.supportsStructuredOutput,
        input.contextWindow, input.maxOutputTokens, input.temperatureDefault, input.timeoutMs,
        actorId, input.version ?? null
      ]
    );
    if (!result.rows[0]) throw new Error("MODEL_CONFIG_CONFLICT");
    const model = mapConfig(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_config.update", "model_config", id, { modality: model.modality });
    return model;
  },

  async validateConfig(actorId: string, id: string): Promise<ModelConfig> {
    const result = await pool.query(
      `select m.*, c.base_url, c.api_key_ciphertext, c.api_key_nonce, c.api_key_auth_tag, c.status as connection_status
       from model_configs m join model_connections c on c.id = m.connection_id where m.id = $1`,
      [id]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.connection_status !== "active") throw new Error("MODEL_CONNECTION_NOT_ACTIVE");
    let errorCode: string | null = null;
    try {
      const content = row.modality === "multimodal"
        ? [
            { type: "text", text: row.supports_structured_output ? "Return JSON with key ok and value true." : "Reply OK." },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
              }
            }
          ]
        : row.supports_structured_output
          ? "Return JSON with key ok and value true."
          : "Reply OK.";
      const requestBody: Record<string, unknown> = {
        model: row.model_id,
        // Reasoning models may consume part of the output budget before emitting content.
        max_tokens: row.supports_structured_output ? 128 : 16,
        messages: [{ role: "user", content }]
      };
      if (row.supports_structured_output) requestBody.response_format = { type: "json_object" };
      const response = await fetch(`${String(row.base_url)}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${decryptSecret(row as never)}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(Number(row.timeout_ms), 15000))
      });
      if (!response.ok) {
        errorCode = `HTTP_${response.status}`;
      } else if (row.supports_structured_output) {
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const output = body.choices?.[0]?.message?.content;
        if (!output) {
          errorCode = "STRUCTURED_OUTPUT_EMPTY";
        } else {
          try {
            JSON.parse(output);
          } catch {
            errorCode = "STRUCTURED_OUTPUT_INVALID";
          }
        }
      }
    } catch {
      errorCode = "VALIDATION_FAILED";
    }
    const updated = await pool.query(
      `update model_configs set
        last_validated_at=now(), last_validation_status=$2, last_error_code=$3,
        status=case when $2='success' then 'active' else 'draft' end,
        updated_at=now(), version=version+1 where id=$1 returning *`,
      [id, errorCode ? "failed" : "success", errorCode]
    );
    const model = mapConfig(updated.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_config.validate", "model_config", id, { result: model.lastValidationStatus });
    return model;
  },

  async disableConfig(actorId: string, id: string): Promise<ModelConfig> {
    const routed = await pool.query("select 1 from model_routes where model_config_id = $1", [id]);
    if (routed.rowCount) throw new Error("MODEL_CONFIG_IN_USE");
    const result = await pool.query(
      "update model_configs set status='disabled', updated_at=now(), version=version+1 where id=$1 returning *",
      [id]
    );
    if (!result.rows[0]) throw new Error("MODEL_CONFIG_NOT_FOUND");
    const model = mapConfig(result.rows[0] as Record<string, unknown>);
    await audit(actorId, "model_config.disable", "model_config", id);
    return model;
  },

  async listRoutes(): Promise<ModelRoute[]> {
    const result = await pool.query(
      `select r.*, m.display_name
       from model_routes r left join model_configs m on m.id = r.model_config_id
       order by case r.route_key when 'text_generation' then 1 else 2 end`
    );
    return result.rows.map((row) => ({
      routeKey: row.route_key as ModelRouteKey,
      modelConfigId: row.model_config_id ? String(row.model_config_id) : null,
      modelDisplayName: row.display_name ? String(row.display_name) : null,
      updatedAt: date(row.updated_at),
      version: Number(row.version)
    }));
  },

  async updateRoute(actorId: string, routeKey: ModelRouteKey, modelConfigId: string, version: number): Promise<ModelRoute> {
    const config = await pool.query("select * from model_configs where id=$1 and status='active'", [modelConfigId]);
    const row = config.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("MODEL_CONFIG_NOT_ACTIVE");
    if (routeKey === "multimodal_generation" && (row.modality !== "multimodal" || !row.supports_image_input)) {
      throw new Error("MODEL_CAPABILITY_MISMATCH");
    }
    const result = await pool.query(
      `update model_routes set model_config_id=$2, updated_by=$3, updated_at=now(), version=version+1
       where route_key=$1 and version=$4 returning *`,
      [routeKey, modelConfigId, actorId, version]
    );
    if (!result.rows[0]) throw new Error("MODEL_ROUTE_VERSION_CONFLICT");
    const route = (await this.listRoutes()).find((item) => item.routeKey === routeKey)!;
    await audit(actorId, "model_route.update", "model_route", routeKey, { modelConfigId });
    return route;
  },

  async resolveModel(routeKey: ModelRouteKey): Promise<ResolvedModel> {
    const result = await pool.query(
      `select m.*, c.adapter_type, c.base_url, c.api_key_ciphertext, c.api_key_nonce, c.api_key_auth_tag
       from model_routes r
       join model_configs m on m.id=r.model_config_id and m.status='active'
       join model_connections c on c.id=m.connection_id and c.status='active'
       where r.route_key=$1`,
      [routeKey]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || !row.api_key_ciphertext) throw new Error("GENERATION_MODEL_UNAVAILABLE");
    return {
      modelConfigId: String(row.id),
      displayName: String(row.display_name),
      adapterType: "openai_compatible",
      baseUrl: String(row.base_url),
      apiKey: decryptSecret(row as never),
      modelId: String(row.model_id),
      modality: row.modality as "text" | "multimodal",
      timeoutMs: Number(row.timeout_ms),
      temperatureDefault: Number(row.temperature_default)
    };
  },

  async acceptGeneration(userId: string, runId: string, generationType = "wechat_article_generation"): Promise<void> {
    const id = `generation_${randomUUID()}`;
    await pool.query(
      `insert into generation_usage_events
        (id,user_id,generation_id,run_id,generation_type,status,started_at)
       values ($1,$2,$1,$3,$4,'running',now()) on conflict (run_id) do nothing`,
      [id, userId, runId, generationType]
    );
  },

  async finishGeneration(runId: string, status: "completed" | "failed" | "cancelled", errorCode?: string): Promise<void> {
    const usageStatus = status === "completed" ? "succeeded" : status;
    await pool.query(
      `update generation_usage_events
       set status=$2, completed_at=now(), error_code=$3, updated_at=now()
       where run_id=$1 and status='running'`,
      [runId, usageStatus, errorCode ?? null]
    );
  },

  async startModelUsage(input: {
    userId: string; runId?: string; modelConfigId: string; routeKey: ModelRouteKey;
    stepId?: string; attemptNo?: number;
  }): Promise<string> {
    const id = `model_usage_${randomUUID()}`;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const source = await client.query(
        `select m.model_id,c.adapter_type,g.id generation_event_id,g.generation_id
         from model_configs m
         join model_connections c on c.id=m.connection_id
         left join generation_usage_events g on g.run_id=$2
         where m.id=$1`,
        [input.modelConfigId, input.runId ?? null]
      );
      const row = source.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("MODEL_CONFIG_NOT_FOUND");
      await client.query(
        `insert into model_usage_logs
          (id,call_id,user_id,run_id,generation_event_id,generation_id,step_id,model_config_id,
           route_key,adapter_type,provider,model_id,attempt_no,status,token_status)
         values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,'running','unavailable')`,
        [
          id, input.userId, input.runId ?? null, row.generation_event_id ?? null,
          row.generation_id ?? null, input.stepId ?? null, input.modelConfigId, input.routeKey,
          String(row.adapter_type), String(row.model_id), input.attemptNo ?? 1
        ]
      );
      if (row.generation_event_id) {
        await client.query(
          "update generation_usage_events set model_call_count=model_call_count+1,updated_at=now() where id=$1",
          [row.generation_event_id]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return id;
  },

  async finishModelUsage(id: string, input: {
    status: "succeeded" | "failed"; inputTokens?: number; outputTokens?: number; totalTokens?: number;
    providerRequestId?: string; errorCode?: string; latencyMs: number;
  }): Promise<void> {
    const available = input.inputTokens !== undefined || input.outputTokens !== undefined || input.totalTokens !== undefined;
    await pool.query(
      `update model_usage_logs set status=$2,input_tokens=$3,output_tokens=$4,total_tokens=$5,
       tokens_available=$6,token_status=$7,provider_request_id=$8,error_code=$9,
       latency_ms=$10,duration_ms=$10,completed_at=now(),updated_at=now() where id=$1`,
      [
        id, input.status, input.inputTokens ?? null, input.outputTokens ?? null, input.totalTokens ?? null,
        available, available ? "reported" : "unavailable", input.providerRequestId ?? null,
        input.errorCode ?? null, input.latencyMs
      ]
    );
  },

  async usageDashboard(from: string, to: string): Promise<UsageDashboardResponse> {
    const rangeDays = Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 180) {
      throw new Error("USAGE_RANGE_INVALID");
    }
    const params = [`${from}T00:00:00.000+08:00`, `${to}T23:59:59.999+08:00`];
    const [generation, model, trend, users, models] = await Promise.all([
      pool.query(
        `select count(*)::integer count,count(distinct user_id)::integer active_users,
         count(*) filter(where status='succeeded')::integer succeeded,
         count(*) filter(where status='failed')::integer failed,
         count(*) filter(where status='cancelled')::integer cancelled
         from generation_usage_events where started_at between $1 and $2`,
        params
      ),
      pool.query(
        `select count(*)::integer calls,
         count(*) filter(where status='succeeded')::integer succeeded,
         count(*) filter(where status='failed')::integer failed,
         avg(duration_ms) filter(where completed_at is not null) average_duration,
         case when count(*) filter(where tokens_available)>0 then sum(input_tokens)::integer end input_tokens,
         case when count(*) filter(where tokens_available)>0 then sum(output_tokens)::integer end output_tokens,
         case when count(*) filter(where tokens_available)>0 then sum(total_tokens)::integer end total_tokens,
         count(*) filter (where not tokens_available)::integer unavailable
         from model_usage_logs where started_at between $1 and $2`,
        params
      ),
      pool.query(
        `with days as (
         select generate_series($1::date,$2::date,'1 day')::date d
         ), g as (
           select (started_at at time zone 'Asia/Shanghai')::date d,count(*)::integer c from generation_usage_events
           where started_at between $1 and $2 group by 1
         ), m as (
           select (started_at at time zone 'Asia/Shanghai')::date d,count(*)::integer calls,coalesce(sum(input_tokens),0)::integer i,
           coalesce(sum(output_tokens),0)::integer o,coalesce(sum(total_tokens),0)::integer t,
           count(*) filter(where not tokens_available)::integer u from model_usage_logs
           where started_at between $1 and $2 group by 1
         )
         select days.d,coalesce(g.c,0) generations,coalesce(m.calls,0) calls,coalesce(m.i,0) i,
         coalesce(m.o,0) o,coalesce(m.t,0) t,coalesce(m.u,0) u
         from days left join g using(d) left join m using(d) order by days.d`,
        [from, to]
      ),
      pool.query(
        `with g as (
           select user_id,count(*)::integer generations,
           count(*) filter(where status='succeeded')::integer succeeded,
           count(*) filter(where status='failed')::integer failed,
           count(*) filter(where status='cancelled')::integer cancelled
           from generation_usage_events where started_at between $1 and $2 group by user_id
         ), l as (
           select user_id,count(*)::integer calls,
           count(*) filter(where status='succeeded')::integer model_succeeded,
           count(*) filter(where status='failed')::integer model_failed,
           avg(duration_ms) filter(where completed_at is not null) average_duration,
           case when count(*) filter(where tokens_available)>0 then sum(input_tokens)::integer end i,
           case when count(*) filter(where tokens_available)>0 then sum(output_tokens)::integer end o,
           case when count(*) filter(where tokens_available)>0 then sum(total_tokens)::integer end t,
           count(*) filter(where not tokens_available)::integer unavailable
           from model_usage_logs where started_at between $1 and $2 group by user_id
         )
         select u.id,u.username,u.display_name,coalesce(g.generations,0) generations,
         coalesce(g.succeeded,0) succeeded,coalesce(g.failed,0) failed,coalesce(g.cancelled,0) cancelled,
         coalesce(l.calls,0) calls,coalesce(l.model_succeeded,0) model_succeeded,
         coalesce(l.model_failed,0) model_failed,l.average_duration,l.i,l.o,l.t,
         coalesce(l.unavailable,0) unavailable
         from users u left join g on g.user_id=u.id left join l on l.user_id=u.id
         where g.user_id is not null or l.user_id is not null
         order by generations desc,calls desc`,
        params
      ),
      pool.query(
        `select m.id,m.display_name,m.model_id,m.modality,count(l.id)::integer calls,
         count(distinct l.user_id)::integer active_users,
         count(l.id) filter(where l.status='succeeded')::integer succeeded,
         count(l.id) filter(where l.status='failed')::integer failed,
         avg(l.duration_ms) filter(where l.completed_at is not null) average_duration,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.input_tokens)::integer end i,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.output_tokens)::integer end o,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.total_tokens)::integer end t,
         count(l.id) filter(where not l.tokens_available)::integer unavailable
         from model_configs m left join model_usage_logs l on l.model_config_id=m.id and l.started_at between $1 and $2
         group by m.id,m.display_name,m.model_id,m.modality order by calls desc`,
        params
      )
    ]);
    const generationSummary = generation.rows[0] ?? {};
    const modelSummary = model.rows[0] ?? {};
    return {
      summary: {
        generationCount: Number(generationSummary.count ?? 0),
        generationSuccessCount: Number(generationSummary.succeeded ?? 0),
        generationFailedCount: Number(generationSummary.failed ?? 0),
        generationCancelledCount: Number(generationSummary.cancelled ?? 0),
        generationSuccessRate: successRate(generationSummary.succeeded, generationSummary.failed),
        activeUsers: Number(generationSummary.active_users ?? 0),
        modelCallCount: Number(modelSummary.calls ?? 0),
        modelSuccessCount: Number(modelSummary.succeeded ?? 0),
        modelFailedCount: Number(modelSummary.failed ?? 0),
        modelSuccessRate: successRate(modelSummary.succeeded, modelSummary.failed),
        averageDurationMs: nullableNumber(modelSummary.average_duration),
        inputTokens: nullableNumber(modelSummary.input_tokens),
        outputTokens: nullableNumber(modelSummary.output_tokens),
        totalTokens: nullableNumber(modelSummary.total_tokens),
        unavailableTokenCallCount: Number(modelSummary.unavailable ?? 0)
      },
      trend: trend.rows.map((row) => ({
        date: new Date(row.d).toISOString().slice(0, 10),
        generationCount: Number(row.generations),
        modelCallCount: Number(row.calls),
        inputTokens: Number(row.i),
        outputTokens: Number(row.o),
        totalTokens: Number(row.t),
        unavailableTokenCallCount: Number(row.u)
      })),
      users: users.rows.map((row) => ({
        userId: String(row.id), username: String(row.username), displayName: String(row.display_name),
        generationCount: Number(row.generations),
        generationSuccessCount: Number(row.succeeded), generationFailedCount: Number(row.failed),
        generationCancelledCount: Number(row.cancelled),
        generationSuccessRate: successRate(row.succeeded, row.failed),
        activeUsers: Number(row.generations) > 0 ? 1 : 0,
        modelCallCount: Number(row.calls), modelSuccessCount: Number(row.model_succeeded),
        modelFailedCount: Number(row.model_failed),
        modelSuccessRate: successRate(row.model_succeeded, row.model_failed),
        averageDurationMs: nullableNumber(row.average_duration),
        inputTokens: nullableNumber(row.i), outputTokens: nullableNumber(row.o), totalTokens: nullableNumber(row.t),
        unavailableTokenCallCount: Number(row.unavailable)
      })),
      models: models.rows.map((row) => ({
        modelConfigId: String(row.id), modelDisplayName: String(row.display_name),
        modelId: String(row.model_id), activeUserCount: Number(row.active_users),
        modality: row.modality as "text" | "multimodal",
        generationCount: 0, generationSuccessCount: 0, generationFailedCount: 0,
        generationCancelledCount: 0, generationSuccessRate: null, activeUsers: Number(row.active_users),
        modelCallCount: Number(row.calls), modelSuccessCount: Number(row.succeeded),
        modelFailedCount: Number(row.failed), modelSuccessRate: successRate(row.succeeded, row.failed),
        averageDurationMs: nullableNumber(row.average_duration),
        inputTokens: nullableNumber(row.i), outputTokens: nullableNumber(row.o), totalTokens: nullableNumber(row.t),
        unavailableTokenCallCount: Number(row.unavailable)
      }))
    };
  },

  async usageUserDetail(actorId: string, userId: string, from: string, to: string) {
    const dashboard = await this.usageDashboard(from, to);
    const user = dashboard.users.find((item) => item.userId === userId);
    if (!user) throw new Error("USAGE_USER_NOT_FOUND");
    const params = [userId, `${from}T00:00:00.000+08:00`, `${to}T23:59:59.999+08:00`];
    const [models, generations] = await Promise.all([
      pool.query(
        `select m.id,m.display_name,m.model_id,m.modality,count(l.id)::integer calls,
         count(l.id) filter(where l.status='succeeded')::integer succeeded,
         count(l.id) filter(where l.status='failed')::integer failed,
         avg(l.duration_ms) filter(where l.completed_at is not null) average_duration,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.input_tokens)::integer end i,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.output_tokens)::integer end o,
         case when count(l.id) filter(where l.tokens_available)>0 then sum(l.total_tokens)::integer end t,
         count(l.id) filter(where not l.tokens_available)::integer unavailable
         from model_usage_logs l join model_configs m on m.id=l.model_config_id
         where l.user_id=$1 and l.started_at between $2 and $3
         group by m.id,m.display_name,m.model_id,m.modality order by calls desc`,
        params
      ),
      pool.query(
        `select generation_id,generation_type,status,model_call_count,started_at,completed_at
         from generation_usage_events
         where user_id=$1 and started_at between $2 and $3
         order by started_at desc limit 20`,
        params
      )
    ]);
    await audit(actorId, "usage.user.read", "user", userId, { from, to });
    return {
      user,
      models: models.rows.map((row) => ({
        modelConfigId: String(row.id), modelDisplayName: String(row.display_name),
        modelId: String(row.model_id), modality: row.modality,
        modelCallCount: Number(row.calls), modelSuccessCount: Number(row.succeeded),
        modelFailedCount: Number(row.failed), modelSuccessRate: successRate(row.succeeded, row.failed),
        averageDurationMs: nullableNumber(row.average_duration),
        inputTokens: nullableNumber(row.i), outputTokens: nullableNumber(row.o),
        totalTokens: nullableNumber(row.t), unavailableTokenCallCount: Number(row.unavailable)
      })),
      recentGenerations: generations.rows.map((row) => ({
        generationId: String(row.generation_id), generationType: String(row.generation_type),
        status: String(row.status), modelCallCount: Number(row.model_call_count),
        startedAt: date(row.started_at), completedAt: date(row.completed_at)
      }))
    };
  },

  async usageModelDetail(actorId: string, modelConfigId: string, from: string, to: string) {
    const dashboard = await this.usageDashboard(from, to);
    const model = dashboard.models.find((item) => item.modelConfigId === modelConfigId);
    if (!model) throw new Error("USAGE_MODEL_NOT_FOUND");
    const result = await pool.query(
      `select u.id,u.username,u.display_name,count(l.id)::integer calls,
       count(l.id) filter(where l.status='succeeded')::integer succeeded,
       count(l.id) filter(where l.status='failed')::integer failed,
       avg(l.duration_ms) filter(where l.completed_at is not null) average_duration,
       case when count(l.id) filter(where l.tokens_available)>0 then sum(l.input_tokens)::integer end i,
       case when count(l.id) filter(where l.tokens_available)>0 then sum(l.output_tokens)::integer end o,
       case when count(l.id) filter(where l.tokens_available)>0 then sum(l.total_tokens)::integer end t,
       count(l.id) filter(where not l.tokens_available)::integer unavailable
       from model_usage_logs l join users u on u.id=l.user_id
       where l.model_config_id=$1 and l.started_at between $2 and $3
       group by u.id,u.username,u.display_name order by calls desc`,
      [modelConfigId, `${from}T00:00:00.000+08:00`, `${to}T23:59:59.999+08:00`]
    );
    await audit(actorId, "usage.model.read", "model_config", modelConfigId, { from, to });
    return {
      model,
      users: result.rows.map((row) => ({
        userId: String(row.id), username: String(row.username), displayName: String(row.display_name),
        modelCallCount: Number(row.calls), modelSuccessCount: Number(row.succeeded),
        modelFailedCount: Number(row.failed), modelSuccessRate: successRate(row.succeeded, row.failed),
        averageDurationMs: nullableNumber(row.average_duration),
        inputTokens: nullableNumber(row.i), outputTokens: nullableNumber(row.o),
        totalTokens: nullableNumber(row.t), unavailableTokenCallCount: Number(row.unavailable)
      }))
    };
  }
};
