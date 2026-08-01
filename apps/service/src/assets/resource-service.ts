import { randomUUID } from "node:crypto";
import type {
  CreateUploadSessionRequest,
  GetUploadSessionResponse,
  ResourceSummary,
  UploadSession
} from "@mediaforge/contracts";
import { Pool } from "pg";
import { createObjectStore, type ObjectContent, type ObjectStore } from "./object-store";

const maxResourceBytes = 10 * 1024 * 1024;
const allowedSignatures: Record<string, (prefix: Uint8Array) => boolean> = {
  "image/jpeg": (prefix) => prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff,
  "image/png": (prefix) => prefix.slice(0, 8).every((value, index) =>
    value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]),
  "image/gif": (prefix) => String.fromCharCode(...prefix.slice(0, 6)) === "GIF87a"
    || String.fromCharCode(...prefix.slice(0, 6)) === "GIF89a",
  "image/webp": (prefix) =>
    String.fromCharCode(...prefix.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP"
};
const signatureLengths: Record<string, number> = {
  "image/jpeg": 3,
  "image/png": 8,
  "image/gif": 6,
  "image/webp": 12
};

interface ResourceRow {
  id: string;
  upload_session_id: string | null;
  conversation_id: string | null;
  status: ResourceSummary["status"];
  source: ResourceSummary["source"];
  original_name: string;
  content_type: string;
  size_bytes: string | number;
  original_object_key: string;
  preview_object_key: string | null;
  created_at: Date;
}

interface UploadSessionRow {
  id: string;
  status: UploadSession["status"];
  expires_at: Date;
  created_at: Date;
}

function toResource(row: ResourceRow): ResourceSummary {
  return {
    id: row.id,
    uploadSessionId: row.upload_session_id,
    conversationId: row.conversation_id,
    status: row.status,
    source: row.source,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    previewUrl: `/resources/${row.id}/preview`,
    contentUrl: `/resources/${row.id}/content`,
    createdAt: row.created_at.toISOString()
  };
}

