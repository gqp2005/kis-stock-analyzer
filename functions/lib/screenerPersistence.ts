import type { Env } from "./types";

export type PersistBackend = "kv" | "d1" | "none";

export interface PersistListItem<T> {
  key: string;
  value: T;
}

const PERSIST_PREFIX = "screener:persist:v1:";
const D1_TABLE = "screener_persist";
const D1_CHUNK_ROOT_PREFIX = `${PERSIST_PREFIX}__chunks__:`;
const D1_SAFE_CHAR_LIMIT = 128 * 1024;
const D1_CHUNK_MARKER = "__screenerPersistChunked";

let d1SchemaReady = false;

const withPrefix = (key: string): string => `${PERSIST_PREFIX}${key}`;

const stripPrefix = (key: string): string =>
  key.startsWith(PERSIST_PREFIX) ? key.slice(PERSIST_PREFIX.length) : key;

const nowSec = (): number => Math.floor(Date.now() / 1000);

const upperBoundForPrefix = (prefix: string): string =>
  `${prefix}${String.fromCharCode(0xffff)}`;

interface D1ChunkManifest {
  [D1_CHUNK_MARKER]: true;
  version: 1;
  chunkPrefix: string;
  chunks: number;
  charLength: number;
  updatedAt: string;
}

const isD1ChunkManifest = (value: unknown): value is D1ChunkManifest =>
  !!value &&
  typeof value === "object" &&
  (value as Record<string, unknown>)[D1_CHUNK_MARKER] === true &&
  (value as Record<string, unknown>).version === 1 &&
  typeof (value as Record<string, unknown>).chunkPrefix === "string" &&
  typeof (value as Record<string, unknown>).chunks === "number";

const d1ChunkRoot = (key: string): string => `${D1_CHUNK_ROOT_PREFIX}${key}:`;

const d1ChunkPrefix = (key: string): string => {
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${d1ChunkRoot(key)}${generation}:`;
};

const d1ChunkKey = (chunkPrefix: string, index: number): string =>
  `${chunkPrefix}${index.toString().padStart(6, "0")}`;

const splitIntoChunks = (value: string, chunkSize: number): string[] => {
  const chunks: string[] = [];
  for (let start = 0; start < value.length; start += chunkSize) {
    chunks.push(value.slice(start, start + chunkSize));
  }
  return chunks;
};

export const persistenceBackend = (env: Env): PersistBackend => {
  if (env.SCREENER_KV) return "kv";
  if (env.SCREENER_DB) return "d1";
  return "none";
};

const resolvePersistenceBackend = (
  env: Env,
  preferredBackend?: Exclude<PersistBackend, "none">,
): PersistBackend => {
  if (preferredBackend === "kv") {
    return env.SCREENER_KV ? "kv" : "none";
  }
  if (preferredBackend === "d1") {
    return env.SCREENER_DB ? "d1" : "none";
  }
  return persistenceBackend(env);
};

const ensureD1Schema = async (env: Env): Promise<void> => {
  if (!env.SCREENER_DB || d1SchemaReady) return;
  await env.SCREENER_DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${D1_TABLE} (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL, expire_at INTEGER)`,
  ).run();
  await env.SCREENER_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${D1_TABLE}_expire ON ${D1_TABLE}(expire_at)`,
  ).run();
  await env.SCREENER_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${D1_TABLE}_key ON ${D1_TABLE}(k)`,
  ).run();
  d1SchemaReady = true;
};

const purgeExpiredD1 = async (env: Env): Promise<void> => {
  if (!env.SCREENER_DB) return;
  await env.SCREENER_DB.prepare(
    `DELETE FROM ${D1_TABLE} WHERE expire_at IS NOT NULL AND expire_at <= ?`,
  )
    .bind(nowSec())
    .run();
};

