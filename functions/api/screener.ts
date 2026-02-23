import { getCachedJson } from "../lib/cache";
import { nowIsoKst } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { json, serverError } from "../lib/response";
import { buildScreenerView } from "../lib/screener";
import {
  SCREENER_CACHE_TTL_SEC,
  type RebuildProgressSnapshot,
  type ScreenerSnapshot,
  rebuildProgressKey,
  screenerDateKey,
  screenerLastSuccessKey,
} from "../lib/screenerStore";
import type {
  Env,
  ScreenerMarketFilter,
  ScreenerPayload,
  ScreenerStrategyFilter,
} from "../lib/types";

const parseMarket = (raw: string | null): ScreenerMarketFilter => {
  const normalized = (raw ?? "ALL").toUpperCase();
  if (normalized === "KOSPI" || normalized === "KOSDAQ" || normalized === "ALL") {
    return normalized;
  }
  return "ALL";
};

const parseStrategy = (raw: string | null): ScreenerStrategyFilter => {
  const normalized = (raw ?? "ALL").toUpperCase();
  if (
    normalized === "ALL" ||
    normalized === "VOLUME" ||
    normalized === "HS" ||
    normalized === "IHS" ||
    normalized === "VCP"
  ) {
    return normalized;
  }
  return "ALL";
};

