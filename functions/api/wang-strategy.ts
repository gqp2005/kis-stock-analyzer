import { getCachedJson, putCachedJson } from "../lib/cache";
import {
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics, type RequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import { analyzeTimeframe } from "../lib/scoring";
import { resolveStock } from "../lib/stockResolver";
import type { Candle, Env, Timeframe, TimeframeAnalysis } from "../lib/types";
import { normalizeInput } from "../lib/utils";
import { buildWangStrategyPayload } from "../lib/wangStrategy";
import type { WangStrategyPayload } from "../lib/wangTypes";

const MIN_MULTI = {
  month: 60,
  week: 160,
  day: 120,
} as const;

const TARGET_MULTI = {
  month: 80,
  week: 200,
} as const;

const DEFAULT_COUNT = 240;
const LARGE_FETCH_COUNT = 1400;
const REDUCED_FETCH_COUNT = 320;

const parseCount = (url: URL): number => {
  const raw = Number(url.searchParams.get("count") ?? DEFAULT_COUNT);
  if (!Number.isFinite(raw)) return DEFAULT_COUNT;
  return Math.max(120, Math.min(500, Math.floor(raw)));
};

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const ensureMinCandles = (
  tf: Timeframe,
  candles: Candle[] | null,
  min: number,
  warnings: string[],
): Candle[] | null => {
  const size = candles?.length ?? 0;
  if (size < min) {
    warnings.push(`${tf} candles insufficient (${size}/${min})`);
    return null;
  }
  return candles;
};

const sliceTimeframeAnalysis = (analysis: TimeframeAnalysis, count: number): TimeframeAnalysis => ({
  ...analysis,
  candles: analysis.candles.slice(-count),
  indicators: {
    ma: {
      ...analysis.indicators.ma,
      ma1: analysis.indicators.ma.ma1.slice(-count),
      ma2: analysis.indicators.ma.ma2.slice(-count),
      ma3: analysis.indicators.ma.ma3.slice(-count),
    },
    rsi14: analysis.indicators.rsi14.slice(-count),
    bb: {
      upper: analysis.indicators.bb.upper.slice(-count),
      mid: analysis.indicators.bb.mid.slice(-count),
      lower: analysis.indicators.bb.lower.slice(-count),
    },
    macd: {
      ...analysis.indicators.macd,
      line: analysis.indicators.macd.line.slice(-count),
      signal: analysis.indicators.macd.signal.slice(-count),
      hist: analysis.indicators.macd.hist.slice(-count),
    },
  },
});

const safeFetchTf = async (
  context: { env: Env; cache: Cache; symbol: string; metrics: RequestMetrics },
  tf: Timeframe,
  minCount: number,
  warnings: string[],
): Promise<{ name: string; candles: Candle[]; cacheTtlSec: number } | null> => {
  try {
    return await fetchTimeframeCandles(
      context.env,
      context.cache,
      context.symbol,
      tf,
      minCount,
      context.metrics,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    warnings.push(`${tf} fetch failed: ${message}`);
    return null;
  }
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
      return finalize(badRequest("query parameter is required", context.request));
    }

    const resolved = resolveStock(input);
    if (!resolved) {
      return finalize(badRequest(`symbol not found: ${input}`, context.request));
    }

    const count = parseCount(url);
    const cache = await caches.open("kis-analyzer-cache-v3");
    const ttlSec = timeframeCacheTtlSec("day");
    const cacheKey = `https://cache.local/wang-strategy/v3?code=${encodeURIComponent(
      resolved.code,
    )}&count=${count}`;

    const cached = await getCachedJson<WangStrategyPayload>(cache, cacheKey);
    if (cached) {
      metrics.apiCacheHits += 1;
      return finalize(
        json(cached, 200, {
          "x-cache": "HIT",
          "cache-control": `public, max-age=${ttlSec}`,
        }),
      );
    }
    metrics.apiCacheMisses += 1;

    const warnings: string[] = [];
    const fetchCtx = {
      env: context.env,
      cache,
      symbol: resolved.code,
      metrics,
    };

    let dayRaw = await safeFetchTf(fetchCtx, "day", Math.max(count, LARGE_FETCH_COUNT), warnings);
    if (!dayRaw) {
      warnings.push(`day large fetch fallback -> ${Math.max(count, REDUCED_FETCH_COUNT)} bars`);
      dayRaw = await safeFetchTf(fetchCtx, "day", Math.max(count, REDUCED_FETCH_COUNT), warnings);
    }

    if (!dayRaw) {
      return finalize(serverError("unable to load daily candles for wang-strategy", context.request));
    }

    let weekCandlesRaw = resampleDayToWeekCandles(dayRaw.candles);
    let monthCandlesRaw = resampleDayToMonthCandles(dayRaw.candles);

    if (weekCandlesRaw.length < MIN_MULTI.week) {
      const weekRaw = await safeFetchTf(fetchCtx, "week", TARGET_MULTI.week, warnings);
      if (weekRaw?.candles?.length) weekCandlesRaw = weekRaw.candles;
    }
    if (monthCandlesRaw.length < MIN_MULTI.month) {
      const monthRaw = await safeFetchTf(fetchCtx, "month", TARGET_MULTI.month, warnings);
      if (monthRaw?.candles?.length) monthCandlesRaw = monthRaw.candles;
    }

    const dayCandles = ensureMinCandles("day", dayRaw.candles, MIN_MULTI.day, warnings);
    const weekCandles = ensureMinCandles("week", weekCandlesRaw, MIN_MULTI.week, warnings);
    const monthCandles = ensureMinCandles("month", monthCandlesRaw, MIN_MULTI.month, warnings);

    if (!dayCandles) {
      return finalize(serverError("daily candles are insufficient for wang-strategy", context.request));
    }

    const dayAnalysisFull = analyzeTimeframe("day", dayCandles.slice(-Math.max(count, 260)));
    const dayAnalysis = sliceTimeframeAnalysis(dayAnalysisFull, count);
    const weekAnalysis = weekCandles ? analyzeTimeframe("week", weekCandles.slice(-200)) : null;
    const monthAnalysis = monthCandles ? analyzeTimeframe("month", monthCandles.slice(-120)) : null;

    const payload = buildWangStrategyPayload({
      input,
      symbol: resolved.code,
      name: dayRaw.name || resolved.name,
      market: resolved.market,
      asOf: nowIsoKst(),
      cacheTtlSec: ttlSec,
      dayAnalysis,
      weekAnalysis,
      monthAnalysis,
      warnings: dedupeWarnings(warnings),
    });

    await putCachedJson(cache, cacheKey, payload, ttlSec);
    return finalize(
      json(payload, 200, {
        "x-cache": "MISS",
        "cache-control": `public, max-age=${ttlSec}`,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "wang-strategy endpoint error";
    return finalize(serverError(message, context.request));
  }
};
