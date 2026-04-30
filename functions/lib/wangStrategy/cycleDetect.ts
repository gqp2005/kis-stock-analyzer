import type { Candle, IndicatorPoint } from "../types";
import type {
  WangStrategyChartTimeframe,
  WangStrategyPhase,
} from "../wangTypes";
import { WANG_STRATEGY_CONSTANTS } from "../wangStrategyConstants";
import {
  average,
  bodyRatio,
  computeRelativeShortVolumeScore,
  findLowestVolumeIndexAfter,
  findMajorVolumePivotIndices,
  isLocalVolumePivot,
  isRecentRetest,
  percentDiff,
  priceChangePct,
  shouldExcludeLatestMinCandidate,
} from "./utils";

export interface WangCycleDetection {
  tf: WangStrategyChartTimeframe;
  candles: Candle[];
  ma20Series: IndicatorPoint[];
  maxVolume: number;
  averageVolume: number;
  referenceVolume: number;
  close: number;
  ma20: number | null;
  belowMa20: boolean;
  ma20DistancePct: number | null;
  lifeIndex: number;
  primaryVolumeIndex: number;
  baseIndices: number[];
  risingIndices: number[];
  elasticIndices: number[];
  minIndex: number;
  minVolume: number | null;
  relativeShortVolumeScore: number;
  cooldownBarsFromLife: number | null;
  cooldownReady: boolean;
  secondSurgeIndex: number;
  halfExitIndex: number;
  recentHalfExitWarning: boolean;
  zoneStartIndex: number;
  zoneEndIndex: number;
  zoneLow: number | null;
  zoneHigh: number | null;
  retestIndices: number[];
  latestRetestIndex: number;
  inZone: boolean;
  brokeZone: boolean;
  farAboveZone: boolean;
  currentPhase: WangStrategyPhase;
}

