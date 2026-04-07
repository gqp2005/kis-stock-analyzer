import type {
  WangDetectorResult,
  WangMinVolumePointContext,
  WangMinVolumeRegionContext,
  WangWeeklyDetectorInput,
} from "../../types";
import { buildEvidence, emptyResult } from "./common";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const toKstDate = (date: Date): Date => new Date(date.getTime() + KST_OFFSET_MS);

const formatKstDate = (date = new Date()): string => {
  const kst = toKstDate(date);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const currentKstInfo = (date = new Date()): { ymd: string } => {
  const kst = toKstDate(date);
  return {
    ymd: formatKstDate(date),
  };
};

const isoWeekId = (dateText: string): string => {
  const [y, m, d] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const shouldExcludeLatestWeeklyCandle = (latestTime: string | null | undefined, now = new Date()): boolean => {
  if (!latestTime) return false;
  const { ymd } = currentKstInfo(now);
  return isoWeekId(latestTime.slice(0, 10)) === isoWeekId(ymd);
};

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

  const effectiveEndIndex =
    shouldExcludeLatestWeeklyCandle(candles[candles.length - 1]?.time) && endIndex === candles.length - 1
      ? endIndex - 1
      : endIndex;
  if (effectiveEndIndex < startIndex) {
    return emptyResult("minVolumePoint", {
      index: -1,
      time: null,
      volume: null,
      low: null,
      high: null,
    });
  }

  let selectedIndex = startIndex;
  for (let index = startIndex + 1; index <= effectiveEndIndex; index += 1) {
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
