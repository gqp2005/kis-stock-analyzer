import type { Candle, IndicatorPoint, TimeframeAnalysis } from "./types";
import type {
  WangStrategyChartOverlays,
  WangStrategyChartTimeframe,
  WangStrategyChecklistItem,
  WangStrategyDailyExecutionContext,
  WangStrategyExecutionState,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyPayload,
  WangStrategyPhase,
  WangStrategyPhaseItem,
  WangStrategyPhaseOccurrence,
  WangStrategyRefLevel,
  WangStrategyRiskNote,
  WangStrategyScreeningSummary,
  WangStrategyTimeframeSummary,
  WangStrategyTradeZone,
  WangStrategyTrainingNote,
  WangStrategyWeeklyPhaseContext,
  WangStrategyZoneOverlay,
} from "./wangTypes";
import { clamp, round2 } from "./utils";
import {
  WANG_EXECUTION_STATE_LABEL,
  WANG_PHASE_LABEL,
  WANG_STRATEGY_CONSTANTS,
} from "./wangStrategyConstants";

interface WangCycleDetection {
  tf: WangStrategyChartTimeframe;
  candles: Candle[];
  ma20Series: IndicatorPoint[];
  maxVolume: number;
  averageVolume: number;
  referenceVolume: number;
  close: number;
  ma20: number | null;
  belowMa20: boolean;
  ma20DistancePct: number | null;
  lifeIndex: number;
  primaryVolumeIndex: number;
  baseIndices: number[];
  risingIndices: number[];
  elasticIndices: number[];
  minIndex: number;
  minVolume: number | null;
  relativeShortVolumeScore: number;
  cooldownBarsFromLife: number | null;
  cooldownReady: boolean;
  secondSurgeIndex: number;
  halfExitIndex: number;
  recentHalfExitWarning: boolean;
  zoneStartIndex: number;
  zoneEndIndex: number;
  zoneLow: number | null;
  zoneHigh: number | null;
  retestIndices: number[];
  latestRetestIndex: number;
  inZone: boolean;
  brokeZone: boolean;
  farAboveZone: boolean;
  currentPhase: WangStrategyPhase;
}

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const bodyRatio = (candle: Candle): number => {
  const range = Math.max(candle.high - candle.low, 0.0001);
  return Math.abs(candle.close - candle.open) / range;
};

const percentDiff = (value: number, reference: number | null): number | null => {
  if (reference == null || reference === 0) return null;
  return ((value - reference) / reference) * 100;
};

const priceChangePct = (candles: Candle[], index: number): number => {
  if (index <= 0) return 0;
  const prev = candles[index - 1]?.close ?? 0;
  if (prev === 0) return 0;
  return ((candles[index].close - prev) / prev) * 100;
};

const isLocalVolumePivot = (candles: Candle[], index: number, span = 2): boolean => {
  const target = candles[index]?.volume ?? 0;
  if (!target) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (candles[index - offset] && candles[index - offset].volume > target) return false;
    if (candles[index + offset] && candles[index + offset].volume > target) return false;
  }
  return true;
};

const findMajorVolumePivotIndices = (candles: Candle[], averageVolume: number): number[] =>
  candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (!isLocalVolumePivot(candles, index)) return false;
      return candle.volume >= averageVolume * WANG_STRATEGY_CONSTANTS.majorVolumePivotAverageMultiple;
    })
    .map(({ index }) => index);

const findLowestVolumeIndexAfter = (candles: Candle[], startIndex: number): number => {
  if (startIndex < 0 || startIndex >= candles.length - 1) return -1;

  let selectedIndex = -1;
  for (let index = startIndex + 1; index < candles.length; index += 1) {
    const volume = candles[index]?.volume ?? 0;
    if (volume <= 0) continue;
    if (selectedIndex < 0 || volume < candles[selectedIndex].volume) {
      selectedIndex = index;
      continue;
    }
    if (volume === candles[selectedIndex].volume && index > selectedIndex) {
      selectedIndex = index;
    }
  }

  return selectedIndex;
};

const computeRelativeShortVolumeScore = (minVolume: number | null, averageVolume: number): number => {
  if (minVolume == null || averageVolume <= 0) return 0;
  const compression = minVolume / averageVolume;
  return clamp(Math.round((1 - Math.min(compression, 1)) * 100), 0, 100);
};

const toRoundedNumber = (value: number): number => round2(value) ?? value;

const findBarIndexOnOrAfter = (candles: Candle[], time: string): number => {
  const index = candles.findIndex((candle) => candle.time >= time);
  return index >= 0 ? index : 0;
};

const isRecentRetest = (candles: Candle[], index: number): boolean =>
  index >= 0 && candles.length - 1 - index <= WANG_STRATEGY_CONSTANTS.activeRetestLookbackBars;

