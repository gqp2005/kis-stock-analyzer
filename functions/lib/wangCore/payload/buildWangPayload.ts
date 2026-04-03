import type { Candle, IndicatorPoint } from "../../types";
import type {
  WangDailyDetectorBundle,
  WangWeeklyDetectorBundle,
  WangStrategyPhase,
  WangStrategyExecutionState,
} from "../types";
import type {
  WangStrategyChartOverlays,
  WangStrategyChecklistItem,
  WangStrategyDailyExecutionContext,
  WangStrategyEventImpactContext,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyMinVolumeRegionContext,
  WangStrategyMovingAverageContext,
  WangStrategyPayload,
  WangStrategyPhaseItem,
  WangStrategyPhaseOccurrence,
  WangStrategyPsychologyFlipContext,
  WangStrategyRiskNote,
  WangStrategyStrongStockContext,
  WangStrategySummary,
  WangStrategyTimeframeSummary,
  WangStrategyTradeZone,
  WangStrategyTrainingNote,
  WangStrategyWeeklyPhaseContext,
} from "../../wangTypes";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const phaseLabel = (phase: WangStrategyPhase): string => {
  switch (phase) {
    case "LIFE_VOLUME":
      return "인생거래량";
    case "BASE_VOLUME":
      return "기준거래량";
    case "RISING_VOLUME":
      return "상승거래량";
    case "ELASTIC_VOLUME":
      return "탄력거래량";
    case "MIN_VOLUME":
      return "최소거래량";
    case "REACCUMULATION":
      return "재축적";
    default:
      return "미확정";
  }
};

const executionLabel = (state: WangStrategyExecutionState): string => {
  switch (state) {
    case "READY_ON_RETEST":
      return "재접근 적립";
    case "READY_ON_ZONE":
      return "zone 적립 관찰";
    case "READY_ON_DISCOUNT":
      return "20일선 할인 적립";
    case "READY_ON_PSYCHOLOGY_FLIP":
      return "심리 전환 적립";
    case "AVOID_BREAKDOWN":
      return "구조 이탈 경계";
    case "AVOID_EVENT_RISK":
      return "이슈 리스크 경계";
    case "AVOID_OVERHEAT":
      return "과열 추격 금지";
    case "WAIT_MIN_REGION":
      return "최소거래량 구간 대기";
    case "WAIT_PULLBACK":
      return "눌림 대기";
    default:
      return "주봉 구조 대기";
  }
};

const mapInterpretation = (state: WangStrategyExecutionState): WangStrategyInterpretation => {
  switch (state) {
    case "READY_ON_DISCOUNT":
    case "READY_ON_ZONE":
    case "READY_ON_RETEST":
    case "READY_ON_PSYCHOLOGY_FLIP":
      return "ACCUMULATE";
    case "AVOID_BREAKDOWN":
    case "AVOID_EVENT_RISK":
      return "CAUTION";
    case "AVOID_OVERHEAT":
      return "OVERHEAT";
    default:
      return "WATCH";
  }
};

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const findCandle = (candles: Candle[], time: string | null | undefined): Candle | null => {
  if (!time) return null;
  return candles.find((candle) => candle.time === time) ?? null;
};

const phaseFromWeekly = (weekly: WangWeeklyDetectorBundle): WangStrategyPhase => {
  if (weekly.minVolumePoint.ok) return "MIN_VOLUME";
  if (weekly.elasticVolume.ok) return "ELASTIC_VOLUME";
  if (weekly.risingVolume.ok) return "RISING_VOLUME";
  if (weekly.baseVolume.ok) return "BASE_VOLUME";
  if (weekly.lifeVolume.ok) return "LIFE_VOLUME";
  return "NONE";
};

const weeklyScore = (weekly: WangWeeklyDetectorBundle): number =>
  clamp(
    Math.round(
      weekly.lifeVolume.score * 0.12 +
        weekly.baseVolume.score * 0.16 +
        weekly.baseRepeat.score * 0.1 +
        weekly.risingVolume.score * 0.14 +
        weekly.elasticVolume.score * 0.14 +
        weekly.minVolumeRegion.score * 0.16 +
        weekly.minVolumePoint.score * 0.18,
    ),
    0,
    100,
  );

