import { errorJson, json, tooManyRequests } from "./lib/response";

type MiddlewareEnv = {
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_SEC?: string;
  ADMIN_TOKEN?: string;
  SITE_AUTH_PASSWORD?: string;
  SITE_AUTH_USERNAME?: string;
  SITE_AUTH_COOKIE_SECRET?: string;
  SITE_AUTH_SESSION_HOURS?: string;
  SITE_AUTH_DEBUG?: string;
};

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const AUTH_COOKIE_NAME = "kis_auth_session";
const AUTH_PAGE_PATH = "/__auth";
const AUTH_LOGIN_PATH = "/__auth/login";
const AUTH_LOGOUT_PATH = "/__auth/logout";
const DEFAULT_SESSION_HOURS = 12;
const encoder = new TextEncoder();
let cachedSigningKeySecret: string | null = null;
let cachedSigningKeyPromise: Promise<CryptoKey> | null = null;

const getClientIp = (request: Request): string => {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const isDebugEnabled = (env: MiddlewareEnv): boolean => {
  const value = env.SITE_AUTH_DEBUG?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
};

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

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

const signSessionPayload = async (payloadB64: string, secret: string): Promise<string> => {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return toBase64Url(new Uint8Array(signature));
};

const makeSessionToken = async (payload: SessionPayload, secret: string): Promise<string> => {
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signSessionPayload(payloadB64, secret);
  return `${payloadB64}.${signature}`;
};

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
    // 손상된 쿠키/서명은 예외 대신 세션 무효로 처리
    return null;
  }
};

const normalizeRedirectPath = (value: string | null | undefined): string => {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/__auth")) return "/";
  return value;
};

const isHttpsRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  return url.protocol === "https:";
};

const buildSessionCookie = (token: string, maxAgeSec: number, secure: boolean): string => {
  const securePart = secure ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${securePart}`;
};

const buildClearSessionCookie = (secure: boolean): string => {
  const securePart = secure ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}`;
};

const createRedirectResponse = (
  to: string,
  status = 302,
  extraHeaders?: Record<string, string>,
): Response =>
  new Response(null, {
    status,
    headers: {
      location: to,
      ...(extraHeaders ?? {}),
    },
  });

