import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AdminUser,
  AdminUserListQuery,
  AuthRole,
  AuthUser,
  UpdateAdminUserRequest
} from "@mediaforge/contracts";
import { hashSecret } from "./password";

export type UserRecord = AuthUser & {
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

export type LoginIdentity = {
  user: UserRecord;
};

export type RefreshIdentity = LoginIdentity & {
  sessionId: string;
};

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "disabled" ? "disabled" : "active",
    mustChangePassword: Boolean(row.must_change_password),
    passwordHash: String(row.password_hash),
    failedLoginCount: Number(row.failed_login_count ?? 0),
    lockedUntil: row.locked_until ? new Date(String(row.locked_until)) : null
  };
}

function mapAdminUser(row: Record<string, unknown>): AdminUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "disabled" ? "disabled" : "active",
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null
  };
}

export class AuthRepository {
  constructor(private readonly pool: Pool) {}

  async seedSystemRoles(): Promise<void> {
    // Legacy RBAC tables remain read-only during the compatibility window.
  }

  async hasAnyMembership(): Promise<boolean> {
    const result = await this.pool.query("select 1 from users limit 1");
    return Boolean(result.rowCount);
  }

  async bootstrapAdmin(input: { account: string; passwordHash: string }): Promise<void> {
    await this.pool.query(
      `insert into users
        (id, account, username, username_normalized, display_name, role, status,
         password_hash, password_hash_algorithm, password_hash_params, must_change_password)
       values ($1, $2, $2, lower($2), $3, 'admin', 'active', $4, 'argon2id', '{"version":1}'::jsonb, true)
       on conflict (account) do nothing`,
      ["user_admin", input.account, "管理员", input.passwordHash]
    );
  }

  async findLoginIdentity(username: string): Promise<LoginIdentity | null> {
    const result = await this.pool.query(
      `select *
       from users
       where username_normalized = lower($1)
       limit 1`,
      [username]
    );
    return result.rows[0] ? { user: mapUser(result.rows[0] as Record<string, unknown>) } : null;
  }

