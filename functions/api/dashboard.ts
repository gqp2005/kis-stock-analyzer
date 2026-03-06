import { buildDashboardOverview } from "../lib/dashboard";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { json, serverError } from "../lib/response";
import type { Env } from "../lib/types";

const parseFavorites = (raw: string | null): string[] =>
  (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
    .slice(0, 30);

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const url = new URL(context.request.url);
    const favoriteCodes = parseFavorites(url.searchParams.get("favorites"));
    const cache = await caches.open("kis-analyzer-cache-v3");
    const payload = await buildDashboardOverview(context.env, cache, favoriteCodes);
    return finalize(
      json(payload, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "dashboard endpoint error";
    return finalize(serverError(message, context.request));
  }
};
