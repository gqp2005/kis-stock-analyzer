import { getCachedJson, putCachedJson } from "../../../lib/cache";
import {
  fetchMarketIndexCandles,
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../../../lib/kis";
import { nowIsoKst } from "../../../lib/market";
import { attachMetrics, createRequestMetrics } from "../../../lib/observability";
import { errorJson, json, serverError } from "../../../lib/response";
import { analyzeTimeframe } from "../../../lib/scoring";
import { hasAdminOrSessionAccess } from "../../../lib/siteAuth";
import {
  analyzeScreenerRawCandidate,
  deriveAdaptiveCutoffs,
  type ScreenerAdaptiveCutoffs,
  type ScreenerBenchmarkMap,
  type ScreenerStoredCandidate,
} from "../../../lib/screener";
import { buildWangStrategyScreeningSummary } from "../../../lib/wangStrategy";
import {
  REBUILD_LOCK_TTL_SEC,
  SCREENER_CACHE_TTL_SEC,
  type RebuildFailureItem,
  type AlertStateSnapshot,
  type RebuildProgressSnapshot,
  type ScreenerChangeSummary,
  type ScreenerSnapshot,
  type ScreenerTuningSummary,
  type ScreenerRsSummary,
  type ScreenerValidationRunSummary,
  type ScreenerValidationState,
  type UniverseSnapshot,
  persistAlertStateKey,
  persistChangeHistoryKey,
  persistFailureHistoryKey,
  persistValidationHistoryKey,
  persistValidationStateKey,
  persistScreenerDateKey,
  persistScreenerLastSuccessKey,
  screenerDateKey,
  screenerLastSuccessKey,
  universeDateKey,
  universeLastSuccessKey,
} from "../../../lib/screenerStore";
import {
  deletePersistedJson,
  getPersistedJson,
  persistenceBackend,
  putPersistedJson,
} from "../../../lib/screenerPersistence";
import {
  clearRebuildRuntimeLock,
  clearRebuildRuntimeProgress,
  loadRebuildRuntimeLock,
  loadRebuildRuntimeProgress,
  rebuildRuntimeBackend,
  saveRebuildRuntimeLock,
  saveRebuildRuntimeProgress,
} from "../../../lib/rebuildRuntime";
import { ExternalProvider, MarketSummaryProvider, StaticProvider } from "../../../lib/universe";
import type { Candle, Env } from "../../../lib/types";

const TARGET_UNIVERSE = 500;
const REBUILD_PHASE_SIZE = 100;
const TOP_N_STORE = 50;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 120;
const ITEM_MAX_RETRIES = 0;
const LOCK_STALE_SEC = 5 * 60;
const LOCK_WITHOUT_PROGRESS_STALE_SEC = 90;
const PROGRESS_STALE_SEC = 180;
const PROGRESS_STALE_MIN_LOCK_AGE_SEC = 60;
const REBUILD_WORK_BUDGET_MS = 20_000;
const REBUILD_WORK_GUARD_MS = 2_000;
const MAX_FAILED_ITEMS_KEEP = 40;
const CHANGE_BASIS_TOP_N = 30;
const PERSIST_HISTORY_TTL_SEC = 180 * 24 * 60 * 60; // 180d
const ALERT_STATE_TTL_SEC = 365 * 24 * 60 * 60; // 365d
const ALERT_DEFAULT_TOP_N = 5;
const ALERT_DEFAULT_MIN_SCORE = 80;
const ALERT_DEFAULT_MIN_DELTA = 5;
const ALERT_DEFAULT_COOLDOWN_DAYS = 2;
const VALIDATION_STATE_TTL_SEC = 365 * 24 * 60 * 60; // 365d
const VALIDATION_HISTORY_TTL_SEC = 365 * 24 * 60 * 60; // 365d

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const sortByAllScore = <T extends { scoring: { all: { score: number; confidence: number } } }>(
  candidates: T[],
): T[] =>
  [...candidates].sort(
    (a, b) =>
      b.scoring.all.score - a.scoring.all.score ||
      b.scoring.all.confidence - a.scoring.all.confidence,
  );

const buildUnauthorized = (request: Request): Response =>
  errorJson(401, "UNAUTHORIZED", "유효한 admin token이 필요합니다.", request);

const parseBatchSize = (url: URL): number => {
  const raw = Number(url.searchParams.get("batch") ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_SIZE;
  return Math.max(5, Math.min(MAX_BATCH_SIZE, Math.floor(raw)));
};

const parseForce = (url: URL): boolean => {
  const raw = (url.searchParams.get("force") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

type RebuildMode = "step" | "trigger";
type ValidationMode = "auto" | "none" | "weekly" | "monthly" | "all";

const parseMode = (url: URL): RebuildMode => {
  const raw = (url.searchParams.get("mode") ?? "step").trim().toLowerCase();
  if (raw === "trigger") return "trigger";
  return "step";
};

const parseValidationMode = (url: URL): ValidationMode => {
  const raw = (url.searchParams.get("validate") ?? "auto").trim().toLowerCase();
  if (raw === "none") return "none";
  if (raw === "weekly") return "weekly";
  if (raw === "monthly") return "monthly";
  if (raw === "all") return "all";
  return "auto";
};

const parsePositiveInt = (raw: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

interface AlertOptions {
  topN: number;
  minScore: number;
  minRankDelta: number;
  cooldownDays: number;
}

const parseAlertOptions = (url: URL): AlertOptions => ({
  topN: parsePositiveInt(url.searchParams.get("alertTopN"), ALERT_DEFAULT_TOP_N, 1, 20),
  minScore: parsePositiveInt(url.searchParams.get("alertMinScore"), ALERT_DEFAULT_MIN_SCORE, 40, 100),
  minRankDelta: parsePositiveInt(url.searchParams.get("alertMinDelta"), ALERT_DEFAULT_MIN_DELTA, 1, 30),
  cooldownDays: parsePositiveInt(
    url.searchParams.get("alertCooldownDays"),
    ALERT_DEFAULT_COOLDOWN_DAYS,
    1,
    14,
  ),
});

const parseTimeMs = (iso: string | undefined): number => {
  if (!iso) return 0;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
};

const lockAgeSec = (startedAt: string | undefined): number | null => {
  const startedAtMs = parseTimeMs(startedAt);
  if (!startedAtMs) return null;
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
};

const isLockStale = (startedAt: string | undefined): boolean => {
  const ageSec = lockAgeSec(startedAt);
  if (ageSec == null) return true;
  return ageSec > LOCK_STALE_SEC;
};

const shouldRecoverLockOnlyState = (
  startedAt: string | undefined,
  progress: RebuildProgressSnapshot | null,
): boolean => {
  if (progress) return false;
  const ageSec = lockAgeSec(startedAt);
  if (ageSec == null) return true;
  return ageSec >= LOCK_WITHOUT_PROGRESS_STALE_SEC;
};

const isProgressStale = (
  progress: RebuildProgressSnapshot | null,
  lockStartedAt: string | undefined,
): boolean => {
  if (!progress) return false;
  const ageSec = lockAgeSec(lockStartedAt);
  if (ageSec != null && ageSec < PROGRESS_STALE_MIN_LOCK_AGE_SEC) {
    return false;
  }
  const updatedAtMs = parseTimeMs(progress.updatedAt);
  if (!updatedAtMs) return true;
  return Date.now() - updatedAtMs >= PROGRESS_STALE_SEC * 1000;
};

const loadUniverseSnapshot = async (
  cache: Cache,
  date: string,
): Promise<{
  snapshot: UniverseSnapshot;
  cacheHit: boolean;
  providerWarnings: string[];
}> => {
  const warnings: string[] = [];
  const dailyKey = universeDateKey(date);
  let snapshot = await getCachedJson<UniverseSnapshot>(cache, dailyKey);
  if (snapshot && snapshot.items.length > 0) {
    return { snapshot, cacheHit: true, providerWarnings: warnings };
  }

  const externalProvider = new ExternalProvider();
  try {
    const externalUniverse = await externalProvider.getTopByTurnover(date, TARGET_UNIVERSE);
    snapshot = {
      date,
      updatedAt: nowIsoKst(),
      source: "EXTERNAL",
      items: externalUniverse,
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "external provider error";
    warnings.push(`ExternalProvider 실패: ${message}`);
    const marketSummaryProvider = new MarketSummaryProvider();
    try {
      const backupUniverse = await marketSummaryProvider.getTopByTurnover(date, TARGET_UNIVERSE);
      snapshot = {
        date,
        updatedAt: nowIsoKst(),
        source: "EXTERNAL_BACKUP",
        items: backupUniverse,
        warnings: ["Primary 유니버스 소스 실패로 보조 소스(sise_market_sum)를 사용했습니다."],
      };
    } catch (backupError) {
      const backupMessage =
        backupError instanceof Error ? backupError.message : "backup provider error";
      warnings.push(`MarketSummaryProvider 실패: ${backupMessage}`);

      const lastUniverse = await getCachedJson<UniverseSnapshot>(cache, universeLastSuccessKey());
      if (lastUniverse && lastUniverse.items.length > 0) {
        snapshot = {
          ...lastUniverse,
          date,
          updatedAt: nowIsoKst(),
          source: "LAST_SUCCESS",
          warnings: [...lastUniverse.warnings, "마지막 성공 유니버스를 사용했습니다."],
        };
      } else {
        const staticProvider = new StaticProvider();
        const staticUniverse = await staticProvider.getTopByTurnover(date, TARGET_UNIVERSE);
        snapshot = {
          date,
          updatedAt: nowIsoKst(),
          source: "STATIC",
          items: staticUniverse,
          warnings: ["External/Backup 소스 실패로 StaticProvider 유니버스를 사용했습니다."],
        };
      }
    }
  }

  await putCachedJson(cache, dailyKey, snapshot, SCREENER_CACHE_TTL_SEC);
  await putCachedJson(cache, universeLastSuccessKey(), snapshot, SCREENER_CACHE_TTL_SEC);
  return { snapshot, cacheHit: false, providerWarnings: warnings };
};

const createProgress = (
  date: string,
  universeCount: number,
  warnings: string[],
): RebuildProgressSnapshot => ({
  date,
  startedAt: nowIsoKst(),
  updatedAt: nowIsoKst(),
  cursor: 0,
  universeCount,
  processedCount: 0,
  ohlcvFailures: 0,
  insufficientData: 0,
  warnings: dedupeWarnings(warnings),
  candidates: [],
  failedItems: [],
  retryStats: {
    totalRetries: 0,
    retriedSymbols: 0,
    maxRetryPerSymbol: 0,
  },
  lastBatch: null,
});

const normalizeProgress = (progress: RebuildProgressSnapshot): RebuildProgressSnapshot => ({
  ...progress,
  failedItems: Array.isArray(progress.failedItems) ? progress.failedItems : [],
  retryStats: progress.retryStats ?? {
    totalRetries: 0,
    retriedSymbols: 0,
    maxRetryPerSymbol: 0,
  },
  lastBatch: progress.lastBatch ?? null,
});

const enrichCandidateWithWangStrategy = (
  candidate: ScreenerStoredCandidate,
  entry: { code: string; name: string; market: string },
  dayCandles: Candle[],
  fetchedName: string,
): ScreenerStoredCandidate => {
  if (dayCandles.length < 120) {
    return candidate;
  }

  try {
    const trimmedDayCandles = dayCandles.slice(-280);
    const weekCandles = resampleDayToWeekCandles(dayCandles).slice(-80);
    const monthCandles = resampleDayToMonthCandles(dayCandles).slice(-36);
    const dayAnalysis = analyzeTimeframe("day", trimmedDayCandles);
    const weekAnalysis = weekCandles.length >= 20 ? analyzeTimeframe("week", weekCandles) : null;
    const monthAnalysis = monthCandles.length >= 6 ? analyzeTimeframe("month", monthCandles) : null;

    return {
      ...candidate,
      wangStrategy: buildWangStrategyScreeningSummary({
        input: entry.code,
        symbol: entry.code,
        name: fetchedName || entry.name,
        market: entry.market,
        asOf: nowIsoKst(),
        cacheTtlSec: 0,
        dayAnalysis,
        weekAnalysis,
        monthAnalysis,
        warnings: [],
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "wang strategy summary failed";
    return {
      ...candidate,
      wangStrategy: {
        ...candidate.wangStrategy,
        reasons: [`왕장군 검증 실패: ${message}`],
      },
    };
  }
};

const buildChangeSummary = (
  previous: ScreenerSnapshot | null,
  current: ScreenerStoredCandidate[],
): ScreenerChangeSummary | null => {
  const toChangeItem = (
    candidate: ScreenerStoredCandidate,
    overrides: Partial<{
      prevRank: number | null;
      currRank: number | null;
      deltaRank: number | null;
      prevScore: number | null;
      currScore: number | null;
      scoreDelta: number | null;
      prevConfidence: number | null;
      currConfidence: number | null;
      confidenceDelta: number | null;
    }> = {},
  ) => {
    const currScore = overrides.currScore ?? candidate.scoring.all.score;
    const currConfidence = overrides.currConfidence ?? candidate.scoring.all.confidence;
    const prevScore = overrides.prevScore ?? null;
    const prevConfidence = overrides.prevConfidence ?? null;
    const scoreDelta =
      overrides.scoreDelta ??
      (prevScore != null && currScore != null ? currScore - prevScore : null);
    const confidenceDelta =
      overrides.confidenceDelta ??
      (prevConfidence != null && currConfidence != null
        ? currConfidence - prevConfidence
        : null);

    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      prevRank: overrides.prevRank ?? null,
      currRank: overrides.currRank ?? null,
      deltaRank: overrides.deltaRank ?? null,
      score: currScore,
      confidence: currConfidence,
      prevScore,
      currScore,
      scoreDelta,
      prevConfidence,
      currConfidence,
      confidenceDelta,
    };
  };

  const currentTop = current.slice(0, CHANGE_BASIS_TOP_N);
  if (!previous) {
    return {
      generatedAt: nowIsoKst(),
      basisTopN: CHANGE_BASIS_TOP_N,
      added: currentTop
        .slice(0, 10)
        .map((candidate, index) => toChangeItem(candidate, { currRank: index + 1 })),
      removed: [],
      risers: [],
      fallers: [],
      scoreRisers: [],
      scoreFallers: [],
    };
  }

  const previousTop = previous.topCandidates.slice(0, CHANGE_BASIS_TOP_N);
  const prevRank = new Map(previousTop.map((candidate, index) => [candidate.code, index + 1]));
  const curRank = new Map(currentTop.map((candidate, index) => [candidate.code, index + 1]));

  const currentByCode = new Map(currentTop.map((candidate) => [candidate.code, candidate]));
  const previousByCode = new Map(previousTop.map((candidate) => [candidate.code, candidate]));

  const added = currentTop
    .filter((candidate) => !prevRank.has(candidate.code))
    .map((candidate, index) =>
      toChangeItem(candidate, {
        currRank: curRank.get(candidate.code) ?? index + 1,
      }),
    )
    .slice(0, 10);

  const removed = previousTop
    .filter((candidate) => !curRank.has(candidate.code))
    .map((candidate, index) =>
      toChangeItem(candidate, {
        prevRank: prevRank.get(candidate.code) ?? index + 1,
        currRank: null,
        prevScore: candidate.scoring.all.score,
        currScore: candidate.scoring.all.score,
        scoreDelta: null,
        prevConfidence: candidate.scoring.all.confidence,
        currConfidence: candidate.scoring.all.confidence,
        confidenceDelta: null,
      }),
    )
    .slice(0, 10);

  const movers = currentTop
    .filter((candidate) => prevRank.has(candidate.code))
    .map((candidate) => {
      const before = prevRank.get(candidate.code) ?? 0;
      const after = curRank.get(candidate.code) ?? 0;
      const deltaRank = before - after;
      const prevCandidate = previousByCode.get(candidate.code);
      return toChangeItem(candidate, {
        prevRank: before,
        currRank: after,
        deltaRank,
        prevScore: prevCandidate?.scoring.all.score ?? null,
        currScore: candidate.scoring.all.score,
        prevConfidence: prevCandidate?.scoring.all.confidence ?? null,
        currConfidence: candidate.scoring.all.confidence,
      });
    });

  const risers = movers
    .filter((item) => (item.deltaRank ?? 0) > 0)
    .sort((a, b) => (b.deltaRank ?? 0) - (a.deltaRank ?? 0))
    .slice(0, 10);

  const fallers = movers
    .filter((item) => (item.deltaRank ?? 0) < 0)
    .sort((a, b) => (a.deltaRank ?? 0) - (b.deltaRank ?? 0))
    .slice(0, 10);

  // 남아있는 코드의 점수/신뢰도는 최신 값을 우선 사용한다.
  for (const item of removed) {
    const cur = currentByCode.get(item.code);
    const prev = previousByCode.get(item.code);
    if (cur) {
      item.score = cur.scoring.all.score;
      item.confidence = cur.scoring.all.confidence;
      item.currScore = cur.scoring.all.score;
      item.currConfidence = cur.scoring.all.confidence;
    } else if (prev) {
      item.score = prev.scoring.all.score;
      item.confidence = prev.scoring.all.confidence;
      item.currScore = prev.scoring.all.score;
      item.currConfidence = prev.scoring.all.confidence;
    }
    if (item.prevScore != null && item.currScore != null) {
      item.scoreDelta = item.currScore - item.prevScore;
    }
    if (item.prevConfidence != null && item.currConfidence != null) {
      item.confidenceDelta = item.currConfidence - item.prevConfidence;
    }
  }

  const scoreRisers = movers
    .filter((item) => (item.scoreDelta ?? 0) > 0)
    .sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0))
    .slice(0, 10);

  const scoreFallers = movers
    .filter((item) => (item.scoreDelta ?? 0) < 0)
    .sort((a, b) => (a.scoreDelta ?? 0) - (b.scoreDelta ?? 0))
    .slice(0, 10);

  return {
    generatedAt: nowIsoKst(),
    basisTopN: CHANGE_BASIS_TOP_N,
    added,
    removed,
    risers,
    fallers,
    scoreRisers,
    scoreFallers,
  };
};

const buildRsSummary = (candidates: ScreenerStoredCandidate[]): ScreenerRsSummary => {
  const benchmarkMarkets = [...new Set(candidates.map((candidate) => candidate.rs.benchmark))];
  const weak = candidates.filter((candidate) => candidate.rs.label === "WEAK").length;
  const matched = candidates.filter(
    (candidate) => candidate.rs.label === "STRONG" || candidate.rs.label === "NEUTRAL",
  ).length;
  const missing = candidates.filter((candidate) => candidate.rs.label === "N/A").length;

  return {
    enabled: true,
    benchmarkMarkets,
    matched,
    weak,
    missing,
  };
};

const buildTuningSummary = (candidates: ScreenerStoredCandidate[]): ScreenerTuningSummary => {
  const tunings = candidates
    .map((candidate) => candidate.tuning)
    .filter((item): item is NonNullable<ScreenerStoredCandidate["tuning"]> => item != null);

  if (tunings.length === 0) {
    return {
      enabled: true,
      sampleCount: 0,
      avgThresholds: null,
    };
  }

  const avg = (values: number[]): number =>
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

  return {
    enabled: true,
    sampleCount: tunings.length,
    avgThresholds: {
      volume: avg(tunings.map((item) => item.thresholds.volume)),
      hs: avg(tunings.map((item) => item.thresholds.hs)),
      ihs: avg(tunings.map((item) => item.thresholds.ihs)),
      vcp: avg(tunings.map((item) => item.thresholds.vcp)),
    },
  };
};

const averageNullable = (values: Array<number | null | undefined>): number | null => {
  const filtered = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
};

const roundNullable = (value: number | null): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
};

const strategyBacktestKey = (
  strategy: keyof ScreenerValidationRunSummary["strategies"],
): keyof ScreenerStoredCandidate["backtestSummary"] => {
  if (strategy === "volume") return "volume";
  if (strategy === "hs") return "hs";
  if (strategy === "ihs") return "ihs";
  if (strategy === "vcp") return "vcp";
  return "all";
};

const buildValidationStrategySummary = (
  candidates: ScreenerStoredCandidate[],
  strategy: keyof ScreenerValidationRunSummary["strategies"],
  recommendedCutoff: number,
): ScreenerValidationRunSummary["strategies"]["all"] => {
  const summaryKey = strategyBacktestKey(strategy);
  const validBacktests = candidates
    .map((candidate) => candidate.backtestSummary[summaryKey])
    .filter(
      (summary): summary is NonNullable<ScreenerStoredCandidate["backtestSummary"]["all"]> =>
        summary != null &&
        summary.trades >= 3 &&
        summary.winRate != null &&
        summary.PF != null &&
        summary.MDD != null,
    );

  return {
    trades: validBacktests.reduce((sum, summary) => sum + summary.trades, 0),
    winRate: roundNullable(averageNullable(validBacktests.map((summary) => summary.winRate))),
    pf: roundNullable(averageNullable(validBacktests.map((summary) => summary.PF))),
    mdd: roundNullable(averageNullable(validBacktests.map((summary) => summary.MDD))),
    quality: roundNullable(averageNullable(candidates.map((candidate) => candidate.tuning?.quality))),
    recommendedCutoff,
  };
};

const buildValidationRunSummary = (
  period: "weekly" | "monthly",
  generatedAt: string,
  candidates: ScreenerStoredCandidate[],
  cutoffs: ScreenerAdaptiveCutoffs,
): ScreenerValidationRunSummary => {
  const all = buildValidationStrategySummary(candidates, "all", cutoffs.all);
  const volume = buildValidationStrategySummary(candidates, "volume", cutoffs.volume);
  const hs = buildValidationStrategySummary(candidates, "hs", cutoffs.hs);
  const ihs = buildValidationStrategySummary(candidates, "ihs", cutoffs.ihs);
  const vcp = buildValidationStrategySummary(candidates, "vcp", cutoffs.vcp);

  return {
    period,
    generatedAt,
    sampleCount: candidates.length,
    cutoffs,
    strategies: {
      all,
      volume,
      hs,
      ihs,
      vcp,
    },
  };
};

const daysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
};

const isWeeklyDue = (lastWeeklyAt: string | null, nowIso: string): boolean => {
  if (!lastWeeklyAt) return true;
  return daysBetween(lastWeeklyAt, nowIso) >= 7;
};

const isMonthlyDue = (lastMonthlyAt: string | null, nowIso: string): boolean => {
  if (!lastMonthlyAt) return true;
  return lastMonthlyAt.slice(0, 7) !== nowIso.slice(0, 7);
};

const averageCutoffs = (
  first: ScreenerAdaptiveCutoffs,
  second: ScreenerAdaptiveCutoffs,
): ScreenerAdaptiveCutoffs => ({
  all: Math.round((first.all + second.all) / 2),
  volume: Math.round((first.volume + second.volume) / 2),
  hs: Math.round((first.hs + second.hs) / 2),
  ihs: Math.round((first.ihs + second.ihs) / 2),
  vcp: Math.round((first.vcp + second.vcp) / 2),
});

const runValidationAutomation = async (
  env: Env,
  mode: ValidationMode,
  candidates: ScreenerStoredCandidate[],
): Promise<{ state: ScreenerValidationState | null; warnings: string[] }> => {
  const warnings: string[] = [];
  const backend = persistenceBackend(env);
  const generatedAt = nowIsoKst();
  const fallbackCutoffs = deriveAdaptiveCutoffs(candidates);

  if (backend === "none") {
    return {
      state: {
        updatedAt: generatedAt,
        lastWeeklyAt: null,
        lastMonthlyAt: null,
        activeCutoffs: fallbackCutoffs,
        latestRuns: {
          weekly: null,
          monthly: null,
        },
      },
      warnings,
    };
  }

  const prevState =
    (await getPersistedJson<ScreenerValidationState>(env, persistValidationStateKey())) ?? null;

  const weeklyDue = isWeeklyDue(prevState?.lastWeeklyAt ?? null, generatedAt);
  const monthlyDue = isMonthlyDue(prevState?.lastMonthlyAt ?? null, generatedAt);

  const shouldRunWeekly =
    mode === "all" || mode === "weekly" || (mode === "auto" && weeklyDue);
  const shouldRunMonthly =
    mode === "all" || mode === "monthly" || (mode === "auto" && monthlyDue);

  let weeklyRun = prevState?.latestRuns.weekly ?? null;
  let monthlyRun = prevState?.latestRuns.monthly ?? null;
  let activeCutoffs =
    prevState?.activeCutoffs ??
    fallbackCutoffs;
  let lastWeeklyAt = prevState?.lastWeeklyAt ?? null;
  let lastMonthlyAt = prevState?.lastMonthlyAt ?? null;

  if (shouldRunWeekly) {
    const weeklyCutoffs = deriveAdaptiveCutoffs(candidates);
    weeklyRun = buildValidationRunSummary("weekly", generatedAt, candidates, weeklyCutoffs);
    activeCutoffs = weeklyCutoffs;
    lastWeeklyAt = generatedAt;
    warnings.push("주간 전략 검증(워크포워드)을 실행해 컷오프를 갱신했습니다.");
  }

  if (shouldRunMonthly) {
    const monthlyCutoffs = deriveAdaptiveCutoffs(candidates);
    monthlyRun = buildValidationRunSummary("monthly", generatedAt, candidates, monthlyCutoffs);
    activeCutoffs = shouldRunWeekly ? averageCutoffs(activeCutoffs, monthlyCutoffs) : monthlyCutoffs;
    lastMonthlyAt = generatedAt;
    warnings.push("월간 전략 검증(워크포워드)을 실행해 컷오프를 갱신했습니다.");
  }

  if (mode === "auto" && !shouldRunWeekly && !shouldRunMonthly) {
    warnings.push("주간/월간 검증 주기가 아직 도래하지 않아 기존 컷오프를 유지했습니다.");
  }

  const state: ScreenerValidationState = {
    updatedAt: generatedAt,
    lastWeeklyAt,
    lastMonthlyAt,
    activeCutoffs,
    latestRuns: {
      weekly: weeklyRun,
      monthly: monthlyRun,
    },
  };

  await putPersistedJson(env, persistValidationStateKey(), state, VALIDATION_STATE_TTL_SEC);
  if (weeklyRun) {
    await putPersistedJson(
      env,
      persistValidationHistoryKey("weekly", generatedAt.slice(0, 10)),
      weeklyRun,
      VALIDATION_HISTORY_TTL_SEC,
    );
  }
  if (monthlyRun) {
    await putPersistedJson(
      env,
      persistValidationHistoryKey("monthly", generatedAt.slice(0, 10)),
      monthlyRun,
      VALIDATION_HISTORY_TTL_SEC,
    );
  }

  return { state, warnings };
};

type AlertKind = "added" | "riser" | "faller";

interface AlertItem {
  kind: AlertKind;
  code: string;
  name: string;
  market: string;
  score: number;
  confidence: number;
  prevRank: number | null;
  currRank: number | null;
  deltaRank: number | null;
}

interface AlertPayload {
  generatedAt: string;
  options: AlertOptions;
  backend: "kv" | "d1" | "none";
  eligible: {
    added: AlertItem[];
    risers: AlertItem[];
    fallers: AlertItem[];
  };
  skippedRecent: AlertItem[];
  sentCount: number;
  skippedCount: number;
}

const toAlertItems = (
  kind: AlertKind,
  items: Array<{
    code: string;
    name: string;
    market: string;
    score: number;
    confidence: number;
    prevRank: number | null;
    currRank: number | null;
    deltaRank: number | null;
  }>,
): AlertItem[] =>
  items.map((item) => ({
    kind,
    code: item.code,
    name: item.name,
    market: item.market,
    score: item.score,
    confidence: item.confidence,
    prevRank: item.prevRank,
    currRank: item.currRank,
    deltaRank: item.deltaRank,
  }));

const cooldownMs = (days: number): number => days * 24 * 60 * 60 * 1000;

const isRecentAlert = (
  sentAt: string | undefined,
  cooldownDays: number,
): boolean => {
  if (!sentAt) return false;
  const ts = Date.parse(sentAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < cooldownMs(cooldownDays);
};

const buildAlertCandidates = (
  changeSummary: ScreenerChangeSummary | null,
  options: AlertOptions,
): AlertItem[] => {
  if (!changeSummary) return [];

  const added = toAlertItems(
    "added",
    changeSummary.added
      .filter((item) => item.score >= options.minScore)
      .slice(0, options.topN),
  );

  const risers = toAlertItems(
    "riser",
    changeSummary.risers
      .filter(
        (item) =>
          item.score >= options.minScore &&
          Math.abs(item.deltaRank ?? 0) >= options.minRankDelta,
      )
      .slice(0, options.topN),
  );

  const fallers = toAlertItems(
    "faller",
    changeSummary.fallers
      .filter(
        (item) =>
          item.score >= options.minScore &&
          Math.abs(item.deltaRank ?? 0) >= options.minRankDelta,
      )
      .slice(0, options.topN),
  );

  return [...added, ...risers, ...fallers];
};

const applyAlertCooldown = async (
  env: Env,
  options: AlertOptions,
  candidates: AlertItem[],
): Promise<AlertPayload> => {
  const backend = persistenceBackend(env);
  const state = (await getPersistedJson<AlertStateSnapshot>(
    env,
    persistAlertStateKey(),
  )) ?? {
    updatedAt: nowIsoKst(),
    sent: {},
  };

  const eligible: AlertItem[] = [];
  const skippedRecent: AlertItem[] = [];
  const sentState = { ...state.sent };
  const sentAt = nowIsoKst();

  for (const item of candidates) {
    const stateKey = `${item.kind}:${item.code}`;
    const lastSent = sentState[stateKey]?.sentAt;
    if (isRecentAlert(lastSent, options.cooldownDays)) {
      skippedRecent.push(item);
      continue;
    }
    eligible.push(item);
    sentState[stateKey] = { sentAt };
  }

  if (backend !== "none") {
    await putPersistedJson(
      env,
      persistAlertStateKey(),
      {
        updatedAt: sentAt,
        sent: sentState,
      } satisfies AlertStateSnapshot,
      ALERT_STATE_TTL_SEC,
    );
  }

  return {
    generatedAt: sentAt,
    options,
    backend,
    eligible: {
      added: eligible.filter((item) => item.kind === "added"),
      risers: eligible.filter((item) => item.kind === "riser"),
      fallers: eligible.filter((item) => item.kind === "faller"),
    },
    skippedRecent,
    sentCount: eligible.length,
    skippedCount: skippedRecent.length,
  };
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  const url = new URL(context.request.url);
  const alertOptions = parseAlertOptions(url);
  const forceRun = parseForce(url);
  const mode = parseMode(url);
  const validationMode = parseValidationMode(url);
  if (!(await hasAdminOrSessionAccess(context.request, context.env))) {
    return finalize(buildUnauthorized(context.request));
  }

  const cache = await caches.open("kis-analyzer-cache-v3");
  const date = nowIsoKst().slice(0, 10);
  const persistBackend = persistenceBackend(context.env);
  const runtimeBackend = rebuildRuntimeBackend(context.env);
  const existingLock = await loadRebuildRuntimeLock(context.env, cache);
  if (forceRun && existingLock) {
    console.log("[rebuild-screener-force] force=1 lock bypass requested");
    await clearRebuildRuntimeLock(context.env, cache);
  }
  if (!forceRun && existingLock && !isLockStale(existingLock.startedAt)) {
    const runtimeProgress = await loadRebuildRuntimeProgress(context.env, cache, date);
    const progress = runtimeProgress ? normalizeProgress(runtimeProgress) : null;
    const recoverLockOnly = shouldRecoverLockOnlyState(existingLock.startedAt, progress);
    const recoverStaleProgress =
      !recoverLockOnly && isProgressStale(progress, existingLock.startedAt);

    if (!recoverLockOnly && !recoverStaleProgress) {
      return finalize(
        json(
          {
            ok: true,
            inProgress: true,
            mode,
            validationMode,
            rebuiltAt: null,
            universe: {
              label: "거래대금 상위 500",
              source: "KIS",
              count: progress?.universeCount ?? TARGET_UNIVERSE,
              cacheHit: true,
            },
            storage: {
              backend: persistBackend,
              runtimeBackend,
              enabled: persistBackend !== "none",
            },
            alertOptions,
            progress: progress
              ? {
                  processed: progress.cursor,
                  total: progress.universeCount,
                  remaining: Math.max(0, progress.universeCount - progress.cursor),
                  batchSize: parseBatchSize(url),
                  nextCursor: progress.cursor,
                  failedCount: progress.failedItems.length,
                  retryStats: progress.retryStats,
                  lastBatch: progress.lastBatch,
                }
              : null,
            summary: progress
              ? {
                  processedCount: progress.processedCount,
                  candidateCount: progress.candidates.length,
                  durationMs: null,
                  kisCalls: metrics.kisCalls,
                  failedCount: progress.failedItems.length,
                  retryStats: progress.retryStats,
                }
              : null,
            warnings: progress?.warnings ?? [],
            message: "이미 rebuild가 실행 중입니다. 잠시 후 같은 엔드포인트를 다시 호출하세요.",
          },
          202,
        ),
      );
    }

    const ageSec = lockAgeSec(existingLock.startedAt);
    const recoverReason = recoverLockOnly ? "lock-only-no-progress" : "stale-progress";
    console.log(`[rebuild-screener-lock-recover] reason=${recoverReason} ageSec=${ageSec ?? -1}`);
    await clearRebuildRuntimeLock(context.env, cache);
  }

  if (!forceRun && existingLock && isLockStale(existingLock.startedAt)) {
    const ageSec = lockAgeSec(existingLock.startedAt);
    console.log(
      `[rebuild-screener-lock-recover] reason=stale-lock ageSec=${ageSec ?? -1}`,
    );
    await clearRebuildRuntimeLock(context.env, cache);
  }

  const startedAtMs = Date.now();
  let lockAcquired = false;

  try {
    const lockStartedAt = nowIsoKst();
    await saveRebuildRuntimeLock(context.env, cache, {
      startedAt: lockStartedAt,
      ttlSec: REBUILD_LOCK_TTL_SEC,
    });
    lockAcquired = true;

    const runtimePrevProgress = await loadRebuildRuntimeProgress(context.env, cache, date);
    let prevProgress = runtimePrevProgress ? normalizeProgress(runtimePrevProgress) : null;
    if (!prevProgress) {
      prevProgress = createProgress(date, TARGET_UNIVERSE, [
        "리빌드 초기화 중입니다. 잠시 후 진행률이 갱신됩니다.",
      ]);
      prevProgress.startedAt = lockStartedAt;
      prevProgress.updatedAt = lockStartedAt;
      await saveRebuildRuntimeProgress(context.env, cache, date, prevProgress);
    }

    const batchSize = parseBatchSize(url);

    const universeLoad = await loadUniverseSnapshot(cache, date);
    const universe = universeLoad.snapshot.items.slice(0, TARGET_UNIVERSE);
    const benchmarks: ScreenerBenchmarkMap = {};
    const benchmarkWarnings: string[] = [];
    if (mode !== "trigger") {
      for (const market of ["KOSPI", "KOSDAQ"] as const) {
        try {
          const indexData = await fetchMarketIndexCandles(
            context.env,
            cache,
            market,
            320,
            metrics,
          );
          benchmarks[market] = { index: indexData.index, candles: indexData.candles };
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          benchmarkWarnings.push(
            `${market} 지수 조회 실패로 RS 필터 일부를 비활성 처리했습니다: ${message}`,
          );
        }
      }
    }

    let progress =
      prevProgress.universeCount === universe.length
        ? prevProgress
        : createProgress(date, universe.length, [
            ...universeLoad.providerWarnings,
            ...universeLoad.snapshot.warnings,
            ...benchmarkWarnings,
            persistBackend === "none"
              ? "영속 저장소(KV/D1)가 없어 Cache API만 사용합니다."
              : "",
          ]);

    if (mode === "trigger") {
      await saveRebuildRuntimeProgress(context.env, cache, date, progress);
      return finalize(
        json(
          {
            ok: true,
            inProgress: true,
            rebuiltAt: null,
            mode,
            validationMode,
            universe: {
              label: "거래대금 상위 500",
              source: universeLoad.snapshot.source,
              count: universe.length,
              cacheHit: universeLoad.cacheHit,
            },
            storage: {
              backend: persistBackend,
              runtimeBackend,
              enabled: persistBackend !== "none",
            },
            alertOptions,
            progress: {
              processed: progress.cursor,
              total: universe.length,
              remaining: Math.max(0, universe.length - progress.cursor),
              batchSize,
              nextCursor: progress.cursor,
              failedCount: progress.failedItems.length,
              retryStats: progress.retryStats,
              lastBatch: progress.lastBatch,
            },
            summary: {
              processedCount: progress.processedCount,
              candidateCount: progress.candidates.length,
              durationMs: Date.now() - startedAtMs,
              kisCalls: metrics.kisCalls,
              failedCount: progress.failedItems.length,
              retryStats: progress.retryStats,
            },
            warnings: progress.warnings,
            message: "리빌드 트리거를 설정했습니다. mode=step 호출로 배치를 진행하세요.",
          },
          202,
        ),
      );
    }

    const start = Math.max(0, Math.min(progress.cursor, universe.length));
    const targetEndExclusive = Math.min(universe.length, start + batchSize);
    const batchItems = universe.slice(start, targetEndExclusive);

    const processEntry = async (entry: (typeof batchItems)[number]) => {
      let attempt = 0;
      while (attempt <= ITEM_MAX_RETRIES) {
        try {
          const fetched = await fetchTimeframeCandles(
            context.env,
            cache,
            entry.code,
            "day",
            280,
            metrics,
          );
          const candidate = analyzeScreenerRawCandidate(
            entry,
            fetched.candles.slice(-280),
            true,
            benchmarks,
          );
          if (!candidate) {
            return {
              kind: "insufficient" as const,
              candidate: null,
              retries: attempt,
              reason: "데이터 부족",
            };
          }
          return {
            kind: "ok" as const,
            candidate: enrichCandidateWithWangStrategy(
              candidate,
              entry,
              fetched.candles,
              fetched.name,
            ),
            retries: attempt,
            reason: "",
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (attempt >= ITEM_MAX_RETRIES) {
            console.log(
              `[rebuild-screener-item-fail] code=${entry.code} retries=${attempt} reason=${message}`,
            );
            return {
              kind: "failed" as const,
              candidate: null,
              retries: attempt,
              reason: message,
            };
          }
          attempt += 1;
        }
      }

      return {
        kind: "failed" as const,
        candidate: null,
        retries: ITEM_MAX_RETRIES,
        reason: "unknown failure",
      };
    };

    const batchResults: Array<{
      entry: (typeof batchItems)[number];
      result: Awaited<ReturnType<typeof processEntry>>;
    }> = [];
    // 요청 전체 시간이 아닌 "실제 종목 처리 구간" 기준으로 예산을 잡아
    // 준비 작업(유니버스/지수 조회) 지연 시에도 배치가 멈추지 않도록 한다.
    const itemWorkStartedAtMs = Date.now();
    const workDeadline = itemWorkStartedAtMs + REBUILD_WORK_BUDGET_MS;

    for (const entry of batchItems) {
      const now = Date.now();
      if (now >= workDeadline - REBUILD_WORK_GUARD_MS) {
        break;
      }
      const result = await processEntry(entry);
      batchResults.push({ entry, result });
    }

    // 예산을 모두 써서 0건 처리되는 경우 cursor가 멈춰 무한 대기할 수 있으므로
    // 최소 1종목은 강제로 처리해 진행률을 전진시킨다.
    if (batchResults.length === 0 && batchItems.length > 0) {
      const entry = batchItems[0];
      const result = await processEntry(entry);
      batchResults.push({ entry, result });
    }

    const endExclusive = start + batchResults.length;
    const deferredCount = Math.max(0, batchItems.length - batchResults.length);

    for (let batchIndex = 0; batchIndex < batchResults.length; batchIndex += 1) {
      const { entry, result } = batchResults[batchIndex];
      if (result.retries > 0) {
        progress.retryStats.totalRetries += result.retries;
        progress.retryStats.retriedSymbols += 1;
        progress.retryStats.maxRetryPerSymbol = Math.max(
          progress.retryStats.maxRetryPerSymbol,
          result.retries,
        );
      }

      if (result.kind === "ok" && result.candidate) {
        progress.candidates.push(result.candidate);
        progress.processedCount += 1;
      } else if (result.kind === "insufficient") {
        progress.insufficientData += 1;
      } else {
        progress.ohlcvFailures += 1;
        if (progress.failedItems.length < MAX_FAILED_ITEMS_KEEP) {
          const failedItem: RebuildFailureItem = {
            code: entry.code,
            name: entry.name,
            market: entry.market,
            reason: result.reason || "OHLCV 조회 실패",
            retries: result.retries,
            at: nowIsoKst(),
          };
          progress.failedItems.push(failedItem);
        }
      }
    }
    progress.cursor = endExclusive;
    progress.updatedAt = nowIsoKst();
    progress.lastBatch = {
      from: start,
      to: endExclusive,
      batchSize,
    };
    progress.warnings = dedupeWarnings([
      ...progress.warnings,
      ...universeLoad.providerWarnings,
      ...universeLoad.snapshot.warnings,
      ...benchmarkWarnings,
      progress.insufficientData > 0
        ? `데이터 부족 ${progress.insufficientData}종목 제외`
        : "",
      progress.ohlcvFailures > 0
        ? `OHLCV 조회 실패 ${progress.ohlcvFailures}종목 제외`
        : "",
      progress.retryStats.retriedSymbols > 0
        ? `재시도 수행 ${progress.retryStats.retriedSymbols}종목 / 총 ${progress.retryStats.totalRetries}회`
        : "",
      deferredCount > 0
        ? `요청 시간 예산(${Math.floor(REBUILD_WORK_BUDGET_MS / 1000)}s)으로 ${deferredCount}종목을 다음 호출로 이월`
        : "",
    ].filter((msg) => msg.length > 0));

    if (progress.cursor < universe.length) {
      await saveRebuildRuntimeProgress(context.env, cache, date, progress);
      const durationMs = Date.now() - startedAtMs;
      console.log(
        `[rebuild-screener-progress] ${JSON.stringify({
          date,
          durationMs,
          batchSize,
          from: start,
          to: endExclusive,
          cursor: progress.cursor,
          total: universe.length,
          candidateCount: progress.candidates.length,
          failedCount: progress.failedItems.length,
          retries: progress.retryStats.totalRetries,
          kisCalls: metrics.kisCalls,
        })}`,
      );

      const chunkComplete =
        progress.cursor > 0 &&
        progress.cursor % REBUILD_PHASE_SIZE === 0;
      if (chunkComplete) {
        const currentPhase = Math.ceil(progress.cursor / REBUILD_PHASE_SIZE);
        const totalPhases = Math.ceil(universe.length / REBUILD_PHASE_SIZE);
        return finalize(
          json(
            {
              ok: true,
              inProgress: false,
              hasMore: true,
              mode,
              validationMode,
              rebuiltAt: null,
              universe: {
                label: "거래대금 상위 500",
                source: universeLoad.snapshot.source,
                count: universe.length,
                cacheHit: universeLoad.cacheHit,
              },
              storage: {
                backend: persistBackend,
                runtimeBackend,
                enabled: persistBackend !== "none",
              },
              alertOptions,
              phase: {
                size: REBUILD_PHASE_SIZE,
                current: currentPhase,
                total: totalPhases,
                nextStart: progress.cursor,
              },
              progress: {
                processed: progress.cursor,
                total: universe.length,
                remaining: universe.length - progress.cursor,
                batchSize,
                nextCursor: progress.cursor,
                failedCount: progress.failedItems.length,
                retryStats: progress.retryStats,
                lastBatch: progress.lastBatch,
              },
              summary: {
                processedCount: progress.processedCount,
                candidateCount: progress.candidates.length,
                durationMs,
                kisCalls: metrics.kisCalls,
                failedCount: progress.failedItems.length,
                retryStats: progress.retryStats,
              },
              failedItems: progress.failedItems.slice(-10),
              warnings: progress.warnings,
              message: `${REBUILD_PHASE_SIZE}종목 단계를 완료했습니다. 다음 호출에서 이어서 처리합니다.`,
            },
            200,
          ),
        );
      }

      return finalize(
        json(
          {
            ok: true,
            inProgress: true,
            mode,
            validationMode,
            rebuiltAt: null,
            universe: {
              label: "거래대금 상위 500",
              source: universeLoad.snapshot.source,
              count: universe.length,
              cacheHit: universeLoad.cacheHit,
            },
            storage: {
              backend: persistBackend,
              runtimeBackend,
              enabled: persistBackend !== "none",
            },
            alertOptions,
            progress: {
              processed: progress.cursor,
              total: universe.length,
              remaining: universe.length - progress.cursor,
              batchSize,
              nextCursor: progress.cursor,
              failedCount: progress.failedItems.length,
              retryStats: progress.retryStats,
              lastBatch: progress.lastBatch,
            },
            summary: {
              processedCount: progress.processedCount,
              candidateCount: progress.candidates.length,
              durationMs,
              kisCalls: metrics.kisCalls,
              failedCount: progress.failedItems.length,
              retryStats: progress.retryStats,
            },
            failedItems: progress.failedItems.slice(-10),
            warnings: progress.warnings,
            message: "재빌드가 진행 중입니다. 같은 엔드포인트를 다시 호출하면 이어서 처리합니다.",
          },
          202,
        ),
      );
    }

    const candidates = sortByAllScore(progress.candidates);
    const previousSnapshot =
      (await getCachedJson<ScreenerSnapshot>(cache, screenerLastSuccessKey())) ??
      (await getPersistedJson<ScreenerSnapshot>(context.env, persistScreenerLastSuccessKey()));
    const changeSummary = buildChangeSummary(previousSnapshot ?? null, candidates);
    const rsSummary = buildRsSummary(candidates);
    const tuningSummary = buildTuningSummary(candidates);
    const validation = await runValidationAutomation(
      context.env,
      validationMode,
      candidates,
    );
    const validationSummary = validation.state;
    progress.warnings = dedupeWarnings([...progress.warnings, ...validation.warnings]);
    const alertCandidates = buildAlertCandidates(changeSummary, alertOptions);
    const alerts = await applyAlertCooldown(context.env, alertOptions, alertCandidates);
    const durationMs = Date.now() - startedAtMs;

    const snapshot: ScreenerSnapshot = {
      date,
      updatedAt: nowIsoKst(),
      universeCount: universe.length,
      processedCount: progress.processedCount,
      topN: TOP_N_STORE,
      source: "KIS",
      warnings: progress.warnings,
      candidates,
      topCandidates: candidates.slice(0, TOP_N_STORE),
      changeSummary,
      rsSummary,
      tuningSummary,
      validationSummary,
      rebuildMeta: {
        durationMs,
        batchSize,
        kisCalls: metrics.kisCalls,
        ohlcvFailures: progress.ohlcvFailures,
        insufficientData: progress.insufficientData,
        failedItems: progress.failedItems.slice(-MAX_FAILED_ITEMS_KEEP),
        retryStats: progress.retryStats,
      },
      alertsMeta: {
        cooldownDays: alertOptions.cooldownDays,
        minScore: alertOptions.minScore,
        minRankDelta: alertOptions.minRankDelta,
        topN: alertOptions.topN,
        sentCount: alerts.sentCount,
        skippedCount: alerts.skippedCount,
      },
    };

    await putCachedJson(cache, screenerDateKey(date), snapshot, SCREENER_CACHE_TTL_SEC);
    await putCachedJson(cache, screenerLastSuccessKey(), snapshot, SCREENER_CACHE_TTL_SEC);
    if (persistBackend !== "none") {
      await Promise.all([
        putPersistedJson(context.env, persistScreenerDateKey(date), snapshot, PERSIST_HISTORY_TTL_SEC),
        putPersistedJson(
          context.env,
          persistScreenerLastSuccessKey(),
          snapshot,
          PERSIST_HISTORY_TTL_SEC,
        ),
        putPersistedJson(
          context.env,
          persistFailureHistoryKey(date),
          {
            date,
            updatedAt: snapshot.updatedAt,
            ohlcvFailures: progress.ohlcvFailures,
            insufficientData: progress.insufficientData,
            failedItems: progress.failedItems.slice(-MAX_FAILED_ITEMS_KEEP),
            retryStats: progress.retryStats,
          },
          PERSIST_HISTORY_TTL_SEC,
        ),
        putPersistedJson(
          context.env,
          persistChangeHistoryKey(date),
          {
            date,
            updatedAt: snapshot.updatedAt,
            changeSummary,
            alertsMeta: snapshot.alertsMeta ?? null,
            validationSummary: snapshot.validationSummary ?? null,
          },
          PERSIST_HISTORY_TTL_SEC,
        ),
      ]);
    }
    await clearRebuildRuntimeProgress(context.env, cache, date);

    console.log(
      `[rebuild-screener-done] ${JSON.stringify({
        date,
        durationMs,
        batchSize,
        universeCacheHit: universeLoad.cacheHit,
        universeSource: universeLoad.snapshot.source,
        universeCount: universe.length,
        processedCount: progress.processedCount,
        candidateCount: candidates.length,
        ohlcvFailures: progress.ohlcvFailures,
        insufficientData: progress.insufficientData,
        failedCount: progress.failedItems.length,
        retries: progress.retryStats.totalRetries,
        kisCalls: metrics.kisCalls,
        validationActiveCutoffs: validationSummary?.activeCutoffs ?? null,
      })}`,
    );

    return finalize(
      json(
        {
          ok: true,
          inProgress: false,
          mode,
          validationMode,
          rebuiltAt: snapshot.updatedAt,
          universe: {
            label: "거래대금 상위 500",
            source: universeLoad.snapshot.source,
            count: universe.length,
            cacheHit: universeLoad.cacheHit,
          },
          storage: {
            backend: persistBackend,
            runtimeBackend,
            enabled: persistBackend !== "none",
          },
          alertOptions,
          summary: {
            processedCount: progress.processedCount,
            candidateCount: candidates.length,
            topStored: snapshot.topCandidates.length,
            durationMs,
            kisCalls: metrics.kisCalls,
            failedCount: progress.failedItems.length,
            retryStats: progress.retryStats,
          },
          failedItems: progress.failedItems.slice(-10),
          changes: changeSummary,
          rsSummary,
          tuningSummary,
          validationSummary,
          alerts,
          warnings: snapshot.warnings,
        },
        200,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "rebuild-screener error";
    return finalize(serverError(message, context.request));
  } finally {
    if (lockAcquired) {
      await clearRebuildRuntimeLock(context.env, cache);
    }
  }
};
