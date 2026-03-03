import { attachMetrics, createRequestMetrics } from "../../../lib/observability";
import {
  getPersistedJson,
  listPersistedByPrefix,
  persistenceBackend,
} from "../../../lib/screenerPersistence";
import { errorJson, json, serverError } from "../../../lib/response";
import {
  type AlertStateSnapshot,
  persistAlertStateKey,
  persistChangeHistoryPrefix,
  persistFailureHistoryPrefix,
} from "../../../lib/screenerStore";
import type { Env } from "../../../lib/types";

const buildUnauthorized = (request: Request): Response =>
  errorJson(401, "UNAUTHORIZED", "유효한 admin token이 필요합니다.", request);

const parseLimit = (raw: string | null): number => {
  const parsed = Number(raw ?? "7");
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(1, Math.min(30, Math.floor(parsed)));
};

const dateFromPersistKey = (key: string): string => key.split(":").pop() ?? "";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  const url = new URL(context.request.url);
  const token = context.request.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (!context.env.ADMIN_TOKEN || token !== context.env.ADMIN_TOKEN) {
    return finalize(buildUnauthorized(context.request));
  }

  try {
    const backend = persistenceBackend(context.env);
    const limit = parseLimit(url.searchParams.get("limit"));
    if (backend === "none") {
      return finalize(
        json({
          ok: true,
          backend,
          limit,
          changes: [],
          failures: [],
          alerts: {
            updatedAt: null,
            count: 0,
          },
          message: "영속 저장소(KV/D1)가 비활성화되어 히스토리가 없습니다.",
        }),
      );
    }

    const [changes, failures, alertState] = await Promise.all([
      listPersistedByPrefix<{
        date?: string;
        updatedAt?: string;
        changeSummary?: unknown;
        alertsMeta?: unknown;
        validationSummary?: unknown;
      }>(
        context.env,
        persistChangeHistoryPrefix(),
        limit,
      ),
      listPersistedByPrefix<{ date?: string; updatedAt?: string; failedItems?: unknown[]; retryStats?: unknown }>(
        context.env,
        persistFailureHistoryPrefix(),
        limit,
      ),
      getPersistedJson<AlertStateSnapshot>(context.env, persistAlertStateKey()),
    ]);

    return finalize(
      json({
        ok: true,
        backend,
        limit,
        changes: changes.map((item) => ({
          date: item.value.date ?? dateFromPersistKey(item.key),
          updatedAt: item.value.updatedAt ?? null,
          changeSummary: item.value.changeSummary ?? null,
          alertsMeta: item.value.alertsMeta ?? null,
          validationSummary: item.value.validationSummary ?? null,
        })),
        failures: failures.map((item) => ({
          date: item.value.date ?? dateFromPersistKey(item.key),
          updatedAt: item.value.updatedAt ?? null,
          failedItems: item.value.failedItems ?? [],
          retryStats: item.value.retryStats ?? null,
        })),
        alerts: {
          updatedAt: alertState?.updatedAt ?? null,
          count: alertState ? Object.keys(alertState.sent ?? {}).length : 0,
        },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "rebuild history error";
    return finalize(serverError(message, context.request));
  }
};
