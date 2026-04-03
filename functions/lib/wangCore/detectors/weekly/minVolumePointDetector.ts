import type {
  WangDetectorResult,
  WangMinVolumePointContext,
  WangMinVolumeRegionContext,
  WangWeeklyDetectorInput,
} from "../../types";
import { buildEvidence, emptyResult } from "./common";

export const minVolumePointDetector = (
  input: WangWeeklyDetectorInput,
  minRegion: WangDetectorResult<WangMinVolumeRegionContext>,
): WangDetectorResult<WangMinVolumePointContext> => {
  const { candles } = input;
  const startIndex = minRegion.value.startIndex;
  const endIndex = minRegion.value.endIndex;
  if (!minRegion.ok || startIndex < 0 || endIndex < startIndex) {
    return emptyResult("minVolumePoint", {
      index: -1,
      time: null,
      volume: null,
      low: null,
      high: null,
    });
  }

  let selectedIndex = startIndex;
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    if (candles[index].volume < candles[selectedIndex].volume) {
      selectedIndex = index;
      continue;
    }
    if (candles[index].volume === candles[selectedIndex].volume && index > selectedIndex) {
      selectedIndex = index;
    }
  }

  const candle = candles[selectedIndex];
  return {
    key: "minVolumePoint",
    ok: true,
    score: 92,
    confidence: 94,
    value: {
      index: selectedIndex,
      time: candle.time,
      volume: candle.volume,
      low: candle.low,
      high: candle.high,
    },
    reasons: ["최소거래량 구간 안에서 절대 최저 거래량 점이 확인됐습니다."],
    evidence: [
      buildEvidence({
        id: "week-min-point",
        key: "minVolumePoint",
        note: "주봉 최소거래량 점",
        time: candle.time,
        price: candle.close,
        volume: candle.volume,
        weight: 92,
      }),
    ],
  };
};