const listD1ChunkKeys = async (env: Env, key: string): Promise<string[]> => {
  if (!env.SCREENER_DB) return [];
  const root = d1ChunkRoot(key);
  const rows = await env.SCREENER_DB.prepare(
    `SELECT k FROM ${D1_TABLE}
     WHERE k >= ? AND k < ?
     ORDER BY k ASC`,
  )
    .bind(root, upperBoundForPrefix(root))
    .all<{ k: string }>();
  return (rows.results ?? []).map((row) => row.k);
};

const cleanupD1Chunks = async (
  env: Env,
  key: string,
  keepPrefix?: string,
): Promise<void> => {
  if (!env.SCREENER_DB) return;
  const keys = await listD1ChunkKeys(env, key);
  for (const chunkKey of keys) {
    if (keepPrefix && chunkKey.startsWith(keepPrefix)) continue;
    await env.SCREENER_DB.prepare(`DELETE FROM ${D1_TABLE} WHERE k = ?`)
      .bind(chunkKey)
      .run();
  }
};

const putD1Row = async (
  env: Env,
  key: string,
  value: string,
  updatedAt: string,
  expireAt: number | null,
): Promise<void> => {
  if (!env.SCREENER_DB) return;
  await env.SCREENER_DB.prepare(
    `INSERT INTO ${D1_TABLE} (k, v, updated_at, expire_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET
      v=excluded.v,
      updated_at=excluded.updated_at,
      expire_at=excluded.expire_at`,
  )
    .bind(key, value, updatedAt, expireAt)
    .run();
};

const putD1Json = async (
  env: Env,
  key: string,
  prefixed: string,
  payload: unknown,
  updatedAt: string,
  expireAt: number | null,
): Promise<void> => {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= D1_SAFE_CHAR_LIMIT) {
    await putD1Row(env, prefixed, serialized, updatedAt, expireAt);
    await cleanupD1Chunks(env, key);
    return;
  }

  const chunks = splitIntoChunks(serialized, D1_SAFE_CHAR_LIMIT);
  const chunkPrefix = d1ChunkPrefix(key);
  for (let index = 0; index < chunks.length; index += 1) {
    await putD1Row(env, d1ChunkKey(chunkPrefix, index), chunks[index], updatedAt, expireAt);
  }

  const manifest: D1ChunkManifest = {
    [D1_CHUNK_MARKER]: true,
    version: 1,
    chunkPrefix,
    chunks: chunks.length,
    charLength: serialized.length,
    updatedAt,
  };
  await putD1Row(env, prefixed, JSON.stringify(manifest), updatedAt, expireAt);
  await cleanupD1Chunks(env, key, chunkPrefix);
};

const parseD1StoredJson = async <T>(env: Env, stored: string): Promise<T | null> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }

  if (!isD1ChunkManifest(parsed)) {
    return parsed as T;
  }

  if (!env.SCREENER_DB || parsed.chunks < 1) return null;
  const chunks: string[] = [];
  for (let index = 0; index < parsed.chunks; index += 1) {
    const row = await env.SCREENER_DB.prepare(
      `SELECT v FROM ${D1_TABLE} WHERE k = ? LIMIT 1`,
    )
      .bind(d1ChunkKey(parsed.chunkPrefix, index))
      .first<{ v: string }>();
    if (typeof row?.v !== "string") return null;
    chunks.push(row.v);
  }

  try {
    return JSON.parse(chunks.join("")) as T;
  } catch {
    return null;
  }
};

export const putPersistedJson = async (
  env: Env,
  key: string,
  payload: unknown,
  ttlSec?: number,
  preferredBackend?: Exclude<PersistBackend, "none">,
): Promise<boolean> => {
  const backend = resolvePersistenceBackend(env, preferredBackend);
  if (backend === "none") return false;

  const prefixed = withPrefix(key);
  if (backend === "kv" && env.SCREENER_KV) {
    const options =
      ttlSec && ttlSec > 0 ? ({ expirationTtl: ttlSec } as KVNamespacePutOptions) : undefined;
    await env.SCREENER_KV.put(prefixed, JSON.stringify(payload), options);
    return true;
  }

  if (!env.SCREENER_DB) return false;
  await ensureD1Schema(env);
  const expireAt = ttlSec && ttlSec > 0 ? nowSec() + ttlSec : null;
  const updatedAt = new Date().toISOString();
  await putD1Json(env, key, prefixed, payload, updatedAt, expireAt);
  return true;
};

