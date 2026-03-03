import stockList from "../../data/kr-stocks.json";
import { sma } from "./indicators";
import { analyzeTimeframe } from "./scoring";
import { detectVcpPattern } from "./vcp";
import { runWalkForwardTuning, type StrategyThresholds } from "./walkforward";
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

export interface ScreenerBenchmarkInput {
  index: "KOSPI" | "KOSDAQ";
  candles: Candle[];
}

export type ScreenerBenchmarkMap = Partial<
  Record<"KOSPI" | "KOSDAQ", ScreenerBenchmarkInput>
>;

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
  rs: {
    benchmark: "KOSPI" | "KOSDAQ";
    ret63Diff: number | null;
    label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A";
  };
  tuning: {
    thresholds: StrategyThresholds;
    quality: number | null;
  } | null;
}

const stocks = stockList as StockEntry[];
const VALID_CODE_RE = /^\d{6}$/;
const EXCLUDE_NAME_RE =
  /(스팩|ETN|ETF|인버스|레버리지|커버드콜|회사채|채권|TDF|리츠|채권혼합)/i;
const SWING_LOOKBACK = 120;
const SWING_LEFT_RIGHT = 3;
const HS_HEAD_MIN_GAP = 0.03;
const HS_SHOULDER_MAX_DIFF = 0.04;
const QUALITY_MIN_AVG_TURNOVER_20 = 700_000_000;
const QUALITY_MAX_ZERO_VOLUME_DAYS_20 = 2;
const QUALITY_MAX_CONSECUTIVE_ZERO_VOLUME = 2;
const QUALITY_MAX_CRASH_DAYS_60 = 2;
const QUALITY_MAX_GAP_CRASH_DAYS_60 = 2;
const QUALITY_GAP_CRASH_RETURN = -0.12;
const QUALITY_DAILY_CRASH_RETURN = -0.15;

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toNullableRounded = (value: number | null): number | null => round2(value);
const toRounded = (value: number): number => round2(value) ?? value;

const averageNullable = (values: Array<number | null | undefined>): number | null => {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return average(filtered);
};

interface QualityGateResult {
  passed: boolean;
  reasons: string[];
}

const evaluateQualityGate = (candles: Candle[]): QualityGateResult => {
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

const computeReturn = (candles: Candle[], bars: number): number | null => {
  if (candles.length <= bars) return null;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 1 - bars].close;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return last / prev - 1;
};

const computeRsLabel = (
  stockCandles: Candle[],
  benchmark: ScreenerBenchmarkInput | null,
): {
  benchmark: "KOSPI" | "KOSDAQ";
  ret63Diff: number | null;
  label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A";
} => {
  if (!benchmark) {
    return { benchmark: "KOSPI", ret63Diff: null, label: "N/A" };
  }

  const stockRet63 = computeReturn(stockCandles, 63);
  const indexRet63 = computeReturn(benchmark.candles, 63);
  const ret63Diff =
    stockRet63 != null && indexRet63 != null ? stockRet63 - indexRet63 : null;

  const benchMap = new Map(
    benchmark.candles.map((candle) => [candle.time.slice(0, 10), candle.close]),
  );
  const rsSeries: number[] = [];
  for (const candle of stockCandles) {
    const benchClose = benchMap.get(candle.time.slice(0, 10));
    if (benchClose == null || benchClose <= 0 || candle.close <= 0) continue;
    rsSeries.push(candle.close / benchClose);
  }
  const rsMa30 = sma(rsSeries, 30);
  const rsLatest = rsSeries[rsSeries.length - 1] ?? null;
  const rsLatestMa30 = rsMa30[rsMa30.length - 1] ?? null;

  let label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A" = "N/A";
  if (ret63Diff != null && rsLatest != null && rsLatestMa30 != null) {
    if (ret63Diff >= 0.05 && rsLatest >= rsLatestMa30) label = "STRONG";
    else if (ret63Diff <= -0.05 || rsLatest < rsLatestMa30 * 0.97) label = "WEAK";
    else label = "NEUTRAL";
  }

  return {
    benchmark: benchmark.index,
    ret63Diff: toNullableRounded(ret63Diff),
    label,
  };
};

const scoreAdjustmentFromRs = (label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A"): number => {
  if (label === "STRONG") return 6;
  if (label === "WEAK") return -8;
  if (label === "NEUTRAL") return 0;
  return -2;
};

const confidenceAdjustmentFromRs = (label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A"): number => {
  if (label === "STRONG") return 8;
  if (label === "WEAK") return -10;
  if (label === "NEUTRAL") return 0;
  return -3;
};

