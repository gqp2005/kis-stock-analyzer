import stockList from "../../data/kr-stocks.json";
import { sma } from "./indicators";
import { analyzeTimeframe } from "./scoring";
import { detectVcpPattern } from "./vcp";
import type {
  Candle,
  PatternHit,
  ScreenerItem,
  ScreenerMarketFilter,
  ScreenerStrategyFilter,
  StrategyBacktestSummary,
  TimeframeAnalysis,
  VcpHit,
  VolumeHit,
  VolumePatternType,
} from "./types";
import { clamp, round2 } from "./utils";

interface StockEntry {
  code: string;
  name: string;
  market: string;
}

export interface ScreenerUniverseEntry {
  code: string;
  name: string;
  market: string;
}

interface PatternCandidate {
  hit: PatternHit;
  recencyScore: number;
}

export interface ScreenerStoredCandidate {
  code: string;
  name: string;
  market: string;
  lastClose: number;
  lastDate: string;
  levels: {
    support: number | null;
    resistance: number | null;
    neckline: number | null;
  };
  hits: {
    volume: VolumeHit;
    hs: PatternHit;
    ihs: PatternHit;
    vcp: VcpHit;
  };
  scoring: {
    all: { score: number; confidence: number };
    volume: { score: number; confidence: number };
    hs: { score: number; confidence: number };
    ihs: { score: number; confidence: number };
    vcp: { score: number; confidence: number };
  };
  reasons: {
    all: string[];
    volume: string[];
    hs: string[];
    ihs: string[];
    vcp: string[];
  };
  backtestSummary: {
    all: StrategyBacktestSummary | null;
    volume: StrategyBacktestSummary | null;
    hs: StrategyBacktestSummary | null;
    ihs: StrategyBacktestSummary | null;
    vcp: StrategyBacktestSummary | null;
  };
}

const stocks = stockList as StockEntry[];
const VALID_CODE_RE = /^\d{6}$/;
const EXCLUDE_NAME_RE =
  /(스팩|ETN|ETF|인버스|레버리지|커버드콜|회사채|채권|TDF|리츠|채권혼합)/i;
const SWING_LOOKBACK = 120;
const SWING_LEFT_RIGHT = 3;
const HS_HEAD_MIN_GAP = 0.03;
const HS_SHOULDER_MAX_DIFF = 0.04;

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toNullableRounded = (value: number | null): number | null => round2(value);
const toRounded = (value: number): number => round2(value) ?? value;

const defaultPatternHit = (reason: string): PatternHit => ({
  detected: false,
  state: "NONE",
  neckline: null,
  breakDate: null,
  target: null,
  score: 0,
  confidence: 0,
  reasons: [reason],
});

const defaultBacktestSummary = (): StrategyBacktestSummary | null => null;

const defaultVcpHit = (reason: string): VcpHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  resistanceR: null,
  distanceToR: null,
  breakDate: null,
  contractions: [],
  atrShrink: false,
  volumeDryUp: false,
  trendPass: false,
  atrPctMean20: null,
  atrPctMean120: null,
  reasons: [reason],
});

