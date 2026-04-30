import type {
  CupHandleHit,
  DarvasRetestHit,
  FlowPersistenceHit,
  Nr7InsideBarHit,
  PatternHit,
  RsiDivergenceHit,
  StrategyBacktestSummary,
  TrendTemplateHit,
  WangStrategyScreeningSummary,
  WashoutPullbackHit,
} from "../types";

export const defaultPatternHit = (reason: string): PatternHit => ({
  detected: false,
  state: "NONE",
  neckline: null,
  breakDate: null,
  target: null,
  score: 0,
  confidence: 0,
  reasons: [reason],
});

export const defaultCupHandleHit = (reason: string): CupHandleHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  neckline: null,
  breakout: false,
  cupDepthPct: null,
  handleDepthPct: null,
  cupWidthBars: null,
  handleBars: null,
  reasons: [reason],
});

export const defaultWashoutPullbackHit = (reason: string): WashoutPullbackHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  anchorTurnoverRatio: null,
  reentryTurnoverRatio: null,
  pullbackZone: {
    low: null,
    high: null,
  },
  invalidPrice: null,
  riskPct: null,
  position: "N/A",
  reasons: [reason],
  warnings: [],
});

export const defaultDarvasRetestHit = (reason: string): DarvasRetestHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  boxHigh: null,
  boxLow: null,
  breakoutDate: null,
  retestDate: null,
  reasons: [reason],
});

export const defaultNr7InsideBarHit = (reason: string): Nr7InsideBarHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  setupDate: null,
  triggerHigh: null,
  triggerLow: null,
  breakoutDate: null,
  breakoutDirection: "NONE",
  reasons: [reason],
});

export const defaultTrendTemplateHit = (reason: string): TrendTemplateHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  nearHigh52wPct: null,
  reasons: [reason],
});

export const defaultRsiDivergenceHit = (reason: string): RsiDivergenceHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  neckline: null,
  breakoutDate: null,
  reasons: [reason],
});

export const defaultFlowPersistenceHit = (reason: string): FlowPersistenceHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  upVolumeRatio20: null,
  obvSlope20: null,
  reasons: [reason],
});

export const defaultBacktestSummary = (): StrategyBacktestSummary | null => null;

export const defaultWangStrategySummary = (): WangStrategyScreeningSummary => ({
  eligible: false,
  label: "비적합",
  score: 0,
  confidence: 0,
  currentPhase: "NONE",
  actionBias: "WATCH",
  executionState: "WAIT_WEEKLY_STRUCTURE",
  reasons: ["왕장군 검증 데이터가 아직 없습니다."],
  weekBias: "주봉 phase 미평가",
  dayBias: "일봉 실행 미평가",
  zoneReady: false,
  ma20DiscountReady: false,
  dailyRebaseReady: false,
  retestReady: false,
});
