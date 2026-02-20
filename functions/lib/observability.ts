export interface RequestMetrics {
  requestId: string;
  method: string;
  path: string;
  startedAtMs: number;
  apiCacheHits: number;
  apiCacheMisses: number;
  dataCacheHits: number;
  dataCacheMisses: number;
  kisCalls: number;
  tokenCacheHits: number;
  tokenCacheMisses: number;
  tokenRefreshes: number;
}

export type MetricKey = Exclude<keyof RequestMetrics, "requestId" | "method" | "path" | "startedAtMs">;

const requestIdFrom = (request: Request): string =>
  request.headers.get("x-request-id") ?? crypto.randomUUID();

const ratio = (hit: number, miss: number): number => {
  const total = hit + miss;
  if (total <= 0) return 1;
  return hit / total;
};

export const createRequestMetrics = (request: Request): RequestMetrics => {
  const url = new URL(request.url);
  return {
    requestId: requestIdFrom(request),
    method: request.method,
    path: url.pathname,
    startedAtMs: Date.now(),
    apiCacheHits: 0,
    apiCacheMisses: 0,
    dataCacheHits: 0,
    dataCacheMisses: 0,
    kisCalls: 0,
    tokenCacheHits: 0,
    tokenCacheMisses: 0,
    tokenRefreshes: 0,
  };
};

export const bumpMetric = (metrics: RequestMetrics | undefined, key: MetricKey, amount = 1): void => {
  if (!metrics) return;
  metrics[key] += amount;
};

export const attachMetrics = (response: Response, metrics: RequestMetrics): Response => {
  const durationMs = Date.now() - metrics.startedAtMs;
  const apiCacheHitRatio = ratio(metrics.apiCacheHits, metrics.apiCacheMisses);
  const dataCacheHitRatio = ratio(metrics.dataCacheHits, metrics.dataCacheMisses);

  console.log(
    `[api-metrics] ${JSON.stringify({
      requestId: metrics.requestId,
      method: metrics.method,
      path: metrics.path,
      status: response.status,
      durationMs,
      apiCacheHits: metrics.apiCacheHits,
      apiCacheMisses: metrics.apiCacheMisses,
      apiCacheHitRatio: Number(apiCacheHitRatio.toFixed(3)),
      dataCacheHits: metrics.dataCacheHits,
      dataCacheMisses: metrics.dataCacheMisses,
      dataCacheHitRatio: Number(dataCacheHitRatio.toFixed(3)),
      kisCalls: metrics.kisCalls,
      tokenCacheHits: metrics.tokenCacheHits,
      tokenCacheMisses: metrics.tokenCacheMisses,
      tokenRefreshes: metrics.tokenRefreshes,
    })}`,
  );

  const headers = new Headers(response.headers);
  headers.set("x-request-id", metrics.requestId);
  headers.set("x-response-time-ms", String(durationMs));
  headers.set("x-api-cache-hit-ratio", apiCacheHitRatio.toFixed(3));
  headers.set("x-data-cache-hit-ratio", dataCacheHitRatio.toFixed(3));
  headers.set("x-kis-calls", String(metrics.kisCalls));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
