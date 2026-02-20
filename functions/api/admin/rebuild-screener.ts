import { getCachedJson, putCachedJson } from "../../lib/cache";
import { fetchTimeframeCandles } from "../../lib/kis";
import { nowIsoKst } from "../../lib/market";
import { attachMetrics, createRequestMetrics } from "../../lib/observability";
import { errorJson, json, serverError } from "../../lib/response";
import { analyzeScreenerRawCandidate } from "../../lib/screener";
import {
  REBUILD_LOCK_TTL_SEC,
  SCREENER_CACHE_TTL_SEC,
  type RebuildProgressSnapshot,
  type ScreenerSnapshot,
  type UniverseSnapshot,
  rebuildLockKey,
  rebuildProgressKey,
  screenerDateKey,
  screenerLastSuccessKey,
  universeDateKey,
  universeLastSuccessKey,
} from "../../lib/screenerStore";
import { ExternalProvider, StaticProvider } from "../../lib/universe";
import type { Env } from "../../lib/types";

const TARGET_UNIVERSE = 500;
const TOP_N_STORE = 50;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 120;
const PARALLEL_PER_BATCH = 2;
const LOCK_STALE_SEC = 5 * 60;

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const sortByAllScore = <T extends { scoring: { all: { score: number; confidence: number } } }>(
  candidates: T[],
): T[] =>
  [...candidates].sort(
    (a, b) =>
      b.scoring.all.score - a.scoring.all.score ||
      b.scoring.all.confidence - a.scoring.all.confidence,
  );

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
};

const buildUnauthorized = (request: Request): Response =>
  errorJson(401, "UNAUTHORIZED", "유효한 admin token이 필요합니다.", request);

