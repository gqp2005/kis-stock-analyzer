import { getCachedJson } from "../lib/cache";
import { nowIsoKst } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { json, serverError } from "../lib/response";
import { buildScreenerView } from "../lib/screener";
import { getPersistedJson, persistenceBackend } from "../lib/screenerPersistence";
import {
  SCREENER_CACHE_TTL_SEC,
  type RebuildProgressSnapshot,
  type ScreenerSnapshot,
  persistScreenerDateKey,
  persistScreenerLastSuccessKey,
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

const DEFAULT_AUTO_BOOTSTRAP_BATCH = 20;

const parseBooleanEnv = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseBatchSizeEnv = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(5, Math.min(120, Math.floor(parsed)));
};

const kstHourNow = (): number => {
  const hourText = nowIsoKst().slice(11, 13);
  const hour = Number(hourText);
  return Number.isFinite(hour) ? hour : 0;
};

const triggerAutoBootstrap = async (
  requestUrl: URL,
  adminToken: string,
  batchSize: number,
): Promise<void> => {
  try {
    const adminUrl = new URL(requestUrl.toString());
    adminUrl.pathname = "/api/admin/rebuild-screener";
    adminUrl.search = "";
    adminUrl.searchParams.set("batch", String(batchSize));

    const response = await fetch(adminUrl.toString(), {
      method: "POST",
      headers: {
        "x-admin-token": adminToken,
      },
    });
    const bodyText = await response.text();
    if (!response.ok && response.status !== 202) {
      console.log(
        `[screener-auto-bootstrap-fail] status=${response.status} body=${bodyText.slice(0, 200)}`,
      );
      return;
    }
    console.log(`[screener-auto-bootstrap] status=${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.log(`[screener-auto-bootstrap-error] ${message}`);
  }
};

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const USER_NOISY_WARNING_PATTERNS: RegExp[] = [
  /^현재 rebuild 진행 중:/,
  /^리빌드 초기화 중입니다\./,
  /^요청 시간 예산\(/,
  /^ExternalProvider 실패로 StaticProvider 유니버스를 사용했습니다\./,
  /^External\/Backup 소스 실패로 StaticProvider 유니버스를 사용했습니다\./,
  /^Primary 유니버스 소스 실패로 보조 소스/,
  /^Cache API miss로 영속 저장소\(KV\/D1\) 결과를 반환합니다\./,
];

const sanitizeUserWarnings = (warnings: string[], maxItems = 8): string[] =>
  dedupeWarnings(warnings)
    .filter((warning) => !USER_NOISY_WARNING_PATTERNS.some((pattern) => pattern.test(warning)))
    .slice(0, maxItems);

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

const safeArray = <T>(value: T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : [];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const url = new URL(context.request.url);
    const market = parseMarket(url.searchParams.get("market"));
    const strategy = parseStrategy(url.searchParams.get("strategy"));
    const count = parseCount(url.searchParams.get("count"));
    const autoBootstrapEnabled = parseBooleanEnv(
      context.env.SCREENER_AUTO_BOOTSTRAP,
      true,
    );
    const autoBootstrapBatch = parseBatchSizeEnv(
      context.env.SCREENER_AUTO_BOOTSTRAP_BATCH,
      DEFAULT_AUTO_BOOTSTRAP_BATCH,
    );

    const cache = await caches.open("kis-analyzer-cache-v3");
    const today = nowIsoKst().slice(0, 10);
    const backend = persistenceBackend(context.env);
    const todayKey = screenerDateKey(today);
    const lastSuccessKey = screenerLastSuccessKey();
    const progress = normalizeProgress(
      await getCachedJson<RebuildProgressSnapshot>(cache, rebuildProgressKey(today)),
    );

    let snapshot = await getCachedJson<ScreenerSnapshot>(cache, todayKey);
    let servedFromPersist = false;
    let rebuildRequired = false;
    let autoBootstrapTriggered = false;
    const warnings: string[] = [];

    if (snapshot) {
      metrics.apiCacheHits += 1;
      console.log(`[screener-cache-hit] date=${today}`);
    } else {
      metrics.apiCacheMisses += 1;
      rebuildRequired = true;
      console.log(`[screener-cache-miss] date=${today}`);
      const cachedLastSuccess = await getCachedJson<ScreenerSnapshot>(cache, lastSuccessKey);
      const persistedToday = await getPersistedJson<ScreenerSnapshot>(
        context.env,
        persistScreenerDateKey(today),
      );
      const persistedLastSuccess = await getPersistedJson<ScreenerSnapshot>(
        context.env,
        persistScreenerLastSuccessKey(),
      );
      snapshot = cachedLastSuccess ?? persistedToday ?? persistedLastSuccess;
      servedFromPersist = !cachedLastSuccess && !!snapshot;
      if (snapshot) {
        warnings.push(
          servedFromPersist
            ? "Cache API miss로 영속 저장소(KV/D1) 결과를 반환합니다."
            : "오늘 스크리너 캐시가 없어 마지막 성공 결과를 반환합니다. 재빌드가 필요합니다.",
        );
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
      if (backend === "none") {
        warnings.push("영속 저장소(KV/D1)가 비활성화되어 캐시 소실 시 결과 복원이 제한됩니다.");
      }

      const progressInProgress =
        !!progress && progress.universeCount > 0 && progress.cursor < progress.universeCount;
      const firstBootstrap = !snapshot;
      const dailyRefreshNeeded = !!snapshot && snapshot.date !== today;
      const afterDailyRefreshHour = kstHourNow() >= 6;
      const canTriggerByTime = firstBootstrap || (dailyRefreshNeeded && afterDailyRefreshHour);
      const canUseAutoBootstrap =
        autoBootstrapEnabled &&
        !!context.env.ADMIN_TOKEN &&
        url.protocol === "https:";

      if (rebuildRequired && !progressInProgress && canTriggerByTime && canUseAutoBootstrap) {
        autoBootstrapTriggered = true;
        warnings.push(
          `오늘 스크리너 스냅샷이 없어 자동 rebuild를 시작했습니다(batch=${autoBootstrapBatch}). 잠시 후 다시 조회해 주세요.`,
        );
        context.waitUntil(
          triggerAutoBootstrap(url, context.env.ADMIN_TOKEN as string, autoBootstrapBatch),
        );
      } else if (
        rebuildRequired &&
        !progressInProgress &&
        autoBootstrapEnabled &&
        !context.env.ADMIN_TOKEN
      ) {
        warnings.push("ADMIN_TOKEN이 없어 자동 rebuild를 시작할 수 없습니다.");
      } else if (
        rebuildRequired &&
        !progressInProgress &&
        autoBootstrapEnabled &&
        url.protocol !== "https:"
      ) {
        warnings.push("HTTP(local) 환경에서는 자동 rebuild가 비활성화됩니다.");
      } else if (
        rebuildRequired &&
        !progressInProgress &&
        autoBootstrapEnabled &&
        dailyRefreshNeeded &&
        !afterDailyRefreshHour
      ) {
        warnings.push("06:00 KST 이전이라 자동 daily rebuild를 대기 중입니다.");
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
          alertsMeta: null,
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
        warnings: sanitizeUserWarnings(warnings),
      };
      return finalize(
        json(emptyPayload, 200, {
          "x-cache": autoBootstrapTriggered ? "MISS-AUTO" : "MISS",
          "cache-control": "public, max-age=30",
        }),
      );
    }

    const filteredCount = snapshot.candidates.filter((candidate) =>
      market === "ALL" ? true : candidate.market === market,
    ).length;
    const view = buildScreenerView(
      snapshot.candidates,
      market,
      strategy,
      count,
      snapshot.validationSummary?.activeCutoffs ?? null,
    );

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
              basisTopN: snapshot.changeSummary.basisTopN ?? 30,
              added: safeArray(snapshot.changeSummary.added).map((item) => ({
                code: item.code,
                name: item.name,
                currRank: item.currRank,
                currScore: item.currScore,
              })),
              removed: safeArray(snapshot.changeSummary.removed).map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
                prevScore: item.prevScore,
              })),
              risers: safeArray(snapshot.changeSummary.risers).map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
                currRank: item.currRank,
                deltaRank: item.deltaRank,
              })),
              fallers: safeArray(snapshot.changeSummary.fallers).map((item) => ({
                code: item.code,
                name: item.name,
                prevRank: item.prevRank,
                currRank: item.currRank,
                deltaRank: item.deltaRank,
              })),
              scoreRisers: safeArray(snapshot.changeSummary.scoreRisers).map((item) => ({
                code: item.code,
                name: item.name,
                prevScore: item.prevScore,
                currScore: item.currScore,
                scoreDelta: item.scoreDelta,
              })),
              scoreFallers: safeArray(snapshot.changeSummary.scoreFallers).map((item) => ({
                code: item.code,
                name: item.name,
                prevScore: item.prevScore,
                currScore: item.currScore,
                scoreDelta: item.scoreDelta,
              })),
            }
          : null,
        rsSummary: snapshot.rsSummary ?? null,
        tuningSummary: snapshot.tuningSummary ?? null,
        validationSummary: snapshot.validationSummary
          ? {
              updatedAt: snapshot.validationSummary.updatedAt,
              lastWeeklyAt: snapshot.validationSummary.lastWeeklyAt,
              lastMonthlyAt: snapshot.validationSummary.lastMonthlyAt,
              activeCutoffs: snapshot.validationSummary.activeCutoffs,
              latestRuns: {
                weekly: snapshot.validationSummary.latestRuns.weekly
                  ? {
                      period: "weekly",
                      generatedAt: snapshot.validationSummary.latestRuns.weekly.generatedAt,
                      sampleCount: snapshot.validationSummary.latestRuns.weekly.sampleCount,
                    }
                  : null,
                monthly: snapshot.validationSummary.latestRuns.monthly
                  ? {
                      period: "monthly",
                      generatedAt: snapshot.validationSummary.latestRuns.monthly.generatedAt,
                      sampleCount: snapshot.validationSummary.latestRuns.monthly.sampleCount,
                    }
                  : null,
              },
            }
          : null,
        alertsMeta: snapshot.alertsMeta ?? null,
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
      warnings: sanitizeUserWarnings([
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
        "x-cache": servedFromPersist
          ? "PERSIST"
          : autoBootstrapTriggered
            ? "STALE-AUTO"
          : snapshot.date === today
            ? "HIT"
            : "STALE",
        "cache-control": "public, max-age=30",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "screener endpoint error";
    return finalize(serverError(message, context.request));
  }
};
