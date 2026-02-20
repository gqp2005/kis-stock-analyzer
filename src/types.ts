export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";
export type Timeframe = "month" | "week" | "day" | "min15";
export type Regime = "UP" | "SIDE" | "DOWN";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Scores {
  trend: number;
  momentum: number;
  risk: number;
  overall: Overall;
}

export interface IndicatorPoint {
  time: string;
  value: number | null;
}

export interface IndicatorSeries {
  ma: {
    ma1Period: number;
    ma2Period: number;
    ma3Period: number | null;
    ma1: IndicatorPoint[];
    ma2: IndicatorPoint[];
    ma3: IndicatorPoint[];
  };
  rsi14: IndicatorPoint[];
  bb: {
    upper: IndicatorPoint[];
    mid: IndicatorPoint[];
    lower: IndicatorPoint[];
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
  reasons: string[];
  levels: {
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
  };
  indicators: IndicatorSeries;
  candles: Candle[];
  timing?: TimingInfo | null;
}

export interface MultiAnalysisResponse {
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
    month: TimeframeAnalysis | null;
    week: TimeframeAnalysis | null;
    day: TimeframeAnalysis | null;
    min15: TimeframeAnalysis | null;
  };
  warnings: string[];
}
