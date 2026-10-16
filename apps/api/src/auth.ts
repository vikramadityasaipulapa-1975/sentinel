import { createHmac, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { SignJWT, jwtVerify } from "jose";
import { dummyHash, PasswordBusy, verifyPassword } from "./passwords.js";
import { uuidPattern } from "./services.js";

export const roles = ["VIEWER", "OPERATOR", "ADMIN"] as const;
export type Role = (typeof roles)[number];
export interface User {
  id: string;
  email: string;
  role: Role;
  enabled: boolean;
  token_version: number;
  password_hash: string;
}
export interface Profile {
  id: string;
  email: string;
  role: Role;
}
export interface UserStore {
  ready(): Promise<boolean>;
  byEmail(email: string): Promise<User | null>;
  byId(id: string): Promise<User | null>;
  consumeLogin(keys: { key: string; limit: number }[]): Promise<boolean>;
}
export interface AuthService {
  ready(): Promise<boolean>;
  login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    user: Profile;
  }>;
  authenticate(header: string | undefined): Promise<Profile>;
}
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const unauthorized = () =>
  new AuthError(
    401,
    "UNAUTHORIZED",
    "Authentication required or credentials invalid",
  );
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string")
    throw new AuthError(
      422,
      "INVALID_LOGIN",
      "Invalid email or password fields",
    );
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(
      email,
    )
  )
    throw new AuthError(
      422,
      "INVALID_LOGIN",
      "Invalid email or password fields",
    );
  return email;
}
export function parseLogin(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AuthError(
      422,
      "INVALID_LOGIN",
      "Invalid email or password fields",
    );
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    typeof input.password !== "string" ||
    input.password.length < 1 ||
    input.password.length > 128 ||
    Buffer.byteLength(input.password) > 512
  )
    throw new AuthError(
      422,
      "INVALID_LOGIN",
      "Invalid email or password fields",
    );
  return { email: normalizeEmail(input.email), password: input.password };
}
export function readAuthSecret(
  env: NodeJS.ProcessEnv = process.env,
): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(env.SENTINEL_JWT_SECRET ?? ""))
    throw new Error(
      "SENTINEL_JWT_SECRET must contain 64 random hexadecimal characters",
    );
  return Buffer.from(env.SENTINEL_JWT_SECRET!, "hex");
}
export function profile(user: User): Profile {
  return { id: user.id, email: user.email, role: user.role };
}
function validUser(user: User | null): user is User {
  return (
    !!user &&
    uuidPattern.test(user.id) &&
    roles.includes(user.role) &&
    user.enabled === true &&
    Number.isInteger(user.token_version) &&
    user.token_version >= 0
  );
}
export function createAuth(store: UserStore, secret: Uint8Array): AuthService {
  if (secret.byteLength !== 32)
    throw new Error("JWT key must contain 32 bytes");
  return {
    ready: () => store.ready(),
    async login(email, password, ip) {
      const normalized = normalizeEmail(email);
      const keys = [
        { scope: `email:${normalized}`, limit: 10 },
        { scope: `ip:${ip}`, limit: 30 },
      ].map((item) => ({
        key: createHmac("sha256", secret)
          .update("login-limit:" + item.scope)
          .digest("hex"),
        limit: item.limit,
      }));
      if (!(await store.consumeLogin(keys)))
        throw new AuthError(
          429,
          "LOGIN_RATE_LIMITED",
          "Too many login attempts; retry after the 15-minute window",
        );
      const user = await store.byEmail(normalized);
      let matches: boolean;
      try {
        matches = await verifyPassword(
          password,
          user?.password_hash ?? dummyHash,
        );
      } catch (error) {
        if (error instanceof PasswordBusy)
          throw new AuthError(
            503,
            "AUTH_BUSY",
            "Authentication busy; retry shortly",
          );
        throw new AuthError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication unavailable",
        );
      }
      if (!matches || !validUser(user)) throw unauthorized();
      // Re-read after hashing: a concurrent password reset must not accept the old password.
      const current = await store.byId(user.id);
      if (!validUser(current) || current.token_version !== user.token_version)
        throw unauthorized();
      const access_token = await new SignJWT({ ver: current.token_version })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(current.id)
        .setIssuer("sentinel")
        .setAudience("sentinel-api")
        .setIssuedAt()
        .setExpirationTime("15m")
        .setJti(randomUUID())
        .sign(secret);
      return {
        access_token,
        token_type: "Bearer",
        expires_in: 900,
        user: profile(current),
      };
    },
    async authenticate(header) {
      if (
        !header ||
        header.length > 4096 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)
      )
        throw unauthorized();
      let id: string;
      let version: number;
      try {
        const { payload } = await jwtVerify(header.slice(7), secret, {
          algorithms: ["HS256"],
          issuer: "sentinel",
          audience: "sentinel-api",
          typ: "JWT",
          requiredClaims: ["sub", "iat", "exp", "jti", "ver"],
          maxTokenAge: "15m",
          clockTolerance: 5,
        });
        if (
          !payload.sub ||
          !uuidPattern.test(payload.sub) ||
          typeof payload.ver !== "number" ||
          !Number.isInteger(payload.ver) ||
          payload.ver < 0 ||
          typeof payload.iat !== "number" ||
          typeof payload.exp !== "number" ||
          payload.exp <= payload.iat ||
          payload.exp - payload.iat > 900 ||
          typeof payload.jti !== "string" ||
          !uuidPattern.test(payload.jti)
        )
          throw unauthorized();
        id = payload.sub;
        version = payload.ver;
      } catch {
        throw unauthorized();
      }
      const user = await store.byId(id);
      if (!validUser(user) || user.token_version !== version)
        throw unauthorized();
      return profile(user);
    },
  };
}
export type Permission = "READ" | "WRITE_INCIDENT" | "APPROVE_ACTION";
export function can(role: Role, permission: Permission): boolean {
  return (
    roles.includes(role) &&
    (permission === "READ" ||
      role === "ADMIN" ||
      (permission === "WRITE_INCIDENT" && role === "OPERATOR"))
  );
}
export const authenticated =
  (auth?: AuthService): RequestHandler =>
  async (request, response, next) => {
    if (!auth) throw unauthorized();
    response.locals.user = await auth.authenticate(
      request.get("authorization"),
    );
    next();
  };
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (_request, response, next) => {
    const user = response.locals.user as Profile | undefined;
    if (!user) throw unauthorized();
    if (!can(user.role, permission))
      throw new AuthError(403, "FORBIDDEN", "Permission denied");
    next();
  };
