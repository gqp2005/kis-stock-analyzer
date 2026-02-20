export const makeCacheRequest = (cacheKey: string): Request => {
  return new Request(cacheKey, { method: "GET" });
};

export const getCachedJson = async <T>(cache: Cache, cacheKey: string): Promise<T | null> => {
  const response = await cache.match(makeCacheRequest(cacheKey));
  if (!response) return null;

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

export const putCachedJson = async (
  cache: Cache,
  cacheKey: string,
  payload: unknown,
  ttlSec: number,
): Promise<void> => {
  const response = new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttlSec}`,
    },
  });

  await cache.put(makeCacheRequest(cacheKey), response);
};

