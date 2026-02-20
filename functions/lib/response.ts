export const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

const requestIdFrom = (request?: Request): string =>
  request?.headers.get("x-request-id") ?? crypto.randomUUID();

export const errorJson = (
  status: number,
  code: string,
  message: string,
  request?: Request,
  extraHeaders?: Record<string, string>,
): Response =>
  json(
    {
      ok: false,
      error: message,
      code,
      requestId: requestIdFrom(request),
      timestamp: new Date().toISOString(),
    },
    status,
    extraHeaders,
  );

export const badRequest = (message: string, request?: Request): Response =>
  errorJson(400, "BAD_REQUEST", message, request);

export const tooManyRequests = (
  message: string,
  request?: Request,
  retryAfterSec?: number,
): Response =>
  errorJson(429, "RATE_LIMITED", message, request, retryAfterSec ? { "retry-after": String(retryAfterSec) } : undefined);

export const serverError = (message: string, request?: Request): Response =>
  errorJson(500, "INTERNAL_ERROR", message, request);
