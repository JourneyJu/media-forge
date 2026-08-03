import { createHash, randomUUID } from "node:crypto";
import type {
  ImportUserSkillRequest,
  ImportUserSkillResponse,
  InstallUserSkillRequest,
  ListUserSkillsResponse,
  ResolvedUserSkill,
  UserSkillAsset,
  UserSkillDetail,
  UserSkillManifest,
  UserSkillMention,
  UserSkillSummary
} from "@mediaforge/contracts";
import { resolvedUserSkillSchema, userSkillManifestSchema } from "@mediaforge/contracts";
import { Pool } from "pg";
import { createObjectStore, type ObjectStore } from "../assets/object-store";

const maxSkillAssetBytes = 5 * 1024 * 1024;
const allowedImageSignatures: Record<string, (prefix: Uint8Array) => boolean> = {
  "image/jpeg": (prefix) => prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff,
  "image/png": (prefix) => prefix.slice(0, 8).every((value, index) =>
    value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]),
  "image/gif": (prefix) => String.fromCharCode(...prefix.slice(0, 6)) === "GIF87a"
    || String.fromCharCode(...prefix.slice(0, 6)) === "GIF89a",
  "image/webp": (prefix) =>
    String.fromCharCode(...prefix.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP"
};

interface SkillRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  category: UserSkillManifest["category"];
  status: UserSkillSummary["status"];
  current_version_id: string;
  created_at: Date;
  updated_at: Date;
  alias: string | null;
  installed_version_id: string | null;
  install_status: string | null;
}

interface VersionRow {
  id: string;
  skill_id: string;
  version: string;
  manifest_json: unknown;
  validation_result_json: Record<string, unknown>;
  created_at: Date;
}

interface AssetRow {
  id: string;
  skill_id: string;
  skill_version_id: string;
  asset_key: string;
  type: UserSkillAsset["type"];
  usage: string;
  original_name: string | null;
  content_type: string | null;
  size_bytes: string | number | null;
  object_key: string | null;
  preview_object_key: string | null;
  status: UserSkillAsset["status"];
  created_at: Date;
}

