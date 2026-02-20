import type { BacktestPeriodMetrics, BacktestSummary } from "../types";
import { round2 } from "../utils";
import { PERIOD_WINDOWS } from "./constants";
import type { SimTrade } from "./types";

const round = (value: number): number => round2(value) ?? 0;

const emptySummary = (): BacktestSummary => ({
  tradeCount: 0,
  winRate: null,
  avgReturnPercent: null,
  avgRMultiple: null,
  payoffRatio: null,
  profitFactor: null,
  expectancyR: null,
  maxDrawdownPercent: null,
});

export const buildBacktestSummary = (trades: SimTrade[]): BacktestSummary => {
  if (trades.length === 0) return emptySummary();

  let winCount = 0;
  let sumReturnPercent = 0;
  let sumRMultiple = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let winReturnSum = 0;
  let lossReturnSum = 0;
  let winTradeCount = 0;
  let lossTradeCount = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (const trade of trades) {
    if (trade.outcome === "WIN") {
      winCount += 1;
      winTradeCount += 1;
      winReturnSum += trade.returnPercent;
    }
    if (trade.outcome === "LOSS") {
      lossTradeCount += 1;
      lossReturnSum += trade.returnPercent;
    }

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

  const avgWinReturn = winTradeCount > 0 ? winReturnSum / winTradeCount : null;
  const avgLossAbs = lossTradeCount > 0 ? Math.abs(lossReturnSum / lossTradeCount) : null;
  const payoffRatio =
    avgWinReturn != null && avgLossAbs != null && avgLossAbs > 0 ? avgWinReturn / avgLossAbs : null;
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
    payoffRatio: payoffRatio == null ? null : round(payoffRatio),
    profitFactor: profitFactor == null ? null : round(profitFactor),
    expectancyR: round(sumRMultiple / trades.length),
    maxDrawdownPercent: round(maxDrawdown),
  };
};

const toPeriodMetrics = (
  summary: BacktestSummary,
  label: string,
  bars: number,
): BacktestPeriodMetrics => ({
  label,
  bars,
  tradeCount: summary.tradeCount,
  winRate: summary.winRate,
  avgReturnPercent: summary.avgReturnPercent,
  avgRMultiple: summary.avgRMultiple,
  payoffRatio: summary.payoffRatio,
  profitFactor: summary.profitFactor,
  expectancyR: summary.expectancyR,
  maxDrawdownPercent: summary.maxDrawdownPercent,
});

export const buildPeriodMetrics = (
  trades: SimTrade[],
  candleCount: number,
): BacktestPeriodMetrics[] =>
  PERIOD_WINDOWS.map((window) => {
    const startIndex = Math.max(0, candleCount - window.bars);
    const periodTrades = trades.filter((trade) => trade.entryIndex >= startIndex);
    return toPeriodMetrics(buildBacktestSummary(periodTrades), window.label, window.bars);
  });

export const buildEmptyPeriodMetrics = (): BacktestPeriodMetrics[] =>
  PERIOD_WINDOWS.map((window) => toPeriodMetrics(emptySummary(), window.label, window.bars));
