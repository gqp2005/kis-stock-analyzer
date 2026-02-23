import type { Candle } from "./types";

export const sma = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
};

export const ema = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  if (values.length < period) return out;

  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  let prev = seed;
  out[period - 1] = seed;

  for (let i = period; i < values.length; i += 1) {
    prev = (values[i] - prev) * alpha + prev;
    out[i] = prev;
  }

  return out;
};

const emaFromNullable = (values: Array<number | null>, period: number): Array<number | null> => {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return out;

  let window: number[] = [];
  let prev: number | null = null;
  const alpha = 2 / (period + 1);

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) {
      window = [];
      prev = null;
      continue;
    }

    if (prev == null) {
      window.push(value);
      if (window.length < period) continue;
      if (window.length === period) {
        prev = window.reduce((sum, item) => sum + item, 0) / period;
        out[i] = prev;
      }
      continue;
    }

    prev = (value - prev) * alpha + prev;
    out[i] = prev;
  }

  return out;
};

export const macd = (
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  line: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
} => {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const line = closes.map((_, index) => {
    if (fast[index] == null || slow[index] == null) return null;
    return (fast[index] as number) - (slow[index] as number);
  });
  const signal = emaFromNullable(line, signalPeriod);
  const hist = closes.map((_, index) => {
    if (line[index] == null || signal[index] == null) return null;
    return (line[index] as number) - (signal[index] as number);
  });
  return { line, signal, hist };
};

export const rsi = (closes: number[], period = 14): Array<number | null> => {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum += Math.abs(delta);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
};

export const bollingerBands = (
  closes: number[],
  period = 20,
  stdevMul = 2,
): {
  mid: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
} => {
  const mid = sma(closes, period);
  const upper: Array<number | null> = Array(closes.length).fill(null);
  const lower: Array<number | null> = Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i += 1) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i] as number;
    const variance = slice.reduce((acc, value) => acc + (value - mean) ** 2, 0) / period;
    const stdev = Math.sqrt(variance);

    upper[i] = mean + stdevMul * stdev;
    lower[i] = mean - stdevMul * stdev;
  }

  return { mid, upper, lower };
};

export const atr = (candles: Candle[], period = 14): Array<number | null> => {
  const out: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length === 0) return out;

  const tr = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const prevClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose),
    );
  });

  if (candles.length < period) return out;

  let atrValue = tr.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = atrValue;

  for (let i = period; i < candles.length; i += 1) {
    atrValue = (atrValue * (period - 1) + tr[i]) / period;
    out[i] = atrValue;
  }

  return out;
};
