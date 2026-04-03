import type {
  WangDetectorResult,
  WangLifeVolumeContext,
  WangWeeklyDetectorInput,
} from "../../types";
import { buildEvidence, clamp, emptyResult, getWeeklyDetectorMetrics } from "./common";

export const lifeVolumeDetector = (
  input: WangWeeklyDetectorInput,
): WangDetectorResult<WangLifeVolumeContext> => {
  const { candles } = input;
  if (candles.length === 0) {
    return emptyResult("lifeVolume", {
      index: -1,
      time: null,
      volume: null,
      direction: "MIXED",
    });
  }

  const metrics = getWeeklyDetectorMetrics(input);
  const index = candles.findIndex((candle) => candle.volume === metrics.maxVolume);
  const candle = index >= 0 ? candles[index] : null;
  const direction =
    candle == null ? "MIXED" : candle.close > candle.open ? "UP" : candle.close < candle.open ? "DOWN" : "MIXED";

  return {
    key: "lifeVolume",
    ok: index >= 0,
    score: index >= 0 ? 100 : 0,
    confidence: index >= 0 ? 96 : 0,
    value: {
      index,
      time: candle?.time ?? null,
      volume: candle?.volume ?? null,
      direction,
    },
    reasons: index >= 0 ? ["주봉 인생거래량이 구조 해석의 기준축으로 잡혔습니다."] : [],
    evidence:
      candle != null
        ? [
            buildEvidence({
              id: "week-life-volume",
              key: "lifeVolume",
              note: "주봉 인생거래량 anchor",
              time: candle.time,
              price: candle.close,
              volume: candle.volume,
              weight: clamp(Math.round((candle.volume / Math.max(metrics.averageVolume, 1)) * 12), 60, 100),
            }),
          ]
        : [],
  };
};
