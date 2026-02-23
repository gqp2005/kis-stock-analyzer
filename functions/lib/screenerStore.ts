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

export interface ScreenerRankChangeItem {
  code: string;
  name: string;
  market: string;
  prevRank: number | null;
  currRank: number | null;
  deltaRank: number | null;
  score: number;
  confidence: number;
}

export interface ScreenerChangeSummary {
  generatedAt: string;
  basisTopN: number;
  added: ScreenerRankChangeItem[];
  removed: ScreenerRankChangeItem[];
  risers: ScreenerRankChangeItem[];
  fallers: ScreenerRankChangeItem[];
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

export interface UniverseSnapshot {
  date: string;
  updatedAt: string;
  source: "EXTERNAL" | "STATIC" | "LAST_SUCCESS";
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
  rebuildMeta?: {
    durationMs: number;
    batchSize: number;
    kisCalls: number;
    ohlcvFailures: number;
    insufficientData: number;
    failedItems: RebuildFailureItem[];
    retryStats: RebuildRetryStats;
  };
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