const weeklyConfidence = (weekly: WangWeeklyDetectorBundle): number =>
  clamp(
    Math.round(
      weekly.lifeVolume.confidence * 0.12 +
        weekly.baseVolume.confidence * 0.16 +
        weekly.baseRepeat.confidence * 0.1 +
        weekly.risingVolume.confidence * 0.14 +
        weekly.elasticVolume.confidence * 0.14 +
        weekly.minVolumeRegion.confidence * 0.16 +
        weekly.minVolumePoint.confidence * 0.18,
    ),
    0,
    100,
  );

const buildWeeklyPhaseContext = (weekly: WangWeeklyDetectorBundle): WangStrategyWeeklyPhaseContext => {
  const phase = phaseFromWeekly(weekly);
  const minVolume = weekly.minVolumePoint.value.volume ?? null;
  const referenceVolume = weekly.metrics.referenceVolume;
  const relativeShortVolumeScore =
    minVolume != null && referenceVolume > 0
      ? clamp(Math.round((1 - Math.min(minVolume / referenceVolume, 1)) * 100), 0, 100)
      : 0;
  const cooldownBarsFromLife =
    weekly.minVolumePoint.ok && weekly.lifeVolume.ok
      ? Math.max(weekly.minVolumePoint.value.index - weekly.lifeVolume.value.index, 0)
      : null;

  return {
    phase,
    score: weeklyScore(weekly),
    confidence: weeklyConfidence(weekly),
    headline:
      phase === "MIN_VOLUME"
        ? "최소거래량 구간과 점이 주봉에서 확인됩니다."
        : `${phaseLabel(phase)} 단계까지 주봉 구조가 진행됐습니다.`,
    stageSummary:
      phase === "MIN_VOLUME"
        ? "기준거래량 이후 수축 구간과 최소거래량 점을 함께 보며 일봉 재접근을 기다리는 구간입니다."
        : "주봉 구조는 진행 중이지만 최소거래량과 일봉 실행 조건 확인이 더 필요합니다.",
    referenceVolume,
    averageVolume: weekly.metrics.averageVolume,
    maxVolume: weekly.metrics.maxVolume,
    minVolume,
    baseRepeatCount: weekly.baseRepeat.value.repeatCount,
    risingCount: weekly.risingVolume.value.count,
    elasticCount: weekly.elasticVolume.value.count,
    hasMinVolume: weekly.minVolumePoint.ok,
    hasWeeklyZone: weekly.minVolumePoint.ok,
    relativeShortVolumeScore,
    cooldownBarsFromLife,
    cooldownReady: weekly.accumulationWindow.value.ready,
    breakoutReady: false,
    recentHalfExitWarning: false,
    secondSurgeTime: null,
    halfExitTime: null,
    anchorTime: weekly.lifeVolume.value.time,
  };
};

const buildDailyExecutionContext = (daily: WangDailyDetectorBundle): WangStrategyDailyExecutionContext => {
  const zone = daily.projectedZone.value;
  const zoneWidthPct =
    zone.low != null && zone.high != null && zone.low > 0
      ? Number((((zone.high - zone.low) / zone.low) * 100).toFixed(2))
      : null;
  return {
    state: daily.reentryEligibility.value.state,
    score: daily.reentryEligibility.score,
    confidence: daily.reentryEligibility.confidence,
    headline: `${executionLabel(daily.reentryEligibility.value.state)} 기준의 일봉 실행 판단`,
    action: daily.reentryEligibility.value.reason,
    belowMa20: daily.ma20Discount.value.belowMa20,
    hasProjectedZone: daily.projectedZone.ok,
    inProjectedZone: daily.retest.value.inZoneNow,
    retestDetected: daily.retest.ok,
    dailyRebaseCount: daily.dailyRebase.value.count,
    zoneWidthPct,
    lastRetestTime: daily.retest.value.latestTime,
  };
};

