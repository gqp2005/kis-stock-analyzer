import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedJson } from "../functions/lib/cache";
import { buildDashboardOverview } from "../functions/lib/dashboard";
import type { ScreenerSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
}));

const mockedGetCachedJson = vi.mocked(getCachedJson);

const makeCandidate = ({
  code,
  name,
  overallScore,
  confidence,
  wangStrategy,
}: {
  code: string;
  name: string;
  overallScore: number;
  confidence: number;
  wangStrategy: Record<string, unknown>;
}) =>
  ({
    code,
    name,
    market: "KOSPI",
    lastClose: 10000,
    lastDate: "2026-04-03",
    scoring: {
      all: { score: overallScore, confidence },
      volume: { score: 60, confidence: 58 },
      vcp: { score: 55, confidence: 54 },
      washoutPullback: { score: 40, confidence: 45 },
      darvasRetest: { score: 0, confidence: 0 },
      nr7InsideBar: { score: 0, confidence: 0 },
      trendTemplate: { score: 0, confidence: 0 },
      rsiDivergence: { score: 0, confidence: 0 },
      flowPersistence: { score: 0, confidence: 0 },
      ihs: { score: 0, confidence: 0 },
      hs: { score: 0, confidence: 0 },
    },
    rs: {
      label: "STRONG",
    },
    hits: {
      volume: { score: 60, confidence: 58, volRatio: 1.1, patterns: [] },
      cupHandle: { detected: false, state: "NONE" },
      washoutPullback: { detected: false, state: "NONE", score: 0, confidence: 0 },
      vcp: { detected: false, state: "NONE" },
      darvasRetest: { detected: false, breakoutDate: null, state: "NONE", score: 0, confidence: 0 },
      nr7InsideBar: { detected: false, breakoutDate: null, setupDate: null, state: "NONE", score: 0, confidence: 0 },
      trendTemplate: { detected: false },
      rsiDivergence: { detected: false, breakoutDate: null, state: "NONE", score: 0, confidence: 0 },
      flowPersistence: { detected: false },
      hs: { detected: false, state: "NONE", breakDate: null, score: 0, confidence: 0 },
      ihs: { detected: false, state: "NONE", breakDate: null, score: 0, confidence: 0 },
    },
    reasons: {
      all: ["후보 종합 사유"],
      washoutPullback: ["설거지 사유"],
      darvasRetest: ["다르바스 사유"],
      nr7InsideBar: ["NR7 사유"],
      rsiDivergence: ["RSI 사유"],
      hs: ["H&S 사유"],
      ihs: ["IHS 사유"],
    },
    backtestSummary: {
      volume: null,
      vcp: null,
      washoutPullback: null,
      darvasRetest: null,
      nr7InsideBar: null,
      trendTemplate: null,
      rsiDivergence: null,
      flowPersistence: null,
      ihs: null,
      hs: null,
    },
    wangStrategy,
  }) as any;

describe("buildDashboardOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds wang validation distribution, ranking, timeline, and favorite state", async () => {
    const snapshot: ScreenerSnapshot = {
      date: "2026-04-03",
      updatedAt: "2026-04-03T05:00:00+09:00",
      universeCount: 3,
      processedCount: 3,
      topN: 3,
      source: "KIS",
      warnings: [],
      topCandidates: [],
      candidates: [
        makeCandidate({
          code: "111111",
          name: "적립후보",
          overallScore: 82,
          confidence: 78,
          wangStrategy: {
            eligible: true,
            label: "적립 후보",
            score: 86,
            confidence: 79,
            currentPhase: "MIN_VOLUME",
            actionBias: "ACCUMULATE",
            executionState: "READY_ON_ZONE",
            reasons: ["최소거래량 이후 zone 재접근입니다."],
            weekBias: "주봉 최소거래량 구간입니다.",
            dayBias: "일봉 zone 재접근입니다.",
            zoneReady: true,
            ma20DiscountReady: true,
            dailyRebaseReady: true,
            retestReady: true,
          },
        }),
        makeCandidate({
          code: "222222",
          name: "관찰후보",
          overallScore: 68,
          confidence: 63,
          wangStrategy: {
            eligible: false,
            label: "관찰 후보",
            score: 64,
            confidence: 61,
            currentPhase: "BASE_VOLUME",
            actionBias: "WATCH",
            executionState: "WAIT_PULLBACK",
            reasons: ["주봉 기준거래량 반복 구간입니다."],
            weekBias: "주봉 기준거래량 반복입니다.",
            dayBias: "일봉 눌림을 기다립니다.",
            zoneReady: false,
            ma20DiscountReady: false,
            dailyRebaseReady: false,
            retestReady: false,
          },
        }),
        makeCandidate({
          code: "333333",
          name: "비적합",
          overallScore: 41,
          confidence: 48,
          wangStrategy: {
            eligible: false,
            label: "비적합",
            score: 18,
            confidence: 36,
            currentPhase: "NONE",
            actionBias: "CAUTION",
            executionState: "AVOID_BREAKDOWN",
            reasons: ["주봉 구조와 일봉 실행 조건이 모두 약합니다."],
            weekBias: "주봉 미감지",
            dayBias: "일봉 실행 근거 부족",
            zoneReady: false,
            ma20DiscountReady: false,
            dailyRebaseReady: false,
            retestReady: false,
          },
        }),
      ],
    };

    mockedGetCachedJson.mockResolvedValue(snapshot);

    const result = await buildDashboardOverview({} as any, {} as Cache, ["111111"]);

    expect(result.marketTemperature.wangEligibleCount).toBe(1);
    expect(result.marketTemperature.wangWatchCount).toBe(1);
    expect(result.marketTemperature.wangIneligibleCount).toBe(1);

    expect(result.wangValidation.totalValidated).toBe(3);
    expect(result.wangValidation.distribution.eligible).toBe(1);
    expect(result.wangValidation.distribution.watchCandidate).toBe(1);
    expect(result.wangValidation.distribution.notEligible).toBe(1);
    expect(result.wangValidation.ranking.byActionBias[0]?.scoreMode).toBe("validation");
    expect(result.wangValidation.ranking.byPhase.some((item) => item.key === "wangPhase:MIN_VOLUME")).toBe(true);

    const wangTimeline = result.timeline.find((item) => item.strategyKey === "wangStrategy");
    expect(wangTimeline?.wangPhase).toBe("MIN_VOLUME");
    expect(wangTimeline?.wangActionBias).toBe("ACCUMULATE");
    expect(wangTimeline?.scoreMode).toBe("validation");

    expect(result.favorites.alerts[0]?.wangPhase).toBe("MIN_VOLUME");
    expect(result.favorites.alerts[0]?.wangActionBias).toBe("ACCUMULATE");
  });
});
