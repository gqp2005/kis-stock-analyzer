import { detectWashoutPullback } from "../washoutPullback";
import type {
  BacktestExitReason,
  BacktestOutcome,
  BacktestStrategyMetrics,
  BacktestTrade,
  BacktestTradeEntry,
  BacktestWashoutExitMode,
  BacktestWashoutTargetMode,
  Candle,
  WashoutPullbackCard,
} from "../types";
import { clamp, round2 } from "../utils";
import {
  DEFAULT_WASHOUT_HOLD_BARS,
  MAX_RECENT_TRADES,
  MIN_WASHOUT_LOOKBACK_BARS,
  WASHOUT_PULLBACK_RULE_V1,
  WASHOUT_PULLBACK_RULE_V1_1,
} from "./constants";
import {
  buildBacktestSummary,
  buildEmptyPeriodMetrics,
  buildPeriodMetrics,
} from "./metrics";
import type { SimTrade, WashoutBacktestOptions } from "./types";

const round = (value: number): number => round2(value) ?? 0;

type WashoutRuleId = typeof WASHOUT_PULLBACK_RULE_V1 | typeof WASHOUT_PULLBACK_RULE_V1_1;

const toValidPrice = (value: number, fallback: number): number => {
  if (Number.isFinite(value) && value > 0) return value;
  return Math.max(0.0001, fallback);
};

const isSignalState = (state: WashoutPullbackCard["state"]): boolean =>
  state === "PULLBACK_READY" || state === "REBOUND_CONFIRMED";

const normalizeInvalidLow = (
  entryRef: number,
  invalidLow: number | null,
  zoneLow: number | null,
): number => {
  let stop = invalidLow ?? (zoneLow != null ? zoneLow * 0.98 : entryRef * 0.94);
  stop = toValidPrice(stop, entryRef * 0.94);
  if (stop >= entryRef) stop = entryRef * 0.94;
  return stop;
};

const resolveTargetPriceV1 = (
  entry: number,
  stop: number,
  targetMode: BacktestWashoutTargetMode,
  anchorHigh: number | null,
): number => {
  const risk = Math.max(0.0001, entry - stop);
  if (targetMode === "3R") return entry + risk * 3;
  if (targetMode === "ANCHOR_HIGH" && anchorHigh != null && anchorHigh > entry) return anchorHigh;
  return entry + risk * 2;
};

const toOutcomeOnTimeout = (returnPercent: number): BacktestOutcome => {
  if (returnPercent > 0.05) return "WIN";
  if (returnPercent < -0.05) return "LOSS";
  return "FLAT";
};

const normalizeSingleTrade = (
  candles: Candle[],
  signalIndex: number,
  holdBars: number,
  card: WashoutPullbackCard,
  targetMode: BacktestWashoutTargetMode,
): SimTrade | null => {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= candles.length) return null;

  const entryBar = candles[entryIndex];
  const entryPrice = toValidPrice(entryBar.open, entryBar.close);
  const stopPrice = normalizeInvalidLow(entryPrice, card.entryPlan.invalidLow, card.pullbackZone.low);
  const targetPrice = resolveTargetPriceV1(entryPrice, stopPrice, targetMode, card.anchorSpike.priceHigh);
  const riskPerShare = Math.max(0.0001, entryPrice - stopPrice);
  const maxExitIndex = Math.min(candles.length - 1, entryIndex + holdBars);

  let exitIndex = maxExitIndex;
  let exitPrice = toValidPrice(candles[exitIndex].close, entryPrice);
  let exitReason: BacktestExitReason = "TIMEOUT";
  let outcome: BacktestOutcome = "FLAT";

  for (let i = entryIndex; i <= maxExitIndex; i += 1) {
    const candle = candles[i];
    const stopHit = candle.low <= stopPrice;
    const targetHit = candle.high >= targetPrice;
    if (stopHit && targetHit) {
      exitIndex = i;
      exitPrice = stopPrice;
      exitReason = "STOP";
      outcome = "LOSS";
      break;
    }
    if (stopHit) {
      exitIndex = i;
      exitPrice = stopPrice;
      exitReason = "STOP";
      outcome = "LOSS";
      break;
    }
    if (targetHit) {
      exitIndex = i;
      exitPrice = targetPrice;
      exitReason = "TARGET";
      outcome = "WIN";
      break;
    }
  }

  const returnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const rMultiple = (exitPrice - entryPrice) / riskPerShare;
  if (exitReason === "TIMEOUT") {
    outcome = toOutcomeOnTimeout(returnPercent);
  }

  const entries: BacktestTradeEntry[] = [
    {
      label: "1차",
      time: entryBar.time,
      price: round(entryPrice),
      weight: 1,
    },
  ];

  return {
    entryIndex,
    exitIndex,
    entryTime: entryBar.time,
    exitTime: candles[exitIndex].time,
    entryPrice: round(entryPrice),
    exitPrice: round(exitPrice),
    stopPrice: round(stopPrice),
    targetPrice: round(targetPrice),
    holdBars: exitIndex - entryIndex + 1,
    returnPercent: round(returnPercent),
    rMultiple: round(rMultiple),
    outcome,
    exitReason,
    entries,
    avgEntry: round(entryPrice),
    invalidLow: round(stopPrice),
    r: round(rMultiple),
    tranchesFilled: 1,
    partialExited: false,
    target2Reached: exitReason === "TARGET",
    filled1: true,
    filled2: false,
    filled3: false,
  };
};

