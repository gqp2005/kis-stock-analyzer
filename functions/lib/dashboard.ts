import { listPersistedByPrefix } from "./screenerPersistence";
import {
  loadScreenerSnapshotBundle,
  sanitizeUserScreenerWarnings,
} from "./screenerSnapshot";
import {
  type ScreenerChangeSummary,
  type ScreenerSnapshot,
  persistChangeHistoryPrefix,
} from "./screenerStore";
import type { Env } from "./types";
import type { ScreenerStoredCandidate } from "./screener";
import { nowIsoKst } from "./market";

export interface FavoriteAlertItem {
  code: string;
  name: string;
  market: string;
  lastDate: string;
  lastClose: number;
  severity: "positive" | "neutral" | "warning";
  title: string;
  summary: string;
  reasons: string[];
  wangPhase?: string | null;
  wangActionBias?: string | null;
}

export interface StrategyRankingItem {
  key: string;
  label: string;
  scoreMode?: "primary" | "validation";
  candidateCount: number;
  avgScore: number | null;
  avgConfidence: number | null;
  avgWinRate: number | null;
  avgPf: number | null;
  avgMdd: number | null;
  qualityScore: number | null;
  topSymbols: string[];
}

export interface StrategyTimelineEvent {
  date: string;
  code: string;
  name: string;
  market: string;
  strategyKey: string;
  strategyLabel: string;
  stateLabel: string;
  score: number;
  confidence: number | null;
  summary: string;
  wangPhase?: string | null;
  wangActionBias?: string | null;
  scoreMode?: "primary" | "validation";
}

export interface WangValidationDistribution {
  eligible: number;
  watchCandidate: number;
  notEligible: number;
  byActionBias: Record<"ACCUMULATE" | "WATCH" | "CAUTION" | "OVERHEAT", number>;
  byPhase: Array<{
    phase: string;
    count: number;
  }>;
}

export interface WangValidationOverview {
  totalValidated: number;
  summary: string;
  distribution: WangValidationDistribution;
  ranking: {
    byActionBias: StrategyRankingItem[];
    byPhase: StrategyRankingItem[];
  };
}

export interface MarketTemperatureSummary {
  totalCandidates: number;
  avgScore: number | null;
  avgConfidence: number | null;
  strongCount: number;
  neutralCount: number;
  cautionCount: number;
  rsStrongCount: number;
  rsWeakCount: number;
  cupHandleCount: number;
  washoutCount: number;
  vcpCount: number;
  darvasCount: number;
  nr7Count: number;
  trendTemplateCount: number;
  rsiDivergenceCount: number;
  flowPersistenceCount: number;
  wangEligibleCount: number;
  wangAccumulateCount: number;
  wangWatchCount: number;
  wangIneligibleCount: number;
  heatScore: number;
  heatLabel: "강세" | "중립" | "혼조" | "위축";
  summary: string;
}

export interface DashboardOverviewPayload {
  meta: {
    asOf: string;
    lastUpdatedAt: string | null;
    snapshotDate: string | null;
    universeLabel: string;
    source: "KIS";
    candidateCount: number;
  };
  marketTemperature: MarketTemperatureSummary;
  strategyRanking: StrategyRankingItem[];
  wangValidation: WangValidationOverview;
  timeline: StrategyTimelineEvent[];
  favorites: {
    trackedCount: number;
    activeCount: number;
    missingCodes: string[];
    alerts: FavoriteAlertItem[];
  };
  warnings: string[];
}

const average = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const round = (value: number | null): number | null =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;

const fallbackWangStrategy = () => ({
  eligible: false,
  label: "비적합" as const,
  score: 0,
  confidence: 0,
  currentPhase: "NONE" as const,
  actionBias: "WATCH" as const,
  executionState: "WAIT_WEEKLY_STRUCTURE" as const,
  reasons: ["왕장군 검증 데이터가 없습니다."],
  weekBias: "주봉 미평가",
  dayBias: "일봉 미평가",
  zoneReady: false,
  ma20DiscountReady: false,
  dailyRebaseReady: false,
  retestReady: false,
});