const buildMinVolumeRegionContext = (
  weekly: WangWeeklyDetectorBundle,
): WangStrategyMinVolumeRegionContext | null =>
  weekly.minVolumeRegion.ok
    ? {
        startTime: weekly.minVolumeRegion.value.startTime,
        endTime: weekly.minVolumeRegion.value.endTime,
        durationBars: weekly.minVolumeRegion.value.durationBars,
        thresholdVolume: weekly.minVolumeRegion.value.thresholdVolume,
      }
    : null;

const buildEventImpactContext = (
  daily: WangDailyDetectorBundle,
): WangStrategyEventImpactContext | null => ({
  evaluated: daily.eventImpact.value.evaluated,
  actionableRisk: daily.eventImpact.value.actionableRisk,
  shockDate: daily.eventImpact.value.shockDate,
  shockLabel: daily.eventImpact.value.shockLabel,
  priceShockPct: daily.eventImpact.value.priceShockPct,
  directImpact: daily.eventImpact.value.directImpact,
  revenueImpact: daily.eventImpact.value.revenueImpact,
  businessImpact: daily.eventImpact.value.businessImpact,
});

const buildPsychologyFlipContext = (
  daily: WangDailyDetectorBundle,
): WangStrategyPsychologyFlipContext | null => ({
  confirmed: daily.psychologyFlip.value.confirmed,
  time: daily.psychologyFlip.value.time,
  triggerPrice: daily.psychologyFlip.value.triggerPrice,
});

const buildStrongStockContext = (
  daily: WangDailyDetectorBundle,
): WangStrategyStrongStockContext | null => ({
  isStrong: daily.strongStockPullback.value.isStrong,
  pullbackDetected: daily.strongStockPullback.value.pullbackDetected,
  time: daily.strongStockPullback.value.time,
  lowVolume: daily.strongStockPullback.value.lowVolume,
  nearRecentHigh: daily.strongStockPullback.value.nearRecentHigh,
});

const buildPhaseOccurrences = (
  times: Array<string | null>,
  candles: Candle[],
  note: string,
): WangStrategyPhaseOccurrence[] =>
  times
    .filter((time): time is string => Boolean(time))
    .map((time) => findCandle(candles, time))
    .filter((candle): candle is Candle => Boolean(candle))
    .map((candle) => ({
      time: candle.time,
      price: candle.close,
      volume: candle.volume,
      strength: 80,
      note,
    }));

const buildPhases = (
  weekly: WangWeeklyDetectorBundle,
  daily: WangDailyDetectorBundle,
  weekCandles: Candle[],
): WangStrategyPhaseItem[] => {
  const currentPhase = phaseFromWeekly(weekly);
  return [
    {
      phase: "LIFE_VOLUME",
      title: "인생거래량",
      status: weekly.lifeVolume.ok ? (currentPhase === "LIFE_VOLUME" ? "active" : "completed") : "pending",
      summary: "큰 자금이 처음 강하게 들어온 주봉 anchor입니다.",
      nextCondition: "기준거래량 반복을 확인합니다.",
      occurrences: buildPhaseOccurrences([weekly.lifeVolume.value.time], weekCandles, "인생거래량 anchor"),
    },
    {
      phase: "BASE_VOLUME",
      title: "기준거래량",
      status: weekly.baseVolume.ok ? (currentPhase === "BASE_VOLUME" ? "active" : "completed") : "pending",
      summary: `반복 기준거래량 ${weekly.baseRepeat.value.repeatCount}회를 반영합니다.`,
      nextCondition: "상승거래량과 탄력거래량으로 이어지는지 확인합니다.",
      occurrences: buildPhaseOccurrences(weekly.baseVolume.value.times, weekCandles, "기준거래량"),
    },
    {
      phase: "RISING_VOLUME",
      title: "상승거래량",
      status: weekly.risingVolume.ok ? (currentPhase === "RISING_VOLUME" ? "active" : "completed") : "pending",
      summary: "기준거래량 이후 가격을 위로 미는 거래량입니다.",
      nextCondition: "탄력거래량으로 가속되는지 확인합니다.",
      occurrences: [],
    },
    {
      phase: "ELASTIC_VOLUME",
      title: "탄력거래량",
      status: weekly.elasticVolume.ok ? (currentPhase === "ELASTIC_VOLUME" ? "active" : "completed") : "pending",
      summary: "상승거래량 이후 적은 힘으로도 가격이 가벼워지는 단계입니다.",
      nextCondition: "최소거래량 구간 진입을 기다립니다.",
      occurrences: [],
    },
    {
      phase: "MIN_VOLUME",
      title: "최소거래량",
      status: weekly.minVolumePoint.ok ? "active" : "pending",
      summary: daily.projectedZone.ok
        ? "최소거래량 구간과 점이 확인되어 일봉 zone 투영이 가능합니다."
        : "최소거래량 구간은 있으나 일봉 투영 정보가 아직 부족합니다.",
      nextCondition: "일봉 재접근, 20일선 할인, 심리 전환을 함께 봅니다.",
      occurrences: [],
    },
  ];
};