const confidenceAdjustmentFromTuning = (
  score: number,
  threshold: number,
  quality: number,
): number => {
  if (quality <= 0) return 0;
  const qualityFactor = quality >= 70 ? 1 : quality >= 45 ? 0.7 : 0.4;
  if (score >= threshold + 10) return Math.round(8 * qualityFactor);
  if (score >= threshold) return Math.round(4 * qualityFactor);
  if (score >= threshold - 8) return Math.round(1 * qualityFactor);
  return Math.round(-6 * qualityFactor);
};

const computeVcpConfidence = (vcp: VcpHit): number => {
  let confidence = 35;
  if (vcp.trendPass) confidence += 12;
  if (vcp.detected) confidence += 16;
  if (vcp.state === "CONFIRMED") confidence += 15;
  if (vcp.atr.shrink) confidence += 10;
  if (vcp.volume.dryUp) confidence += vcp.volume.dryUpStrength === "STRONG" ? 13 : 8;
  if (vcp.rs.ok) confidence += 10;
  if ((vcp.rs.rsRet63 ?? -1) > 0) confidence += 5;
  if (vcp.rs.rsVsMa90) confidence += 6;
  if (vcp.leadership.label === "STRONG") confidence += 12;
  else if (vcp.leadership.label === "OK") confidence += 6;
  if (vcp.pivot.pivotReady) confidence += 10;
  if (vcp.pivot.label === "BREAKOUT_CONFIRMED") confidence += 8;
  if (vcp.contractions.length >= 4) confidence += 12;
  else if (vcp.contractions.length === 3) confidence += 8;
  else if (vcp.contractions.length === 2) confidence += 5;

  if (vcp.distanceToR != null) {
    const absDistance = Math.abs(vcp.distanceToR);
    if (absDistance <= 0.03) confidence += 10;
    else if (absDistance <= 0.08) confidence += 6;
  }
  if (vcp.risk.riskGrade === "HIGH") confidence -= 8;
  else if (vcp.risk.riskGrade === "BAD") confidence -= 20;
  if (!vcp.quality.baseLenOk) confidence -= 5;
  if ((vcp.quality.baseDepthMax ?? 0) > 0.35) confidence -= 12;
  if (vcp.quality.gapCrashFlags >= 2) confidence -= 15;
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
  benchmarks: ScreenerBenchmarkMap | null = null,
): ScreenerStoredCandidate | null => {
  if (candles.length < 140) return null;

  const marketKey: "KOSPI" | "KOSDAQ" = stock.market === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
  const marketBenchmark = benchmarks?.[marketKey] ?? null;
  const day = analyzeTimeframe("day", candles.slice(-260));
  const qualityGate = evaluateQualityGate(day.candles);
  if (!qualityGate.passed) return null;
  const hs = detectHeadShouldersPattern(day.candles);
  const ihs = detectInverseHeadShouldersPattern(day.candles);
  const volume = computeVolumeHit(day);
  const vcp = detectVcpPattern(day.candles, marketBenchmark);
  const rsInfo = computeRsLabel(day.candles, marketBenchmark);
  const rsScoreAdj = scoreAdjustmentFromRs(rsInfo.label);
  const rsConfidenceAdj = confidenceAdjustmentFromRs(rsInfo.label);

  const tuningResult = runWalkForwardTuning(day.candles);
  const tuningQuality = toNullableRounded(
    average([
      tuningResult.metrics.volume.quality,
      tuningResult.metrics.hs.quality,
      tuningResult.metrics.ihs.quality,
      tuningResult.metrics.vcp.quality,
    ]),
  );
  const tuningScoreAdj =
    (volume.score >= tuningResult.thresholds.volume ? 2 : -2) +
    (ihs.score >= tuningResult.thresholds.ihs ? 2 : -2) +
    (vcp.score >= tuningResult.thresholds.vcp ? 3 : -3) +
    (hs.score >= tuningResult.thresholds.hs ? -2 : 1);

  const dataAdj = getDataAdjustment(day.candles);
  const liquidityAdj = getLiquidityAdjustment(day.candles);
  const adjustment = dataAdj.adjustment + liquidityAdj.adjustment + rsConfidenceAdj;

  const hsRisk = hs.detected ? hs.score : 50;
  const ihsStrength = ihs.detected ? ihs.score : 45;
  const vcpStrength = vcp.detected ? vcp.score : 35;

  const allScore = clampScore(
    0.35 * volume.score +
      0.25 * ihsStrength +
      0.2 * (100 - hsRisk) +
      0.2 * vcpStrength +
      rsScoreAdj +
      tuningScoreAdj,
  );
  const volumeScore = clampScore(volume.score);
  const hsScore = clampScore(hs.score);
  const ihsScore = clampScore(ihs.score);
  const vcpScore = clampScore(vcp.score);

  const volumeConfidence = clampScore(
    volume.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        volume.score,
        tuningResult.thresholds.volume,
        tuningResult.metrics.volume.quality,
      ),
  );
  const hsConfidence = clampScore(
    hs.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        hs.score,
        tuningResult.thresholds.hs,
        tuningResult.metrics.hs.quality,
      ),
  );
  const ihsConfidence = clampScore(
    ihs.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        ihs.score,
        tuningResult.thresholds.ihs,
        tuningResult.metrics.ihs.quality,
      ),
  );
  const vcpConfidence = clampScore(
    computeVcpConfidence(vcp) +
      adjustment +
      confidenceAdjustmentFromTuning(
        vcp.score,
        tuningResult.thresholds.vcp,
        tuningResult.metrics.vcp.quality,
      ),
  );
  const allConfidence = clampScore(
    0.3 * volumeConfidence + 0.25 * ihsConfidence + 0.2 * hsConfidence + 0.25 * vcpConfidence,
  );

  const sharedReasons: string[] = [];
  if (dataAdj.reason) sharedReasons.push(dataAdj.reason);
  if (liquidityAdj.reason) sharedReasons.push(liquidityAdj.reason);
  sharedReasons.push("유동성/거래정지/급락 품질 필터를 통과한 종목입니다.");
  if (hs.state === "CONFIRMED") sharedReasons.push("헤드앤숄더 확정 패턴이 감지되어 하방 리스크 경고가 있습니다.");
  if (ihs.state === "CONFIRMED") sharedReasons.push("역헤드앤숄더 확정 패턴이 감지되어 반등 가능성이 강화되었습니다.");
  if (vcp.detected) {
    sharedReasons.push(
      `VCP ${vcp.state === "CONFIRMED" ? "돌파 확정" : "잠재"} 패턴(${vcp.score}점)이 포착되었습니다.`,
    );
  }
  if (vcp.pivot.pivotReady) {
    sharedReasons.push("VCP 피벗 준비 조건(distance/dry-up/depth)이 충족되었습니다.");
  }
  if (vcp.risk.riskGrade === "HIGH") {
    sharedReasons.push("VCP 리스크가 다소 높은 구간(10~12%)입니다.");
  }
  if (vcp.risk.riskGrade === "BAD") {
    sharedReasons.push("VCP 리스크가 과도한 구간(>12%)으로 후보 우선순위를 낮췄습니다.");
  }
  if (vcp.quality.gapCrashFlags >= 2) {
    sharedReasons.push("최근 급락 플래그가 누적되어 품질 필터가 보수적으로 작동했습니다.");
  }
  if (!vcp.rs.ok) {
    sharedReasons.push("VCP RS 필터가 미충족이거나 지수 데이터가 부족합니다.");
  }
  if (rsInfo.label === "STRONG") {
    sharedReasons.push(
      `${rsInfo.benchmark} 대비 상대강도가 강합니다${
        rsInfo.ret63Diff != null ? ` (63일 초과수익 ${(rsInfo.ret63Diff * 100).toFixed(1)}%)` : ""
      }.`,
    );
  } else if (rsInfo.label === "WEAK") {
    sharedReasons.push(
      `${rsInfo.benchmark} 대비 상대강도가 약해 보수적으로 반영했습니다${
        rsInfo.ret63Diff != null ? ` (63일 열위 ${(rsInfo.ret63Diff * 100).toFixed(1)}%)` : ""
      }.`,
    );
  } else if (rsInfo.label === "N/A") {
    sharedReasons.push("지수 상대강도 데이터가 부족해 RS 필터를 약하게 적용했습니다.");
  }
  sharedReasons.push(
    `워크포워드 튜닝 임계값 V/H/I/VCP=${tuningResult.thresholds.volume}/${tuningResult.thresholds.hs}/${tuningResult.thresholds.ihs}/${tuningResult.thresholds.vcp}, 품질 ${tuningQuality ?? 0}점.`,
  );

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
      resistance: vcp.resistance.price ?? day.levels.resistance,
      neckline: ihs.neckline ?? hs.neckline,
    },
    hits: {
      volume,
      hs,
      ihs,
      vcp,
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
    rs: rsInfo,
    tuning: {
      thresholds: tuningResult.thresholds,
      quality: tuningQuality,
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
  const rs =
    raw.rs ??
    ({
      benchmark: "KOSPI",
      ret63Diff: null,
      label: "N/A",
    } as const);

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
    rs,
    tuning: raw.tuning ?? null,
  };
};

