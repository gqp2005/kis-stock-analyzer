import { getCachedJson, putCachedJson } from "./cache";
import { getPersistedJson } from "./screenerPersistence";
import {
  SCREENER_CACHE_TTL_SEC,
  persistScreenerDateKey,
  persistScreenerLastSuccessKey,
  screenerDateKey,
  screenerLastSuccessKey,
  type ScreenerSnapshot,
} from "./screenerStore";
import type { Env } from "./types";

export type ScreenerSnapshotSource =
  | "cache_today"
  | "persist_today"
  | "cache_last_success"
  | "persist_last_success"
  | "none";

export interface ScreenerSnapshotBundle {
  snapshot: ScreenerSnapshot | null;
  source: ScreenerSnapshotSource;
  isToday: boolean;
  fromPersistence: boolean;
  hydratedCache: boolean;
}

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const TRANSIENT_SNAPSHOT_WARNING_PATTERNS: RegExp[] = [
  /^리빌드 초기화 중입니다\./,
  /^이전 단계 완료:/,
  /^요청 시간 예산\(/,
];

const USER_NOISY_WARNING_PATTERNS: RegExp[] = [
  /^현재 rebuild 진행 중:/,
  /^리빌드 초기화 중입니다\./,
  /^요청 시간 예산\(/,
  /^ExternalProvider 실패로 StaticProvider 유니버스를 사용했습니다\./,
  /^External\/Backup 소스 실패로 StaticProvider 유니버스를 사용했습니다\./,
  /^Primary 유니버스 소스 실패로 보조 소스/,
  /^Cache API miss로 영속 저장소\(KV\/D1\) 결과를 반환합니다\./,
];

const pickFresherLastSuccess = (
  cachedLastSuccess: ScreenerSnapshot | null,
  persistedLastSuccess: ScreenerSnapshot | null,
): { snapshot: ScreenerSnapshot; source: "cache_last_success" | "persist_last_success" } | null => {
  if (cachedLastSuccess && persistedLastSuccess) {
    if (persistedLastSuccess.date > cachedLastSuccess.date) {
      return { snapshot: persistedLastSuccess, source: "persist_last_success" };
    }
    return { snapshot: cachedLastSuccess, source: "cache_last_success" };
  }
  if (cachedLastSuccess) {
    return { snapshot: cachedLastSuccess, source: "cache_last_success" };
  }
  if (persistedLastSuccess) {
    return { snapshot: persistedLastSuccess, source: "persist_last_success" };
  }
  return null;
};

const hydrateSnapshotCache = async (
  cache: Cache,
  date: string,
  snapshot: ScreenerSnapshot,
  source: ScreenerSnapshotSource,
): Promise<boolean> => {
  const writes: Promise<void>[] = [];

  if (snapshot.date === date && source !== "cache_today") {
    writes.push(putCachedJson(cache, screenerDateKey(date), snapshot, SCREENER_CACHE_TTL_SEC));
  }

  if (source === "persist_today" || source === "persist_last_success") {
    writes.push(putCachedJson(cache, screenerLastSuccessKey(), snapshot, SCREENER_CACHE_TTL_SEC));
  }

  if (writes.length === 0) return false;
  await Promise.all(writes);
  return true;
};

export const sanitizeScreenerSnapshotWarnings = (warnings: string[]): string[] => {
  let latestInsufficientDataWarning: string | null = null;
  let latestOhlcvFailureWarning: string | null = null;
  let latestRetryWarning: string | null = null;
  const passthrough: string[] = [];

  for (const warning of dedupeWarnings(warnings)) {
    if (TRANSIENT_SNAPSHOT_WARNING_PATTERNS.some((pattern) => pattern.test(warning))) {
      continue;
    }
    if (/^데이터 부족 \d+종목 제외$/.test(warning)) {
      latestInsufficientDataWarning = warning;
      continue;
    }
    if (/^OHLCV 조회 실패 \d+종목 제외$/.test(warning)) {
      latestOhlcvFailureWarning = warning;
      continue;
    }
    if (/^재시도 수행 \d+종목 \/ 총 \d+회$/.test(warning)) {
      latestRetryWarning = warning;
      continue;
    }
    passthrough.push(warning);
  }

  return [
    ...passthrough,
    latestInsufficientDataWarning,
    latestOhlcvFailureWarning,
    latestRetryWarning,
  ].filter((warning): warning is string => warning != null);
};

export const sanitizeUserScreenerWarnings = (warnings: string[], maxItems = 8): string[] =>
  sanitizeScreenerSnapshotWarnings(warnings)
    .filter((warning) => !USER_NOISY_WARNING_PATTERNS.some((pattern) => pattern.test(warning)))
    .slice(0, maxItems);

export const loadScreenerSnapshotBundle = async (
  env: Env,
  cache: Cache,
  date: string,
): Promise<ScreenerSnapshotBundle> => {
  const cachedToday = await getCachedJson<ScreenerSnapshot>(cache, screenerDateKey(date));
  if (cachedToday?.date === date) {
    return {
      snapshot: cachedToday,
      source: "cache_today",
      isToday: true,
      fromPersistence: false,
      hydratedCache: false,
    };
  }

  const [persistedTodayRaw, cachedLastSuccess, persistedLastSuccess] = await Promise.all([
    getPersistedJson<ScreenerSnapshot>(env, persistScreenerDateKey(date)),
    getCachedJson<ScreenerSnapshot>(cache, screenerLastSuccessKey()),
    getPersistedJson<ScreenerSnapshot>(env, persistScreenerLastSuccessKey()),
  ]);

  const persistedToday = persistedTodayRaw?.date === date ? persistedTodayRaw : null;
  const picked =
    (persistedToday ? { snapshot: persistedToday, source: "persist_today" as const } : null) ??
    pickFresherLastSuccess(cachedLastSuccess, persistedLastSuccess);

  if (!picked) {
    return {
      snapshot: null,
      source: "none",
      isToday: false,
      fromPersistence: false,
      hydratedCache: false,
    };
  }

  const hydratedCache = await hydrateSnapshotCache(cache, date, picked.snapshot, picked.source);
  return {
    snapshot: picked.snapshot,
    source: picked.source,
    isToday: picked.snapshot.date === date,
    fromPersistence: picked.source.startsWith("persist"),
    hydratedCache,
  };
};
