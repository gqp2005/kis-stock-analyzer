import type {
  WangStrategyDailyExecutionContext,
  WangStrategyExecutionState,
  WangStrategyPhase,
  WangStrategyWeeklyPhaseContext,
} from "../wangTypes";
import { clamp } from "../utils";
import {
  WANG_EXECUTION_STATE_LABEL,
  WANG_PHASE_LABEL,
  WANG_STRATEGY_CONSTANTS,
} from "../wangStrategyConstants";
import type { WangCycleDetection } from "./cycleDetect";
import { toRoundedNumber } from "./utils";

export const buildWeeklyPhaseContext = (
  detection: WangCycleDetection,
): WangStrategyWeeklyPhaseContext => {
  const weights = WANG_STRATEGY_CONSTANTS.weeklyPhaseWeights;
  const score = clamp(
    (detection.lifeIndex >= 0 ? weights.life : 0) +
      (detection.baseIndices.length > 0 ? weights.base : 0) +
      (detection.risingIndices.length > 0 ? weights.rising : 0) +
      (detection.elasticIndices.length > 0 ? weights.elastic : 0) +
      (detection.minIndex >= 0 ? weights.min : 0) +
      (detection.zoneLow != null && detection.zoneHigh != null ? weights.zone : 0) +
      (detection.latestRetestIndex >= 0 ? weights.retest : 0) +
      (detection.relativeShortVolumeScore >= WANG_STRATEGY_CONSTANTS.shortVolumeEntryScoreThreshold
        ? weights.shortVolume
        : 0) +
      (detection.cooldownReady ? weights.cooldown : 0) +
      (detection.secondSurgeIndex >= 0 ? weights.breakout : 0) -
      (detection.recentHalfExitWarning ? weights.halfExitPenalty : 0),
    0,
    100,
  );

  const confidence = clamp(
    Math.round(
      score * 0.78 +
        (detection.currentPhase === "MIN_VOLUME" ? 8 : 0) +
        (detection.currentPhase === "REACCUMULATION" ? 12 : 0),
    ),
    0,
    100,
  );

  const stageSummary =
    detection.currentPhase === "REACCUMULATION"
      ? "주봉 minimum 이후 zone을 다시 확인하는 단계입니다."
      : detection.currentPhase === "MIN_VOLUME"
        ? "주봉 기준거래량 이후 절대 최저 거래량이 확인돼 최소거래량 구간을 설명할 수 있습니다."
        : detection.currentPhase === "ELASTIC_VOLUME"
          ? "주봉 탄력거래량 단계까지는 왔지만 minimum 확인 전이라 실행보다 구조 해석이 우선입니다."
          : detection.currentPhase === "RISING_VOLUME"
            ? "상승거래량 단계로 구조는 좋아지지만 아직 눌림과 zone 설명은 이릅니다."
            : detection.currentPhase === "BASE_VOLUME"
              ? "반복 기준거래량을 확인하는 단계입니다."
              : detection.currentPhase === "LIFE_VOLUME"
                ? "최대 거래량 기준점은 확보됐지만 반복 기준거래량 축적이 더 필요합니다."
                : "주봉 phase를 확정할 근거가 아직 부족합니다.";

  const headline =
    detection.currentPhase === "NONE"
      ? "주봉 phase 미확정"
      : `주봉 ${WANG_PHASE_LABEL[detection.currentPhase as Exclude<WangStrategyPhase, "NONE">]}`;

  return {
    phase: detection.currentPhase,
    score,
    confidence,
    headline,
    stageSummary,
    referenceVolume: Math.round(detection.referenceVolume),
    averageVolume: Math.round(detection.averageVolume),
    maxVolume: Math.round(detection.maxVolume),
    minVolume: detection.minVolume != null ? Math.round(detection.minVolume) : null,
    baseRepeatCount: detection.baseIndices.length,
    risingCount: detection.risingIndices.length,
    elasticCount: detection.elasticIndices.length,
    hasMinVolume: detection.minIndex >= 0,
    hasWeeklyZone: detection.zoneLow != null && detection.zoneHigh != null,
    relativeShortVolumeScore: detection.relativeShortVolumeScore,
    cooldownBarsFromLife: detection.cooldownBarsFromLife,
    cooldownReady: detection.cooldownReady,
    breakoutReady: detection.secondSurgeIndex >= 0,
    recentHalfExitWarning: detection.recentHalfExitWarning,
    secondSurgeTime: detection.secondSurgeIndex >= 0 ? detection.candles[detection.secondSurgeIndex].time : null,
    halfExitTime: detection.halfExitIndex >= 0 ? detection.candles[detection.halfExitIndex].time : null,
    anchorTime:
      detection.primaryVolumeIndex >= 0
        ? detection.candles[detection.primaryVolumeIndex].time
        : detection.lifeIndex >= 0
          ? detection.candles[detection.lifeIndex].time
          : null,
  };
};

