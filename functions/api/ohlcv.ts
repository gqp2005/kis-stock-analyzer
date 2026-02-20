import { getCachedJson, putCachedJson } from "../lib/cache";
import { fetchDailyCandles } from "../lib/kis";
import { analysisTtlSec, nowIsoKst } from "../lib/market";
import { badRequest, json, serverError } from "../lib/response";
import { resolveStock } from "../lib/stockResolver";
import type { Env, OhlcvPayload } from "../lib/types";
import { normalizeInput } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const input =
      normalizeInput(
        url.searchParams.get("query") ??
          url.searchParams.get("symbol") ??
          url.searchParams.get("code") ??
          "",
      ) || "";

    if (!input) {
      return badRequest("query(또는 symbol/code) 파라미터를 넣어주세요.");
    }

    const daysParam = Number(url.searchParams.get("days") ?? "180");
    const days = Number.isFinite(daysParam)
      ? Math.max(60, Math.min(300, Math.floor(daysParam)))
      : 180;

    const resolved = resolveStock(input);
    if (!resolved) {
      return badRequest(`종목명을 찾지 못했습니다: ${input}`);
    }

    const ttlSec = analysisTtlSec();
    const cache = await caches.open("kis-analyzer-cache-v1");
    const cacheKey = `https://cache.local/ohlcv/v1?code=${encodeURIComponent(
      resolved.code,
    )}&days=${days}`;

    const cached = await getCachedJson<OhlcvPayload>(cache, cacheKey);
    if (cached) {
      return json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      });
    }

    const fetched = await fetchDailyCandles(context.env, cache, resolved.code, days);
    const candles = fetched.candles.slice(-days);

    const payload: OhlcvPayload = {
      meta: {
        input,
        symbol: resolved.code,
        name: fetched.name || resolved.name,
        market: resolved.market,
        asOf: nowIsoKst(),
        source: "KIS",
        cacheTtlSec: ttlSec,
        candleCount: candles.length,
      },
      candles,
    };

    await putCachedJson(cache, cacheKey, payload, ttlSec);
    return json(payload, 200, {
      "x-cache": "MISS",
      "cache-control": `public, max-age=${ttlSec}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ohlcv endpoint error";
    return serverError(message);
  }
};
