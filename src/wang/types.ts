import type { Candle, IndicatorPoint, Regime, Timeframe } from "../types";

export type WangStrategyPhase =
  | "LIFE_VOLUME"
  | "BASE_VOLUME"
  | "RISING_VOLUME"
  | "ELASTIC_VOLUME"
  | "MIN_VOLUME"
  | "REACCUMULATION"
  | "NONE";

export type WangStrategyInterpretation = "WATCH" | "ACCUMULATE" | "CAUTION" | "OVERHEAT";
export type WangStrategyExecutionState =
  | "WAIT_WEEKLY_STRUCTURE"
  | "WAIT_MIN_REGION"
  | "WAIT_PULLBACK"
  | "READY_ON_DISCOUNT"
  | "READY_ON_ZONE"
  | "READY_ON_RETEST"
  | "READY_ON_PSYCHOLOGY_FLIP"
  | "AVOID_BREAKDOWN"
  | "AVOID_EVENT_RISK"
  | "AVOID_OVERHEAT";

export type WangStrategyChartTimeframe = "week" | "day";

export type WangStrategyMarkerType =
  | "VOL_LIFE"
  | "VOL_BASE"
  | "VOL_RISE"
  | "VOL_ELASTIC"
  | "VOL_MIN_REGION"
  | "VOL_MIN"
  | "VOL_RETEST"
  | "VOL_ZONE"
  | "VOL_BREAKOUT"
  | "VOL_HALF"
  | "EVENT_SHOCK"
  | "PSYCHOLOGY_FLIP"
  | "STRONG_PULLBACK";

export interface WangStrategyMarker {
  id: string;
  tf: WangStrategyChartTimeframe;
  t: string;
  type: WangStrategyMarkerType;
  label: string;
  desc: string;
  price: number;
  volume: number;
  strength: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
}

export interface WangStrategyPhaseOccurrence {
  time: string;
  price: number;
  volume: number;
  strength: number;
  note: string;
}

export interface WangStrategyPhaseItem {
  phase: Exclude<WangStrategyPhase, "NONE">;
  title: string;
  status: "completed" | "active" | "pending";
  summary: string;
  nextCondition: string;
  occurrences: WangStrategyPhaseOccurrence[];
}

export interface WangStrategyChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  group: "structure" | "execution" | "risk";
}

export interface WangStrategyRiskNote {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "danger";
}

export interface WangStrategySplitPlanItem {
  label: string;
  price: number;
  weightPct: number;
  note: string;
}

export interface WangStrategyTradeZone {
  id: string;
  label: string;
  sourceTf: WangStrategyChartTimeframe;
  low: number;
  high: number;
  active: boolean;
  anchorPhase: "MIN_VOLUME" | "REACCUMULATION";
  startTime: string;
  endTime: string;
  invalidationPrice: number;
  scenario: string;
  splitPlan: WangStrategySplitPlanItem[];
}

export interface WangStrategyMovingAverageContext {
  ma20: number | null;
  close: number | null;
  belowMa20: boolean;
  distancePct: number | null;
  verdict: string;
  guidance: string;
}

export interface WangStrategyTimeframeSummary {
  tf: Timeframe;
  regime: Regime;
  structure: "모으기" | "가르기" | "혼합";
  score: number;
  phaseBias: WangStrategyPhase;
  summary: string;
  reasons: string[];
}

export interface WangStrategyRefLevel {
  id: string;
  label: string;
  sourceTf: WangStrategyChartTimeframe;
  price: number;
  startTime: string;
  endTime: string;
  color: string;
  style: "solid" | "dashed";
}

export interface WangStrategyZoneOverlay {
  id: string;
  label: string;
  sourceTf: WangStrategyChartTimeframe;
  low: number;
  high: number;
  startTime: string;
  endTime: string;
  color: string;
  kind: "accumulation" | "warning" | "projection";
}

export interface WangStrategyMovingAverageLine {
  id: string;
  label: string;
  color: string;
  lineWidth: number;
  points: IndicatorPoint[];
}

export interface WangStrategyChartOverlays {
  movingAverages: WangStrategyMovingAverageLine[];
  refLevels: WangStrategyRefLevel[];
  zones: WangStrategyZoneOverlay[];
  highlightTime: string | null;
}