const buildChecklist = (
  weekly: WangWeeklyDetectorBundle,
  daily: WangDailyDetectorBundle,
): WangStrategyChecklistItem[] => [
  {
    id: "week-life-volume",
    label: "주봉 인생거래량 anchor",
    ok: weekly.lifeVolume.ok,
    detail: "주봉에서 최대 거래량 anchor를 확보했는지 확인합니다.",
    group: "structure",
  },
  {
    id: "week-base-repeat",
    label: "기준거래량 반복",
    ok: weekly.baseRepeat.value.repeatCount >= 2,
    detail: "기준거래량은 한 번이 아니라 여러 번 반복될 수 있습니다.",
    group: "structure",
  },
  {
    id: "week-min-region",
    label: "최소거래량 구간",
    ok: weekly.minVolumeRegion.ok,
    detail: "최소거래량 구간과 점은 분리해서 봅니다.",
    group: "structure",
  },
  {
    id: "day-zone-projection",
    label: "주봉 zone 일봉 투영",
    ok: daily.projectedZone.ok,
    detail: "최소거래량 저가/고가를 일봉 실행 zone으로 투영합니다.",
    group: "execution",
  },
  {
    id: "day-below-ma20",
    label: "20일선 이하 할인",
    ok: daily.ma20Discount.value.belowMa20,
    detail: "20일선 아래는 적극적 분할 적립 후보입니다.",
    group: "execution",
  },
  {
    id: "day-retest",
    label: "zone 재접근",
    ok: daily.retest.ok,
    detail: "일봉이 주봉 zone을 재접근했는지 확인합니다.",
    group: "execution",
  },
  {
    id: "day-psychology-flip",
    label: "심리 전환",
    ok: daily.psychologyFlip.ok,
    detail: "급락 후 심리가 바뀌는 회복 캔들이 나왔는지 봅니다.",
    group: "execution",
  },
  {
    id: "risk-event-impact",
    label: "외부 이슈 3단 검증",
    ok: !daily.eventImpact.value.actionableRisk,
    detail: "직접 영향, 매출 영향, 업황 비전 영향을 분리 검증합니다.",
    group: "risk",
  },
];

const buildRiskNotes = (
  weekly: WangWeeklyDetectorBundle,
  daily: WangDailyDetectorBundle,
): WangStrategyRiskNote[] => {
  const notes: WangStrategyRiskNote[] = [];
  if (!weekly.minVolumePoint.ok) {
    notes.push({
      id: "risk-no-min-point",
      title: "최소거래량 점 미확정",
      detail: "최소거래량 구간만 있고 점이 확정되지 않으면 적립 가설은 약합니다.",
      severity: "warning",
    });
  }
  if (!daily.projectedZone.ok) {
    notes.push({
      id: "risk-no-zone",
      title: "일봉 zone 미투영",
      detail: "주봉 최소거래량 zone이 일봉에 투영되지 않으면 실행 근거가 약합니다.",
      severity: "warning",
    });
  }
  if (daily.retest.value.brokeDown) {
    notes.push({
      id: "risk-breakdown",
      title: "zone 하단 이탈",
      detail: "일봉 종가가 zone 하단 아래로 밀리면 1차 적립 가설이 흔들립니다.",
      severity: "danger",
    });
  }
  if (daily.eventImpact.value.actionableRisk) {
    notes.push({
      id: "risk-event",
      title: "외부 이슈 실질 영향",
      detail: "외부 이슈가 직접 실적이나 비전에 영향을 주면 과매도 해석을 보류합니다.",
      severity: "danger",
    });
  }
  if (notes.length === 0) {
    notes.push({
      id: "risk-default",
      title: "조건 충족 우위",
      detail: "현재는 구조 이탈보다 실행 조건 충족 쪽 근거가 더 많습니다.",
      severity: "info",
    });
  }
  return notes;
};

