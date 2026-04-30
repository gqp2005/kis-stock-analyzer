import type { Candle } from "../types";
import type { WangStrategyChartTimeframe } from "../wangTypes";
import { clamp, round2 } from "../utils";
import { WANG_STRATEGY_CONSTANTS } from "../wangStrategyConstants";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const toKstDate = (date: Date): Date => new Date(date.getTime() + KST_OFFSET_MS);

export const formatKstDate = (date = new Date()): string => {
  const kst = toKstDate(date);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const currentKstDayInfo = (date = new Date()): { ymd: string } => ({
  ymd: formatKstDate(date),
});

export const isoWeekId = (dateText: string): string => {
  const [y, m, d] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

export const bodyRatio = (candle: Candle): number => {
  const range = Math.max(candle.high - candle.low, 0.0001);
  return Math.abs(candle.close - candle.open) / range;
};

export const percentDiff = (value: number, reference: number | null): number | null => {
  if (reference == null || reference === 0) return null;
  return ((value - reference) / reference) * 100;
};

export const priceChangePct = (candles: Candle[], index: number): number => {
  if (index <= 0) return 0;
  const prev = candles[index - 1]?.close ?? 0;
  if (prev === 0) return 0;
  return ((candles[index].close - prev) / prev) * 100;
};

export const isLocalVolumePivot = (candles: Candle[], index: number, span = 2): boolean => {
  const target = candles[index]?.volume ?? 0;
  if (!target) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (candles[index - offset] && candles[index - offset].volume > target) return false;
    if (candles[index + offset] && candles[index + offset].volume > target) return false;
  }
  return true;
};

export const findMajorVolumePivotIndices = (
  candles: Candle[],
  averageVolume: number,
): number[] =>
  candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (!isLocalVolumePivot(candles, index)) return false;
      return candle.volume >= averageVolume * WANG_STRATEGY_CONSTANTS.majorVolumePivotAverageMultiple;
    })
    .map(({ index }) => index);

export const shouldExcludeLatestMinCandidate = (
  tf: WangStrategyChartTimeframe,
  candles: Candle[],
  now = new Date(),
): boolean => {
  if (candles.length === 0) return false;
  const latestTime = candles[candles.length - 1]?.time?.slice(0, 10);
  if (!latestTime) return false;

  const { ymd } = currentKstDayInfo(now);

  if (tf === "day") {
    return latestTime === ymd;
  }

  if (tf === "week") {
    return isoWeekId(latestTime) === isoWeekId(ymd);
  }

  return false;
};

export const findLowestVolumeIndexAfter = (
  candles: Candle[],
  startIndex: number,
  options?: { excludeLastIndex?: boolean },
): number => {
  const endExclusive = options?.excludeLastIndex ? candles.length - 1 : candles.length;
  if (startIndex < 0 || startIndex >= endExclusive - 1) return -1;

  let selectedIndex = -1;
  for (let index = startIndex + 1; index < endExclusive; index += 1) {
    const volume = candles[index]?.volume ?? 0;
    if (volume <= 0) continue;
    if (selectedIndex < 0 || volume < candles[selectedIndex].volume) {
      selectedIndex = index;
      continue;
    }
    if (volume === candles[selectedIndex].volume && index > selectedIndex) {
      selectedIndex = index;
    }
  }

  return selectedIndex;
};

export const computeRelativeShortVolumeScore = (
  minVolume: number | null,
  averageVolume: number,
): number => {
  if (minVolume == null || averageVolume <= 0) return 0;
  const compression = minVolume / averageVolume;
  return clamp(Math.round((1 - Math.min(compression, 1)) * 100), 0, 100);
};

export const toRoundedNumber = (value: number): number => round2(value) ?? value;

export const findBarIndexOnOrAfter = (candles: Candle[], time: string): number => {
  const index = candles.findIndex((candle) => candle.time >= time);
  return index >= 0 ? index : 0;
};

export const isRecentRetest = (candles: Candle[], index: number): boolean =>
  index >= 0 && candles.length - 1 - index <= WANG_STRATEGY_CONSTANTS.activeRetestLookbackBars;