const getSwingHighs = (candles: Candle[], leftRight: number): Array<{ index: number; price: number; time: string }> => {
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

const getSwingLows = (candles: Candle[], leftRight: number): Array<{ index: number; price: number; time: string }> => {
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

const dateKey = (value: string): string => value.slice(0, 10);

const computeVolumeHit = (analysis: TimeframeAnalysis): VolumeHit => {
  const volRatio = analysis.signals.volume.volRatio;
  const patterns = analysis.signals.volumePatterns;
  const candles = analysis.candles;
  const recentKeys = new Set(candles.slice(-60).map((candle) => dateKey(candle.time)));
  const recentPatterns = patterns.filter((pattern) => recentKeys.has(dateKey(pattern.t)));
  const recentTypes = new Set(recentPatterns.map((pattern) => pattern.type));

  let confidence = 45;
  if (recentTypes.has("BreakoutConfirmed")) confidence += 20;
  if (recentTypes.has("PullbackReaccumulation")) confidence += 15;
  if (recentTypes.has("CapitulationAbsorption")) confidence += 10;
  if (recentTypes.has("Upthrust")) confidence -= 18;
  if (recentTypes.has("ClimaxUp")) confidence -= 10;
  if (recentTypes.has("WeakBounce")) confidence -= 8;
  if (volRatio >= 1.8) confidence += 10;
  else if (volRatio >= 1.2) confidence += 5;
  else if (volRatio <= 0.6) confidence -= 10;
  confidence = clamp(Math.round(confidence), 0, 100);

  const reasons: string[] = [];
  if (recentTypes.has("BreakoutConfirmed")) reasons.push("돌파 확증 패턴이 최근 60일 내 관측되었습니다.");
  if (recentTypes.has("PullbackReaccumulation")) reasons.push("눌림 재개 패턴으로 추세 연장 가능성을 시사합니다.");
  if (recentTypes.has("Upthrust")) reasons.push("돌파 실패형(불트랩) 패턴이 있어 추격 리스크가 있습니다.");
  if (recentTypes.has("ClimaxUp")) reasons.push("과열형 거래량이 관측되어 단기 피크를 경계해야 합니다.");
  if (recentTypes.has("CapitulationAbsorption")) reasons.push("투매 소진/흡수형 패턴이 저점 반등 단서를 제공합니다.");
  if (recentTypes.has("WeakBounce")) reasons.push("저거래량 약한 반등 패턴으로 지속성은 제한적입니다.");
  if (reasons.length === 0) reasons.push("최근 60일 내 강한 거래량 패턴은 제한적입니다.");
  reasons.push(`현재 거래량 비율은 ${volRatio.toFixed(2)}배입니다.`);

  const topTypes = recentPatterns
    .slice(-6)
    .reverse()
    .map((pattern) => pattern.type)
    .filter((type, index, arr) => arr.indexOf(type) === index)
    .slice(0, 4);

  return {
    score: analysis.signals.volume.volumeScore,
    confidence,
    volRatio: toRounded(volRatio),
    patterns: topTypes,
    reasons: reasons.slice(0, 6),
  };
};

const getLiquidityAdjustment = (candles: Candle[]): { adjustment: number; reason: string | null } => {
  const sample = candles.slice(-20);
  if (sample.length === 0) {
    return { adjustment: -15, reason: "거래대금 데이터가 부족해 신뢰도를 낮췄습니다." };
  }
  const avgTurnover = average(sample.map((candle) => candle.close * candle.volume));
  if (avgTurnover < 500_000_000) {
    return { adjustment: -18, reason: "최근 20일 평균 거래대금이 낮아 유동성 주의가 필요합니다." };
  }
  if (avgTurnover < 1_500_000_000) {
    return { adjustment: -10, reason: "최근 20일 평균 거래대금이 낮은 편이라 체결 리스크가 있습니다." };
  }
  if (avgTurnover < 3_000_000_000) {
    return { adjustment: -5, reason: "유동성이 보통 수준으로 대형주 대비 신뢰도를 일부 낮췄습니다." };
  }
  return { adjustment: 4, reason: null };
};

const getDataAdjustment = (candles: Candle[]): { adjustment: number; reason: string | null } => {
  if (candles.length >= 260) return { adjustment: 6, reason: null };
  if (candles.length >= 200) return { adjustment: 3, reason: null };
  if (candles.length >= 160) return { adjustment: -2, reason: "분석 캔들 수가 다소 적어 신뢰도를 소폭 낮췄습니다." };
  return { adjustment: -10, reason: "분석 캔들 수가 부족해 신뢰도를 낮췄습니다." };
};

const computeVcpConfidence = (vcp: VcpHit): number => {
  let confidence = 35;
  if (vcp.trendPass) confidence += 12;
  if (vcp.detected) confidence += 16;
  if (vcp.state === "CONFIRMED") confidence += 15;
  if (vcp.atrShrink) confidence += 10;
  if (vcp.volumeDryUp) confidence += 10;
  if (vcp.contractions.length >= 4) confidence += 12;
  else if (vcp.contractions.length === 3) confidence += 8;
  else if (vcp.contractions.length === 2) confidence += 5;

  if (vcp.distanceToR != null) {
    const absDistance = Math.abs(vcp.distanceToR);
    if (absDistance <= 0.03) confidence += 10;
    else if (absDistance <= 0.08) confidence += 6;
  }
  return clamp(Math.round(confidence), 0, 100);
};

const buildBullishSignalIndexes = (
  candles: Candle[],
  analysis: TimeframeAnalysis,
  ihs: PatternHit,
  vcp: VcpHit,
  strategy: ScreenerStrategyFilter,
): number[] => {
  const byDate = new Map<string, number>();
  candles.forEach((candle, index) => {
    byDate.set(dateKey(candle.time), index);
  });

  const indexes = new Set<number>();
  const volumeBullishTypes = new Set<VolumePatternType>([
    "BreakoutConfirmed",
    "PullbackReaccumulation",
    "CapitulationAbsorption",
  ]);

  if (strategy === "ALL" || strategy === "VOLUME") {
    for (const pattern of analysis.signals.volumePatterns) {
      if (!volumeBullishTypes.has(pattern.type)) continue;
      const idx = byDate.get(dateKey(pattern.t));
      if (idx != null) indexes.add(idx);
    }
  }

  if ((strategy === "ALL" || strategy === "IHS") && ihs.detected && ihs.breakDate) {
    const idx = byDate.get(dateKey(ihs.breakDate));
    if (idx != null) indexes.add(idx);
  }
  if ((strategy === "ALL" || strategy === "VCP") && vcp.detected && vcp.breakDate) {
    const idx = byDate.get(dateKey(vcp.breakDate));
    if (idx != null) indexes.add(idx);
  }

  return [...indexes].sort((a, b) => a - b);
};

const buildBacktestSummary = (
  candles: Candle[],
  signalIndexes: number[],
): StrategyBacktestSummary | null => {
  if (signalIndexes.length === 0) return null;

  const trades: number[] = [];
  const holdBars = 10;
  let cursor = 0;

  for (const signalIdx of signalIndexes) {
    if (signalIdx < cursor) continue;
    const entryIdx = signalIdx + 1;
    if (entryIdx >= candles.length) continue;

    const entryBar = candles[entryIdx];
    const entry = entryBar.open > 0 ? entryBar.open : entryBar.close;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const stop = entry * 0.95;
    const target = entry * 1.08;
    const timeoutIdx = Math.min(candles.length - 1, entryIdx + holdBars);

    let exitPrice = candles[timeoutIdx].close;
    let exitIdx = timeoutIdx;

    for (let i = entryIdx; i <= timeoutIdx; i += 1) {
      const bar = candles[i];
      if (bar.low <= stop) {
        exitPrice = stop;
        exitIdx = i;
        break;
      }
      if (bar.high >= target) {
        exitPrice = target;
        exitIdx = i;
        break;
      }
    }

    const ret = ((exitPrice - entry) / entry) * 100;
    trades.push(ret);
    cursor = exitIdx + 1;
  }

  if (trades.length === 0) return null;

  const wins = trades.filter((ret) => ret > 0);
  const losses = trades.filter((ret) => ret < 0);
  const grossProfit = wins.reduce((sum, ret) => sum + ret, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, ret) => sum + ret, 0));

  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const ret of trades) {
    equity *= 1 + ret / 100;
    peak = Math.max(peak, equity);
    const drawdown = (equity / peak - 1) * 100;
    mdd = Math.min(mdd, drawdown);
  }

  return {
    trades: trades.length,
    winRate: toNullableRounded((wins.length / trades.length) * 100),
    avgReturn: toNullableRounded(average(trades)),
    PF: grossLossAbs > 0 ? toNullableRounded(grossProfit / grossLossAbs) : null,
    MDD: toNullableRounded(mdd),
  };
};