const detectVolumeCycle = (
  tf: WangStrategyChartTimeframe,
  candles: Candle[],
  ma20Series: IndicatorPoint[],
): WangCycleDetection => {
  if (candles.length === 0) {
    return {
      tf,
      candles,
      ma20Series,
      maxVolume: 0,
      averageVolume: 0,
      referenceVolume: 0,
      close: 0,
      ma20: null,
      belowMa20: false,
      ma20DistancePct: null,
      lifeIndex: -1,
      primaryVolumeIndex: -1,
      baseIndices: [],
      risingIndices: [],
      elasticIndices: [],
      minIndex: -1,
      minVolume: null,
      relativeShortVolumeScore: 0,
      cooldownBarsFromLife: null,
      cooldownReady: false,
      secondSurgeIndex: -1,
      halfExitIndex: -1,
      recentHalfExitWarning: false,
      zoneStartIndex: -1,
      zoneEndIndex: -1,
      zoneLow: null,
      zoneHigh: null,
      retestIndices: [],
      latestRetestIndex: -1,
      inZone: false,
      brokeZone: false,
      farAboveZone: false,
      currentPhase: "NONE",
    };
  }

  const close = candles[candles.length - 1].close;
  const ma20 = ma20Series[ma20Series.length - 1]?.value ?? null;
  const belowMa20 = ma20 != null ? close <= ma20 : false;
  const ma20DistancePct = percentDiff(close, ma20);
  const maxVolume = Math.max(...candles.map((candle) => candle.volume));
  const averageVolume = average(candles.map((candle) => candle.volume));
  const referenceVolume = maxVolume * WANG_STRATEGY_CONSTANTS.referenceVolumeRatio;
  const lifeIndex = candles.findIndex((candle) => candle.volume === maxVolume);
  const majorVolumePivotIndices = findMajorVolumePivotIndices(candles, averageVolume);
  const primaryVolumeIndex = majorVolumePivotIndices[0] ?? lifeIndex;

  const baseIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= primaryVolumeIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.baseVolumeMinRatio) return false;
      if (candle.volume >= maxVolume * 0.98) return false;
      const ma20Point = ma20Series[index]?.value ?? null;
      return candle.close >= candle.open || (ma20Point != null && candle.close >= ma20Point * 0.98);
    })
    .map(({ index }) => index)
    .slice(-4);

  const latestBaseIndex = baseIndices.length > 0 ? baseIndices[baseIndices.length - 1] : -1;

  const risingIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= latestBaseIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.risingVolumeMinRatio) return false;
      const referenceClose = latestBaseIndex >= 0 ? candles[latestBaseIndex].close : candles[Math.max(index - 1, 0)].close;
      return candle.close > referenceClose;
    })
    .map(({ index }) => index)
    .slice(-3);

  const latestRisingIndex = risingIndices.length > 0 ? risingIndices[risingIndices.length - 1] : -1;
  const elasticStartIndex = Math.max(latestRisingIndex, latestBaseIndex);

  const elasticIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= elasticStartIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.elasticVolumeMinRatio) return false;
      if (bodyRatio(candle) < WANG_STRATEGY_CONSTANTS.elasticBodyRatio) return false;
      return priceChangePct(candles, index) >= WANG_STRATEGY_CONSTANTS.elasticRisePct;
    })
    .map(({ index }) => index)
    .slice(-2);

  const latestElasticIndex = elasticIndices.length > 0 ? elasticIndices[elasticIndices.length - 1] : -1;
  const minSearchStartIndex =
    latestElasticIndex >= 0 ? latestElasticIndex : latestRisingIndex >= 0 ? latestRisingIndex : latestBaseIndex;

  // In Wang lecture terminology, minimum volume is the absolute lowest weekly turnover
  // after the active reference/rising/elastic sequence, not only a local trough candidate.
  const minIndex = findLowestVolumeIndexAfter(candles, minSearchStartIndex);
  const minVolume = minIndex >= 0 ? candles[minIndex].volume : null;
  const relativeShortVolumeScore = computeRelativeShortVolumeScore(minVolume, averageVolume);
  const cooldownBarsFromLife =
    minIndex >= 0 && primaryVolumeIndex >= 0 && minIndex > primaryVolumeIndex ? minIndex - primaryVolumeIndex : null;
  const cooldownReady =
    cooldownBarsFromLife != null &&
    cooldownBarsFromLife >= WANG_STRATEGY_CONSTANTS.minCooldownBarsAfterLife;
  const surgeSearchStartIndex = Math.max(primaryVolumeIndex, minIndex);
  const secondSurgeIndex =
    primaryVolumeIndex >= 0
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= surgeSearchStartIndex) return false;
            if (!isLocalVolumePivot(candles, index)) return false;
            if (
              candle.volume <
              candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.secondSurgeBreakoutRatio
            ) {
              return false;
            }
            return (
              candle.close >=
              candles[primaryVolumeIndex].high * (1 + WANG_STRATEGY_CONSTANTS.secondSurgePriceBufferPct)
            );
          })
          .map(({ index }) => index)[0] ?? -1
      : -1;
  const halfExitIndex =
    primaryVolumeIndex >= 0
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= surgeSearchStartIndex) return false;
            if (!isLocalVolumePivot(candles, index)) return false;
            if (
              candle.volume <
                candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.halfMaxExitLowerRatio ||
              candle.volume >
                candles[primaryVolumeIndex].volume * WANG_STRATEGY_CONSTANTS.halfMaxExitUpperRatio
            ) {
              return false;
            }
            return secondSurgeIndex < 0 || index >= secondSurgeIndex;
          })
          .map(({ index }) => index)
          .slice(-1)[0] ?? -1
      : -1;
  const recentHalfExitWarning =
    halfExitIndex >= 0 && candles.length - 1 - halfExitIndex <= WANG_STRATEGY_CONSTANTS.halfMaxExitRecentBars;
  const zoneStartIndex = minIndex >= 0 ? Math.min(candles.length - 1, minIndex + 1) : -1;
  const zoneEndIndex =
    zoneStartIndex >= 0
      ? Math.min(candles.length - 1, zoneStartIndex + WANG_STRATEGY_CONSTANTS.zoneBuildBars - 1)
      : -1;
  const zoneCandles = zoneStartIndex >= 0 ? candles.slice(zoneStartIndex, zoneEndIndex + 1) : [];
  const zoneLow = zoneCandles.length > 0 ? Math.min(...zoneCandles.map((candle) => candle.low)) : null;
  const zoneHigh = zoneCandles.length > 0 ? Math.max(...zoneCandles.map((candle) => candle.high)) : null;

  const retestIndices =
    zoneLow != null && zoneHigh != null
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= zoneEndIndex) return false;
            const touchesUpper = candle.low <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            const holdsLower = candle.high >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            return touchesUpper && holdsLower;
          })
          .map(({ index }) => index)
      : [];

  const latestRetestIndex = retestIndices.length > 0 ? retestIndices[retestIndices.length - 1] : -1;
  const inZone =
    zoneLow != null && zoneHigh != null
      ? close >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct) &&
        close <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct)
      : false;
  const brokeZone =
    zoneLow != null ? close < zoneLow * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct) : false;
  const farAboveZone =
    zoneHigh != null ? close > zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.overheatFromZonePct) : false;

  let currentPhase: WangStrategyPhase = "NONE";
  if (latestRetestIndex >= 0 && (inZone || isRecentRetest(candles, latestRetestIndex))) currentPhase = "REACCUMULATION";
  else if (minIndex >= 0) currentPhase = "MIN_VOLUME";
  else if (latestElasticIndex >= 0) currentPhase = "ELASTIC_VOLUME";
  else if (latestRisingIndex >= 0) currentPhase = "RISING_VOLUME";
  else if (latestBaseIndex >= 0) currentPhase = "BASE_VOLUME";
  else if (lifeIndex >= 0) currentPhase = "LIFE_VOLUME";

  return {
    tf,
    candles,
    ma20Series,
    maxVolume,
    averageVolume,
    referenceVolume,
    close,
    ma20,
    belowMa20,
    ma20DistancePct,
    lifeIndex,
    primaryVolumeIndex,
    baseIndices,
    risingIndices,
    elasticIndices,
    minIndex,
    minVolume,
    relativeShortVolumeScore,
    cooldownBarsFromLife,
    cooldownReady,
    secondSurgeIndex,
    halfExitIndex,
    recentHalfExitWarning,
    zoneStartIndex,
    zoneEndIndex,
    zoneLow,
    zoneHigh,
    retestIndices,
    latestRetestIndex,
    inZone,
    brokeZone,
    farAboveZone,
    currentPhase,
  };
};

const toTimeframeSummary = (analysis: TimeframeAnalysis | null): WangStrategyTimeframeSummary | null => {
  if (!analysis) return null;

  const structure =
    analysis.regime === "DOWN"
      ? "모으기"
      : analysis.regime === "UP"
        ? "가르기"
        : "혼합";

  let phaseBias: WangStrategyPhase = "BASE_VOLUME";
  if (analysis.regime === "DOWN" && !analysis.signals.trend.closeAboveMid) {
    phaseBias = "MIN_VOLUME";
  } else if (analysis.signals.momentum.volumeAboveMa20 && analysis.scores.trend >= 70) {
    phaseBias = "RISING_VOLUME";
  } else if (analysis.scores.momentum >= 65 && analysis.signals.volume.volumeScore >= 65) {
    phaseBias = "ELASTIC_VOLUME";
  }

  return {
    tf: analysis.tf,
    regime: analysis.regime,
    structure,
    score: analysis.profile.score,
    phaseBias,
    summary: analysis.summaryText,
    reasons: analysis.reasons.slice(0, 3),
  };
};

const buildOccurrence = (
  candles: Candle[],
  index: number,
  note: string,
  strength: number,
): WangStrategyPhaseOccurrence => ({
  time: candles[index].time,
  price: toRoundedNumber(candles[index].close),
  volume: Math.round(candles[index].volume),
  strength,
  note,
});

const buildPhaseItem = (
  phase: Exclude<WangStrategyPhase, "NONE">,
  currentPhase: WangStrategyPhase,
  occurrences: WangStrategyPhaseOccurrence[],
  summary: string,
  nextCondition: string,
): WangStrategyPhaseItem => ({
  phase,
  title: WANG_PHASE_LABEL[phase],
  status: phase === currentPhase ? "active" : occurrences.length > 0 ? "completed" : "pending",
  summary,
  nextCondition,
  occurrences,
});

