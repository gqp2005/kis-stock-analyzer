import { atr, bollingerBands, rsi, sma } from "./indicators";
import type { Candle, IndicatorLevels, Scores, Signals } from "./types";
import { clamp, round2 } from "./utils";

const lastValue = <T>(arr: Array<T | null>): T | null => {
  if (arr.length === 0) return null;
  return arr[arr.length - 1];
};

const valueAt = <T>(arr: Array<T | null>, offsetFromLast: number): T | null => {
  const index = arr.length - 1 - offsetFromLast;
  if (index < 0 || index >= arr.length) return null;
  return arr[index];
};

const mddPercent = (closes: number[]): number | null => {
  if (closes.length === 0) return null;
  let peak = closes[0];
  let mdd = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    const drawdown = (close / peak - 1) * 100;
    mdd = Math.min(mdd, drawdown);
  }
  return mdd;
};

export const analyzeCandles = (
  candles: Candle[],
): {
  scores: Scores;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
} => {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const latest = candles[candles.length - 1];

  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const volMa20 = sma(volumes, 20);
  const rsi14 = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const atr14 = atr(candles, 14);

  const ma20Latest = lastValue(ma20);
  const ma60Latest = lastValue(ma60);
  const ma60Prev5 = valueAt(ma60, 5);
  const ma120Latest = lastValue(ma120);
  const rsiLatest = lastValue(rsi14);
  const rsiPrev5 = valueAt(rsi14, 5);
  const bbUpper = lastValue(bb.upper);
  const bbMid = lastValue(bb.mid);
  const bbLower = lastValue(bb.lower);
  const atrLatest = lastValue(atr14);
  const volMa20Latest = lastValue(volMa20);
  const atrPct = atrLatest != null ? (atrLatest / latest.close) * 100 : null;

  const recent20 = closes.slice(-20);
  const recentHigh20 = recent20.length > 0 ? Math.max(...recent20) : null;
  const recentLow20 = recent20.length > 0 ? Math.min(...recent20) : null;
  const mdd20 = mddPercent(recent20);

  const closeAboveMa60 = ma60Latest != null ? latest.close > ma60Latest : false;
  const ma20AboveMa60 = ma20Latest != null && ma60Latest != null ? ma20Latest > ma60Latest : false;
  const ma60SlopeUp = ma60Latest != null && ma60Prev5 != null ? ma60Latest > ma60Prev5 : false;
  const ma60AboveMa120 = ma60Latest != null && ma120Latest != null ? ma60Latest > ma120Latest : false;
  const newHigh20 = recentHigh20 != null ? latest.close >= recentHigh20 : false;

  const rsiBand: Signals["momentum"]["rsiBand"] =
    rsiLatest == null ? "LOW" : rsiLatest >= 55 ? "HIGH" : rsiLatest >= 45 ? "MID" : "LOW";
  const rsiUp5d = rsiLatest != null && rsiPrev5 != null ? rsiLatest > rsiPrev5 : false;
  const closeAboveMa20 = ma20Latest != null ? latest.close > ma20Latest : false;
  const return5d =
    closes.length >= 6 ? ((latest.close - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
  const return5dPositive = closes.length >= 6 ? return5d > 0 : false;
  const volumeAboveMa20 = volMa20Latest != null ? latest.volume > volMa20Latest : false;

  let atrBucket: Signals["risk"]["atrBucket"] = "N/A";
  let atrScore = 0;
  if (atrPct != null) {
    if (atrPct <= 2) {
      atrBucket = "<=2";
      atrScore = 30;
    } else if (atrPct <= 4) {
      atrBucket = "2~4";
      atrScore = 20;
    } else if (atrPct <= 6) {
      atrBucket = "4~6";
      atrScore = 10;
    } else {
      atrBucket = ">6";
      atrScore = 0;
    }
  }

  let bbPosition: Signals["risk"]["bbPosition"] = "N/A";
  let bbScore = 0;
  if (bbUpper != null && bbLower != null) {
    if (latest.close > bbUpper) {
      bbPosition = "ABOVE_UPPER";
      bbScore = -20;
    } else if (latest.close < bbLower) {
      bbPosition = "BELOW_LOWER";
      bbScore = -10;
    } else {
      bbPosition = "INSIDE_BAND";
      bbScore = 10;
    }
  }

  let mddScore = 0;
  if (mdd20 != null) {
    if (mdd20 >= -5) mddScore = 20;
    else if (mdd20 >= -10) mddScore = 10;
    else mddScore = 0;
  }

  const dailyReturn =
    closes.length >= 2 ? ((latest.close - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;
  const sharpDropDay = closes.length >= 2 ? dailyReturn <= -5 : false;
  const sharpDropScore = sharpDropDay ? -20 : 0;

  let trend = 0;
  if (closeAboveMa60) trend += 25;
  if (ma20AboveMa60) trend += 25;
  if (ma60SlopeUp) trend += 20;
  if (ma60AboveMa120) trend += 20;
  if (newHigh20) trend += 10;
  trend = clamp(trend, 0, 100);

  let momentum = 0;
  if (rsiBand === "HIGH") momentum += 20;
  else if (rsiBand === "MID") momentum += 10;
  if (rsiUp5d) momentum += 20;
  if (closeAboveMa20) momentum += 20;
  if (return5dPositive) momentum += 20;
  if (volumeAboveMa20) momentum += 20;
  momentum = clamp(momentum, 0, 100);

  let risk = atrScore + bbScore + mddScore + sharpDropScore;
  risk = clamp(risk, 0, 100);

  const overall: Scores["overall"] =
    trend >= 70 && momentum >= 55 && risk >= 45
      ? "GOOD"
      : trend >= 40 && risk >= 35
        ? "NEUTRAL"
        : "CAUTION";

  const reasons: string[] = [];
  reasons.push(
    closeAboveMa60
      ? `종가가 MA60 위에 있어 중기 추세가 유지됩니다.`
      : `종가가 MA60 아래라 중기 추세가 약합니다.`,
  );
  reasons.push(
    ma20AboveMa60
      ? `MA20이 MA60 위로 정렬되어 추세 점수에 유리합니다.`
      : `MA20이 MA60 아래라 추세 정렬이 아직 부족합니다.`,
  );
  reasons.push(
    rsiBand === "HIGH"
      ? `RSI(${round2(rsiLatest)})가 55 이상으로 모멘텀이 강합니다.`
      : rsiBand === "MID"
        ? `RSI(${round2(rsiLatest)})가 중립 상단(45~54)입니다.`
        : `RSI(${round2(rsiLatest)})가 낮아 모멘텀이 약합니다.`,
  );
  reasons.push(
    return5dPositive
      ? `최근 5거래일 수익률(${round2(return5d)}%)이 플러스입니다.`
      : `최근 5거래일 수익률(${round2(return5d)}%)이 마이너스입니다.`,
  );
  reasons.push(
    atrPct != null && atrPct <= 4
      ? `ATR%(${round2(atrPct)}%)가 비교적 안정 구간입니다.`
      : `ATR%(${round2(atrPct)}%)가 높아 변동성 리스크가 큽니다.`,
  );
  if (sharpDropDay) {
    reasons.push(`당일 급락(${round2(dailyReturn)}%)이 발생해 리스크 점수를 감점했습니다.`);
  } else {
    reasons.push(`급락일 조건이 없어 리스크 감점 항목은 발생하지 않았습니다.`);
  }

  const trimmedReasons = reasons.slice(0, 6);
  const finalReasons = trimmedReasons.length >= 3 ? trimmedReasons : [...trimmedReasons, "데이터 길이를 늘려 재분석이 필요합니다."];

  const levels: IndicatorLevels = {
    ma20: round2(ma20Latest),
    ma60: round2(ma60Latest),
    ma120: round2(ma120Latest),
    rsi14: round2(rsiLatest),
    bbUpper: round2(bbUpper),
    bbMid: round2(bbMid),
    bbLower: round2(bbLower),
    atr14: round2(atrLatest),
    atrPercent: round2(atrPct),
    recentHigh20: round2(recentHigh20),
    recentLow20: round2(recentLow20),
    volumeMa20: round2(volMa20Latest),
  };

  const signals: Signals = {
    trend: {
      closeAboveMa60,
      ma20AboveMa60,
      ma60SlopeUp,
      ma60AboveMa120,
      newHigh20,
    },
    momentum: {
      rsi: round2(rsiLatest),
      rsiBand,
      rsiUp5d,
      closeAboveMa20,
      return5dPositive,
      volumeAboveMa20,
    },
    risk: {
      atrPercent: round2(atrPct),
      atrBucket,
      bbPosition,
      mdd20: round2(mdd20),
      sharpDropDay,
    },
  };

  return {
    scores: { trend, momentum, risk, overall },
    signals,
    reasons: finalReasons,
    levels,
  };
};

