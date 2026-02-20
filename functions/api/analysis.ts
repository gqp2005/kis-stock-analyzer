import { getCachedJson, putCachedJson } from "../lib/cache";
import { fetchDailyCandles } from "../lib/kis";
import { analysisTtlSec, nowIsoKst } from "../lib/market";
import { badRequest, json, serverError } from "../lib/response";
import { analyzeCandles } from "../lib/scoring";
import { resolveStock } from "../lib/stockResolver";
import type { AnalysisPayload, Env } from "../lib/types";
import { normalizeInput } from "../lib/utils";

// 설계 메모:
// - KIS 호출량을 줄이기 위해 "분석 결과 전체"를 Cache API에 저장합니다.
// - 캐시 키는 종목코드 기준으로 고정해, 종목명/코드 중 어느 입력이든 같은 캐시를 재사용합니다.
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
    const cacheKey = `https://cache.local/analysis/v1?code=${encodeURIComponent(
      resolved.code,
    )}&days=${days}`;

    const cached = await getCachedJson<AnalysisPayload>(cache, cacheKey);
    if (cached) {
      return json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": `public, max-age=${ttlSec}`,
      });
    }

    const minCount = Math.max(days, 170);
    const fetched = await fetchDailyCandles(context.env, cache, resolved.code, minCount);
    const candlesForAnalysis = fetched.candles.slice(-Math.max(days, 140));
    const candlesForChart = candlesForAnalysis.slice(-days);

    if (candlesForAnalysis.length < 120) {
      return badRequest("지표 계산에 필요한 데이터가 부족합니다. (최소 120봉)");
    }

    const analysis = analyzeCandles(candlesForAnalysis);
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
      },
      scores: analysis.scores,
      signals: analysis.signals,
      reasons: analysis.reasons.slice(0, 6),
      levels: analysis.levels,
      candles: candlesForChart,
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
