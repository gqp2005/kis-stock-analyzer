import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import { searchStocks } from "../lib/search";

export const onRequestGet: PagesFunction = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const url = new URL(context.request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const limitRaw = Number(url.searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw))) : 8;

    if (!q) {
      return finalize(badRequest("q 파라미터를 넣어주세요.", context.request));
    }

    const items = searchStocks(q, limit);
    return finalize(
      json(
        {
          query: q,
          count: items.length,
          items,
        },
        200,
        {
          "cache-control": "public, max-age=30",
        },
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "search endpoint error";
    return finalize(serverError(message, context.request));
  }
};
