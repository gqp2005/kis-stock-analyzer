export interface Env {
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_BASE_URL?: string;
  KIS_ENV?: "real" | "demo";
}

export type Timeframe = "month" | "week" | "day" | "min15";
export type Regime = "UP" | "SIDE" | "DOWN";
export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";

export interface Candle {
  time: string; // day/week/month: YYYY-MM-DD, min15: ISO datetime string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLevels {
  ma20: number | null;
  maFast: number | null;
  maMid: number | null;
  maLong: number | null;
  rsi14: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  atr14: number | null;
  atrPercent: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  volumeMa20: number | null;
  support: number | null;
  resistance: number | null;
}

export interface Scores {
  trend: number;
  momentum: number;
  risk: number;
  overall: Overall;
}

export interface Signals {
  trend: {
    closeAboveMid: boolean;
    fastAboveMid: boolean;
    midSlopeUp: boolean;
    midAboveLong: boolean;
    breakout: boolean;
  };
  momentum: {
    rsi: number | null;
    rsiBand: "HIGH" | "MID" | "LOW";
    rsiUpN: boolean;
    closeAboveFast: boolean;
    returnNPositive: boolean;
    volumeAboveMa20: boolean;
  };
  risk: {
    atrPercent: number | null;
    atrBucket: "<=2" | "2~4" | "4~6" | ">6" | "N/A";
    bbPosition: "ABOVE_UPPER" | "INSIDE_BAND" | "BELOW_LOWER" | "N/A";
    mddN: number | null;
    sharpDropBar: boolean;
  };
}

export interface TimingInfo {
  timingScore: number;
  timingLabel: "타이밍 양호" | "관망/조건부" | "진입 비추";
  reasons: string[];
}

export interface TimeframeAnalysis {
  tf: Timeframe;
  regime: Regime;
  summaryText: string;
  scores: Scores;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  candles: Candle[];
  timing?: TimingInfo;
}

export interface AnalysisPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    summaryText: string;
    tf: Timeframe;
  };
  scores: Scores;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  candles: Candle[];
  regime: Regime;
  timing?: TimingInfo;
}

export interface MultiAnalysisPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
  };
  final: {
    overall: Overall;
    confidence: number;
    summary: string;
  };
  timeframes: {
    month: TimeframeAnalysis;
    week: TimeframeAnalysis;
    day: TimeframeAnalysis;
    min15: TimeframeAnalysis;
  };
  warnings: string[];
}

export interface OhlcvPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    tf: Timeframe;
  };
  candles: Candle[];
}

