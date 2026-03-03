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
      score: 81,
      resistance: {
        price: 101800,
        zoneLow: 101200,
        zoneHigh: 102100,
        touches: 3,
      },
      distanceToR: 0.018,
      breakDate: null,
      contractions: [
        {
          peakTime: "2025-01-03",
          troughTime: "2025-01-05",
          peak: 103000,
          trough: 93000,
          depth: 0.097,
          durationBars: 6,
        },
        {
          peakTime: "2025-01-06",
          troughTime: "2025-01-08",
          peak: 102400,
          trough: 96200,
          depth: 0.061,
          durationBars: 5,
        },
      ],
      atr: {
        atrPct20: 0.018,
        atrPct120: 0.029,
        shrink: true,
      },
      leadership: {
        label: "STRONG",
        ret63: 0.09,
        ret126: 0.16,
      },
      pivot: {
        label: "PIVOT_READY",
        nearHigh52: true,
        newHigh52: false,
        pivotReady: true,
      },
      volume: {
        dryUp: true,
        dryUpStrength: "STRONG",
        volRatioLast: 1.62,
        volRatioAvg10: 0.61,
      },
      rs: {
        index: "KOSPI",
        ok: true,
        rsVsMa90: true,
        rsRet63: 0.12,
      },
      risk: {
        invalidLow: 98000,
        entryRef: 102100,
        riskPct: 0.04,
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
        baseSpanBars: 48,
        baseLenOk: true,
        baseDepthMax: 0.097,
        gapCrashFlags: 0,
      },
      reasons: ["VCP 테스트"],
    },
    cupHandle: {
      detected: true,
      state: "POTENTIAL",
      score: 68,
      neckline: 101500,
      breakout: false,
      cupDepthPct: 24.3,
      handleDepthPct: 8.1,
      cupWidthBars: 52,
      handleBars: 11,
      reasons: ["컵앤핸들 후보 구간입니다."],
    },
  },
  scoring: {
    all: { score: 80, confidence: 72 },
    volume: { score: 75, confidence: 70 },
    hs: { score: 20, confidence: 30 },
    ihs: { score: 78, confidence: 74 },
    vcp: { score: 81, confidence: 79 },
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
  changeSummary: {
    generatedAt: "2025-01-10T15:40:00+09:00",
    basisTopN: 30,
    added: [
      {
        code: "005930",
        name: "삼성전자",
        market: "KOSPI",
        prevRank: null,
        currRank: 1,
        deltaRank: null,
        score: 80,
        confidence: 72,
        prevScore: null,
        currScore: 80,
        scoreDelta: null,
        prevConfidence: null,
        currConfidence: 72,
        confidenceDelta: null,
      },
    ],
    removed: [],
    risers: [],
    fallers: [],
    scoreRisers: [],
    scoreFallers: [],
  },
  validationSummary: {
    updatedAt: "2025-01-10T15:40:00+09:00",
    lastWeeklyAt: "2025-01-10T15:40:00+09:00",
    lastMonthlyAt: "2025-01-01T06:00:00+09:00",
    activeCutoffs: {
      all: 52,
      volume: 60,
      hs: 68,
      ihs: 64,
      vcp: 80,
    },
    latestRuns: {
      weekly: {
        period: "weekly",
        generatedAt: "2025-01-10T15:40:00+09:00",
        sampleCount: 120,
        cutoffs: {
          all: 52,
          volume: 60,
          hs: 68,
          ihs: 64,
          vcp: 80,
        },
        strategies: {
          all: {
            trades: 100,
            winRate: 56,
            pf: 1.2,
            mdd: -11,
            quality: 70,
            recommendedCutoff: 52,
          },
          volume: {
            trades: 80,
            winRate: 57,
            pf: 1.25,
            mdd: -10,
            quality: 71,
            recommendedCutoff: 60,
          },
          hs: {
            trades: 0,
            winRate: null,
            pf: null,
            mdd: null,
            quality: 65,
            recommendedCutoff: 68,
          },
          ihs: {
            trades: 52,
            winRate: 54,
            pf: 1.18,
            mdd: -12,
            quality: 69,
            recommendedCutoff: 64,
          },
          vcp: {
            trades: 48,
            winRate: 58,
            pf: 1.29,
            mdd: -9,
            quality: 73,
            recommendedCutoff: 80,
          },
        },
      },
      monthly: null,
    },
  },
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
      meta: {
        rebuildRequired: boolean;
        market: string;
        strategy: string;
        changeSummary: {
          scoreRisers: unknown[];
          scoreFallers: unknown[];
        } | null;
        validationSummary: {
          activeCutoffs: { vcp: number };
        } | null;
      };
      items: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(false);
    expect(body.meta.market).toBe("KOSPI");
    expect(body.meta.strategy).toBe("ALL");
    expect(body.meta.changeSummary?.scoreRisers.length).toBe(0);
    expect(body.meta.changeSummary?.scoreFallers.length).toBe(0);
    expect(body.meta.validationSummary?.activeCutoffs.vcp).toBe(80);
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
