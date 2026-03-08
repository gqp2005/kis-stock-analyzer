import { getCachedJson, putCachedJson } from "./cache";
import {
  deletePersistedJson,
  getPersistedJson,
  type PersistBackend,
  putPersistedJson,
} from "./screenerPersistence";
import {
  REBUILD_LOCK_TTL_SEC,
  SCREENER_CACHE_TTL_SEC,
  type RebuildProgressSnapshot,
  persistRebuildLockKey,
  persistRebuildProgressKey,
  rebuildLockKey,
  rebuildProgressKey,
} from "./screenerStore";
import type { Env } from "./types";

export type RebuildRuntimeBackend = "cache" | "d1";

// KV는 eventual consistency 특성 때문에 락/진행률 coordination 용도로 부적합하다.
// 런타임 상태는 D1이 있으면 D1, 없으면 Cache API만 사용한다.
export const rebuildRuntimeBackend = (env: Env): RebuildRuntimeBackend =>
  env.SCREENER_DB ? "d1" : "cache";

const rebuildProgressRecoveryBackend = (
  env: Env,
): Exclude<PersistBackend, "none" | "d1"> | "none" => {
  if (rebuildRuntimeBackend(env) === "d1") return "none";
  return env.SCREENER_KV ? "kv" : "none";
};

export interface RebuildRuntimeLock {
  startedAt: string;
  ttlSec: number;
}

export const loadRebuildRuntimeLock = async (
  env: Env,
  cache: Cache,
): Promise<RebuildRuntimeLock | null> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    return await getPersistedJson<RebuildRuntimeLock>(
      env,
      persistRebuildLockKey(),
      "d1",
    );
  }
  return await getCachedJson<RebuildRuntimeLock>(cache, rebuildLockKey());
};

export const saveRebuildRuntimeLock = async (
  env: Env,
  cache: Cache,
  payload: RebuildRuntimeLock,
): Promise<void> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    await putPersistedJson(
      env,
      persistRebuildLockKey(),
      payload,
      REBUILD_LOCK_TTL_SEC,
      "d1",
    );
    return;
  }
  await putCachedJson(cache, rebuildLockKey(), payload, REBUILD_LOCK_TTL_SEC);
};

export const clearRebuildRuntimeLock = async (
  env: Env,
  cache: Cache,
): Promise<void> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    await deletePersistedJson(env, persistRebuildLockKey(), "d1");
    return;
  }
  await cache.delete(new Request(rebuildLockKey()));
};

export const loadRebuildRuntimeProgress = async (
  env: Env,
  cache: Cache,
  date: string,
): Promise<RebuildProgressSnapshot | null> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    return await getPersistedJson<RebuildProgressSnapshot>(
      env,
      persistRebuildProgressKey(date),
      "d1",
    );
  }
  const cacheValue = await getCachedJson<RebuildProgressSnapshot>(cache, rebuildProgressKey(date));
  if (cacheValue) return cacheValue;

  const recoveryBackend = rebuildProgressRecoveryBackend(env);
  if (recoveryBackend === "none") return null;

  return await getPersistedJson<RebuildProgressSnapshot>(
    env,
    persistRebuildProgressKey(date),
    recoveryBackend,
  );
};

export const saveRebuildRuntimeProgress = async (
  env: Env,
  cache: Cache,
  date: string,
  payload: RebuildProgressSnapshot,
): Promise<void> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    await putPersistedJson(
      env,
      persistRebuildProgressKey(date),
      payload,
      SCREENER_CACHE_TTL_SEC,
      "d1",
    );
    return;
  }
  await putCachedJson(cache, rebuildProgressKey(date), payload, SCREENER_CACHE_TTL_SEC);

  const recoveryBackend = rebuildProgressRecoveryBackend(env);
  if (recoveryBackend !== "none") {
    await putPersistedJson(
      env,
      persistRebuildProgressKey(date),
      payload,
      SCREENER_CACHE_TTL_SEC,
      recoveryBackend,
    );
  }
};

export const clearRebuildRuntimeProgress = async (
  env: Env,
  cache: Cache,
  date: string,
): Promise<void> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    await deletePersistedJson(env, persistRebuildProgressKey(date), "d1");
    return;
  }
  await cache.delete(new Request(rebuildProgressKey(date)));

  const recoveryBackend = rebuildProgressRecoveryBackend(env);
  if (recoveryBackend !== "none") {
    await deletePersistedJson(env, persistRebuildProgressKey(date), recoveryBackend);
  }
};
