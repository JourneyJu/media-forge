import { z } from "zod";

export const authRoleSchema = z.enum(["admin", "user"]);
export const userStatusSchema = z.enum(["active", "disabled"]);

export const encryptedPasswordSchema = z.object({
  alg: z.literal("RSA-OAEP-256"),
  kid: z.string().trim().min(1).max(128),
  ciphertext: z.string().trim().min(1).max(1024)
});

export const usernameSchema = z.string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/u);

export const displayNameSchema = z.string().trim().min(1).max(32);

export const loginRequestSchema = z.object({
  username: usernameSchema.optional(),
  account: usernameSchema.optional(),
  password: encryptedPasswordSchema
}).refine((value) => Boolean(value.username ?? value.account), {
  message: "username is required",
  path: ["username"]
});

export const changePasswordRequestSchema = z.object({
  currentPassword: encryptedPasswordSchema,
  nextPassword: encryptedPasswordSchema
});

export const passwordEncryptionKeyResponseSchema = z.object({
  kid: z.string().trim().min(1),
  alg: z.literal("RSA-OAEP-256"),
  publicKey: z.object({
    kty: z.literal("RSA"),
    n: z.string().trim().min(1),
    e: z.string().trim().min(1),
    kid: z.string().trim().min(1),
    alg: z.literal("RSA-OAEP-256"),
    key_ops: z.array(z.literal("encrypt")),
    ext: z.literal(true)
  })
});

export const authUserSchema = z.object({
  id: z.string().trim().min(1),
  username: usernameSchema,
  displayName: displayNameSchema,
  role: authRoleSchema,
  status: userStatusSchema,
  mustChangePassword: z.boolean()
});

export const authContextSchema = z.object({
  userId: z.string().trim().min(1),
  role: authRoleSchema,
  sessionId: z.string().trim().min(1),
  mustChangePassword: z.boolean()
});

export const loginResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().trim().min(1),
  expiresIn: z.number().int().positive()
});

export const refreshResponseSchema = z.object({
  accessToken: z.string().trim().min(1),
  expiresIn: z.number().int().positive()
});

export const meResponseSchema = z.object({
  user: authUserSchema
});

export const authErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_PASSWORD_CHANGE_REQUIRED",
  "AUTH_PASSWORD_KEY_INVALID",
  "AUTH_PASSWORD_POLICY_VIOLATION",
  "AUTH_LOGIN_LOCKED",
  "AUTH_SESSION_EXPIRED",
  "AUTH_REFRESH_TOKEN_REUSED",
  "PERMISSION_REQUIRED",
  "USER_DISABLED",
  "USERNAME_CONFLICT",
  "LAST_ADMIN_REQUIRED",
  "SELF_ADMIN_CHANGE_FORBIDDEN",
  "INTERNAL_ERROR",
  "NOT_FOUND"
]);

export type AuthRole = z.infer<typeof authRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type EncryptedPassword = z.infer<typeof encryptedPasswordSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type PasswordEncryptionKeyResponse = z.infer<typeof passwordEncryptionKeyResponseSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthContext = z.infer<typeof authContextSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
