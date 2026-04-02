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
  group: "structure" | "timing" | "risk";
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
  price: number;
  startTime: string;
  endTime: string;
  color: string;
  style: "solid" | "dashed";
}

export interface WangStrategyZoneOverlay {
  id: string;
  label: string;
  low: number;
  high: number;
  startTime: string;
  endTime: string;
  color: string;
  kind: "accumulation" | "warning";
}

export interface WangStrategyChartOverlays {
  ma20Series: IndicatorPoint[];
  refLevels: WangStrategyRefLevel[];
  zones: WangStrategyZoneOverlay[];
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
  chartOverlays: WangStrategyChartOverlays;
  markers: WangStrategyMarker[];
  trainingNotes: WangStrategyTrainingNote[];
  candles: Candle[];
  warnings: string[];
}