const getWangStrategy = (candidate: ScreenerStoredCandidate) =>
  candidate.wangStrategy ?? fallbackWangStrategy();

const isWangWatchCandidate = (candidate: ScreenerStoredCandidate): boolean => {
  const wang = getWangStrategy(candidate);
  return !wang.eligible && wang.label !== "비적합";
};

const wangValidationSummaryLabel = (candidate: ScreenerStoredCandidate): string => {
  const wang = getWangStrategy(candidate);
  if (wang.eligible) return "적립 후보";
  if (isWangWatchCandidate(candidate)) return "관찰 후보";
  return "비적합";
};

const wangPhaseLabel = (phase: string): string => {
  if (phase === "LIFE_VOLUME") return "인생거래량";
  if (phase === "BASE_VOLUME") return "기준거래량";
  if (phase === "RISING_VOLUME") return "상승거래량";
  if (phase === "ELASTIC_VOLUME") return "탄력거래량";
  if (phase === "MIN_VOLUME") return "최소거래량";
  if (phase === "REACCUMULATION") return "재축적";
  return "미감지";
};

const wangActionBiasLabel = (bias: string): string => {
  if (bias === "ACCUMULATE") return "적립";
  if (bias === "CAUTION") return "경계";
  if (bias === "OVERHEAT") return "과열";
  return "관찰";
};

export const loadLatestScreenerSnapshot = async (
  env: Env,
  cache: Cache,
): Promise<{ snapshot: ScreenerSnapshot | null; warnings: string[] }> => {
  const today = nowIsoKst().slice(0, 10);
  const { snapshot, isToday } = await loadScreenerSnapshotBundle(env, cache, today);
  const warnings: string[] = [];
  if (!snapshot) {
    warnings.push("스크리너 스냅샷이 없어 대시보드 집계를 생성하지 못했습니다.");
  } else if (!isToday) {
    warnings.push("오늘 스냅샷이 없어 마지막 성공 스냅샷 기준으로 대시보드를 표시합니다.");
  }
  return { snapshot, warnings };
};

const classifyOverallBucket = (score: number): "strong" | "neutral" | "caution" => {
  if (score >= 70) return "strong";
  if (score >= 45) return "neutral";
  return "caution";
};

const washoutStateLabel = (state: string): string => {
  if (state === "REBOUND_CONFIRMED") return "반등 확인";
  if (state === "PULLBACK_READY") return "눌림 준비";
  if (state === "WASHOUT_CANDIDATE") return "설거지 후보";
  if (state === "ANCHOR_DETECTED") return "대금 흔적";
  return "미감지";
};

const patternStateLabel = (state: string): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "미감지";
};