  async findLoginIdentityByUserId(userId: string): Promise<LoginIdentity | null> {
    const result = await this.pool.query("select * from users where id = $1", [userId]);
    return result.rows[0] ? { user: mapUser(result.rows[0] as Record<string, unknown>) } : null;
  }

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
       from auth_sessions s
       join users u on u.id = s.user_id
       where s.id = $1
         and s.user_id = $2
         and s.revoked_at is null
         and s.expires_at > now()
         and u.status = 'active'
       limit 1`,
      [sessionId, userId]
    );
    return Boolean(result.rowCount);
  }

  async recordLoginFailure(userId: string): Promise<void> {
    await this.pool.query(
      `update users
       set failed_login_count = failed_login_count + 1,
           locked_until = case when failed_login_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
           updated_at = now()
       where id = $1`,
      [userId]
    );
  }

  async recordLoginSuccess(userId: string): Promise<void> {
    await this.pool.query(
      `update users
       set failed_login_count = 0, locked_until = null, last_login_at = now(), updated_at = now()
       where id = $1`,
      [userId]
    );
  }

  async createSession(input: {
    userId: string;
    sessionSecret: string;
    refreshToken: string;
    refreshTokenFamilyId: string;
    refreshTokenExpiresAt: Date;
  }): Promise<string> {
    const sessionId = `session_${randomUUID()}`;
    await this.pool.query(
      `insert into auth_sessions (id, user_id, tenant_id, session_hash, expires_at)
       values ($1, $2, null, $3, $4)`,
      [sessionId, input.userId, hashSecret(input.sessionSecret), input.refreshTokenExpiresAt]
    );
    await this.pool.query(
      `insert into oauth_refresh_tokens
        (id, client_id, user_id, tenant_id, session_id, token_hash, family_id, expires_at)
       values ($1, 'mediaforge-web', $2, null, $3, $4, $5, $6)`,
      [
        `refresh_${randomUUID()}`,
        input.userId,
        sessionId,
        hashSecret(input.refreshToken),
        input.refreshTokenFamilyId,
        input.refreshTokenExpiresAt
      ]
    );
    return sessionId;
  }

  async rotateRefreshToken(input: {
    currentRefreshToken: string;
    nextRefreshToken: string;
    nextRefreshTokenExpiresAt: Date;
  }): Promise<RefreshIdentity | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{
        id: string;
        user_id: string;
        session_id: string;
        family_id: string;
        status: string;
        expires_at: Date;
      }>(
        `select rt.id, rt.user_id, rt.session_id, rt.family_id, rt.status, rt.expires_at
         from oauth_refresh_tokens rt
         join auth_sessions s on s.id = rt.session_id
         where rt.token_hash = $1 and s.revoked_at is null
         for update of rt`,
        [hashSecret(input.currentRefreshToken)]
      );
      const token = result.rows[0];
      if (!token) throw new Error("AUTH_SESSION_EXPIRED");
      if (token.status !== "active") {
        await client.query(
          "update oauth_refresh_tokens set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where family_id = $1 and status = 'active'",
          [token.family_id]
        );
        await client.query("commit");
        throw new Error("AUTH_REFRESH_TOKEN_REUSED");
      }
      if (new Date(token.expires_at).getTime() <= Date.now()) throw new Error("AUTH_SESSION_EXPIRED");

      await client.query("update oauth_refresh_tokens set status = 'rotated', rotated_at = now() where id = $1", [token.id]);
      await client.query(
        `insert into oauth_refresh_tokens
          (id, client_id, user_id, tenant_id, session_id, token_hash, family_id, expires_at)
         values ($1, 'mediaforge-web', $2, null, $3, $4, $5, $6)`,
        [
          `refresh_${randomUUID()}`,
          token.user_id,
          token.session_id,
          hashSecret(input.nextRefreshToken),
          token.family_id,
          input.nextRefreshTokenExpiresAt
        ]
      );
      await client.query("commit");
      const identity = await this.findLoginIdentityByUserId(token.user_id);
      return identity ? { ...identity, sessionId: token.session_id } : null;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Surface the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.pool.query(
      `with revoked as (
         update oauth_refresh_tokens
         set status = 'revoked', revoked_at = coalesce(revoked_at, now())
         where token_hash = $1 and status = 'active'
         returning session_id
       )
       update auth_sessions
       set revoked_at = coalesce(revoked_at, now())
       where id in (select session_id from revoked where session_id is not null)`,
      [hashSecret(refreshToken)]
    );
  }

  async revokeUserSessions(userId: string, client: Pool | PoolClient = this.pool): Promise<void> {
    await client.query(
      "update auth_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and revoked_at is null",
      [userId]
    );
    await client.query(
      "update oauth_refresh_tokens set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where user_id = $1 and status = 'active'",
      [userId]
    );
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `update users
       set password_hash = $2, password_hash_algorithm = 'argon2id',
           password_hash_params = '{"version":1}'::jsonb,
           must_change_password = false, password_updated_at = now(), updated_at = now()
       where id = $1`,
      [userId, passwordHash]
    );
  }

  async listUsers(query: AdminUserListQuery): Promise<{ items: AdminUser[]; total: number }> {
    const search = `%${query.search.toLowerCase()}%`;
    const values: unknown[] = [search, query.pageSize, (query.page - 1) * query.pageSize];
    const statusClause = query.status ? "and status = $4" : "";
    if (query.status) values.push(query.status);
    const [items, total] = await Promise.all([
      this.pool.query(
        `select * from users
         where (username_normalized like $1 or lower(display_name) like $1) ${statusClause}
         order by created_at desc limit $2 offset $3`,
        values
      ),
      this.pool.query<{ count: string }>(
        `select count(*)::text as count from users
         where (username_normalized like $1 or lower(display_name) like $1) ${statusClause}`,
        query.status ? [search, query.pageSize, 0, query.status] : [search]
      )
    ]);
    return {
      items: items.rows.map((row) => mapAdminUser(row as Record<string, unknown>)),
      total: Number(total.rows[0]?.count ?? 0)
    };
  }

  async getAdminUser(userId: string): Promise<AdminUser | null> {
    const result = await this.pool.query("select * from users where id = $1", [userId]);
    return result.rows[0] ? mapAdminUser(result.rows[0] as Record<string, unknown>) : null;
  }

  async createUser(input: {
    actorUserId: string;
    username: string;
    displayName: string;
    role: AuthRole;
    passwordHash: string;
  }): Promise<AdminUser> {
    const id = `user_${randomUUID()}`;
    try {
      const result = await this.pool.query(
        `insert into users
          (id, account, username, username_normalized, display_name, role, status,
           password_hash, password_hash_algorithm, password_hash_params, must_change_password)
         values ($1, $2, $2, lower($2), $3, $4, 'active', $5, 'argon2id', '{"version":1}'::jsonb, true)
         returning *`,
        [id, input.username, input.displayName, input.role, input.passwordHash]
      );
      await this.audit(input.actorUserId, "user.create", id, { role: input.role });
      return mapAdminUser(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("USERNAME_CONFLICT");
      throw error;
    }
  }

  async updateUser(actorUserId: string, userId: string, input: UpdateAdminUserRequest): Promise<AdminUser> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query("select * from users where id = $1 for update", [userId]);
      const currentRow = currentResult.rows[0] as Record<string, unknown> | undefined;
      if (!currentRow) throw new Error("NOT_FOUND");
      const current = mapUser(currentRow);
      if (actorUserId === userId && (input.status === "disabled" || input.role === "user")) {
        throw new Error("SELF_ADMIN_CHANGE_FORBIDDEN");
      }
      const removesAdmin = current.role === "admin" && current.status === "active"
        && (input.role === "user" || input.status === "disabled");
      if (removesAdmin) await this.assertAnotherAdmin(client, userId);

      const result = await client.query(
        `update users
         set display_name = coalesce($2, display_name),
             role = coalesce($3, role),
             status = coalesce($4, status),
             updated_at = now()
         where id = $1 returning *`,
        [userId, input.displayName ?? null, input.role ?? null, input.status ?? null]
      );
      if (input.status === "disabled") await this.revokeUserSessions(userId, client);
      await this.audit(actorUserId, "user.update", userId, input, client);
      await client.query("commit");
      return mapAdminUser(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetPassword(actorUserId: string, userId: string, passwordHash: string): Promise<void> {
    const result = await this.pool.query(
      `update users
       set password_hash = $2, must_change_password = true, password_updated_at = now(), updated_at = now()
       where id = $1`,
      [userId, passwordHash]
    );
    if (!result.rowCount) throw new Error("NOT_FOUND");
    await this.revokeUserSessions(userId);
    await this.audit(actorUserId, "user.reset_password", userId, {});
  }

  private async assertAnotherAdmin(client: PoolClient, userId: string): Promise<void> {
    const result = await client.query(
      `select id from users
       where role = 'admin' and status = 'active' and id <> $1
       limit 1 for update`,
      [userId]
    );
    if (!result.rowCount) throw new Error("LAST_ADMIN_REQUIRED");
  }

  private async audit(
    actorUserId: string,
    action: string,
    targetId: string,
    metadata: unknown,
    client: Pool | PoolClient = this.pool
  ): Promise<void> {
    await client.query(
      `insert into audit_events
        (id, tenant_id, actor_user_id, action, target_type, target_id, metadata_json)
       values ($1, null, $2, $3, 'user', $4, $5::jsonb)`,
      [`audit_${randomUUID()}`, actorUserId, action, targetId, JSON.stringify(metadata)]
    );
  }
}