export const isWarningCandidate = (item: ScreenerItem): boolean =>
  item.hits.hs.detected && item.hits.hs.state === "CONFIRMED";

const isRsQualified = (item: ScreenerItem): boolean =>
  item.rs.label !== "WEAK";

const sortByScore = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);

const sortByHsRisk = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort(
    (a, b) =>
      b.hits.hs.score - a.hits.hs.score ||
      b.hits.hs.confidence - a.hits.hs.confidence ||
      b.confidence - a.confidence,
  );

interface ScreenerAdaptiveCutoffs {
  all: number;
  volume: number;
  hs: number;
  ihs: number;
  vcp: number;
}

const DEFAULT_ADAPTIVE_CUTOFFS: ScreenerAdaptiveCutoffs = {
  all: 50,
  volume: 58,
  hs: 68,
  ihs: 62,
  vcp: 80,
};

const clampCutoff = (value: number, min: number, max: number): number =>
  clamp(Math.round(value), min, max);

const computeStrategyAdjustment = (
  summaries: Array<StrategyBacktestSummary | null | undefined>,
  tuningQualities: Array<number | null | undefined>,
): number => {
  const valid = summaries.filter(
    (summary): summary is StrategyBacktestSummary =>
      summary != null &&
      summary.trades >= 3 &&
      summary.winRate != null &&
      summary.PF != null &&
      summary.MDD != null,
  );

  if (valid.length === 0) return 0;

  const avgWinRate = average(valid.map((summary) => summary.winRate as number));
  const avgPf = average(valid.map((summary) => summary.PF as number));
  const avgMdd = average(valid.map((summary) => summary.MDD as number));
  const avgTuningQuality = averageNullable(tuningQualities) ?? 0;

  let adjustment = 0;
  if (avgWinRate < 45) adjustment += 4;
  else if (avgWinRate >= 57) adjustment -= 2;

  if (avgPf < 1.0) adjustment += 4;
  else if (avgPf >= 1.25) adjustment -= 2;

  if (avgMdd <= -18) adjustment += 3;
  else if (avgMdd >= -10) adjustment -= 1;

  if (valid.length < 20) adjustment += 1;
  if (avgTuningQuality < 45) adjustment += 2;
  else if (avgTuningQuality >= 70) adjustment -= 1;

  return adjustment;
};