const normalizeSplitTrade = (
  candles: Candle[],
  signalIndex: number,
  holdBars: number,
  card: WashoutPullbackCard,
  exitMode: BacktestWashoutExitMode,
): SimTrade | null => {
  const entryStartIndex = signalIndex + 1;
  if (entryStartIndex >= candles.length) return null;
  if (card.pullbackZone.low == null || card.pullbackZone.high == null) return null;

  const zoneHigh = Math.max(card.pullbackZone.low, card.pullbackZone.high);
  const zoneLow = Math.min(card.pullbackZone.low, card.pullbackZone.high);
  const zoneMid = (zoneHigh + zoneLow) / 2;
  const trancheLevels = [zoneHigh, zoneMid, zoneLow];
  const trancheWeights = [0.4, 0.3, 0.3];
  const maxExitIndex = Math.min(candles.length - 1, entryStartIndex + holdBars);

  const filled = [false, false, false];
  const entries: BacktestTradeEntry[] = [];
  let totalQty = 0;
  let totalCost = 0;
  let positionQty = 0;
  let realizedPnl = 0;
  let partialExited = false;
  let target2Reached = false;

  let exitIndex = maxExitIndex;
  let exitPrice = toValidPrice(candles[exitIndex].close, candles[entryStartIndex].close);
  let exitReason: BacktestExitReason = "TIMEOUT";
  let outcome: BacktestOutcome = "FLAT";

  for (let i = entryStartIndex; i <= maxExitIndex; i += 1) {
    const candle = candles[i];

    for (let idx = 0; idx < 3; idx += 1) {
      if (filled[idx]) continue;
      if (candle.low > trancheLevels[idx]) continue;

      const fillPrice = trancheLevels[idx];
      const weight = trancheWeights[idx];
      filled[idx] = true;
      totalQty += weight;
      positionQty += weight;
      totalCost += fillPrice * weight;
      entries.push({
        label: `${idx + 1}차`,
        time: candle.time,
        price: round(fillPrice),
        weight,
      });
    }

    if (positionQty <= 0 || totalQty <= 0) continue;

    const avgEntry = totalCost / totalQty;
    const stopPrice = normalizeInvalidLow(avgEntry, card.entryPlan.invalidLow, zoneLow);
    const riskPerShare = Math.max(0.0001, avgEntry - stopPrice);
    const target1 = avgEntry + riskPerShare;
    const target2 = avgEntry + riskPerShare * 2;

    const stopHit = candle.low <= stopPrice;
    const target1Hit = candle.high >= target1;
    const target2Hit = candle.high >= target2;

    if (stopHit) {
      realizedPnl += (stopPrice - avgEntry) * positionQty;
      positionQty = 0;
      exitIndex = i;
      exitPrice = stopPrice;
      exitReason = "STOP";
      outcome = "LOSS";
      break;
    }

    if (exitMode === "PARTIAL") {
      if (!partialExited && target1Hit) {
        const qty = positionQty * 0.5;
        realizedPnl += (target1 - avgEntry) * qty;
        positionQty -= qty;
        partialExited = true;
      }

      if (target2Hit && positionQty > 0) {
        realizedPnl += (target2 - avgEntry) * positionQty;
        positionQty = 0;
        exitIndex = i;
        exitPrice = target2;
        exitReason = "TARGET";
        outcome = "WIN";
        target2Reached = true;
        break;
      }
    } else if (target2Hit) {
      realizedPnl += (target2 - avgEntry) * positionQty;
      positionQty = 0;
      exitIndex = i;
      exitPrice = target2;
      exitReason = "TARGET";
      outcome = "WIN";
      target2Reached = true;
      break;
    }
  }

  if (totalQty <= 0) return null;

  const avgEntry = totalCost / totalQty;
  const stopPrice = normalizeInvalidLow(avgEntry, card.entryPlan.invalidLow, zoneLow);
  const riskPerShare = Math.max(0.0001, avgEntry - stopPrice);
  const targetPrice = avgEntry + riskPerShare * 2;

  if (positionQty > 0) {
    const timeoutPrice = toValidPrice(candles[maxExitIndex].close, avgEntry);
    realizedPnl += (timeoutPrice - avgEntry) * positionQty;
    exitIndex = maxExitIndex;
    exitPrice = timeoutPrice;
    exitReason = exitReason === "STOP" ? "STOP" : "TIMEOUT";
  }

  const investedCapital = Math.max(0.0001, avgEntry * totalQty);
  const riskCapital = Math.max(0.0001, (avgEntry - stopPrice) * totalQty);
  const returnPercent = (realizedPnl / investedCapital) * 100;
  const rMultiple = realizedPnl / riskCapital;
  if (exitReason === "TIMEOUT") {
    outcome = toOutcomeOnTimeout(returnPercent);
  }

  return {
    entryIndex: entries.length > 0 ? candles.findIndex((c) => c.time === entries[0].time) : entryStartIndex,
    exitIndex,
    entryTime: entries[0]?.time ?? candles[entryStartIndex].time,
    exitTime: candles[exitIndex].time,
    entryPrice: round(avgEntry),
    exitPrice: round(exitPrice),
    stopPrice: round(stopPrice),
    targetPrice: round(targetPrice),
    holdBars: Math.max(1, exitIndex - entryStartIndex + 1),
    returnPercent: round(returnPercent),
    rMultiple: round(rMultiple),
    outcome,
    exitReason,
    entries,
    avgEntry: round(avgEntry),
    invalidLow: round(stopPrice),
    r: round(rMultiple),
    tranchesFilled: filled.filter(Boolean).length,
    partialExited,
    target2Reached,
    filled1: filled[0],
    filled2: filled[1],
    filled3: filled[2],
  };
};

