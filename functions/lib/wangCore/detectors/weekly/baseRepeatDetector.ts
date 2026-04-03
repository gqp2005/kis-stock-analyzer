import type { WangBaseVolumeContext, WangDetectorResult } from "../../types";
import { clamp, emptyResult } from "./common";

export const baseRepeatDetector = (
  baseVolume: WangDetectorResult<WangBaseVolumeContext>,
): WangDetectorResult<WangBaseVolumeContext> => {
  if (!baseVolume.ok) {
    return emptyResult("baseRepeat", baseVolume.value);
  }

  const repeatCount = baseVolume.value.repeatCount;
  return {
    key: "baseRepeat",
    ok: repeatCount >= 2,
    score: repeatCount >= 2 ? clamp(50 + repeatCount * 10, 0, 88) : 25,
    confidence: repeatCount >= 2 ? clamp(55 + repeatCount * 10, 0, 90) : 30,
    value: baseVolume.value,
    reasons:
      repeatCount >= 2
        ? [`기준거래량이 ${repeatCount}회 반복돼 왕장군 구조 설명력이 높습니다.`]
        : ["기준거래량은 포착됐지만 반복 확인은 더 필요합니다."],
    evidence: baseVolume.evidence,
  };
};
