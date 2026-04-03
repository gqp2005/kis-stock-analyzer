import type {
  WangAccumulationWindowContext,
  WangDetectorResult,
  WangMinVolumeRegionContext,
  WangWeeklyDetectorInput,
} from "../../types";
import { WANG_WEEKLY_RULES } from "../../constants";
import { buildEvidence, emptyResult } from "./common";

export const accumulationWindowDetector = (
  input: WangWeeklyDetectorInput,
  minRegion: WangDetectorResult<WangMinVolumeRegionContext>,
): WangDetectorResult<WangAccumulationWindowContext> => {
  const { candles } = input;
  if (!minRegion.ok || minRegion.value.startIndex < 0) {
    return emptyResult("accumulationWindow", {
      minBars: WANG_WEEKLY_RULES.minRegionPreferredBarsMin,
      maxBars: WANG_WEEKLY_RULES.minRegionPreferredBarsMax,
      activeBars: null,
      ready: false,
    });
  }

  const activeBars = candles.length - minRegion.value.startIndex;
  const ready =
    activeBars >= WANG_WEEKLY_RULES.minRegionPreferredBarsMin &&
    activeBars <= WANG_WEEKLY_RULES.minRegionPreferredBarsMax;

  return {
    key: "accumulationWindow",
    ok: ready,
    score: ready ? 84 : 40,
    confidence: ready ? 82 : 42,
    value: {
      minBars: WANG_WEEKLY_RULES.minRegionPreferredBarsMin,
      maxBars: WANG_WEEKLY_RULES.minRegionPreferredBarsMax,
      activeBars,
      ready,
    },
    reasons: ready ? ["최소거래량 구간 진입 후 3~6개월 적립 창이 확보됐습니다."] : ["최소거래량 이후 기간 조정은 더 필요합니다."],
    evidence: [
      buildEvidence({
        id: "week-accumulation-window",
        key: "accumulationWindow",
        note: "최소거래량 이후 3~6개월 기간 조정 창",
        startTime: minRegion.value.startTime,
        endTime: candles[candles.length - 1]?.time ?? null,
        weight: ready ? 84 : 40,
      }),
    ],
  };
};