function toUploadSession(row: UploadSessionRow): UploadSession {
  return {
    id: row.id,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

async function* validateAndLimitBody(
  body: AsyncIterable<Uint8Array>,
  contentType: string,
  declaredLength: number
): AsyncGenerator<Uint8Array> {
  let received = 0;
  let checked = false;
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  for await (const rawChunk of body) {
    const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    received += chunk.byteLength;
    if (received > maxResourceBytes || received > declaredLength) {
      throw new Error("RESOURCE_TOO_LARGE");
    }
    if (!checked) {
      pending.push(chunk);
      pendingLength += chunk.byteLength;
      const requiredLength = signatureLengths[contentType] ?? 16;
      if (pendingLength < requiredLength) continue;
      const prefix = Buffer.concat(pending.map((item) => Buffer.from(item)), pendingLength);
      const validator = allowedSignatures[contentType];
      if (!validator || !validator(prefix.slice(0, 16))) {
        throw new Error("RESOURCE_SIGNATURE_INVALID");
      }
      checked = true;
      for (const pendingChunk of pending) yield pendingChunk;
      pending = [];
      pendingLength = 0;
      continue;
    }
    yield chunk;
  }
  if (!checked || received !== declaredLength) {
    throw new Error("RESOURCE_LENGTH_MISMATCH");
  }
}

export function createResourceService(
  databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge",
  objectStore: ObjectStore = createObjectStore()
) {
  const pool = new Pool({ connectionString: databaseUrl });

  async function requireSession(ownerId: string, uploadSessionId: string): Promise<UploadSessionRow> {
    const result = await pool.query<UploadSessionRow>(
      `select id, status, expires_at, created_at
       from upload_sessions where id = $1 and owner_id = $2`,
      [uploadSessionId, ownerId]
    );
    const session = result.rows[0];
    if (!session) throw new Error("UPLOAD_SESSION_NOT_FOUND");
    if (session.status !== "active" || session.expires_at.getTime() <= Date.now()) {
      throw new Error("UPLOAD_SESSION_EXPIRED");
    }
    return session;
  }

  return {
    async close(): Promise<void> {
      objectStore.destroy();
      await pool.end();
    },

    async createUploadSession(ownerId: string, input: CreateUploadSessionRequest): Promise<UploadSession> {
      const existing = await pool.query<UploadSessionRow>(
        `select id, status, expires_at, created_at
         from upload_sessions where owner_id = $1 and idempotency_key = $2`,
        [ownerId, input.idempotencyKey]
      );
      if (existing.rows[0]) return toUploadSession(existing.rows[0]);

      const id = randomUUID();
      const result = await pool.query<UploadSessionRow>(
        `insert into upload_sessions
          (id, owner_id, idempotency_key, status, expires_at, created_at)
         values ($1, $2, $3, 'active', now() + interval '24 hours', now())
         returning id, status, expires_at, created_at`,
        [id, ownerId, input.idempotencyKey]
      );
      return toUploadSession(result.rows[0]!);
    },

    async getUploadSession(ownerId: string, uploadSessionId: string): Promise<GetUploadSessionResponse> {
      const session = await requireSession(ownerId, uploadSessionId);
      const resources = await pool.query<ResourceRow>(
        `select * from resources
         where upload_session_id = $1 and owner_id = $2 and status in ('uploading', 'staged', 'failed')
         order by created_at`,
        [uploadSessionId, ownerId]
      );
      return {
        uploadSession: toUploadSession(session),
        resources: resources.rows.map(toResource)
      };
    },

    async upload(
      ownerId: string,
      uploadSessionId: string,
      input: {
        originalName: string;
        contentType: string;
        contentLength: number;
        source: "upload" | "paste";
        idempotencyKey: string;
        body: AsyncIterable<Uint8Array>;
      }
    ): Promise<ResourceSummary> {
      await requireSession(ownerId, uploadSessionId);
      if (!allowedSignatures[input.contentType]) throw new Error("RESOURCE_TYPE_UNSUPPORTED");
      if (!Number.isInteger(input.contentLength) || input.contentLength < 1 || input.contentLength > maxResourceBytes) {
        throw new Error("RESOURCE_TOO_LARGE");
      }

      const existing = await pool.query<ResourceRow>(
        `select * from resources
         where owner_id = $1 and upload_session_id = $2 and id = $3`,
        [ownerId, uploadSessionId, input.idempotencyKey]
      );
      if (existing.rows[0]) return toResource(existing.rows[0]);

      const resourceId = input.idempotencyKey;
      const tenantId = process.env.LOCAL_TENANT_ID ?? "local";
      const objectKey = `tenants/${tenantId}/users/${ownerId}/resources/${resourceId}/original`;
      await pool.query(
        `insert into resources
          (id, owner_id, upload_session_id, status, source, original_name, content_type,
           size_bytes, original_object_key, preview_object_key, created_at, updated_at)
         values ($1, $2, $3, 'uploading', $4, $5, $6, $7, $8, $8, now(), now())`,
        [
          resourceId,
          ownerId,
          uploadSessionId,
          input.source,
          input.originalName.slice(0, 255),
          input.contentType,
          input.contentLength,
          objectKey
        ]
      );

      try {
        const etag = await objectStore.put(
          objectKey,
          validateAndLimitBody(input.body, input.contentType, input.contentLength),
          input.contentType,
          input.contentLength
        );
        const result = await pool.query<ResourceRow>(
          `update resources set status = 'staged', etag = $2, updated_at = now()
           where id = $1 returning *`,
          [resourceId, etag ?? null]
        );
        return toResource(result.rows[0]!);
      } catch (error) {
        await pool.query(
          `update resources set status = 'failed', error_code = $2, updated_at = now() where id = $1`,
          [resourceId, error instanceof Error ? error.message.slice(0, 100) : "RESOURCE_UPLOAD_FAILED"]
        );
        await objectStore.deleteMany([objectKey]).catch(() => undefined);
        throw error;
      }
    },

    async removeStaged(ownerId: string, uploadSessionId: string, resourceId: string): Promise<void> {
      await requireSession(ownerId, uploadSessionId);
      const result = await pool.query<ResourceRow>(
        `update resources set status = 'deleting', updated_at = now()
         where id = $1 and owner_id = $2 and upload_session_id = $3 and status in ('staged', 'failed')
         returning *`,
        [resourceId, ownerId, uploadSessionId]
      );
      const resource = result.rows[0];
      if (!resource) {
        const attached = await pool.query(
          "select 1 from resources where id = $1 and owner_id = $2 and status = 'attached'",
          [resourceId, ownerId]
        );
        throw new Error(attached.rowCount ? "RESOURCE_ALREADY_ATTACHED" : "RESOURCE_NOT_FOUND");
      }
      await objectStore.deleteMany([
        resource.original_object_key,
        resource.preview_object_key ?? ""
      ]);
      await pool.query("delete from resources where id = $1", [resourceId]);
    },

    async getContent(ownerId: string, resourceId: string): Promise<ObjectContent & { originalName: string }> {
      const result = await pool.query<ResourceRow>(
        `select * from resources
         where id = $1 and owner_id = $2 and status in ('staged', 'attached')`,
        [resourceId, ownerId]
      );
      const resource = result.rows[0];
      if (!resource) throw new Error("RESOURCE_NOT_FOUND");
      return {
        ...(await objectStore.get(resource.original_object_key)),
        originalName: resource.original_name
      };
    },

    async getPreview(ownerId: string, resourceId: string): Promise<ObjectContent> {
      const result = await pool.query<ResourceRow>(
        `select * from resources
         where id = $1 and owner_id = $2 and status in ('staged', 'attached')`,
        [resourceId, ownerId]
      );
      const resource = result.rows[0];
      if (!resource) throw new Error("RESOURCE_NOT_FOUND");
      return objectStore.get(resource.preview_object_key ?? resource.original_object_key);
    }
  };
}

export type ResourceService = ReturnType<typeof createResourceService>;
