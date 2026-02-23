import { atr, bollingerBands, macd, rsi, sma } from "./indicators";
import type {
  Candle,
  IndicatorPoint,
  IndicatorSeries,
  IndicatorLevels,
  InvestmentProfile,
  Overall,
  ProfileScore,
  Regime,
  Scores,
  Signals,
  TradePlan,
  Timeframe,
  TimeframeAnalysis,
  VolumePatternSignal,
  VolumePatternType,
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

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const pctWithinRange = (value: number, low: number, high: number): number => {
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  return clamp((value - low) / span, 0, 1);
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

const buildTradePlan = (
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

const overallFromScores = (trend: number, momentum: number, risk: number): Overall => {
  if (trend >= 70 && momentum >= 55 && risk >= 45) return "GOOD";
  if (trend >= 40 && risk >= 35) return "NEUTRAL";
  return "CAUTION";
};

const profileOverallFromScore = (score: number): Overall => {
  if (score >= 70) return "GOOD";
  if (score >= 45) return "NEUTRAL";
  return "CAUTION";
};

const PROFILE_WEIGHTS: Record<
  InvestmentProfile,
  { trend: number; momentum: number; risk: number; description: string }
> = {
  short: {
    trend: 0.3,
    momentum: 0.5,
    risk: 0.2,
    description: "단기 성향: 모멘텀/수급 비중을 높여 빠른 변화를 우선합니다.",
  },
  mid: {
    trend: 0.5,
    momentum: 0.2,
    risk: 0.3,
    description: "중기 성향: 추세/리스크 비중을 높여 안정적인 흐름을 우선합니다.",
  },
};

const buildProfileScore = (
  profile: InvestmentProfile,
  trend: number,
  momentum: number,
  risk: number,
): ProfileScore => {
  const weights = PROFILE_WEIGHTS[profile];
  const score = clamp(
    Math.round(trend * weights.trend + momentum * weights.momentum + risk * weights.risk),
    0,
    100,
  );
  return {
    mode: profile,
    score,
    overall: profileOverallFromScore(score),
    weights: {
      trend: Math.round(weights.trend * 100),
      momentum: Math.round(weights.momentum * 100),
      risk: Math.round(weights.risk * 100),
    },
    description: weights.description,
  };
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

const toIndicatorPoints = (candles: Candle[], values: Array<number | null>): IndicatorPoint[] =>
  candles.map((candle, index) => ({
    time: candle.time,
    value: round2(values[index] ?? null),
  }));

const downgradeOverall = (overall: Overall): Overall => {
  if (overall === "GOOD") return "NEUTRAL";
  if (overall === "NEUTRAL") return "CAUTION";
  return "CAUTION";
};

interface VolumeBarFeatures {
  volRatio: number;
  turnover: number;
  bodyPct: number;
  upperWickPct: number;
  lowerWickPct: number;
  pos20: number;
  high20Prev: number | null;
  ma20: number | null;
  ma60: number | null;
  pullbackExists: boolean;
  pullbackVolumeContraction: boolean;
}

const detectRecentPullbackAt = (
  candles: Candle[],
  volMa20Series: Array<number | null>,
  index: number,
): { exists: boolean; volumeContraction: boolean } => {
  const sample = candles.slice(Math.max(0, index - 15), index); // 최근 15일(현재 봉 제외)
  if (sample.length < 8) {
    return { exists: false, volumeContraction: false };
  }

  const closes = sample.map((candle) => candle.close);
  let peakIndex = 0;
  let peakClose = closes[0];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] >= peakClose) {
      peakClose = closes[i];
      peakIndex = i;
    }
  }

  if (peakIndex >= closes.length - 2) {
    return { exists: false, volumeContraction: false };
  }

  let troughIndex = peakIndex + 1;
  let troughClose = closes[troughIndex];
  for (let i = peakIndex + 1; i < closes.length; i += 1) {
    if (closes[i] <= troughClose) {
      troughClose = closes[i];
      troughIndex = i;
    }
  }

  const drawdownPct = peakClose > 0 ? (troughClose / peakClose - 1) * 100 : 0;
  const exists = troughIndex > peakIndex && drawdownPct <= -3;
  if (!exists) {
    return { exists: false, volumeContraction: false };
  }

  const pullbackVolumes = sample
    .slice(peakIndex + 1, troughIndex + 1)
    .map((candle) => candle.volume);
  const avgPullbackVolume = average(pullbackVolumes);
  const avgSampleVolume = average(sample.map((candle) => candle.volume));
  const volMa20 = volMa20Series[index];
  const volumeReference = volMa20 != null && volMa20 > 0 ? volMa20 : avgSampleVolume;

  return {
    exists: true,
    volumeContraction: avgPullbackVolume < volumeReference,
  };
};

const getVolumeBarFeatures = (
  candles: Candle[],
  ma20Series: Array<number | null>,
  ma60Series: Array<number | null>,
  volMa20Series: Array<number | null>,
  index: number,
): VolumeBarFeatures => {
  const candle = candles[index];
  const range = Math.max(0, candle.high - candle.low);
  const bodyPct = range > 0 ? Math.abs(candle.close - candle.open) / range : 0;
  const upperWickPct =
    range > 0 ? (candle.high - Math.max(candle.close, candle.open)) / range : 0;
  const lowerWickPct =
    range > 0 ? (Math.min(candle.close, candle.open) - candle.low) / range : 0;
  const volMa20 = volMa20Series[index];
  const volRatio = volMa20 != null && volMa20 > 0 ? candle.volume / volMa20 : 1;
  const turnover = candle.close * candle.volume;

  const last20 = candles.slice(Math.max(0, index - 19), index + 1);
  const high20 = last20.length > 0 ? Math.max(...last20.map((item) => item.high)) : candle.high;
  const low20 = last20.length > 0 ? Math.min(...last20.map((item) => item.low)) : candle.low;
  const pos20 = pctWithinRange(candle.close, low20, high20);

  const prev20 = candles.slice(Math.max(0, index - 20), index);
  const high20Prev = prev20.length > 0 ? Math.max(...prev20.map((item) => item.high)) : null;

  const pullback = detectRecentPullbackAt(candles, volMa20Series, index);
  return {
    volRatio,
    turnover,
    bodyPct,
    upperWickPct,
    lowerWickPct,
    pos20,
    high20Prev,
    ma20: ma20Series[index],
    ma60: ma60Series[index],
    pullbackExists: pullback.exists,
    pullbackVolumeContraction: pullback.volumeContraction,
  };
};

const detectVolumePatternTypes = (
  candle: Candle,
  feature: VolumeBarFeatures,
): VolumePatternType[] => {
  const patternA =
    feature.high20Prev != null &&
    candle.close > feature.high20Prev &&
    feature.volRatio >= 1.5;
  const patternB =
    feature.high20Prev != null &&
    candle.high > feature.high20Prev &&
    candle.close <= feature.high20Prev &&
    feature.volRatio >= 1.5 &&
    feature.upperWickPct >= 0.45;
  const patternC =
    feature.ma60 != null &&
    feature.ma20 != null &&
    candle.close > feature.ma60 &&
    feature.ma20 > feature.ma60 &&
    feature.pullbackExists &&
    feature.pullbackVolumeContraction &&
    candle.close > candle.open &&
    feature.volRatio >= 1.2;
  const patternD =
    candle.close > candle.open &&
    feature.bodyPct >= 0.65 &&
    feature.volRatio >= 2.5 &&
    feature.pos20 >= 0.9;
  const patternE =
    feature.pos20 <= 0.2 &&
    feature.lowerWickPct >= 0.5 &&
    feature.volRatio >= 2.0;
  const patternF =
    feature.ma60 != null &&
    (candle.close < feature.ma60 || (feature.ma20 != null && feature.ma20 < feature.ma60)) &&
    candle.close > candle.open &&
    feature.volRatio <= 0.8;

  const types: VolumePatternType[] = [];
  if (patternA) types.push("BreakoutConfirmed");
  if (patternB) types.push("Upthrust");
  if (patternC) types.push("PullbackReaccumulation");
  if (patternD) types.push("ClimaxUp");
  if (patternE) types.push("CapitulationAbsorption");
  if (patternF) types.push("WeakBounce");
  return types;
};

const toVolumePatternSignal = (
  candle: Candle,
  type: VolumePatternType,
  feature: VolumeBarFeatures,
): VolumePatternSignal => {
  const price = round2(candle.close) ?? candle.close;
  const volume = Math.round(candle.volume);
  const volRatio = round2(feature.volRatio) ?? feature.volRatio;

  if (type === "BreakoutConfirmed") {
    const checklist = [
      { label: "종가 > 직전 20일 고점", ok: feature.high20Prev != null && candle.close > feature.high20Prev },
      { label: "거래량 비율 >= 1.5", ok: feature.volRatio >= 1.5 },
    ];
    return {
      t: candle.time,
      type,
      label: "돌파 확인(A)",
      desc: "20일 고점 돌파 + 거래량 증가가 동반됐습니다.",
      strength: clamp(Math.round(feature.volRatio * 2), 1, 5),
      ref: {
        volRatio,
        high20Prev: round2(feature.high20Prev),
      },
      details: {
        price,
        volume,
        volRatio,
        checklist,
        refLevel: round2(feature.high20Prev),
        message: "확증: 돌파와 거래량이 동반되어 추세 지속 가능성이 높습니다.",
        tone: "confirm",
      },
    };
  }
  if (type === "Upthrust") {
    const checklist = [
      { label: "고가 > 직전 20일 고점", ok: feature.high20Prev != null && candle.high > feature.high20Prev },
      { label: "종가 <= 직전 20일 고점", ok: feature.high20Prev != null && candle.close <= feature.high20Prev },
      { label: "거래량 비율 >= 1.5", ok: feature.volRatio >= 1.5 },
      { label: "윗꼬리 비율 >= 0.45", ok: feature.upperWickPct >= 0.45 },
    ];
    return {
      t: candle.time,
      type,
      label: "불트랩(B)",
      desc: "고점 돌파 후 종가가 밀리고 윗꼬리가 길어 함정 가능성이 있습니다.",
      strength: clamp(Math.round(feature.upperWickPct * 10), 1, 5),
      ref: {
        volRatio,
        upperWickPct: round2(feature.upperWickPct),
      },
      details: {
        price,
        volume,
        volRatio,
        checklist,
        refLevel: round2(feature.high20Prev),
        message: "경고: 돌파 실패형 캔들로 단기 되돌림 리스크가 큽니다.",
        tone: "warning",
      },
    };
  }
  if (type === "PullbackReaccumulation") {
    const checklist = [
      { label: "종가 > MA60", ok: feature.ma60 != null && candle.close > feature.ma60 },
      { label: "MA20 > MA60", ok: feature.ma20 != null && feature.ma60 != null && feature.ma20 > feature.ma60 },
      { label: "최근 조정 존재", ok: feature.pullbackExists },
      { label: "조정 구간 거래량 감소", ok: feature.pullbackVolumeContraction },
      { label: "당일 양봉", ok: candle.close > candle.open },
      { label: "거래량 비율 >= 1.2", ok: feature.volRatio >= 1.2 },
    ];
    return {
      t: candle.time,
      type,
      label: "눌림 재축적(C)",
      desc: "상승 추세 내 조정 거래량 감소 후 양봉 회복이 확인됐습니다.",
      strength: clamp(Math.round(feature.volRatio * 2), 1, 5),
      ref: {
        volRatio,
        ma20: round2(feature.ma20),
        ma60: round2(feature.ma60),
      },
      details: {
        price,
        volume,
        volRatio,
        checklist,
        refLevel: round2(feature.ma60),
        message: "확증: 추세 유지 상태에서 재축적 신호가 나타났습니다.",
        tone: "confirm",
      },
    };
  }
  if (type === "ClimaxUp") {
    const checklist = [
      { label: "당일 양봉", ok: candle.close > candle.open },
      { label: "몸통 비율 >= 0.65", ok: feature.bodyPct >= 0.65 },
      { label: "거래량 비율 >= 2.5", ok: feature.volRatio >= 2.5 },
      { label: "20일 위치 >= 0.9", ok: feature.pos20 >= 0.9 },
    ];
    return {
      t: candle.time,
      type,
      label: "상승 클라이맥스(D)",
      desc: "장대 양봉과 과도한 거래량이 동반돼 단기 과열 신호입니다.",
      strength: clamp(Math.round(feature.bodyPct * 5), 1, 5),
      ref: {
        volRatio,
        bodyPct: round2(feature.bodyPct),
      },
      details: {
        price,
        volume,
        volRatio,
        checklist,
        refLevel: null,
        message: "경고: 과열 구간 가능성이 높아 추격 매수에 주의가 필요합니다.",
        tone: "warning",
      },
    };
  }
  if (type === "CapitulationAbsorption") {
    const checklist = [
      { label: "20일 위치 <= 0.2", ok: feature.pos20 <= 0.2 },
      { label: "아랫꼬리 비율 >= 0.5", ok: feature.lowerWickPct >= 0.5 },
      { label: "거래량 비율 >= 2.0", ok: feature.volRatio >= 2.0 },
    ];
    return {
      t: candle.time,
      type,
      label: "투매 흡수(E)",
      desc: "저점권 긴 아랫꼬리와 대량거래로 매도 물량 흡수가 포착됐습니다.",
      strength: clamp(Math.round(feature.lowerWickPct * 8), 1, 5),
      ref: {
        volRatio,
        lowerWickPct: round2(feature.lowerWickPct),
      },
      details: {
        price,
        volume,
        volRatio,
        checklist,
        refLevel: null,
        message: "확증: 투매 흡수 가능성이 있어 반등 시도의 단서가 됩니다.",
        tone: "confirm",
      },
    };
  }
  const checklist = [
    {
      label: "약세 추세 조건(C<MA60 또는 MA20<MA60)",
      ok:
        feature.ma60 != null &&
        (candle.close < feature.ma60 || (feature.ma20 != null && feature.ma20 < feature.ma60)),
    },
    { label: "당일 양봉", ok: candle.close > candle.open },
    { label: "거래량 비율 <= 0.8", ok: feature.volRatio <= 0.8 },
  ];
  return {
    t: candle.time,
    type,
    label: "약한 반등(F)",
    desc: "약세 추세 구간의 저거래량 반등으로 지속성이 낮을 수 있습니다.",
    strength: clamp(Math.round((1 - feature.volRatio) * 6), 1, 5),
    ref: {
      volRatio,
      ma60: round2(feature.ma60),
    },
    details: {
      price,
      volume,
      volRatio,
      checklist,
      refLevel: round2(feature.ma60),
      message: "경고: 거래량 동반이 약해 반등 지속성은 제한적일 수 있습니다.",
      tone: "warning",
    },
  };
};

const buildVolumeSignals = (
  candles: Candle[],
  trend: number,
  ma20Series: Array<number | null>,
  ma60Series: Array<number | null>,
  volMa20Series: Array<number | null>,
): {
  volumePatterns: VolumePatternSignal[];
  volume: Signals["volume"];
} => {
  const patternEvents: VolumePatternSignal[] = [];
  for (let i = 20; i < candles.length; i += 1) {
    const feature = getVolumeBarFeatures(candles, ma20Series, ma60Series, volMa20Series, i);
    const types = detectVolumePatternTypes(candles[i], feature);
    for (const type of types) {
      patternEvents.push(toVolumePatternSignal(candles[i], type, feature));
    }
  }

  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const latestFeature = getVolumeBarFeatures(candles, ma20Series, ma60Series, volMa20Series, latestIndex);
  const latestTypes = new Set(detectVolumePatternTypes(latest, latestFeature));
  const trendDown = regimeFromTrend(trend) === "DOWN";

  let volumeScore = 50;
  if (latestTypes.has("BreakoutConfirmed")) volumeScore += 25;
  if (latestTypes.has("PullbackReaccumulation")) volumeScore += 15;
  if (latestTypes.has("CapitulationAbsorption")) volumeScore += trendDown ? 5 : 10;
  if (latestTypes.has("ClimaxUp")) volumeScore -= 10;
  if (latestTypes.has("Upthrust")) volumeScore -= 20;
  if (latestTypes.has("WeakBounce")) volumeScore -= 15;
  if (latestFeature.volRatio >= 1.5) volumeScore += 5;
  if (latestFeature.volRatio <= 0.6) volumeScore -= 10;
  volumeScore = clamp(volumeScore, 0, 100);

  const reasons: string[] = [];
  if (latestFeature.volRatio >= 1.5) {
    reasons.push(`거래량 비율 ${round2(latestFeature.volRatio)}배로 수급 유입이 강합니다.`);
  } else if (latestFeature.volRatio <= 0.6) {
    reasons.push(`거래량 비율 ${round2(latestFeature.volRatio)}배로 수급이 약합니다.`);
  } else {
    reasons.push(`거래량 비율 ${round2(latestFeature.volRatio)}배로 보통 수준입니다.`);
  }

  if (latestTypes.has("BreakoutConfirmed")) reasons.push("A 돌파확인: 20일 고점 돌파와 거래량 증가가 동반됐습니다.");
  if (latestTypes.has("Upthrust")) reasons.push("B 불트랩: 고점 돌파 후 종가가 밀리고 윗꼬리가 길어 경계가 필요합니다.");
  if (latestTypes.has("PullbackReaccumulation")) reasons.push("C 눌림 재축적: 추세 유지 구간에서 조정 거래량 감소 후 양봉 반등입니다.");
  if (latestTypes.has("ClimaxUp")) reasons.push("D 상승 클라이맥스: 과열형 장대양봉+대량거래로 단기 피크 가능성이 있습니다.");
  if (latestTypes.has("CapitulationAbsorption")) reasons.push("E 투매 흡수: 저점권 긴 아랫꼬리와 대량거래로 매수 흡수 신호입니다.");
  if (latestTypes.has("WeakBounce")) reasons.push("F 약한 반등: 추세 약세 구간의 저거래량 반등입니다.");
  if (latestTypes.size === 0) {
    reasons.push("당일 기준 뚜렷한 거래량 패턴은 감지되지 않았습니다.");
  }
  reasons.push(`거래량/수급 점수는 ${volumeScore}점입니다.`);

  return {
    volumePatterns: patternEvents.slice(-120),
    volume: {
      volRatio: round2(latestFeature.volRatio) ?? 1,
      turnover: round2(latestFeature.turnover) ?? 0,
      bodyPct: round2(latestFeature.bodyPct) ?? 0,
      upperWickPct: round2(latestFeature.upperWickPct) ?? 0,
      lowerWickPct: round2(latestFeature.lowerWickPct) ?? 0,
      pos20: round2(latestFeature.pos20) ?? 0.5,
      volumeScore,
      reasons: reasons.slice(0, 6),
    },
  };
};

const analyzeWithConfig = (
  candles: Candle[],
  config: TimeframeConfig,
  profile: InvestmentProfile,
): TimeframeAnalysis => {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const latest = candles[candles.length - 1];

  const maFastSeries = sma(closes, config.maFast);
  const maMidSeries = sma(closes, config.maMid);
  const maLongSeries = config.maLong ? sma(closes, config.maLong) : Array(closes.length).fill(null);
  const ma20Series = sma(closes, 20);
  const ma60Series = sma(closes, 60);
  const volMa20Series = sma(volumes, 20);
  const rsi14Series = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const atr14Series = atr(candles, 14);
  const macdSeries = macd(closes, 12, 26, 9);

  const maFast = lastValue(maFastSeries);
  const maMid = lastValue(maMidSeries);
  const maLong = lastValue(maLongSeries);
  const ma20 = lastValue(ma20Series);
  const ma60 = lastValue(ma60Series);
  const maMidPrev5 = valueAt(maMidSeries, 5);
  const rsi14 = lastValue(rsi14Series);
  const rsiPrev5 = valueAt(rsi14Series, 5);
  const macdLine = lastValue(macdSeries.line);
  const macdSignalLine = lastValue(macdSeries.signal);
  const macdHist = lastValue(macdSeries.hist);
  const macdBullish =
    macdLine != null && macdSignalLine != null ? macdLine >= macdSignalLine : false;
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

  const riskRaw = atrScore + bbScore + mddScore + sharpDropScore;
  let risk = riskRaw;
  risk = clamp(risk, 0, 100);
  const volumeSignal = buildVolumeSignals(
    candles,
    trend,
    ma20Series,
    ma60Series,
    volMa20Series,
  );

  const overall = overallFromScores(trend, momentum, risk);
  const profileScore = buildProfileScore(profile, trend, momentum, risk);
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
  const tradePlan = buildTradePlan(latest.close, sr.support, sr.resistance, atr14);

  const indicators: IndicatorSeries = {
    ma: {
      ma1Period: config.maFast,
      ma2Period: config.maMid,
      ma3Period: config.maLong ?? null,
      ma1: toIndicatorPoints(candles, maFastSeries),
      ma2: toIndicatorPoints(candles, maMidSeries),
      ma3: toIndicatorPoints(candles, maLongSeries),
    },
    rsi14: toIndicatorPoints(candles, rsi14Series),
    bb: {
      upper: toIndicatorPoints(candles, bb.upper),
      mid: toIndicatorPoints(candles, bb.mid),
      lower: toIndicatorPoints(candles, bb.lower),
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      line: toIndicatorPoints(candles, macdSeries.line),
      signal: toIndicatorPoints(candles, macdSeries.signal),
      hist: toIndicatorPoints(candles, macdSeries.hist),
    },
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
      macd: round2(macdLine),
      macdSignal: round2(macdSignalLine),
      macdHist: round2(macdHist),
      macdBullish,
    },
    risk: {
      atrPercent: round2(atrPct),
      atrBucket,
      bbPosition,
      mddN: round2(mdd20),
      sharpDropBar,
      breakdown: {
        atrScore,
        bbScore,
        mddScore,
        sharpDropScore,
        rawTotal: riskRaw,
        finalRisk: risk,
      },
    },
    volumePatterns: volumeSignal.volumePatterns,
    volume: volumeSignal.volume,
    fundamental: {
      per: null,
      pbr: null,
      eps: null,
      bps: null,
      marketCap: null,
      settlementMonth: null,
      label: "N/A",
      reasons: ["펀더멘털 데이터가 아직 제공되지 않았습니다."],
    },
    flow: {
      foreignNet: null,
      institutionNet: null,
      individualNet: null,
      programNet: null,
      foreignHoldRate: null,
      label: "N/A",
      reasons: ["수급 데이터가 아직 제공되지 않았습니다."],
    },
  };

  return {
    tf: config.tf,
    regime: regimeFromTrend(trend),
    summaryText,
    scores: { trend, momentum, risk, overall },
    profile: profileScore,
    signals,
    reasons: reasons.slice(0, 6),
    levels,
    tradePlan,
    indicators,
    candles,
  };
};

