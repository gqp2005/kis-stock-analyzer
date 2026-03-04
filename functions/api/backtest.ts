import { getCachedJson, putCachedJson } from "../lib/cache";
import {
  DAY_SCORE_RULE_ID,
  WASHOUT_PULLBACK_RULE_V1,
  WASHOUT_PULLBACK_RULE_V1_1,
  runDayBacktest,
  runWashoutBacktestV1,
  runWashoutBacktestV1_1,
} from "../lib/backtest";
import { fetchTimeframeCandles } from "../lib/kis";
import { nowIsoKst, timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import { resolveStock } from "../lib/stockResolver";
import type {
  BacktestPayload,
  BacktestRuleId,
  BacktestWashoutExitMode,
  BacktestWashoutTargetMode,
  Env,
  Overall,
} from "../lib/types";
import { normalizeInput } from "../lib/utils";

const LOOKBACK_BARS = 160;
const WASHOUT_LOOKBACK_BARS = 240;
const MAX_PERIOD_BARS = 252;

const parseRuleId = (url: URL): BacktestRuleId => {
  const raw = (url.searchParams.get("ruleId") ?? DAY_SCORE_RULE_ID).trim();
  if (raw === WASHOUT_PULLBACK_RULE_V1 || raw === WASHOUT_PULLBACK_RULE_V1_1) return raw;
  return DAY_SCORE_RULE_ID;
};

const parseCount = (url: URL): number => {
  const raw = Number(url.searchParams.get("count") ?? url.searchParams.get("days") ?? "520");
  if (!Number.isFinite(raw)) return 520;
  return Math.max(260, Math.min(900, Math.floor(raw)));
};

const parseHoldBars = (url: URL, ruleId: BacktestRuleId): number => {
  const defaultHold = ruleId === DAY_SCORE_RULE_ID ? 10 : 20;
  const raw = Number(url.searchParams.get("holdBars") ?? String(defaultHold));
  if (!Number.isFinite(raw)) return defaultHold;
  const min = ruleId === DAY_SCORE_RULE_ID ? 3 : 5;
  const max = ruleId === DAY_SCORE_RULE_ID ? 30 : 40;
  return Math.max(min, Math.min(max, Math.floor(raw)));
};

const parseSignalOverall = (url: URL): Overall => {
  const raw = (url.searchParams.get("signal") ?? "GOOD").toUpperCase();
  if (raw === "GOOD" || raw === "NEUTRAL" || raw === "CAUTION") return raw;
  return "GOOD";
};

const parseWashoutTargetMode = (url: URL): BacktestWashoutTargetMode => {
  const raw = (url.searchParams.get("target") ?? "2R").toUpperCase();
  if (raw === "3R") return "3R";
  if (raw === "ANCHOR_HIGH" || raw === "ANCHOR") return "ANCHOR_HIGH";
  return "2R";
};

const parseWashoutExitMode = (url: URL): BacktestWashoutExitMode => {
  const raw = (url.searchParams.get("exit") ?? "PARTIAL").toUpperCase();
  if (raw === "SINGLE_2R" || raw === "SINGLE2R") return "SINGLE_2R";
  return "PARTIAL";
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

    const ruleId = parseRuleId(url);
    const holdBars = parseHoldBars(url, ruleId);
    const signalOverall = parseSignalOverall(url);
    const targetMode = parseWashoutTargetMode(url);
    const exitMode = parseWashoutExitMode(url);
    const requestedCount = parseCount(url);
    const lookbackBars = ruleId === DAY_SCORE_RULE_ID ? LOOKBACK_BARS : WASHOUT_LOOKBACK_BARS;
    const minNeededCount = lookbackBars + MAX_PERIOD_BARS + holdBars + 5;
    const fetchCount = Math.max(requestedCount, minNeededCount);

    const ttlSec = timeframeCacheTtlSec("day");
    const cache = await caches.open("kis-analyzer-cache-v3");
    const cacheKey = `https://cache.local/backtest/v1?code=${encodeURIComponent(
      resolved.code,
    )}&count=${fetchCount}&hold=${holdBars}&signal=${signalOverall}&rule=${ruleId}&target=${targetMode}&exit=${exitMode}`;

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

    const backtest =
      ruleId === DAY_SCORE_RULE_ID
        ? runDayBacktest(candles, {
            holdBars,
            lookbackBars,
            signalOverall,
          })
        : ruleId === WASHOUT_PULLBACK_RULE_V1
          ? runWashoutBacktestV1(candles, {
              holdBars,
              lookbackBars,
              targetMode,
              exitMode,
            })
          : runWashoutBacktestV1_1(candles, {
              holdBars,
              lookbackBars,
              targetMode,
              exitMode,
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
        ruleId,
        ...(ruleId !== DAY_SCORE_RULE_ID ? { targetMode, exitMode } : {}),
      },
      summary: backtest.summary,
      periods: backtest.periods,
      trades: backtest.trades,
      strategyMetrics: "strategyMetrics" in backtest ? backtest.strategyMetrics : null,
      warnings: [
        ...backtest.warnings,
        `rule=${ruleId}`,
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
