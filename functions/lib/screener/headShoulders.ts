import { sma } from "../indicators";
import type { Candle, PatternHit } from "../types";
import { clamp } from "../utils";
import { defaultPatternHit } from "./defaults";
import { toNullableRounded } from "./utils";

const SWING_LOOKBACK = 120;
const SWING_LEFT_RIGHT = 3;
const HS_HEAD_MIN_GAP = 0.03;
const HS_SHOULDER_MAX_DIFF = 0.04;

interface PatternCandidate {
  hit: PatternHit;
  recencyScore: number;
}

const getSwingHighs = (
  candles: Candle[],
  leftRight: number,
): Array<{ index: number; price: number; time: string }> => {
  const swings: Array<{ index: number; price: number; time: string }> = [];
  for (let i = leftRight; i < candles.length - leftRight; i += 1) {
    const current = candles[i].high;
    let isSwing = true;
    for (let j = i - leftRight; j <= i + leftRight; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({ index: i, price: current, time: candles[i].time });
    }
  }
  return swings;
};

const getSwingLows = (
  candles: Candle[],
  leftRight: number,
): Array<{ index: number; price: number; time: string }> => {
  const swings: Array<{ index: number; price: number; time: string }> = [];
  for (let i = leftRight; i < candles.length - leftRight; i += 1) {
    const current = candles[i].low;
    let isSwing = true;
    for (let j = i - leftRight; j <= i + leftRight; j += 1) {
      if (j === i) continue;
      if (candles[j].low <= current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({ index: i, price: current, time: candles[i].time });
    }
  }
  return swings;
};

const findLowestBetween = (
  candles: Candle[],
  startIdx: number,
  endIdx: number,
): { index: number; price: number; time: string } | null => {
  if (endIdx - startIdx < 2) return null;
  let minPrice = Number.POSITIVE_INFINITY;
  let minIdx = -1;
  for (let i = startIdx + 1; i < endIdx; i += 1) {
    if (candles[i].low < minPrice) {
      minPrice = candles[i].low;
      minIdx = i;
    }
  }
  if (minIdx < 0) return null;
  return { index: minIdx, price: minPrice, time: candles[minIdx].time };
};

const findHighestBetween = (
  candles: Candle[],
  startIdx: number,
  endIdx: number,
): { index: number; price: number; time: string } | null => {
  if (endIdx - startIdx < 2) return null;
  let maxPrice = Number.NEGATIVE_INFINITY;
  let maxIdx = -1;
  for (let i = startIdx + 1; i < endIdx; i += 1) {
    if (candles[i].high > maxPrice) {
      maxPrice = candles[i].high;
      maxIdx = i;
    }
  }
  if (maxIdx < 0) return null;
  return { index: maxIdx, price: maxPrice, time: candles[maxIdx].time };
};

const getVolRatioSeries = (candles: Candle[]): number[] => {
  const volumes = candles.map((candle) => candle.volume);
  const volMa20 = sma(volumes, 20);
  return candles.map((candle, index) => {
    const ma = volMa20[index];
    if (ma == null || ma <= 0) return 1;
    return candle.volume / ma;
  });
};

const getHeadShouldersCandidates = (candles: Candle[]): PatternCandidate[] => {
  if (candles.length < 80) return [];
  const offset = Math.max(0, candles.length - SWING_LOOKBACK);
  const sample = candles.slice(offset);
  const highs = getSwingHighs(sample, SWING_LEFT_RIGHT);
  const volRatio = getVolRatioSeries(sample);
  const results: PatternCandidate[] = [];

  for (let i = 0; i + 2 < highs.length; i += 1) {
    const leftShoulder = highs[i];
    const head = highs[i + 1];
    const rightShoulder = highs[i + 2];

    if (head.index - leftShoulder.index < 3 || rightShoulder.index - head.index < 3) continue;

    const shoulderMax = Math.max(leftShoulder.price, rightShoulder.price);
    const headRatio = shoulderMax > 0 ? head.price / shoulderMax - 1 : 0;
    if (headRatio < HS_HEAD_MIN_GAP) continue;

    const shoulderDiff = head.price > 0 ? Math.abs(leftShoulder.price - rightShoulder.price) / head.price : 1;
    if (shoulderDiff > HS_SHOULDER_MAX_DIFF) continue;

    const valley1 = findLowestBetween(sample, leftShoulder.index, head.index);
    const valley2 = findLowestBetween(sample, head.index, rightShoulder.index);
    if (!valley1 || !valley2 || valley2.index === valley1.index) continue;

    const slope = (valley2.price - valley1.price) / (valley2.index - valley1.index);
    const necklineAt = (idx: number): number => valley1.price + slope * (idx - valley1.index);

    let breakIdx = -1;
    let breakVolRatio = 1;
    for (let idx = rightShoulder.index + 1; idx < sample.length; idx += 1) {
      if (sample[idx].close < necklineAt(idx) && volRatio[idx] >= 1.2) {
        breakIdx = idx;
        breakVolRatio = volRatio[idx];
        break;
      }
    }

    const state = breakIdx >= 0 ? "CONFIRMED" : "POTENTIAL";
    const referenceIndex = breakIdx >= 0 ? breakIdx : sample.length - 1;
    const necklineRef = necklineAt(referenceIndex);
    const headNeckGap = head.price - necklineAt(head.index);
    const target = necklineRef - headNeckGap;
    const spanSymmetry =
      Math.abs((head.index - leftShoulder.index) - (rightShoulder.index - head.index)) /
      Math.max(1, rightShoulder.index - leftShoulder.index);

    let score = state === "CONFIRMED" ? 68 : 44;
    if (headRatio >= 0.06) score += 12;
    else if (headRatio >= 0.04) score += 8;
    if (shoulderDiff <= 0.02) score += 10;
    else if (shoulderDiff <= 0.03) score += 6;
    if (spanSymmetry <= 0.35) score += 8;
    else if (spanSymmetry <= 0.55) score += 4;
    if (state === "CONFIRMED" && breakVolRatio >= 1.5) score += 8;
    else if (state === "CONFIRMED" && breakVolRatio >= 1.2) score += 5;
    score = clamp(Math.round(score), 0, 100);

    let confidence = 35;
    if (headRatio >= 0.05) confidence += 18;
    else if (headRatio >= 0.03) confidence += 12;
    if (shoulderDiff <= 0.02) confidence += 15;
    else if (shoulderDiff <= 0.04) confidence += 8;
    if (spanSymmetry <= 0.35) confidence += 10;
    confidence += state === "CONFIRMED" ? 20 : 5;
    if (breakVolRatio >= 1.2) confidence += 10;
    if (breakVolRatio >= 1.8) confidence += 5;
    confidence = clamp(Math.round(confidence), 0, 100);

    const reasons: string[] = [
      "스윙 고점 3개(LS-Head-RS) 구조를 탐지했습니다.",
      `Head가 어깨 대비 ${(headRatio * 100).toFixed(1)}% 높습니다.`,
      `LS/RS 높이 차이는 ${(shoulderDiff * 100).toFixed(1)}%입니다.`,
      `넥라인은 ${Math.round(necklineRef).toLocaleString("ko-KR")}원 부근입니다.`,
      state === "CONFIRMED"
        ? `종가가 넥라인 하향 이탈했고 거래량 비율 ${breakVolRatio.toFixed(2)}배로 확인됐습니다.`
        : "넥라인 하향 이탈이 아직 확정되지 않아 잠재 패턴입니다.",
      `패턴 목표가는 ${Math.round(target).toLocaleString("ko-KR")}원입니다.`,
    ];

    results.push({
      hit: {
        detected: true,
        state,
        neckline: toNullableRounded(necklineRef),
        breakDate: breakIdx >= 0 ? sample[breakIdx].time : null,
        target: toNullableRounded(target),
        score,
        confidence,
        reasons: reasons.slice(0, 6),
      },
      recencyScore: rightShoulder.index,
    });
  }

  return results;
};

const getInverseHeadShouldersCandidates = (candles: Candle[]): PatternCandidate[] => {
  if (candles.length < 80) return [];
  const offset = Math.max(0, candles.length - SWING_LOOKBACK);
  const sample = candles.slice(offset);
  const lows = getSwingLows(sample, SWING_LEFT_RIGHT);
  const volRatio = getVolRatioSeries(sample);
  const results: PatternCandidate[] = [];

  for (let i = 0; i + 2 < lows.length; i += 1) {
    const leftShoulder = lows[i];
    const head = lows[i + 1];
    const rightShoulder = lows[i + 2];

    if (head.index - leftShoulder.index < 3 || rightShoulder.index - head.index < 3) continue;

    const shoulderMin = Math.min(leftShoulder.price, rightShoulder.price);
    const headGap = shoulderMin > 0 ? 1 - head.price / shoulderMin : 0;
    if (headGap < HS_HEAD_MIN_GAP) continue;

    const shoulderDiff =
      Math.max(leftShoulder.price, rightShoulder.price) > 0
        ? Math.abs(leftShoulder.price - rightShoulder.price) /
          Math.max(leftShoulder.price, rightShoulder.price)
        : 1;
    if (shoulderDiff > HS_SHOULDER_MAX_DIFF) continue;

    const peak1 = findHighestBetween(sample, leftShoulder.index, head.index);
    const peak2 = findHighestBetween(sample, head.index, rightShoulder.index);
    if (!peak1 || !peak2 || peak2.index === peak1.index) continue;

    const slope = (peak2.price - peak1.price) / (peak2.index - peak1.index);
    const necklineAt = (idx: number): number => peak1.price + slope * (idx - peak1.index);

    let breakIdx = -1;
    let breakVolRatio = 1;
    for (let idx = rightShoulder.index + 1; idx < sample.length; idx += 1) {
      if (sample[idx].close > necklineAt(idx) && volRatio[idx] >= 1.2) {
        breakIdx = idx;
        breakVolRatio = volRatio[idx];
        break;
      }
    }

    const state = breakIdx >= 0 ? "CONFIRMED" : "POTENTIAL";
    const referenceIndex = breakIdx >= 0 ? breakIdx : sample.length - 1;
    const necklineRef = necklineAt(referenceIndex);
    const headNeckGap = necklineAt(head.index) - head.price;
    const target = necklineRef + headNeckGap;
    const spanSymmetry =
      Math.abs((head.index - leftShoulder.index) - (rightShoulder.index - head.index)) /
      Math.max(1, rightShoulder.index - leftShoulder.index);

    let score = state === "CONFIRMED" ? 70 : 46;
    if (headGap >= 0.06) score += 12;
    else if (headGap >= 0.04) score += 8;
    if (shoulderDiff <= 0.02) score += 10;
    else if (shoulderDiff <= 0.03) score += 6;
    if (spanSymmetry <= 0.35) score += 8;
    else if (spanSymmetry <= 0.55) score += 4;
    if (state === "CONFIRMED" && breakVolRatio >= 1.5) score += 8;
    else if (state === "CONFIRMED" && breakVolRatio >= 1.2) score += 5;
    score = clamp(Math.round(score), 0, 100);

    let confidence = 36;
    if (headGap >= 0.05) confidence += 18;
    else if (headGap >= 0.03) confidence += 12;
    if (shoulderDiff <= 0.02) confidence += 15;
    else if (shoulderDiff <= 0.04) confidence += 8;
    if (spanSymmetry <= 0.35) confidence += 10;
    confidence += state === "CONFIRMED" ? 20 : 5;
    if (breakVolRatio >= 1.2) confidence += 10;
    if (breakVolRatio >= 1.8) confidence += 5;
    confidence = clamp(Math.round(confidence), 0, 100);

    const reasons: string[] = [
      "스윙 저점 3개(LS-Head-RS) 구조를 탐지했습니다.",
      `Head가 어깨 대비 ${(headGap * 100).toFixed(1)}% 낮습니다.`,
      `LS/RS 저점 차이는 ${(shoulderDiff * 100).toFixed(1)}%입니다.`,
      `넥라인은 ${Math.round(necklineRef).toLocaleString("ko-KR")}원 부근입니다.`,
      state === "CONFIRMED"
        ? `종가가 넥라인 상향 돌파했고 거래량 비율 ${breakVolRatio.toFixed(2)}배로 확인됐습니다.`
        : "넥라인 상향 돌파가 아직 확정되지 않아 잠재 패턴입니다.",
      `패턴 목표가는 ${Math.round(target).toLocaleString("ko-KR")}원입니다.`,
    ];

    results.push({
      hit: {
        detected: true,
        state,
        neckline: toNullableRounded(necklineRef),
        breakDate: breakIdx >= 0 ? sample[breakIdx].time : null,
        target: toNullableRounded(target),
        score,
        confidence,
        reasons: reasons.slice(0, 6),
      },
      recencyScore: rightShoulder.index,
    });
  }

  return results;
};

const pickBestPatternHit = (candidates: PatternCandidate[], emptyReason: string): PatternHit => {
  if (candidates.length === 0) return defaultPatternHit(emptyReason);
  const sorted = [...candidates].sort((a, b) => {
    const aScore = a.hit.score + (a.hit.state === "CONFIRMED" ? 20 : 0);
    const bScore = b.hit.score + (b.hit.state === "CONFIRMED" ? 20 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return b.recencyScore - a.recencyScore;
  });
  return sorted[0].hit;
};

export const detectHeadShouldersPattern = (candles: Candle[]): PatternHit =>
  pickBestPatternHit(
    getHeadShouldersCandidates(candles),
    "헤드앤숄더 패턴은 뚜렷하게 감지되지 않았습니다.",
  );

export const detectInverseHeadShouldersPattern = (candles: Candle[]): PatternHit =>
  pickBestPatternHit(
    getInverseHeadShouldersCandidates(candles),
    "역헤드앤숄더 패턴은 뚜렷하게 감지되지 않았습니다.",
  );
