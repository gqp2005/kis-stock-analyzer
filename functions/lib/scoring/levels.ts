import type { Candle, TradePlan } from "../types";
import { round2 } from "../utils";
import { pickNearestAbove, pickNearestBelow } from "./utils";

export const pivotLevels = (prevBar: Candle): number[] => {
  const p = (prevBar.high + prevBar.low + prevBar.close) / 3;
  const s1 = 2 * p - prevBar.high;
  const s2 = p - (prevBar.high - prevBar.low);
  const r1 = 2 * p - prevBar.low;
  const r2 = p + (prevBar.high - prevBar.low);

  return [p, s1, s2, r1, r2].filter((value) => Number.isFinite(value));
};

export const swingCandidates = (
  candles: Candle[],
  currentClose: number,
  lookback = 60,
  l = 3,
): { support: number | null; resistance: number | null } => {
  const sample = candles.slice(-lookback);
  if (sample.length < l * 2 + 1) {
    return { support: null, resistance: null };
  }

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = l; i < sample.length - l; i += 1) {
    const high = sample[i].high;
    const low = sample[i].low;
    let isHigh = true;
    let isLow = true;

    for (let j = i - l; j <= i + l; j += 1) {
      if (j === i) continue;
      if (sample[j].high >= high) isHigh = false;
      if (sample[j].low <= low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) swingHighs.push(high);
    if (isLow) swingLows.push(low);
  }

  return {
    support: pickNearestBelow(swingLows, currentClose),
    resistance: pickNearestAbove(swingHighs, currentClose),
  };
};

export const adjustSupportResistance = (
  support: number | null,
  resistance: number | null,
  currentClose: number,
  ma20: number | null,
): { support: number; resistance: number } => {
  const anchor = ma20 ?? currentClose;
  let finalSupport = support;
  let finalResistance = resistance;

  if (finalSupport == null || finalSupport >= currentClose) {
    finalSupport = Math.min(currentClose * 0.995, anchor * 0.99);
  }
  if (finalResistance == null || finalResistance <= currentClose) {
    finalResistance = Math.max(currentClose * 1.005, anchor * 1.01);
  }
  if (finalSupport >= finalResistance) {
    finalSupport = anchor * 0.99;
    finalResistance = anchor * 1.01;
  }

  return {
    support: Math.max(0, finalSupport),
    resistance: Math.max(0, finalResistance),
  };
};

export const buildTradePlan = (
  currentClose: number,
  support: number,
  resistance: number,
  atr14: number | null,
): TradePlan => {
  const atrUnit = atr14 != null && atr14 > 0 ? atr14 : currentClose * 0.02;
  let entry = currentClose;
  let stop = Math.min(support, currentClose - atrUnit);
  if (stop >= entry) stop = Math.max(0, entry - atrUnit);

  const riskPerShare = Math.max(0.0001, entry - stop);
  const baseTarget = Math.max(resistance, entry + atrUnit * 1.2);
  const rrMinTarget = entry + riskPerShare * 1.5;
  let target = Math.max(baseTarget, rrMinTarget);
  if (target <= entry) target = entry + atrUnit * 1.5;

  const rewardPerShare = Math.max(0, target - entry);
  const riskReward = rewardPerShare / riskPerShare;

  return {
    entry: round2(entry),
    stop: round2(stop),
    target: round2(target),
    riskReward: round2(riskReward),
    note: `참고 레벨입니다. 진입은 추세 확인 후, 손절은 손절가 이탈 시, 목표는 목표가 부근 분할 대응을 권장합니다.`,
  };
};
