import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenerStoredCandidate } from "../functions/lib/screener";
import type { ScreenerSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(),
  putCachedJson: vi.fn(async () => undefined),
}));

import { onRequestGet } from "../functions/api/screener";
import { getCachedJson } from "../functions/lib/cache";

const getCachedJsonMock = vi.mocked(getCachedJson);

const sampleCandidate: ScreenerStoredCandidate = {
  code: "005930",
  name: "삼성전자",
  market: "KOSPI",
  lastClose: 100000,
  lastDate: "2025-01-10",
  levels: {
    support: 98000,
    resistance: 103000,
    neckline: 100500,
  },
  hits: {
    volume: {
      score: 75,
      confidence: 70,
      volRatio: 1.3,
      patterns: ["BreakoutConfirmed"],
      reasons: ["거래량 패턴 테스트"],
    },
    hs: {
      detected: false,
      state: "NONE",
      neckline: null,
      breakDate: null,
      target: null,
      score: 20,
      confidence: 30,
      reasons: ["hs 없음"],
    },
    ihs: {
      detected: true,
      state: "CONFIRMED",
      neckline: 100500,
      breakDate: "2025-01-09",
      target: 108000,
      score: 78,
      confidence: 74,
      reasons: ["ihs 확인"],
    },
    vcp: {
      detected: true,
      state: "POTENTIAL",
      score: 71,
      resistanceR: 101800,
      distanceToR: 0.018,
      breakDate: null,
      contractions: [
        {
          peakTime: "2025-01-03",
          troughTime: "2025-01-05",
          peak: 103000,
          trough: 93000,
          depth: 0.097,
        },
        {
          peakTime: "2025-01-06",
          troughTime: "2025-01-08",
          peak: 102400,
          trough: 96200,
          depth: 0.061,
        },
      ],
      atrShrink: true,
      volumeDryUp: true,
      trendPass: true,
      atrPctMean20: 0.018,
      atrPctMean120: 0.029,
      reasons: ["VCP 테스트"],
    },
  },
  scoring: {
    all: { score: 80, confidence: 72 },
    volume: { score: 75, confidence: 70 },
    hs: { score: 20, confidence: 30 },
    ihs: { score: 78, confidence: 74 },
    vcp: { score: 71, confidence: 69 },
  },
  reasons: {
    all: ["테스트 all"],
    volume: ["테스트 volume"],
    hs: ["테스트 hs"],
    ihs: ["테스트 ihs"],
    vcp: ["테스트 vcp"],
  },
  backtestSummary: {
    all: null,
    volume: null,
    hs: null,
    ihs: null,
    vcp: null,
  },
};

const sampleSnapshot: ScreenerSnapshot = {
  date: "2025-01-10",
  updatedAt: "2025-01-10T15:40:00+09:00",
  universeCount: 500,
  processedCount: 480,
  topN: 50,
  source: "KIS",
  warnings: [],
  candidates: [sampleCandidate],
  topCandidates: [sampleCandidate],
};

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "admin",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/screener",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/screener (cache-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns cached snapshot immediately", async () => {
    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      return sampleSnapshot as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=KOSPI&strategy=ALL&count=30"),
    );
    const body = (await response.json()) as {
      meta: { rebuildRequired: boolean; market: string; strategy: string };
      items: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(false);
    expect(body.meta.market).toBe("KOSPI");
    expect(body.meta.strategy).toBe("ALL");
    expect(body.items[0]?.code).toBe("005930");
  });

  it("returns last-success snapshot with rebuildRequired on cache miss", async () => {
    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      if (keyText.includes("market=ALL:strategy=ALL:last_success")) return sampleSnapshot as never;
      if (keyText.includes("market=ALL:strategy=ALL:")) return null as never;
      return null as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=ALL&strategy=ALL&count=30"),
    );
    const body = (await response.json()) as {
      meta: { rebuildRequired: boolean };
      warnings: string[];
      items: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.warnings.some((warning) => warning.includes("재빌드"))).toBe(true);
  });

  it("supports strategy=VCP filter", async () => {
    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      return sampleSnapshot as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=ALL&strategy=VCP&count=30"),
    );
    const body = (await response.json()) as {
      meta: { strategy: string };
      items: Array<{ code: string; hits: { vcp: { detected: boolean } } }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.strategy).toBe("VCP");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.hits.vcp.detected).toBe(true);
  });
});