const buildTradeZones = (
  daily: WangDailyDetectorBundle,
): WangStrategyTradeZone[] => {
  const zone = daily.projectedZone.value;
  if (!daily.projectedZone.ok || zone.low == null || zone.high == null || zone.sourceStartTime == null) {
    return [];
  }
  const mid = Number(((zone.low + zone.high) / 2).toFixed(2));
  return [
    {
      id: "wang-main-zone",
      label: "최소거래량 실행 zone",
      sourceTf: "day",
      low: zone.low,
      high: zone.high,
      active: daily.retest.value.inZoneNow || daily.retest.ok,
      anchorPhase: "MIN_VOLUME",
      startTime: zone.sourceStartTime,
      endTime: zone.sourceEndTime ?? zone.sourceStartTime,
      invalidationPrice: Number((zone.low * 0.985).toFixed(2)),
      scenario: "주봉 최소거래량 zone 안에서 3분할 적립을 가정합니다.",
      splitPlan: [
        { label: "1차", price: zone.high, weightPct: 30, note: "보초 진입" },
        { label: "2차", price: mid, weightPct: 35, note: "중심가 적립" },
        { label: "3차", price: zone.low, weightPct: 35, note: "공포 확장 시 적립" },
      ],
    },
  ];
};

const buildMovingAverageContext = (
  daily: WangDailyDetectorBundle,
): WangStrategyMovingAverageContext => ({
  ma20: daily.ma20Discount.value.ma20,
  close: daily.ma20Discount.value.close,
  belowMa20: daily.ma20Discount.value.belowMa20,
  distancePct: daily.ma20Discount.value.distancePct,
  verdict: daily.ma20Discount.value.belowMa20 ? "20일선 이하 할인 구간" : "20일선 위 관찰 구간",
  guidance: daily.reentryEligibility.value.reason,
});

const buildWeekMarkers = (
  candles: Candle[],
  weekly: WangWeeklyDetectorBundle,
): WangStrategyMarker[] => {
  const markers: WangStrategyMarker[] = [];
  const addMarker = (
    id: string,
    index: number,
    type: WangStrategyMarker["type"],
    label: string,
    desc: string,
    color: string,
  ) => {
    const candle = candles[index];
    if (!candle) return;
    markers.push({
      id,
      tf: "week",
      t: candle.time,
      type,
      label,
      desc,
      price: candle.close,
      volume: candle.volume,
      strength: 80,
      position: "aboveBar",
      shape: "circle",
      color,
    });
  };

  if (weekly.lifeVolume.ok) addMarker("week-life", weekly.lifeVolume.value.index, "VOL_LIFE", "인생거래량", "주봉 최대거래량 anchor", "#38bdf8");
  weekly.baseVolume.value.indices.forEach((index, order) =>
    addMarker(`week-base-${order + 1}`, index, "VOL_BASE", `기준거래량 ${order + 1}`, "반복 기준거래량", "#60a5fa"),
  );
  weekly.risingVolume.value.indices.forEach((index, order) =>
    addMarker(`week-rise-${order + 1}`, index, "VOL_RISE", `상승거래량 ${order + 1}`, "기준거래량 이후 상승 거래량", "#22c55e"),
  );
  weekly.elasticVolume.value.indices.forEach((index, order) =>
    addMarker(`week-elastic-${order + 1}`, index, "VOL_ELASTIC", `탄력거래량 ${order + 1}`, "가벼운 가격 가속 구간", "#f59e0b"),
  );
  if (weekly.minVolumeRegion.ok) {
    addMarker(
      "week-min-region",
      weekly.minVolumeRegion.value.startIndex,
      "VOL_MIN_REGION",
      "최소거래량 구간",
      "최소거래량 구간 시작",
      "#8b5cf6",
    );
  }
  if (weekly.minVolumePoint.ok) {
    addMarker("week-min-point", weekly.minVolumePoint.value.index, "VOL_MIN", "최소거래량", "최소거래량 점", "#14b8a6");
  }
  return markers;
};

