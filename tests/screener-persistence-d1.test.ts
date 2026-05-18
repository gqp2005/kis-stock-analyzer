import { describe, expect, it } from "vitest";
import {
  deletePersistedJson,
  getPersistedJson,
  listPersistedByPrefix,
  putPersistedJson,
} from "../functions/lib/screenerPersistence";
import type { Env } from "../functions/lib/types";

interface StoredRow {
  k: string;
  v: string;
  updated_at: string;
  expire_at: number | null;
}

class MemoryD1Statement {
  private args: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly rows: Map<string, StoredRow>,
  ) {}

  bind(...args: unknown[]): MemoryD1Statement {
    this.args = args;
    return this;
  }

  async run(): Promise<D1Result> {
    const normalized = this.sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) {
      return { success: true, meta: {} } as D1Result;
    }

    if (normalized.startsWith("DELETE FROM screener_persist WHERE expire_at")) {
      const now = Number(this.args[0]);
      for (const [key, row] of this.rows) {
        if (row.expire_at != null && row.expire_at <= now) this.rows.delete(key);
      }
      return { success: true, meta: {} } as D1Result;
    }

    if (normalized.startsWith("DELETE FROM screener_persist WHERE k = ?")) {
      this.rows.delete(String(this.args[0]));
      return { success: true, meta: {} } as D1Result;
    }

    if (normalized.startsWith("INSERT INTO screener_persist")) {
      const [k, v, updatedAt, expireAt] = this.args;
      this.rows.set(String(k), {
        k: String(k),
        v: String(v),
        updated_at: String(updatedAt),
        expire_at: expireAt == null ? null : Number(expireAt),
      });
      return { success: true, meta: {} } as D1Result;
    }

    throw new Error(`Unsupported run SQL: ${normalized}`);
  }

  async first<T>(): Promise<T | null> {
    const normalized = this.sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT v FROM screener_persist WHERE k = ?")) {
      const row = this.rows.get(String(this.args[0]));
      return row ? ({ v: row.v } as T) : null;
    }
    throw new Error(`Unsupported first SQL: ${normalized}`);
  }

  async all<T>(): Promise<D1Result<T>> {
    const normalized = this.sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT k FROM screener_persist")) {
      const lower = String(this.args[0]);
      const upper = String(this.args[1]);
      const results = [...this.rows.values()]
        .filter((row) => row.k >= lower && row.k < upper)
        .sort((a, b) => a.k.localeCompare(b.k))
        .map((row) => ({ k: row.k }) as T);
      return { success: true, meta: {}, results } as D1Result<T>;
    }

    if (normalized.startsWith("SELECT k, v FROM screener_persist")) {
      const lower = String(this.args[0]);
      const upper = String(this.args[1]);
      const now = Number(this.args[2]);
      const limit = Number(this.args[3]);
      const results = [...this.rows.values()]
        .filter(
          (row) =>
            row.k >= lower &&
            row.k < upper &&
            (row.expire_at == null || row.expire_at > now),
        )
        .sort((a, b) => b.k.localeCompare(a.k))
        .slice(0, limit)
        .map((row) => ({ k: row.k, v: row.v }) as T);
      return { success: true, meta: {}, results } as D1Result<T>;
    }

    throw new Error(`Unsupported all SQL: ${normalized}`);
  }
}

const createMemoryD1Env = (): { env: Env; rows: Map<string, StoredRow> } => {
  const rows = new Map<string, StoredRow>();
  const db = {
    prepare: (sql: string) => new MemoryD1Statement(sql, rows),
  } as unknown as D1Database;

  return {
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      SCREENER_DB: db,
    } as Env,
    rows,
  };
};

const persistedKey = (key: string): string => `screener:persist:v1:${key}`;
const chunkRoot = (key: string): string => `screener:persist:v1:__chunks__:${key}:`;

describe("screenerPersistence D1 chunking", () => {
  it("stores and restores large payloads across D1 chunk rows", async () => {
    const { env, rows } = createMemoryD1Env();
    const key = "snapshot:date:2026-05-18";
    const payload = {
      date: "2026-05-18",
      candidates: Array.from({ length: 8 }, (_, index) => ({
        code: String(index).padStart(6, "0"),
        name: `candidate-${index}`,
        data: "x".repeat(90_000),
      })),
    };

    await putPersistedJson(env, key, payload, 60, "d1");

    const parent = rows.get(persistedKey(key));
    expect(parent).toBeDefined();
    expect(JSON.parse(parent!.v).__screenerPersistChunked).toBe(true);

    const chunkRows = [...rows.values()].filter((row) => row.k.startsWith(chunkRoot(key)));
    expect(chunkRows.length).toBeGreaterThan(1);
    expect(Math.max(...chunkRows.map((row) => row.v.length))).toBeLessThanOrEqual(128 * 1024);

    await expect(getPersistedJson<typeof payload>(env, key, "d1")).resolves.toEqual(payload);
  });

  it("hydrates chunked rows when listing by prefix", async () => {
    const { env } = createMemoryD1Env();
    const largePayload = { id: "large", data: "y".repeat(700_000) };
    const smallPayload = { id: "small", data: "ok" };

    await putPersistedJson(env, "history:changes:2026-05-17", largePayload, 60, "d1");
    await putPersistedJson(env, "history:changes:2026-05-18", smallPayload, 60, "d1");

    const listed = await listPersistedByPrefix<typeof largePayload | typeof smallPayload>(
      env,
      "history:changes:",
      10,
      "d1",
    );

    expect(listed.map((item) => item.key)).toEqual([
      "history:changes:2026-05-18",
      "history:changes:2026-05-17",
    ]);
    expect(listed[0]?.value).toEqual(smallPayload);
    expect(listed[1]?.value).toEqual(largePayload);
  });

  it("removes stale chunks when deleting or replacing a chunked value", async () => {
    const { env, rows } = createMemoryD1Env();
    const key = "snapshot:last_success";

    await putPersistedJson(env, key, { data: "z".repeat(700_000) }, 60, "d1");
    expect([...rows.keys()].some((rowKey) => rowKey.startsWith(chunkRoot(key)))).toBe(true);

    await putPersistedJson(env, key, { data: "small" }, 60, "d1");
    expect([...rows.keys()].some((rowKey) => rowKey.startsWith(chunkRoot(key)))).toBe(false);
    await expect(getPersistedJson<{ data: string }>(env, key, "d1")).resolves.toEqual({
      data: "small",
    });

    await putPersistedJson(env, key, { data: "z".repeat(700_000) }, 60, "d1");
    await deletePersistedJson(env, key, "d1");
    expect(rows.has(persistedKey(key))).toBe(false);
    expect([...rows.keys()].some((rowKey) => rowKey.startsWith(chunkRoot(key)))).toBe(false);
  });
});
