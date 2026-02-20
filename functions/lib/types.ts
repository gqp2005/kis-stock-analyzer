export interface Env {
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_BASE_URL?: string;
  KIS_ENV?: "real" | "demo";
}

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLevels {
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  atr14: number | null;
  atrPercent: number | null;
  recentHigh20: number | null;
  recentLow20: number | null;
  volumeMa20: number | null;
}

export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";

export interface Scores {
  trend: number;
  momentum: number;
  risk: number;
  overall: Overall;
}

export interface Signals {
  trend: {
    closeAboveMa60: boolean;
    ma20AboveMa60: boolean;
    ma60SlopeUp: boolean;
    ma60AboveMa120: boolean;
    newHigh20: boolean;
  };
  momentum: {
    rsi: number | null;
    rsiBand: "HIGH" | "MID" | "LOW";
    rsiUp5d: boolean;
    closeAboveMa20: boolean;
    return5dPositive: boolean;
    volumeAboveMa20: boolean;
  };
  risk: {
    atrPercent: number | null;
    atrBucket: "<=2" | "2~4" | "4~6" | ">6" | "N/A";
    bbPosition: "ABOVE_UPPER" | "INSIDE_BAND" | "BELOW_LOWER" | "N/A";
    mdd20: number | null;
    sharpDropDay: boolean;
  };
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
  };
  scores: Scores;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  candles: Candle[];
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
  };
  candles: Candle[];
}

