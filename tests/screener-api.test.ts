import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowIsoKst } from "../functions/lib/market";
import type { ScreenerStoredCandidate } from "../functions/lib/screener";
import type { ScreenerSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(),
  putCachedJson: vi.fn(async () => undefined),
}));

vi.mock("../functions/lib/screenerPersistence", () => ({
  getPersistedJson: vi.fn(async () => null),
  persistenceBackend: vi.fn(() => "none"),
}));

import { onRequestGet } from "../functions/api/screener";
import { getCachedJson, putCachedJson } from "../functions/lib/cache";
import {
  getPersistedJson,
  persistenceBackend,
} from "../functions/lib/screenerPersistence";

const getCachedJsonMock = vi.mocked(getCachedJson);
const putCachedJsonMock = vi.mocked(putCachedJson);
const getPersistedJsonMock = vi.mocked(getPersistedJson);
const persistenceBackendMock = vi.mocked(persistenceBackend);

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
    washoutPullback: {
      detected: true,
      state: "PULLBACK_READY",
      score: 82,
      confidence: 74,
      anchorTurnoverRatio: 3.8,
      reentryTurnoverRatio: 2.1,
      pullbackZone: {
        low: 98500,
        high: 100800,
      },
      invalidPrice: 97200,
      riskPct: 0.035,
      position: "IN_ZONE",
      reasons: ["앵커 이후 조정과 재유입이 확인되었습니다."],
      warnings: ["invalidLow 이탈 시 전략 무효입니다."],
    },
    darvasRetest: {
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      boxHigh: null,
      boxLow: null,
      breakoutDate: null,
      retestDate: null,
      reasons: ["darvas none"],
    },
    nr7InsideBar: {
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      setupDate: null,
      triggerHigh: null,
      triggerLow: null,
      breakoutDate: null,
      breakoutDirection: "NONE",
      reasons: ["nr7 none"],
    },
    trendTemplate: {
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      nearHigh52wPct: null,
      reasons: ["trend none"],
    },
    rsiDivergence: {
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      neckline: null,
      breakoutDate: null,
      reasons: ["rsi none"],
    },
    flowPersistence: {
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      upVolumeRatio20: null,
      obvSlope20: null,
      reasons: ["flow none"],
    },
  },
  scoring: {
    all: { score: 80, confidence: 72 },
    volume: { score: 75, confidence: 70 },
    hs: { score: 20, confidence: 30 },
    ihs: { score: 78, confidence: 74 },
    vcp: { score: 81, confidence: 79 },
    washoutPullback: { score: 82, confidence: 74 },
    darvasRetest: { score: 0, confidence: 0 },
    nr7InsideBar: { score: 0, confidence: 0 },
    trendTemplate: { score: 0, confidence: 0 },
    rsiDivergence: { score: 0, confidence: 0 },
    flowPersistence: { score: 0, confidence: 0 },
  },
  reasons: {
    all: ["테스트 all"],
    volume: ["테스트 volume"],
    hs: ["테스트 hs"],
    ihs: ["테스트 ihs"],
    vcp: ["테스트 vcp"],
    washoutPullback: ["테스트 washout"],
    darvasRetest: ["darvas none"],
    nr7InsideBar: ["nr7 none"],
    trendTemplate: ["trend none"],
    rsiDivergence: ["rsi none"],
    flowPersistence: ["flow none"],
  },
  backtestSummary: {
    all: null,
    volume: null,
    hs: null,
    ihs: null,
    vcp: null,
    washoutPullback: null,
    darvasRetest: null,
    nr7InsideBar: null,
    trendTemplate: null,
    rsiDivergence: null,
    flowPersistence: null,
  },
  wangStrategy: {
    eligible: true,
    label: "적립 후보",
    score: 84,
    confidence: 79,
    currentPhase: "REACCUMULATION",
    actionBias: "ACCUMULATE",
    executionState: "READY_ON_RETEST",
    reasons: ["주봉 최소거래량 이후 zone 재확인 구간입니다."],
    weekBias: "재축적 · 주봉 최소거래량 이후 zone 확인",
    dayBias: "재접근 적립 후보 · 일봉 zone 재확인",
    zoneReady: true,
    ma20DiscountReady: true,
    dailyRebaseReady: true,
    retestReady: true,
  },
  rs: {
    benchmark: "KOSPI",
    ret63Diff: 0.05,
    label: "STRONG",
  },
  tuning: {
    thresholds: {
      volume: 60,
      hs: 68,
      ihs: 64,
      vcp: 80,
    },
    quality: 74,
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
    getPersistedJsonMock.mockResolvedValue(null);
    persistenceBackendMock.mockReturnValue("none");
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns cached snapshot immediately", async () => {
    const today = nowIsoKst().slice(0, 10);
    const todaySnapshot: ScreenerSnapshot = {
      ...sampleSnapshot,
      date: today,
      updatedAt: `${today}T06:10:51+09:00`,
    };

    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      return todaySnapshot as never;
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
      items: Array<{ code: string; wangStrategy: { eligible: boolean; label: string; score: number } }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(false);
    expect(body.meta.market).toBe("KOSPI");
    expect(body.meta.strategy).toBe("ALL");
    expect(body.meta.changeSummary?.scoreRisers.length).toBe(0);
    expect(body.meta.changeSummary?.scoreFallers.length).toBe(0);
    expect(body.meta.validationSummary?.activeCutoffs.vcp).toBe(80);
    expect(body.items[0]?.code).toBe("005930");
    expect(body.items[0]?.wangStrategy.eligible).toBe(true);
    expect(body.items[0]?.wangStrategy.label).toBe("적립 후보");
    expect(body.items[0]?.wangStrategy.score).toBe(84);
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

  it("hydrates today's persisted snapshot and clears rebuildRequired on cache miss", async () => {
    const today = nowIsoKst().slice(0, 10);
    const todaySnapshot: ScreenerSnapshot = {
      ...sampleSnapshot,
      date: today,
      updatedAt: `${today}T06:10:51+09:00`,
      warnings: [
        "리빌드 초기화 중입니다. 잠시 후 진행률이 갱신됩니다.",
        "External/Backup 소스 실패로 StaticProvider 유니버스를 사용했습니다.",
        "데이터 부족 12종목 제외",
        "데이터 부족 88종목 제외",
      ],
    };

    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      if (keyText.includes("market=ALL:strategy=ALL:last_success")) {
        return { ...sampleSnapshot, date: "2025-01-10" } as never;
      }
      return null as never;
    });
    getPersistedJsonMock.mockImplementation(async (_env, key) => {
      if (String(key).includes(`snapshot:date:${today}`)) return todaySnapshot as never;
      return null as never;
    });
    persistenceBackendMock.mockReturnValue("kv");

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=ALL&strategy=ALL&count=30"),
    );
    const body = (await response.json()) as {
      meta: { rebuildRequired: boolean; lastUpdatedAt: string | null };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(false);
    expect(body.meta.lastUpdatedAt).toBe(todaySnapshot.updatedAt);
    expect(putCachedJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(`screener:v1:market=ALL:strategy=ALL:${today}`),
      todaySnapshot,
      expect.any(Number),
    );
    expect(body.warnings.some((warning) => warning.includes("재빌드"))).toBe(false);
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

  it("supports strategy=WASHOUT_PULLBACK filters", async () => {
    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      return sampleSnapshot as never;
    });

    const response = await onRequestGet(
      makeContext(
        "http://localhost/api/screener?market=ALL&strategy=WASHOUT_PULLBACK&state=PULLBACK_READY&position=IN_ZONE&riskPctMax=0.08&count=30",
      ),
    );
    const body = (await response.json()) as {
      meta: {
        strategy: string;
        filters?: {
          washoutState: string;
          washoutPosition: string;
          washoutRiskMax: number | null;
        };
      };
      items: Array<{
        code: string;
        hits: {
          washoutPullback: {
            detected: boolean;
            state: string;
            position: string;
          };
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.strategy).toBe("WASHOUT_PULLBACK");
    expect(body.meta.filters?.washoutState).toBe("PULLBACK_READY");
    expect(body.meta.filters?.washoutPosition).toBe("IN_ZONE");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.hits.washoutPullback.detected).toBe(true);
    expect(body.items[0]?.hits.washoutPullback.state).toBe("PULLBACK_READY");
  });

  it("supports wangStrategy validation filters", async () => {
    getCachedJsonMock.mockImplementation(async (_cache, key) => {
      const keyText = String(key);
      if (keyText.includes("rebuild-progress")) return null as never;
      return sampleSnapshot as never;
    });

    const response = await onRequestGet(
      makeContext(
        "http://localhost/api/screener?market=ALL&strategy=ALL&wangEligible=YES&wangActionBias=ACCUMULATE&wangPhase=REACCUMULATION&count=30",
      ),
    );
    const body = (await response.json()) as {
      meta: {
        filters?: {
          wangEligible?: string;
          wangActionBias?: string;
          wangPhase?: string;
        };
      };
      items: Array<{ code: string; wangStrategy: { eligible: boolean; actionBias: string; currentPhase: string } }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.filters?.wangEligible).toBe("YES");
    expect(body.meta.filters?.wangActionBias).toBe("ACCUMULATE");
    expect(body.meta.filters?.wangPhase).toBe("REACCUMULATION");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.wangStrategy.eligible).toBe(true);
    expect(body.items[0]?.wangStrategy.actionBias).toBe("ACCUMULATE");
    expect(body.items[0]?.wangStrategy.currentPhase).toBe("REACCUMULATION");
  });
});
