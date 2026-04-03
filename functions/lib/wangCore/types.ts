import type { Candle, IndicatorPoint } from "../types";

export type WangStrategyPhase =
  | "LIFE_VOLUME"
  | "BASE_VOLUME"
  | "RISING_VOLUME"
  | "ELASTIC_VOLUME"
  | "MIN_VOLUME"
  | "REACCUMULATION"
  | "NONE";

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

export type WangChartTimeframe = "week" | "day" | "month" | "intraday" | "event" | "multi";

export interface WangEvidence {
  id: string;
  key: string;
  tf: WangChartTimeframe;
  time?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  price?: number | null;
  volume?: number | null;
  note: string;
  weight?: number;
}

export interface WangDetectorResult<T> {
  key: string;
  ok: boolean;
  score: number;
  confidence: number;
  value: T;
  reasons: string[];
  evidence: WangEvidence[];
  warnings?: string[];
}

export interface WangChecklistAtom {
  id: string;
  group: "structure" | "execution" | "risk";
  label: string;
  ok: boolean;
  detail: string;
  sourceKeys: string[];
  weight?: number;
}

export interface WangRiskAtom {
  id: string;
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  sourceKeys: string[];
  blocking?: boolean;
}

export interface WangMarkerSeed {
  id: string;
  tf: "week" | "day";
  namespace: string;
  time: string;
  endTime?: string | null;
  label: string;
  desc: string;
  price?: number;
  low?: number;
  high?: number;
  volume?: number;
  strength: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square" | "diamond";
  colorToken: string;
  sourceKeys: string[];
}

export interface WangLifeVolumeContext {
  index: number;
  time: string | null;
  volume: number | null;
  direction: "UP" | "DOWN" | "MIXED";
}

export interface WangBaseVolumeContext {
  indices: number[];
  times: string[];
  repeatCount: number;
  referenceVolume: number;
  baseHalfThreshold: number;
}

export interface WangBaseDirectionAnchorContext {
  anchorIndex: number;
  anchorTime: string | null;
  anchorOpen: number | null;
  anchorClose: number | null;
  assumedDirection: "UP" | "DOWN" | "SIDEWAYS";
}

export interface WangRisingVolumeContext {
  indices: number[];
  count: number;
}

export interface WangElasticVolumeContext {
  indices: number[];
  count: number;
  firstElasticIndex: number;
}

export interface WangMinVolumeRegionContext {
  startIndex: number;
  endIndex: number;
  startTime: string | null;
  endTime: string | null;
  durationBars: number;
  thresholdVolume: number | null;
}

export interface WangMinVolumePointContext {
  index: number;
  time: string | null;
  volume: number | null;
  low: number | null;
  high: number | null;
}

export interface WangAccumulationWindowContext {
  minBars: number;
  maxBars: number;
  activeBars: number | null;
  ready: boolean;
}

export interface WangPitDiggingContext {
  detected: boolean;
  index: number;
  time: string | null;
  flushDepthPct: number | null;
}

export interface WangSupplyFlushTestContext {
  detected: boolean;
  index: number;
  time: string | null;
  flushedSupplyPct: number | null;
}

export interface WangWeeklyDetectorInput {
  candles: Candle[];
  ma20Series?: IndicatorPoint[];
}

export interface WangWeeklyDetectorMetrics {
  maxVolume: number;
  averageVolume: number;
  referenceVolume: number;
  ma20: number | null;
  close: number | null;
}

export interface WangWeeklyDetectorBundle {
  metrics: WangWeeklyDetectorMetrics;
  lifeVolume: WangDetectorResult<WangLifeVolumeContext>;
  baseVolume: WangDetectorResult<WangBaseVolumeContext>;
  baseRepeat: WangDetectorResult<WangBaseVolumeContext>;
  baseDirectionAnchor: WangDetectorResult<WangBaseDirectionAnchorContext>;
  risingVolume: WangDetectorResult<WangRisingVolumeContext>;
  elasticVolume: WangDetectorResult<WangElasticVolumeContext>;
  minVolumeRegion: WangDetectorResult<WangMinVolumeRegionContext>;
  minVolumePoint: WangDetectorResult<WangMinVolumePointContext>;
  accumulationWindow: WangDetectorResult<WangAccumulationWindowContext>;
  pitDigging: WangDetectorResult<WangPitDiggingContext>;
  supplyFlushTest: WangDetectorResult<WangSupplyFlushTestContext>;
}

