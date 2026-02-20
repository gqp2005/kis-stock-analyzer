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
  };
  scores: {
    trend: number;
    momentum: number;
    risk: number;
    overall: Overall;
  };
  signals: Record<string, unknown>;
  reasons: string[];
  levels: Record<string, number | null>;
  candles: Candle[];
}