const toStrategyMetrics = (trades: SimTrade[]): BacktestStrategyMetrics => {
  if (trades.length === 0) {
    return {
      avgTranchesFilled: null,
      fillRate1: null,
      fillRate2: null,
      fillRate3: null,
      partialExitRate: null,
      target2HitRate: null,
    };
  }

  const total = trades.length;
  const tranchesSum = trades.reduce((sum, trade) => sum + (trade.tranchesFilled ?? 0), 0);
  const countBy = (predicate: (trade: SimTrade) => boolean): number =>
    trades.filter(predicate).length;

  return {
    avgTranchesFilled: round(tranchesSum / total),
    fillRate1: round((countBy((trade) => trade.filled1 === true) / total) * 100),
    fillRate2: round((countBy((trade) => trade.filled2 === true) / total) * 100),
    fillRate3: round((countBy((trade) => trade.filled3 === true) / total) * 100),
    partialExitRate: round((countBy((trade) => trade.partialExited === true) / total) * 100),
    target2HitRate: round((countBy((trade) => trade.target2Reached === true) / total) * 100),
  };
};

const stripInternal = (trade: SimTrade): BacktestTrade => {
  const {
    entryIndex: _entryIndex,
    exitIndex: _exitIndex,
    filled1: _filled1,
    filled2: _filled2,
    filled3: _filled3,
    ...rest
  } = trade;
  return rest;
};

