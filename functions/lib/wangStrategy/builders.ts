import type { Candle, TimeframeAnalysis } from "../types";
import type {
  WangStrategyChartTimeframe,
  WangStrategyExecutionState,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyPhase,
  WangStrategyPhaseItem,
  WangStrategyPhaseOccurrence,
  WangStrategyRefLevel,
  WangStrategyTimeframeSummary,
  WangStrategyTradeZone,
  WangStrategyTrainingNote,
  WangStrategyZoneOverlay,
} from "../wangTypes";
import { WANG_PHASE_LABEL, WANG_STRATEGY_CONSTANTS } from "../wangStrategyConstants";
import { toRoundedNumber } from "./utils";

export const toTimeframeSummary = (
  analysis: TimeframeAnalysis | null,
): WangStrategyTimeframeSummary | null => {
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

export const buildOccurrence = (
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

export const buildPhaseItem = (
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

export const buildMarker = (
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

export const buildRefLevel = (
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

export const buildStaticRefLevel = (
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

export const buildZoneOverlay = (
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

export const buildTrainingNotes = (
  referenceVolume: number,
  maxVolume: number,
): WangStrategyTrainingNote[] => [
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

export const buildTradeZone = (
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

export const sortMarkers = (markers: WangStrategyMarker[]): WangStrategyMarker[] =>
  [...markers].sort((left, right) => left.t.localeCompare(right.t));

export const mapExecutionToInterpretation = (
  state: WangStrategyExecutionState,
): WangStrategyInterpretation => {
  if (state === "READY_ON_ZONE" || state === "READY_ON_RETEST") return "ACCUMULATE";
  if (state === "AVOID_OVERHEAT") return "OVERHEAT";
  if (state === "AVOID_BREAKDOWN") return "CAUTION";
  return "WATCH";
};
