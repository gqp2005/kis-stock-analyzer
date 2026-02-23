import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedJson } from "../functions/lib/cache";
import type { RebuildProgressSnapshot, ScreenerSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
}));

import { onRequestGet } from "../functions/api/admin/rebuild-screener/status";

const mockedGetCachedJson = vi.mocked(getCachedJson);

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "secret-token",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/admin/rebuild-screener/status",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/admin/rebuild-screener/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCachedJson.mockResolvedValue(null);
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns 401 when token is invalid", async () => {
    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/status?token=wrong"),
    );
    expect(response.status).toBe(401);
  });

  it("returns inProgress=true when lock/progress are present", async () => {
    const progress: RebuildProgressSnapshot = {
      date: "2026-02-23",
      startedAt: "2026-02-23T05:55:00+09:00",
      updatedAt: "2026-02-23T05:56:00+09:00",
      cursor: 40,
      universeCount: 500,
      processedCount: 33,
      ohlcvFailures: 2,
      insufficientData: 5,
      warnings: [],
      candidates: [],
    };

    mockedGetCachedJson.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("lock:rebuild-screener")) {
        return { startedAt: new Date().toISOString() } as never;
      }
      if (keyText.includes("rebuild-progress")) {
        return progress as never;
      }
      return null as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/status?token=secret-token"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      inProgress: boolean;
      progress: { processed: number; total: number };
      lock: { exists: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.inProgress).toBe(true);
    expect(body.progress.processed).toBe(40);
    expect(body.progress.total).toBe(500);
    expect(body.lock.exists).toBe(true);
  });

  it("returns latest snapshot when no active rebuild", async () => {
    const snapshot: ScreenerSnapshot = {
      date: "2026-02-22",
      updatedAt: "2026-02-22T06:12:00+09:00",
      universeCount: 500,
      processedCount: 480,
      topN: 50,
      source: "KIS",
      warnings: [],
      candidates: [],
      topCandidates: [],
    };

    mockedGetCachedJson.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("lock:rebuild-screener")) return null as never;
      if (keyText.includes("rebuild-progress")) return null as never;
      if (keyText.includes("last_success")) return snapshot as never;
      return null as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/status?token=secret-token"),
    );
    const body = (await response.json()) as {
      inProgress: boolean;
      snapshot: { date: string; updatedAt: string } | null;
    };

    expect(response.status).toBe(200);
    expect(body.inProgress).toBe(false);
    expect(body.snapshot?.date).toBe("2026-02-22");
    expect(body.snapshot?.updatedAt).toBe("2026-02-22T06:12:00+09:00");
  });
});