export const runWashoutPullbackBacktest = (
  candles: Candle[],
  ruleId: WashoutRuleId,
  options: WashoutBacktestOptions = {},
): {
  summary: ReturnType<typeof buildBacktestSummary>;
  periods: ReturnType<typeof buildPeriodMetrics>;
  trades: BacktestTrade[];
  warnings: string[];
  strategyMetrics: BacktestStrategyMetrics;
  config: {
    holdBars: number;
    lookbackBars: number;
    targetMode: BacktestWashoutTargetMode;
    exitMode: BacktestWashoutExitMode;
    ruleId: WashoutRuleId;
  };
} => {
  const holdBars = Math.floor(clamp(options.holdBars ?? DEFAULT_WASHOUT_HOLD_BARS, 5, 40));
  const lookbackBars = Math.max(
    MIN_WASHOUT_LOOKBACK_BARS,
    Math.floor(options.lookbackBars ?? MIN_WASHOUT_LOOKBACK_BARS),
  );
  const targetMode: BacktestWashoutTargetMode = options.targetMode ?? "2R";
  const exitMode: BacktestWashoutExitMode =
    ruleId === WASHOUT_PULLBACK_RULE_V1 ? "SINGLE_2R" : options.exitMode ?? "PARTIAL";
  const warnings: string[] = [];

  if (candles.length < lookbackBars + 20) {
    warnings.push(`백테스트 데이터가 부족합니다. (${candles.length}/${lookbackBars + 20})`);
    return {
      summary: buildBacktestSummary([]),
      periods: buildEmptyPeriodMetrics(),
      trades: [],
      warnings,
      strategyMetrics: toStrategyMetrics([]),
      config: {
        holdBars,
        lookbackBars,
        targetMode,
        exitMode,
        ruleId,
      },
    };
  }

  const trades: SimTrade[] = [];
  let signalIndex = lookbackBars - 1;
  const lastSignalIndex = candles.length - 2;
  let signalCount = 0;
  let noFillCount = 0;

  while (signalIndex <= lastSignalIndex) {
    const history = candles.slice(0, signalIndex + 1);
    const card = detectWashoutPullback(history).card;
    if (!card.detected || !isSignalState(card.state)) {
      signalIndex += 1;
      continue;
    }

    signalCount += 1;
    const trade =
      ruleId === WASHOUT_PULLBACK_RULE_V1
        ? normalizeSingleTrade(candles, signalIndex, holdBars, card, targetMode)
        : normalizeSplitTrade(candles, signalIndex, holdBars, card, exitMode);

    if (!trade) {
      noFillCount += 1;
      signalIndex += 1;
      continue;
    }

    trades.push(trade);
    signalIndex = Math.max(signalIndex + 1, (trade.exitIndex ?? signalIndex) + 1);
  }

  if (signalCount === 0) {
    warnings.push("전략 신호(PULLBACK_READY/REBOUND_CONFIRMED)가 없어 거래가 생성되지 않았습니다.");
  }
  if (signalCount > 0 && trades.length === 0) {
    warnings.push("신호는 있었지만 체결 조건을 충족하지 못해 거래가 생성되지 않았습니다.");
  }
  if (noFillCount > 0) {
    warnings.push(`분할 체결 미충족 신호 ${noFillCount}건은 거래에서 제외했습니다.`);
  }
  if (trades.length > 0 && trades.length < 8) {
    warnings.push("표본 부족: 거래 수가 적어 해석에 주의가 필요합니다.");
  }

  return {
    summary: buildBacktestSummary(trades),
    periods: buildPeriodMetrics(trades, candles.length),
    trades: trades.slice(-MAX_RECENT_TRADES).map(stripInternal),
    warnings,
    strategyMetrics: toStrategyMetrics(trades),
    config: {
      holdBars,
      lookbackBars,
      targetMode,
      exitMode,
      ruleId,
    },
  };
};