const buildDayMarkers = (
  candles: Candle[],
  daily: WangDailyDetectorBundle,
): WangStrategyMarker[] => {
  const markers: WangStrategyMarker[] = [];
  daily.dailyRebase.value.indices.forEach((index, order) => {
    const candle = candles[index];
    if (!candle) return;
    markers.push({
      id: `day-rebase-${order + 1}`,
      tf: "day",
      t: candle.time,
      type: "VOL_BASE",
      label: `재기준거래량 ${order + 1}`,
      desc: "일봉 재기준거래량",
      price: candle.close,
      volume: candle.volume,
      strength: 78,
      position: "aboveBar",
      shape: "circle",
      color: "#60a5fa",
    });
  });
  if (daily.retest.ok && daily.retest.value.latestIndex >= 0) {
    const candle = candles[daily.retest.value.latestIndex];
    if (candle) {
      markers.push({
        id: "day-retest",
        tf: "day",
        t: candle.time,
        type: "VOL_RETEST",
        label: "zone 재접근",
        desc: "주봉 zone 재접근",
        price: candle.close,
        volume: candle.volume,
        strength: 86,
        position: "belowBar",
        shape: "arrowUp",
        color: "#22d3ee",
      });
    }
  }
  if (daily.psychologyFlip.ok && daily.psychologyFlip.value.index >= 0) {
    const candle = candles[daily.psychologyFlip.value.index];
    if (candle) {
      markers.push({
        id: "day-psychology-flip",
        tf: "day",
        t: candle.time,
        type: "PSYCHOLOGY_FLIP",
        label: "심리 전환",
        desc: "급락 후 심리 전환 확인",
        price: candle.close,
        volume: candle.volume,
        strength: 84,
        position: "belowBar",
        shape: "arrowUp",
        color: "#a78bfa",
      });
    }
  }
  if (daily.strongStockPullback.ok && daily.strongStockPullback.value.index >= 0) {
    const candle = candles[daily.strongStockPullback.value.index];
    if (candle) {
      markers.push({
        id: "day-strong-pullback",
        tf: "day",
        t: candle.time,
        type: "STRONG_PULLBACK",
        label: "강한 종목 눌림",
        desc: "강한 종목의 저거래량 급락",
        price: candle.close,
        volume: candle.volume,
        strength: 82,
        position: "belowBar",
        shape: "circle",
        color: "#34d399",
      });
    }
  }
  if (daily.eventImpact.ok && daily.eventImpact.value.shockDate) {
    const candle = findCandle(candles, daily.eventImpact.value.shockDate);
    if (candle) {
      markers.push({
        id: "day-event-shock",
        tf: "day",
        t: candle.time,
        type: "EVENT_SHOCK",
        label: "이슈 급락",
        desc: "외부 이슈 급락 발생",
        price: candle.close,
        volume: candle.volume,
        strength: 80,
        position: "aboveBar",
        shape: "square",
        color: "#f87171",
      });
    }
  }
  return markers;
};

