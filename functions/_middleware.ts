import { tooManyRequests } from "./lib/response";

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

const applyRateLimit = async (context: EventContext<unknown, string, unknown>): Promise<Response | null> => {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (context.request.method !== "GET") return null;
  if (url.pathname === "/api/health") return null;

  const env = context.env as {
    RATE_LIMIT_MAX_REQUESTS?: string;
    RATE_LIMIT_WINDOW_SEC?: string;
  };
  const maxRequests = toPositiveInt(env.RATE_LIMIT_MAX_REQUESTS, 120);
  const windowSec = toPositiveInt(env.RATE_LIMIT_WINDOW_SEC, 60);

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

  const retryAfterSec = Math.max(
    1,
    windowSec - Math.floor((nowMs % (windowSec * 1000)) / 1000),
  );
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
};

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-request-id,x-admin-token",
      },
    });
  }

  const limited = await applyRateLimit(context);
  if (limited) {
    const headers = new Headers(limited.headers);
    headers.set("access-control-allow-origin", "*");
    return new Response(limited.body, {
      status: limited.status,
      statusText: limited.statusText,
      headers,
    });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