const getOverallLabel = (score: number, confidence: number, hs: PatternHit): "GOOD" | "NEUTRAL" | "CAUTION" => {
  if (hs.state === "CONFIRMED" && score < 75) return "CAUTION";
  if (score >= 70 && confidence >= 60) return "GOOD";
  if (score >= 45 && confidence >= 40) return "NEUTRAL";
  return "CAUTION";
};

const clampScore = (value: number): number => clamp(Math.round(value), 0, 100);

export const getScreenerUniverse = (
  market: ScreenerMarketFilter,
  limit: number,
): ScreenerUniverseEntry[] => {
  const target = Math.max(20, Math.min(1200, Math.floor(limit)));
  const filtered = stocks
    .filter((item) => VALID_CODE_RE.test(item.code))
    .filter((item) => !EXCLUDE_NAME_RE.test(item.name))
    .filter((item) => (market === "ALL" ? true : item.market === market))
    .sort((a, b) => a.code.localeCompare(b.code));

  return filtered.slice(0, target).map((item) => ({
    code: item.code,
    name: item.name,
    market: item.market,
  }));
};

export const analyzeScreenerRawCandidate = (
  stock: ScreenerUniverseEntry,
  candles: Candle[],
  includeBacktest: boolean,
): ScreenerStoredCandidate | null => {
  if (candles.length < 140) return null;

  const day = analyzeTimeframe("day", candles.slice(-260));
  const hs = detectHeadShouldersPattern(day.candles);
  const ihs = detectInverseHeadShouldersPattern(day.candles);
  const volume = computeVolumeHit(day);
  const vcp = detectVcpPattern(day.candles);

  const dataAdj = getDataAdjustment(day.candles);
  const liquidityAdj = getLiquidityAdjustment(day.candles);
  const adjustment = dataAdj.adjustment + liquidityAdj.adjustment;

  const hsRisk = hs.detected ? hs.score : 50;
  const ihsStrength = ihs.detected ? ihs.score : 45;
  const vcpStrength = vcp.detected ? vcp.score : 35;

  const allScore = clampScore(
    0.35 * volume.score + 0.25 * ihsStrength + 0.2 * (100 - hsRisk) + 0.2 * vcpStrength,
  );
  const volumeScore = clampScore(volume.score);
  const hsScore = clampScore(hs.score);
  const ihsScore = clampScore(ihs.score);
  const vcpScore = clampScore(vcp.score);

  const volumeConfidence = clampScore(volume.confidence + adjustment);
  const hsConfidence = clampScore(hs.confidence + adjustment);
  const ihsConfidence = clampScore(ihs.confidence + adjustment);
  const vcpConfidence = clampScore(computeVcpConfidence(vcp) + adjustment);
  const allConfidence = clampScore(
    0.3 * volumeConfidence + 0.25 * ihsConfidence + 0.2 * hsConfidence + 0.25 * vcpConfidence,
  );

  const sharedReasons: string[] = [];
  if (dataAdj.reason) sharedReasons.push(dataAdj.reason);
  if (liquidityAdj.reason) sharedReasons.push(liquidityAdj.reason);
  if (hs.state === "CONFIRMED") sharedReasons.push("헤드앤숄더 확정 패턴이 감지되어 하방 리스크 경고가 있습니다.");
  if (ihs.state === "CONFIRMED") sharedReasons.push("역헤드앤숄더 확정 패턴이 감지되어 반등 가능성이 강화되었습니다.");
  if (vcp.detected) {
    sharedReasons.push(
      `VCP ${vcp.state === "CONFIRMED" ? "돌파 확정" : "잠재"} 패턴(${vcp.score}점)이 포착되었습니다.`,
    );
  }

  const allReasons = [
    ...volume.reasons,
    vcp.reasons[0],
    ihs.reasons[0],
    hs.reasons[0],
    ...sharedReasons,
  ].slice(0, 6);

  const volumeReasons = [...volume.reasons, ...sharedReasons].slice(0, 6);
  const hsReasons = [...hs.reasons, ...sharedReasons].slice(0, 6);
  const ihsReasons = [...ihs.reasons, ...sharedReasons].slice(0, 6);
  const vcpReasons = [...vcp.reasons, ...sharedReasons].slice(0, 6);

  const backtestAll = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "ALL"))
    : defaultBacktestSummary();
  const backtestVolume = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "VOLUME"))
    : defaultBacktestSummary();
  const backtestIhs = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "IHS"))
    : defaultBacktestSummary();
  const backtestVcp = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "VCP"))
    : defaultBacktestSummary();
  const backtestHs = defaultBacktestSummary();

  return {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    lastClose: toRounded(day.candles[day.candles.length - 1].close),
    lastDate: day.candles[day.candles.length - 1].time,
    levels: {
      support: day.levels.support,
      resistance: vcp.resistanceR ?? day.levels.resistance,
      neckline: ihs.neckline ?? hs.neckline,
    },
    hits: {
      volume,
      hs,
      ihs,
      vcp: vcp.detected ? vcp : defaultVcpHit(vcp.reasons[0] ?? "VCP 패턴 미감지"),
    },
    scoring: {
      all: { score: allScore, confidence: allConfidence },
      volume: { score: volumeScore, confidence: volumeConfidence },
      hs: { score: hsScore, confidence: hsConfidence },
      ihs: { score: ihsScore, confidence: ihsConfidence },
      vcp: { score: vcpScore, confidence: vcpConfidence },
    },
    reasons: {
      all: allReasons,
      volume: volumeReasons,
      hs: hsReasons,
      ihs: ihsReasons,
      vcp: vcpReasons,
    },
    backtestSummary: {
      all: backtestAll,
      volume: backtestVolume,
      hs: backtestHs,
      ihs: backtestIhs,
      vcp: backtestVcp,
    },
  };
};

