export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnalysisResponse {
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
  };
  scores: {
    trend: number;
    momentum: number;
    risk: number;
    overall: Overall;
  };
  signals: Record<string, unknown>;
  reasons: string[];
  levels: {
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
    support: number | null;
    resistance: number | null;
  };
  candles: Candle[];
}
