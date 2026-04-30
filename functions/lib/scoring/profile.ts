import type {
  Candle,
  IndicatorPoint,
  InvestmentProfile,
  Overall,
  ProfileScore,
  Regime,
} from "../types";
import { clamp, round2 } from "../utils";

export const overallFromScores = (trend: number, momentum: number, risk: number): Overall => {
  if (trend >= 70 && momentum >= 55 && risk >= 45) return "GOOD";
  if (trend >= 40 && risk >= 35) return "NEUTRAL";
  return "CAUTION";
};

export const profileOverallFromScore = (score: number): Overall => {
  if (score >= 70) return "GOOD";
  if (score >= 45) return "NEUTRAL";
  return "CAUTION";
};

export const PROFILE_WEIGHTS: Record<
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

export const buildProfileScore = (
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

export const trendLabel = (trend: number): string => {
  if (trend >= 70) return "상승 추세";
  if (trend >= 40) return "혼조/횡보";
  return "하락 추세";
};

export const momentumLabel = (momentum: number): string => {
  if (momentum >= 65) return "모멘텀 강함";
  if (momentum >= 45) return "모멘텀 보통";
  return "모멘텀 약함";
};

export const riskLabel = (risk: number): string => {
  if (risk >= 70) return "변동성 낮음";
  if (risk >= 40) return "변동성 보통";
  return "변동성 높음";
};

export const regimeFromTrend = (trend: number): Regime => {
  if (trend >= 70) return "UP";
  if (trend >= 40) return "SIDE";
  return "DOWN";
};

export const toIndicatorPoints = (
  candles: Candle[],
  values: Array<number | null>,
): IndicatorPoint[] =>
  candles.map((candle, index) => ({
    time: candle.time,
    value: round2(values[index] ?? null),
  }));

export const downgradeOverall = (overall: Overall): Overall => {
  if (overall === "GOOD") return "NEUTRAL";
  if (overall === "NEUTRAL") return "CAUTION";
  return "CAUTION";
};