const buildMarker = (
  tf: WangStrategyChartTimeframe,
  candles: Candle[],
  index: number,
  type: WangStrategyMarker["type"],
  label: string,
  desc: string,
  strength: number,
  position: WangStrategyMarker["position"],
  shape: WangStrategyMarker["shape"],
  color: string,
): WangStrategyMarker => ({
  id: `wang-${tf}-${type}-${candles[index].time}`,
  tf,
  t: candles[index].time,
  type,
  label,
  desc,
  price: toRoundedNumber(candles[index].close),
  volume: Math.round(candles[index].volume),
  strength,
  position,
  shape,
  color,
});

const buildRefLevel = (
  tf: WangStrategyChartTimeframe,
  candles: Candle[],
  index: number,
  price: number,
  label: string,
  color: string,
  style: "solid" | "dashed",
  forwardBars = WANG_STRATEGY_CONSTANTS.refLineBars,
): WangStrategyRefLevel => ({
  id: `wang-ref-${tf}-${label}-${candles[index].time}`,
  label,
  sourceTf: tf,
  price: toRoundedNumber(price),
  startTime: candles[index].time,
  endTime: candles[Math.min(candles.length - 1, index + forwardBars)].time,
  color,
  style,
});

const buildStaticRefLevel = (
  tf: WangStrategyChartTimeframe,
  startTime: string,
  endTime: string,
  price: number,
  label: string,
  color: string,
  style: "solid" | "dashed",
): WangStrategyRefLevel => ({
  id: `wang-ref-${tf}-${label}-${startTime}`,
  label,
  sourceTf: tf,
  price: toRoundedNumber(price),
  startTime,
  endTime,
  color,
  style,
});

const buildZoneOverlay = (
  tf: WangStrategyChartTimeframe,
  label: string,
  sourceTf: WangStrategyChartTimeframe,
  low: number,
  high: number,
  startTime: string,
  endTime: string,
  color: string,
  kind: WangStrategyZoneOverlay["kind"],
): WangStrategyZoneOverlay => ({
  id: `wang-zone-${tf}-${label}-${startTime}`,
  label,
  sourceTf,
  low: toRoundedNumber(low),
  high: toRoundedNumber(high),
  startTime,
  endTime,
  color,
  kind,
});

const buildTrainingNotes = (referenceVolume: number, maxVolume: number): WangStrategyTrainingNote[] => [
  {
    id: "wang-training-main-frame",
    title: "주봉 메인, 일봉 상세",
    text: "1차 버전은 주봉에서 거래량 사이클을 먼저 읽고, 일봉에서는 zone 재접근과 20일선 아래 적립 후보를 상세하게 해석하도록 설계했습니다.",
    emphasis: "core",
  },
  {
    id: "wang-training-reference",
    title: "기준거래량의 기준",
    text: `이번 응답에서는 최대거래량 ${Math.round(maxVolume).toLocaleString("ko-KR")}을 기준으로 약 10~12% 구간을 참고해 기준거래량을 읽고 있습니다. 현재 기준값은 ${Math.round(referenceVolume).toLocaleString("ko-KR")}입니다.`,
    emphasis: "core",
  },
  {
    id: "wang-training-base-repeat",
    title: "기준거래량은 여러 번 나온다",
    text: "한 번의 기준거래량만으로 확정하지 않고, 반복 출현과 반복 실패 여부를 함께 읽어야 균형가격과 심리 전환을 더 안정적으로 볼 수 있습니다.",
    emphasis: "practice",
  },
  {
    id: "wang-training-min-zone",
    title: "최소거래량 이후 zone",
    text: "최소거래량 자체보다 그 이후 캔들 고저가 실제 적립 zone을 만듭니다. 그래서 최소거래량 직후의 캔들 묶음을 별도 zone으로 표시합니다.",
    emphasis: "core",
  },
  {
    id: "wang-training-ma20",
    title: "20일선 아래 적립 후보",
    text: "20일선 아래라고 무조건 매수가 아니라, 최소거래량과 zone, 그리고 재접근 여부가 함께 있어야 분할 적립 후보로 해석합니다.",
    emphasis: "practice",
  },
  {
    id: "wang-training-mtf",
    title: "월/주/일 연결 해석",
    text: "월봉은 큰 균형가격과 방향, 주봉은 핵심 거래량 단계, 일봉은 실제 실행 타이밍으로 연결해서 읽는 구조가 이후 2차 고도화의 기반이 됩니다.",
    emphasis: "warning",
  },
];

const buildTradeZone = (
  sourceTf: WangStrategyChartTimeframe,
  candles: Candle[],
  zoneStartIndex: number,
  zoneEndIndex: number,
  zoneLow: number,
  zoneHigh: number,
  active: boolean,
  belowMa20: boolean,
): WangStrategyTradeZone => {
  const zoneMid = (zoneLow + zoneHigh) / 2;
  const [firstWeight, secondWeight, thirdWeight] = WANG_STRATEGY_CONSTANTS.splitPlanWeights;

  return {
    id: `wang-trade-zone-${sourceTf}-${candles[zoneStartIndex].time}`,
    label: sourceTf === "week" ? "주봉 최소거래량 이후 zone" : "일봉 최소거래량 이후 zone",
    sourceTf,
    low: toRoundedNumber(zoneLow),
    high: toRoundedNumber(zoneHigh),
    active,
    anchorPhase: active ? "REACCUMULATION" : "MIN_VOLUME",
    startTime: candles[zoneStartIndex].time,
    endTime: candles[zoneEndIndex].time,
    invalidationPrice: toRoundedNumber(zoneLow * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct)),
    scenario: belowMa20
      ? "20일선 아래에서 zone을 다시 확인하는 구간으로 해석해 추격보다 분할 적립 시나리오를 우선합니다."
      : "20일선 위라면 추격보다 주봉 zone 재접근 여부를 먼저 확인하는 보수적 시나리오가 적합합니다.",
    splitPlan: [
      {
        label: "1차 적립",
        price: toRoundedNumber(zoneHigh),
        weightPct: firstWeight,
        note: "zone 상단 확인 진입",
      },
      {
        label: "2차 적립",
        price: toRoundedNumber(zoneMid),
        weightPct: secondWeight,
        note: "균형가격 재접근 구간",
      },
      {
        label: "3차 적립",
        price: toRoundedNumber(zoneLow),
        weightPct: thirdWeight,
        note: "zone 하단 방어 확인 구간",
      },
    ],
  };
};

const sortMarkers = (markers: WangStrategyMarker[]): WangStrategyMarker[] =>
  [...markers].sort((left, right) => left.t.localeCompare(right.t));

const mapExecutionToInterpretation = (
  state: WangStrategyExecutionState,
): WangStrategyInterpretation => {
  if (state === "READY_ON_ZONE" || state === "READY_ON_RETEST") return "ACCUMULATE";
  if (state === "AVOID_OVERHEAT") return "OVERHEAT";
  if (state === "AVOID_BREAKDOWN") return "CAUTION";
  return "WATCH";
};

