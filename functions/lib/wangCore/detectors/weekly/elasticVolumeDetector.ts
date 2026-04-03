import type {
  WangBaseVolumeContext,
  WangDetectorResult,
  WangElasticVolumeContext,
  WangRisingVolumeContext,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { WANG_VOLUME_RATIO, WANG_WEEKLY_RULES } from "../../constants";
import { bodyRatio, buildEvidence, clamp, emptyResult, priceChangePct } from "./common";

export const elasticVolumeDetector = (
  input: WangWeeklyDetectorInput,
  metrics: WangWeeklyDetectorMetrics,
  baseVolume: WangDetectorResult<WangBaseVolumeContext>,
  risingVolume: WangDetectorResult<WangRisingVolumeContext>,
): WangDetectorResult<WangElasticVolumeContext> => {
  const { candles } = input;
  const latestBaseIndex = baseVolume.value.indices[baseVolume.value.indices.length - 1] ?? -1;
  const latestRisingIndex = risingVolume.value.indices[risingVolume.value.indices.length - 1] ?? -1;
  const searchStart = Math.max(latestBaseIndex, latestRisingIndex);
  const latestRisingVolume = latestRisingIndex >= 0 ? candles[latestRisingIndex]?.volume ?? 0 : 0;
  const latestRisingClose = latestRisingIndex >= 0 ? candles[latestRisingIndex]?.close ?? 0 : 0;
  if (searchStart < 0) {
    return emptyResult("elasticVolume", { indices: [], count: 0, firstElasticIndex: -1 });
  }

  const indices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= searchStart) return false;
      if (candle.volume < metrics.referenceVolume * WANG_VOLUME_RATIO.elasticMin) return false;
      if (latestRisingVolume > 0) {
        if (candle.volume < latestRisingVolume * WANG_VOLUME_RATIO.elasticVsRisingMin) return false;
        if (candle.volume > latestRisingVolume * WANG_VOLUME_RATIO.elasticVsRisingMax) return false;
      }
      if (bodyRatio(candle) < WANG_WEEKLY_RULES.elasticBodyRatio) return false;
      if (candle.close <= latestRisingClose) return false;
      return priceChangePct(candles, index) >= WANG_WEEKLY_RULES.elasticRisePct;
    })
    .map(({ index }) => index)
    .slice(-2);

  return {
    key: "elasticVolume",
    ok: indices.length > 0,
    score: indices.length > 0 ? clamp(55 + indices.length * 12, 0, 92) : 0,
    confidence: indices.length > 0 ? clamp(60 + indices.length * 12, 0, 95) : 0,
    value: {
      indices,
      count: indices.length,
      firstElasticIndex: indices[0] ?? -1,
    },
    reasons:
      indices.length > 0
        ? ["상승거래량 이후 탄력거래량이 확인돼 시장 심리가 다시 가벼워졌습니다."]
        : ["탄력거래량은 아직 뚜렷하지 않습니다."],
    evidence: indices.map((index, order) =>
      buildEvidence({
        id: `week-elastic-volume-${order + 1}`,
        key: "elasticVolume",
        note: "주봉 탄력거래량",
        time: candles[index].time,
        price: candles[index].close,
        volume: candles[index].volume,
        weight: 80,
      }),
    ),
  };
};
