import type {
  BacktestExitReason,
  BacktestOutcome,
  BacktestTrade,
  Candle,
  Overall,
} from "../types";
import { clamp, round2 } from "../utils";
import {
  DEFAULT_HOLD_BARS,
  MAX_RECENT_TRADES,
  MIN_LOOKBACK_BARS,
} from "./constants";
import {
  buildBacktestSummary,
  buildEmptyPeriodMetrics,
  buildPeriodMetrics,
} from "./metrics";
import type {
  DayBacktestOptions,
  DaySignalDecision,
  DaySignalEvaluator,
  SimTrade,
} from "./types";

const round = (value: number): number => round2(value) ?? 0;

const toValidPrice = (value: number, fallback: number): number => {
  if (Number.isFinite(value) && value > 0) return value;
  return Math.max(0.0001, fallback);
};

const stripInternal = (trade: SimTrade): BacktestTrade => {
  const { entryIndex: _entryIndex, ...rest } = trade;
  return rest;
};

const normalizeRiskLevels = (
  entryPrice: number,
  decision: DaySignalDecision,
): { stopPrice: number; targetPrice: number } => {
  let stopPrice = decision.stopPrice ?? entryPrice * 0.98;
  let targetPrice = decision.targetPrice ?? entryPrice * 1.03;
  stopPrice = toValidPrice(stopPrice, entryPrice * 0.98);
  targetPrice = toValidPrice(targetPrice, entryPrice * 1.03);

  if (stopPrice >= entryPrice) stopPrice = entryPrice * 0.98;
  if (targetPrice <= entryPrice) targetPrice = entryPrice * 1.03;
  return { stopPrice, targetPrice };
};

export const runDayBacktestEngine = (
  candles: Candle[],
  signalEvaluator: DaySignalEvaluator,
  options: DayBacktestOptions = {},
): {
  summary: ReturnType<typeof buildBacktestSummary>;
  periods: ReturnType<typeof buildPeriodMetrics>;
  trades: BacktestTrade[];
  warnings: string[];
  config: {
    holdBars: number;
    lookbackBars: number;
    signalOverall: Overall;
  };
} => {
  const holdBars = Math.floor(clamp(options.holdBars ?? DEFAULT_HOLD_BARS, 3, 30));
  const lookbackBars = Math.max(MIN_LOOKBACK_BARS, Math.floor(options.lookbackBars ?? MIN_LOOKBACK_BARS));
  const signalOverall: Overall = options.signalOverall ?? "GOOD";
  const warnings: string[] = [];

  if (candles.length < lookbackBars + 20) {
    warnings.push(`백테스트 데이터가 부족합니다. (${candles.length}/${lookbackBars + 20})`);
    return {
      summary: buildBacktestSummary([]),
      periods: buildEmptyPeriodMetrics(),
      trades: [],
      warnings,
      config: {
        holdBars,
        lookbackBars,
        signalOverall,
      },
    };
  }

  // 설계 의도: 다중 포지션 중첩을 피하기 위해 신호 체결 후 청산 시점까지 다음 진입을 막습니다.
  const trades: SimTrade[] = [];
  let signalIndex = lookbackBars - 1;
  const lastSignalIndex = candles.length - 2;

  while (signalIndex <= lastSignalIndex) {
    const decision = signalEvaluator({
      candles,
      signalIndex,
      lookbackBars,
      signalOverall,
    });
    if (!decision.shouldEnter) {
      signalIndex += 1;
      continue;
    }

    const entryIndex = signalIndex + 1;
    const entryBar = candles[entryIndex];
    const entryPrice = toValidPrice(entryBar.open, entryBar.close);
    const { stopPrice, targetPrice } = normalizeRiskLevels(entryPrice, decision);

    const riskPerShare = Math.max(0.0001, entryPrice - stopPrice);
    const maxExitIndex = Math.min(candles.length - 1, entryIndex + holdBars);

    let exitIndex = maxExitIndex;
    let exitPrice = toValidPrice(candles[exitIndex].close, entryPrice);
    let outcome: BacktestOutcome = "FLAT";
    let exitReason: BacktestExitReason = "TIMEOUT";

    for (let i = entryIndex; i <= maxExitIndex; i += 1) {
      const candle = candles[i];
      const stopHit = candle.low <= stopPrice;
      const targetHit = candle.high >= targetPrice;

      // 보수적으로 같은 봉 동시 터치 시 손절 우선 처리
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

    if (exitReason === "TIMEOUT") {
      const timeoutReturn = ((exitPrice - entryPrice) / entryPrice) * 100;
      if (timeoutReturn > 0.05) outcome = "WIN";
      else if (timeoutReturn < -0.05) outcome = "LOSS";
    }

    const returnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const rMultiple = (exitPrice - entryPrice) / riskPerShare;

    trades.push({
      entryIndex,
      entryTime: entryBar.time,
      exitTime: candles[exitIndex].time,
      entryPrice: round(entryPrice),
      exitPrice: round(exitPrice),
      stopPrice: round(stopPrice),
      targetPrice: round(targetPrice),
      holdBars,
      returnPercent: round(returnPercent),
      rMultiple: round(rMultiple),
      outcome,
      exitReason,
    });

    signalIndex = Math.max(signalIndex + 1, exitIndex + 1);
  }

  if (trades.length === 0) {
    warnings.push(`시그널 조건(${signalOverall})을 충족한 진입이 없어 거래가 생성되지 않았습니다.`);
  }
  if (trades.length > 0 && trades.length < 8) {
    warnings.push("거래 표본 수가 적습니다. 해석에 주의하세요.");
  }

  return {
    summary: buildBacktestSummary(trades),
    periods: buildPeriodMetrics(trades, candles.length),
    trades: trades.slice(-MAX_RECENT_TRADES).map(stripInternal),
    warnings,
    config: {
      holdBars,
      lookbackBars,
      signalOverall,
    },
  };
};