const buildChartOverlays = (params: {
  weeklyCandles: Candle[];
  dayCandles: Candle[];
  dayMa20Series: IndicatorPoint[];
  weekly: WangWeeklyDetectorBundle;
  daily: WangDailyDetectorBundle;
}): WangStrategyPayload["chartOverlays"] => {
  const { weeklyCandles, dayCandles, dayMa20Series, weekly, daily } = params;
  const weekZones: WangStrategyChartOverlays["zones"] = [];
  const dayZones: WangStrategyChartOverlays["zones"] = [];
  const weekRefLevels: WangStrategyChartOverlays["refLevels"] = [];
  const dayRefLevels: WangStrategyChartOverlays["refLevels"] = [];

  if (weekly.minVolumeRegion.ok && weekly.minVolumePoint.ok) {
    const startTime = weekly.minVolumeRegion.value.startTime ?? weekly.minVolumePoint.value.time ?? weeklyCandles[0]?.time;
    const endTime = weekly.minVolumeRegion.value.endTime ?? weekly.minVolumePoint.value.time ?? weeklyCandles[weeklyCandles.length - 1]?.time;
    const low = weekly.minVolumePoint.value.low;
    const high = weekly.minVolumePoint.value.high;
    if (startTime && endTime && low != null && high != null) {
      weekZones.push({
        id: "week-min-zone",
        label: "week.min.region",
        sourceTf: "week",
        low,
        high,
        startTime,
        endTime,
        color: "#8b5cf6",
        kind: "accumulation",
      });
      weekRefLevels.push({
        id: "week-min-low",
        label: "week.min.low",
        sourceTf: "week",
        price: low,
        startTime,
        endTime,
        color: "#14b8a6",
        style: "dashed",
      });
      weekRefLevels.push({
        id: "week-min-high",
        label: "week.min.high",
        sourceTf: "week",
        price: high,
        startTime,
        endTime,
        color: "#34d399",
        style: "solid",
      });
    }
  }

  if (daily.projectedZone.ok) {
    const zone = daily.projectedZone.value;
    if (zone.low != null && zone.high != null && zone.sourceStartTime != null) {
      const endTime = zone.sourceEndTime ?? dayCandles[dayCandles.length - 1]?.time ?? zone.sourceStartTime;
      dayZones.push({
        id: "day-projected-zone",
        label: "week.projected.zone",
        sourceTf: "day",
        low: zone.low,
        high: zone.high,
        startTime: zone.sourceStartTime,
        endTime,
        color: "#22d3ee",
        kind: "projection",
      });
      dayRefLevels.push({
        id: "day-zone-high",
        label: "week.zone.high",
        sourceTf: "day",
        price: zone.high,
        startTime: zone.sourceStartTime,
        endTime,
        color: "#34d399",
        style: "solid",
      });
      dayRefLevels.push({
        id: "day-zone-low",
        label: "week.zone.low",
        sourceTf: "day",
        price: zone.low,
        startTime: zone.sourceStartTime,
        endTime,
        color: "#14b8a6",
        style: "dashed",
      });
    }
  }

  return {
    week: {
      movingAverages: [],
      refLevels: weekRefLevels,
      zones: weekZones,
      highlightTime: weekly.minVolumePoint.value.time,
    },
    day: {
      movingAverages: [
        {
          id: "ma20",
          label: "MA20",
          color: "#60a5fa",
          lineWidth: 2,
          points: dayMa20Series,
        },
      ],
      refLevels: dayRefLevels,
      zones: dayZones,
      highlightTime: daily.retest.value.latestTime ?? daily.psychologyFlip.value.time,
    },
  };
};

const buildTrainingNotes = (
  weekly: WangWeeklyDetectorBundle,
  daily: WangDailyDetectorBundle,
): WangStrategyTrainingNote[] => {
  const notes: WangStrategyTrainingNote[] = [
    {
      id: "wang-note-reference-volume",
      title: "평균거래량 축",
      text: `참고 거래량은 최대 거래량의 약 10~12% 축으로 읽습니다. 현재 기준값은 ${Math.round(weekly.metrics.referenceVolume).toLocaleString("ko-KR")}입니다.`,
      emphasis: "core",
    },
    {
      id: "wang-note-min-region",
      title: "최소거래량 구간과 점 분리",
      text: "최소거래량 구간과 최소거래량 점은 따로 봅니다. 구간은 압축, 점은 실행 기준입니다.",
      emphasis: "core",
    },
  ];
  if (daily.ma20Discount.value.belowMa20) {
    notes.push({
      id: "wang-note-ma20-discount",
      title: "20일선 할인 구간",
      text: "20일선 아래에서는 한 번에 진입하지 말고 zone 기준으로 분할 적립합니다.",
      emphasis: "practice",
    });
  }
  if (daily.eventImpact.value.actionableRisk) {
    notes.push({
      id: "wang-note-event-risk",
      title: "외부 이슈 검증",
      text: "직접 영향, 매출 영향, 업황 비전 영향이 확인되면 과매도 해석보다 리스크 관리가 우선입니다.",
      emphasis: "warning",
    });
  }
  return notes;
};

