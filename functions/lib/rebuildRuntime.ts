import { getCachedJson, putCachedJson } from "./cache";
import type { ScreenerStoredCandidate } from "./screener";
import {
  deletePersistedJson,
  getPersistedJson,
  listPersistedByPrefix,
  type PersistBackend,
  putPersistedJson,
} from "./screenerPersistence";
import {
  REBUILD_LOCK_TTL_SEC,
  SCREENER_CACHE_TTL_SEC,
  type RebuildProgressSnapshot,
  persistRebuildLockKey,
  persistRebuildProgressCandidatesKey,
  persistRebuildProgressCandidatesPrefix,
  persistRebuildProgressKey,
  rebuildLockKey,
  rebuildProgressKey,
} from "./screenerStore";
import type { Env } from "./types";

const RUNTIME_CANDIDATES_PER_CHUNK = 50;
const RUNTIME_CANDIDATES_MAX_CHUNKS = 50;

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

const loadCandidateChunks = async (
  env: Env,
  date: string,
): Promise<ScreenerStoredCandidate[]> => {
  const chunks = await listPersistedByPrefix<ScreenerStoredCandidate[]>(
    env,
    persistRebuildProgressCandidatesPrefix(date),
    RUNTIME_CANDIDATES_MAX_CHUNKS,
    "d1",
  );
  return chunks
    .sort((a, b) => a.key.localeCompare(b.key))
    .flatMap((item) => (Array.isArray(item.value) ? item.value : []));
};

const saveCandidateChunks = async (
  env: Env,
  date: string,
  candidates: ScreenerStoredCandidate[],
): Promise<void> => {
  const totalChunks = Math.ceil(candidates.length / RUNTIME_CANDIDATES_PER_CHUNK);
  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * RUNTIME_CANDIDATES_PER_CHUNK;
    const chunk = candidates.slice(start, start + RUNTIME_CANDIDATES_PER_CHUNK);
    await putPersistedJson(
      env,
      persistRebuildProgressCandidatesKey(date, i),
      chunk,
      SCREENER_CACHE_TTL_SEC,
      "d1",
    );
  }
};

const clearCandidateChunks = async (env: Env, date: string): Promise<void> => {
  const chunks = await listPersistedByPrefix<unknown>(
    env,
    persistRebuildProgressCandidatesPrefix(date),
    RUNTIME_CANDIDATES_MAX_CHUNKS,
    "d1",
  );
  for (const item of chunks) {
    await deletePersistedJson(env, item.key, "d1");
  }
};

export const loadRebuildRuntimeProgress = async (
  env: Env,
  cache: Cache,
  date: string,
): Promise<RebuildProgressSnapshot | null> => {
  const backend = rebuildRuntimeBackend(env);
  if (backend === "d1") {
    const meta = await getPersistedJson<RebuildProgressSnapshot>(
      env,
      persistRebuildProgressKey(date),
      "d1",
    );
    if (!meta) return null;
    const candidates = await loadCandidateChunks(env, date);
    return { ...meta, candidates };
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
    // candidates는 D1 row size 한도(약 1MB) 회피를 위해 청크 단위로 분리 저장한다.
    const candidates = payload.candidates ?? [];
    const meta: RebuildProgressSnapshot = { ...payload, candidates: [] };
    await putPersistedJson(
      env,
      persistRebuildProgressKey(date),
      meta,
      SCREENER_CACHE_TTL_SEC,
      "d1",
    );
    await saveCandidateChunks(env, date, candidates);
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
    await clearCandidateChunks(env, date);
    await deletePersistedJson(env, persistRebuildProgressKey(date), "d1");
    return;
  }
  await cache.delete(new Request(rebuildProgressKey(date)));

  const recoveryBackend = rebuildProgressRecoveryBackend(env);
  if (recoveryBackend !== "none") {
    await deletePersistedJson(env, persistRebuildProgressKey(date), recoveryBackend);
  }
};
