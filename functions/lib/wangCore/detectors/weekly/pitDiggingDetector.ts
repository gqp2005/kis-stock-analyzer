import type {
  WangDetectorResult,
  WangMinVolumeRegionContext,
  WangPitDiggingContext,
  WangWeeklyDetectorInput,
  WangWeeklyDetectorMetrics,
} from "../../types";
import { WANG_WEEKLY_RULES } from "../../constants";
import { buildEvidence, emptyResult } from "./common";

export const pitDiggingDetector = (
  input: WangWeeklyDetectorInput,
  metrics: WangWeeklyDetectorMetrics,
  minRegion: WangDetectorResult<WangMinVolumeRegionContext>,
): WangDetectorResult<WangPitDiggingContext> => {
  const { candles } = input;
  const startIndex = minRegion.value.startIndex;
  if (!minRegion.ok || startIndex < 0) {
    return emptyResult("pitDigging", {
      detected: false,
      index: -1,
      time: null,
      flushDepthPct: null,
    });
  }

  let detectedIndex = -1;
  let flushDepthPct: number | null = null;
  for (let index = startIndex + 1; index < candles.length; index += 1) {
    const windowStart = Math.max(startIndex, index - WANG_WEEKLY_RULES.pitDiggingRangeLookback);
    const priorLows = candles.slice(windowStart, index).map((candle) => candle.low);
    if (priorLows.length === 0) continue;
    const priorLow = Math.min(...priorLows);
    const candle = candles[index];
    if (candle.low >= priorLow) continue;
    if (candle.volume > metrics.referenceVolume * WANG_WEEKLY_RULES.pitDiggingVolumeCapRatio) continue;
    detectedIndex = index;
    flushDepthPct = ((priorLow - candle.low) / Math.max(priorLow, 0.0001)) * 100;
  }

  if (detectedIndex < 0) {
    return emptyResult("pitDigging", {
      detected: false,
      index: -1,
      time: null,
      flushDepthPct: null,
    });
  }

  return {
    key: "pitDigging",
    ok: true,
    score: 76,
    confidence: 68,
    value: {
      detected: true,
      index: detectedIndex,
      time: candles[detectedIndex].time,
      flushDepthPct,
    },
    reasons: ["최소거래량 이후 급등 전의 의미 없는 굴 파기 패턴이 감지됐습니다."],
    evidence: [
      buildEvidence({
        id: "week-pit-digging",
        key: "pitDigging",
        note: "급등 전 의미 없는 굴 파기",
        time: candles[detectedIndex].time,
        price: candles[detectedIndex].low,
        volume: candles[detectedIndex].volume,
        weight: 76,
      }),
    ],
  };
};