function toSummary(row: SkillRow): UserSkillSummary {
  const installed = row.install_status === "active";
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    currentVersionId: row.current_version_id,
    ...(row.alias ? { alias: row.alias } : {}),
    installed,
    ...(row.installed_version_id ? { installedVersionId: row.installed_version_id } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toAsset(row: AssetRow): UserSkillAsset {
  return {
    id: row.id,
    skillId: row.skill_id,
    versionId: row.skill_version_id,
    assetKey: row.asset_key,
    type: row.type,
    usage: row.usage,
    ...(row.original_name ? { originalName: row.original_name } : {}),
    ...(row.content_type ? { contentType: row.content_type } : {}),
    ...(row.size_bytes !== null && row.size_bytes !== undefined ? { sizeBytes: Number(row.size_bytes) } : {}),
    ...(row.object_key ? { previewUrl: `/user-skills/assets/${row.id}/preview` } : {}),
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function scanManifest(manifest: UserSkillManifest): Record<string, unknown> {
  const serialized = JSON.stringify(manifest);
  const forbidden = [
    /api[_-]?key/i,
    /secret/i,
    /token/i,
    /cookie/i,
    /password/i,
    /忽略.*系统/u,
    /绕过.*规则/u,
    /system prompt/i
  ];
  const hits = forbidden.flatMap((pattern) => pattern.test(serialized) ? [String(pattern)] : []);
  if (hits.length > 0) {
    throw new Error("USER_SKILL_IMPORT_INVALID");
  }
  return {
    passed: true,
    checks: ["schema", "secret_keywords", "instruction_boundary"],
    checkedAt: new Date().toISOString()
  };
}

async function* validateAndHashBody(
  body: AsyncIterable<Uint8Array>,
  contentType: string,
  declaredLength: number,
  onHash: (sha256: string) => void
): AsyncGenerator<Uint8Array> {
  if (!allowedImageSignatures[contentType]) throw new Error("USER_SKILL_ASSET_INVALID");
  if (!Number.isInteger(declaredLength) || declaredLength < 1 || declaredLength > maxSkillAssetBytes) {
    throw new Error("USER_SKILL_ASSET_INVALID");
  }
  const hash = createHash("sha256");
  let received = 0;
  let checked = false;
  const pending: Uint8Array[] = [];
  let pendingLength = 0;
  for await (const rawChunk of body) {
    const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    received += chunk.byteLength;
    if (received > declaredLength || received > maxSkillAssetBytes) throw new Error("USER_SKILL_ASSET_INVALID");
    if (!checked) {
      pending.push(chunk);
      pendingLength += chunk.byteLength;
      if (pendingLength < 16) continue;
      const prefix = Buffer.concat(pending.map((item) => Buffer.from(item)), pendingLength);
      if (!allowedImageSignatures[contentType]?.(prefix.slice(0, 16))) throw new Error("USER_SKILL_ASSET_INVALID");
      checked = true;
      for (const pendingChunk of pending) {
        hash.update(pendingChunk);
        yield pendingChunk;
      }
      continue;
    }
    hash.update(chunk);
    yield chunk;
  }
  if (!checked || received !== declaredLength) throw new Error("USER_SKILL_ASSET_INVALID");
  onHash(hash.digest("hex"));
}

export function createUserSkillService(
  databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge",
  objectStore: ObjectStore = createObjectStore()
) {
  const pool = new Pool({ connectionString: databaseUrl });

  async function getSkillRow(ownerId: string, skillId: string): Promise<SkillRow> {
    const result = await pool.query<SkillRow>(
      `select s.*, i.alias, i.skill_version_id as installed_version_id, i.status as install_status
       from user_skills s
       left join user_installed_skills i on i.skill_id = s.id and i.user_id = $1
       where s.id = $2 and s.owner_user_id = $1`,
      [ownerId, skillId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("USER_SKILL_NOT_FOUND");
    return row;
  }

  async function getVersion(skillId: string, versionId: string): Promise<VersionRow> {
    const result = await pool.query<VersionRow>(
      "select * from user_skill_versions where id = $1 and skill_id = $2",
      [versionId, skillId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("USER_SKILL_VERSION_CONFLICT");
    return row;
  }

  async function getAssets(skillId: string, versionId: string): Promise<AssetRow[]> {
    const result = await pool.query<AssetRow>(
      `select * from user_skill_assets
       where skill_id = $1 and skill_version_id = $2 and status <> 'deleted'
       order by created_at, asset_key`,
      [skillId, versionId]
    );
    return result.rows;
  }

  async function toDetail(ownerId: string, skillId: string): Promise<UserSkillDetail> {
    const skill = await getSkillRow(ownerId, skillId);
    const version = await getVersion(skill.id, skill.current_version_id);
    return {
      ...toSummary(skill),
      manifest: userSkillManifestSchema.parse(version.manifest_json),
      validationResult: version.validation_result_json,
      assets: (await getAssets(skill.id, version.id)).map(toAsset)
    };
  }

  return {
    async close(): Promise<void> {
      objectStore.destroy();
      await pool.end();
    },

    async list(ownerId: string): Promise<ListUserSkillsResponse> {
      const result = await pool.query<SkillRow>(
        `select s.*, i.alias, i.skill_version_id as installed_version_id, i.status as install_status
         from user_skills s
         left join user_installed_skills i on i.skill_id = s.id and i.user_id = $1
         where s.owner_user_id = $1 and s.status <> 'rejected'
         order by s.updated_at desc, s.id desc`,
        [ownerId]
      );
      return { items: result.rows.map(toSummary) };
    },

    async importManifest(ownerId: string, input: ImportUserSkillRequest): Promise<ImportUserSkillResponse> {
      const existing = await pool.query<{ id: string }>(
        "select id from user_skills where owner_user_id = $1 and idempotency_key = $2",
        [ownerId, input.idempotencyKey]
      );
      if (existing.rows[0]) return { skill: await toDetail(ownerId, existing.rows[0].id) };

      const manifest = userSkillManifestSchema.parse(input.manifest);
      const validation = scanManifest(manifest);
      const skillId = randomUUID();
      const versionId = randomUUID();
      const now = new Date().toISOString();

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `insert into user_skills
            (id, owner_user_id, name, description, category, status, current_version_id, idempotency_key, created_at, updated_at)
           values ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8)`,
          [skillId, ownerId, manifest.name, manifest.description, manifest.category, versionId, input.idempotencyKey, now]
        );
        await client.query(
          `insert into user_skill_versions
            (id, skill_id, version, manifest_json, validation_result_json, created_at)
           values ($1, $2, '1.0.0', $3, $4, $5)`,
          [versionId, skillId, JSON.stringify(manifest), JSON.stringify(validation), now]
        );
        for (const asset of manifest.assets) {
          await client.query(
            `insert into user_skill_assets
              (id, skill_id, skill_version_id, owner_user_id, asset_key, type, usage, status, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
            [randomUUID(), skillId, versionId, ownerId, asset.key, asset.type, asset.usage, now]
          );
        }
        await client.query(
          `insert into user_installed_skills
            (user_id, skill_id, skill_version_id, alias, status, installed_at)
           values ($1, $2, $3, $4, 'active', $5)`,
          [ownerId, skillId, versionId, manifest.name, now]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      return { skill: await toDetail(ownerId, skillId) };
    },

    async get(ownerId: string, skillId: string): Promise<UserSkillDetail> {
      return toDetail(ownerId, skillId);
    },

    async install(ownerId: string, skillId: string, input: InstallUserSkillRequest): Promise<UserSkillDetail> {
      const skill = await getSkillRow(ownerId, skillId);
      const versionId = input.versionId ?? skill.current_version_id;
      await getVersion(skill.id, versionId);
      await pool.query(
        `insert into user_installed_skills
          (user_id, skill_id, skill_version_id, alias, status, installed_at)
         values ($1, $2, $3, $4, 'active', now())
         on conflict (user_id, skill_id)
         do update set skill_version_id = excluded.skill_version_id,
           alias = excluded.alias, status = 'active', installed_at = excluded.installed_at`,
        [ownerId, skillId, versionId, input.alias ?? skill.name]
      );
      return toDetail(ownerId, skillId);
    },

    async disable(ownerId: string, skillId: string): Promise<UserSkillDetail> {
      const skill = await getSkillRow(ownerId, skillId);
      await pool.query(
        "update user_installed_skills set status = 'disabled' where user_id = $1 and skill_id = $2",
        [ownerId, skill.id]
      );
      return toDetail(ownerId, skill.id);
    },

    async uploadAsset(
      ownerId: string,
      skillId: string,
      versionId: string,
      assetKey: string,
      input: {
        originalName: string;
        contentType: string;
        contentLength: number;
        body: AsyncIterable<Uint8Array>;
      }
    ): Promise<UserSkillAsset> {
      await getSkillRow(ownerId, skillId);
      await getVersion(skillId, versionId);
      const existing = await pool.query<AssetRow>(
        `select * from user_skill_assets
         where owner_user_id = $1 and skill_id = $2 and skill_version_id = $3 and asset_key = $4`,
        [ownerId, skillId, versionId, assetKey]
      );
      const asset = existing.rows[0];
      if (!asset) throw new Error("USER_SKILL_ASSET_INVALID");

      const objectKey = `users/${ownerId}/skills/${skillId}/versions/${versionId}/assets/${asset.id}/original`;
      let sha256 = "";
      try {
        await objectStore.put(
          objectKey,
          validateAndHashBody(input.body, input.contentType, input.contentLength, (value) => {
            sha256 = value;
          }),
          input.contentType,
          input.contentLength
        );
        const result = await pool.query<AssetRow>(
          `update user_skill_assets
           set original_name = $5, content_type = $6, size_bytes = $7,
             object_key = $8, preview_object_key = $8, sha256 = $9, status = 'active'
           where owner_user_id = $1 and skill_id = $2 and skill_version_id = $3 and asset_key = $4
           returning *`,
          [ownerId, skillId, versionId, assetKey, input.originalName.slice(0, 255), input.contentType, input.contentLength, objectKey, sha256]
        );
        return toAsset(result.rows[0]!);
      } catch (error) {
        await objectStore.deleteMany([objectKey]).catch(() => undefined);
        throw error;
      }
    },

    async getAssetPreview(ownerId: string, assetId: string) {
      const result = await pool.query<AssetRow>(
        `select * from user_skill_assets
         where id = $1 and owner_user_id = $2 and status = 'active'`,
        [assetId, ownerId]
      );
      const asset = result.rows[0];
      if (!asset?.preview_object_key && !asset?.object_key) throw new Error("USER_SKILL_ASSET_INVALID");
      return objectStore.get(asset.preview_object_key ?? asset.object_key!);
    },

    async resolveMentions(ownerId: string, mentions: UserSkillMention[]): Promise<ResolvedUserSkill[]> {
      if (mentions.length === 0) return [];
      if (mentions.length > 1) throw new Error("USER_SKILL_VERSION_CONFLICT");
      const mention = mentions[0]!;
      const result = await pool.query<SkillRow>(
        `select s.*, i.alias, i.skill_version_id as installed_version_id, i.status as install_status
         from user_skills s
         join user_installed_skills i on i.skill_id = s.id and i.user_id = $1
         where s.id = $2 and s.owner_user_id = $1`,
        [ownerId, mention.skillId]
      );
      const skill = result.rows[0];
      if (!skill || skill.install_status !== "active") throw new Error("USER_SKILL_FORBIDDEN");
      if (skill.status !== "active") throw new Error("LAYOUT_SKILL_DISABLED");
      if (skill.installed_version_id !== mention.versionId) throw new Error("USER_SKILL_VERSION_CONFLICT");
      const version = await getVersion(skill.id, mention.versionId);
      const manifest = userSkillManifestSchema.parse(version.manifest_json);
      if (manifest.category !== "wechat_article_style") throw new Error("USER_SKILL_IMPORT_INVALID");
      const assets = (await getAssets(skill.id, version.id)).map((asset) => ({
        key: asset.asset_key,
        type: asset.type,
        usage: asset.usage,
        ...(asset.object_key ? { objectKey: asset.object_key } : {}),
        ...(asset.preview_object_key ? { previewObjectKey: asset.preview_object_key } : {})
      }));
      return [resolvedUserSkillSchema.parse({
        skillId: skill.id,
        versionId: version.id,
        name: skill.name,
        alias: mention.alias ?? skill.alias ?? undefined,
        manifest,
        assets
      })];
    }
  };
}

export type UserSkillService = ReturnType<typeof createUserSkillService>;