const buildFavoriteAlert = (candidate: ScreenerStoredCandidate): FavoriteAlertItem => {
  const wangStrategy = getWangStrategy(candidate);
  if (candidate.hits.hs.state === "CONFIRMED") {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      lastDate: candidate.lastDate,
      lastClose: candidate.lastClose,
      severity: "warning",
      title: "하락 패턴 경고",
      summary: "H&S 확정 신호가 있어 신규 접근보다 방어 대응이 우선입니다.",
      reasons: candidate.reasons.hs.slice(0, 2),
    };
  }
  if (wangStrategy.eligible) {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      lastDate: candidate.lastDate,
      lastClose: candidate.lastClose,
      severity: "positive",
      title: "왕장군 적립 후보",
      summary: `${wangActionBiasLabel(wangStrategy.actionBias)} · ${wangPhaseLabel(wangStrategy.currentPhase)} · ${wangStrategy.dayBias}`,
      reasons: wangStrategy.reasons.slice(0, 2),
      wangPhase: wangStrategy.currentPhase,
      wangActionBias: wangStrategy.actionBias,
    };
  }
  if (candidate.hits.washoutPullback.state === "REBOUND_CONFIRMED") {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      lastDate: candidate.lastDate,
      lastClose: candidate.lastClose,
      severity: "positive",
      title: "설거지 반등 재개",
      summary: "설거지+눌림목 반등 확인 단계로 눌림 유지 여부를 함께 볼 구간입니다.",
      reasons: candidate.reasons.washoutPullback.slice(0, 2),
    };
  }
  if (candidate.hits.cupHandle.state === "CONFIRMED") {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      lastDate: candidate.lastDate,
      lastClose: candidate.lastClose,
      severity: "positive",
      title: "컵앤핸들 돌파 확인",
      summary: "컵앤핸들 확정 구간으로 추세 지속 가능성을 점검할 수 있습니다.",
      reasons: candidate.hits.cupHandle.reasons.slice(0, 2),
    };
  }
  if (candidate.hits.vcp.state === "CONFIRMED" || candidate.hits.vcp.state === "POTENTIAL") {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      lastDate: candidate.lastDate,
      lastClose: candidate.lastClose,
      severity: candidate.hits.vcp.state === "CONFIRMED" ? "positive" : "neutral",
      title: candidate.hits.vcp.state === "CONFIRMED" ? "VCP 확정" : "VCP 후보",
      summary:
        candidate.hits.vcp.state === "CONFIRMED"
          ? "VCP 저항 돌파 흐름이 확인됐습니다."
          : "VCP 후보 단계로 저항 돌파와 거래량 확증을 대기하는 구간입니다.",
      reasons: candidate.reasons.vcp.slice(0, 2),
    };
  }
  return {
    code: candidate.code,
    name: candidate.name,
    market: candidate.market,
    lastDate: candidate.lastDate,
    lastClose: candidate.lastClose,
    severity: candidate.scoring.all.score >= 70 ? "positive" : "neutral",
    title: candidate.scoring.all.score >= 70 ? "점수 강세" : "관찰 유지",
    summary:
      candidate.scoring.all.score >= 70
        ? "종합 점수와 신뢰도가 유지돼 관심종목 관찰 우선순위가 높습니다."
        : "현재는 강한 확정 신호보다 점수 변화를 관찰할 구간입니다.",
    reasons: candidate.reasons.all.slice(0, 2),
    wangPhase: wangStrategy.currentPhase,
    wangActionBias: wangStrategy.actionBias,
  };
};

