import type {
  BacktestTrade,
  BacktestWashoutExitMode,
  BacktestWashoutTargetMode,
  Candle,
  Overall,
} from "../types";

export interface DayBacktestOptions {
  holdBars?: number;
  lookbackBars?: number;
  signalOverall?: Overall;
}

export interface WashoutBacktestOptions {
  holdBars?: number;
  lookbackBars?: number;
  targetMode?: BacktestWashoutTargetMode;
  exitMode?: BacktestWashoutExitMode;
}

export interface SimTrade extends BacktestTrade {
  entryIndex: number;
  exitIndex?: number;
  filled1?: boolean;
  filled2?: boolean;
  filled3?: boolean;
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
