import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../functions/lib/types";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

vi.mock("../functions/lib/kis", () => ({
  fetchTimeframeCandles: vi.fn(async () => ({
    name: "삼성전자",
    candles: Array.from({ length: 280 }, (_, index) => ({
      time: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: 100 + index * 0.1,
      high: 101 + index * 0.1,
      low: 99 + index * 0.1,
      close: 100.5 + index * 0.1,
      volume: 100000 + index * 100,
    })) as Candle[],
    cacheTtlSec: 60,
  })),
}));

vi.mock("../functions/lib/universe", () => ({
  ExternalProvider: vi.fn().mockImplementation(() => ({
    getTopByTurnover: vi.fn(async () => [
      { code: "005930", name: "삼성전자", market: "KOSPI", turnover: 10000000000 },
    ]),
  })),
  StaticProvider: vi.fn().mockImplementation(() => ({
    getTopByTurnover: vi.fn(async () => [
      { code: "005930", name: "삼성전자", market: "KOSPI", turnover: 10000000000 },
    ]),
  })),
}));

vi.mock("../functions/lib/screener", () => ({
  analyzeScreenerRawCandidate: vi.fn(() => ({
    code: "005930",
    name: "삼성전자",
    market: "KOSPI",
    lastClose: 100000,
    lastDate: "2025-01-10",
    levels: { support: 98000, resistance: 103000, neckline: 100500 },
    hits: {
      volume: { score: 75, confidence: 70, volRatio: 1.3, patterns: ["BreakoutConfirmed"], reasons: [] },
      hs: {
        detected: false,
        state: "NONE",
        neckline: null,
        breakDate: null,
        target: null,
        score: 20,
        confidence: 30,
        reasons: [],
      },
      ihs: {
        detected: true,
        state: "CONFIRMED",
        neckline: 100500,
        breakDate: "2025-01-09",
        target: 108000,
        score: 78,
        confidence: 74,
        reasons: [],
      },
    },
    scoring: {
      all: { score: 80, confidence: 72 },
      volume: { score: 75, confidence: 70 },
      hs: { score: 20, confidence: 30 },
      ihs: { score: 78, confidence: 74 },
    },
    reasons: {
      all: ["테스트 all"],
      volume: ["테스트 volume"],
      hs: ["테스트 hs"],
      ihs: ["테스트 ihs"],
    },
    backtestSummary: { all: null, volume: null, hs: null, ihs: null },
  })),
}));

import { onRequestPost } from "../functions/api/admin/rebuild-screener";

const makeContext = (url: string): Parameters<typeof onRequestPost>[0] =>
  ({
    request: new Request(url, { method: "POST" }),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "secret-token",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/admin/rebuild-screener",
  }) as unknown as Parameters<typeof onRequestPost>[0];

describe("/api/admin/rebuild-screener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({ delete: vi.fn(async () => true) }) as unknown as Cache),
    };
  });

  it("returns 401 when token is invalid", async () => {
    const response = await onRequestPost(
      makeContext("http://localhost/api/admin/rebuild-screener?token=wrong"),
    );
    expect(response.status).toBe(401);
  });

  it("rebuilds snapshot when token is valid", async () => {
    const response = await onRequestPost(
      makeContext("http://localhost/api/admin/rebuild-screener?token=secret-token"),
    );
    const body = (await response.json()) as { ok: boolean; summary: { topStored: number } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.summary.topStored).toBeGreaterThanOrEqual(1);
  });
});