const buildWeeklyPhaseContext = (
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

const buildDailyExecutionContext = (params: {
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

export const buildWangStrategyPayload = (params: {
  input: string;
  symbol: string;
  name: string;
  market: string;
  asOf: string;
  cacheTtlSec: number;
  dayAnalysis: TimeframeAnalysis;
  weekAnalysis: TimeframeAnalysis | null;
  monthAnalysis: TimeframeAnalysis | null;
  warnings?: string[];
}): WangStrategyPayload => {
  const {
    input,
    symbol,
    name,
    market,
    asOf,
    cacheTtlSec,
    dayAnalysis,
    weekAnalysis,
    monthAnalysis,
    warnings = [],
  } = params;

  const weekCandles = weekAnalysis?.candles ?? [];
  const weekMa20 = weekAnalysis?.indicators.ma.ma1 ?? [];
  const dayCandles = dayAnalysis.candles;
  const dayMa20 = dayAnalysis.indicators.ma.ma1;

  const weekDetection = weekCandles.length > 0 ? detectVolumeCycle("week", weekCandles, weekMa20) : null;
  const dayDetection = detectVolumeCycle("day", dayCandles, dayMa20);
  const phaseSource = weekDetection ?? dayDetection;

  const mainZoneSource =
    weekDetection && weekDetection.zoneLow != null && weekDetection.zoneHigh != null && weekDetection.zoneStartIndex >= 0 && weekDetection.zoneEndIndex >= 0
      ? weekDetection
      : dayDetection.zoneLow != null && dayDetection.zoneHigh != null && dayDetection.zoneStartIndex >= 0 && dayDetection.zoneEndIndex >= 0
        ? dayDetection
        : null;

  const projectedDayZone =
    mainZoneSource && dayCandles.length > 0
      ? {
          startIndex: findBarIndexOnOrAfter(dayCandles, mainZoneSource.candles[mainZoneSource.zoneStartIndex].time),
          endIndex: dayCandles.length - 1,
          low: mainZoneSource.zoneLow!,
          high: mainZoneSource.zoneHigh!,
        }
      : null;

  const projectedDayRetestIndices =
    projectedDayZone
      ? dayCandles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index < projectedDayZone.startIndex) return false;
            const touchesUpper =
              candle.low <= projectedDayZone.high * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            const holdsLower =
              candle.high >= projectedDayZone.low * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            return touchesUpper && holdsLower;
          })
          .map(({ index }) => index)
      : [];

  const projectedDayRetestIndex =
    projectedDayRetestIndices.length > 0 ? projectedDayRetestIndices[projectedDayRetestIndices.length - 1] : -1;
  const projectedDayInZone =
    projectedDayZone != null
      ? dayDetection.close >= projectedDayZone.low * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct) &&
        dayDetection.close <= projectedDayZone.high * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct)
      : false;
  const projectedDayBrokeZone =
    projectedDayZone != null
      ? dayDetection.close < projectedDayZone.low * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct)
      : false;

  const currentPhase = phaseSource.currentPhase;

  const dailyRebaseIndices = dayDetection.baseIndices
    .filter((index) => {
      const candle = dayDetection.candles[index];
      const afterZoneStart = projectedDayZone == null || index >= projectedDayZone.startIndex;
      const volumeOk =
        candle.volume >= dayDetection.referenceVolume * WANG_STRATEGY_CONSTANTS.dailyRebaseMinRatio;
      const zoneBiasOk =
        projectedDayZone == null ||
        candle.close >= projectedDayZone.low * WANG_STRATEGY_CONSTANTS.dailyRebaseCloseBias;
      return afterZoneStart && volumeOk && zoneBiasOk;
    })
    .slice(-WANG_STRATEGY_CONSTANTS.dayRebaseMarkerLimit);

  const weeklyPhaseContext = buildWeeklyPhaseContext(phaseSource);
  const dailyExecutionContext = buildDailyExecutionContext({
    dayDetection,
    weeklyPhase: weeklyPhaseContext,
    projectedDayZone,
    projectedDayInZone,
    projectedDayRetestIndex,
    projectedDayBrokeZone,
    dailyRebaseIndices,
  });

  const interpretation = mapExecutionToInterpretation(dailyExecutionContext.state);

  const checklist: Array<WangStrategyChecklistItem & { weight: number }> = [
    {
      id: "week-life-volume",
      label: "주봉 인생거래량 기준 확보",
      ok: weeklyPhaseContext.anchorTime != null,
      detail: "최대 거래량을 기준점으로 잡고 이후 기준거래량과 평균거래량을 비교합니다.",
      group: "structure",
      weight: 10,
    },
    {
      id: "week-base-repeat",
      label: "주봉 기준거래량 반복 확인",
      ok: weeklyPhaseContext.baseRepeatCount > 0,
      detail: "기준거래량은 한 번보다 반복 출현이 더 중요합니다.",
      group: "structure",
      weight: 14,
    },
    {
      id: "week-rising",
      label: "주봉 상승거래량 출현",
      ok: weeklyPhaseContext.risingCount > 0,
      detail: "기준거래량 이후 실제로 위쪽으로 실리는 상승거래량이 확인돼야 합니다.",
      group: "structure",
      weight: 10,
    },
    {
      id: "week-elastic",
      label: "주봉 탄력거래량 확인",
      ok: weeklyPhaseContext.elasticCount > 0,
      detail: "상승거래량 이후 몸통 탄력까지 붙어야 minimum 해석이 자연스럽습니다.",
      group: "structure",
      weight: 10,
    },
    {
      id: "week-min",
      label: "주봉 최소거래량 확인",
      ok: weeklyPhaseContext.hasMinVolume,
      detail: "왕장군 기준에서는 활성 기준거래량 이후 주봉 거래량이 최저치를 찍는 구간을 minimum으로 읽습니다.",
      group: "structure",
      weight: 16,
    },
    {
      id: "week-zone",
      label: "주봉 minimum 이후 zone 형성",
      ok: dailyExecutionContext.hasProjectedZone,
      detail: "최소거래량 다음 캔들 고저로 만든 zone이 있어야 일봉 실행 판단이 가능합니다.",
      group: "structure",
      weight: 12,
    },
    {
      id: "day-below-ma20",
      label: "일봉 20일선 아래 적립 후보",
      ok: dailyExecutionContext.belowMa20,
      detail: "20일선 아래에서 zone을 확인하는 구간은 추격보다 적립 설명이 쉬워집니다.",
      group: "execution",
      weight: 10,
    },
    {
      id: "day-in-zone",
      label: "일봉이 주봉 zone 안에 있음",
      ok: dailyExecutionContext.inProjectedZone,
      detail: "일봉은 주봉 zone을 실제 실행 위치로 재해석하는 역할입니다.",
      group: "execution",
      weight: 10,
    },
    {
      id: "day-retest",
      label: "일봉 재접근 확인",
      ok: dailyExecutionContext.retestDetected,
      detail: "zone 재접근이 있어야 관찰 구간에서 실행 구간으로 넘어갑니다.",
      group: "execution",
      weight: 10,
    },
    {
      id: "day-rebase",
      label: "일봉 재기준거래량 확인",
      ok: dailyExecutionContext.dailyRebaseCount > 0,
      detail: "재접근 이후 거래량이 다시 붙는지 확인해야 심리 전환을 실행으로 옮길 수 있습니다.",
      group: "execution",
      weight: 8,
    },
    {
      id: "month-context",
      label: "월봉 급락 추세 아님",
      ok: monthAnalysis == null || monthAnalysis.regime !== "DOWN",
      detail: "월봉이 무너지면 주봉 minimum도 방어적으로 읽어야 합니다.",
      group: "risk",
      weight: 5,
    },
    {
      id: "zone-not-broken",
      label: "주봉 zone 하단 이탈 아님",
      ok: dailyExecutionContext.state !== "AVOID_BREAKDOWN",
      detail: "zone 하단 이탈은 적립 시나리오 무효화입니다.",
      group: "risk",
      weight: 5,
    },
  ];

  checklist.splice(5, 0,
    {
      id: "week-short-volume",
      label: "주봉 상대 최저 거래량 압축",
      ok: weeklyPhaseContext.relativeShortVolumeScore >= WANG_STRATEGY_CONSTANTS.shortVolumeEntryScoreThreshold,
      detail: "1편 기준으로는 상대적으로 가장 짧은 거래량일수록 저평가 진입 구간 설명이 쉬워집니다.",
      group: "structure",
      weight: 10,
    },
    {
      id: "week-cooldown",
      label: "인생거래량 이후 기간 조정",
      ok: weeklyPhaseContext.cooldownReady,
      detail: "인생거래량 직후보다 일정 기간 조정을 거친 뒤 minimum을 읽는 흐름이 1편 원리에 가깝습니다.",
      group: "structure",
      weight: 8,
    },
    {
      id: "week-breakout-reset",
      label: "2차 거래량 신고가 조건",
      ok: weeklyPhaseContext.breakoutReady,
      detail: "1편에서는 2차 거래량이 1차 최대 거래량을 넘어야 신고가 재출발 가능성을 더 높게 봅니다.",
      group: "structure",
      weight: 4,
    },
  );

  checklist.push({
    id: "half-max-warning",
    label: "최대거래량 절반 재출현 경계 없음",
    ok: !weeklyPhaseContext.recentHalfExitWarning,
    detail: "1편에서는 최대 거래량의 절반 수준 거래량이 다시 크게 붙으면 시세 마무리 경고로 읽습니다.",
    group: "risk",
    weight: 5,
  });

  const score = clamp(
    Math.round(weeklyPhaseContext.score * 0.58 + dailyExecutionContext.score * 0.42),
    0,
    100,
  );

  const confidence = clamp(
    Math.round(weeklyPhaseContext.confidence * 0.55 + dailyExecutionContext.confidence * 0.45),
    0,
    100,
  );

  const reasons: string[] = [];
  if (weeklyPhaseContext.anchorTime) {
    reasons.push(
      `${weeklyPhaseContext.anchorTime} 주봉 최대거래량을 기준으로 기준거래량 참조값 ${weeklyPhaseContext.referenceVolume.toLocaleString("ko-KR")}을 계산했습니다.`,
    );
  } else {
    reasons.push("주봉 데이터가 약하면 일봉 해석도 교육형 보조 시나리오에 머뭅니다.");
  }
  reasons.push(`주봉 phase는 ${weeklyPhaseContext.headline}로, 반복 기준거래량 ${weeklyPhaseContext.baseRepeatCount}회가 반영됐습니다.`);
  if (dailyExecutionContext.hasProjectedZone && projectedDayZone != null) {
    reasons.push(
      `일봉 실행 zone은 ${Math.round(projectedDayZone.low).toLocaleString("ko-KR")}~${Math.round(projectedDayZone.high).toLocaleString("ko-KR")}입니다.`,
    );
  }
  reasons.push(dailyExecutionContext.action);
  if (dailyExecutionContext.dailyRebaseCount > 0) {
    reasons.push(`일봉 재기준거래량이 ${dailyExecutionContext.dailyRebaseCount}회 확인돼 실행 해석을 보강합니다.`);
  }
  if (monthAnalysis?.regime === "DOWN") {
    reasons.push("월봉이 하락 정렬이라도 이번 버전에서는 교육형 보수 해석으로만 반영합니다.");
  }

  if (weeklyPhaseContext.minVolume != null) {
    reasons.push(
      `1편 기준 상대 최저 거래량 압축 점수는 ${weeklyPhaseContext.relativeShortVolumeScore}점이며 최소거래량은 ${weeklyPhaseContext.minVolume.toLocaleString("ko-KR")}입니다.`,
    );
  }
  if (weeklyPhaseContext.cooldownBarsFromLife != null) {
    reasons.push(
      `인생거래량 이후 ${weeklyPhaseContext.cooldownBarsFromLife}주가 지나 minimum을 읽고 있어 기간 조정 여부를 함께 반영합니다.`,
    );
  }
  if (weeklyPhaseContext.breakoutReady && weeklyPhaseContext.secondSurgeTime) {
    reasons.push(`2차 거래량이 1차 최대 거래량을 넘긴 주봉 신호가 ${weeklyPhaseContext.secondSurgeTime}에 확인됐습니다.`);
  }

  const riskNotes: WangStrategyRiskNote[] = [];
  if (!weeklyPhaseContext.hasMinVolume) {
    riskNotes.push({
      id: "risk-no-minimum",
      title: "주봉 minimum 미확인",
      detail: "주봉 minimum이 없으면 아직은 구조 설명 단계지 실행 단계로 보기 어렵습니다.",
      severity: "warning",
    });
  }
  if (!dailyExecutionContext.hasProjectedZone) {
    riskNotes.push({
      id: "risk-no-zone",
      title: "주봉 zone 미완성",
      detail: "minimum 이후 zone이 아직 약하면 적립 구간 설명은 가능해도 확정 위치로 보기 어렵습니다.",
      severity: "warning",
    });
  }
  if (!weeklyPhaseContext.cooldownReady && weeklyPhaseContext.hasMinVolume) {
    riskNotes.push({
      id: "risk-short-cooldown",
      title: "기간 조정 부족",
      detail: "1편 기준으로는 인생거래량 이후 충분한 시간 조정을 거친 minimum이 더 안정적입니다.",
      severity: "info",
    });
  }
  if (dailyExecutionContext.state === "AVOID_BREAKDOWN" && projectedDayZone != null) {
    riskNotes.push({
      id: "risk-zone-break",
      title: "주봉 zone 하단 이탈",
      detail: `일봉 종가가 zone 하단 ${Math.round(projectedDayZone.low).toLocaleString("ko-KR")} 아래로 밀리면 1차 적립 가설은 약해집니다.`,
      severity: "danger",
    });
  }
  if (dailyExecutionContext.state === "AVOID_OVERHEAT") {
    riskNotes.push({
      id: "risk-overheat",
      title: "zone 대비 과열",
      detail: "zone에서 너무 멀어져 추격보다 다음 균형가격을 기다리는 편이 낫습니다.",
      severity: "warning",
    });
  }
  if (!dayDetection.belowMa20) {
    riskNotes.push({
      id: "risk-ma20-above",
      title: "20일선 위 실행",
      detail: "20일선 위에서는 적립보다 관찰과 zone 재접근 확인이 먼저입니다.",
      severity: "info",
    });
  }
  if (weeklyPhaseContext.recentHalfExitWarning && weeklyPhaseContext.halfExitTime) {
    riskNotes.push({
      id: "risk-half-max-exit",
      title: "최대거래량 절반 재출현",
      detail: `${weeklyPhaseContext.halfExitTime} 주봉에서 최대거래량 절반 수준이 다시 붙어 1편 기준 시세 마무리 경고로 읽습니다.`,
      severity: "warning",
    });
  }
  if (weekAnalysis?.regime === "DOWN" || monthAnalysis?.regime === "DOWN") {
    riskNotes.push({
      id: "risk-topdown",
      title: "상위 타임프레임 역풍",
      detail: "월봉 또는 주봉 추세가 약하면 일봉 실행 신호도 보수적으로 취급해야 합니다.",
      severity: "warning",
    });
  }
  if (riskNotes.length === 0) {
    riskNotes.push({
      id: "risk-open",
      title: "룰 기반 2차 해석",
      detail: "phase, zone, MA20, 재기준거래량까지 실제 로직에 연결했지만 분봉 실행과 백테스트는 아직 다음 단계입니다.",
      severity: "info",
    });
  }

  const tradeZones: WangStrategyTradeZone[] = [];
  if (mainZoneSource && mainZoneSource.zoneLow != null && mainZoneSource.zoneHigh != null) {
    const active = dailyExecutionContext.inProjectedZone || dailyExecutionContext.retestDetected;

    tradeZones.push(
      buildTradeZone(
        mainZoneSource.tf,
        mainZoneSource.candles,
        mainZoneSource.zoneStartIndex,
        mainZoneSource.zoneEndIndex,
        mainZoneSource.zoneLow,
        mainZoneSource.zoneHigh,
        active,
        dayDetection.belowMa20,
      ),
    );
  }

  const weekMarkers: WangStrategyMarker[] = [];
  const weekRefLevels: WangStrategyRefLevel[] = [];
  const weekZones: WangStrategyZoneOverlay[] = [];

  if (weekDetection) {
    if (weekDetection.lifeIndex >= 0) {
      weekMarkers.push(
        buildMarker("week", weekDetection.candles, weekDetection.lifeIndex, "VOL_LIFE", "인생거래량", "주봉 최대 거래량 기준점", 96, "aboveBar", "square", "#f97316"),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, weekDetection.lifeIndex, weekDetection.candles[weekDetection.lifeIndex].close, "life.ref", "#f97316", "dashed"),
      );
    }

    weekDetection.baseIndices.forEach((index, order) => {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          index,
          "VOL_BASE",
          `기준거래량 ${order + 1}`,
          "주봉 반복 기준거래량 후보",
          clamp(Math.round((weekDetection.candles[index].volume / weekDetection.referenceVolume) * 35), 40, 90),
          "aboveBar",
          "circle",
          "#57a3ff",
        ),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, index, weekDetection.candles[index].close, `base.ref.${order + 1}`, "#57a3ff", "solid"),
      );
    });

    weekDetection.risingIndices.forEach((index) => {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          index,
          "VOL_RISE",
          "상승거래량",
          "주봉 상승거래량으로 해석되는 구간",
          clamp(Math.round((weekDetection.candles[index].volume / weekDetection.referenceVolume) * 30), 45, 92),
          "aboveBar",
          "arrowUp",
          "#00b386",
        ),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, index, weekDetection.candles[index].close, "rise.ref", "#00b386", "solid"),
      );
    });

    weekDetection.elasticIndices.forEach((index) => {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          index,
          "VOL_ELASTIC",
          "탄력거래량",
          "주봉 탄력이 붙는 확장 구간",
          clamp(Math.round(bodyRatio(weekDetection.candles[index]) * 100), 55, 98),
          "aboveBar",
          "square",
          "#facc15",
        ),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, index, weekDetection.candles[index].high, "elastic.ref", "#facc15", "solid"),
      );
    });

    if (weekDetection.minIndex >= 0) {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          weekDetection.minIndex,
          "VOL_MIN",
          "최소거래량",
          "활성 기준거래량 이후 절대 최저 주봉 거래량",
          95,
          "belowBar",
          "circle",
          "#22d3ee",
        ),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, weekDetection.minIndex, weekDetection.candles[weekDetection.minIndex].low, "min.ref", "#22d3ee", "dashed"),
      );
    }

    if (weekDetection.secondSurgeIndex >= 0) {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          weekDetection.secondSurgeIndex,
          "VOL_BREAKOUT",
          "2차 거래량",
          "1편 기준 1차 최대 거래량을 넘겨 신고가 재출발을 확인하는 구간",
          90,
          "aboveBar",
          "arrowUp",
          "#a78bfa",
        ),
      );
      weekRefLevels.push(
        buildRefLevel(
          "week",
          weekDetection.candles,
          weekDetection.secondSurgeIndex,
          weekDetection.candles[weekDetection.secondSurgeIndex].high,
          "breakout.ref",
          "#a78bfa",
          "solid",
        ),
      );
    }

    if (weekDetection.halfExitIndex >= 0) {
      weekMarkers.push(
        buildMarker(
          "week",
          weekDetection.candles,
          weekDetection.halfExitIndex,
          "VOL_HALF",
          "절반 거래량",
          "1편 기준 최대거래량 절반 수준 재출현으로 시세 마무리 경고 구간",
          weekDetection.recentHalfExitWarning ? 88 : 72,
          "aboveBar",
          "arrowDown",
          "#fb7185",
        ),
      );
      weekRefLevels.push(
        buildRefLevel(
          "week",
          weekDetection.candles,
          weekDetection.halfExitIndex,
          weekDetection.candles[weekDetection.halfExitIndex].close,
          "half.ref",
          "#fb7185",
          "dashed",
        ),
      );
    }

    if (weekDetection.zoneLow != null && weekDetection.zoneHigh != null) {
      weekZones.push(
        buildZoneOverlay(
          "week",
          "주봉 zone",
          "week",
          weekDetection.zoneLow,
          weekDetection.zoneHigh,
          weekDetection.candles[weekDetection.zoneStartIndex].time,
          weekDetection.candles[weekDetection.zoneEndIndex].time,
          dayDetection.belowMa20 ? "rgba(0, 179, 134, 0.20)" : "rgba(87, 163, 255, 0.18)",
          dayDetection.belowMa20 ? "accumulation" : "warning",
        ),
      );
      weekMarkers.push({
        id: `wang-week-zone-${weekDetection.candles[weekDetection.zoneEndIndex].time}`,
        tf: "week",
        t: weekDetection.candles[weekDetection.zoneEndIndex].time,
        type: "VOL_ZONE",
        label: "week.zone",
        desc: "주봉 최소거래량 이후 형성된 핵심 zone",
        price: toRoundedNumber((weekDetection.zoneLow + weekDetection.zoneHigh) / 2),
        volume: 0,
        strength: weekDetection.inZone || isRecentRetest(weekDetection.candles, weekDetection.latestRetestIndex) ? 92 : 74,
        position: "belowBar",
        shape: "square",
        color: dayDetection.belowMa20 ? "#00b386" : "#57a3ff",
      });
    }

    if (weekDetection.latestRetestIndex >= 0) {
      weekMarkers.push(
        buildMarker("week", weekDetection.candles, weekDetection.latestRetestIndex, "VOL_RETEST", "주봉 재접근", "주봉 zone 재확인 구간", 88, "belowBar", "arrowUp", "#00d2d3"),
      );
      weekRefLevels.push(
        buildRefLevel("week", weekDetection.candles, weekDetection.latestRetestIndex, weekDetection.candles[weekDetection.latestRetestIndex].close, "retest.ref", "#00d2d3", "dashed"),
      );
    }
  }

  const dayMarkers: WangStrategyMarker[] = [];
  const dayRefLevels: WangStrategyRefLevel[] = [];
  const dayZones: WangStrategyZoneOverlay[] = [];

  dailyRebaseIndices.forEach((index, order) => {
    dayMarkers.push(
      buildMarker(
        "day",
        dayDetection.candles,
        index,
        "VOL_BASE",
        `일봉 재기준 ${order + 1}`,
        "일봉에서 다시 기준거래량이 붙는 구간",
        clamp(Math.round((dayDetection.candles[index].volume / Math.max(dayDetection.referenceVolume, 1)) * 35), 35, 86),
        "aboveBar",
        "circle",
        "#93c5fd",
      ),
    );
    dayRefLevels.push(
      buildRefLevel("day", dayDetection.candles, index, dayDetection.candles[index].close, `day.base.${order + 1}`, "#93c5fd", "solid"),
    );
  });

  if (dayDetection.minIndex >= 0) {
    dayMarkers.push(
      buildMarker(
        "day",
        dayDetection.candles,
        dayDetection.minIndex,
        "VOL_MIN",
        "일봉 최소거래량",
        "활성 구간 이후 절대 최저 일봉 거래량",
        82,
        "belowBar",
        "circle",
        "#67e8f9",
      ),
    );
    dayRefLevels.push(
      buildRefLevel("day", dayDetection.candles, dayDetection.minIndex, dayDetection.candles[dayDetection.minIndex].low, "day.min.ref", "#67e8f9", "dashed"),
    );
  }

  if (projectedDayZone != null) {
    const startTime = dayCandles[projectedDayZone.startIndex].time;
    const endTime = dayCandles[projectedDayZone.endIndex].time;
    dayZones.push(
      buildZoneOverlay(
        "day",
        "주봉 zone 투영",
        mainZoneSource?.tf ?? "week",
        projectedDayZone.low,
        projectedDayZone.high,
        startTime,
        endTime,
        "rgba(0, 179, 134, 0.16)",
        "projection",
      ),
    );
    dayRefLevels.push(
      buildStaticRefLevel("day", startTime, endTime, projectedDayZone.high, "week.zone.high", "#34d399", "solid"),
    );
    dayRefLevels.push(
      buildStaticRefLevel("day", startTime, endTime, projectedDayZone.low, "week.zone.low", "#2dd4bf", "dashed"),
    );
    dayMarkers.push({
      id: `wang-day-zone-${endTime}`,
      tf: "day",
      t: endTime,
      type: "VOL_ZONE",
      label: "zone",
      desc: "주봉 zone을 일봉 상세 차트에 투영한 구간",
      price: toRoundedNumber((projectedDayZone.low + projectedDayZone.high) / 2),
      volume: Math.round(dayCandles[dayCandles.length - 1]?.volume ?? 0),
      strength: projectedDayInZone ? 92 : 74,
      position: "belowBar",
      shape: "square",
      color: "#34d399",
    });
  } else if (dayDetection.zoneLow != null && dayDetection.zoneHigh != null) {
    dayZones.push(
      buildZoneOverlay(
        "day",
        "일봉 zone",
        "day",
        dayDetection.zoneLow,
        dayDetection.zoneHigh,
        dayDetection.candles[dayDetection.zoneStartIndex].time,
        dayDetection.candles[dayDetection.zoneEndIndex].time,
        "rgba(87, 163, 255, 0.18)",
        "warning",
      ),
    );
  }

  if (projectedDayRetestIndex >= 0) {
    dayMarkers.push(
      buildMarker("day", dayDetection.candles, projectedDayRetestIndex, "VOL_RETEST", "일봉 재접근", "주봉 zone 재접근 확인", 90, "belowBar", "arrowUp", "#00d2d3"),
    );
    dayRefLevels.push(
      buildRefLevel("day", dayDetection.candles, projectedDayRetestIndex, dayDetection.candles[projectedDayRetestIndex].close, "day.retest.ref", "#00d2d3", "dashed"),
    );
  } else if (dayDetection.latestRetestIndex >= 0) {
    dayMarkers.push(
      buildMarker("day", dayDetection.candles, dayDetection.latestRetestIndex, "VOL_RETEST", "일봉 zone 확인", "일봉 자체 zone 재확인", 78, "belowBar", "arrowUp", "#38bdf8"),
    );
  }

  const weekMarkersSorted = sortMarkers(weekMarkers);
  const dayMarkersSorted = sortMarkers(dayMarkers);

  const weekHighlightTime =
    weekMarkersSorted.find((item) => item.type === "VOL_RETEST")?.t ??
    weekMarkersSorted.find((item) => item.type === "VOL_MIN")?.t ??
    weekMarkersSorted[weekMarkersSorted.length - 1]?.t ??
    null;
  const dayHighlightTime =
    dayMarkersSorted.find((item) => item.type === "VOL_RETEST")?.t ??
    dayMarkersSorted.find((item) => item.type === "VOL_BASE")?.t ??
    dayMarkersSorted[dayMarkersSorted.length - 1]?.t ??
    dayCandles[dayCandles.length - 1]?.time ??
    null;

  const phases: WangStrategyPhaseItem[] = [
    buildPhaseItem(
      "LIFE_VOLUME",
      currentPhase,
      phaseSource.lifeIndex >= 0
        ? [buildOccurrence(phaseSource.candles, phaseSource.lifeIndex, "최대 거래량을 기준점으로 잡은 시작 단계입니다.", 96)]
        : [],
      phaseSource.lifeIndex >= 0
        ? "인생거래량이 확인돼 이후 기준거래량과 평균거래량 비교의 축이 생겼습니다."
        : "인생거래량 기준이 아직 약하면 나머지 단계 해석도 임시값에 가깝습니다.",
      "다음 단계는 최대거래량의 약 10~12% 수준에서 반복되는 기준거래량을 찾는 것입니다.",
    ),
    buildPhaseItem(
      "BASE_VOLUME",
      currentPhase,
      phaseSource.baseIndices.map((index) =>
        buildOccurrence(
          phaseSource.candles,
          index,
          "기준거래량은 여러 번 반복될 수 있으므로 출현 횟수 자체도 중요한 힌트입니다.",
          clamp(Math.round((phaseSource.candles[index].volume / Math.max(phaseSource.referenceVolume, 1)) * 35), 40, 90),
        ),
      ),
      phaseSource.baseIndices.length > 0
        ? `기준거래량이 ${phaseSource.baseIndices.length}회 관찰돼 균형가격과 반복 패턴을 읽을 수 있습니다.`
        : "기준거래량 반복이 아직 약해 구조 설명은 가능하지만 확정감은 낮습니다.",
      "다음 단계는 기준거래량 이후 실제로 가격과 거래량이 함께 상승하는지 확인하는 것입니다.",
    ),
    buildPhaseItem(
      "RISING_VOLUME",
      currentPhase,
      phaseSource.risingIndices.map((index) =>
        buildOccurrence(
          phaseSource.candles,
          index,
          "기준거래량 이후 상승거래량이 이어지며 위로 실린 구간입니다.",
          clamp(Math.round((phaseSource.candles[index].volume / Math.max(phaseSource.referenceVolume, 1)) * 30), 45, 92),
        ),
      ),
      phaseSource.risingIndices.length > 0
        ? "상승거래량이 나와 단순한 균형이 아니라 위쪽으로 쏠리는 심리 전환이 관찰됩니다."
        : "기준거래량은 있지만 아직 상승거래량 확장이 약해 관찰 비중이 더 큽니다.",
      "다음 단계는 거래량이 더 강해지면서 몸통 탄력이 붙는 탄력거래량입니다.",
    ),
    buildPhaseItem(
      "ELASTIC_VOLUME",
      currentPhase,
      phaseSource.elasticIndices.map((index) =>
        buildOccurrence(
          phaseSource.candles,
          index,
          "거래량과 몸통이 함께 커지며 탄력이 붙는 구간입니다.",
          clamp(Math.round(bodyRatio(phaseSource.candles[index]) * 100), 55, 98),
        ),
      ),
      phaseSource.elasticIndices.length > 0
        ? "탄력거래량이 확인돼 심리가 쏠린 뒤 다시 눌리는 구간을 기다릴 근거가 생겼습니다."
        : "탄력 확장이 충분하지 않으면 minimum 구간 해석도 이른 판단일 수 있습니다.",
      "다음 단계는 거래량이 급감하는 최소거래량 구간과 그 이후 zone 형성 여부입니다.",
    ),
    buildPhaseItem(
      "MIN_VOLUME",
      currentPhase,
      phaseSource.minIndex >= 0
        ? [buildOccurrence(phaseSource.candles, phaseSource.minIndex, "가장 쌀 확률이 높은 자리 후보로 해석하는 최소거래량입니다.", 95)]
        : [],
      phaseSource.minIndex >= 0
        ? "최소거래량이 확인돼 가장 싼 자리 후보를 설명할 수 있게 됐습니다."
        : "최소거래량이 없으면 이후 zone 설명이 아직 약합니다.",
      "다음 단계는 최소거래량 이후 캔들 고저로 zone을 만들고 그 zone을 다시 확인하는 것입니다.",
    ),
    buildPhaseItem(
      "REACCUMULATION",
      currentPhase,
      phaseSource.latestRetestIndex >= 0
        ? [buildOccurrence(phaseSource.candles, phaseSource.latestRetestIndex, "zone을 다시 확인하는 재축적 구간입니다.", 88)]
        : [],
      phaseSource.latestRetestIndex >= 0
        ? "재축적이 확인돼 관찰만 하던 구조를 실전 적립 후보로 옮겨 볼 수 있습니다."
        : "재축적 확인 전이므로 아직은 설명 가능한 후보 구간으로 보는 편이 안전합니다.",
      "다음 단계는 zone 하단을 지키면서 거래량이 다시 붙는지 확인하는 것입니다.",
    ),
  ];

  const summaryHeadline =
    currentPhase === "NONE"
      ? "주봉 phase는 아직 약하지만 일봉 실행 후보를 함께 관찰합니다."
      : `${weeklyPhaseContext.headline} / ${WANG_EXECUTION_STATE_LABEL[dailyExecutionContext.state]}`;
  const posture =
    interpretation === "ACCUMULATE"
      ? "주봉 구조와 일봉 실행 조건이 겹쳐 분할 적립 후보로 해석할 수 있습니다."
      : interpretation === "OVERHEAT"
        ? "일봉이 zone 대비 과열이라 추격보다 다음 균형가격 재확인이 우선입니다."
        : interpretation === "CAUTION"
          ? "상위 타임프레임 역풍 또는 zone 이탈 리스크가 있어 방어적으로 접근해야 합니다."
          : "주봉 phase는 읽히지만 일봉 실행 조건은 아직 관찰 단계입니다.";

  const weekChartOverlays: WangStrategyChartOverlays = {
    movingAverages: [],
    refLevels: weekRefLevels,
    zones: weekZones,
    highlightTime: weekHighlightTime,
  };

  const dayChartOverlays: WangStrategyChartOverlays = {
    movingAverages: [
      {
        id: "ma20",
        label: "MA20",
        color: "#7dd3fc",
        lineWidth: 2,
        points: dayDetection.ma20Series,
      },
    ],
    refLevels: dayRefLevels,
    zones: dayZones,
    highlightTime: dayHighlightTime,
  };

  return {
    meta: {
      input,
      symbol,
      name,
      market,
      asOf,
      source: "KIS",
      cacheTtlSec,
      tf: "multi",
      candleCount: dayCandles.length,
      maxVolume: Math.round(phaseSource.maxVolume),
      averageVolume: Math.round(phaseSource.averageVolume),
      referenceVolume: Math.round(phaseSource.referenceVolume),
    },
    summary: {
      phase: currentPhase,
      confidence,
      score,
      interpretation,
      headline: summaryHeadline,
      posture,
    },
    weeklyPhaseContext,
    dailyExecutionContext,
    phases,
    currentPhase,
    confidence,
    score,
    reasons: reasons.slice(0, 6),
    checklist: checklist.map(({ weight: _weight, ...item }) => item),
    riskNotes,
    tradeZones,
    movingAverageContext: {
      ma20: dayDetection.ma20 != null ? toRoundedNumber(dayDetection.ma20) : null,
      close: toRoundedNumber(dayDetection.close),
      belowMa20: dayDetection.belowMa20,
      distancePct: dayDetection.ma20DistancePct != null ? toRoundedNumber(dayDetection.ma20DistancePct) : null,
      verdict:
        dailyExecutionContext.state === "READY_ON_RETEST"
          ? "20일선 아래 재접근 적립 후보"
          : dayDetection.belowMa20
            ? "20일선 아래 적립 후보"
            : "20일선 위 관찰 구간",
      guidance: dailyExecutionContext.action,
    },
    multiTimeframe: {
      month: toTimeframeSummary(monthAnalysis),
      week: toTimeframeSummary(weekAnalysis),
      day: toTimeframeSummary(dayAnalysis),
    },
    candles: {
      week: weekCandles,
      day: dayCandles,
    },
    chartOverlays: {
      week: weekChartOverlays,
      day: dayChartOverlays,
    },
    markers: {
      week: weekMarkersSorted,
      day: dayMarkersSorted,
    },
    trainingNotes: buildTrainingNotes(phaseSource.referenceVolume, phaseSource.maxVolume),
    warnings,
  };
};