export interface WangEventImpactSignal {
  present: boolean;
  date?: string | null;
  label?: string | null;
  priceShockPct?: number | null;
  directImpact?: boolean | null;
  revenueImpact?: boolean | null;
  businessImpact?: boolean | null;
}

export interface WangMarketShockSignal {
  present: boolean;
  date?: string | null;
  label?: string | null;
  marketDropPct?: number | null;
}

export interface WangProjectedZoneContext {
  ready: boolean;
  low: number | null;
  high: number | null;
  sourceTime: string | null;
  sourceStartTime: string | null;
  sourceEndTime: string | null;
  projectedStartIndex: number;
  projectedEndIndex: number;
}

export interface WangDailyRebaseContext {
  indices: number[];
  count: number;
  referenceVolume: number;
  latestTime: string | null;
}

export interface WangMa20DiscountContext {
  ma20: number | null;
  close: number | null;
  belowMa20: boolean;
  distancePct: number | null;
}

export interface WangRetestContext {
  indices: number[];
  latestIndex: number;
  latestTime: string | null;
  inZoneNow: boolean;
  brokeDown: boolean;
}

export interface WangEventImpactContext {
  evaluated: boolean;
  present: boolean;
  shockDate: string | null;
  shockLabel: string | null;
  priceShockPct: number | null;
  directImpact: boolean;
  revenueImpact: boolean;
  businessImpact: boolean;
  actionableRisk: boolean;
}

export interface WangMacroShockValidationContext {
  evaluated: boolean;
  present: boolean;
  shockDate: string | null;
  shockLabel: string | null;
  externalShock: boolean;
  validatedAsOpportunity: boolean;
}

export interface WangPsychologyFlipContext {
  confirmed: boolean;
  index: number;
  time: string | null;
  triggerPrice: number | null;
}

export interface WangStrongStockPullbackContext {
  isStrong: boolean;
  pullbackDetected: boolean;
  index: number;
  time: string | null;
  lowVolume: boolean;
  nearRecentHigh: boolean;
}

export interface WangLowVolumePullbackContext {
  dropDetected: boolean;
  lowVolume: boolean;
  nearZone: boolean;
  nearMa20: boolean;
  accumulationCandidate: boolean;
  index: number;
  time: string | null;
  dropPct: number | null;
}

export interface WangReentryEligibilityContext {
  allowed: boolean;
  state: WangStrategyExecutionState;
  reason: string;
  triggers: string[];
  blockers: string[];
}

export interface WangDailyDetectorInput {
  candles: Candle[];
  ma20Series?: IndicatorPoint[];
  weekly: WangWeeklyDetectorBundle;
  eventSignal?: WangEventImpactSignal | null;
  marketShockSignal?: WangMarketShockSignal | null;
}

export interface WangDailyDetectorMetrics {
  maxVolume: number;
  averageVolume: number;
  referenceVolume: number;
  ma20: number | null;
  close: number | null;
  belowMa20: boolean;
  ma20DistancePct: number | null;
}

export interface WangDailyDetectorBundle {
  metrics: WangDailyDetectorMetrics;
  projectedZone: WangDetectorResult<WangProjectedZoneContext>;
  dailyRebase: WangDetectorResult<WangDailyRebaseContext>;
  ma20Discount: WangDetectorResult<WangMa20DiscountContext>;
  retest: WangDetectorResult<WangRetestContext>;
  eventImpact: WangDetectorResult<WangEventImpactContext>;
  macroShockValidation: WangDetectorResult<WangMacroShockValidationContext>;
  psychologyFlip: WangDetectorResult<WangPsychologyFlipContext>;
  strongStockPullback: WangDetectorResult<WangStrongStockPullbackContext>;
  lowVolumePullback: WangDetectorResult<WangLowVolumePullbackContext>;
  reentryEligibility: WangDetectorResult<WangReentryEligibilityContext>;
}

export interface WangScreenerSummary {
  eligible: boolean;
  label: "적립 후보" | "관찰 후보" | "비적합";
  score: number;
  confidence: number;
  currentPhase: WangStrategyPhase;
  actionBias: "ACCUMULATE" | "WATCH" | "CAUTION" | "OVERHEAT";
  executionState: WangStrategyExecutionState;
  reasons: string[];
  weekBias: string;
  dayBias: string;
  zoneReady: boolean;
  ma20DiscountReady: boolean;
  dailyRebaseReady?: boolean;
  retestReady?: boolean;
  psychologyFlipReady?: boolean;
  strongStockPullbackReady?: boolean;
  lowVolumePullbackReady?: boolean;
}
