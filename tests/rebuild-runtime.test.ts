import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RebuildProgressSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

vi.mock("../functions/lib/screenerPersistence", () => ({
  getPersistedJson: vi.fn(async () => null),
  putPersistedJson: vi.fn(async () => true),
  deletePersistedJson: vi.fn(async () => true),
}));

import { getCachedJson, putCachedJson } from "../functions/lib/cache";
import {
  deletePersistedJson,
  getPersistedJson,
  putPersistedJson,
} from "../functions/lib/screenerPersistence";
import {
  clearRebuildRuntimeProgress,
  loadRebuildRuntimeProgress,
  saveRebuildRuntimeProgress,
} from "../functions/lib/rebuildRuntime";

const getCachedJsonMock = vi.mocked(getCachedJson);
const putCachedJsonMock = vi.mocked(putCachedJson);
const getPersistedJsonMock = vi.mocked(getPersistedJson);
const putPersistedJsonMock = vi.mocked(putPersistedJson);
const deletePersistedJsonMock = vi.mocked(deletePersistedJson);

const sampleProgress: RebuildProgressSnapshot = {
  date: "2026-03-09",
  startedAt: "2026-03-09T05:00:00+09:00",
  updatedAt: "2026-03-09T05:05:00+09:00",
  cursor: 200,
  universeCount: 500,
  processedCount: 140,
  ohlcvFailures: 3,
  insufficientData: 7,
  warnings: ["테스트"],
  candidates: [],
  failedItems: [],
  retryStats: {
    totalRetries: 0,
    retriedSymbols: 0,
    maxRetryPerSymbol: 0,
  },
  lastBatch: {
    from: 180,
    to: 200,
    batchSize: 20,
  },
};

const env = {
  KIS_APP_KEY: "dummy",
  KIS_APP_SECRET: "dummy",
  SCREENER_KV: {} as KVNamespace,
};

describe("rebuildRuntime progress recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to persisted KV progress when cache misses", async () => {
    getCachedJsonMock.mockResolvedValue(null);
    getPersistedJsonMock.mockResolvedValue(sampleProgress);

    const result = await loadRebuildRuntimeProgress(
      env,
      {} as Cache,
      "2026-03-09",
    );

    expect(result?.cursor).toBe(200);
    expect(getPersistedJsonMock).toHaveBeenCalledWith(
      env,
      "runtime:progress:rebuild-screener:2026-03-09",
      "kv",
    );
  });

  it("writes progress to cache and persisted KV backup", async () => {
    await saveRebuildRuntimeProgress(
      env,
      {} as Cache,
      "2026-03-09",
      sampleProgress,
    );

    expect(putCachedJsonMock).toHaveBeenCalledOnce();
    expect(putPersistedJsonMock).toHaveBeenCalledWith(
      env,
      "runtime:progress:rebuild-screener:2026-03-09",
      sampleProgress,
      24 * 60 * 60,
      "kv",
    );
  });

  it("clears cache progress and persisted KV backup", async () => {
    const cache = {
      delete: vi.fn(async () => true),
    } as unknown as Cache;

    await clearRebuildRuntimeProgress(env, cache, "2026-03-09");

    expect(deletePersistedJsonMock).toHaveBeenCalledWith(
      env,
      "runtime:progress:rebuild-screener:2026-03-09",
      "kv",
    );
    expect((cache.delete as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});
