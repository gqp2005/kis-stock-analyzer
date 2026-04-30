import { sma } from "../indicators";
import type {
  Candle,
  PatternHit,
  ScreenerStrategyFilter,
  StrategyBacktestSummary,
  TimeframeAnalysis,
  VcpHit,
  VolumeHit,
  VolumePatternType,
  WashoutPullbackHit,
} from "../types";
import { clamp } from "../utils";
import type { ScreenerBenchmarkInput } from "./types";
import {
  average,
  clampScore,
  computeReturn,
  dateKey,
  toNullableRounded,
  toRounded,
} from "./utils";

export const washoutStatePriority = (state: WashoutPullbackHit["state"]): number => {
  if (state === "REBOUND_CONFIRMED") return 4;
  if (state === "PULLBACK_READY") return 3;
  if (state === "WASHOUT_CANDIDATE") return 2;
  if (state === "ANCHOR_DETECTED") return 1;
  return 0;
};

export const computeWashoutPosition = (
  lastClose: number,
  low: number | null,
  high: number | null,
): WashoutPullbackHit["position"] => {
  if (low == null || high == null) return "N/A";
  if (lastClose < low) return "BELOW_ZONE";
  if (lastClose > high) return "ABOVE_ZONE";
  return "IN_ZONE";
};

export const computeWashoutRiskPct = (
  entryRef: number | null,
  invalidPrice: number | null,
): number | null => {
  if (entryRef == null || invalidPrice == null || entryRef <= 0) return null;
  return Math.max(0, (entryRef - invalidPrice) / entryRef);
};

export const computeWashoutConfidence = (
  baseConfidence: number,
  riskPct: number | null,
  avgTurnover20: number,
): number => {
  let confidence = baseConfidence;
  if (riskPct != null) {
    if (riskPct <= 0.06) confidence += 8;
    else if (riskPct <= 0.1) confidence += 4;
    else if (riskPct > 0.15) confidence -= 12;
    else if (riskPct > 0.12) confidence -= 6;
  }
  if (avgTurnover20 < 1_000_000_000) confidence -= 12;
  else if (avgTurnover20 < 3_000_000_000) confidence -= 6;
  return clampScore(confidence);
};

export const getLiquidityAdjustment = (
  candles: Candle[],
): { adjustment: number; reason: string | null } => {
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

export const getDataAdjustment = (
  candles: Candle[],
): { adjustment: number; reason: string | null } => {
  if (candles.length >= 260) return { adjustment: 6, reason: null };
  if (candles.length >= 200) return { adjustment: 3, reason: null };
  if (candles.length >= 160) return { adjustment: -2, reason: "분석 캔들 수가 다소 적어 신뢰도를 소폭 낮췄습니다." };
  return { adjustment: -10, reason: "분석 캔들 수가 부족해 신뢰도를 낮췄습니다." };
};

export const computeRsLabel = (
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

export const scoreAdjustmentFromRs = (
  label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A",
): number => {
  if (label === "STRONG") return 6;
  if (label === "WEAK") return -8;
  if (label === "NEUTRAL") return 0;
  return -2;
};

export const confidenceAdjustmentFromRs = (
  label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A",
): number => {
  if (label === "STRONG") return 8;
  if (label === "WEAK") return -10;
  if (label === "NEUTRAL") return 0;
  return -3;
};

export const confidenceAdjustmentFromTuning = (
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

export const computeVcpConfidence = (vcp: VcpHit): number => {
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

export const computeVolumeHit = (analysis: TimeframeAnalysis): VolumeHit => {
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

export const buildBullishSignalIndexes = (
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

export const buildBacktestSummary = (
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

export const getOverallLabel = (
  score: number,
  confidence: number,
  hs: PatternHit,
): "GOOD" | "NEUTRAL" | "CAUTION" => {
  if (hs.state === "CONFIRMED" && score < 75) return "CAUTION";
  if (score >= 70 && confidence >= 60) return "GOOD";
  if (score >= 45 && confidence >= 40) return "NEUTRAL";
  return "CAUTION";
};
