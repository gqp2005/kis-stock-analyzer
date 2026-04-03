import type {
  WangBaseVolumeContext,
  WangDetectorResult,
  WangLifeVolumeContext,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { WANG_VOLUME_RATIO } from "../../constants";
import { buildEvidence, clamp, emptyResult, isLocalVolumePivot } from "./common";

export interface BaseVolumeDetectorDeps {
  metrics: WangWeeklyDetectorMetrics;
  lifeVolume: WangDetectorResult<WangLifeVolumeContext>;
}

export const baseVolumeDetector = (
  input: WangWeeklyDetectorInput,
  deps: BaseVolumeDetectorDeps,
): WangDetectorResult<WangBaseVolumeContext> => {
  const { candles, ma20Series = [] } = input;
  const lifeIndex = deps.lifeVolume.value.index;
  if (candles.length === 0 || lifeIndex < 0) {
    return emptyResult("baseVolume", {
      indices: [],
      times: [],
      repeatCount: 0,
      referenceVolume: deps.metrics.referenceVolume,
      baseHalfThreshold: 0,
    });
  }

  const indices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= lifeIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < deps.metrics.referenceVolume) return false;
      if (candle.volume > deps.metrics.referenceVolume * WANG_VOLUME_RATIO.baseMax) return false;
      if (candle.volume >= deps.metrics.maxVolume * WANG_VOLUME_RATIO.baseMaxLifeCap) return false;
      const ma20 = ma20Series[index]?.value ?? null;
      return candle.close >= candle.open || (ma20 != null && candle.close >= ma20 * WANG_VOLUME_RATIO.baseCloseToMa20Buffer);
    })
    .map(({ index }) => index)
    .slice(-4);

  const times = indices.map((index) => candles[index].time);
  const firstBaseVolume = indices.length > 0 ? candles[indices[0]].volume : 0;

  return {
    key: "baseVolume",
    ok: indices.length > 0,
    score: indices.length > 0 ? clamp(35 + indices.length * 15, 0, 90) : 0,
    confidence: indices.length > 0 ? clamp(45 + indices.length * 12, 0, 92) : 0,
    value: {
      indices,
      times,
      repeatCount: indices.length,
      referenceVolume: deps.metrics.referenceVolume,
      baseHalfThreshold: firstBaseVolume * 0.5,
    },
    reasons:
      indices.length > 0
        ? [`인생거래량 이후 기준거래량이 ${indices.length}회 포착됐습니다.`]
        : ["인생거래량 이후 기준거래량이 아직 명확하지 않습니다."],
    evidence: indices.map((index, order) =>
      buildEvidence({
        id: `week-base-volume-${order + 1}`,
        key: "baseVolume",
        note: `주봉 기준거래량 ${order + 1}`,
        time: candles[index].time,
        price: candles[index].close,
        volume: candles[index].volume,
        weight: clamp(Math.round((candles[index].volume / Math.max(deps.metrics.referenceVolume, 1)) * 30), 45, 90),
      }),
    ),
  };
};
