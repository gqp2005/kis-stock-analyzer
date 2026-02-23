import { atr, sma } from "./indicators";
import type { Candle } from "./types";
import { clamp, round2 } from "./utils";

export interface StrategyThresholds {
  volume: number;
  hs: number;
  ihs: number;
  vcp: number;
}

export interface StrategyTuneMetric {
  threshold: number;
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  quality: number;
}

export interface WalkForwardTuneResult {
  thresholds: StrategyThresholds;
  metrics: {
    volume: StrategyTuneMetric;
    hs: StrategyTuneMetric;
    ihs: StrategyTuneMetric;
    vcp: StrategyTuneMetric;
  };
  sampleCount: number;
}

interface WalkForwardPoint {
  volumeScore: number;
  hsScore: number;
  ihsScore: number;
  vcpScore: number;
  forwardReturnPct: number;
}

const DEFAULT_THRESHOLDS: StrategyThresholds = {
  volume: 60,
  hs: 68,
  ihs: 65,
  vcp: 80,
};

const HOLD_BARS = 10;
const STEP_BARS = 10;
const MIN_SAMPLE_BARS = 220;

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toNullableRounded = (value: number | null): number | null => round2(value);

const safeMax = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.max(...values);
};

const safeMin = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.min(...values);
};

const computeVolumeScoreProxy = (
  close: number,
  ma20: number | null,
  rsi: number | null,
  volRatio: number,
): number => {
  let score = 50;
  if (close > (ma20 ?? close)) score += 15;
  if (rsi != null) {
    if (rsi >= 55) score += 15;
    else if (rsi >= 45) score += 8;
  }
  if (volRatio >= 1.5) score += 15;
  else if (volRatio >= 1.2) score += 8;
  else if (volRatio <= 0.6) score -= 10;
  return clamp(Math.round(score), 0, 100);
};

const computeHsScoreProxy = (
  close: number,
  ma60: number | null,
  low60Prev: number,
  volRatio: number,
): number => {
  let score = 35;
  if (close < low60Prev && low60Prev > 0) score += 30;
  if (ma60 != null && close < ma60) score += 20;
  if (volRatio >= 1.2) score += 10;
  if (volRatio >= 1.6) score += 5;
  return clamp(Math.round(score), 0, 100);
};

const computeIhsScoreProxy = (
  close: number,
  ma60: number | null,
  high60Prev: number,
  volRatio: number,
): number => {
  let score = 35;
  if (close > high60Prev && high60Prev > 0) score += 30;
  if (ma60 != null && close > ma60) score += 20;
  if (volRatio >= 1.2) score += 10;
  if (volRatio >= 1.6) score += 5;
  return clamp(Math.round(score), 0, 100);
};

const computeVcpScoreProxy = (
  close: number,
  ma50: number | null,
  ma150: number | null,
  high60Prev: number,
  atr20: number | null,
  atr120: number | null,
  avgVol20: number,
  avgVol120: number,
): number => {
  let score = 40;
  const distanceToR = high60Prev > 0 ? (high60Prev - close) / high60Prev : null;
  if (ma50 != null && ma150 != null && close > ma50 && ma50 > ma150) score += 20;
  if (distanceToR != null && distanceToR >= 0 && distanceToR <= 0.08) {
    score += distanceToR <= 0.03 ? 20 : 12;
  }
  if (atr20 != null && atr120 != null && atr120 > 0 && atr20 <= atr120 * 0.75) score += 10;
  if (avgVol120 > 0 && avgVol20 <= avgVol120 * 0.7) score += 10;
  return clamp(Math.round(score), 0, 100);
};

const evaluateThreshold = (
  points: WalkForwardPoint[],
  threshold: number,
  scoreAccessor: (point: WalkForwardPoint) => number,
  direction: "bull" | "bear",
): StrategyTuneMetric => {
  const trades = points.filter((point) => scoreAccessor(point) >= threshold);
  if (trades.length === 0) {
    return {
      threshold,
      trades: 0,
      winRate: null,
      avgReturn: null,
      quality: 0,
    };
  }

  const winCount = trades.filter((point) =>
    direction === "bull" ? point.forwardReturnPct > 0 : point.forwardReturnPct < 0,
  ).length;
  const tradeReturns = trades.map((point) =>
    direction === "bull" ? point.forwardReturnPct : -point.forwardReturnPct,
  );
  const winRate = (winCount / trades.length) * 100;
  const avgReturn = average(tradeReturns);
  const qualityRaw =
    (winRate - 50) * 0.8 +
    avgReturn * 3 +
    Math.log(trades.length + 1) * 8 -
    (trades.length < 3 ? 25 : 0);

  return {
    threshold,
    trades: trades.length,
    winRate: toNullableRounded(winRate),
    avgReturn: toNullableRounded(avgReturn),
    quality: clamp(Math.round(qualityRaw + 50), 0, 100),
  };
};

const pickBestMetric = (metrics: StrategyTuneMetric[], fallback: number): StrategyTuneMetric => {
  if (metrics.length === 0) {
    return {
      threshold: fallback,
      trades: 0,
      winRate: null,
      avgReturn: null,
      quality: 0,
    };
  }
  return [...metrics].sort((a, b) => {
    if (b.quality !== a.quality) return b.quality - a.quality;
    if ((b.winRate ?? 0) !== (a.winRate ?? 0)) return (b.winRate ?? 0) - (a.winRate ?? 0);
    return b.trades - a.trades;
  })[0];
};

