import type {
  WangBaseVolumeContext,
  WangDetectorResult,
  WangElasticVolumeContext,
  WangMinVolumeRegionContext,
  WangRisingVolumeContext,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { buildEvidence, emptyResult } from "./common";

export const minVolumeRegionDetector = (
  input: WangWeeklyDetectorInput,
  metrics: WangWeeklyDetectorMetrics,
  baseVolume: WangDetectorResult<WangBaseVolumeContext>,
  risingVolume: WangDetectorResult<WangRisingVolumeContext>,
  elasticVolume: WangDetectorResult<WangElasticVolumeContext>,
): WangDetectorResult<WangMinVolumeRegionContext> => {
  const { candles } = input;
  const latestBaseIndex = baseVolume.value.indices[baseVolume.value.indices.length - 1] ?? -1;
  const latestRisingIndex = risingVolume.value.indices[risingVolume.value.indices.length - 1] ?? -1;
  const latestElasticIndex = elasticVolume.value.indices[elasticVolume.value.indices.length - 1] ?? -1;
  const searchStart = Math.max(latestBaseIndex, latestRisingIndex, latestElasticIndex);
  if (searchStart < 0) {
    return emptyResult("minVolumeRegion", {
      startIndex: -1,
      endIndex: -1,
      startTime: null,
      endTime: null,
      durationBars: 0,
      thresholdVolume: null,
    });
  }

  const thresholdVolume = Math.max(metrics.referenceVolume, baseVolume.value.baseHalfThreshold || 0);
  const candidateIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => index > searchStart && candle.volume <= thresholdVolume)
    .map(({ index }) => index);

  if (candidateIndices.length === 0) {
    return emptyResult("minVolumeRegion", {
      startIndex: -1,
      endIndex: -1,
      startTime: null,
      endTime: null,
      durationBars: 0,
      thresholdVolume,
    });
  }

  const startIndex = candidateIndices[0];
  const endIndex = candidateIndices[candidateIndices.length - 1];
  return {
    key: "minVolumeRegion",
    ok: true,
    score: 78,
    confidence: 80,
    value: {
      startIndex,
      endIndex,
      startTime: candles[startIndex].time,
      endTime: candles[endIndex].time,
      durationBars: endIndex - startIndex + 1,
      thresholdVolume,
    },
    reasons: ["기준거래량 이후 거래량 바닥권에 진입해 최소거래량 구간 후보가 형성됐습니다."],
    evidence: [
      buildEvidence({
        id: "week-min-region",
        key: "minVolumeRegion",
        note: "주봉 최소거래량 구간",
        startTime: candles[startIndex].time,
        endTime: candles[endIndex].time,
        volume: thresholdVolume,
        weight: 78,
      }),
    ],
  };
};
