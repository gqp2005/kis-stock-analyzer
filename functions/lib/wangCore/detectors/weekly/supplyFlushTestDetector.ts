import type {
  WangDetectorResult,
  WangPitDiggingContext,
  WangSupplyFlushTestContext,
  WangWeeklyDetectorInput,
} from "../../types";
import { WANG_WEEKLY_RULES } from "../../constants";
import { buildEvidence, emptyResult } from "./common";

export const supplyFlushTestDetector = (
  input: WangWeeklyDetectorInput,
  pitDigging: WangDetectorResult<WangPitDiggingContext>,
): WangDetectorResult<WangSupplyFlushTestContext> => {
  const { candles } = input;
  const pitIndex = pitDigging.value.index;
  if (!pitDigging.ok || pitIndex < 0) {
    return emptyResult("supplyFlushTest", {
      detected: false,
      index: -1,
      time: null,
      flushedSupplyPct: null,
    });
  }

  const pitCandle = candles[pitIndex];
  let recoveryIndex = -1;
  for (
    let index = pitIndex + 1;
    index < candles.length && index <= pitIndex + WANG_WEEKLY_RULES.supplyFlushRecoveryBars;
    index += 1
  ) {
    const close = candles[index].close;
    const recoveryRatio =
      (close - pitCandle.low) / Math.max(pitCandle.high - pitCandle.low, 0.0001);
    if (recoveryRatio >= WANG_WEEKLY_RULES.supplyFlushRecoveryClosePct) {
      recoveryIndex = index;
      break;
    }
  }

  if (recoveryIndex < 0) {
    return emptyResult("supplyFlushTest", {
      detected: false,
      index: -1,
      time: null,
      flushedSupplyPct: null,
    });
  }

  return {
    key: "supplyFlushTest",
    ok: true,
    score: 74,
    confidence: 62,
    value: {
      detected: true,
      index: recoveryIndex,
      time: candles[recoveryIndex].time,
      flushedSupplyPct: 90,
    },
    reasons: ["굴 파기 이후 회복이 확인돼 물량 테스트 통과 가능성을 시사합니다."],
    evidence: [
      buildEvidence({
        id: "week-supply-flush-test",
        key: "supplyFlushTest",
        note: "물량 테스트 회복 확인",
        time: candles[recoveryIndex].time,
        price: candles[recoveryIndex].close,
        volume: candles[recoveryIndex].volume,
        weight: 74,
      }),
    ],
  };
};
