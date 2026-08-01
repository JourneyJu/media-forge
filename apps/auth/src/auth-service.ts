import type {
  AdminUser,
  AdminUserListQuery,
  AdminUserListResponse,
  AuthContext,
  CreateAdminUserRequest,
  LoginResponse,
  MeResponse,
  RefreshResponse,
  UpdateAdminUserRequest
} from "@mediaforge/contracts";
import type { AuthConfig } from "./config";
import type { AuthRepository, LoginIdentity } from "./repository";
import type { TokenSigner } from "./tokens";
import { hashPassword, verifyPassword } from "./password";
import { createRefreshToken, createSessionSecret, signAccessToken, verifyAccessToken } from "./tokens";

const temporaryPassword = "12345678";

function toMeResponse(identity: LoginIdentity): MeResponse {
  const { passwordHash: _passwordHash, failedLoginCount: _failures, lockedUntil: _lockedUntil, ...user } = identity.user;
  return { user };
}

export function assertPasswordPolicy(password: string, username: string): void {
  const classes = [
    /[a-z]/u.test(password),
    /[A-Z]/u.test(password),
    /\d/u.test(password),
    /[^A-Za-z0-9]/u.test(password)
  ].filter(Boolean).length;
  if (
    password.length < 9
    || classes < 3
    || password === temporaryPassword
    || password.toLowerCase() === username.toLowerCase()
  ) {
    throw new Error("AUTH_PASSWORD_POLICY_VIOLATION");
  }
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly config: AuthConfig,
    private readonly signer: TokenSigner
  ) {}

  async bootstrapAdmin(password: string): Promise<boolean> {
    await this.repository.seedSystemRoles();
    if (await this.repository.hasAnyMembership()) return false;
    await this.repository.bootstrapAdmin({
      account: this.config.bootstrapAdminAccount,
      passwordHash: await hashPassword(password)
    });
    return true;
  }

  async login(username: string, password: string): Promise<LoginResponse & { refreshToken: string }> {
    const identity = await this.repository.findLoginIdentity(username);
    if (!identity) throw new Error("AUTH_INVALID_CREDENTIALS");
    if (identity.user.status !== "active") throw new Error("USER_DISABLED");
    if (identity.user.lockedUntil && identity.user.lockedUntil.getTime() > Date.now()) {
      throw new Error("AUTH_LOGIN_LOCKED");
    }
    if (!(await verifyPassword(password, identity.user.passwordHash))) {
      await this.repository.recordLoginFailure(identity.user.id);
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    await this.repository.recordLoginSuccess(identity.user.id);
    const refreshToken = createRefreshToken();
    const sessionId = await this.repository.createSession({
      userId: identity.user.id,
      sessionSecret: createSessionSecret(),
      refreshToken,
      refreshTokenFamilyId: createRefreshToken(),
      refreshTokenExpiresAt: new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
    });
    return {
      ...toMeResponse(identity),
      accessToken: this.accessToken(identity, sessionId),
      expiresIn: this.config.accessTokenTtlSeconds,
      refreshToken
    };
  }

  async me(token: string): Promise<MeResponse> {
    const payload = this.verify(token);
    if (!await this.repository.isSessionActive(payload.session_id, payload.sub)) {
      throw new Error("AUTH_SESSION_EXPIRED");
    }
    const identity = await this.repository.findLoginIdentityByUserId(payload.sub);
    if (!identity || identity.user.status !== "active") throw new Error("UNAUTHORIZED");
    return toMeResponse(identity);
  }

  async validateSession(token: string): Promise<AuthContext> {
    const payload = this.verify(token);
    if (!payload.session_id || !await this.repository.isSessionActive(payload.session_id, payload.sub)) {
      throw new Error("AUTH_SESSION_EXPIRED");
    }
    const identity = await this.repository.findLoginIdentityByUserId(payload.sub);
    if (!identity || identity.user.status !== "active") throw new Error("USER_DISABLED");
    return {
      userId: identity.user.id,
      role: identity.user.role,
      sessionId: payload.session_id,
      mustChangePassword: identity.user.mustChangePassword
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponse & { refreshToken: string }> {
    const nextRefreshToken = createRefreshToken();
    const identity = await this.repository.rotateRefreshToken({
      currentRefreshToken: refreshToken,
      nextRefreshToken,
      nextRefreshTokenExpiresAt: new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
    });
    if (!identity) throw new Error("UNAUTHORIZED");
    if (identity.user.status !== "active") throw new Error("USER_DISABLED");
    return {
      accessToken: this.accessToken(identity, identity.sessionId),
      expiresIn: this.config.accessTokenTtlSeconds,
      refreshToken: nextRefreshToken
    };
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken) await this.repository.revokeRefreshToken(refreshToken);
  }

  async changePassword(token: string, currentPassword: string, nextPassword: string): Promise<MeResponse> {
    const payload = this.verify(token);
    const identity = await this.repository.findLoginIdentityByUserId(payload.sub);
    if (!identity || !(await verifyPassword(currentPassword, identity.user.passwordHash))) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }
    assertPasswordPolicy(nextPassword, identity.user.username);
    await this.repository.updatePassword(identity.user.id, await hashPassword(nextPassword));
    const updated = await this.repository.findLoginIdentityByUserId(payload.sub);
    if (!updated) throw new Error("UNAUTHORIZED");
    return toMeResponse(updated);
  }

  async listUsers(token: string, query: AdminUserListQuery): Promise<AdminUserListResponse> {
    await this.requireAdmin(token);
    const result = await this.repository.listUsers(query);
    return { ...result, page: query.page, pageSize: query.pageSize };
  }

  async getUser(token: string, userId: string): Promise<AdminUser> {
    await this.requireAdmin(token);
    const user = await this.repository.getAdminUser(userId);
    if (!user) throw new Error("NOT_FOUND");
    return user;
  }

  async createUser(token: string, input: CreateAdminUserRequest): Promise<AdminUser> {
    const actor = await this.requireAdmin(token);
    return this.repository.createUser({
      actorUserId: actor.user.id,
      ...input,
      passwordHash: await hashPassword(temporaryPassword)
    });
  }

  async updateUser(token: string, userId: string, input: UpdateAdminUserRequest): Promise<AdminUser> {
    const actor = await this.requireAdmin(token);
    return this.repository.updateUser(actor.user.id, userId, input);
  }

  async resetUserPassword(token: string, userId: string): Promise<{ temporaryPassword: string }> {
    const actor = await this.requireAdmin(token);
    await this.repository.resetPassword(actor.user.id, userId, await hashPassword(temporaryPassword));
    return { temporaryPassword };
  }

  private verify(token: string) {
    return verifyAccessToken({
      token,
      signer: this.signer,
      issuer: this.config.issuer,
      audience: this.config.audience
    });
  }

  private async requireAdmin(token: string): Promise<LoginIdentity> {
    const payload = this.verify(token);
    const identity = await this.repository.findLoginIdentityByUserId(payload.sub);
    if (!identity || identity.user.status !== "active") throw new Error("UNAUTHORIZED");
    if (identity.user.role !== "admin") throw new Error("PERMISSION_REQUIRED");
    return identity;
  }

  private accessToken(identity: LoginIdentity, sessionId: string): string {
    const context: AuthContext = {
      userId: identity.user.id,
      role: identity.user.role,
      sessionId,
      mustChangePassword: identity.user.mustChangePassword
    };
    return signAccessToken({
      signer: this.signer,
      issuer: this.config.issuer,
      audience: this.config.audience,
      context,
      ttlSeconds: this.config.accessTokenTtlSeconds
    });
  }
}
