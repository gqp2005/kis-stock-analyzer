import type {
  WangBaseVolumeContext,
  WangDetectorResult,
  WangRisingVolumeContext,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { WANG_VOLUME_RATIO } from "../../constants";
import { buildEvidence, clamp, emptyResult, isLocalVolumePivot } from "./common";

export const risingVolumeDetector = (
  input: WangWeeklyDetectorInput,
  metrics: WangWeeklyDetectorMetrics,
  baseVolume: WangDetectorResult<WangBaseVolumeContext>,
): WangDetectorResult<WangRisingVolumeContext> => {
  const { candles } = input;
  const latestBaseIndex = baseVolume.value.indices[baseVolume.value.indices.length - 1] ?? -1;
  if (latestBaseIndex < 0) {
    return emptyResult("risingVolume", { indices: [], count: 0 });
  }

  const referenceClose = candles[latestBaseIndex]?.close ?? 0;
  const indices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= latestBaseIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < metrics.referenceVolume * WANG_VOLUME_RATIO.risingMin) return false;
      return candle.close > referenceClose;
    })
    .map(({ index }) => index)
    .slice(-3);

  return {
    key: "risingVolume",
    ok: indices.length > 0,
    score: indices.length > 0 ? clamp(50 + indices.length * 10, 0, 90) : 0,
    confidence: indices.length > 0 ? clamp(55 + indices.length * 10, 0, 92) : 0,
    value: {
      indices,
      count: indices.length,
    },
    reasons:
      indices.length > 0
        ? ["기준거래량 이후 위쪽으로 실리는 상승거래량이 관찰됩니다."]
        : ["기준거래량 이후 상승거래량은 아직 확정되지 않았습니다."],
    evidence: indices.map((index, order) =>
      buildEvidence({
        id: `week-rising-volume-${order + 1}`,
        key: "risingVolume",
        note: "주봉 상승거래량",
        time: candles[index].time,
        price: candles[index].close,
        volume: candles[index].volume,
        weight: 72,
      }),
    ),
  };
};
