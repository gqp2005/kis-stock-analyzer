import type {
  Candle,
  Signals,
  VolumePatternSignal,
  VolumePatternType,
} from "../types";
import { clamp, round2 } from "../utils";
import { average, pctWithinRange } from "./utils";
import { regimeFromTrend } from "./profile";

export interface VolumeBarFeatures {
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
  const sample = candles.slice(Math.max(0, index - 15), index);
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

export const getVolumeBarFeatures = (
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

export const detectVolumePatternTypes = (
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

export const toVolumePatternSignal = (
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

export const buildVolumeSignals = (
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
