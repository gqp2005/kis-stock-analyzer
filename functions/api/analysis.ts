import { getCachedJson, putCachedJson } from "../lib/cache";
import { fetchTimeframeCandles } from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { badRequest, json, serverError } from "../lib/response";
import { analyzeTimeframe, computeMultiFinal } from "../lib/scoring";
import { resolveStock } from "../lib/stockResolver";
import type {
  AnalysisPayload,
  Env,
  MultiAnalysisPayload,
  Timeframe,
  TimeframeAnalysis,
} from "../lib/types";
import { normalizeInput } from "../lib/utils";

const VALID_TFS: Timeframe[] = ["day", "week", "month", "min15"];
type TfParam = Timeframe | "multi";

const parseTf = (raw: string | null): TfParam => {
  if (!raw) return "day";
  const tf = raw.toLowerCase();
  if (tf === "multi") return "multi";
  if ((VALID_TFS as string[]).includes(tf)) return tf as Timeframe;
  return "day";
};

const singleTfCount = (tf: Timeframe, days: number): number => {
  if (tf === "day") return Math.max(days, 200);
  if (tf === "week") return Math.max(140, Math.floor(days / 3));
  if (tf === "month") return Math.max(96, Math.floor(days / 8));
  return 180; // min15: 당일 데이터라 넉넉히 확보 후 리샘플링
};

const visibleCount = (tf: Timeframe, days: number): number => {
  if (tf === "day") return days;
  if (tf === "week") return Math.max(60, Math.min(180, Math.floor(days / 3)));
  if (tf === "month") return Math.max(36, Math.min(120, Math.floor(days / 8)));
  return 120; // min15 탭 표시는 최근 120개 15분봉
};

const analysisTtlByTf = (tf: TfParam): number => {
  if (tf === "multi") return timeframeCacheTtlSec("day");
  return timeframeCacheTtlSec(tf);
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
    const tfParam = parseTf(url.searchParams.get("tf"));

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

    const ttlSec = analysisTtlByTf(tfParam);
    const cache = await caches.open("kis-analyzer-cache-v2");
    const cacheKey = `https://cache.local/analysis/v3?code=${encodeURIComponent(
      resolved.code,
    )}&tf=${tfParam}&days=${days}`;

    if (tfParam === "multi") {
      const cached = await getCachedJson<MultiAnalysisPayload>(cache, cacheKey);
      if (cached) {
        console.log(`[analysis-cache-hit] tf=multi symbol=${resolved.code}`);
        return json(cached, 200, {
          "x-cache": "HIT",
          "cache-control": `public, max-age=${ttlSec}`,
        });
      }
      console.log(`[analysis-cache-miss] tf=multi symbol=${resolved.code}`);

      const [monthRaw, weekRaw, dayRaw, min15Raw] = await Promise.all([
        fetchTimeframeCandles(context.env, cache, resolved.code, "month", 100),
        fetchTimeframeCandles(context.env, cache, resolved.code, "week", 140),
        fetchTimeframeCandles(context.env, cache, resolved.code, "day", Math.max(days, 220)),
        fetchTimeframeCandles(context.env, cache, resolved.code, "min15", 180),
      ]);

      const monthCandles = monthRaw.candles.slice(-120);
      const weekCandles = weekRaw.candles.slice(-180);
      const dayCandles = dayRaw.candles.slice(-Math.max(days, 160));
      const min15Candles = min15Raw.candles.slice(-180);

      if (monthCandles.length < 30 || weekCandles.length < 70 || dayCandles.length < 130 || min15Candles.length < 40) {
        return badRequest("멀티 타임프레임 분석에 필요한 데이터가 부족합니다.");
      }

      const month = analyzeTimeframe("month", monthCandles);
      const week = analyzeTimeframe("week", weekCandles);
      const day = analyzeTimeframe("day", dayCandles);
      const min15 = analyzeTimeframe("min15", min15Candles);

      const timeframes: MultiAnalysisPayload["timeframes"] = {
        month: {
          ...month,
          candles: month.candles.slice(-visibleCount("month", days)),
        } as TimeframeAnalysis,
        week: {
          ...week,
          candles: week.candles.slice(-visibleCount("week", days)),
        } as TimeframeAnalysis,
        day: {
          ...day,
          candles: day.candles.slice(-visibleCount("day", days)),
        } as TimeframeAnalysis,
        min15: {
          ...min15,
          candles: min15.candles.slice(-visibleCount("min15", days)),
        } as TimeframeAnalysis,
      };

      const final = computeMultiFinal(timeframes.month, timeframes.week, timeframes.day, timeframes.min15);
      const payload: MultiAnalysisPayload = {
        meta: {
          input,
          symbol: resolved.code,
          name: dayRaw.name || resolved.name,
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
        warnings: final.warnings,
      };

      await putCachedJson(cache, cacheKey, payload, ttlSec);
      return json(payload, 200, {
        "x-cache": "MISS",
        "cache-control": `public, max-age=${ttlSec}`,
      });
    }

    const tf = tfParam;
    const cached = await getCachedJson<AnalysisPayload>(cache, cacheKey);
    if (cached) {
      console.log(`[analysis-cache-hit] tf=${tf} symbol=${resolved.code}`);
      return json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      });
    }
    console.log(`[analysis-cache-miss] tf=${tf} symbol=${resolved.code}`);

    const minCount = singleTfCount(tf, days);
    const fetched = await fetchTimeframeCandles(context.env, cache, resolved.code, tf, minCount);
    const candlesForAnalysis = fetched.candles.slice(-Math.max(minCount, 140));
    const candlesForChart = candlesForAnalysis.slice(-visibleCount(tf, days));
    if (candlesForAnalysis.length < (tf === "min15" ? 40 : 70)) {
      return badRequest(`${tf} 분석에 필요한 데이터가 부족합니다.`);
    }

    const analysis = analyzeTimeframe(tf, candlesForAnalysis);
    const payload: AnalysisPayload = {
      meta: {
        input,
        symbol: resolved.code,
        name: fetched.name || resolved.name,
        market: resolved.market,
        asOf: nowIsoKst(),
        source: "KIS",
        cacheTtlSec: ttlSec,
        candleCount: candlesForChart.length,
        summaryText: analysis.summaryText,
        tf,
      },
      scores: analysis.scores,
      signals: analysis.signals,
      reasons: analysis.reasons.slice(0, 6),
      levels: analysis.levels,
      candles: candlesForChart,
      regime: analysis.regime,
      timing: analysis.timing,
    };

    await putCachedJson(cache, cacheKey, payload, ttlSec);
    return json(payload, 200, {
      "x-cache": "MISS",
      "cache-control": `public, max-age=${ttlSec}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "analysis endpoint error";
    return serverError(message);
  }
};

