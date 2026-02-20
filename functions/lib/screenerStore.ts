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
}
