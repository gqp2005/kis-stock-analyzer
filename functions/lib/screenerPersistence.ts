import type { Env } from "./types";

type PersistBackend = "kv" | "d1" | "none";

export interface PersistListItem<T> {
  key: string;
  value: T;
}

const PERSIST_PREFIX = "screener:persist:v1:";
const D1_TABLE = "screener_persist";

let d1SchemaReady = false;

const withPrefix = (key: string): string => `${PERSIST_PREFIX}${key}`;

const stripPrefix = (key: string): string =>
  key.startsWith(PERSIST_PREFIX) ? key.slice(PERSIST_PREFIX.length) : key;

const nowSec = (): number => Math.floor(Date.now() / 1000);

export const persistenceBackend = (env: Env): PersistBackend => {
  if (env.SCREENER_KV) return "kv";
  if (env.SCREENER_DB) return "d1";
  return "none";
};

const ensureD1Schema = async (env: Env): Promise<void> => {
  if (!env.SCREENER_DB || d1SchemaReady) return;
  await env.SCREENER_DB.exec(
    `CREATE TABLE IF NOT EXISTS ${D1_TABLE} (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expire_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_${D1_TABLE}_expire ON ${D1_TABLE}(expire_at);
    CREATE INDEX IF NOT EXISTS idx_${D1_TABLE}_key ON ${D1_TABLE}(k);`,
  );
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

export const putPersistedJson = async (
  env: Env,
  key: string,
  payload: unknown,
  ttlSec?: number,
): Promise<boolean> => {
  const backend = persistenceBackend(env);
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
  await env.SCREENER_DB.prepare(
    `INSERT INTO ${D1_TABLE} (k, v, updated_at, expire_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET
      v=excluded.v,
      updated_at=excluded.updated_at,
      expire_at=excluded.expire_at`,
  )
    .bind(prefixed, JSON.stringify(payload), updatedAt, expireAt)
    .run();
  return true;
};

export const getPersistedJson = async <T>(
  env: Env,
  key: string,
): Promise<T | null> => {
  const backend = persistenceBackend(env);
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
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return null;
  }
};

export const listPersistedByPrefix = async <T>(
  env: Env,
  prefix: string,
  limit: number,
): Promise<Array<PersistListItem<T>>> => {
  const backend = persistenceBackend(env);
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
  const rows = await env.SCREENER_DB.prepare(
    `SELECT k, v FROM ${D1_TABLE}
     WHERE k LIKE ? AND (expire_at IS NULL OR expire_at > ?)
     ORDER BY k DESC
     LIMIT ?`,
  )
    .bind(`${prefixedPrefix}%`, nowSec(), safeLimit)
    .all<{ k: string; v: string }>();

  const resultRows = rows.results ?? [];
  const parsed: Array<PersistListItem<T>> = [];
  for (const row of resultRows) {
    try {
      parsed.push({
        key: stripPrefix(row.k),
        value: JSON.parse(row.v) as T,
      });
    } catch {
      // ignore invalid rows
    }
  }
  return parsed;
};