const deriveAdaptiveCutoffs = (candidates: ScreenerStoredCandidate[]): ScreenerAdaptiveCutoffs => {
  if (candidates.length === 0) return DEFAULT_ADAPTIVE_CUTOFFS;

  const tuningQualities = candidates.map((candidate) => candidate.tuning?.quality);
  const allAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.all),
    tuningQualities,
  );
  const volumeAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.volume),
    tuningQualities,
  );
  const hsAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.hs),
    tuningQualities,
  );
  const ihsAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.ihs),
    tuningQualities,
  );
  const vcpAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.vcp),
    tuningQualities,
  );

  return {
    all: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.all + allAdj, 40, 75),
    volume: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.volume + volumeAdj, 50, 85),
    hs: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.hs + hsAdj, 55, 88),
    ihs: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.ihs + ihsAdj, 55, 88),
    vcp: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.vcp + vcpAdj, 70, 95),
  };
};

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
  const adaptiveCutoffs = deriveAdaptiveCutoffs(filteredCandidates);
  const rawItems = filteredCandidates.map((candidate) =>
    materializeScreenerItem(candidate, strategy),
  );
  const warningItems = sortByHsRisk(rawItems.filter((item) => isWarningCandidate(item))).slice(
    0,
    Math.max(5, count),
  );
  const rsFilteredItems =
    strategy === "HS"
      ? rawItems
      : rawItems.filter((item) => isRsQualified(item));

  const items = rsFilteredItems.filter((item) => {
    if (strategy === "VOLUME") return item.scoreTotal >= adaptiveCutoffs.volume;
    if (strategy === "HS") return item.scoreTotal >= adaptiveCutoffs.hs;
    if (strategy === "IHS") return item.scoreTotal >= adaptiveCutoffs.ihs;
    if (strategy === "VCP") {
      return item.hits.vcp.detected && item.hits.vcp.score >= adaptiveCutoffs.vcp;
    }
    return item.scoreTotal >= adaptiveCutoffs.all || isWarningCandidate(item);
  });

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
