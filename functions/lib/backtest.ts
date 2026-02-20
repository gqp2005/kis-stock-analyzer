import { analyzeTimeframe } from "./scoring";
import type {
  BacktestExitReason,
  BacktestOutcome,
  BacktestPeriodMetrics,
  BacktestSummary,
  BacktestTrade,
  Candle,
  Overall,
} from "./types";
import { clamp, round2 } from "./utils";

interface BacktestOptions {
  holdBars?: number;
  lookbackBars?: number;
  signalOverall?: Overall;
}

interface SimTrade extends BacktestTrade {
  entryIndex: number;
}

const MIN_LOOKBACK_BARS = 160;
const DEFAULT_HOLD_BARS = 10;
const MAX_RECENT_TRADES = 80;

const PERIOD_WINDOWS = [
  { label: "3개월", bars: 63 },
  { label: "6개월", bars: 126 },
  { label: "1년", bars: 252 },
] as const;

const round = (value: number): number => round2(value) ?? 0;

const toValidPrice = (value: number, fallback: number): number => {
  if (Number.isFinite(value) && value > 0) return value;
  return Math.max(0.0001, fallback);
};

const buildSummary = (trades: SimTrade[]): BacktestSummary => {
  if (trades.length === 0) {
    return {
      tradeCount: 0,
      winRate: null,
      avgReturnPercent: null,
      avgRMultiple: null,
      profitFactor: null,
      expectancyR: null,
      maxDrawdownPercent: null,
    };
  }

  let winCount = 0;
  let sumReturnPercent = 0;
  let sumRMultiple = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const trade of trades) {
    if (trade.outcome === "WIN") winCount += 1;
    sumReturnPercent += trade.returnPercent;
    sumRMultiple += trade.rMultiple;

    if (trade.returnPercent > 0) grossProfit += trade.returnPercent;
    if (trade.returnPercent < 0) grossLossAbs += Math.abs(trade.returnPercent);

    const tradeReturn = trade.returnPercent / 100;
    equity *= 1 + tradeReturn;
    peak = Math.max(peak, equity);
    const drawdown = (equity / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  const profitFactor =
    grossLossAbs > 0
      ? grossProfit / grossLossAbs
      : grossProfit > 0
        ? 999
        : null;

  return {
    tradeCount: trades.length,
    winRate: round((winCount / trades.length) * 100),
    avgReturnPercent: round(sumReturnPercent / trades.length),
    avgRMultiple: round(sumRMultiple / trades.length),
    profitFactor: profitFactor == null ? null : round(profitFactor),
    expectancyR: round(sumRMultiple / trades.length),
    maxDrawdownPercent: round(maxDrawdown),
  };
};

const toPeriodMetrics = (summary: BacktestSummary, label: string, bars: number): BacktestPeriodMetrics => ({
  label,
  bars,
  tradeCount: summary.tradeCount,
  winRate: summary.winRate,
  avgReturnPercent: summary.avgReturnPercent,
  avgRMultiple: summary.avgRMultiple,
  profitFactor: summary.profitFactor,
  expectancyR: summary.expectancyR,
  maxDrawdownPercent: summary.maxDrawdownPercent,
});

const stripInternal = (trade: SimTrade): BacktestTrade => {
  const { entryIndex: _entryIndex, ...rest } = trade;
  return rest;
};

export const runDayBacktest = (
  candles: Candle[],
  options: BacktestOptions = {},
): {
  summary: BacktestSummary;
  periods: BacktestPeriodMetrics[];
  trades: BacktestTrade[];
  warnings: string[];
} => {
  const holdBars = Math.floor(clamp(options.holdBars ?? DEFAULT_HOLD_BARS, 3, 30));
  const lookbackBars = Math.max(MIN_LOOKBACK_BARS, Math.floor(options.lookbackBars ?? MIN_LOOKBACK_BARS));
  const signalOverall: Overall = options.signalOverall ?? "GOOD";
  const warnings: string[] = [];

  if (candles.length < lookbackBars + 20) {
    warnings.push(`백테스트 데이터가 부족합니다. (${candles.length}/${lookbackBars + 20})`);
    const empty = buildSummary([]);
    return {
      summary: empty,
      periods: PERIOD_WINDOWS.map((window) => toPeriodMetrics(empty, window.label, window.bars)),
      trades: [],
      warnings,
    };
  }

  // 설계 의도: 다중 포지션 중첩을 피하기 위해 신호 체결 후 청산 시점까지 다음 진입을 막습니다.
  const trades: SimTrade[] = [];
  let signalIndex = lookbackBars - 1;
  const lastSignalIndex = candles.length - 2;

  while (signalIndex <= lastSignalIndex) {
    const analysis = analyzeTimeframe("day", candles.slice(0, signalIndex + 1));
    if (analysis.scores.overall !== signalOverall) {
      signalIndex += 1;
      continue;
    }

    const entryIndex = signalIndex + 1;
    const entryBar = candles[entryIndex];
    const entryPrice = toValidPrice(entryBar.open, entryBar.close);

    let stopPrice = analysis.tradePlan.stop ?? entryPrice * 0.98;
    let targetPrice = analysis.tradePlan.target ?? entryPrice * 1.03;
    stopPrice = toValidPrice(stopPrice, entryPrice * 0.98);
    targetPrice = toValidPrice(targetPrice, entryPrice * 1.03);

    if (stopPrice >= entryPrice) stopPrice = entryPrice * 0.98;
    if (targetPrice <= entryPrice) targetPrice = entryPrice * 1.03;

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

  const summary = buildSummary(trades);
  const periods = PERIOD_WINDOWS.map((window) => {
    const startIndex = Math.max(0, candles.length - window.bars);
    const periodTrades = trades.filter((trade) => trade.entryIndex >= startIndex);
    return toPeriodMetrics(buildSummary(periodTrades), window.label, window.bars);
  });

  return {
    summary,
    periods,
    trades: trades.slice(-MAX_RECENT_TRADES).map(stripInternal),
    warnings,
  };
};
