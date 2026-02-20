import { getCachedJson, putCachedJson } from "../lib/cache";
import { runDayBacktest } from "../lib/backtest";
import { fetchTimeframeCandles } from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import { resolveStock } from "../lib/stockResolver";
import type { BacktestPayload, Env, Overall } from "../lib/types";
import { normalizeInput } from "../lib/utils";

const LOOKBACK_BARS = 160;
const MAX_PERIOD_BARS = 252;

const parseCount = (url: URL): number => {
  const raw = Number(url.searchParams.get("count") ?? url.searchParams.get("days") ?? "520");
  if (!Number.isFinite(raw)) return 520;
  return Math.max(260, Math.min(900, Math.floor(raw)));
};

const parseHoldBars = (url: URL): number => {
  const raw = Number(url.searchParams.get("holdBars") ?? "10");
  if (!Number.isFinite(raw)) return 10;
  return Math.max(3, Math.min(30, Math.floor(raw)));
};

const parseSignalOverall = (url: URL): Overall => {
  const raw = (url.searchParams.get("signal") ?? "GOOD").toUpperCase();
  if (raw === "GOOD" || raw === "NEUTRAL" || raw === "CAUTION") return raw;
  return "GOOD";
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

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
      return finalize(badRequest("query(또는 symbol/code) 파라미터를 넣어주세요.", context.request));
    }

    const resolved = resolveStock(input);
    if (!resolved) {
      return finalize(badRequest(`종목명을 찾지 못했습니다: ${input}`, context.request));
    }

    const holdBars = parseHoldBars(url);
    const signalOverall = parseSignalOverall(url);
    const requestedCount = parseCount(url);
    const minNeededCount = LOOKBACK_BARS + MAX_PERIOD_BARS + holdBars + 5;
    const fetchCount = Math.max(requestedCount, minNeededCount);

    const ttlSec = timeframeCacheTtlSec("day");
    const cache = await caches.open("kis-analyzer-cache-v3");
    const cacheKey = `https://cache.local/backtest/v1?code=${encodeURIComponent(
      resolved.code,
    )}&count=${fetchCount}&hold=${holdBars}&signal=${signalOverall}`;

    const cached = await getCachedJson<BacktestPayload>(cache, cacheKey);
    if (cached) {
      metrics.apiCacheHits += 1;
      console.log(`[backtest-cache-hit] symbol=${resolved.code}`);
      return finalize(json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      }));
    }
    metrics.apiCacheMisses += 1;
    console.log(`[backtest-cache-miss] symbol=${resolved.code}`);

    const fetched = await fetchTimeframeCandles(
      context.env,
      cache,
      resolved.code,
      "day",
      fetchCount,
      metrics,
    );

    const candles = fetched.candles.slice(-fetchCount);
    if (candles.length === 0) {
      return finalize(badRequest("백테스트용 일봉 데이터가 없습니다.", context.request));
    }

    const backtest = runDayBacktest(candles, {
      holdBars,
      lookbackBars: LOOKBACK_BARS,
      signalOverall,
    });

    const payload: BacktestPayload = {
      meta: {
        input,
        symbol: resolved.code,
        name: fetched.name || resolved.name,
        market: resolved.market,
        asOf: nowIsoKst(),
        source: "KIS",
        cacheTtlSec: ttlSec,
        candleCount: candles.length,
        holdBars,
        signalOverall,
      },
      summary: backtest.summary,
      periods: backtest.periods,
      trades: backtest.trades,
      warnings: [
        ...backtest.warnings,
        `candles.length=${candles.length}`,
      ],
    };

    await putCachedJson(cache, cacheKey, payload, ttlSec);
    return finalize(json(payload, 200, {
      "x-cache": "MISS",
      "cache-control": `public, max-age=${ttlSec}`,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "backtest endpoint error";
    return finalize(serverError(message, context.request));
  }
};
