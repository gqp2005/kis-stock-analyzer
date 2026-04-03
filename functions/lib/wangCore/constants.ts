export const WANG_VOLUME_RATIO = {
  averageLower: 0.1,
  averageUpper: 0.12,
  baseMax: 1.45,
  risingMin: 1.15,
  elasticMin: 1.35,
  elasticVsRisingMin: 0.6,
  elasticVsRisingMax: 1.05,
  baseMaxLifeCap: 0.98,
  baseCloseToMa20Buffer: 0.98,
} as const;

export const WANG_WEEKLY_RULES = {
  basePivotSpan: 2,
  basePivotAverageMultiple: 3,
  elasticBodyRatio: 0.55,
  elasticRisePct: 3.5,
  minRegionPreferredBarsMin: 12,
  minRegionPreferredBarsMax: 26,
  pitDiggingRangeLookback: 8,
  pitDiggingVolumeCapRatio: 1.15,
  supplyFlushRecoveryBars: 4,
  supplyFlushRecoveryClosePct: 0.5,
} as const;

export const WANG_DAILY_RULES = {
  projectedZoneTolerancePct: 0.012,
  projectedZoneBreakPct: 0.015,
  overheatFromZonePct: 0.12,
  overheatFromMa20Pct: 0.08,
  rebasePivotSpan: 1,
  rebaseMinRatio: 0.95,
  rebaseCloseBias: 0.995,
  psychologyFlipLookback: 8,
  psychologyFlipRecoveryBars: 3,
  psychologyFlipRecoveryRatio: 0.55,
  strongStockLookback: 40,
  strongStockNearHighPct: 0.08,
  lowVolumePullbackDropPct: -3.5,
  lowVolumePullbackVolumeCap: 0.95,
  lowVolumePullbackZoneTolerancePct: 0.02,
} as const;
