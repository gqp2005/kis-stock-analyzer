import { getTradeCandidates } from "../../lib/tradeMachine";
import { attachMetrics, createRequestMetrics } from "../../lib/observability";
import { badRequest, json, serverError } from "../../lib/response";
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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const url = new URL(context.request.url);
    const market = parseMarket(url.searchParams.get("market"));
    const universe = parseUniverse(url.searchParams.get("universe"));
    const cache = await caches.open("kis-analyzer-cache-v3");
    const payload = await getTradeCandidates(
      context.env,
      cache,
      {
        market,
        universe,
      },
      metrics,
    );
    return finalize(
      json(payload, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "trade candidates endpoint error";
    if (message.includes("BAD_REQUEST")) {
      return finalize(badRequest(message, context.request));
    }
    return finalize(serverError(message, context.request));
  }
};