const strategyKey = (
  strategy: ScreenerStrategyFilter,
): keyof ScreenerStoredCandidate["scoring"] => {
  if (strategy === "VOLUME") return "volume";
  if (strategy === "HS") return "hs";
  if (strategy === "IHS") return "ihs";
  if (strategy === "VCP") return "vcp";
  return "all";
};

export const materializeScreenerItem = (
  raw: ScreenerStoredCandidate,
  strategy: ScreenerStrategyFilter,
): ScreenerItem => {
  const key = strategyKey(strategy);
  const scoreTotal = raw.scoring[key].score;
  const confidence = raw.scoring[key].confidence;
  const overallLabel = getOverallLabel(scoreTotal, confidence, raw.hits.hs);

  return {
    code: raw.code,
    name: raw.name,
    market: raw.market,
    lastClose: raw.lastClose,
    lastDate: raw.lastDate,
    scoreTotal,
    confidence,
    overallLabel,
    hits: raw.hits,
    reasons: raw.reasons[key].slice(0, 6),
    levels: raw.levels,
    backtestSummary: raw.backtestSummary[key],
  };
};

export const isWarningCandidate = (item: ScreenerItem): boolean =>
  item.hits.hs.detected && item.hits.hs.state === "CONFIRMED";

const sortByScore = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);