const renderLoginPage = (
  request: Request,
  redirectPath: string,
  options?: { error?: string; loggedOut?: boolean; usernamePrefill?: string },
): Response => {
  const title = "KIS Stock Analyzer 로그인";
  const errorLine = options?.error ? `<p class="msg error">${options.error}</p>` : "";
  const logoutLine = options?.loggedOut ? `<p class="msg ok">로그아웃되었습니다.</p>` : "";
  const safeUsername = (options?.usernamePrefill ?? "").replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#081521; color:#e4efff; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
    .panel { width:min(92vw, 420px); border:1px solid rgba(87,163,255,.35); border-radius:14px; background:rgba(14,28,44,.85); padding:20px; box-shadow:0 8px 30px rgba(0,0,0,.3); }
    h1 { margin:0 0 8px; font-size:22px; }
    p.meta { margin:0 0 14px; color:#9db4cc; font-size:13px; }
    label { display:block; margin:10px 0 6px; font-size:13px; color:#b8cee6; }
    input { width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1px solid rgba(87,163,255,.4); background:#0d1f31; color:#e7f1ff; padding:0 12px; }
    button { width:100%; margin-top:14px; height:42px; border:none; border-radius:10px; background:linear-gradient(90deg,#1f6fb6,#0fa3a3); color:#ecf7ff; font-weight:700; cursor:pointer; }
    .msg { margin:8px 0 0; font-size:13px; }
    .msg.error { color:#ffd0d9; }
    .msg.ok { color:#b7ffe9; }
  </style>
</head>
<body>
  <main class="panel">
    <h1>${title}</h1>
    <p class="meta">이 서비스는 개인 접근용으로 보호됩니다.</p>
    ${logoutLine}
    ${errorLine}
    <form method="post" action="${AUTH_LOGIN_PATH}">
      <input type="hidden" name="redirect" value="${redirectPath}" />
      <label for="username">아이디</label>
      <input id="username" name="username" value="${safeUsername}" autocomplete="username" />
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">로그인</button>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

const isAuthEnabled = (env: MiddlewareEnv): boolean => {
  return !!env.SITE_AUTH_PASSWORD?.trim();
};

const getAuthSecret = (env: MiddlewareEnv): string => {
  return env.SITE_AUTH_COOKIE_SECRET?.trim() || env.ADMIN_TOKEN?.trim() || env.SITE_AUTH_PASSWORD?.trim() || "";
};

const hasValidSession = async (request: Request, env: MiddlewareEnv): Promise<boolean> => {
  const token = parseCookies(request)[AUTH_COOKIE_NAME];
  if (!token) return false;
  const secret = getAuthSecret(env);
  if (!secret) return false;
  const payload = await verifySessionToken(token, secret);
  return payload !== null;
};

const isAdminBypassRequest = (request: Request, url: URL, env: MiddlewareEnv): boolean => {
  if (!url.pathname.startsWith("/api/admin/rebuild-screener")) return false;
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const provided = (url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "").trim();
  if (!provided) return false;
  return secureEquals(provided, expected);
};

const handleAuthRoutes = async (
  context: EventContext<unknown, string, unknown>,
  env: MiddlewareEnv,
): Promise<Response | null> => {
  const url = new URL(context.request.url);
  const redirectPath = normalizeRedirectPath(url.searchParams.get("redirect"));
  const secureCookie = isHttpsRequest(context.request);

  if (url.pathname === AUTH_PAGE_PATH && context.request.method === "GET") {
    const loggedOut = url.searchParams.get("logged_out") === "1";
    const activeSession = await hasValidSession(context.request, env);
    if (activeSession) {
      return createRedirectResponse(new URL(redirectPath, url.origin).toString(), 302);
    }
    return renderLoginPage(context.request, redirectPath, { loggedOut });
  }

  if (url.pathname === AUTH_LOGIN_PATH && context.request.method === "POST") {
    const form = await context.request.formData();
    const usernameInput = String(form.get("username") ?? "").trim();
    const passwordInput = String(form.get("password") ?? "");
    const nextPath = normalizeRedirectPath(String(form.get("redirect") ?? "/"));
    const expectedPassword = env.SITE_AUTH_PASSWORD?.trim() ?? "";
    const expectedUsername = env.SITE_AUTH_USERNAME?.trim();
    const usernameOk = expectedUsername ? secureEquals(usernameInput, expectedUsername) : true;
    const passwordOk = secureEquals(passwordInput, expectedPassword);

    if (!usernameOk || !passwordOk) {
      return renderLoginPage(context.request, nextPath, {
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
        usernamePrefill: usernameInput,
      });
    }

    const sessionHours = toPositiveInt(env.SITE_AUTH_SESSION_HOURS, DEFAULT_SESSION_HOURS);
    const maxAgeSec = sessionHours * 3600;
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await makeSessionToken(
      {
        sub: expectedUsername || "owner",
        iat: nowSec,
        exp: nowSec + maxAgeSec,
      },
      getAuthSecret(env),
    );

    return createRedirectResponse(new URL(nextPath, url.origin).toString(), 302, {
      "set-cookie": buildSessionCookie(token, maxAgeSec, secureCookie),
      "cache-control": "no-store",
    });
  }

  if (url.pathname === AUTH_LOGOUT_PATH) {
    return createRedirectResponse(new URL(`${AUTH_PAGE_PATH}?logged_out=1`, url.origin).toString(), 302, {
      "set-cookie": buildClearSessionCookie(secureCookie),
      "cache-control": "no-store",
    });
  }

  if (url.pathname.startsWith(AUTH_PAGE_PATH)) {
    return createRedirectResponse(new URL(AUTH_PAGE_PATH, url.origin).toString(), 302);
  }

  return null;
};

const applyRateLimit = async (context: EventContext<unknown, string, unknown>): Promise<Response | null> => {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (context.request.method !== "GET") return null;
  if (url.pathname === "/api/health") return null;

  const env = context.env as MiddlewareEnv;
  const maxRequests = toPositiveInt(env.RATE_LIMIT_MAX_REQUESTS, 120);
  const windowSec = toPositiveInt(env.RATE_LIMIT_WINDOW_SEC, 60);
  try {
    const ip = getClientIp(context.request);
    const nowMs = Date.now();
    const bucket = Math.floor(nowMs / (windowSec * 1000));
    const cacheKey = `https://cache.local/ratelimit/v1?ip=${encodeURIComponent(ip)}&bucket=${bucket}`;
    const cache = await caches.open("kis-rate-limit-v1");
    const cacheRequest = new Request(cacheKey);
    const cached = await cache.match(cacheRequest);
    const count = cached ? Number(await cached.text()) || 0 : 0;
    const nextCount = count + 1;

    await cache.put(
      cacheRequest,
      new Response(String(nextCount), {
        headers: {
          "cache-control": `public, max-age=${windowSec}`,
        },
      }),
    );

    if (nextCount <= maxRequests) return null;

    const retryAfterSec = Math.max(1, windowSec - Math.floor((nowMs % (windowSec * 1000)) / 1000));
    const limited = tooManyRequests(
      `요청이 너무 많습니다. ${retryAfterSec}초 후 다시 시도하세요.`,
      context.request,
      retryAfterSec,
    );

    const headers = new Headers(limited.headers);
    headers.set("x-rate-limit-limit", String(maxRequests));
    headers.set("x-rate-limit-remaining", "0");
    headers.set("x-rate-limit-reset-sec", String(retryAfterSec));
    return new Response(limited.body, {
      status: limited.status,
      statusText: limited.statusText,
      headers,
    });
  } catch (error) {
    // rate limit 저장소 오류는 서비스 전체 장애로 확산시키지 않음
    console.error("[rate-limit-error]", error);
    return null;
  }
};

export const onRequest: PagesFunction = async (context) => {
  let stage = "init";
  try {
    stage = "options";
    if (context.request.method === "OPTIONS") {
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type,x-request-id,x-admin-token",
          },
        }),
      );
    }

    const env = context.env as MiddlewareEnv;
    const url = new URL(context.request.url);

    stage = "auth-check";
    if (isAuthEnabled(env)) {
      stage = "auth-route";
      const authRouteResponse = await handleAuthRoutes(context, env);
      if (authRouteResponse) return withCors(authRouteResponse);

      stage = "auth-session";
      const bypass = isAdminBypassRequest(context.request, url, env);
      const authenticated = bypass || (await hasValidSession(context.request, env));
      if (!authenticated) {
        if (url.pathname.startsWith("/api/")) {
          const unauthorized = errorJson(401, "UNAUTHORIZED", "로그인이 필요합니다.", context.request);
          return withCors(unauthorized);
        }
        const redirectTarget = `${url.pathname}${url.search}`;
        const loginUrl = new URL(AUTH_PAGE_PATH, url.origin);
        loginUrl.searchParams.set("redirect", redirectTarget);
        return withCors(Response.redirect(loginUrl.toString(), 302));
      }
    } else if (url.pathname.startsWith(AUTH_PAGE_PATH)) {
      return withCors(Response.redirect(new URL("/", url.origin).toString(), 302));
    }

    stage = "rate-limit";
    const limited = await applyRateLimit(context);
    if (limited) return withCors(limited);

    stage = "next";
    return withCors(await context.next());
  } catch (error) {
    const env = context.env as MiddlewareEnv;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[middleware-error]", {
      stage,
      detail,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (isDebugEnabled(env)) {
      const requestId = context.request.headers.get("x-request-id") ?? crypto.randomUUID();
      return withCors(
        json(
          {
            ok: false,
            error: "요청 처리 중 내부 오류가 발생했습니다.",
            code: "MIDDLEWARE_ERROR",
            stage,
            detail,
            requestId,
            timestamp: new Date().toISOString(),
          },
          500,
        ),
      );
    }
    return withCors(errorJson(500, "MIDDLEWARE_ERROR", "요청 처리 중 내부 오류가 발생했습니다.", context.request));
  }
};
