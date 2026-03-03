import type { ScreenerStoredCandidate } from "./screener";
import type { UniverseTurnoverItem } from "./universe";

export const SCREENER_CACHE_TTL_SEC = 24 * 60 * 60;
export const REBUILD_LOCK_TTL_SEC = 15 * 60;

const toCacheUrl = (key: string): string => `https://cache.local/${key}`;

export const universeDateKey = (date: string): string =>
  toCacheUrl(`universe:turnoverTop500:${date}`);

export const universeLastSuccessKey = (): string =>
  toCacheUrl("universe:turnoverTop500:last_success");

export const screenerDateKey = (date: string): string =>
  toCacheUrl(`screener:v1:market=ALL:strategy=ALL:${date}`);

export const screenerLastSuccessKey = (): string =>
  toCacheUrl("screener:v1:market=ALL:strategy=ALL:last_success");

export const rebuildLockKey = (): string =>
  toCacheUrl("lock:rebuild-screener");

export const rebuildProgressKey = (date: string): string =>
  toCacheUrl(`screener:v1:rebuild-progress:${date}`);

export const persistScreenerDateKey = (date: string): string =>
  `snapshot:date:${date}`;

export const persistScreenerLastSuccessKey = (): string =>
  "snapshot:last_success";

export const persistChangeHistoryKey = (date: string): string =>
  `history:changes:${date}`;

export const persistChangeHistoryPrefix = (): string =>
  "history:changes:";

export const persistFailureHistoryKey = (date: string): string =>
  `history:failures:${date}`;

export const persistFailureHistoryPrefix = (): string =>
  "history:failures:";

export const persistAlertStateKey = (): string =>
  "alerts:last_sent";

export const persistValidationStateKey = (): string =>
  "validation:state";

export const persistValidationHistoryKey = (
  period: "weekly" | "monthly",
  date: string,
): string => `history:validation:${period}:${date}`;

export const persistValidationHistoryPrefix = (
  period?: "weekly" | "monthly",
): string => (period ? `history:validation:${period}:` : "history:validation:");

export interface RebuildFailureItem {
  code: string;
  name: string;
  market: string;
  reason: string;
  retries: number;
  at: string;
}

export interface RebuildRetryStats {
  totalRetries: number;
  retriedSymbols: number;
  maxRetryPerSymbol: number;
}

export interface AlertSentState {
  sentAt: string;
}

export interface AlertStateSnapshot {
  updatedAt: string;
  sent: Record<string, AlertSentState>;
}

export interface ScreenerRankChangeItem {
  code: string;
  name: string;
  market: string;
  prevRank: number | null;
  currRank: number | null;
  deltaRank: number | null;
  score: number;
  confidence: number;
  prevScore: number | null;
  currScore: number | null;
  scoreDelta: number | null;
  prevConfidence: number | null;
  currConfidence: number | null;
  confidenceDelta: number | null;
}

export interface ScreenerChangeSummary {
  generatedAt: string;
  basisTopN: number;
  added: ScreenerRankChangeItem[];
  removed: ScreenerRankChangeItem[];
  risers: ScreenerRankChangeItem[];
  fallers: ScreenerRankChangeItem[];
  scoreRisers: ScreenerRankChangeItem[];
  scoreFallers: ScreenerRankChangeItem[];
}

export interface ScreenerRsSummary {
  enabled: boolean;
  benchmarkMarkets: string[];
  matched: number;
  weak: number;
  missing: number;
}

export interface ScreenerTuningSummary {
  enabled: boolean;
  sampleCount: number;
  avgThresholds: {
    volume: number;
    hs: number;
    ihs: number;
    vcp: number;
  } | null;
}

export interface ScreenerAdaptiveCutoffs {
  all: number;
  volume: number;
  hs: number;
  ihs: number;
  vcp: number;
}

export interface ScreenerValidationStrategySummary {
  trades: number;
  winRate: number | null;
  pf: number | null;
  mdd: number | null;
  quality: number | null;
  recommendedCutoff: number;
}

export interface ScreenerValidationRunSummary {
  period: "weekly" | "monthly";
  generatedAt: string;
  sampleCount: number;
  cutoffs: ScreenerAdaptiveCutoffs;
  strategies: {
    all: ScreenerValidationStrategySummary;
    volume: ScreenerValidationStrategySummary;
    hs: ScreenerValidationStrategySummary;
    ihs: ScreenerValidationStrategySummary;
    vcp: ScreenerValidationStrategySummary;
  };
}

export interface ScreenerValidationState {
  updatedAt: string;
  lastWeeklyAt: string | null;
  lastMonthlyAt: string | null;
  activeCutoffs: ScreenerAdaptiveCutoffs;
  latestRuns: {
    weekly: ScreenerValidationRunSummary | null;
    monthly: ScreenerValidationRunSummary | null;
  };
}

export interface UniverseSnapshot {
  date: string;
  updatedAt: string;
  source: "EXTERNAL" | "EXTERNAL_BACKUP" | "STATIC" | "LAST_SUCCESS";
  items: UniverseTurnoverItem[];
  warnings: string[];
}

export interface ScreenerSnapshot {
  date: string;
  updatedAt: string;
  universeCount: number;
  processedCount: number;
  topN: number;
  source: "KIS";
  warnings: string[];
  candidates: ScreenerStoredCandidate[];
  topCandidates: ScreenerStoredCandidate[];
  changeSummary?: ScreenerChangeSummary | null;
  rsSummary?: ScreenerRsSummary | null;
  tuningSummary?: ScreenerTuningSummary | null;
  validationSummary?: ScreenerValidationState | null;
  rebuildMeta?: {
    durationMs: number;
    batchSize: number;
    kisCalls: number;
    ohlcvFailures: number;
    insufficientData: number;
    failedItems: RebuildFailureItem[];
    retryStats: RebuildRetryStats;
  };
  alertsMeta?: {
    cooldownDays: number;
    minScore: number;
    minRankDelta: number;
    topN: number;
    sentCount: number;
    skippedCount: number;
  } | null;
}

export interface RebuildProgressSnapshot {
  date: string;
  startedAt: string;
  updatedAt: string;
  cursor: number;
  universeCount: number;
  processedCount: number;
  ohlcvFailures: number;
  insufficientData: number;
  warnings: string[];
  candidates: ScreenerStoredCandidate[];
  failedItems: RebuildFailureItem[];
  retryStats: RebuildRetryStats;
  lastBatch: {
    from: number;
    to: number;
    batchSize: number;
  } | null;
}
