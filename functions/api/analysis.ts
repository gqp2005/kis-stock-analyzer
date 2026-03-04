import { getCachedJson, putCachedJson } from "../lib/cache";
import {
  fetchMarketSnapshot,
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics, type RequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import {
  analyzeTimeframe,
  computeMultiFinal,
} from "../lib/scoring";
import { resolveStock } from "../lib/stockResolver";
import type {
  AnalysisPayload,
  Candle,
  Env,
  FlowSignal,
  FundamentalSignal,
  InvestmentProfile,
  MultiAnalysisPayload,
  Timeframe,
  TimeframeAnalysis,
} from "../lib/types";
import { normalizeInput } from "../lib/utils";

const VALID_TFS: Timeframe[] = ["day", "week", "month"];
type TfParam = Timeframe | "multi";
type ViewParam = "default" | "multi";

const MIN_MULTI = {
  month: 60,
  week: 160,
  day: 40,
} as const;

const TARGET_MULTI = {
  month: 80,
  week: 200,
} as const;

const parseTf = (raw: string | null): TfParam => {
  if (!raw) return "day";
  const tf = raw.toLowerCase();
  if (tf === "multi") return "multi";
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
  return 80;
};

const parseView = (raw: string | null): ViewParam => {
  if ((raw ?? "").toLowerCase() === "multi") return "multi";
  return "default";
};

const parseProfile = (raw: string | null): InvestmentProfile => {
  const value = (raw ?? "short").toLowerCase();
  if (value === "mid") return "mid";
  return "short";
};

const singleTfCount = (tf: Timeframe, dayCount: number): number => {
  if (tf === "day") return Math.max(dayCount, 260);
  if (tf === "week") return 200;
  return 80;
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

const withSnapshotSignals = (
  analysis: TimeframeAnalysis,
  snapshot: { fundamental: FundamentalSignal; flow: FlowSignal } | null,
): TimeframeAnalysis => {
  if (!snapshot) return analysis;
  return {
    ...analysis,
    signals: {
      ...analysis.signals,
      fundamental: snapshot.fundamental,
      flow: snapshot.flow,
    },
  };
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
    macd: {
      ...analysis.indicators.macd,
      line: analysis.indicators.macd.line.slice(-count),
      signal: analysis.indicators.macd.signal.slice(-count),
      hist: analysis.indicators.macd.hist.slice(-count),
    },
  },
  overlays: {
    ...analysis.overlays,
    markers: analysis.overlays.markers.filter((marker) =>
      analysis.candles
        .slice(-count)
        .some((candle) => candle.time === marker.t || marker.t.startsWith(`${candle.time}T`)),
    ),
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
    const viewParam = parseView(url.searchParams.get("view"));
    const dayCount = parseDayCount(url);
    const profile = parseProfile(url.searchParams.get("profile"));
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
    const cacheKey = `https://cache.local/analysis/v7?code=${encodeURIComponent(
      resolved.code,
    )}&tf=${tfParam}&count=${dayCount}&profile=${profile}&src=${useResampledHigherTf ? "resample" : "kis"}&view=${viewParam}`;

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
      let snapshot: { fundamental: FundamentalSignal; flow: FlowSignal } | null = null;
      try {
        snapshot = (await fetchMarketSnapshot(context.env, cache, resolved.code, metrics)).snapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        warnings.push(`펀더멘털/수급 조회 실패: ${message}`);
      }

      const dayFetchCount = useResampledHigherTf ? Math.max(dayCount, 1400) : Math.max(dayCount, 260);
      const dayRaw = await safeFetchTf(fetchCtx, "day", dayFetchCount, warnings);

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

      const dayAnalysis = dayCandles
        ? withSnapshotSignals(
            analyzeTimeframe("day", dayCandles.slice(-Math.max(dayCount, 260)), profile),
            snapshot,
          )
        : null;
      const weekAnalysis = weekCandles
        ? withSnapshotSignals(analyzeTimeframe("week", weekCandles.slice(-200), profile), snapshot)
        : null;
      const monthAnalysis = monthCandles
        ? withSnapshotSignals(analyzeTimeframe("month", monthCandles.slice(-120), profile), snapshot)
        : null;

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
      };
      warnings.push(
        `timeframes.candles.length month=${timeframes.month?.candles.length ?? 0}, week=${timeframes.week?.candles.length ?? 0}, day=${timeframes.day?.candles.length ?? 0}`,
      );

      const final = computeMultiFinal(
        timeframes.month,
        timeframes.week,
        timeframes.day,
        profile,
      );
      const payload: MultiAnalysisPayload = {
        meta: {
          input,
          symbol: resolved.code,
          name:
            dayRaw?.name ??
            weekName ??
            monthName ??
            resolved.name,
          market: resolved.market,
          asOf: nowIsoKst(),
          source: "KIS",
          cacheTtlSec: ttlSec,
          profile,
        },
        final: {
          overall: final.overall,
          confidence: final.confidence,
          summary: final.summary,
          profile: final.profile,
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
    if (candlesForAnalysis.length < 70) {
      return finalize(badRequest(`${tf} 분석에 필요한 데이터가 부족합니다.`, context.request));
    }

    let snapshot: { fundamental: FundamentalSignal; flow: FlowSignal } | null = null;
    try {
      snapshot = (await fetchMarketSnapshot(context.env, cache, resolved.code, metrics)).snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[snapshot-fallback] symbol=${resolved.code} ${message}`);
    }

    const analysis = withSnapshotSignals(analyzeTimeframe(tf, candlesForAnalysis, profile), snapshot);
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
        profile,
      },
      scores: analysisForChart.scores,
      profile: analysisForChart.profile,
      signals: analysisForChart.signals,
      reasons: analysisForChart.reasons.slice(0, 6),
      levels: analysisForChart.levels,
      tradePlan: analysisForChart.tradePlan,
      indicators: analysisForChart.indicators,
      strategyCards: analysisForChart.strategyCards,
      strategyOverlays: analysisForChart.strategyOverlays,
      overlays: analysisForChart.overlays,
      confluence: analysisForChart.confluence,
      explanations: analysisForChart.explanations,
      candles: analysisForChart.candles,
      regime: analysisForChart.regime,
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