export interface WangStrategyTrainingNote {
  id: string;
  title: string;
  text: string;
  emphasis: "core" | "practice" | "warning";
}

export interface WangStrategySummary {
  phase: WangStrategyPhase;
  confidence: number;
  score: number;
  interpretation: WangStrategyInterpretation;
  headline: string;
  posture: string;
}

export interface WangStrategyWeeklyPhaseContext {
  phase: WangStrategyPhase;
  score: number;
  confidence: number;
  headline: string;
  stageSummary: string;
  referenceVolume: number;
  averageVolume: number;
  maxVolume: number;
  minVolume: number | null;
  baseRepeatCount: number;
  risingCount: number;
  elasticCount: number;
  hasMinVolume: boolean;
  hasWeeklyZone: boolean;
  relativeShortVolumeScore: number;
  cooldownBarsFromLife: number | null;
  cooldownReady: boolean;
  breakoutReady: boolean;
  recentHalfExitWarning: boolean;
  secondSurgeTime: string | null;
  halfExitTime: string | null;
  anchorTime: string | null;
}

export interface WangStrategyDailyExecutionContext {
  state: WangStrategyExecutionState;
  score: number;
  confidence: number;
  headline: string;
  action: string;
  belowMa20: boolean;
  hasProjectedZone: boolean;
  inProjectedZone: boolean;
  retestDetected: boolean;
  dailyRebaseCount: number;
  zoneWidthPct: number | null;
  lastRetestTime: string | null;
}

export interface WangStrategyMinVolumeRegionContext {
  startTime: string | null;
  endTime: string | null;
  durationBars: number;
  thresholdVolume: number | null;
}

export interface WangStrategyEventImpactContext {
  evaluated: boolean;
  actionableRisk: boolean;
  shockDate: string | null;
  shockLabel: string | null;
  priceShockPct: number | null;
  directImpact: boolean;
  revenueImpact: boolean;
  businessImpact: boolean;
}

export interface WangStrategyPsychologyFlipContext {
  confirmed: boolean;
  time: string | null;
  triggerPrice: number | null;
}

export interface WangStrategyStrongStockContext {
  isStrong: boolean;
  pullbackDetected: boolean;
  time: string | null;
  lowVolume: boolean;
  nearRecentHigh: boolean;
}

export interface WangStrategyDeprecatedFields {
  legacyCurrentPhaseMirrorsSummary: boolean;
  legacyInterpretationFromExecutionState: boolean;
}

export interface WangStrategyResponse {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    tf: "multi";
    candleCount: number;
    maxVolume: number;
    averageVolume: number;
    referenceVolume: number;
  };
  summary: WangStrategySummary;
  weeklyPhaseContext: WangStrategyWeeklyPhaseContext;
  dailyExecutionContext: WangStrategyDailyExecutionContext;
  minVolumeRegionContext?: WangStrategyMinVolumeRegionContext | null;
  eventImpactContext?: WangStrategyEventImpactContext | null;
  psychologyFlipContext?: WangStrategyPsychologyFlipContext | null;
  strongStockContext?: WangStrategyStrongStockContext | null;
  phases: WangStrategyPhaseItem[];
  currentPhase: WangStrategyPhase;
  confidence: number;
  score: number;
  reasons: string[];
  checklist: WangStrategyChecklistItem[];
  riskNotes: WangStrategyRiskNote[];
  tradeZones: WangStrategyTradeZone[];
  movingAverageContext: WangStrategyMovingAverageContext;
  multiTimeframe: {
    month: WangStrategyTimeframeSummary | null;
    week: WangStrategyTimeframeSummary | null;
    day: WangStrategyTimeframeSummary | null;
  };
  candles: {
    week: Candle[];
    day: Candle[];
  };
  chartOverlays: {
    week: WangStrategyChartOverlays;
    day: WangStrategyChartOverlays;
  };
  markers: {
    week: WangStrategyMarker[];
    day: WangStrategyMarker[];
  };
  trainingNotes: WangStrategyTrainingNote[];
  deprecated?: WangStrategyDeprecatedFields;
  warnings: string[];
}