const buildMarketTemperature = (candidates: ScreenerStoredCandidate[]): MarketTemperatureSummary => {
  const total = candidates.length;
  const scores = candidates.map((item) => item.scoring.all.score);
  const confidences = candidates.map((item) => item.scoring.all.confidence);
  let strongCount = 0;
  let neutralCount = 0;
  let cautionCount = 0;
  for (const score of scores) {
    const bucket = classifyOverallBucket(score);
    if (bucket === "strong") strongCount += 1;
    else if (bucket === "neutral") neutralCount += 1;
    else cautionCount += 1;
  }
  const rsStrongCount = candidates.filter((item) => item.rs.label === "STRONG").length;
  const rsWeakCount = candidates.filter((item) => item.rs.label === "WEAK").length;
  const cupHandleCount = candidates.filter(
    (item) => item.hits.cupHandle.detected || item.hits.cupHandle.state !== "NONE",
  ).length;
  const washoutCount = candidates.filter(
    (item) => item.hits.washoutPullback.detected && item.hits.washoutPullback.state !== "NONE",
  ).length;
  const vcpCount = candidates.filter((item) => item.hits.vcp.detected && item.hits.vcp.state !== "NONE").length;
  const darvasCount = candidates.filter((item) => item.hits.darvasRetest.detected).length;
  const nr7Count = candidates.filter((item) => item.hits.nr7InsideBar.detected).length;
  const trendTemplateCount = candidates.filter((item) => item.hits.trendTemplate.detected).length;
  const rsiDivergenceCount = candidates.filter((item) => item.hits.rsiDivergence.detected).length;
  const flowPersistenceCount = candidates.filter((item) => item.hits.flowPersistence.detected).length;
  const wangEligibleCount = candidates.filter((item) => getWangStrategy(item).eligible).length;
  const wangAccumulateCount = candidates.filter(
    (item) => getWangStrategy(item).actionBias === "ACCUMULATE",
  ).length;
  const wangWatchCount = candidates.filter((item) => {
    const wang = getWangStrategy(item);
    return !wang.eligible && wang.label !== "비적합";
  }).length;
  const wangIneligibleCount = Math.max(total - wangEligibleCount - wangWatchCount, 0);
  const wangWatchCountNormalized = candidates.filter((item) => isWangWatchCandidate(item)).length;
  const wangIneligibleCountNormalized = Math.max(total - wangEligibleCount - wangWatchCountNormalized, 0);
  const avgScore = round(average(scores));
  const avgConfidence = round(average(confidences));
  const strongRatio = total > 0 ? strongCount / total : 0;
  const cautionRatio = total > 0 ? cautionCount / total : 0;
  const rsRatio = total > 0 ? rsStrongCount / total : 0;
  const wangRatio = total > 0 ? wangEligibleCount / total : 0;
  const heatScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (avgScore ?? 0) * 0.48 +
          (avgConfidence ?? 0) * 0.18 +
          strongRatio * 18 +
          rsRatio * 14 +
          wangRatio * 12 -
          cautionRatio * 15,
      ),
    ),
  );
  const heatLabel =
    heatScore >= 75 ? "강세" : heatScore >= 55 ? "중립" : heatScore >= 40 ? "혼조" : "위축";
  const summary =
    heatLabel === "강세"
      ? "점수·신뢰도·RS가 동반 우세해 시장 온도가 상대적으로 높은 구간입니다."
      : heatLabel === "중립"
        ? "강세 신호와 경계 신호가 혼재하지만 후보 시장은 아직 우호적입니다."
        : heatLabel === "혼조"
          ? "전략 포착은 이어지지만 강세 우위가 약해 선별 접근이 필요한 구간입니다."
          : "후보 시장의 점수와 RS 우위가 약해 방어적으로 해석하는 편이 안전합니다.";
  return {
    totalCandidates: total,
    avgScore,
    avgConfidence,
    strongCount,
    neutralCount,
    cautionCount,
    rsStrongCount,
    rsWeakCount,
    cupHandleCount,
    washoutCount,
    vcpCount,
    darvasCount,
    nr7Count,
    trendTemplateCount,
    rsiDivergenceCount,
    flowPersistenceCount,
    wangEligibleCount,
    wangAccumulateCount,
    wangWatchCount: wangWatchCountNormalized,
    wangIneligibleCount: wangIneligibleCountNormalized,
    heatScore,
    heatLabel,
    summary,
  };
};

