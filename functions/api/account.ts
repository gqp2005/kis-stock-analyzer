import { fetchAccountSnapshot } from "../lib/accountSnapshot";
import { recordAccountAssetHistory } from "../lib/accountHistory";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import type { Env } from "../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const snapshot = await fetchAccountSnapshot(context.env, metrics);
    const history = await recordAccountAssetHistory(context.env, snapshot).catch((error) => ({
      storage: {
        enabled: false,
        backend: "none" as const,
      },
      day: {
        period: "day" as const,
        points: [],
        latestChangeAmount: null,
        latestChangeRate: null,
        totalChangeAmount: null,
        totalChangeRate: null,
        averageChangeAmount: null,
      },
      week: {
        period: "week" as const,
        points: [],
        latestChangeAmount: null,
        latestChangeRate: null,
        totalChangeAmount: null,
        totalChangeRate: null,
        averageChangeAmount: null,
      },
      month: {
        period: "month" as const,
        points: [],
        latestChangeAmount: null,
        latestChangeRate: null,
        totalChangeAmount: null,
        totalChangeRate: null,
        averageChangeAmount: null,
      },
      warnings: [
        error instanceof Error
          ? `계좌 자산 히스토리 저장 실패: ${error.message}`
          : "계좌 자산 히스토리 저장 실패",
      ],
    }));
    const payload = {
      ...snapshot,
      history,
      warnings: [...snapshot.warnings, ...history.warnings],
    };
    return finalize(
      json(payload, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "account endpoint error";
    if (message.includes("KIS_ACCOUNT_NO")) {
      return finalize(badRequest(message, context.request));
    }
    return finalize(serverError(message, context.request));
  }
};
