import type { Candle } from "../types";
import { average } from "./utils";

const QUALITY_MIN_AVG_TURNOVER_20 = 700_000_000;
const QUALITY_MAX_ZERO_VOLUME_DAYS_20 = 2;
const QUALITY_MAX_CONSECUTIVE_ZERO_VOLUME = 2;
const QUALITY_MAX_CRASH_DAYS_60 = 2;
const QUALITY_MAX_GAP_CRASH_DAYS_60 = 2;
const QUALITY_GAP_CRASH_RETURN = -0.12;
const QUALITY_DAILY_CRASH_RETURN = -0.15;

export interface QualityGateResult {
  passed: boolean;
  reasons: string[];
}

export const evaluateQualityGate = (candles: Candle[]): QualityGateResult => {
  const reasons: string[] = [];
  const sample20 = candles.slice(-20);
  const sample60 = candles.slice(-60);

  const avgTurnover20 = average(sample20.map((candle) => candle.close * candle.volume));
  if (!Number.isFinite(avgTurnover20) || avgTurnover20 < QUALITY_MIN_AVG_TURNOVER_20) {
    reasons.push("최근 20일 평균 거래대금이 낮아 유동성 필터에서 제외했습니다.");
  }

  const zeroVolumeDays20 = sample20.filter((candle) => candle.volume <= 0).length;
  if (zeroVolumeDays20 > QUALITY_MAX_ZERO_VOLUME_DAYS_20) {
    reasons.push("최근 거래정지/거래미체결 징후(0거래량 일수)가 감지되었습니다.");
  }

  let maxZeroVolumeStreak = 0;
  let zeroStreak = 0;
  for (const candle of sample20) {
    if (candle.volume <= 0) {
      zeroStreak += 1;
      maxZeroVolumeStreak = Math.max(maxZeroVolumeStreak, zeroStreak);
    } else {
      zeroStreak = 0;
    }
  }
  if (maxZeroVolumeStreak > QUALITY_MAX_CONSECUTIVE_ZERO_VOLUME) {
    reasons.push("연속 0거래량 구간이 길어 거래정지 가능성을 배제하지 못했습니다.");
  }

  let crashDays60 = 0;
  let gapCrashDays60 = 0;
  for (let i = Math.max(1, candles.length - 60); i < candles.length; i += 1) {
    const prevClose = candles[i - 1].close;
    const candle = candles[i];
    if (!Number.isFinite(prevClose) || prevClose <= 0) continue;
    const dayReturn = candle.close / prevClose - 1;
    const gapReturn = candle.open / prevClose - 1;
    if (dayReturn <= QUALITY_DAILY_CRASH_RETURN) crashDays60 += 1;
    if (gapReturn <= QUALITY_GAP_CRASH_RETURN) gapCrashDays60 += 1;
  }
  if (crashDays60 >= QUALITY_MAX_CRASH_DAYS_60) {
    reasons.push("최근 60일 급락 일봉이 반복되어 품질 필터에서 제외했습니다.");
  }
  if (gapCrashDays60 >= QUALITY_MAX_GAP_CRASH_DAYS_60) {
    reasons.push("최근 60일 갭하락 급락이 반복되어 품질 필터에서 제외했습니다.");
  }

  const noTradeLikeDays = sample60.filter(
    (candle) =>
      candle.volume <= 0 &&
      Math.abs(candle.high - candle.low) < 1e-8 &&
      Math.abs(candle.close - candle.open) < 1e-8,
  ).length;
  if (noTradeLikeDays >= 3) {
    reasons.push("거래정지성 캔들(무거래/가격정지)이 반복되어 제외했습니다.");
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
};