const STRATEGY_RANKING_DEFS = [
  {
    key: "volume",
    label: "거래량 패턴",
    detected: (item: ScreenerStoredCandidate) => item.hits.volume.score >= 55,
    score: (item: ScreenerStoredCandidate) => item.scoring.volume.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.volume.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.volume,
  },
  {
    key: "vcp",
    label: "VCP",
    detected: (item: ScreenerStoredCandidate) => item.hits.vcp.detected && item.hits.vcp.state !== "NONE",
    score: (item: ScreenerStoredCandidate) => item.scoring.vcp.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.vcp.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.vcp,
  },
  {
    key: "washoutPullback",
    label: "설거지+눌림목",
    detected: (item: ScreenerStoredCandidate) =>
      item.hits.washoutPullback.detected && item.hits.washoutPullback.state !== "NONE",
    score: (item: ScreenerStoredCandidate) => item.scoring.washoutPullback.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.washoutPullback.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.washoutPullback,
  },
  {
    key: "wangStrategy",
    label: "왕장군 검증",
    detected: (item: ScreenerStoredCandidate) =>
      getWangStrategy(item).currentPhase !== "NONE" || getWangStrategy(item).score > 0,
    score: (item: ScreenerStoredCandidate) => getWangStrategy(item).score,
    confidence: (item: ScreenerStoredCandidate) => getWangStrategy(item).confidence,
    backtest: () => null,
  },
  {
    key: "darvasRetest",
    label: "다르바스",
    detected: (item: ScreenerStoredCandidate) => item.hits.darvasRetest.detected,
    score: (item: ScreenerStoredCandidate) => item.scoring.darvasRetest.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.darvasRetest.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.darvasRetest,
  },
  {
    key: "nr7InsideBar",
    label: "NR7",
    detected: (item: ScreenerStoredCandidate) => item.hits.nr7InsideBar.detected,
    score: (item: ScreenerStoredCandidate) => item.scoring.nr7InsideBar.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.nr7InsideBar.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.nr7InsideBar,
  },
  {
    key: "trendTemplate",
    label: "추세 템플릿",
    detected: (item: ScreenerStoredCandidate) => item.hits.trendTemplate.detected,
    score: (item: ScreenerStoredCandidate) => item.scoring.trendTemplate.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.trendTemplate.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.trendTemplate,
  },
  {
    key: "rsiDivergence",
    label: "RSI 다이버전스",
    detected: (item: ScreenerStoredCandidate) => item.hits.rsiDivergence.detected,
    score: (item: ScreenerStoredCandidate) => item.scoring.rsiDivergence.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.rsiDivergence.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.rsiDivergence,
  },
  {
    key: "flowPersistence",
    label: "수급 지속성",
    detected: (item: ScreenerStoredCandidate) => item.hits.flowPersistence.detected,
    score: (item: ScreenerStoredCandidate) => item.scoring.flowPersistence.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.flowPersistence.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.flowPersistence,
  },
  {
    key: "ihs",
    label: "역헤드앤숄더",
    detected: (item: ScreenerStoredCandidate) => item.hits.ihs.detected && item.hits.ihs.state !== "NONE",
    score: (item: ScreenerStoredCandidate) => item.scoring.ihs.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.ihs.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.ihs,
  },
  {
    key: "hs",
    label: "헤드앤숄더",
    detected: (item: ScreenerStoredCandidate) => item.hits.hs.detected && item.hits.hs.state !== "NONE",
    score: (item: ScreenerStoredCandidate) => item.scoring.hs.score,
    confidence: (item: ScreenerStoredCandidate) => item.scoring.hs.confidence,
    backtest: (item: ScreenerStoredCandidate) => item.backtestSummary.hs,
  },
] as const;

const buildStrategyRanking = (candidates: ScreenerStoredCandidate[]): StrategyRankingItem[] =>
  STRATEGY_RANKING_DEFS.map((definition) => {
    const matched = candidates.filter(definition.detected);
    const backtests = matched.map(definition.backtest).filter(Boolean);
    const avgScore = round(average(matched.map(definition.score).filter(Number.isFinite)));
    const avgConfidence = round(average(matched.map(definition.confidence).filter(Number.isFinite)));
    const avgWinRate = round(
      average(
        backtests
          .map((summary) => summary?.winRate)
          .filter((value): value is number => value != null && Number.isFinite(value)),
      ),
    );
    const avgPf = round(
      average(
        backtests
          .map((summary) => summary?.PF)
          .filter((value): value is number => value != null && Number.isFinite(value)),
      ),
    );
    const avgMdd = round(
      average(
        backtests
          .map((summary) => summary?.MDD)
          .filter((value): value is number => value != null && Number.isFinite(value)),
      ),
    );
    const qualityScore =
      matched.length === 0
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              Math.round((avgScore ?? 0) * 0.35 + (avgConfidence ?? 0) * 0.25 + (avgWinRate ?? 0) * 0.2 + ((avgPf ?? 0) * 20) - ((avgMdd ?? 0) * 0.15)),
            ),
          );
    return {
      key: definition.key,
      label: definition.label,
      scoreMode: definition.key === "wangStrategy" ? "validation" : "primary",
      candidateCount: matched.length,
      avgScore,
      avgConfidence,
      avgWinRate,
      avgPf,
      avgMdd,
      qualityScore,
      topSymbols: matched.slice(0, 3).map((item) => `${item.name}(${item.code})`),
    };
  }).sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1) || b.candidateCount - a.candidateCount);