export const summarizeWangStrategyPayload = (
  payload: WangStrategyPayload,
): WangStrategyScreeningSummary => {
  const currentPhase = payload.currentPhase;
  const actionBias = payload.summary.interpretation;
  const executionState = payload.dailyExecutionContext.state;
  const zoneReady =
    payload.dailyExecutionContext.hasProjectedZone &&
    executionState !== "AVOID_BREAKDOWN";
  const ma20DiscountReady = payload.dailyExecutionContext.belowMa20;
  const dailyRebaseReady = payload.dailyExecutionContext.dailyRebaseCount > 0;
  const retestReady = payload.dailyExecutionContext.retestDetected;
  const phaseReady = currentPhase === "MIN_VOLUME" || currentPhase === "REACCUMULATION";
  const eligible =
    actionBias === "ACCUMULATE" &&
    phaseReady &&
    zoneReady &&
    (ma20DiscountReady || retestReady || dailyRebaseReady);
  const label = eligible
    ? "적립 후보"
    : currentPhase !== "NONE" && actionBias !== "CAUTION" && actionBias !== "OVERHEAT"
      ? "관찰 후보"
      : "비적합";
  const weeklyPhaseLabel =
    payload.weeklyPhaseContext.phase === "NONE"
      ? "주봉 대기"
      : WANG_PHASE_LABEL[payload.weeklyPhaseContext.phase];

  return {
    eligible,
    label,
    score: payload.score,
    confidence: payload.confidence,
    currentPhase,
    actionBias,
    executionState,
    reasons: payload.reasons.slice(0, 3),
    weekBias: `${weeklyPhaseLabel} · ${payload.weeklyPhaseContext.headline}`,
    dayBias: `${WANG_EXECUTION_STATE_LABEL[executionState]} · ${payload.dailyExecutionContext.action}`,
    zoneReady,
    ma20DiscountReady,
    dailyRebaseReady,
    retestReady,
  };
};

export const buildWangStrategyScreeningSummary = (
  params: Parameters<typeof buildWangStrategyPayload>[0],
): WangStrategyScreeningSummary =>
  summarizeWangStrategyPayload(buildWangStrategyPayload(params));
