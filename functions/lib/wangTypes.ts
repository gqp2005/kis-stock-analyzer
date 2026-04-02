import type { Candle, IndicatorPoint, Regime, Timeframe } from "./types";

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
  | "WAIT_PULLBACK"
  | "READY_ON_ZONE"
  | "READY_ON_RETEST"
  | "AVOID_BREAKDOWN"
  | "AVOID_OVERHEAT";

export type WangStrategyChartTimeframe = "week" | "day";

export type WangStrategyMarkerType =
  | "VOL_LIFE"
  | "VOL_BASE"
  | "VOL_RISE"
  | "VOL_ELASTIC"
  | "VOL_MIN"
  | "VOL_RETEST"
  | "VOL_ZONE";

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
  baseRepeatCount: number;
  risingCount: number;
  elasticCount: number;
  hasMinVolume: boolean;
  hasWeeklyZone: boolean;
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

export interface WangStrategyScreeningSummary {
  eligible: boolean;
  label: "적립 후보" | "관찰 후보" | "비적합";
  score: number;
  confidence: number;
  currentPhase: WangStrategyPhase;
  actionBias: WangStrategyInterpretation;
  executionState: WangStrategyExecutionState;
  reasons: string[];
  weekBias: string;
  dayBias: string;
  zoneReady: boolean;
  ma20DiscountReady: boolean;
  dailyRebaseReady: boolean;
  retestReady: boolean;
}

export interface WangStrategyPayload {
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
  warnings: string[];
}
