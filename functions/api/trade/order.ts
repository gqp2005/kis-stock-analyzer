import { attachMetrics, createRequestMetrics } from "../../lib/observability";
import { badRequest, errorJson, json, serverError } from "../../lib/response";
import { runTradeOrder } from "../../lib/tradeMachine";
import type { AutotradeMarketFilter, Env } from "../../lib/types";

const parseMarket = (raw: unknown): AutotradeMarketFilter => {
  if (typeof raw !== "string") return "ALL";
  const normalized = raw.trim().toUpperCase();
  if (normalized === "KOSPI" || normalized === "KOSDAQ") return normalized;
  return "ALL";
};

const parseUniverse = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 200;
};

const parseBoolean = (raw: unknown, fallback: boolean): boolean => {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const contentType = context.request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return finalize(badRequest("application/json 요청 본문이 필요합니다.", context.request));
    }
    const payload = (await context.request.json()) as Record<string, unknown>;
    const code = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!code) {
      return finalize(badRequest("주문 대상 종목코드(code)가 필요합니다.", context.request));
    }

    const market = parseMarket(payload.market);
    const universe = parseUniverse(payload.universe);
    const dryRun = parseBoolean(payload.dryRun, false);
    const autoExecute = parseBoolean(payload.autoExecute, false);
    const useHashKey = parseBoolean(payload.useHashKey, false);
    const retryOnce = parseBoolean(payload.retryOnce, false);
    const clientOrderId =
      typeof payload.clientOrderId === "string" && payload.clientOrderId.trim()
        ? payload.clientOrderId.trim()
        : null;
    const adminToken =
      (typeof payload.adminToken === "string" ? payload.adminToken : null) ??
      context.request.headers.get("x-admin-token");

    const cache = await caches.open("kis-analyzer-cache-v3");
    const result = await runTradeOrder(
      context.env,
      cache,
      {
        code,
        market,
        universe,
        dryRun,
        autoExecute,
        useHashKey,
        retryOnce,
        clientOrderId,
        adminToken,
      },
      metrics,
    );

    return finalize(
      json(result, result.ok ? 200 : 400, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "trade order endpoint error";
    if (message.includes("admin token")) {
      return finalize(errorJson(401, "UNAUTHORIZED", message, context.request));
    }
    if (message.includes("BAD_REQUEST")) {
      return finalize(badRequest(message, context.request));
    }
    return finalize(serverError(message, context.request));
  }
};
