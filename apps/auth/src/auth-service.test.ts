import { describe, expect, it } from "vitest";
import { assertPasswordPolicy, AuthService } from "./auth-service";
import { loadAuthConfig } from "./config";
import { createTokenSigner } from "./tokens";
import { signAccessToken } from "./tokens";
import type { AuthRepository, LoginIdentity } from "./repository";

function fakeRepository(): AuthRepository {
  const state = {
    seeded: false,
    bootstrapped: false
  };

  return {
    async seedSystemRoles() {
      state.seeded = true;
    },
    async hasAnyMembership() {
      return state.bootstrapped;
    },
    async bootstrapAdmin(input: { account: string; passwordHash: string }) {
      state.bootstrapped = Boolean(input.account && input.passwordHash.startsWith("argon2id"));
    }
  } as AuthRepository;
}

describe("AuthService bootstrap", () => {
  it("creates the default admin with a hashed password", async () => {
    const config = {
      ...loadAuthConfig(),
      bootstrapAdminAccount: "admin"
    };
    const repository = fakeRepository();
    const service = new AuthService(repository, config, createTokenSigner());

    await expect(service.bootstrapAdmin("local-password-123")).resolves.toBe(true);
  });
});

describe("AuthService refresh", () => {
  it("rotates the refresh token and returns a new access token", async () => {
    const identity: LoginIdentity = {
      user: {
        id: "user_admin",
        account: "admin",
        displayName: "管理员",
        status: "active",
        mustChangePassword: false,
        passwordHash: "unused"
      },
      tenant: {
        id: "tenant_default",
        name: "默认团队",
        status: "active"
      },
      membership: {
        id: "membership_admin",
        tenantId: "tenant_default",
        role: "owner",
        status: "active",
        permissionVersion: 1,
        permissions: ["admin.dashboard.read"]
      }
    };
    let rotatedFrom: string | null = null;
    let revoked: string | null = null;
    const repository = {
      async rotateRefreshToken(input: { currentRefreshToken: string; nextRefreshToken: string }) {
        rotatedFrom = input.currentRefreshToken;
        expect(input.nextRefreshToken).not.toBe(input.currentRefreshToken);
        return identity;
      },
      async revokeRefreshToken(refreshToken: string) {
        revoked = refreshToken;
      }
    } as AuthRepository;
    const config = {
      ...loadAuthConfig(),
      accessTokenTtlSeconds: 60
    };
    const service = new AuthService(repository, config, createTokenSigner());

    const refreshed = await service.refresh("refresh-old");
    await service.logout(refreshed.refreshToken);

    expect(rotatedFrom).toBe("refresh-old");
    expect(refreshed.accessToken.split(".")).toHaveLength(3);
    expect(refreshed.expiresIn).toBe(60);
    expect(revoked).toBe(refreshed.refreshToken);
  });
});

describe("AuthService session validation", () => {
  it("rejects an access token as soon as its session is revoked", async () => {
    const config = loadAuthConfig();
    const signer = createTokenSigner();
    const repository = {
      async isSessionActive() {
        return false;
      }
    } as AuthRepository;
    const service = new AuthService(repository, config, signer);
    const token = signAccessToken({
      signer,
      issuer: config.issuer,
      audience: config.audience,
      ttlSeconds: 60,
      context: {
        userId: "user_disabled",
        username: "disabled_user",
        displayName: "已禁用用户",
        role: "user",
        status: "active",
        mustChangePassword: false,
        sessionId: "session_revoked"
      }
    });

    await expect(service.me(token)).rejects.toThrow("AUTH_SESSION_EXPIRED");
    await expect(service.validateSession(token)).rejects.toThrow("AUTH_SESSION_EXPIRED");
  });
});

describe("password policy", () => {
  it.each([
    "Abcdefg12",
    "abcdefg1!",
    "ABCDEFG1!",
    "Abcdefgh!"
  ])("accepts at least nine characters from three character classes: %s", (password) => {
    expect(() => assertPasswordPolicy(password, "some_user")).not.toThrow();
  });

  it.each([
    "12345678",
    "abcdefgh1",
    "ABCDEFGH1",
    "Ab1!",
    "some_user"
  ])("rejects a weak or account-derived password: %s", (password) => {
    expect(() => assertPasswordPolicy(password, "some_user")).toThrow("AUTH_PASSWORD_POLICY_VIOLATION");
  });
});
