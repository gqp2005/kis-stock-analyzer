import { getCachedJson } from "../../../lib/cache";
import { nowIsoKst } from "../../../lib/market";
import { attachMetrics, createRequestMetrics } from "../../../lib/observability";
import { getPersistedJson, persistenceBackend } from "../../../lib/screenerPersistence";
import {
  loadRebuildRuntimeLock,
  loadRebuildRuntimeProgress,
  rebuildRuntimeBackend,
} from "../../../lib/rebuildRuntime";
import { errorJson, json, serverError } from "../../../lib/response";
import {
  REBUILD_LOCK_TTL_SEC,
  type ScreenerSnapshot,
  persistScreenerDateKey,
  persistScreenerLastSuccessKey,
  screenerDateKey,
  screenerLastSuccessKey,
} from "../../../lib/screenerStore";
import type { Env } from "../../../lib/types";

const LOCK_STALE_SEC = 5 * 60;

const buildUnauthorized = (request: Request): Response =>
  errorJson(401, "UNAUTHORIZED", "유효한 admin token이 필요합니다.", request);

const parseTimeMs = (iso: string | undefined): number => {
  if (!iso) return 0;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
};

const computeLockState = (startedAt: string | undefined): { stale: boolean; ageSec: number | null } => {
  const startedAtMs = parseTimeMs(startedAt);
  if (!startedAtMs) return { stale: true, ageSec: null };
  const ageSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  return { stale: ageSec > LOCK_STALE_SEC, ageSec };
};

const normalizeProgress = <T extends {
  failedItems?: unknown[];
  retryStats?: { totalRetries: number; retriedSymbols: number; maxRetryPerSymbol: number } | null;
  lastBatch?: { from: number; to: number; batchSize: number } | null;
} | null>(
  progress: T,
): T => {
  if (!progress) return null as T;
  return {
    ...progress,
    failedItems: Array.isArray(progress.failedItems) ? progress.failedItems : [],
    retryStats: progress.retryStats ?? {
      totalRetries: 0,
      retriedSymbols: 0,
      maxRetryPerSymbol: 0,
    },
    lastBatch: progress.lastBatch ?? null,
  } as T;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  const url = new URL(context.request.url);
  const token = context.request.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (!context.env.ADMIN_TOKEN || token !== context.env.ADMIN_TOKEN) {
    return finalize(buildUnauthorized(context.request));
  }

  try {
    const cache = await caches.open("kis-analyzer-cache-v3");
    const date = nowIsoKst().slice(0, 10);
    const backend = persistenceBackend(context.env);
    const runtimeBackend = rebuildRuntimeBackend(context.env);

    const lock = await loadRebuildRuntimeLock(context.env, cache);
    const lockState = computeLockState(lock?.startedAt);
    const progress = normalizeProgress(
      await loadRebuildRuntimeProgress(context.env, cache, date),
    );
    const todaySnapshot = await getCachedJson<ScreenerSnapshot>(cache, screenerDateKey(date));
    const cacheLastSuccess = await getCachedJson<ScreenerSnapshot>(cache, screenerLastSuccessKey());
    const persistedToday = await getPersistedJson<ScreenerSnapshot>(
      context.env,
      persistScreenerDateKey(date),
    );
    const persistedLastSuccess = await getPersistedJson<ScreenerSnapshot>(
      context.env,
      persistScreenerLastSuccessKey(),
    );
    const lastSuccessSnapshot = todaySnapshot ?? cacheLastSuccess ?? persistedToday ?? persistedLastSuccess;
    const snapshotSource = todaySnapshot || cacheLastSuccess
      ? "cache"
      : persistedToday || persistedLastSuccess
        ? backend
        : "none";
    const hasMore = !!progress && progress.cursor < progress.universeCount;
    const inProgress = !!lock && !lockState.stale;

    return finalize(
      json({
        ok: true,
        inProgress,
        hasMore,
        date,
        storage: {
          backend,
          runtimeBackend,
          enabled: backend !== "none",
          snapshotSource,
        },
        lock: {
          exists: !!lock,
          startedAt: lock?.startedAt ?? null,
          ageSec: lockState.ageSec,
          stale: lockState.stale,
          staleAfterSec: LOCK_STALE_SEC,
          ttlSec: REBUILD_LOCK_TTL_SEC,
        },
        progress: progress
          ? {
              processed: progress.cursor,
              total: progress.universeCount,
              remaining: Math.max(0, progress.universeCount - progress.cursor),
              processedCount: progress.processedCount,
              ohlcvFailures: progress.ohlcvFailures,
              insufficientData: progress.insufficientData,
              failedCount: progress.failedItems.length,
              failedItems: progress.failedItems.slice(-20),
              retryStats: progress.retryStats,
              lastBatch: progress.lastBatch,
              startedAt: progress.startedAt,
              updatedAt: progress.updatedAt,
            }
          : null,
        snapshot: lastSuccessSnapshot
          ? {
              date: lastSuccessSnapshot.date,
              updatedAt: lastSuccessSnapshot.updatedAt,
              universeCount: lastSuccessSnapshot.universeCount,
              processedCount: lastSuccessSnapshot.processedCount,
              candidateCount: lastSuccessSnapshot.candidates.length,
              topStored: lastSuccessSnapshot.topCandidates.length,
              warnings: lastSuccessSnapshot.warnings.slice(0, 10),
              changeSummary: lastSuccessSnapshot.changeSummary ?? null,
              rsSummary: lastSuccessSnapshot.rsSummary ?? null,
              tuningSummary: lastSuccessSnapshot.tuningSummary ?? null,
              validationSummary: lastSuccessSnapshot.validationSummary ?? null,
              rebuildMeta: lastSuccessSnapshot.rebuildMeta ?? null,
            }
          : null,
        message: inProgress
          ? "rebuild 진행 중입니다."
          : hasMore
            ? "현재 단계가 완료되었습니다. 다음 호출에서 이어서 처리할 수 있습니다."
            : "현재 진행 중인 rebuild가 없습니다.",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "rebuild-screener status error";
    return finalize(serverError(message, context.request));
  }
};