const buildWangValidationOverview = (candidates: ScreenerStoredCandidate[]): WangValidationOverview => {
  const wangItems = candidates.map((candidate) => ({ candidate, wang: getWangStrategy(candidate) }));
  const totalValidated = wangItems.filter(({ wang }) => wang.currentPhase !== "NONE" || wang.score > 0).length;
  const eligible = wangItems.filter(({ wang }) => wang.eligible).length;
  const watchCandidate = wangItems.filter(({ candidate }) => isWangWatchCandidate(candidate)).length;
  const notEligible = Math.max(wangItems.length - eligible - watchCandidate, 0);

  const actionBiasOrder = [
    ["ACCUMULATE", "행동 · 적립"],
    ["WATCH", "행동 · 관찰"],
    ["CAUTION", "행동 · 경계"],
    ["OVERHEAT", "행동 · 과열"],
  ] as const;

  const byActionBias = actionBiasOrder.reduce<
    Record<"ACCUMULATE" | "WATCH" | "CAUTION" | "OVERHEAT", number>
  >(
    (acc, [key]) => {
      acc[key] = wangItems.filter(({ wang }) => wang.actionBias === key).length;
      return acc;
    },
    {
      ACCUMULATE: 0,
      WATCH: 0,
      CAUTION: 0,
      OVERHEAT: 0,
    },
  );

  const phaseEntries = new Map<string, { count: number; items: typeof wangItems }>();
  for (const entry of wangItems) {
    const current = phaseEntries.get(entry.wang.currentPhase);
    if (current) {
      current.count += 1;
      current.items.push(entry);
    } else {
      phaseEntries.set(entry.wang.currentPhase, { count: 1, items: [entry] });
    }
  }

  const makeValidationRanking = (
    key: string,
    label: string,
    items: typeof wangItems,
  ): StrategyRankingItem => {
    const avgScore = round(average(items.map(({ wang }) => wang.score).filter(Number.isFinite)));
    const avgConfidence = round(
      average(items.map(({ wang }) => wang.confidence).filter(Number.isFinite)),
    );
    const qualityScore =
      items.length === 0
        ? null
        : Math.max(
            0,
            Math.min(100, Math.round((avgScore ?? 0) * 0.6 + (avgConfidence ?? 0) * 0.4)),
          );
    return {
      key,
      label,
      scoreMode: "validation",
      candidateCount: items.length,
      avgScore,
      avgConfidence,
      avgWinRate: null,
      avgPf: null,
      avgMdd: null,
      qualityScore,
      topSymbols: items.slice(0, 3).map(({ candidate }) => `${candidate.name}(${candidate.code})`),
    };
  };

  const actionBiasRanking = actionBiasOrder
    .map(([actionBias, label]) =>
      makeValidationRanking(
        `wangActionBias:${actionBias}`,
        label,
        wangItems.filter(({ wang }) => wang.actionBias === actionBias),
      ),
    )
    .filter((item) => item.candidateCount > 0)
    .sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1) || b.candidateCount - a.candidateCount);

  const phaseRanking = Array.from(phaseEntries.entries())
    .map(([phase, entry]) =>
      makeValidationRanking(`wangPhase:${phase}`, `phase · ${wangPhaseLabel(phase)}`, entry.items),
    )
    .filter((item) => item.candidateCount > 0)
    .sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1) || b.candidateCount - a.candidateCount);

  return {
    totalValidated,
    summary: `왕장군 검증 ${totalValidated}건 · 적립 ${eligible} · 관찰 ${watchCandidate} · 비적합 ${notEligible}`,
    distribution: {
      eligible,
      watchCandidate,
      notEligible,
      byActionBias,
      byPhase: Array.from(phaseEntries.entries())
        .map(([phase, entry]) => ({
          phase,
          count: entry.count,
        }))
        .sort((a, b) => b.count - a.count),
    },
    ranking: {
      byActionBias: actionBiasRanking.slice(0, 4),
      byPhase: phaseRanking.slice(0, 6),
    },
  };
};

