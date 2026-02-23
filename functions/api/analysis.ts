import { getCachedJson, putCachedJson } from "../lib/cache";
import {
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../lib/kis";
import { isKrxRegularSession, nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics, type RequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import {
  analyzeTimeframe,
  buildDisabledMin5Analysis,
  computeMultiFinal,
} from "../lib/scoring";
import { resolveStock } from "../lib/stockResolver";
import type {
  AnalysisPayload,
  Candle,
  Env,
  MultiAnalysisPayload,
  Timeframe,
  TimeframeAnalysis,
} from "../lib/types";
import { normalizeInput } from "../lib/utils";

const VALID_TFS: Timeframe[] = ["day", "week", "month", "min5"];
type TfParam = Timeframe | "multi";

const MIN_MULTI = {
  month: 60,
  week: 160,
  day: 40,
  min5: 40,
} as const;

const TARGET_MULTI = {
  month: 80,
  week: 200,
  min5: 180,
} as const;

const parseTf = (raw: string | null): TfParam => {
  if (!raw) return "day";
  const tf = raw.toLowerCase();
  if (tf === "multi") return "multi";
  if (tf === "min15") return "min5"; // backward compatibility
  if ((VALID_TFS as string[]).includes(tf)) return tf as Timeframe;
  return "day";
};

const parseDayCount = (url: URL): number => {
  const raw = Number(url.searchParams.get("count") ?? url.searchParams.get("days") ?? "180");
  if (!Number.isFinite(raw)) return 180;
  return Math.max(60, Math.min(500, Math.floor(raw)));
};

const visibleCount = (tf: Timeframe, dayCount: number): number => {
  if (tf === "day") return dayCount;
  if (tf === "week") return 160;
  if (tf === "month") return 80;
  return 120;
};

const singleTfCount = (tf: Timeframe, dayCount: number): number => {
  if (tf === "day") return Math.max(dayCount, 200);
  if (tf === "week") return 200;
  if (tf === "month") return 80;
  return 180;
};

const analysisTtlByTf = (tf: TfParam): number => {
  if (tf === "multi") return timeframeCacheTtlSec("day");
  return timeframeCacheTtlSec(tf);
};

const ensureMinCandles = (
  tf: "month" | "week" | "day",
  candles: Candle[] | null,
  min: number,
  warnings: string[],
): Candle[] | null => {
  const length = candles?.length ?? 0;
  if (length < min) {
    warnings.push(`${tf} 데이터 부족 (${length}/${min})`);
    return null;
  }
  return candles;
};

const dedupeWarnings = (warnings: string[]): string[] => [...new Set(warnings)];

const isMin5SoftFail = (message: string): boolean => {
  const lower = message.toLowerCase();
  return (
    lower.includes("egw00201") ||
    lower.includes("초당 거래건수") ||
    lower.includes("당일 분봉 데이터를 받지 못했습니다")
  );
};

const sliceAnalysis = (analysis: TimeframeAnalysis, count: number): TimeframeAnalysis => ({
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
    warnings.push(`${tf} 조회 실패: ${message}`);
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
    const tfParam = parseTf(url.searchParams.get("tf"));
    const dayCount = parseDayCount(url);
    const higherTfSource = (url.searchParams.get("higher_tf_source") ?? "resample").toLowerCase();
    const useResampledHigherTf = higherTfSource !== "kis";

    if (!input) {
      return finalize(badRequest("query(또는 symbol/code) 파라미터를 넣어주세요.", context.request));
    }

    const resolved = resolveStock(input);
    if (!resolved) {
      return finalize(badRequest(`종목명을 찾지 못했습니다: ${input}`, context.request));
    }

    const ttlSec = analysisTtlByTf(tfParam);
    const cache = await caches.open("kis-analyzer-cache-v3");
    const cacheKey = `https://cache.local/analysis/v5?code=${encodeURIComponent(
      resolved.code,
    )}&tf=${tfParam}&count=${dayCount}&src=${useResampledHigherTf ? "resample" : "kis"}`;

    if (tfParam === "multi") {
      const cached = await getCachedJson<MultiAnalysisPayload>(cache, cacheKey);
      if (cached) {
        metrics.apiCacheHits += 1;
        console.log(`[analysis-cache-hit] tf=multi symbol=${resolved.code}`);
        return finalize(json(cached, 200, {
          "x-cache": "HIT",
          "cache-control": `public, max-age=${ttlSec}`,
        }));
      }
      metrics.apiCacheMisses += 1;
      console.log(`[analysis-cache-miss] tf=multi symbol=${resolved.code}`);

      const warnings: string[] = [];
      const fetchCtx = { env: context.env, cache, symbol: resolved.code, metrics };

      const dayFetchCount = useResampledHigherTf ? Math.max(dayCount, 1400) : Math.max(dayCount, 260);
      const dayRaw = await safeFetchTf(fetchCtx, "day", dayFetchCount, warnings);
      let min5Raw: { name: string; candles: Candle[]; cacheTtlSec: number } | null = null;
      let min5DisabledReason: string | null = null;

      if (!isKrxRegularSession()) {
        min5DisabledReason = "5분봉은 장중 데이터 기반이라 현재 시간에는 비활성입니다.";
      } else {
        try {
          min5Raw = await fetchTimeframeCandles(
            fetchCtx.env,
            fetchCtx.cache,
            fetchCtx.symbol,
            "min5",
            TARGET_MULTI.min5,
            fetchCtx.metrics,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (isMin5SoftFail(message)) {
            min5DisabledReason = "5분봉은 API 제약/당일 데이터 부족으로 비활성입니다.";
          } else {
            warnings.push(`min5 조회 실패: ${message}`);
          }
        }
      }

      let weekCandlesRaw: Candle[] | null = null;
      let monthCandlesRaw: Candle[] | null = null;
      let weekName = resolved.name;
      let monthName = resolved.name;

      if (useResampledHigherTf) {
        if (dayRaw && dayRaw.candles.length > 0) {
          weekCandlesRaw = resampleDayToWeekCandles(dayRaw.candles);
          monthCandlesRaw = resampleDayToMonthCandles(dayRaw.candles);
          weekName = dayRaw.name;
          monthName = dayRaw.name;
        } else {
          warnings.push("week/month 리샘플링 실패: day 데이터가 없습니다.");
        }
      } else {
        const [weekRaw, monthRaw] = await Promise.all([
          safeFetchTf(fetchCtx, "week", TARGET_MULTI.week, warnings),
          safeFetchTf(fetchCtx, "month", TARGET_MULTI.month, warnings),
        ]);
        weekCandlesRaw = weekRaw?.candles ?? null;
        monthCandlesRaw = monthRaw?.candles ?? null;
        weekName = weekRaw?.name ?? weekName;
        monthName = monthRaw?.name ?? monthName;
      }

      const dayCandles = ensureMinCandles("day", dayRaw?.candles ?? null, MIN_MULTI.day, warnings);
      const weekCandles = ensureMinCandles("week", weekCandlesRaw, MIN_MULTI.week, warnings);
      const monthCandles = ensureMinCandles("month", monthCandlesRaw, MIN_MULTI.month, warnings);

      const dayAnalysis = dayCandles ? analyzeTimeframe("day", dayCandles.slice(-Math.max(dayCount, 160))) : null;
      const weekAnalysis = weekCandles ? analyzeTimeframe("week", weekCandles.slice(-200)) : null;
      const monthAnalysis = monthCandles ? analyzeTimeframe("month", monthCandles.slice(-120)) : null;

      let min5Analysis: TimeframeAnalysis | null = null;
      if (min5DisabledReason) {
        warnings.push(min5DisabledReason);
        min5Analysis = buildDisabledMin5Analysis([]);
      } else if (!min5Raw || min5Raw.candles.length === 0) {
        warnings.push("5분봉은 장중/당일 데이터가 없어서 비활성");
        min5Analysis = buildDisabledMin5Analysis([]);
      } else if (min5Raw.candles.length < MIN_MULTI.min5) {
        warnings.push(`5분봉 데이터 부족 (${min5Raw.candles.length}/${MIN_MULTI.min5})`);
        min5Analysis = buildDisabledMin5Analysis(min5Raw.candles);
      } else {
        min5Analysis = analyzeTimeframe("min5", min5Raw.candles.slice(-180));
      }

      const timeframes: MultiAnalysisPayload["timeframes"] = {
        month: monthAnalysis
          ? sliceAnalysis(monthAnalysis, visibleCount("month", dayCount))
          : null,
        week: weekAnalysis
          ? sliceAnalysis(weekAnalysis, visibleCount("week", dayCount))
          : null,
        day: dayAnalysis
          ? sliceAnalysis(dayAnalysis, visibleCount("day", dayCount))
          : null,
        min5: min5Analysis
          ? sliceAnalysis(min5Analysis, visibleCount("min5", dayCount))
          : null,
      };
      warnings.push(
        `timeframes.candles.length month=${timeframes.month?.candles.length ?? 0}, week=${timeframes.week?.candles.length ?? 0}, day=${timeframes.day?.candles.length ?? 0}, min5=${timeframes.min5?.candles.length ?? 0}`,
      );

      const final = computeMultiFinal(
        timeframes.month,
        timeframes.week,
        timeframes.day,
        timeframes.min5,
      );
      const payload: MultiAnalysisPayload = {
        meta: {
          input,
          symbol: resolved.code,
          name:
            dayRaw?.name ??
            weekName ??
            monthName ??
            min5Raw?.name ??
            resolved.name,
          market: resolved.market,
          asOf: nowIsoKst(),
          source: "KIS",
          cacheTtlSec: ttlSec,
        },
        final: {
          overall: final.overall,
          confidence: final.confidence,
          summary: final.summary,
        },
        timeframes,
        warnings: dedupeWarnings([...warnings, ...final.warnings]),
      };

      await putCachedJson(cache, cacheKey, payload, ttlSec);
      return finalize(json(payload, 200, {
        "x-cache": "MISS",
        "cache-control": `public, max-age=${ttlSec}`,
      }));
    }

    const tf = tfParam;
    const cached = await getCachedJson<AnalysisPayload>(cache, cacheKey);
    if (cached) {
      metrics.apiCacheHits += 1;
      console.log(`[analysis-cache-hit] tf=${tf} symbol=${resolved.code}`);
      return finalize(json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      }));
    }
    metrics.apiCacheMisses += 1;

    const minCount = singleTfCount(tf, dayCount);
    const fetched = await fetchTimeframeCandles(
      context.env,
      cache,
      resolved.code,
      tf,
      minCount,
      metrics,
    );
    const candlesForAnalysis = fetched.candles.slice(-Math.max(minCount, 140));
    if (candlesForAnalysis.length < (tf === "min5" ? 40 : 70)) {
      return finalize(badRequest(`${tf} 분석에 필요한 데이터가 부족합니다.`, context.request));
    }

    const analysis = analyzeTimeframe(tf, candlesForAnalysis);
    const chartCount = visibleCount(tf, dayCount);
    const analysisForChart = sliceAnalysis(analysis, chartCount);
    const payload: AnalysisPayload = {
      meta: {
        input,
        symbol: resolved.code,
        name: fetched.name || resolved.name,
        market: resolved.market,
        asOf: nowIsoKst(),
        source: "KIS",
        cacheTtlSec: ttlSec,
        candleCount: analysisForChart.candles.length,
        summaryText: analysisForChart.summaryText,
        tf,
      },
      scores: analysisForChart.scores,
      signals: analysisForChart.signals,
      reasons: analysisForChart.reasons.slice(0, 6),
      levels: analysisForChart.levels,
      tradePlan: analysisForChart.tradePlan,
      indicators: analysisForChart.indicators,
      candles: analysisForChart.candles,
      regime: analysisForChart.regime,
      timing: analysisForChart.timing ?? null,
    };

    await putCachedJson(cache, cacheKey, payload, ttlSec);
    return finalize(json(payload, 200, {
      "x-cache": "MISS",
      "cache-control": `public, max-age=${ttlSec}`,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "analysis endpoint error";
    return finalize(serverError(message, context.request));
  }
};
