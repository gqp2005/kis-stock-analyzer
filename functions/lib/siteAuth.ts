import type { Env } from "./types";

type SiteAuthEnv = Pick<
  Env,
  "ADMIN_TOKEN" | "SITE_AUTH_PASSWORD" | "SITE_AUTH_TEST_PASSWORD" | "SITE_AUTH_COOKIE_SECRET"
>;

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const AUTH_COOKIE_NAME = "kis_auth_session";
const encoder = new TextEncoder();
let cachedSigningKeySecret: string | null = null;
let cachedSigningKeyPromise: Promise<CryptoKey> | null = null;

const parseCookies = (request: Request): Record<string, string> => {
  const raw = request.headers.get("cookie");
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = rest.join("=");
  }
  return out;
};

const fromBase64Url = (value: string): Uint8Array | null => {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
};

const secureEquals = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
};

const getSigningKey = (secret: string): Promise<CryptoKey> => {
  if (cachedSigningKeySecret === secret && cachedSigningKeyPromise) return cachedSigningKeyPromise;
  cachedSigningKeySecret = secret;
  cachedSigningKeyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedSigningKeyPromise;
};

const trimOptional = (value: string | undefined): string => value?.trim() ?? "";

const getAuthSecret = (env: SiteAuthEnv): string =>
  trimOptional(env.SITE_AUTH_COOKIE_SECRET) ||
  trimOptional(env.ADMIN_TOKEN) ||
  trimOptional(env.SITE_AUTH_PASSWORD) ||
  trimOptional(env.SITE_AUTH_TEST_PASSWORD) ||
  "";

const verifySessionToken = async (token: string, secret: string): Promise<SessionPayload | null> => {
  try {
    const [payloadB64, signatureB64] = token.split(".");
    if (!payloadB64 || !signatureB64) return null;

    const key = await getSigningKey(secret);
    const signature = fromBase64Url(signatureB64);
    if (!signature) return null;
    const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(signature), encoder.encode(payloadB64));
    if (!valid) return null;

    const payloadBytes = fromBase64Url(payloadB64);
    if (!payloadBytes) return null;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SessionPayload>;
    if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      sub: payload.sub,
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
};

export const hasValidSiteSession = async (request: Request, env: SiteAuthEnv): Promise<boolean> => {
  const token = parseCookies(request)[AUTH_COOKIE_NAME];
  if (!token) return false;
  const secret = getAuthSecret(env);
  if (!secret) return false;
  const payload = await verifySessionToken(token, secret);
  return payload !== null;
};

export const hasValidAdminToken = (
  request: Request,
  env: SiteAuthEnv,
  explicitToken?: string | null,
): boolean => {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const url = new URL(request.url);
  const provided = (explicitToken ?? url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "").trim();
  if (!provided) return false;
  return secureEquals(provided, expected);
};

export const hasAdminOrSessionAccess = async (
  request: Request,
  env: SiteAuthEnv,
  explicitToken?: string | null,
): Promise<boolean> => {
  if (hasValidAdminToken(request, env, explicitToken)) return true;
  return hasValidSiteSession(request, env);
};