const pushTimelineEvent = (
  events: StrategyTimelineEvent[],
  seen: Set<string>,
  event: StrategyTimelineEvent | null,
) => {
  if (!event) return;
  const key = `${event.date}:${event.code}:${event.strategyKey}:${event.stateLabel}`;
  if (seen.has(key)) return;
  seen.add(key);
  events.push(event);
};

const buildTimeline = (candidates: ScreenerStoredCandidate[]): StrategyTimelineEvent[] => {
  const events: StrategyTimelineEvent[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, 120)) {
    const wangStrategy = getWangStrategy(candidate);
    if (wangStrategy.currentPhase !== "NONE") {
      pushTimelineEvent(events, seen, {
        date: candidate.lastDate,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "wangStrategy",
        strategyLabel: "왕장군 검증",
        stateLabel: `${wangValidationSummaryLabel(candidate)} · ${wangActionBiasLabel(wangStrategy.actionBias)}`,
        score: wangStrategy.score,
        confidence: wangStrategy.confidence,
        summary: `${wangPhaseLabel(wangStrategy.currentPhase)} · ${wangStrategy.weekBias} · ${wangStrategy.dayBias}`,
        wangPhase: wangStrategy.currentPhase,
        wangActionBias: wangStrategy.actionBias,
        scoreMode: "validation",
      });
    }
    pushTimelineEvent(events, seen, {
      date: candidate.lastDate,
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      strategyKey: "washoutPullback",
      strategyLabel: "설거지+눌림목",
      stateLabel: washoutStateLabel(candidate.hits.washoutPullback.state),
      score: candidate.hits.washoutPullback.score,
      confidence: candidate.hits.washoutPullback.confidence,
      summary: candidate.reasons.washoutPullback[0] ?? "설거지+눌림목 상태 갱신",
    });
    if (candidate.hits.darvasRetest.breakoutDate) {
      pushTimelineEvent(events, seen, {
        date: candidate.hits.darvasRetest.breakoutDate,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "darvasRetest",
        strategyLabel: "다르바스",
        stateLabel: patternStateLabel(candidate.hits.darvasRetest.state),
        score: candidate.hits.darvasRetest.score,
        confidence: candidate.hits.darvasRetest.confidence,
        summary: candidate.reasons.darvasRetest[0] ?? "다르바스 돌파/리테스트 감지",
      });
    }
    if (candidate.hits.nr7InsideBar.breakoutDate ?? candidate.hits.nr7InsideBar.setupDate) {
      const date = candidate.hits.nr7InsideBar.breakoutDate ?? candidate.hits.nr7InsideBar.setupDate!;
      pushTimelineEvent(events, seen, {
        date,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "nr7InsideBar",
        strategyLabel: "NR7",
        stateLabel: patternStateLabel(candidate.hits.nr7InsideBar.state),
        score: candidate.hits.nr7InsideBar.score,
        confidence: candidate.hits.nr7InsideBar.confidence,
        summary: candidate.reasons.nr7InsideBar[0] ?? "NR7 세팅/돌파 감지",
      });
    }
    if (candidate.hits.rsiDivergence.breakoutDate) {
      pushTimelineEvent(events, seen, {
        date: candidate.hits.rsiDivergence.breakoutDate,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "rsiDivergence",
        strategyLabel: "RSI 다이버전스",
        stateLabel: patternStateLabel(candidate.hits.rsiDivergence.state),
        score: candidate.hits.rsiDivergence.score,
        confidence: candidate.hits.rsiDivergence.confidence,
        summary: candidate.reasons.rsiDivergence[0] ?? "RSI 다이버전스 넥라인 돌파 감지",
      });
    }
    if (candidate.hits.hs.breakDate) {
      pushTimelineEvent(events, seen, {
        date: candidate.hits.hs.breakDate,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "hs",
        strategyLabel: "헤드앤숄더",
        stateLabel: patternStateLabel(candidate.hits.hs.state),
        score: candidate.hits.hs.score,
        confidence: candidate.hits.hs.confidence,
        summary: candidate.reasons.hs[0] ?? "헤드앤숄더 경고 패턴 감지",
      });
    }
    if (candidate.hits.ihs.breakDate) {
      pushTimelineEvent(events, seen, {
        date: candidate.hits.ihs.breakDate,
        code: candidate.code,
        name: candidate.name,
        market: candidate.market,
        strategyKey: "ihs",
        strategyLabel: "역헤드앤숄더",
        stateLabel: patternStateLabel(candidate.hits.ihs.state),
        score: candidate.hits.ihs.score,
        confidence: candidate.hits.ihs.confidence,
        summary: candidate.reasons.ihs[0] ?? "역헤드앤숄더 패턴 감지",
      });
    }
  }

  return events
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime() ||
        b.score - a.score ||
        (b.confidence ?? 0) - (a.confidence ?? 0),
    )
    .slice(0, 24);
};