const buildPoints = (candles: Candle[]): WalkForwardPoint[] => {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ma20Series = sma(closes, 20);
  const ma50Series = sma(closes, 50);
  const ma60Series = sma(closes, 60);
  const ma150Series = sma(closes, 150);
  const atrSeries = atr(candles, 14);
  const atrPctSeries = candles.map((candle, index) => {
    const atrValue = atrSeries[index];
    if (atrValue == null || candle.close <= 0) return null;
    return atrValue / candle.close;
  });
  const volMa20 = sma(volumes, 20);
  const gains = closes.map((close, index) => {
    if (index === 0) return 0;
    return Math.max(0, close - closes[index - 1]);
  });
  const losses = closes.map((close, index) => {
    if (index === 0) return 0;
    return Math.max(0, closes[index - 1] - close);
  });
  const avgGain = sma(gains, 14);
  const avgLoss = sma(losses, 14);

  const points: WalkForwardPoint[] = [];
  const start = Math.max(180, candles.length - 180);
  const end = candles.length - HOLD_BARS - 1;
  for (let i = start; i <= end; i += STEP_BARS) {
    const close = closes[i];
    if (!Number.isFinite(close) || close <= 0) continue;
    const ma20 = ma20Series[i];
    const ma50 = ma50Series[i];
    const ma60 = ma60Series[i];
    const ma150 = ma150Series[i];
    const volMa = volMa20[i];
    const volRatio = volMa != null && volMa > 0 ? volumes[i] / volMa : 1;
    const rsi =
      avgGain[i] != null && avgLoss[i] != null
        ? avgLoss[i] === 0
          ? 100
          : 100 - 100 / (1 + avgGain[i]! / avgLoss[i]!)
        : null;
    const high60Prev = safeMax(candles.slice(Math.max(0, i - 60), i).map((candle) => candle.high));
    const low60Prev = safeMin(candles.slice(Math.max(0, i - 60), i).map((candle) => candle.low));
    const atr20 = average(
      atrPctSeries.slice(Math.max(0, i - 20), i).filter((value): value is number => value != null),
    );
    const atr120 = average(
      atrPctSeries.slice(Math.max(0, i - 120), i).filter((value): value is number => value != null),
    );
    const avgVol20 = average(volumes.slice(Math.max(0, i - 20), i));
    const avgVol120 = average(volumes.slice(Math.max(0, i - 120), i));
    const forwardClose = closes[i + HOLD_BARS];
    if (!Number.isFinite(forwardClose) || forwardClose <= 0) continue;
    const forwardReturnPct = ((forwardClose - close) / close) * 100;

    points.push({
      volumeScore: computeVolumeScoreProxy(close, ma20, rsi, volRatio),
      hsScore: computeHsScoreProxy(close, ma60, low60Prev, volRatio),
      ihsScore: computeIhsScoreProxy(close, ma60, high60Prev, volRatio),
      vcpScore: computeVcpScoreProxy(close, ma50, ma150, high60Prev, atr20, atr120, avgVol20, avgVol120),
      forwardReturnPct,
    });
  }

  return points;
};

export const runWalkForwardTuning = (candles: Candle[]): WalkForwardTuneResult => {
  if (candles.length < MIN_SAMPLE_BARS) {
    return {
      thresholds: DEFAULT_THRESHOLDS,
      metrics: {
        volume: {
          threshold: DEFAULT_THRESHOLDS.volume,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        hs: {
          threshold: DEFAULT_THRESHOLDS.hs,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        ihs: {
          threshold: DEFAULT_THRESHOLDS.ihs,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        vcp: {
          threshold: DEFAULT_THRESHOLDS.vcp,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
      },
      sampleCount: 0,
    };
  }

  const points = buildPoints(candles);
  if (points.length === 0) {
    return {
      thresholds: DEFAULT_THRESHOLDS,
      metrics: {
        volume: {
          threshold: DEFAULT_THRESHOLDS.volume,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        hs: {
          threshold: DEFAULT_THRESHOLDS.hs,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        ihs: {
          threshold: DEFAULT_THRESHOLDS.ihs,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
        vcp: {
          threshold: DEFAULT_THRESHOLDS.vcp,
          trades: 0,
          winRate: null,
          avgReturn: null,
          quality: 0,
        },
      },
      sampleCount: 0,
    };
  }

  const volumeMetric = pickBestMetric(
    [55, 60, 65, 70].map((threshold) =>
      evaluateThreshold(points, threshold, (point) => point.volumeScore, "bull"),
    ),
    DEFAULT_THRESHOLDS.volume,
  );
  const hsMetric = pickBestMetric(
    [58, 64, 70, 76].map((threshold) =>
      evaluateThreshold(points, threshold, (point) => point.hsScore, "bear"),
    ),
    DEFAULT_THRESHOLDS.hs,
  );
  const ihsMetric = pickBestMetric(
    [58, 64, 70, 76].map((threshold) =>
      evaluateThreshold(points, threshold, (point) => point.ihsScore, "bull"),
    ),
    DEFAULT_THRESHOLDS.ihs,
  );
  const vcpMetric = pickBestMetric(
    [72, 78, 84, 90].map((threshold) =>
      evaluateThreshold(points, threshold, (point) => point.vcpScore, "bull"),
    ),
    DEFAULT_THRESHOLDS.vcp,
  );

  return {
    thresholds: {
      volume: volumeMetric.threshold,
      hs: hsMetric.threshold,
      ihs: ihsMetric.threshold,
      vcp: vcpMetric.threshold,
    },
    metrics: {
      volume: volumeMetric,
      hs: hsMetric,
      ihs: ihsMetric,
      vcp: vcpMetric,
    },
    sampleCount: points.length,
  };
};
