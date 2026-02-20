import { atr, bollingerBands, rsi, sma } from "./indicators";
import type {
  Candle,
  IndicatorLevels,
  Overall,
  Regime,
  Scores,
  Signals,
  Timeframe,
  TimeframeAnalysis,
  TimingInfo,
} from "./types";
import { clamp, round2 } from "./utils";

interface TimeframeConfig {
  tf: Timeframe;
  maFast: number;
  maMid: number;
  maLong?: number;
  breakoutLookback: number;
  trendWeights: {
    closeAboveMid: number;
    fastAboveMid: number;
    midSlopeUp: number;
    midAboveLong: number;
    breakout: number;
  };
}

const TF_CONFIG: Record<Timeframe, TimeframeConfig> = {
  month: {
    tf: "month",
    maFast: 6,
    maMid: 12,
    maLong: 24,
    breakoutLookback: 12,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
  week: {
    tf: "week",
    maFast: 10,
    maMid: 30,
    maLong: 60,
    breakoutLookback: 20,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
  day: {
    tf: "day",
    maFast: 20,
    maMid: 60,
    maLong: 120,
    breakoutLookback: 20,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
  min15: {
    tf: "min15",
    maFast: 20,
    maMid: 60,
    breakoutLookback: 20,
    trendWeights: {
      closeAboveMid: 30,
      fastAboveMid: 25,
      midSlopeUp: 25,
      midAboveLong: 0,
      breakout: 20,
    },
  },
};

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

const pickNearestBelow = (values: number[], reference: number): number | null => {
  const below = values.filter((value) => Number.isFinite(value) && value < reference);
  if (below.length === 0) return null;
  return Math.max(...below);
};

const pickNearestAbove = (values: number[], reference: number): number | null => {
  const above = values.filter((value) => Number.isFinite(value) && value > reference);
  if (above.length === 0) return null;
  return Math.min(...above);
};

const pivotLevels = (prevBar: Candle): number[] => {
  const p = (prevBar.high + prevBar.low + prevBar.close) / 3;
  const s1 = 2 * p - prevBar.high;
  const s2 = p - (prevBar.high - prevBar.low);
  const r1 = 2 * p - prevBar.low;
  const r2 = p + (prevBar.high - prevBar.low);

  return [p, s1, s2, r1, r2].filter((value) => Number.isFinite(value));
};

const swingCandidates = (
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

const adjustSupportResistance = (
  support: number | null,
  resistance: number | null,
  currentClose: number,
  ma20: number | null,
): { support: number; resistance: number } => {
  // 명세: 값이 비거나 역전되면 MA20 기준으로 보정
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

const overallFromScores = (trend: number, momentum: number, risk: number): Overall => {
  if (trend >= 70 && momentum >= 55 && risk >= 45) return "GOOD";
  if (trend >= 40 && risk >= 35) return "NEUTRAL";
  return "CAUTION";
};

const trendLabel = (trend: number): string => {
  if (trend >= 70) return "상승 추세";
  if (trend >= 40) return "혼조/횡보";
  return "하락 추세";
};

const momentumLabel = (momentum: number): string => {
  if (momentum >= 65) return "모멘텀 강함";
  if (momentum >= 45) return "모멘텀 보통";
  return "모멘텀 약함";
};

const riskLabel = (risk: number): string => {
  if (risk >= 70) return "변동성 낮음";
  if (risk >= 40) return "변동성 보통";
  return "변동성 높음";
};

const regimeFromTrend = (trend: number): Regime => {
  if (trend >= 70) return "UP";
  if (trend >= 40) return "SIDE";
  return "DOWN";
};

const downgradeOverall = (overall: Overall): Overall => {
  if (overall === "GOOD") return "NEUTRAL";
  if (overall === "NEUTRAL") return "CAUTION";
  return "CAUTION";
};

const analyzeWithConfig = (candles: Candle[], config: TimeframeConfig): TimeframeAnalysis => {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const latest = candles[candles.length - 1];

  const maFastSeries = sma(closes, config.maFast);
  const maMidSeries = sma(closes, config.maMid);
  const maLongSeries = config.maLong ? sma(closes, config.maLong) : Array(closes.length).fill(null);
  const ma20Series = sma(closes, 20);
  const volMa20Series = sma(volumes, 20);
  const rsi14Series = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const atr14Series = atr(candles, 14);

  const maFast = lastValue(maFastSeries);
  const maMid = lastValue(maMidSeries);
  const maLong = lastValue(maLongSeries);
  const ma20 = lastValue(ma20Series);
  const maMidPrev5 = valueAt(maMidSeries, 5);
  const rsi14 = lastValue(rsi14Series);
  const rsiPrev5 = valueAt(rsi14Series, 5);
  const bbUpper = lastValue(bb.upper);
  const bbMid = lastValue(bb.mid);
  const bbLower = lastValue(bb.lower);
  const atr14 = lastValue(atr14Series);
  const volMa20 = lastValue(volMa20Series);
  const atrPct = atr14 != null ? (atr14 / latest.close) * 100 : null;
  const recent = closes.slice(-config.breakoutLookback);
  const recentHigh = recent.length > 0 ? Math.max(...recent) : null;
  const recentLow = recent.length > 0 ? Math.min(...recent) : null;
  const mdd20 = mddPercent(closes.slice(-20));

  const closeAboveMid = maMid != null ? latest.close > maMid : false;
  const fastAboveMid = maFast != null && maMid != null ? maFast > maMid : false;
  const midSlopeUp = maMid != null && maMidPrev5 != null ? maMid > maMidPrev5 : false;
  const midAboveLong =
    config.maLong == null ? false : maMid != null && maLong != null ? maMid > maLong : false;
  const breakout = recentHigh != null ? latest.close >= recentHigh : false;

  const rsiBand: Signals["momentum"]["rsiBand"] =
    rsi14 == null ? "LOW" : rsi14 >= 55 ? "HIGH" : rsi14 >= 45 ? "MID" : "LOW";
  const rsiUpN = rsi14 != null && rsiPrev5 != null ? rsi14 > rsiPrev5 : false;
  const closeAboveFast = maFast != null ? latest.close > maFast : false;
  const return5 =
    closes.length >= 6 ? ((latest.close - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
  const returnNPositive = closes.length >= 6 ? return5 > 0 : false;
  const volumeAboveMa20 = volMa20 != null ? latest.volume > volMa20 : false;

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
  }

  const oneBarReturn =
    closes.length >= 2 ? ((latest.close - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;
  const sharpDropBar = closes.length >= 2 ? oneBarReturn <= -5 : false;
  const sharpDropScore = sharpDropBar ? -20 : 0;

  let trend = 0;
  if (closeAboveMid) trend += config.trendWeights.closeAboveMid;
  if (fastAboveMid) trend += config.trendWeights.fastAboveMid;
  if (midSlopeUp) trend += config.trendWeights.midSlopeUp;
  if (midAboveLong) trend += config.trendWeights.midAboveLong;
  if (breakout) trend += config.trendWeights.breakout;
  trend = clamp(trend, 0, 100);

  let momentum = 0;
  if (rsiBand === "HIGH") momentum += 20;
  else if (rsiBand === "MID") momentum += 10;
  if (rsiUpN) momentum += 20;
  if (closeAboveFast) momentum += 20;
  if (returnNPositive) momentum += 20;
  if (volumeAboveMa20) momentum += 20;
  momentum = clamp(momentum, 0, 100);

  let risk = atrScore + bbScore + mddScore + sharpDropScore;
  risk = clamp(risk, 0, 100);

  const overall = overallFromScores(trend, momentum, risk);
  const summaryText = `${trendLabel(trend)} · ${momentumLabel(momentum)} · ${riskLabel(risk)}`;

  const reasons: string[] = [
    closeAboveMid
      ? `종가가 MA${config.maMid} 위에 있어 추세가 유지됩니다.`
      : `종가가 MA${config.maMid} 아래에 있어 추세가 약합니다.`,
    fastAboveMid
      ? `MA${config.maFast} > MA${config.maMid} 정렬입니다.`
      : `MA${config.maFast} <= MA${config.maMid} 상태입니다.`,
    breakout
      ? `최근 ${config.breakoutLookback}봉 고점 돌파가 발생했습니다.`
      : `최근 ${config.breakoutLookback}봉 고점 돌파는 아직 없습니다.`,
    rsiBand === "HIGH"
      ? `RSI(${round2(rsi14)})가 높아 모멘텀이 강합니다.`
      : rsiBand === "MID"
        ? `RSI(${round2(rsi14)})가 중립 영역입니다.`
        : `RSI(${round2(rsi14)})가 낮아 모멘텀이 약합니다.`,
    atrPct != null && atrPct <= 4
      ? `ATR%(${round2(atrPct)}%)가 안정 구간입니다.`
      : `ATR%(${round2(atrPct)}%)가 높아 변동성 부담이 있습니다.`,
    sharpDropBar
      ? `직전 봉 급락(${round2(oneBarReturn)}%)이 발생했습니다.`
      : `직전 봉 급락 조건은 발생하지 않았습니다.`,
  ];

  const prevBar = candles[candles.length - 2] ?? latest;
  const pivots = pivotLevels(prevBar);
  const swings = swingCandidates(candles, latest.close, 60, 3);
  const allCandidates = [
    ...pivots,
    ...(bbLower != null ? [bbLower] : []),
    ...(bbUpper != null ? [bbUpper] : []),
    ...(swings.support != null ? [swings.support] : []),
    ...(swings.resistance != null ? [swings.resistance] : []),
  ];

  const sr = adjustSupportResistance(
    pickNearestBelow(allCandidates, latest.close),
    pickNearestAbove(allCandidates, latest.close),
    latest.close,
    ma20,
  );

  const levels: IndicatorLevels = {
    ma20: round2(ma20),
    maFast: round2(maFast),
    maMid: round2(maMid),
    maLong: round2(maLong),
    rsi14: round2(rsi14),
    bbUpper: round2(bbUpper),
    bbMid: round2(bbMid),
    bbLower: round2(bbLower),
    atr14: round2(atr14),
    atrPercent: round2(atrPct),
    recentHigh: round2(recentHigh),
    recentLow: round2(recentLow),
    volumeMa20: round2(volMa20),
    support: round2(sr.support),
    resistance: round2(sr.resistance),
  };

  const signals: Signals = {
    trend: {
      closeAboveMid,
      fastAboveMid,
      midSlopeUp,
      midAboveLong,
      breakout,
    },
    momentum: {
      rsi: round2(rsi14),
      rsiBand,
      rsiUpN,
      closeAboveFast,
      returnNPositive,
      volumeAboveMa20,
    },
    risk: {
      atrPercent: round2(atrPct),
      atrBucket,
      bbPosition,
      mddN: round2(mdd20),
      sharpDropBar,
    },
  };

  return {
    tf: config.tf,
    regime: regimeFromTrend(trend),
    summaryText,
    scores: { trend, momentum, risk, overall },
    signals,
    reasons: reasons.slice(0, 6),
    levels,
    candles,
  };
};

const computeTiming = (candles: Candle[], levels: IndicatorLevels): TimingInfo => {
  const closes = candles.map((c) => c.close);
  const rsi14Series = rsi(closes, 14);
  const rsiNow = lastValue(rsi14Series);
  const rsiPrev4 = valueAt(rsi14Series, 4);
  const latest = candles[candles.length - 1];

  let score = 50;
  const reasons: string[] = [];

  const closeAboveMa60 = levels.maMid != null ? latest.close > levels.maMid : false;
  if (closeAboveMa60) {
    score += 15;
    reasons.push("종가가 MA60 위라 단기 방향이 우호적입니다.");
  } else {
    reasons.push("종가가 MA60 아래라 단기 추세가 약합니다.");
  }

  const ma20AboveMa60 =
    levels.maFast != null && levels.maMid != null ? levels.maFast > levels.maMid : false;
  if (ma20AboveMa60) {
    score += 15;
    reasons.push("MA20 > MA60 정렬로 단기 추세 정렬이 좋습니다.");
  } else {
    reasons.push("MA20 > MA60 정렬이 아직 아닙니다.");
  }

  if (rsiNow != null && rsiNow >= 55) {
    score += 10;
    reasons.push(`RSI(${round2(rsiNow)})가 55 이상입니다.`);
  }

  const rsiUp4 = rsiNow != null && rsiPrev4 != null ? rsiNow > rsiPrev4 : false;
  if (rsiUp4) {
    score += 10;
    reasons.push("RSI가 최근 4봉 기준 상승했습니다.");
  }

  if (levels.bbLower != null && latest.close < levels.bbLower) {
    score -= 15;
    reasons.push("볼린저 하단 이탈로 변동성 리스크가 큽니다.");
  }

  if (levels.bbUpper != null && latest.close > levels.bbUpper) {
    score -= 5;
    reasons.push("볼린저 상단 이탈 상태라 과열 부담이 있습니다.");
  }

  if (levels.atrPercent != null && levels.atrPercent > 1.2) {
    score -= 10;
    reasons.push(`ATR%(${levels.atrPercent}%)가 1.2%를 넘어 변동성이 높습니다.`);
  }

  const timingScore = clamp(score, 0, 100);
  const timingLabel: TimingInfo["timingLabel"] =
    timingScore >= 70 ? "타이밍 양호" : timingScore >= 50 ? "관망/조건부" : "진입 비추";

  return {
    timingScore,
    timingLabel,
    reasons: reasons.slice(0, 6),
  };
};

export const analyzeTimeframe = (tf: Timeframe, candles: Candle[]): TimeframeAnalysis => {
  const config = TF_CONFIG[tf];
  const base = analyzeWithConfig(candles, config);
  if (tf === "min15") {
    return {
      ...base,
      timing: computeTiming(candles, base.levels),
    };
  }
  return base;
};

export const computeMultiFinal = (
  month: TimeframeAnalysis,
  week: TimeframeAnalysis,
  day: TimeframeAnalysis,
  min15: TimeframeAnalysis,
): {
  overall: Overall;
  confidence: number;
  summary: string;
  warnings: string[];
} => {
  const warnings: string[] = [];
  let overall = day.scores.overall;

  if (month.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("장기 역풍");
  }
  if (week.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("중기 역풍");
  }
  if (month.regime === "DOWN" && week.regime === "DOWN") {
    overall = "CAUTION";
  }

  let confidence = 50;
  confidence += month.regime === "UP" ? 15 : month.regime === "SIDE" ? 5 : -15;
  confidence += week.regime === "UP" ? 15 : week.regime === "SIDE" ? 5 : -15;
  if (day.scores.trend >= 70) confidence += 10;
  if (day.scores.momentum >= 60) confidence += 5;
  if (day.scores.risk < 35) confidence -= 15;
  if (day.signals.momentum.volumeAboveMa20) confidence += 5;

  // 명세: month/ week 동시 UP일 때 보너스(점수 or confidence 중 택1) -> confidence로 통일
  if (month.regime === "UP" && week.regime === "UP") {
    confidence += 10;
  }

  confidence = clamp(confidence, 0, 100);

  const timingText = min15.timing ? min15.timing.timingLabel : "타이밍 정보 없음";
  const summary = `${day.summaryText} · ${timingText}`;

  return {
    overall,
    confidence,
    summary,
    warnings,
  };
};

// Backward compatibility helper (day default analyzer)
export const analyzeCandles = (
  candles: Candle[],
): {
  scores: Scores;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  summaryText: string;
} => {
  const day = analyzeTimeframe("day", candles);
  return {
    scores: day.scores,
    signals: day.signals,
    reasons: day.reasons,
    levels: day.levels,
    summaryText: day.summaryText,
  };
};

