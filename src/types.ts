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

export interface RiskBreakdown {
  atrScore: number;
  bbScore: number;
  mddScore: number;
  sharpDropScore: number;
  rawTotal: number;
  finalRisk: number;
}

export interface TradePlan {
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  note: string;
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
    breakdown: RiskBreakdown;
  };
}

export interface TimeframeAnalysis {
  tf: Timeframe;
  regime: Regime;
  summaryText: string;
  scores: Scores;
  signals: Signals;
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
  tradePlan: TradePlan;
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

export type BacktestOutcome = "WIN" | "LOSS" | "FLAT";
export type BacktestExitReason = "TARGET" | "STOP" | "TIMEOUT";

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  holdBars: number;
  returnPercent: number;
  rMultiple: number;
  outcome: BacktestOutcome;
  exitReason: BacktestExitReason;
}

export interface BacktestPeriodMetrics {
  label: string;
  bars: number;
  tradeCount: number;
  winRate: number | null;
  avgReturnPercent: number | null;
  avgRMultiple: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownPercent: number | null;
}

export interface BacktestSummary {
  tradeCount: number;
  winRate: number | null;
  avgReturnPercent: number | null;
  avgRMultiple: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownPercent: number | null;
}

export interface BacktestResponse {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    holdBars: number;
    signalOverall: Overall;
    ruleId: string;
  };
  summary: BacktestSummary;
  periods: BacktestPeriodMetrics[];
  trades: BacktestTrade[];
  warnings: string[];
}