export const analyzeTimeframe = (
  tf: Timeframe,
  candles: Candle[],
  profile: InvestmentProfile = "short",
): TimeframeAnalysis => {
  const config = TF_CONFIG[tf];
  return analyzeWithConfig(candles, config, profile);
};

export const computeMultiFinal = (
  month: TimeframeAnalysis | null,
  week: TimeframeAnalysis | null,
  day: TimeframeAnalysis | null,
  profile: InvestmentProfile = "short",
): {
  overall: Overall;
  confidence: number;
  summary: string;
  profile: ProfileScore | null;
  warnings: string[];
} => {
  const warnings: string[] = [];
  const base = day ?? week ?? month;
  let overall: Overall = base?.profile.overall ?? base?.scores.overall ?? "CAUTION";

  if (!day) {
    warnings.push("일봉 데이터 부족: final은 제한적으로 계산");
  }

  if (month?.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("장기 역풍");
  }
  if (week?.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("중기 역풍");
  }
  if (month?.regime === "DOWN" && week?.regime === "DOWN") {
    overall = "CAUTION";
  }

  let confidence = 50;
  if (month) confidence += month.regime === "UP" ? 15 : month.regime === "SIDE" ? 5 : -15;
  if (week) confidence += week.regime === "UP" ? 15 : week.regime === "SIDE" ? 5 : -15;
  if (day) {
    if (day.scores.trend >= 70) confidence += 10;
    if (day.scores.momentum >= 60) confidence += 5;
    if (day.scores.risk < 35) confidence -= 15;
    if (day.signals.momentum.volumeAboveMa20) confidence += 5;

    let volumeAdjustment = day.signals.volume.volumeScore >= 70 ? 8 : day.signals.volume.volumeScore >= 50 ? 3 : -5;
    if (day.scores.risk < 35) {
      volumeAdjustment *= 0.5;
    }
    confidence += volumeAdjustment;
    warnings.push(
      `거래량/수급 점수 ${day.signals.volume.volumeScore}점 반영(${volumeAdjustment > 0 ? "+" : ""}${round2(volumeAdjustment)})`,
    );
  }

  // 명세: month/ week 동시 UP일 때 보너스(점수 or confidence 중 택1) -> confidence로 통일
  if (month?.regime === "UP" && week?.regime === "UP") {
    confidence += 10;
  }

  confidence = clamp(Math.round(confidence), 0, 100);

  const summaryBase = day?.summaryText ?? week?.summaryText ?? month?.summaryText ?? "분석 데이터 부족";
  const profileText = profile === "short" ? "단기 성향" : "중기 성향";
  const profileScore = day?.profile ?? base?.profile ?? null;

  return {
    overall,
    confidence,
    summary: `${summaryBase} · ${profileText}`,
    profile: profileScore,
    warnings,
  };
};

// Backward compatibility helper (day default analyzer)
export const analyzeCandles = (
  candles: Candle[],
): {
  scores: Scores;
  profile: ProfileScore;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  summaryText: string;
} => {
  const day = analyzeTimeframe("day", candles);
  return {
    scores: day.scores,
    profile: day.profile,
    signals: day.signals,
    reasons: day.reasons,
    levels: day.levels,
    summaryText: day.summaryText,
  };
};
