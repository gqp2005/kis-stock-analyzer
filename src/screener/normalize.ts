import type {
  DashboardOverviewResponse,
  ScreenerItem,
  ScreenerResponse,
  WangStrategyExecutionState,
  WangStrategyScreeningSummary,
} from "../types";

export const normalizeWangStrategy = (
  wang: WangStrategyScreeningSummary | null | undefined,
): WangStrategyScreeningSummary => ({
  eligible: wang?.eligible ?? false,
  label: wang?.label ?? "비적합",
  score: wang?.score ?? 0,
  confidence: wang?.confidence ?? 0,
  currentPhase: wang?.currentPhase ?? "NONE",
  actionBias: wang?.actionBias ?? "WATCH",
  executionState: wang?.executionState ?? ("WAIT_WEEKLY_STRUCTURE" as WangStrategyExecutionState),
  reasons: wang?.reasons ?? [],
  weekBias: wang?.weekBias ?? "주봉 미평가",
  dayBias: wang?.dayBias ?? "일봉 미평가",
  zoneReady: wang?.zoneReady ?? false,
  ma20DiscountReady: wang?.ma20DiscountReady ?? false,
  dailyRebaseReady: wang?.dailyRebaseReady ?? false,
  retestReady: wang?.retestReady ?? false,
});

export const normalizeScreenerItem = (item: ScreenerItem): ScreenerItem => ({
  ...item,
  reasons: item.reasons ?? [],
  wangStrategy: normalizeWangStrategy(item.wangStrategy),
});

export const normalizeDashboard = (
  dashboard: DashboardOverviewResponse,
): DashboardOverviewResponse => ({
  ...dashboard,
  marketTemperature: {
    ...dashboard.marketTemperature,
    wangWatchCount: dashboard.marketTemperature.wangWatchCount ?? 0,
    wangIneligibleCount: dashboard.marketTemperature.wangIneligibleCount ?? 0,
  },
  strategyRanking: (dashboard.strategyRanking ?? []).map((item) => ({
    ...item,
    scoreMode: item.scoreMode ?? (item.key === "wangStrategy" ? "validation" : "primary"),
  })),
  wangValidation: dashboard.wangValidation ?? {
    totalValidated: 0,
    summary: "왕장군 검증 데이터가 아직 없습니다.",
    distribution: {
      eligible: 0,
      watchCandidate: 0,
      notEligible: 0,
      byActionBias: {
        ACCUMULATE: 0,
        WATCH: 0,
        CAUTION: 0,
        OVERHEAT: 0,
      },
      byPhase: [],
    },
    ranking: {
      byActionBias: [],
      byPhase: [],
    },
  },
  timeline: (dashboard.timeline ?? []).map((item) => ({
    ...item,
    scoreMode: item.scoreMode ?? (item.strategyKey === "wangStrategy" ? "validation" : "primary"),
  })),
  favorites: {
    trackedCount: dashboard.favorites?.trackedCount ?? 0,
    activeCount: dashboard.favorites?.activeCount ?? 0,
    missingCodes: dashboard.favorites?.missingCodes ?? [],
    alerts: (dashboard.favorites?.alerts ?? []).map((item) => ({
      ...item,
      wangPhase: item.wangPhase ?? null,
      wangActionBias: item.wangActionBias ?? null,
    })),
  },
});

export const normalizeScreenerResponse = (response: ScreenerResponse): ScreenerResponse => ({
  ...response,
  meta: {
    ...response.meta,
    changeSummary: response.meta.changeSummary
      ? {
          ...response.meta.changeSummary,
          added: response.meta.changeSummary.added ?? [],
          removed: response.meta.changeSummary.removed ?? [],
          risers: response.meta.changeSummary.risers ?? [],
          fallers: response.meta.changeSummary.fallers ?? [],
          scoreRisers: response.meta.changeSummary.scoreRisers ?? [],
          scoreFallers: response.meta.changeSummary.scoreFallers ?? [],
        }
      : null,
    validationSummary: response.meta.validationSummary
      ? {
          ...response.meta.validationSummary,
          activeCutoffs: response.meta.validationSummary.activeCutoffs ?? {
            all: 0,
            volume: 0,
            hs: 0,
            ihs: 0,
            vcp: 0,
          },
          latestRuns: response.meta.validationSummary.latestRuns ?? {
            weekly: null,
            monthly: null,
          },
        }
      : null,
    lastRebuildStatus: response.meta.lastRebuildStatus
      ? {
          ...response.meta.lastRebuildStatus,
          inProgress: response.meta.lastRebuildStatus.inProgress ?? false,
          processed: response.meta.lastRebuildStatus.processed ?? 0,
          total: response.meta.lastRebuildStatus.total ?? 0,
          updatedAt: response.meta.lastRebuildStatus.updatedAt ?? null,
          failedCount: response.meta.lastRebuildStatus.failedCount ?? 0,
          retriedSymbols: response.meta.lastRebuildStatus.retriedSymbols ?? 0,
          totalRetries: response.meta.lastRebuildStatus.totalRetries ?? 0,
        }
      : null,
    filters: response.meta.filters
      ? {
          ...response.meta.filters,
          wangEligible: response.meta.filters.wangEligible ?? "ALL",
          wangActionBias: response.meta.filters.wangActionBias ?? "ALL",
          wangPhase: response.meta.filters.wangPhase ?? "ALL",
          wangZoneReady: response.meta.filters.wangZoneReady ?? "ALL",
          wangMa20DiscountReady: response.meta.filters.wangMa20DiscountReady ?? "ALL",
        }
      : undefined,
  },
  items: (response.items ?? []).map(normalizeScreenerItem),
  warningItems: (response.warningItems ?? []).map(normalizeScreenerItem),
  warnings: response.warnings ?? [],
});