export const buildDashboardOverview = async (
  env: Env,
  cache: Cache,
  favoriteCodes: string[],
): Promise<DashboardOverviewPayload> => {
  const { snapshot, warnings } = await loadLatestScreenerSnapshot(env, cache);
  const candidates = snapshot?.candidates ?? [];
  const favoriteCodeSet = new Set(favoriteCodes.filter(Boolean));
  const favoriteAlerts: FavoriteAlertItem[] = [];
  const missingCodes: string[] = [];
  for (const code of favoriteCodeSet) {
    const matched = candidates.find((item) => item.code === code);
    if (!matched) {
      missingCodes.push(code);
      continue;
    }
    favoriteAlerts.push(buildFavoriteAlert(matched));
  }
  const timeline = buildTimeline(candidates);
  return {
    meta: {
      asOf: nowIsoKst(),
      lastUpdatedAt: snapshot?.updatedAt ?? null,
      snapshotDate: snapshot?.date ?? null,
      universeLabel: "거래대금 상위 500 유니버스",
      source: "KIS",
      candidateCount: candidates.length,
    },
    marketTemperature: buildMarketTemperature(candidates),
    strategyRanking: buildStrategyRanking(candidates).slice(0, 8),
    wangValidation: buildWangValidationOverview(candidates),
    timeline,
    favorites: {
      trackedCount: favoriteCodeSet.size,
      activeCount: favoriteAlerts.length,
      missingCodes,
      alerts: favoriteAlerts.slice(0, 12),
    },
    warnings: sanitizeUserScreenerWarnings([...warnings, ...(snapshot?.warnings ?? [])], 4),
  };
};

export const loadRecentChangeHistory = async (
  env: Env,
  limit = 7,
): Promise<ScreenerChangeSummary[]> => {
  const items = await listPersistedByPrefix<{ changeSummary?: ScreenerChangeSummary | null }>(
    env,
    persistChangeHistoryPrefix(),
    limit,
  );
  return items
    .map((item) => item.value.changeSummary)
    .filter((item): item is ScreenerChangeSummary => !!item);
};