export interface BuildWangPayloadInput {
  meta: WangStrategyPayload["meta"];
  candles: {
    week: Candle[];
    day: Candle[];
  };
  dayMa20Series: IndicatorPoint[];
  weekly: WangWeeklyDetectorBundle;
  daily: WangDailyDetectorBundle;
  multiTimeframe: {
    month: WangStrategyTimeframeSummary | null;
    week: WangStrategyTimeframeSummary | null;
    day: WangStrategyTimeframeSummary | null;
  };
  warnings?: string[];
}

export const buildWangPayload = (input: BuildWangPayloadInput): WangStrategyPayload => {
  const weeklyPhaseContext = buildWeeklyPhaseContext(input.weekly);
  const dailyExecutionContext = buildDailyExecutionContext(input.daily);
  const currentPhase = weeklyPhaseContext.phase;
  const confidence = clamp(
    Math.round(weeklyPhaseContext.confidence * 0.55 + dailyExecutionContext.confidence * 0.45),
    0,
    100,
  );
  const score = clamp(
    Math.round(weeklyPhaseContext.score * 0.58 + dailyExecutionContext.score * 0.42),
    0,
    100,
  );
  const interpretation = mapInterpretation(dailyExecutionContext.state);
  const summary: WangStrategySummary = {
    phase: currentPhase,
    confidence,
    score,
    interpretation,
    headline: `${weeklyPhaseContext.headline} / ${dailyExecutionContext.headline}`,
    posture:
      interpretation === "ACCUMULATE"
        ? "주봉 구조는 준비됐고 일봉 실행 조건을 함께 읽는 구간입니다."
        : interpretation === "CAUTION"
          ? "실행보다 리스크 검증이 우선입니다."
          : interpretation === "OVERHEAT"
            ? "추격보다 다음 눌림을 기다립니다."
            : "구조는 관찰하되 실행은 보수적으로 봅니다.",
  };

  const reasons = unique([
    ...input.weekly.lifeVolume.reasons,
    ...input.weekly.baseVolume.reasons,
    ...input.weekly.minVolumeRegion.reasons,
    ...input.weekly.minVolumePoint.reasons,
    ...input.daily.reentryEligibility.reasons,
    ...input.daily.psychologyFlip.reasons,
    ...input.daily.lowVolumePullback.reasons,
    ...input.daily.eventImpact.reasons,
  ]).slice(0, 8);

  return {
    meta: input.meta,
    summary,
    weeklyPhaseContext,
    dailyExecutionContext,
    minVolumeRegionContext: buildMinVolumeRegionContext(input.weekly),
    eventImpactContext: buildEventImpactContext(input.daily),
    psychologyFlipContext: buildPsychologyFlipContext(input.daily),
    strongStockContext: buildStrongStockContext(input.daily),
    phases: buildPhases(input.weekly, input.daily, input.candles.week),
    currentPhase,
    confidence,
    score,
    reasons,
    checklist: buildChecklist(input.weekly, input.daily),
    riskNotes: buildRiskNotes(input.weekly, input.daily),
    tradeZones: buildTradeZones(input.daily),
    movingAverageContext: buildMovingAverageContext(input.daily),
    multiTimeframe: input.multiTimeframe,
    candles: input.candles,
    chartOverlays: buildChartOverlays({
      weeklyCandles: input.candles.week,
      dayCandles: input.candles.day,
      dayMa20Series: input.dayMa20Series,
      weekly: input.weekly,
      daily: input.daily,
    }),
    markers: {
      week: buildWeekMarkers(input.candles.week, input.weekly),
      day: buildDayMarkers(input.candles.day, input.daily),
    },
    trainingNotes: buildTrainingNotes(input.weekly, input.daily),
    deprecated: {
      legacyCurrentPhaseMirrorsSummary: true,
      legacyInterpretationFromExecutionState: true,
    },
    warnings: input.warnings ?? [],
  };
};
