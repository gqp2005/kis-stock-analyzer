import { getCachedJson, putCachedJson } from "../lib/cache";
import { fetchTimeframeCandles } from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { badRequest, json, serverError } from "../lib/response";
import { resolveStock } from "../lib/stockResolver";
import type { Env, OhlcvPayload, Timeframe } from "../lib/types";
import { normalizeInput } from "../lib/utils";

const parseTf = (raw: string | null): Timeframe => {
  const tf = (raw ?? "day").toLowerCase();
  if (tf === "month" || tf === "week" || tf === "day" || tf === "min15") return tf;
  return "day";
};

const visibleCount = (tf: Timeframe, days: number): number => {
  if (tf === "day") return days;
  if (tf === "week") return Math.max(60, Math.min(180, Math.floor(days / 3)));
  if (tf === "month") return Math.max(36, Math.min(120, Math.floor(days / 8)));
  return 120;
};

const minCount = (tf: Timeframe, days: number): number => {
  if (tf === "day") return Math.max(days, 200);
  if (tf === "week") return 140;
  if (tf === "month") return 100;
  return 180;
};

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
    const tf = parseTf(url.searchParams.get("tf"));

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

    const ttlSec = timeframeCacheTtlSec(tf);
    const cache = await caches.open("kis-analyzer-cache-v2");
    const cacheKey = `https://cache.local/ohlcv/v2?code=${encodeURIComponent(
      resolved.code,
    )}&tf=${tf}&days=${days}`;

    const cached = await getCachedJson<OhlcvPayload>(cache, cacheKey);
    if (cached) {
      return json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      });
    }

    const fetched = await fetchTimeframeCandles(context.env, cache, resolved.code, tf, minCount(tf, days));
    const candles = fetched.candles.slice(-visibleCount(tf, days));

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
        tf,
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