const sortByHsRisk = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort(
    (a, b) =>
      b.hits.hs.score - a.hits.hs.score ||
      b.hits.hs.confidence - a.hits.hs.confidence ||
      b.confidence - a.confidence,
  );

export const buildScreenerView = (
  candidates: ScreenerStoredCandidate[],
  market: ScreenerMarketFilter,
  strategy: ScreenerStrategyFilter,
  count: number,
): {
  items: ScreenerItem[];
  warningItems: ScreenerItem[];
} => {
  const filteredCandidates = candidates.filter((candidate) =>
    market === "ALL" ? true : candidate.market === market,
  );
  const rawItems = filteredCandidates.map((candidate) =>
    materializeScreenerItem(candidate, strategy),
  );
  const warningItems = sortByHsRisk(rawItems.filter((item) => isWarningCandidate(item))).slice(
    0,
    Math.max(5, count),
  );
  const items =
    strategy === "VCP"
      ? rawItems.filter((item) => item.hits.vcp.detected)
      : rawItems;

  if (strategy === "HS") {
    return {
      items: sortByHsRisk(items).slice(0, count),
      warningItems,
    };
  }
  if (strategy === "VCP") {
    return {
      items: sortByScore(items).slice(0, count),
      warningItems,
    };
  }

  const normal = sortByScore(items.filter((item) => !isWarningCandidate(item)));
  const warnings = sortByScore(items.filter((item) => isWarningCandidate(item)));
  return {
    items: [...normal, ...warnings].slice(0, count),
    warningItems,
  };
};
