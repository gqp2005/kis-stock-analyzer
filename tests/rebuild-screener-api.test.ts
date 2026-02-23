import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../functions/lib/types";
import { getCachedJson } from "../functions/lib/cache";

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
  fetchKospiIndexCandles: vi.fn(async () => ({
    index: "KOSPI",
    candles: Array.from({ length: 320 }, (_, index) => ({
      time: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open: 2500 + index * 0.5,
      high: 2505 + index * 0.5,
      low: 2495 + index * 0.5,
      close: 2502 + index * 0.5,
      volume: 1000000 + index * 1000,
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
      vcp: {
        detected: true,
        state: "POTENTIAL",
        score: 82,
        resistance: {
          price: 101000,
          zoneLow: 100400,
          zoneHigh: 101600,
          touches: 3,
        },
        distanceToR: 0.02,
        breakDate: null,
        contractions: [
          {
            peakTime: "2025-01-03",
            troughTime: "2025-01-05",
            peak: 103000,
            trough: 92000,
            depth: 0.107,
            durationBars: 6,
          },
          {
            peakTime: "2025-01-06",
            troughTime: "2025-01-08",
            peak: 101500,
            trough: 95500,
            depth: 0.059,
            durationBars: 5,
          },
        ],
        atr: {
          atrPct20: 0.017,
          atrPct120: 0.028,
          shrink: true,
        },
        leadership: {
          label: "OK",
          ret63: 0.07,
          ret126: 0.13,
        },
        pivot: {
          label: "PIVOT_NEAR_52W",
          nearHigh52: true,
          newHigh52: false,
          pivotReady: false,
        },
        volume: {
          dryUp: true,
          dryUpStrength: "WEAK",
          volRatioLast: 1.22,
          volRatioAvg10: 0.69,
        },
        rs: {
          index: "KOSPI",
          ok: true,
          rsVsMa90: true,
          rsRet63: 0.08,
        },
        risk: {
          invalidLow: 97200,
          entryRef: 101600,
          riskPct: 0.043,
          riskGrade: "OK",
        },
        breakout: {
          confirmed: false,
          rule: "close>R && volRatio>=1.5",
        },
        trendPass: true,
        quality: {
          baseWidthOk: true,
          depthShrinkOk: true,
          durationOk: true,
          baseSpanBars: 44,
          baseLenOk: true,
          baseDepthMax: 0.107,
          gapCrashFlags: 0,
        },
        reasons: ["VCP 테스트"],
      },
    },
    scoring: {
      all: { score: 80, confidence: 72 },
      volume: { score: 75, confidence: 70 },
      hs: { score: 20, confidence: 30 },
      ihs: { score: 78, confidence: 74 },
      vcp: { score: 82, confidence: 79 },
    },
    reasons: {
      all: ["테스트 all"],
      volume: ["테스트 volume"],
      hs: ["테스트 hs"],
      ihs: ["테스트 ihs"],
      vcp: ["테스트 vcp"],
    },
    backtestSummary: { all: null, volume: null, hs: null, ihs: null, vcp: null },
  })),
}));

import { onRequestPost } from "../functions/api/admin/rebuild-screener/index";

const mockedGetCachedJson = vi.mocked(getCachedJson);

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
    mockedGetCachedJson.mockResolvedValue(null);
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

  it("returns 202 inProgress when another rebuild is running", async () => {
    mockedGetCachedJson
      .mockResolvedValueOnce({ startedAt: new Date().toISOString() } as never)
      .mockResolvedValueOnce(
        {
          date: "2026-02-20",
          startedAt: "2026-02-20T00:00:00+09:00",
          updatedAt: "2026-02-20T00:05:00+09:00",
          cursor: 40,
          universeCount: 500,
          processedCount: 35,
          ohlcvFailures: 2,
          insufficientData: 3,
          warnings: [],
          candidates: [],
        } as never,
      );

    const response = await onRequestPost(
      makeContext("http://localhost/api/admin/rebuild-screener?token=secret-token"),
    );
    const body = (await response.json()) as { inProgress: boolean; progress: { processed: number } };

    expect(response.status).toBe(202);
    expect(body.inProgress).toBe(true);
    expect(body.progress.processed).toBe(40);
  });
});