export const deletePersistedJson = async (
  env: Env,
  key: string,
  preferredBackend?: Exclude<PersistBackend, "none">,
): Promise<boolean> => {
  const backend = resolvePersistenceBackend(env, preferredBackend);
  if (backend === "none") return false;

  const prefixed = withPrefix(key);
  if (backend === "kv" && env.SCREENER_KV) {
    await env.SCREENER_KV.delete(prefixed);
    return true;
  }

  if (!env.SCREENER_DB) return false;
  await ensureD1Schema(env);
  await env.SCREENER_DB.prepare(`DELETE FROM ${D1_TABLE} WHERE k = ?`)
    .bind(prefixed)
    .run();
  await cleanupD1Chunks(env, key);
  return true;
};

export const getPersistedJson = async <T>(
  env: Env,
  key: string,
  preferredBackend?: Exclude<PersistBackend, "none">,
): Promise<T | null> => {
  const backend = resolvePersistenceBackend(env, preferredBackend);
  if (backend === "none") return null;

  const prefixed = withPrefix(key);
  if (backend === "kv" && env.SCREENER_KV) {
    return (await env.SCREENER_KV.get(prefixed, { type: "json" })) as T | null;
  }

  if (!env.SCREENER_DB) return null;
  await ensureD1Schema(env);
  await purgeExpiredD1(env);
  const row = await env.SCREENER_DB.prepare(
    `SELECT v FROM ${D1_TABLE} WHERE k = ? LIMIT 1`,
  )
    .bind(prefixed)
    .first<{ v: string }>();

  if (!row?.v) return null;
  return await parseD1StoredJson<T>(env, row.v);
};

export const listPersistedByPrefix = async <T>(
  env: Env,
  prefix: string,
  limit: number,
  preferredBackend?: Exclude<PersistBackend, "none">,
): Promise<Array<PersistListItem<T>>> => {
  const backend = resolvePersistenceBackend(env, preferredBackend);
  if (backend === "none") return [];
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const prefixedPrefix = withPrefix(prefix);

  if (backend === "kv" && env.SCREENER_KV) {
    const listed = await env.SCREENER_KV.list({ prefix: prefixedPrefix, limit: safeLimit });
    const keys = listed.keys
      .map((item) => item.name)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, safeLimit);
    const values = await Promise.all(
      keys.map(async (name) => ({
        key: stripPrefix(name),
        value: (await env.SCREENER_KV!.get(name, { type: "json" })) as T | null,
      })),
    );
    return values
      .filter((item): item is PersistListItem<T> => item.value != null)
      .map((item) => ({ key: item.key, value: item.value }));
  }

  if (!env.SCREENER_DB) return [];
  await ensureD1Schema(env);
  await purgeExpiredD1(env);
  // D1의 LIKE 패턴 한도("too complex")를 우회하고 인덱스 lookup을 활용하기 위해 범위 비교 사용.
  const rows = await env.SCREENER_DB.prepare(
    `SELECT k, v FROM ${D1_TABLE}
     WHERE k >= ? AND k < ? AND (expire_at IS NULL OR expire_at > ?)
     ORDER BY k DESC
     LIMIT ?`,
  )
    .bind(prefixedPrefix, upperBoundForPrefix(prefixedPrefix), nowSec(), safeLimit)
    .all<{ k: string; v: string }>();

  const resultRows = rows.results ?? [];
  const parsed: Array<PersistListItem<T>> = [];
  for (const row of resultRows) {
    if (row.k.startsWith(D1_CHUNK_ROOT_PREFIX)) continue;
    const value = await parseD1StoredJson<T>(env, row.v);
    if (value != null) {
      parsed.push({
        key: stripPrefix(row.k),
        value,
      });
    }
  }
  return parsed;
};
