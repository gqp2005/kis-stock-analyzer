import type { Candle } from "../../../types";
import type {
  WangDetectorResult,
  WangEvidence,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { WANG_VOLUME_RATIO, WANG_WEEKLY_RULES } from "../../constants";

export const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const bodyRatio = (candle: Candle): number => {
  const range = Math.max(candle.high - candle.low, 0.0001);
  return Math.abs(candle.close - candle.open) / range;
};

export const priceChangePct = (candles: Candle[], index: number): number => {
  if (index <= 0) return 0;
  const prev = candles[index - 1]?.close ?? 0;
  if (prev === 0) return 0;
  return ((candles[index].close - prev) / prev) * 100;
};

export const isLocalVolumePivot = (
  candles: Candle[],
  index: number,
  span = WANG_WEEKLY_RULES.basePivotSpan,
): boolean => {
  const target = candles[index]?.volume ?? 0;
  if (!target) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (candles[index - offset] && candles[index - offset].volume > target) return false;
    if (candles[index + offset] && candles[index + offset].volume > target) return false;
  }
  return true;
};

export const getWeeklyDetectorMetrics = (
  input: WangWeeklyDetectorInput,
): WangWeeklyDetectorMetrics => {
  const { candles, ma20Series = [] } = input;
  const maxVolume = candles.length > 0 ? Math.max(...candles.map((candle) => candle.volume)) : 0;
  const averageVolume = average(candles.map((candle) => candle.volume));
  const referenceVolume = maxVolume * ((WANG_VOLUME_RATIO.averageLower + WANG_VOLUME_RATIO.averageUpper) / 2);
  const ma20 = ma20Series[ma20Series.length - 1]?.value ?? null;
  const close = candles[candles.length - 1]?.close ?? null;
  return {
    maxVolume,
    averageVolume,
    referenceVolume,
    ma20,
    close,
  };
};

export const buildEvidence = (params: {
  id: string;
  key: string;
  note: string;
  time?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  price?: number | null;
  volume?: number | null;
  weight?: number;
}): WangEvidence => ({
  tf: "week",
  ...params,
});

export const emptyResult = <T>(key: string, value: T): WangDetectorResult<T> => ({
  key,
  ok: false,
  score: 0,
  confidence: 0,
  value,
  reasons: [],
  evidence: [],
});
