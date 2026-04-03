import type {
  WangBaseDirectionAnchorContext,
  WangBaseVolumeContext,
  WangDetectorResult,
  WangWeeklyDetectorInput,
} from "../../types";
import { buildEvidence, emptyResult } from "./common";

export const baseDirectionAnchorDetector = (
  input: WangWeeklyDetectorInput,
  baseVolume: WangDetectorResult<WangBaseVolumeContext>,
): WangDetectorResult<WangBaseDirectionAnchorContext> => {
  const { candles } = input;
  const anchorIndex = baseVolume.value.indices[0] ?? -1;
  if (anchorIndex < 0 || !candles[anchorIndex]) {
    return emptyResult("baseDirectionAnchor", {
      anchorIndex: -1,
      anchorTime: null,
      anchorOpen: null,
      anchorClose: null,
      assumedDirection: "SIDEWAYS",
    });
  }

  const candle = candles[anchorIndex];
  const assumedDirection =
    candle.close > candle.open ? "UP" : candle.close < candle.open ? "DOWN" : "SIDEWAYS";

  return {
    key: "baseDirectionAnchor",
    ok: true,
    score: 70,
    confidence: 72,
    value: {
      anchorIndex,
      anchorTime: candle.time,
      anchorOpen: candle.open,
      anchorClose: candle.close,
      assumedDirection,
    },
    reasons: ["첫 기준거래량 시초값을 방향성 anchor로 사용할 수 있습니다."],
    evidence: [
      buildEvidence({
        id: "week-base-direction-anchor",
        key: "baseDirectionAnchor",
        note: "기준거래량 시초값 기반 방향 anchor",
        time: candle.time,
        price: candle.open,
        volume: candle.volume,
        weight: 70,
      }),
    ],
  };
};