export const buildDailyExecutionContext = (params: {
  dayDetection: WangCycleDetection;
  weeklyPhase: WangStrategyWeeklyPhaseContext;
  projectedDayZone:
    | {
        startIndex: number;
        endIndex: number;
        low: number;
        high: number;
      }
    | null;
  projectedDayInZone: boolean;
  projectedDayRetestIndex: number;
  projectedDayBrokeZone: boolean;
  dailyRebaseIndices: number[];
}): WangStrategyDailyExecutionContext => {
  const {
    dayDetection,
    weeklyPhase,
    projectedDayZone,
    projectedDayInZone,
    projectedDayRetestIndex,
    projectedDayBrokeZone,
    dailyRebaseIndices,
  } = params;

  const zoneWidthPct =
    projectedDayZone != null && projectedDayZone.low > 0
      ? toRoundedNumber(((projectedDayZone.high - projectedDayZone.low) / projectedDayZone.low) * 100)
      : null;

  let state: WangStrategyExecutionState = "WAIT_WEEKLY_STRUCTURE";
  if (projectedDayBrokeZone) {
    state = "AVOID_BREAKDOWN";
  } else if (
    projectedDayZone != null &&
    (dayDetection.close > projectedDayZone.high * (1 + WANG_STRATEGY_CONSTANTS.overheatFromZonePct) ||
      (dayDetection.ma20DistancePct != null &&
        dayDetection.ma20DistancePct >= WANG_STRATEGY_CONSTANTS.overheatFromMa20Pct * 100))
  ) {
    state = "AVOID_OVERHEAT";
  } else if (weeklyPhase.phase === "MIN_VOLUME" || weeklyPhase.phase === "REACCUMULATION") {
    if (projectedDayZone != null && dayDetection.belowMa20 && projectedDayRetestIndex >= 0) {
      state = "READY_ON_RETEST";
    } else if (projectedDayZone != null && dayDetection.belowMa20 && projectedDayInZone) {
      state = "READY_ON_ZONE";
    } else if (projectedDayZone != null) {
      state = "WAIT_PULLBACK";
    }
  }

  const weights = WANG_STRATEGY_CONSTANTS.dailyExecutionWeights;
  const score = clamp(
    (weeklyPhase.phase === "MIN_VOLUME" || weeklyPhase.phase === "REACCUMULATION" ? weights.weeklyReady : 0) +
      (projectedDayZone != null ? weights.projectedZone : 0) +
      (dayDetection.belowMa20 ? weights.belowMa20 : 0) +
      (projectedDayInZone ? weights.inZone : 0) +
      (projectedDayRetestIndex >= 0 ? weights.retest : 0) +
      (dailyRebaseIndices.length > 0 ? weights.rebase : 0) -
      (projectedDayBrokeZone ? 45 : 0) -
      (state === "AVOID_OVERHEAT" ? 18 : 0),
    0,
    100,
  );

  const confidence = clamp(
    Math.round(
      score * 0.8 +
        (state === "READY_ON_RETEST" ? 10 : 0) +
        (state === "READY_ON_ZONE" ? 6 : 0) -
        (state === "AVOID_BREAKDOWN" ? 12 : 0),
    ),
    0,
    100,
  );

  const headline = `${WANG_EXECUTION_STATE_LABEL[state]} · 일봉 실행 판단`;
  const action =
    state === "READY_ON_RETEST"
      ? "주봉 zone 재접근과 20일선 아래 조건이 겹쳐 분할 적립 후보로 볼 수 있습니다."
      : state === "READY_ON_ZONE"
        ? "일봉이 주봉 zone 안으로 진입해 적립 관찰을 시작할 수 있습니다."
        : state === "WAIT_PULLBACK"
          ? "주봉 구조는 나왔지만 일봉 당김과 20일선 조건이 더 필요합니다."
          : state === "AVOID_BREAKDOWN"
            ? "zone 하단 이탈이면 적립 가설보다 방어와 재확인이 우선입니다."
            : state === "AVOID_OVERHEAT"
              ? "zone 대비 과열이라 추격 매수보다 다음 눌림을 기다리는 편이 낫습니다."
              : "주봉 phase가 아직 minimum 이전이라 일봉 실행보다 구조 관찰이 우선입니다.";

  return {
    state,
    score,
    confidence,
    headline,
    action,
    belowMa20: dayDetection.belowMa20,
    hasProjectedZone: projectedDayZone != null,
    inProjectedZone: projectedDayInZone,
    retestDetected: projectedDayRetestIndex >= 0,
    dailyRebaseCount: dailyRebaseIndices.length,
    zoneWidthPct,
    lastRetestTime: projectedDayRetestIndex >= 0 ? dayDetection.candles[projectedDayRetestIndex].time : null,
  };
};
