import type { BacktestTrade, Candle, Overall } from "../types";

export interface DayBacktestOptions {
  holdBars?: number;
  lookbackBars?: number;
  signalOverall?: Overall;
}

export interface SimTrade extends BacktestTrade {
  entryIndex: number;
}

export interface DaySignalContext {
  candles: Candle[];
  signalIndex: number;
  lookbackBars: number;
  signalOverall: Overall;
}

export interface DaySignalDecision {
  shouldEnter: boolean;
  stopPrice: number | null;
  targetPrice: number | null;
}

export type DaySignalEvaluator = (context: DaySignalContext) => DaySignalDecision;