const parseBatchSize = (url: URL): number => {
  const raw = Number(url.searchParams.get("batch") ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_SIZE;
  return Math.max(5, Math.min(MAX_BATCH_SIZE, Math.floor(raw)));
};

const parseTimeMs = (iso: string | undefined): number => {
  if (!iso) return 0;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
};

const isLockStale = (startedAt: string | undefined): boolean => {
  const startedAtMs = parseTimeMs(startedAt);
  if (!startedAtMs) return true;
  return Date.now() - startedAtMs > LOCK_STALE_SEC * 1000;
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
        warnings: ["ExternalProvider 실패로 StaticProvider 유니버스를 사용했습니다."],
      };
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
});

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  const url = new URL(context.request.url);
  const token = url.searchParams.get("token") ?? context.request.headers.get("x-admin-token");
  if (!context.env.ADMIN_TOKEN || token !== context.env.ADMIN_TOKEN) {
    return finalize(buildUnauthorized(context.request));
  }

  const cache = await caches.open("kis-analyzer-cache-v3");
  const date = nowIsoKst().slice(0, 10);
  const progressKey = rebuildProgressKey(date);
  const lockKey = rebuildLockKey();
  const lockReq = new Request(lockKey);
  const existingLock = await getCachedJson<{ startedAt: string }>(cache, lockKey);
  if (existingLock && !isLockStale(existingLock.startedAt)) {
    const progress = await getCachedJson<RebuildProgressSnapshot>(cache, progressKey);
    return finalize(
      json(
        {
          ok: true,
          inProgress: true,
          rebuiltAt: null,
          universe: {
            label: "거래대금 상위 500",
            source: "KIS",
            count: progress?.universeCount ?? TARGET_UNIVERSE,
            cacheHit: true,
          },
          progress: progress
            ? {
                processed: progress.cursor,
                total: progress.universeCount,
                remaining: Math.max(0, progress.universeCount - progress.cursor),
                batchSize: parseBatchSize(url),
                nextCursor: progress.cursor,
              }
            : null,
          summary: progress
            ? {
                processedCount: progress.processedCount,
                candidateCount: progress.candidates.length,
                durationMs: null,
                kisCalls: metrics.kisCalls,
              }
            : null,
          warnings: progress?.warnings ?? [],
          message: "이미 rebuild가 실행 중입니다. 잠시 후 같은 엔드포인트를 다시 호출하세요.",
        },
        202,
      ),
    );
  }

  if (existingLock && isLockStale(existingLock.startedAt)) {
    await cache.delete(lockReq);
  }

  const startedAtMs = Date.now();
  let lockAcquired = false;

  try {
    await putCachedJson(
      cache,
      lockKey,
      {
        startedAt: nowIsoKst(),
        ttlSec: REBUILD_LOCK_TTL_SEC,
      },
      REBUILD_LOCK_TTL_SEC,
    );
    lockAcquired = true;

    const batchSize = parseBatchSize(url);

    const universeLoad = await loadUniverseSnapshot(cache, date);
    const universe = universeLoad.snapshot.items.slice(0, TARGET_UNIVERSE);

    const prevProgress = await getCachedJson<RebuildProgressSnapshot>(cache, progressKey);
    let progress =
      prevProgress && prevProgress.universeCount === universe.length
        ? prevProgress
        : createProgress(date, universe.length, [
            ...universeLoad.providerWarnings,
            ...universeLoad.snapshot.warnings,
          ]);

    const start = Math.max(0, Math.min(progress.cursor, universe.length));
    const endExclusive = Math.min(universe.length, start + batchSize);
    const batchItems = universe.slice(start, endExclusive);

    const batchResults = await mapLimit(batchItems, PARALLEL_PER_BATCH, async (entry) => {
      try {
        const fetched = await fetchTimeframeCandles(
          context.env,
          cache,
          entry.code,
          "day",
          280,
          metrics,
        );
        const candidate = analyzeScreenerRawCandidate(entry, fetched.candles.slice(-280), false);
        if (!candidate) {
          return { kind: "insufficient" as const, candidate: null };
        }
        return { kind: "ok" as const, candidate };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.log(`[rebuild-screener-item-fail] code=${entry.code} reason=${message}`);
        return { kind: "failed" as const, candidate: null };
      }
    });

    for (const result of batchResults) {
      if (result.kind === "ok" && result.candidate) {
        progress.candidates.push(result.candidate);
        progress.processedCount += 1;
      } else if (result.kind === "insufficient") {
        progress.insufficientData += 1;
      } else {
        progress.ohlcvFailures += 1;
      }
    }
    progress.cursor = endExclusive;
    progress.updatedAt = nowIsoKst();
    progress.warnings = dedupeWarnings([
      ...progress.warnings,
      ...universeLoad.providerWarnings,
      ...universeLoad.snapshot.warnings,
      progress.insufficientData > 0
        ? `데이터 부족 ${progress.insufficientData}종목 제외`
        : "",
      progress.ohlcvFailures > 0
        ? `OHLCV 조회 실패 ${progress.ohlcvFailures}종목 제외`
        : "",
    ].filter((msg) => msg.length > 0));

    if (progress.cursor < universe.length) {
      await putCachedJson(cache, progressKey, progress, SCREENER_CACHE_TTL_SEC);
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
          kisCalls: metrics.kisCalls,
        })}`,
      );

      return finalize(
        json(
          {
            ok: true,
            inProgress: true,
            rebuiltAt: null,
            universe: {
              label: "거래대금 상위 500",
              source: universeLoad.snapshot.source,
              count: universe.length,
              cacheHit: universeLoad.cacheHit,
            },
            progress: {
              processed: progress.cursor,
              total: universe.length,
              remaining: universe.length - progress.cursor,
              batchSize,
              nextCursor: progress.cursor,
            },
            summary: {
              processedCount: progress.processedCount,
              candidateCount: progress.candidates.length,
              durationMs,
              kisCalls: metrics.kisCalls,
            },
            warnings: progress.warnings,
            message: "재빌드가 진행 중입니다. 같은 엔드포인트를 다시 호출하면 이어서 처리합니다.",
          },
          202,
        ),
      );
    }

    const candidates = sortByAllScore(progress.candidates);
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
    };

    await putCachedJson(cache, screenerDateKey(date), snapshot, SCREENER_CACHE_TTL_SEC);
    await putCachedJson(cache, screenerLastSuccessKey(), snapshot, SCREENER_CACHE_TTL_SEC);
    await cache.delete(new Request(progressKey));

    const durationMs = Date.now() - startedAtMs;
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
        kisCalls: metrics.kisCalls,
      })}`,
    );

    return finalize(
      json(
        {
          ok: true,
          inProgress: false,
          rebuiltAt: snapshot.updatedAt,
          universe: {
            label: "거래대금 상위 500",
            source: universeLoad.snapshot.source,
            count: universe.length,
            cacheHit: universeLoad.cacheHit,
          },
          summary: {
            processedCount: progress.processedCount,
            candidateCount: candidates.length,
            topStored: snapshot.topCandidates.length,
            durationMs,
            kisCalls: metrics.kisCalls,
          },
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
      await cache.delete(lockReq);
    }
  }
};