const parseCount = (raw: string | null): number => {
  const parsed = Number(raw ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(100, Math.floor(parsed)));
};

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const normalizeProgress = (
  progress: RebuildProgressSnapshot | null,
): RebuildProgressSnapshot | null => {
  if (!progress) return null;
  return {
    ...progress,
    failedItems: Array.isArray(progress.failedItems) ? progress.failedItems : [],
    retryStats: progress.retryStats ?? {
      totalRetries: 0,
      retriedSymbols: 0,
      maxRetryPerSymbol: 0,
    },
    lastBatch: progress.lastBatch ?? null,
  };
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const url = new URL(context.request.url);
    const market = parseMarket(url.searchParams.get("market"));
    const strategy = parseStrategy(url.searchParams.get("strategy"));
    const count = parseCount(url.searchParams.get("count"));

    const cache = await caches.open("kis-analyzer-cache-v3");
    const today = nowIsoKst().slice(0, 10);
    const todayKey = screenerDateKey(today);
    const lastSuccessKey = screenerLastSuccessKey();
    const progress = normalizeProgress(
      await getCachedJson<RebuildProgressSnapshot>(cache, rebuildProgressKey(today)),
    );

    let snapshot = await getCachedJson<ScreenerSnapshot>(cache, todayKey);
    let rebuildRequired = false;
    const warnings: string[] = [];

    if (snapshot) {
      metrics.apiCacheHits += 1;
      console.log(`[screener-cache-hit] date=${today}`);
    } else {
      metrics.apiCacheMisses += 1;
      rebuildRequired = true;
      console.log(`[screener-cache-miss] date=${today}`);
      snapshot = await getCachedJson<ScreenerSnapshot>(cache, lastSuccessKey);
      if (snapshot) {
        warnings.push("오늘 스크리너 캐시가 없어 마지막 성공 결과를 반환합니다. 재빌드가 필요합니다.");
      } else {
        warnings.push("스크리너 결과 캐시가 없습니다. /api/admin/rebuild-screener 실행이 필요합니다.");
      }
      if (progress && progress.universeCount > 0) {
        warnings.push(
          `현재 rebuild 진행 중: ${progress.cursor}/${progress.universeCount} 처리됨`,
        );
        if (progress.failedItems.length > 0) {
          warnings.push(
            `진행 중 실패 ${progress.failedItems.length}종목, 재시도 ${progress.retryStats.totalRetries}회`,
          );
        }
      }
    }

    if (!snapshot) {
      const emptyPayload: ScreenerPayload = {
        meta: {
          market,
          strategy,
          count,
          universe: 500,
          scanned: 0,
          candidates: 0,
          asOf: nowIsoKst(),
          lastUpdatedAt: null,
          universeLabel: "거래대금 상위 500 유니버스",
          source: "KIS",
          cacheTtlSec: SCREENER_CACHE_TTL_SEC,
          includeBacktest: false,
          rebuildRequired: true,
          changeSummary: null,
          rsSummary: null,
          tuningSummary: null,
          lastRebuildStatus: progress
            ? {
                inProgress: true,
                processed: progress.cursor,
                total: progress.universeCount,
                updatedAt: progress.updatedAt,
                failedCount: progress.failedItems.length,
                retriedSymbols: progress.retryStats.retriedSymbols,
                totalRetries: progress.retryStats.totalRetries,
              }
            : null,
        },
        items: [],
        warningItems: [],
        warnings: dedupeWarnings(warnings),
      };
      return finalize(
        json(emptyPayload, 200, {
          "x-cache": "MISS",
          "cache-control": "public, max-age=30",
        }),
      );
    }

    const filteredCount = snapshot.candidates.filter((candidate) =>
      market === "ALL" ? true : candidate.market === market,
    ).length;
    const view = buildScreenerView(snapshot.candidates, market, strategy, count);

    const payload: ScreenerPayload = {
      meta: {
        market,
        strategy,
        count,
        universe: snapshot.universeCount,
        scanned: snapshot.processedCount,
        candidates: filteredCount,
        asOf: nowIsoKst(),
        lastUpdatedAt: snapshot.updatedAt,
        universeLabel: "거래대금 상위 500 유니버스",
        source: "KIS",
        cacheTtlSec: SCREENER_CACHE_TTL_SEC,
        includeBacktest: false,
        rebuildRequired,
        changeSummary: snapshot.changeSummary
          ? {
              basisTopN: snapshot.changeSummary.basisTopN,
              added: snapshot.changeSummary.added.map((item) => ({
                code: item.code,
                name: item.name,
                currRank: item.currRank,
              })),
              removed: snapshot.changeSummary.removed.map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
              })),
              risers: snapshot.changeSummary.risers.map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
                currRank: item.currRank,
              })),
              fallers: snapshot.changeSummary.fallers.map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
                currRank: item.currRank,
              })),
            }
          : null,
        rsSummary: snapshot.rsSummary ?? null,
        tuningSummary: snapshot.tuningSummary ?? null,
        lastRebuildStatus: progress
          ? {
              inProgress: true,
              processed: progress.cursor,
              total: progress.universeCount,
              updatedAt: progress.updatedAt,
              failedCount: progress.failedItems.length,
              retriedSymbols: progress.retryStats.retriedSymbols,
              totalRetries: progress.retryStats.totalRetries,
            }
          : {
              inProgress: false,
              processed: snapshot.processedCount,
              total: snapshot.universeCount,
              updatedAt: snapshot.updatedAt,
              failedCount: snapshot.rebuildMeta?.failedItems.length ?? 0,
              retriedSymbols: snapshot.rebuildMeta?.retryStats.retriedSymbols ?? 0,
              totalRetries: snapshot.rebuildMeta?.retryStats.totalRetries ?? 0,
            },
      },
      items: view.items,
      warningItems: view.warningItems,
      warnings: dedupeWarnings([
        ...warnings,
        ...snapshot.warnings,
        strategy !== "HS"
          ? "RS 약세(지수 대비 상대약세) 종목은 기본 후보에서 제외됩니다."
          : "",
        strategy === "ALL"
          ? "후보 리스트는 상승 시그널 중심이며 H&S 확정 종목은 리스크 경고 섹션에 함께 표시됩니다."
          : "",
      ].filter((msg) => msg.length > 0)),
    };

    return finalize(
      json(payload, 200, {
        "x-cache": snapshot.date === today ? "HIT" : "STALE",
        "cache-control": "public, max-age=30",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "screener endpoint error";
    return finalize(serverError(message, context.request));
  }
};