export const detectVolumeCycle = (
  tf: WangStrategyChartTimeframe,
  candles: Candle[],
  ma20Series: IndicatorPoint[],
): WangCycleDetection => {
  if (candles.length === 0) {
    return {
      tf,
      candles,
      ma20Series,
      maxVolume: 0,
      averageVolume: 0,
      referenceVolume: 0,
      close: 0,
      ma20: null,
      belowMa20: false,
      ma20DistancePct: null,
      lifeIndex: -1,
      primaryVolumeIndex: -1,
      baseIndices: [],
      risingIndices: [],
      elasticIndices: [],
      minIndex: -1,
      minVolume: null,
      relativeShortVolumeScore: 0,
      cooldownBarsFromLife: null,
      cooldownReady: false,
      secondSurgeIndex: -1,
      halfExitIndex: -1,
      recentHalfExitWarning: false,
      zoneStartIndex: -1,
      zoneEndIndex: -1,
      zoneLow: null,
      zoneHigh: null,
      retestIndices: [],
      latestRetestIndex: -1,
      inZone: false,
      brokeZone: false,
      farAboveZone: false,
      currentPhase: "NONE",
    };
  }

  const close = candles[candles.length - 1].close;
  const ma20 = ma20Series[ma20Series.length - 1]?.value ?? null;
  const belowMa20 = ma20 != null ? close <= ma20 : false;
  const ma20DistancePct = percentDiff(close, ma20);
  const maxVolume = Math.max(...candles.map((candle) => candle.volume));
  const averageVolume = average(candles.map((candle) => candle.volume));
  const referenceVolume = maxVolume * WANG_STRATEGY_CONSTANTS.referenceVolumeRatio;
  const lifeIndex = candles.findIndex((candle) => candle.volume === maxVolume);
  const majorVolumePivotIndices = findMajorVolumePivotIndices(candles, averageVolume);
  const primaryVolumeIndex = majorVolumePivotIndices[0] ?? lifeIndex;

  const baseIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= primaryVolumeIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.baseVolumeMinRatio) return false;
      if (candle.volume >= maxVolume * 0.98) return false;
      const ma20Point = ma20Series[index]?.value ?? null;
      return candle.close >= candle.open || (ma20Point != null && candle.close >= ma20Point * 0.98);
    })
    .map(({ index }) => index)
    .slice(-4);

  const latestBaseIndex = baseIndices.length > 0 ? baseIndices[baseIndices.length - 1] : -1;

  const risingIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= latestBaseIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.risingVolumeMinRatio) return false;
      const referenceClose = latestBaseIndex >= 0 ? candles[latestBaseIndex].close : candles[Math.max(index - 1, 0)].close;
      return candle.close > referenceClose;
    })
    .map(({ index }) => index)
    .slice(-3);

  const latestRisingIndex = risingIndices.length > 0 ? risingIndices[risingIndices.length - 1] : -1;
  const elasticStartIndex = Math.max(latestRisingIndex, latestBaseIndex);

  const elasticIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= elasticStartIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.elasticVolumeMinRatio) return false;
      if (bodyRatio(candle) < WANG_STRATEGY_CONSTANTS.elasticBodyRatio) return false;
      return priceChangePct(candles, index) >= WANG_STRATEGY_CONSTANTS.elasticRisePct;
    })
    .map(({ index }) => index)
    .slice(-2);

  const latestElasticIndex = elasticIndices.length > 0 ? elasticIndices[elasticIndices.length - 1] : -1;
  const minSearchStartIndex =
    latestElasticIndex >= 0 ? latestElasticIndex : latestRisingIndex >= 0 ? latestRisingIndex : latestBaseIndex;
  const excludeLatestMinCandidate = shouldExcludeLatestMinCandidate(tf, candles);

  const minIndex = findLowestVolumeIndexAfter(candles, minSearchStartIndex, {
    excludeLastIndex: excludeLatestMinCandidate,
  });
  const minVolume = minIndex >= 0 ? candles[minIndex].volume : null;
  const relativeShortVolumeScore = computeRelativeShortVolumeScore(minVolume, averageVolume);
  const cooldownBarsFromLife =
    minIndex >= 0 && primaryVolumeIndex >= 0 && minIndex > primaryVolumeIndex ? minIndex - primaryVolumeIndex : null;
  const cooldownReady =
    cooldownBarsFromLife != null &&
    cooldownBarsFromLife >= WANG_STRATEGY_CONSTANTS.minCooldownBarsAfterLife;
  const surgeSearchStartIndex = Math.max(primaryVolumeIndex, minIndex);
  const secondSurgeIndex =
    primaryVolumeIndex >= 0
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= surgeSearchStartIndex) return false;
            if (!isLocalVolumePivot(candles, index)) return false;
            if (
              candle.volume <
              candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.secondSurgeBreakoutRatio
            ) {
              return false;
            }
            return (
              candle.close >=
              candles[primaryVolumeIndex].high * (1 + WANG_STRATEGY_CONSTANTS.secondSurgePriceBufferPct)
            );
          })
          .map(({ index }) => index)[0] ?? -1
      : -1;
  const halfExitIndex =
    primaryVolumeIndex >= 0
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= surgeSearchStartIndex) return false;
            if (!isLocalVolumePivot(candles, index)) return false;
            if (
              candle.volume <
                candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.halfMaxExitLowerRatio ||
              candle.volume >
                candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.halfMaxExitUpperRatio
            ) {
              return false;
            }
            return secondSurgeIndex < 0 || index >= secondSurgeIndex;
          })
          .map(({ index }) => index)
          .slice(-1)[0] ?? -1
      : -1;
  const recentHalfExitWarning =
    halfExitIndex >= 0 && candles.length - 1 - halfExitIndex <= WANG_STRATEGY_CONSTANTS.halfMaxExitRecentBars;
  const zoneStartIndex = minIndex >= 0 ? Math.min(candles.length - 1, minIndex + 1) : -1;
  const zoneEndIndex =
    zoneStartIndex >= 0
      ? Math.min(candles.length - 1, zoneStartIndex + WANG_STRATEGY_CONSTANTS.zoneBuildBars - 1)
      : -1;
  const zoneCandles = zoneStartIndex >= 0 ? candles.slice(zoneStartIndex, zoneEndIndex + 1) : [];
  const zoneLow = zoneCandles.length > 0 ? Math.min(...zoneCandles.map((candle) => candle.low)) : null;
  const zoneHigh = zoneCandles.length > 0 ? Math.max(...zoneCandles.map((candle) => candle.high)) : null;

  const retestIndices =
    zoneLow != null && zoneHigh != null
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= zoneEndIndex) return false;
            const touchesUpper = candle.low <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            const holdsLower = candle.high >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            return touchesUpper && holdsLower;
          })
          .map(({ index }) => index)
      : [];

  const latestRetestIndex = retestIndices.length > 0 ? retestIndices[retestIndices.length - 1] : -1;
  const inZone =
    zoneLow != null && zoneHigh != null
      ? close >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct) &&
        close <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct)
      : false;
  const brokeZone =
    zoneLow != null ? close < zoneLow * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct) : false;
  const farAboveZone =
    zoneHigh != null ? close > zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.overheatFromZonePct) : false;

  let currentPhase: WangStrategyPhase = "NONE";
  if (latestRetestIndex >= 0 && (inZone || isRecentRetest(candles, latestRetestIndex))) currentPhase = "REACCUMULATION";
  else if (minIndex >= 0) currentPhase = "MIN_VOLUME";
  else if (latestElasticIndex >= 0) currentPhase = "ELASTIC_VOLUME";
  else if (latestRisingIndex >= 0) currentPhase = "RISING_VOLUME";
  else if (latestBaseIndex >= 0) currentPhase = "BASE_VOLUME";
  else if (lifeIndex >= 0) currentPhase = "LIFE_VOLUME";

  return {
    tf,
    candles,
    ma20Series,
    maxVolume,
    averageVolume,
    referenceVolume,
    close,
    ma20,
    belowMa20,
    ma20DistancePct,
    lifeIndex,
    primaryVolumeIndex,
    baseIndices,
    risingIndices,
    elasticIndices,
    minIndex,
    minVolume,
    relativeShortVolumeScore,
    cooldownBarsFromLife,
    cooldownReady,
    secondSurgeIndex,
    halfExitIndex,
    recentHalfExitWarning,
    zoneStartIndex,
    zoneEndIndex,
    zoneLow,
    zoneHigh,
    retestIndices,
    latestRetestIndex,
    inZone,
    brokeZone,
    farAboveZone,
    currentPhase,
  };
};
