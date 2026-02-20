import { getCachedJson, putCachedJson } from "../../lib/cache";
import { fetchTimeframeCandles } from "../../lib/kis";
import { nowIsoKst } from "../../lib/market";
import { attachMetrics, createRequestMetrics } from "../../lib/observability";
import { errorJson, json, serverError } from "../../lib/response";
import { analyzeScreenerRawCandidate } from "../../lib/screener";
import {
  REBUILD_LOCK_TTL_SEC,
  SCREENER_CACHE_TTL_SEC,
  type ScreenerSnapshot,
  type UniverseSnapshot,
  rebuildLockKey,
  screenerDateKey,
  screenerLastSuccessKey,
  universeDateKey,
  universeLastSuccessKey,
} from "../../lib/screenerStore";
import { ExternalProvider, StaticProvider } from "../../lib/universe";
import type { Env } from "../../lib/types";

const TARGET_UNIVERSE = 500;
const TOP_N_STORE = 50;

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  const url = new URL(context.request.url);
  const token = url.searchParams.get("token") ?? context.request.headers.get("x-admin-token");
  if (!context.env.ADMIN_TOKEN || token !== context.env.ADMIN_TOKEN) {
    return finalize(buildUnauthorized(context.request));
  }

  const cache = await caches.open("kis-analyzer-cache-v3");
  const lockKey = rebuildLockKey();
  const lockReq = new Request(lockKey);
  const existingLock = await getCachedJson<{ startedAt: string }>(cache, lockKey);
  if (existingLock) {
    return finalize(
      errorJson(409, "REBUILD_IN_PROGRESS", "이미 rebuild가 실행 중입니다.", context.request),
    );
  }

  await putCachedJson(
    cache,
    lockKey,
    {
      startedAt: nowIsoKst(),
      ttlSec: REBUILD_LOCK_TTL_SEC,
    },
    REBUILD_LOCK_TTL_SEC,
  );

  const startedAtMs = Date.now();
  let lockReleased = false;

  try {
    const date = nowIsoKst().slice(0, 10);
    const warnings: string[] = [];
    let universeCacheHit = false;

    const dailyUniverseKey = universeDateKey(date);
    let universeSnapshot = await getCachedJson<UniverseSnapshot>(cache, dailyUniverseKey);

    if (universeSnapshot && universeSnapshot.items.length > 0) {
      universeCacheHit = true;
    } else {
      const externalProvider = new ExternalProvider();
      try {
        const externalUniverse = await externalProvider.getTopByTurnover(date, TARGET_UNIVERSE);
        universeSnapshot = {
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
          universeSnapshot = {
            ...lastUniverse,
            date,
            updatedAt: nowIsoKst(),
            source: "LAST_SUCCESS",
            warnings: [...lastUniverse.warnings, "마지막 성공 유니버스를 사용했습니다."],
          };
        } else {
          const staticProvider = new StaticProvider();
          const staticUniverse = await staticProvider.getTopByTurnover(date, TARGET_UNIVERSE);
          universeSnapshot = {
            date,
            updatedAt: nowIsoKst(),
            source: "STATIC",
            items: staticUniverse,
            warnings: ["ExternalProvider 실패로 StaticProvider 유니버스를 사용했습니다."],
          };
        }
      }

      await putCachedJson(cache, dailyUniverseKey, universeSnapshot, SCREENER_CACHE_TTL_SEC);
      await putCachedJson(cache, universeLastSuccessKey(), universeSnapshot, SCREENER_CACHE_TTL_SEC);
    }

    const universe = universeSnapshot.items.slice(0, TARGET_UNIVERSE);
    let ohlcvFailures = 0;
    let insufficientData = 0;
    let processed = 0;

    const rawCandidates = await mapLimit(universe, 8, async (entry) => {
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
          insufficientData += 1;
          return null;
        }
        processed += 1;
        return candidate;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.log(`[rebuild-screener-item-fail] code=${entry.code} reason=${message}`);
        ohlcvFailures += 1;
        return null;
      }
    });

    const candidates = sortByAllScore(
      rawCandidates.filter(
        (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
      ),
    );

    const screenerSnapshot: ScreenerSnapshot = {
      date,
      updatedAt: nowIsoKst(),
      universeCount: universe.length,
      processedCount: processed,
      topN: TOP_N_STORE,
      source: "KIS",
      warnings: dedupeWarnings([
        ...warnings,
        ...universeSnapshot.warnings,
        insufficientData > 0 ? `데이터 부족 ${insufficientData}종목 제외` : "",
        ohlcvFailures > 0 ? `OHLCV 조회 실패 ${ohlcvFailures}종목 제외` : "",
      ].filter((msg) => msg.length > 0)),
      candidates,
      topCandidates: candidates.slice(0, TOP_N_STORE),
    };

    const dailyScreenerKey = screenerDateKey(date);
    await putCachedJson(cache, dailyScreenerKey, screenerSnapshot, SCREENER_CACHE_TTL_SEC);
    await putCachedJson(
      cache,
      screenerLastSuccessKey(),
      screenerSnapshot,
      SCREENER_CACHE_TTL_SEC,
    );

    const durationMs = Date.now() - startedAtMs;
    console.log(
      `[rebuild-screener] ${JSON.stringify({
        date,
        durationMs,
        universeCacheHit,
        universeSource: universeSnapshot.source,
        universeCount: universe.length,
        processedCount: processed,
        candidateCount: candidates.length,
        ohlcvFailures,
        insufficientData,
        kisCalls: metrics.kisCalls,
      })}`,
    );

    return finalize(
      json(
        {
          ok: true,
          rebuiltAt: screenerSnapshot.updatedAt,
          universe: {
            label: "거래대금 상위 500",
            source: universeSnapshot.source,
            count: universe.length,
            cacheHit: universeCacheHit,
          },
          summary: {
            processedCount: processed,
            candidateCount: candidates.length,
            topStored: screenerSnapshot.topCandidates.length,
            durationMs,
            kisCalls: metrics.kisCalls,
          },
          warnings: screenerSnapshot.warnings,
        },
        200,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "rebuild-screener error";
    return finalize(serverError(message, context.request));
  } finally {
    if (!lockReleased) {
      await cache.delete(lockReq);
      lockReleased = true;
    }
  }
};

