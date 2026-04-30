import type { Candle, Signals } from "../types";
import { clamp, round2 } from "../utils";

export const emptyCupHandleSignal = (reason: string): Signals["cupHandle"] => ({
  detected: false,
  state: "NONE",
  score: 0,
  neckline: null,
  breakout: false,
  cupDepthPct: null,
  handleDepthPct: null,
  cupWidthBars: null,
  handleBars: null,
  reasons: [reason],
});

export const detectCupHandlePattern = (
  candles: Candle[],
  volMa20Series: Array<number | null>,
): Signals["cupHandle"] => {
  if (candles.length < 90) {
    return emptyCupHandleSignal("컵앤핸들 분석에 필요한 일봉 데이터가 부족합니다.");
  }

  const n = candles.length;
  const searchStart = Math.max(0, n - 160);
  const rightPeakStart = Math.max(searchStart + 40, n - 45);
  const rightPeakEnd = n - 6;
  if (rightPeakEnd <= rightPeakStart) {
    return emptyCupHandleSignal("우측 피크 탐지 구간이 부족합니다.");
  }

  let rightPeakIndex = rightPeakStart;
  for (let i = rightPeakStart + 1; i <= rightPeakEnd; i += 1) {
    if (candles[i].high >= candles[rightPeakIndex].high) rightPeakIndex = i;
  }

  const leftPeakStart = Math.max(searchStart, rightPeakIndex - 120);
  const leftPeakEnd = rightPeakIndex - 20;
  if (leftPeakEnd <= leftPeakStart) {
    return emptyCupHandleSignal("좌측 피크 탐지 구간이 부족합니다.");
  }

  let leftPeakIndex = leftPeakStart;
  for (let i = leftPeakStart + 1; i <= leftPeakEnd; i += 1) {
    if (candles[i].high >= candles[leftPeakIndex].high) leftPeakIndex = i;
  }
  if (rightPeakIndex - leftPeakIndex < 20) {
    return emptyCupHandleSignal("컵 폭이 너무 짧아 패턴 신뢰도가 낮습니다.");
  }

  let bottomIndex = leftPeakIndex + 1;
  for (let i = leftPeakIndex + 1; i < rightPeakIndex; i += 1) {
    if (candles[i].low <= candles[bottomIndex].low) bottomIndex = i;
  }

  const leftPeakHigh = candles[leftPeakIndex].high;
  const rightPeakHigh = candles[rightPeakIndex].high;
  const cupBottomLow = candles[bottomIndex].low;
  const cupWidthBars = rightPeakIndex - leftPeakIndex;
  const basePeak = Math.max(1, Math.min(leftPeakHigh, rightPeakHigh));
  const cupDepth = clamp((basePeak - cupBottomLow) / basePeak, 0, 1);
  const symmetryGap = Math.abs(leftPeakHigh - rightPeakHigh) / basePeak;
  const bottomPos = (bottomIndex - leftPeakIndex) / Math.max(1, cupWidthBars);
  const neckline = (leftPeakHigh + rightPeakHigh) / 2;

  const cupDepthOk = cupDepth >= 0.12 && cupDepth <= 0.5;
  const cupSymmetryOk = symmetryGap <= 0.1;
  const cupWidthOk = cupWidthBars >= 25 && cupWidthBars <= 130;
  const cupBottomOk = bottomPos >= 0.25 && bottomPos <= 0.75;
  const cupOk = cupDepthOk && cupSymmetryOk && cupWidthOk && cupBottomOk;

  const handleStart = rightPeakIndex + 1;
  const handleBars = n - handleStart;
  if (handleBars < 5) {
    return {
      detected: cupOk,
      state: cupOk ? "POTENTIAL" : "NONE",
      score: clamp(Math.round((cupOk ? 45 : 20) + (cupDepthOk ? 8 : 0) + (cupSymmetryOk ? 8 : 0)), 0, 100),
      neckline: round2(neckline),
      breakout: false,
      cupDepthPct: round2(cupDepth * 100),
      handleDepthPct: null,
      cupWidthBars,
      handleBars,
      reasons: cupOk
        ? [
            "컵 형태는 형성됐지만 핸들 구간이 아직 충분히 진행되지 않았습니다.",
            `컵 깊이 ${round2(cupDepth * 100)}%, 컵 폭 ${cupWidthBars}봉입니다.`,
          ]
        : [
            `컵 조건 미충족(깊이:${cupDepthOk ? "OK" : "X"}, 대칭:${cupSymmetryOk ? "OK" : "X"}, 폭:${cupWidthOk ? "OK" : "X"}).`,
          ],
    };
  }

  const handleCandles = candles.slice(handleStart);
  const handleLow = Math.min(...handleCandles.map((c) => c.low));
  const handleHigh = Math.max(...handleCandles.map((c) => c.high));
  const handleDepth = clamp((rightPeakHigh - handleLow) / Math.max(1, rightPeakHigh), 0, 1);
  const handleDepthOk = handleDepth <= 0.15;
  const handleBarsOk = handleBars >= 5 && handleBars <= 30;
  const handleDriftOk = handleLow < rightPeakHigh && handleHigh <= rightPeakHigh * 1.03;
  const handleRetraceOk = handleLow >= cupBottomLow + (rightPeakHigh - cupBottomLow) * 0.45;
  const handleOk = handleDepthOk && handleBarsOk && handleDriftOk && handleRetraceOk;

  const latest = candles[n - 1];
  const latestVolMa20 = volMa20Series[n - 1];
  const latestVolRatio =
    latestVolMa20 != null && latestVolMa20 > 0 ? latest.volume / latestVolMa20 : 1;
  const breakout = handleOk && latest.close > rightPeakHigh && latestVolRatio >= 1.2;
  const nearNeckline = latest.close >= rightPeakHigh * 0.95;

  let score = 0;
  if (cupOk) score += 45;
  if (handleOk) score += 25;
  if (cupSymmetryOk) score += 10;
  if (cupDepth >= 0.15 && cupDepth <= 0.35) score += 8;
  if (nearNeckline) score += 7;
  if (breakout) score += 15;
  score = clamp(score, 0, 100);

  const detected = cupOk && handleOk;
  const state: Signals["cupHandle"]["state"] = detected
    ? breakout
      ? "CONFIRMED"
      : "POTENTIAL"
    : "NONE";

  const reasons: string[] = [];
  reasons.push(
    `컵 조건 ${cupOk ? "충족" : "미충족"} (깊이 ${round2(cupDepth * 100)}%, 폭 ${cupWidthBars}봉, 대칭오차 ${round2(symmetryGap * 100)}%).`,
  );
  reasons.push(
    `핸들 조건 ${handleOk ? "충족" : "미충족"} (깊이 ${round2(handleDepth * 100)}%, 기간 ${handleBars}봉).`,
  );
  reasons.push(
    breakout
      ? `돌파 확인: 종가가 넥라인을 상향 돌파했고 거래량 비율 ${round2(latestVolRatio)}배입니다.`
      : `아직 돌파 전: 넥라인 근접 ${nearNeckline ? "예" : "아니오"}, 거래량 비율 ${round2(latestVolRatio)}배.`,
  );
  reasons.push(`컵앤핸들 점수는 ${score}점입니다.`);

  return {
    detected,
    state,
    score,
    neckline: round2(neckline),
    breakout,
    cupDepthPct: round2(cupDepth * 100),
    handleDepthPct: round2(handleDepth * 100),
    cupWidthBars,
    handleBars,
    reasons: reasons.slice(0, 6),
  };
};
