import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  DashboardOverviewResponse,
  ScreenerBooleanFilter,
  ScreenerWashoutPositionFilter,
  ScreenerWashoutStateFilter,
  ScreenerWangActionBiasFilter,
  ScreenerWangPhaseFilter,
  ScreenerItem,
  ScreenerMarketFilter,
  ScreenerResponse,
  ScreenerStrategyFilter,
  WangStrategyActionBias,
  WangStrategyPhase,
  WangStrategyScreeningSummary,
} from "./types";
import FavoriteButton from "./FavoriteButton";
import {
  readFavoriteNotificationState,
  useFavorites,
  writeFavoriteNotificationState,
} from "./favorites";
import {
  formatFactor,
  formatPercent,
  formatPrice,
  overallClass,
  overallLabel,
} from "./format";
import {
  type ScreenerVerdict,
  type SortKey,
  FAVORITE_NOTIFY_KEY,
  atrShrinkPercent,
  booleanFilterLabel,
  cupHandleStateLabel,
  cupHandleTagClass,
  dashboardScoreModeLabel,
  dashboardStrategyLabel,
  dryUpStrengthLabel,
  formatDepth,
  formatDistancePercent,
  formatNullable,
  formatRatioPercent,
  formatRiskPercent,
  formatScore,
  formatSignedPercent,
  formatSignedRatioPercent,
  formatSignedScore,
  formatMultiple,
  hsStateLabel,
  isWangSortKey,
  leadershipLabel,
  marketLabel,
  patternTypeLabel,
  pivotLabel,
  riskGradeLabel,
  rsStrengthLabel,
  simpleStrategyStateClass,
  simpleStrategyStateLabel,
  sortLabel,
  strategyLabel,
  vcpStateLabel,
  verdictClass,
  wangActionBiasLabel,
  wangBadgeClass,
  wangPhaseLabel,
  washoutPositionLabel,
  washoutStateBadgeClass,
  washoutStateLabel,
  washoutStatePriority,
} from "./screener/labels";
import {
  normalizeDashboard,
  normalizeScreenerResponse,
} from "./screener/normalize";
import {
  type ScreenerCompactItem,
  type WangFilterState,
  type WangPresetId,
  WANG_FILTER_DEFAULTS,
  WANG_PRESETS,
  buildCardOneLiner,
  buildCompactItems,
  sortItems,
} from "./screener/buildCard";

interface ScreenerPanelProps {
  apiBase: string;
  onSelectSymbol: (code: string) => void;
  onSelectWangStrategy: (code: string) => void;
}

interface ScreenerQueryState {
  market: ScreenerMarketFilter;
  strategy: ScreenerStrategyFilter;
  washoutState: ScreenerWashoutStateFilter;
  washoutPosition: ScreenerWashoutPositionFilter;
  washoutRiskMax: string;
  wangEligible: ScreenerBooleanFilter;
  wangActionBias: ScreenerWangActionBiasFilter;
  wangPhase: ScreenerWangPhaseFilter;
  wangZoneReady: ScreenerBooleanFilter;
  wangMa20DiscountReady: ScreenerBooleanFilter;
  count: number;
  universe: number;
}
export default function ScreenerPanel(props: ScreenerPanelProps) {
  const { apiBase, onSelectSymbol, onSelectWangStrategy } = props;
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 860px)").matches;
  });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileDashboardOpen, setMobileDashboardOpen] = useState(false);
  const [market, setMarket] = useState<ScreenerMarketFilter>("ALL");
  const [strategy, setStrategy] = useState<ScreenerStrategyFilter>("ALL");
  const [washoutState, setWashoutState] = useState<ScreenerWashoutStateFilter>("ALL");
  const [washoutPosition, setWashoutPosition] = useState<ScreenerWashoutPositionFilter>("ALL");
  const [washoutRiskMax, setWashoutRiskMax] = useState<string>("ALL");
  const [wangEligible, setWangEligible] = useState<ScreenerBooleanFilter>("ALL");
  const [wangActionBias, setWangActionBias] = useState<ScreenerWangActionBiasFilter>("ALL");
  const [wangPhase, setWangPhase] = useState<ScreenerWangPhaseFilter>("ALL");
  const [wangZoneReady, setWangZoneReady] = useState<ScreenerBooleanFilter>("ALL");
  const [wangMa20DiscountReady, setWangMa20DiscountReady] = useState<ScreenerBooleanFilter>("ALL");
  const [count, setCount] = useState(30);
  const [universe, setUniverse] = useState(500);
  const [sortKey, setSortKey] = useState<SortKey>("SCORE");
  const [showAdvancedSummary, setShowAdvancedSummary] = useState(false);
  const [showAdvancedCards, setShowAdvancedCards] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ScreenerResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardOverviewResponse | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [favoriteNotificationsEnabled, setFavoriteNotificationsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(FAVORITE_NOTIFY_KEY) === "true";
  });
  const { favorites, favoriteCodes, isFavorite, toggleFavorite } = useFavorites();

  const fetchDashboard = async (codes: string[] = favoriteCodes) => {
    try {
      setDashboardError("");
      const query = new URLSearchParams();
      if (codes.length > 0) {
        query.set("favorites", codes.join(","));
      }
      const url = `${apiBase}/api/dashboard${query.toString() ? `?${query.toString()}` : ""}`;
      const result = await fetch(url);
      const data = (await result.json()) as DashboardOverviewResponse | { error?: string };
      if (!result.ok) throw new Error("error" in data && data.error ? data.error : "대시보드 조회 실패");
      setDashboard(normalizeDashboard(data as DashboardOverviewResponse));
    } catch (e) {
      setDashboardError(e instanceof Error ? e.message : "대시보드 조회 실패");
      setDashboard(null);
    }
  };

  const fetchScreener = async (override?: Partial<ScreenerQueryState>) => {
    const nextMarket = override?.market ?? market;
    const nextStrategy = override?.strategy ?? strategy;
    const nextCount = override?.count ?? count;
    const nextUniverse = override?.universe ?? universe;
    const nextWashoutState = override?.washoutState ?? washoutState;
    const nextWashoutPosition = override?.washoutPosition ?? washoutPosition;
    const nextWashoutRiskMax = override?.washoutRiskMax ?? washoutRiskMax;
    const nextWangEligible = override?.wangEligible ?? wangEligible;
    const nextWangActionBias = override?.wangActionBias ?? wangActionBias;
    const nextWangPhase = override?.wangPhase ?? wangPhase;
    const nextWangZoneReady = override?.wangZoneReady ?? wangZoneReady;
    const nextWangMa20DiscountReady =
      override?.wangMa20DiscountReady ?? wangMa20DiscountReady;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        market: nextMarket,
        strategy: nextStrategy,
        count: String(nextCount),
        universe: String(nextUniverse),
      });
      if (nextStrategy === "WASHOUT_PULLBACK") {
        query.set("state", nextWashoutState);
        query.set("position", nextWashoutPosition);
        if (nextWashoutRiskMax !== "ALL") {
          query.set("riskPctMax", nextWashoutRiskMax);
        }
      }
      if (nextWangEligible !== "ALL") {
        query.set("wangEligible", nextWangEligible);
      }
      if (nextWangActionBias !== "ALL") {
        query.set("wangActionBias", nextWangActionBias);
      }
      if (nextWangPhase !== "ALL") {
        query.set("wangPhase", nextWangPhase);
      }
      if (nextWangZoneReady !== "ALL") {
        query.set("wangZoneReady", nextWangZoneReady);
      }
      if (nextWangMa20DiscountReady !== "ALL") {
        query.set("wangMa20DiscountReady", nextWangMa20DiscountReady);
      }
      const url = `${apiBase}/api/screener?${query.toString()}`;
      const result = await fetch(url);
      const data = (await result.json()) as ScreenerResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "스크리너 조회 실패");
      setResponse(normalizeScreenerResponse(data as ScreenerResponse));
      setExpandedCards({});
      setLastLoadedAt(new Date().toISOString());
      void fetchDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchScreener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteCodes.join(",")]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FAVORITE_NOTIFY_KEY, favoriteNotificationsEnabled ? "true" : "false");
  }, [favoriteNotificationsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileView(event.matches);
    };
    setIsMobileView(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!isMobileView) {
      setMobileFiltersOpen(false);
      setMobileDashboardOpen(false);
    }
  }, [isMobileView]);

  const hasActiveWangFilters =
    wangEligible !== "ALL" ||
    wangActionBias !== "ALL" ||
    wangPhase !== "ALL" ||
    wangZoneReady !== "ALL" ||
    wangMa20DiscountReady !== "ALL";

  useEffect(() => {
    if (!hasActiveWangFilters) return;
    if (isWangSortKey(sortKey)) return;
    setSortKey("WANG_SCORE");
  }, [hasActiveWangFilters, sortKey]);

  useEffect(() => {
    if (!dashboard || !favoriteNotificationsEnabled) return;
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const snapshotKey = dashboard.meta.lastUpdatedAt ?? dashboard.meta.asOf;
    const seen = readFavoriteNotificationState();
    const nextSeen = { ...seen };
    let changed = false;
    for (const alert of dashboard.favorites.alerts.slice(0, 3)) {
      const dedupeKey = `${snapshotKey}:${alert.code}:${alert.title}`;
      if (seen[dedupeKey]) continue;
      new Notification(`${alert.name}(${alert.code}) · ${alert.title}`, {
        body: alert.summary,
      });
      nextSeen[dedupeKey] = snapshotKey;
      changed = true;
    }
    if (changed) {
      writeFavoriteNotificationState(nextSeen);
    }
  }, [dashboard, favoriteNotificationsEnabled]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void fetchScreener();
  };

  const resetFiltersAndFetch = () => {
    const defaults: ScreenerQueryState = {
      market: "ALL",
      strategy: "ALL",
      washoutState: "ALL",
      washoutPosition: "ALL",
      washoutRiskMax: "ALL",
      wangEligible: "ALL",
      wangActionBias: "ALL",
      wangPhase: "ALL",
      wangZoneReady: "ALL",
      wangMa20DiscountReady: "ALL",
      count: 30,
      universe: 500,
    };
    setMarket(defaults.market);
    setStrategy(defaults.strategy);
    setWashoutState(defaults.washoutState);
    setWashoutPosition(defaults.washoutPosition);
    setWashoutRiskMax(defaults.washoutRiskMax);
    setWangEligible(defaults.wangEligible);
    setWangActionBias(defaults.wangActionBias);
    setWangPhase(defaults.wangPhase);
    setWangZoneReady(defaults.wangZoneReady);
    setWangMa20DiscountReady(defaults.wangMa20DiscountReady);
    setCount(defaults.count);
    setUniverse(defaults.universe);
    setSortKey("SCORE");
    void fetchScreener(defaults);
  };

  const toggleCardDetails = (key: string) => {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const rerunAsAllStrategy = () => {
    setStrategy("ALL");
    setWashoutState("ALL");
    setWashoutPosition("ALL");
    setWashoutRiskMax("ALL");
    setWangEligible("ALL");
    setWangActionBias("ALL");
    setWangPhase("ALL");
    setWangZoneReady("ALL");
    setWangMa20DiscountReady("ALL");
    void fetchScreener({
      strategy: "ALL",
      washoutState: "ALL",
      washoutPosition: "ALL",
      washoutRiskMax: "ALL",
      wangEligible: "ALL",
      wangActionBias: "ALL",
      wangPhase: "ALL",
      wangZoneReady: "ALL",
      wangMa20DiscountReady: "ALL",
    });
  };

  const setWangFilterState = (next: WangFilterState) => {
    setWangEligible(next.wangEligible);
    setWangActionBias(next.wangActionBias);
    setWangPhase(next.wangPhase);
    setWangZoneReady(next.wangZoneReady);
    setWangMa20DiscountReady(next.wangMa20DiscountReady);
  };

  const activeWangPresetId = useMemo(() => {
    const matched = WANG_PRESETS.find((preset) =>
      preset.filters.wangEligible === wangEligible &&
      preset.filters.wangActionBias === wangActionBias &&
      preset.filters.wangPhase === wangPhase &&
      preset.filters.wangZoneReady === wangZoneReady &&
      preset.filters.wangMa20DiscountReady === wangMa20DiscountReady,
    );
    return matched?.id ?? null;
  }, [wangActionBias, wangEligible, wangMa20DiscountReady, wangPhase, wangZoneReady]);

  const applyWangPreset = (presetId: WangPresetId) => {
    const preset = WANG_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setWangFilterState(preset.filters);
    setSortKey(preset.sortKey);
    void fetchScreener({
      ...preset.filters,
    });
  };

  const rankedItems = useMemo(
    () => sortItems(response?.items ?? [], sortKey, strategy),
    [response?.items, sortKey, strategy],
  );
  const warningItems = useMemo(
    () => sortItems(response?.warningItems ?? [], "SCORE", "ALL"),
    [response?.warningItems],
  );
  const changeSummary = response?.meta.changeSummary ?? null;
  const changeAdded = changeSummary?.added ?? [];
  const changeRisers = changeSummary?.risers ?? [];
  const changeFallers = changeSummary?.fallers ?? [];
  const changeRemoved = changeSummary?.removed ?? [];
  const changeScoreRisers = changeSummary?.scoreRisers ?? [];
  const changeScoreFallers = changeSummary?.scoreFallers ?? [];
  const cupHandleDetectedCount = rankedItems.filter(
    (item) => item.hits.cupHandle.detected || item.hits.cupHandle.state !== "NONE",
  ).length;
  const washoutDetectedCount = rankedItems.filter(
    (item) =>
      item.hits.washoutPullback.detected && item.hits.washoutPullback.state !== "NONE",
  ).length;
  const cupHandleUndetectedCount = Math.max(0, rankedItems.length - cupHandleDetectedCount);
  const washoutUndetectedCount = Math.max(0, rankedItems.length - washoutDetectedCount);
  const activeFilterChips = useMemo(() => {
    const chips = [
      `시장 ${marketLabel(market)}`,
      `전략 ${strategyLabel(strategy)}`,
      `정렬 ${sortLabel(sortKey)}`,
      `노출 ${count}개`,
      `유니버스 ${universe}개`,
    ];
    if (strategy === "WASHOUT_PULLBACK") {
      chips.push(`상태 ${washoutState === "ALL" ? "전체" : washoutStateLabel(washoutState)}`);
      chips.push(`현재가 ${washoutPosition === "ALL" ? "전체" : washoutPositionLabel(washoutPosition)}`);
      chips.push(`리스크 ${washoutRiskMax === "ALL" ? "제한 없음" : `${Math.round(Number(washoutRiskMax) * 100)}% 이하`}`);
    }
    if (wangEligible !== "ALL") {
      chips.push(`왕장군 적합도 ${booleanFilterLabel(wangEligible)}`);
    }
    if (wangActionBias !== "ALL") {
      chips.push(`왕장군 행동 ${wangActionBiasLabel(wangActionBias)}`);
    }
    if (wangPhase !== "ALL") {
      chips.push(`왕장군 phase ${wangPhaseLabel(wangPhase)}`);
    }
    if (wangZoneReady !== "ALL") {
      chips.push(`Zone Ready ${booleanFilterLabel(wangZoneReady)}`);
    }
    if (wangMa20DiscountReady !== "ALL") {
      chips.push(`MA20 할인 ${booleanFilterLabel(wangMa20DiscountReady)}`);
    }
    return chips;
  }, [
    count,
    market,
    sortKey,
    strategy,
    universe,
    washoutPosition,
    washoutRiskMax,
    washoutState,
    wangActionBias,
    wangEligible,
    wangMa20DiscountReady,
    wangPhase,
    wangZoneReady,
  ]);

  const rebuildProgressPct = response?.meta.lastRebuildStatus?.total
    ? Math.min(
        100,
        Math.round(
          (response.meta.lastRebuildStatus.processed / Math.max(1, response.meta.lastRebuildStatus.total)) * 100,
        ),
      )
    : null;
  const timelineGroups = useMemo(() => {
    const groups = new Map<string, DashboardOverviewResponse["timeline"]>();
    for (const item of dashboard?.timeline ?? []) {
      const bucket = groups.get(item.date) ?? [];
      bucket.push(item);
      groups.set(item.date, bucket);
    }
    return [...groups.entries()].slice(0, 6);
  }, [dashboard?.timeline]);

  const favoriteAlertCount = dashboard?.favorites.alerts.length ?? 0;
  const mobileFilterSummary = useMemo(() => {
    const parts = [`정렬 ${sortLabel(sortKey)}`, `노출 ${count}개`, showAdvancedCards ? "고급 ON" : "고급 OFF"];
    if (strategy === "WASHOUT_PULLBACK") {
      parts.push(washoutState === "ALL" ? "상태 전체" : washoutStateLabel(washoutState));
      parts.push(washoutPosition === "ALL" ? "위치 전체" : washoutPositionLabel(washoutPosition));
      parts.push(washoutRiskMax === "ALL" ? "리스크 제한 없음" : `리스크 ${Math.round(Number(washoutRiskMax) * 100)}%`);
    }
    if (wangEligible !== "ALL") {
      parts.push(`적합도 ${booleanFilterLabel(wangEligible)}`);
    }
    if (wangActionBias !== "ALL") {
      parts.push(wangActionBiasLabel(wangActionBias));
    }
    if (wangPhase !== "ALL") {
      parts.push(wangPhaseLabel(wangPhase));
    }
    if (wangZoneReady !== "ALL") {
      parts.push(`Zone ${booleanFilterLabel(wangZoneReady)}`);
    }
    if (wangMa20DiscountReady !== "ALL") {
      parts.push(`MA20 ${booleanFilterLabel(wangMa20DiscountReady)}`);
    }
    return parts.join(" · ");
  }, [
    count,
    showAdvancedCards,
    sortKey,
    strategy,
    washoutPosition,
    washoutRiskMax,
    washoutState,
    wangActionBias,
    wangEligible,
    wangMa20DiscountReady,
    wangPhase,
    wangZoneReady,
  ]);
  const mobileDashboardSummary = dashboard
    ? `${dashboard.marketTemperature.heatLabel} ${dashboard.marketTemperature.heatScore}점 · 타임라인 ${dashboard.timeline.length}건`
    : "시장 요약";
  const dashboardInsightCards = dashboard ? (
    <>
      <article className="strategy-mini-item">
        <div className="strategy-mini-head">
          <strong>시장 전체 온도계</strong>
          <small className="signal-tag neutral">
            {dashboard.marketTemperature.heatLabel} · {dashboard.marketTemperature.heatScore}점
          </small>
        </div>
        <p>
          평균 점수 {formatNullable(dashboard.marketTemperature.avgScore)} · 평균 신뢰도{" "}
          {formatNullable(dashboard.marketTemperature.avgConfidence)}
        </p>
        <p>
          강세 {dashboard.marketTemperature.strongCount} · 혼조 {dashboard.marketTemperature.neutralCount} · 주의{" "}
          {dashboard.marketTemperature.cautionCount}
        </p>
        <p>
          본 전략: RS 강세 {dashboard.marketTemperature.rsStrongCount} · 컵앤핸들{" "}
          {dashboard.marketTemperature.cupHandleCount} · 설거지 {dashboard.marketTemperature.washoutCount}
        </p>
        <p>
          왕장군 보조 검증: 적립 {dashboard.marketTemperature.wangEligibleCount} · 관찰{" "}
          {dashboard.marketTemperature.wangWatchCount} · 비적합 {dashboard.marketTemperature.wangIneligibleCount}
        </p>
        <p>{dashboard.marketTemperature.summary}</p>
      </article>

      <article className="strategy-mini-item">
        <div className="strategy-mini-head">
          <strong>본 전략 랭킹</strong>
          <small className="signal-tag neutral">상위 5개</small>
        </div>
        <ul className="insight-list">
          {dashboard.strategyRanking
            .filter((item) => item.scoreMode !== "validation")
            .slice(0, 5)
            .map((item) => (
            <li key={`rank-${item.key}`}>
              <span>
                {dashboardStrategyLabel(item.key)} · 후보 {item.candidateCount}개 · 품질 {item.qualityScore ?? "-"}
              </span>
              <small className={`signal-tag ${item.scoreMode === "validation" ? "neutral" : "positive"}`}>
                {dashboardScoreModeLabel(item.scoreMode)}
              </small>
              <small className="signal-tag neutral">
                승률 {formatNullable(item.avgWinRate)} / PF {formatNullable(item.avgPf)}
              </small>
            </li>
          ))}
        </ul>
      </article>

      <article className="strategy-mini-item">
        <div className="strategy-mini-head">
          <strong>왕장군 검증 분포</strong>
          <small className="signal-tag neutral">{dashboard.wangValidation.totalValidated}건</small>
        </div>
        <p>{dashboard.wangValidation.summary}</p>
        <p>
          적립 후보 {dashboard.wangValidation.distribution.eligible} · 관찰 후보{" "}
          {dashboard.wangValidation.distribution.watchCandidate} · 비적합{" "}
          {dashboard.wangValidation.distribution.notEligible}
        </p>
        <p>
          행동축: 적립 {dashboard.wangValidation.distribution.byActionBias.ACCUMULATE} · 관찰{" "}
          {dashboard.wangValidation.distribution.byActionBias.WATCH} · 경계{" "}
          {dashboard.wangValidation.distribution.byActionBias.CAUTION}
        </p>
        <ul className="insight-list">
          {dashboard.wangValidation.ranking.byPhase.slice(0, 3).map((item) => (
            <li key={`wang-phase-${item.key}`}>
              <span>
                {dashboardStrategyLabel(item.key)} · 후보 {item.candidateCount}개 · 평균{" "}
                {formatNullable(item.avgScore)}
              </span>
              <small className="signal-tag neutral">{dashboardScoreModeLabel(item.scoreMode)}</small>
            </li>
          ))}
          {dashboard.wangValidation.ranking.byActionBias.slice(0, 2).map((item) => (
            <li key={`wang-bias-${item.key}`}>
              <span>
                {dashboardStrategyLabel(item.key)} · 신뢰도 {formatNullable(item.avgConfidence)}
              </span>
              <small className="signal-tag neutral">{dashboardScoreModeLabel(item.scoreMode)}</small>
            </li>
          ))}
        </ul>
      </article>

      <article className="strategy-mini-item">
        <div className="strategy-mini-head">
          <strong>전략 후보 타임라인</strong>
          <small className="signal-tag neutral">{dashboard.timeline.length}건</small>
        </div>
        {timelineGroups.length > 0 ? (
          <div className="timeline-groups">
            {timelineGroups.map(([date, items]) => (
              <div key={`timeline-${date}`} className="timeline-group">
                <strong>{date}</strong>
                <ul className="insight-list">
                  {items.slice(0, 3).map((item) => (
                    <li key={`${date}-${item.code}-${item.strategyKey}`}>
                      <span>
                        {item.name}({item.code}) · {dashboardStrategyLabel(item.strategyKey)}
                      </span>
                      <small className={`signal-tag ${item.scoreMode === "validation" ? "neutral" : "positive"}`}>
                        {item.strategyKey === "wangStrategy" && item.wangPhase && item.wangActionBias
                          ? `${wangActionBiasLabel(item.wangActionBias as WangStrategyActionBias)} · ${wangPhaseLabel(
                              item.wangPhase as WangStrategyPhase,
                            )}`
                          : item.stateLabel}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="plan-note">타임라인 이벤트가 아직 없습니다.</p>
        )}
      </article>
    </>
  ) : null;

  const requestFavoriteNotificationPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    if (result === "granted") {
      setFavoriteNotificationsEnabled(true);
    }
  };

  const wangFilterControls = (
    <>
      <label>
        왕장군 적합도
        <select value={wangEligible} onChange={(e) => setWangEligible(e.target.value as ScreenerBooleanFilter)}>
          <option value="ALL">전체</option>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
        </select>
      </label>
      <label>
        행동 바이어스
        <select
          value={wangActionBias}
          onChange={(e) => setWangActionBias(e.target.value as ScreenerWangActionBiasFilter)}
        >
          <option value="ALL">전체</option>
          <option value="ACCUMULATE">적립</option>
          <option value="WATCH">관찰</option>
          <option value="CAUTION">경계</option>
          <option value="OVERHEAT">과열</option>
        </select>
      </label>
      <label>
        Phase
        <select value={wangPhase} onChange={(e) => setWangPhase(e.target.value as ScreenerWangPhaseFilter)}>
          <option value="ALL">전체</option>
          <option value="MIN_VOLUME">최소거래량</option>
          <option value="REACCUMULATION">재축적</option>
          <option value="ELASTIC_VOLUME">탄력거래량</option>
          <option value="RISING_VOLUME">상승거래량</option>
          <option value="BASE_VOLUME">기준거래량</option>
          <option value="LIFE_VOLUME">인생거래량</option>
          <option value="NONE">미감지</option>
        </select>
      </label>
      <label>
        Zone Ready
        <select value={wangZoneReady} onChange={(e) => setWangZoneReady(e.target.value as ScreenerBooleanFilter)}>
          <option value="ALL">전체</option>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
        </select>
      </label>
      <label>
        MA20 할인
        <select
          value={wangMa20DiscountReady}
          onChange={(e) => setWangMa20DiscountReady(e.target.value as ScreenerBooleanFilter)}
        >
          <option value="ALL">전체</option>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
        </select>
      </label>
    </>
  );

  const sortOptions = (
    <>
      <option value="SCORE">점수순</option>
      <option value="CONFIDENCE">신뢰도순</option>
      <option value="WANG_SCORE">왕장군 점수순</option>
      <option value="WANG_CONFIDENCE">왕장군 신뢰도순</option>
      <option value="BACKTEST">백테스트순</option>
    </>
  );

  return (
    <section className="screener">
      <form className="screener-form" onSubmit={onSubmit}>
        <div className="screener-controls screener-controls-primary">
          <label>
            시장
            <select value={market} onChange={(e) => setMarket(e.target.value as ScreenerMarketFilter)}>
              <option value="ALL">전체</option>
              <option value="KOSPI">KOSPI</option>
              <option value="KOSDAQ">KOSDAQ</option>
            </select>
          </label>
          <label>
            전략
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as ScreenerStrategyFilter)}>
              <option value="ALL">ALL</option>
              <option value="VOLUME">VOLUME</option>
              <option value="VCP">VCP</option>
              <option value="WASHOUT_PULLBACK">거래대금 설거지+눌림목</option>
              <option value="DARVAS">다르바스 박스</option>
              <option value="NR7">NR7+인사이드바</option>
              <option value="TREND_TEMPLATE">추세 템플릿</option>
              <option value="RSI_DIVERGENCE">RSI 다이버전스</option>
              <option value="FLOW_PERSISTENCE">수급 지속성</option>
              <option value="IHS">IHS</option>
              <option value="HS">HS</option>
            </select>
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "조회 중..." : "스크리너 조회"}
          </button>
        </div>

        <div className="screener-preset-row">
          <div className="screener-preset-head">
            <strong>왕장군 빠른 프리셋</strong>
            <small>
              {activeWangPresetId
                ? `${WANG_PRESETS.find((preset) => preset.id === activeWangPresetId)?.label ?? "왕장군"} 적용 중`
                : hasActiveWangFilters
                  ? "사용자 지정 왕장군 필터"
                  : "클릭 시 즉시 재조회 · 왕장군 정렬 기본 적용"}
            </small>
          </div>
          <div className="screener-preset-buttons">
            {WANG_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`screener-preset-chip${activeWangPresetId === preset.id ? " active" : ""}`}
                onClick={() => applyWangPreset(preset.id)}
                disabled={loading}
                title={preset.summary}
              >
                <span>{preset.label}</span>
                <small>{preset.summary}</small>
              </button>
            ))}
          </div>
        </div>

        {isMobileView ? (
          <details
            className="screener-mobile-drawer"
            open={mobileFiltersOpen}
            onToggle={(event) => setMobileFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              <strong>세부 필터</strong>
              <small>{mobileFilterSummary}</small>
            </summary>
            <div className="screener-controls screener-controls-secondary">
              {strategy === "WASHOUT_PULLBACK" && (
                <>
                  <label>
                    상태
                    <select
                      value={washoutState}
                      onChange={(e) => setWashoutState(e.target.value as ScreenerWashoutStateFilter)}
                    >
                      <option value="ALL">전체</option>
                      <option value="REBOUND_CONFIRMED">반등 재개(확인)</option>
                      <option value="PULLBACK_READY">눌림 관찰(준비)</option>
                      <option value="WASHOUT_CANDIDATE">반등 후보(설거지)</option>
                      <option value="ANCHOR_DETECTED">대금 흔적(앵커)</option>
                    </select>
                  </label>
                  <label>
                    현재가 위치
                    <select
                      value={washoutPosition}
                      onChange={(e) => setWashoutPosition(e.target.value as ScreenerWashoutPositionFilter)}
                    >
                      <option value="ALL">전체</option>
                      <option value="IN_ZONE">존 내부</option>
                      <option value="ABOVE_ZONE">존 위</option>
                      <option value="BELOW_ZONE">존 아래</option>
                    </select>
                  </label>
                  <label>
                    최대 리스크
                    <select value={washoutRiskMax} onChange={(e) => setWashoutRiskMax(e.target.value)}>
                      <option value="ALL">제한 없음</option>
                      <option value="0.06">6% 이하</option>
                      <option value="0.08">8% 이하</option>
                      <option value="0.10">10% 이하</option>
                      <option value="0.12">12% 이하</option>
                      <option value="0.15">15% 이하</option>
                    </select>
                  </label>
                </>
              )}
              {wangFilterControls}
              <label>
                정렬
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  disabled={strategy === "WASHOUT_PULLBACK"}
                >
                  {sortOptions}
                </select>
              </label>
              <label>
                노출 개수
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  <option value={20}>20개</option>
                  <option value={30}>30개</option>
                  <option value={50}>50개</option>
                </select>
              </label>
              <label>
                유니버스
                <select value={universe} onChange={(e) => setUniverse(Number(e.target.value))} disabled>
                  <option value={500}>500개</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showAdvancedCards}
                  onChange={(e) => setShowAdvancedCards(e.target.checked)}
                />
                카드 고급 정보
              </label>
            </div>
          </details>
        ) : (
          <div className="screener-controls screener-controls-secondary">
            {strategy === "WASHOUT_PULLBACK" && (
              <>
                <label>
                  상태
                  <select
                    value={washoutState}
                    onChange={(e) => setWashoutState(e.target.value as ScreenerWashoutStateFilter)}
                  >
                    <option value="ALL">전체</option>
                    <option value="REBOUND_CONFIRMED">반등 재개(확인)</option>
                    <option value="PULLBACK_READY">눌림 관찰(준비)</option>
                    <option value="WASHOUT_CANDIDATE">반등 후보(설거지)</option>
                    <option value="ANCHOR_DETECTED">대금 흔적(앵커)</option>
                  </select>
                </label>
                <label>
                  현재가 위치
                  <select
                    value={washoutPosition}
                    onChange={(e) => setWashoutPosition(e.target.value as ScreenerWashoutPositionFilter)}
                  >
                    <option value="ALL">전체</option>
                    <option value="IN_ZONE">존 내부</option>
                    <option value="ABOVE_ZONE">존 위</option>
                    <option value="BELOW_ZONE">존 아래</option>
                  </select>
                </label>
                <label>
                  최대 리스크
                  <select value={washoutRiskMax} onChange={(e) => setWashoutRiskMax(e.target.value)}>
                    <option value="ALL">제한 없음</option>
                    <option value="0.06">6% 이하</option>
                    <option value="0.08">8% 이하</option>
                    <option value="0.10">10% 이하</option>
                    <option value="0.12">12% 이하</option>
                    <option value="0.15">15% 이하</option>
                  </select>
                </label>
              </>
            )}
            {wangFilterControls}
            <label>
              정렬
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                disabled={strategy === "WASHOUT_PULLBACK"}
              >
                {sortOptions}
              </select>
            </label>
            <label>
              노출 개수
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                <option value={20}>20개</option>
                <option value={30}>30개</option>
                <option value={50}>50개</option>
              </select>
            </label>
            <label>
              유니버스
              <select value={universe} onChange={(e) => setUniverse(Number(e.target.value))} disabled>
                <option value={500}>500개</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showAdvancedCards}
                onChange={(e) => setShowAdvancedCards(e.target.checked)}
              />
              카드 고급 정보
            </label>
          </div>
        )}
      </form>

      <p className="screener-note">
        본 결과는 후보/시그널 참고용입니다. 매수 추천이나 수익 보장을 의미하지 않습니다.
      </p>

      <div className="screener-filter-chips">
        {activeFilterChips.map((chip) => (
          <small key={chip} className="signal-tag muted">
            {chip}
          </small>
        ))}
        {lastLoadedAt && (
          <small className="signal-tag neutral">
            마지막 조회 {new Date(lastLoadedAt).toLocaleTimeString("ko-KR", { hour12: false })}
          </small>
        )}
      </div>

      {(dashboard || dashboardError || favorites.length > 0) && (
        <div className="strategy-mini-grid screener-dashboard-grid">
          <article className="strategy-mini-item favorite-alert-card">
            <div className="strategy-mini-head">
              <strong>관심종목 알림</strong>
              <small className="signal-tag neutral">{favoriteAlertCount}건</small>
            </div>
            <p className="plan-note">등록 {favorites.length}개 · 활성 {dashboard?.favorites.activeCount ?? 0}개</p>
            <div className="screener-hit-row">
              <small className="reason-tag neutral">
                브라우저 알림 {favoriteNotificationsEnabled ? "ON" : "OFF"}
              </small>
              <button
                type="button"
                className="collapse-toggle"
                onClick={() => {
                  if (favoriteNotificationsEnabled) {
                    setFavoriteNotificationsEnabled(false);
                    return;
                  }
                  void requestFavoriteNotificationPermission();
                }}
              >
                {favoriteNotificationsEnabled ? "알림 끄기" : "알림 켜기"}
              </button>
            </div>
            {dashboard?.favorites.alerts.length ? (
              <ul className="insight-list favorite-alert-list">
                {dashboard.favorites.alerts.slice(0, 4).map((item) => (
                  <li key={`favorite-alert-${item.code}`}>
                    <span>
                      {item.name}({item.code}) · {item.title}
                    </span>
                    <small className={`reason-tag ${item.severity === "warning" ? "negative" : item.severity === "positive" ? "positive" : "neutral"}`}>
                      {item.summary}
                    </small>
                    {item.wangActionBias ? (
                      <small className="reason-tag neutral">
                        {wangActionBiasLabel(item.wangActionBias as WangStrategyActionBias)}
                        {item.wangPhase ? ` · ${wangPhaseLabel(item.wangPhase as WangStrategyPhase)}` : ""}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : favorites.length > 0 ? (
              <p className="plan-note">오늘 스냅샷 기준으로 활성 후보 알림이 없습니다.</p>
            ) : (
              <p className="plan-note">별표 버튼으로 종목을 관심종목에 추가하면 여기서 알림을 모아봅니다.</p>
            )}
            {dashboard?.favorites.missingCodes.length ? (
              <p className="plan-note">오늘 후보 아님: {dashboard.favorites.missingCodes.join(", ")}</p>
            ) : null}
            {dashboardError && <p className="plan-note">{dashboardError}</p>}
          </article>

          {!isMobileView && dashboardInsightCards}
        </div>
      )}

      {isMobileView && dashboardInsightCards && (
        <details
          className="screener-mobile-drawer screener-dashboard-drawer"
          open={mobileDashboardOpen}
          onToggle={(event) => setMobileDashboardOpen(event.currentTarget.open)}
        >
          <summary>
            <strong>시장 요약</strong>
            <small>{mobileDashboardSummary}</small>
          </summary>
          <div className="strategy-mini-grid screener-dashboard-secondary">{dashboardInsightCards}</div>
        </details>
      )}

      {error && <p className="error">{error}</p>}
      {loading && !response && (
        <div className="card screener-loading-card">
          <h3>스크리너 조회 중</h3>
          <p className="meta">조건에 맞는 후보를 불러오고 있습니다.</p>
          <div className="screener-loading-bar">
            <span />
          </div>
        </div>
      )}

      {response && (
        <>
          <div className="card">
            <h3>요약</h3>
            <div className="screener-overview-grid">
              <div className="plan-item">
                <span>스캔 종목</span>
                <strong>{response.meta.scanned}개</strong>
              </div>
              <div className="plan-item">
                <span>후보 종목</span>
                <strong>{response.meta.candidates}개</strong>
              </div>
              <div className="plan-item">
                <span>컵앤핸들 포착</span>
                <strong>{cupHandleDetectedCount}건</strong>
              </div>
              <div className="plan-item">
                <span>설거지+눌림목 포착</span>
                <strong>{washoutDetectedCount}건</strong>
              </div>
            </div>
            <p className="meta">
              {response.meta.universeLabel} · 기준 시각 {response.meta.asOf}
            </p>
            <p className="meta">
              마지막 갱신: {response.meta.lastUpdatedAt ?? "없음"}
              {response.meta.rebuildRequired ? " · rebuild 필요" : " · 최신"}
            </p>
            {response.meta.lastRebuildStatus && (
              <p className="meta">
                리빌드 상태: {response.meta.lastRebuildStatus.inProgress ? "진행 중" : "대기"} ·{" "}
                {response.meta.lastRebuildStatus.processed}/{response.meta.lastRebuildStatus.total} · 실패{" "}
                {response.meta.lastRebuildStatus.failedCount}개 · 재시도{" "}
                {response.meta.lastRebuildStatus.totalRetries}회
              </p>
            )}
            {rebuildProgressPct != null && response.meta.lastRebuildStatus?.inProgress && (
              <div className="screener-rebuild-progress">
                <div className="screener-rebuild-progress-bar">
                  <span style={{ width: `${rebuildProgressPct}%` }} />
                </div>
                <small>{rebuildProgressPct}% 진행</small>
              </div>
            )}
            {loading && (
              <p className="meta">새 결과를 가져오는 중입니다. 현재 목록은 이전 스냅샷을 유지합니다.</p>
            )}
            <div className="collapsible-head screener-advanced-head">
              <h4>운영 상세</h4>
              <button
                type="button"
                className="collapse-toggle"
                aria-expanded={showAdvancedSummary}
                onClick={() => setShowAdvancedSummary((prev) => !prev)}
              >
                {showAdvancedSummary ? "접기" : "펼치기"}
              </button>
            </div>
            {showAdvancedSummary && (
              <>
                {response.meta.rsSummary && (
                  <p className="meta">
                    RS 필터: 매칭 {response.meta.rsSummary.matched} · 약세 {response.meta.rsSummary.weak} ·
                    데이터부족 {response.meta.rsSummary.missing}
                  </p>
                )}
                {response.meta.tuningSummary && (
                  <p className="meta">
                    워크포워드 튜닝: 표본 {response.meta.tuningSummary.sampleCount} · 평균 임계값
                    {response.meta.tuningSummary.avgThresholds
                      ? ` V/H/I/VCP=${response.meta.tuningSummary.avgThresholds.volume}/${response.meta.tuningSummary.avgThresholds.hs}/${response.meta.tuningSummary.avgThresholds.ihs}/${response.meta.tuningSummary.avgThresholds.vcp}`
                      : " 없음"}
                  </p>
                )}
                <div className="screener-hit-row">
                  <small className={cupHandleDetectedCount > 0 ? "reason-tag positive" : "reason-tag neutral"}>
                    컵앤핸들 포착 {cupHandleDetectedCount}건
                  </small>
                  <small className="reason-tag neutral">컵앤핸들 미포착 {cupHandleUndetectedCount}건</small>
                  <small className={washoutDetectedCount > 0 ? "reason-tag positive" : "reason-tag neutral"}>
                    설거지+눌림목 포착 {washoutDetectedCount}건
                  </small>
                  <small className="reason-tag neutral">설거지+눌림목 미포착 {washoutUndetectedCount}건</small>
                </div>
                {response.meta.validationSummary && (
                  <>
                    <p className="meta">
                      자동 검증 컷오프: A/V/H/I/VCP=
                      {response.meta.validationSummary.activeCutoffs.all}/
                      {response.meta.validationSummary.activeCutoffs.volume}/
                      {response.meta.validationSummary.activeCutoffs.hs}/
                      {response.meta.validationSummary.activeCutoffs.ihs}/
                      {response.meta.validationSummary.activeCutoffs.vcp}
                    </p>
                    <p className="meta">
                      주간 검증 {response.meta.validationSummary.lastWeeklyAt ?? "-"} · 월간 검증{" "}
                      {response.meta.validationSummary.lastMonthlyAt ?? "-"}
                    </p>
                  </>
                )}
                {changeSummary && (
                  <div className="screener-hit-row">
                    {changeAdded.slice(0, 3).map((item) => (
                      <small key={`added-${item.code}`} className="reason-tag positive">
                        신규 {item.name} #{item.currRank ?? "-"}
                      </small>
                    ))}
                    {changeRisers.slice(0, 3).map((item) => (
                      <small key={`rise-${item.code}`} className="reason-tag positive">
                        상승 {item.name} #{item.prevRank ?? "-"}→#{item.currRank ?? "-"}
                      </small>
                    ))}
                    {changeFallers.slice(0, 2).map((item) => (
                      <small key={`fall-${item.code}`} className="reason-tag negative">
                        하락 {item.name} #{item.prevRank ?? "-"}→#{item.currRank ?? "-"}
                      </small>
                    ))}
                    {changeRemoved.slice(0, 2).map((item) => (
                      <small key={`removed-${item.code}`} className="reason-tag negative">
                        이탈 {item.name} #{item.prevRank ?? "-"}
                      </small>
                    ))}
                    {changeScoreRisers.slice(0, 2).map((item) => (
                      <small key={`score-up-${item.code}`} className="reason-tag positive">
                        점수↑ {item.name} {formatSignedScore(item.scoreDelta)}
                      </small>
                    ))}
                    {changeScoreFallers.slice(0, 2).map((item) => (
                      <small key={`score-down-${item.code}`} className="reason-tag negative">
                        점수↓ {item.name} {formatSignedScore(item.scoreDelta)}
                      </small>
                    ))}
                  </div>
                )}
                {response.warnings.length > 0 && (
                  <ul>
                    {response.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="screener-grid">
            {rankedItems.map((item) => {
              const cardOneLiner = buildCardOneLiner(item, strategy);
              const itemKey = `${item.market}-${item.code}`;
              const compactItems = buildCompactItems(item, strategy);
              const wangCompactItem = {
                label: "왕장군",
                value: `${item.wangStrategy.label} / ${item.wangStrategy.score}`,
              };
              const detailOpen = showAdvancedCards || Boolean(expandedCards[itemKey]);
              const primaryStatusLabel =
                strategy === "WASHOUT_PULLBACK"
                  ? washoutStateLabel(item.hits.washoutPullback.state)
                  : strategy === "VCP"
                    ? vcpStateLabel(item.hits.vcp.state)
                    : overallLabel(item.overallLabel);
              const primaryStatusClass =
                strategy === "WASHOUT_PULLBACK"
                  ? washoutStateBadgeClass(item.hits.washoutPullback.state)
                  : strategy === "VCP"
                    ? item.hits.vcp.state === "CONFIRMED"
                      ? "badge good"
                      : "badge neutral"
                    : overallClass(item.overallLabel);
              const primaryScore =
                strategy === "WASHOUT_PULLBACK"
                  ? item.hits.washoutPullback.score
                  : strategy === "VCP"
                    ? item.hits.vcp.score
                    : item.scoreTotal;
              const primaryConfidence =
                strategy === "WASHOUT_PULLBACK" ? item.hits.washoutPullback.confidence : item.confidence;
              return (
                <article
                  key={itemKey}
                  className={
                    strategy === "VCP"
                      ? "screener-card vcp-card"
                      : strategy === "WASHOUT_PULLBACK"
                        ? "screener-card washout-card"
                        : "screener-card"
                  }
                >
                  <div className={`screener-card-head${isMobileView ? " compact" : ""}`}>
                    <div className="screener-card-title">
                      <div className="screener-card-title-row">
                        <h3>
                          {item.name} ({item.code})
                        </h3>
                        <div className="screener-card-primary">
                          <span className={primaryStatusClass}>{primaryStatusLabel}</span>
                          <FavoriteButton
                            small
                            active={isFavorite(item.code)}
                            onClick={() => toggleFavorite({ code: item.code, name: item.name })}
                          />
                        </div>
                      </div>
                      <p className="meta screener-card-meta">
                        {item.market} · {item.lastDate} · 종가 {formatPrice(item.lastClose)}
                      </p>
                    </div>
                  </div>

                  <div className="screener-card-context">
                    <span className={wangBadgeClass(item.wangStrategy)}>
                      왕장군 {wangActionBiasLabel(item.wangStrategy.actionBias)} · {item.wangStrategy.score}
                    </span>
                    {strategy === "WASHOUT_PULLBACK" ? (
                      <>
                        <small className="reason-tag neutral">
                          Risk {formatRiskPercent(item.hits.washoutPullback.riskPct)}
                        </small>
                        <small className="reason-tag neutral">
                          {washoutPositionLabel(item.hits.washoutPullback.position)}
                        </small>
                      </>
                    ) : strategy === "VCP" ? (
                      <>
                        <small
                          className={
                            item.hits.vcp.pivot.label === "BREAKOUT_CONFIRMED" ? "reason-tag positive" : "reason-tag neutral"
                          }
                        >
                          {pivotLabel(item.hits.vcp.pivot.label)}
                        </small>
                        <small className="reason-tag neutral">
                          DryUp {dryUpStrengthLabel(item.hits.vcp.volume.dryUpStrength)}
                        </small>
                        {item.hits.vcp.score >= 92 && <small className="reason-tag positive">Strong</small>}
                      </>
                    ) : (
                      <small className="reason-tag neutral">신뢰도 {item.confidence}</small>
                    )}
                  </div>

                  <div className="screener-kpi-grid">
                    <div className="plan-item">
                      <span>판정</span>
                      <strong className={primaryStatusClass}>{primaryStatusLabel}</strong>
                    </div>
                    <div className="plan-item">
                      <span>점수</span>
                      <strong>{primaryScore}</strong>
                    </div>
                    <div className="plan-item">
                      <span>신뢰도</span>
                      <strong>{primaryConfidence}</strong>
                    </div>
                    <div className="plan-item">
                      <span>현재가</span>
                      <strong>{formatPrice(item.lastClose)}</strong>
                    </div>
                  </div>

                  <div className="screener-compact-grid">
                    {[...compactItems, wangCompactItem].map((compact) => (
                      <div key={`${itemKey}-${compact.label}`} className="plan-item screener-compact-item">
                        <span>{compact.label}</span>
                        <strong>{compact.value}</strong>
                      </div>
                    ))}
                  </div>

                  <p className="screener-opinion">
                    <small className={verdictClass(cardOneLiner.verdict)}>{cardOneLiner.verdict}</small>
                    {cardOneLiner.text}
                  </p>

                  {!showAdvancedCards && (
                    <div className="collapsible-head screener-detail-head">
                      <h4>세부 신호</h4>
                      <button type="button" className="collapse-toggle" onClick={() => toggleCardDetails(itemKey)}>
                        {detailOpen ? "세부 접기" : "세부 보기"}
                      </button>
                    </div>
                  )}

                  {detailOpen && (strategy === "WASHOUT_PULLBACK" ? (
                    <>
                      <div className="screener-levels washout-kpi-row">
                        <small>Anchor {formatMultiple(item.hits.washoutPullback.anchorTurnoverRatio)}</small>
                        <small>Reentry {formatMultiple(item.hits.washoutPullback.reentryTurnoverRatio)}</small>
                        <small>현재 상태 {washoutStateLabel(item.hits.washoutPullback.state)}</small>
                      </div>
                      <div className="screener-levels washout-kpi-row">
                        <small>
                          Pullback {formatPrice(item.hits.washoutPullback.pullbackZone.low)} ~{" "}
                          {formatPrice(item.hits.washoutPullback.pullbackZone.high)}
                        </small>
                        <small>현재가 {washoutPositionLabel(item.hits.washoutPullback.position)}</small>
                        <small>Invalid {formatPrice(item.hits.washoutPullback.invalidPrice)}</small>
                        <small>Risk {formatRiskPercent(item.hits.washoutPullback.riskPct)}</small>
                      </div>
                      <ul className="washout-reasons">
                        {(item.hits.washoutPullback.reasons.length > 0
                          ? item.hits.washoutPullback.reasons
                          : item.reasons
                        )
                          .slice(0, showAdvancedCards ? 3 : 2)
                          .map((reason) => (
                            <li key={`${item.code}-washout-reason-${reason}`}>{reason}</li>
                          ))}
                      </ul>
                      <p className="washout-warning">
                        {item.hits.washoutPullback.warnings[0] ??
                          "위 조건은 전략 후보 판단용이며 참고용 시나리오입니다."}
                      </p>
                    </>
                  ) : strategy === "VCP" ? (
                    <>
                      <div className="screener-levels vcp-kpi-row">
                        <small>
                          R-zone {formatPrice(item.hits.vcp.resistance.zoneLow)} ~{" "}
                          {formatPrice(item.hits.vcp.resistance.zoneHigh)}
                        </small>
                        <small>R까지 거리 {formatDistancePercent(item.hits.vcp.distanceToR)}</small>
                        <small>
                          컨트랙션 {item.hits.vcp.contractions.length}회 ·{" "}
                          {item.hits.vcp.contractions.length > 0
                            ? item.hits.vcp.contractions
                                .map((contraction) => formatDepth(contraction.depth))
                                .join(" → ")
                            : "-"}
                        </small>
                      </div>
                      <div className="screener-levels vcp-kpi-row">
                        <small>
                          DryUp {dryUpStrengthLabel(item.hits.vcp.volume.dryUpStrength)} (
                          {item.hits.vcp.volume.volRatioAvg10 != null
                            ? `${item.hits.vcp.volume.volRatioAvg10.toFixed(2)}배`
                            : "-"}
                          )
                        </small>
                        <small>
                          Leadership {leadershipLabel(item.hits.vcp.leadership.label)} (
                          {formatSignedPercent(
                            item.hits.vcp.leadership.ret63 != null
                              ? item.hits.vcp.leadership.ret63 * 100
                              : null,
                          )}
                          )
                        </small>
                        <small>
                          Risk {riskGradeLabel(item.hits.vcp.risk.riskGrade)} (
                          {formatRatioPercent(item.hits.vcp.risk.riskPct)} / 무효화{" "}
                          {formatPrice(item.hits.vcp.risk.invalidLow)})
                        </small>
                      </div>
                      {showAdvancedCards && (
                        <>
                          <div className="screener-levels vcp-kpi-row">
                            <small>
                              RS {rsStrengthLabel(item.rs.label)} ({formatSignedRatioPercent(item.rs.ret63Diff)})
                            </small>
                            <small className={cupHandleTagClass(item.hits.cupHandle.state)}>
                              C&H {cupHandleStateLabel(item.hits.cupHandle.state)} / {item.hits.cupHandle.score}
                            </small>
                            <small>
                              튜닝 품질 {item.tuning?.quality != null ? `${item.tuning.quality}점` : "-"}
                            </small>
                            <small>
                              VCP 컷 {item.tuning?.thresholds.vcp ?? "-"}점
                            </small>
                          </div>
                          <div className="vcp-strip">
                            <small
                              className={item.hits.vcp.pivot.nearHigh52 ? "reason-tag positive" : "reason-tag neutral"}
                              title="close >= 0.90 * high52w"
                            >
                              52W 근접 {item.hits.vcp.pivot.nearHigh52 ? "Y" : "N"}
                            </small>
                            <small
                              className={item.hits.vcp.pivot.pivotReady ? "reason-tag positive" : "reason-tag neutral"}
                              title="distance<=3% && dryUp STRONG && depth_last<=8%"
                            >
                              Pivot Ready {item.hits.vcp.pivot.pivotReady ? "Y" : "N"}
                            </small>
                            <small className="reason-tag neutral" title={item.hits.vcp.breakout.rule}>
                              돌파 조건 {item.hits.vcp.breakout.confirmed ? "충족" : "대기"}
                            </small>
                            <small className="reason-tag neutral">
                              ATR 축소 {atrShrinkPercent(item.hits.vcp.atr.atrPct20, item.hits.vcp.atr.atrPct120)}
                            </small>
                          </div>
                        </>
                      )}
                      <ul className="vcp-reasons">
                        {item.hits.vcp.reasons.slice(0, showAdvancedCards ? 3 : 2).map((reason) => (
                          <li key={`${item.code}-vcp-${reason}`}>✅ {reason}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      {strategy === "DARVAS" && (
                        <div className="screener-hit-row">
                          <small className={simpleStrategyStateClass(item.hits.darvasRetest?.state)}>
                            다르바스 {simpleStrategyStateLabel(item.hits.darvasRetest?.state)}
                          </small>
                          <small className="reason-tag neutral">
                            박스 {formatPrice(item.hits.darvasRetest?.boxLow ?? null)} ~{" "}
                            {formatPrice(item.hits.darvasRetest?.boxHigh ?? null)}
                          </small>
                          <small className="reason-tag neutral">
                            리테스트 {item.hits.darvasRetest?.retestDate ?? "-"}
                          </small>
                        </div>
                      )}
                      {strategy === "NR7" && (
                        <div className="screener-hit-row">
                          <small className={simpleStrategyStateClass(item.hits.nr7InsideBar?.state)}>
                            NR7 {simpleStrategyStateLabel(item.hits.nr7InsideBar?.state)}
                          </small>
                          <small className="reason-tag neutral">
                            트리거 {formatPrice(item.hits.nr7InsideBar?.triggerLow ?? null)} ~{" "}
                            {formatPrice(item.hits.nr7InsideBar?.triggerHigh ?? null)}
                          </small>
                          <small className="reason-tag neutral">
                            방향 {item.hits.nr7InsideBar?.breakoutDirection ?? "NONE"}
                          </small>
                        </div>
                      )}
                      {strategy === "TREND_TEMPLATE" && (
                        <div className="screener-hit-row">
                          <small className={simpleStrategyStateClass(item.hits.trendTemplate?.state)}>
                            템플릿 {simpleStrategyStateLabel(item.hits.trendTemplate?.state)}
                          </small>
                          <small className="reason-tag neutral">
                            52주 고점 근접 {formatPercent(item.hits.trendTemplate?.nearHigh52wPct ?? null)}
                          </small>
                        </div>
                      )}
                      {strategy === "RSI_DIVERGENCE" && (
                        <div className="screener-hit-row">
                          <small className={simpleStrategyStateClass(item.hits.rsiDivergence?.state)}>
                            RSI 다이버전스 {simpleStrategyStateLabel(item.hits.rsiDivergence?.state)}
                          </small>
                          <small className="reason-tag neutral">
                            넥라인 {formatPrice(item.hits.rsiDivergence?.neckline ?? null)}
                          </small>
                          <small className="reason-tag neutral">
                            돌파일 {item.hits.rsiDivergence?.breakoutDate ?? "-"}
                          </small>
                        </div>
                      )}
                      {strategy === "FLOW_PERSISTENCE" && (
                        <div className="screener-hit-row">
                          <small className={simpleStrategyStateClass(item.hits.flowPersistence?.state)}>
                            수급 지속성 {simpleStrategyStateLabel(item.hits.flowPersistence?.state)}
                          </small>
                          <small className="reason-tag neutral">
                            상승거래량 {formatPercent(item.hits.flowPersistence?.upVolumeRatio20 ?? null)}
                          </small>
                          <small className="reason-tag neutral">
                            OBV 기울기 {formatPercent(item.hits.flowPersistence?.obvSlope20 ?? null)}
                          </small>
                        </div>
                      )}
                      <div className="screener-hit-row">
                        <span className="reason-tag positive">
                          거래량 {formatScore(item.hits.volume.score)} / {item.hits.volume.confidence}
                        </span>
                        <span
                          className={
                            item.rs.label === "STRONG"
                              ? "reason-tag positive"
                              : item.rs.label === "WEAK"
                                ? "reason-tag negative"
                                : "reason-tag neutral"
                          }
                        >
                          RS {rsStrengthLabel(item.rs.label)} ({formatSignedRatioPercent(item.rs.ret63Diff)})
                        </span>
                        <span className={item.hits.vcp.detected ? "reason-tag positive" : "reason-tag neutral"}>
                          VCP {vcpStateLabel(item.hits.vcp.state)} / {item.hits.vcp.score}
                        </span>
                        <span className={cupHandleTagClass(item.hits.cupHandle.state)}>
                          C&H {cupHandleStateLabel(item.hits.cupHandle.state)} / {item.hits.cupHandle.score}
                        </span>
                        <span className="reason-tag negative">
                          H&S {hsStateLabel(item.hits.hs.state)} / {item.hits.hs.score}
                        </span>
                        <span className="reason-tag positive">
                          IHS {hsStateLabel(item.hits.ihs.state)} / {item.hits.ihs.score}
                        </span>
                      </div>
                      {showAdvancedCards && (
                        <>
                          <div className="screener-hit-row">
                            <small className="reason-tag neutral">
                              튜닝 임계값 V/H/I/VCP{" "}
                              {item.tuning
                                ? `${item.tuning.thresholds.volume}/${item.tuning.thresholds.hs}/${item.tuning.thresholds.ihs}/${item.tuning.thresholds.vcp}`
                                : "-"}
                            </small>
                            <small className="reason-tag neutral">
                              튜닝 품질 {item.tuning?.quality != null ? `${item.tuning.quality}점` : "-"}
                            </small>
                          </div>
                          <div className="screener-hit-row">
                            {item.hits.volume.patterns.length > 0 ? (
                              item.hits.volume.patterns.slice(0, 3).map((type) => (
                                <small key={type} className="reason-tag positive">
                                  {patternTypeLabel(type)}
                                </small>
                              ))
                            ) : (
                              <small className="volume-empty">거래량 패턴 없음</small>
                            )}
                          </div>
                        </>
                      )}
                      <div className="screener-hit-row">
                        <small className={wangBadgeClass(item.wangStrategy)}>
                          왕장군 {item.wangStrategy.label}
                        </small>
                        <small className="reason-tag neutral">
                          {wangPhaseLabel(item.wangStrategy.currentPhase)}
                        </small>
                        <small className="reason-tag neutral">
                          {wangActionBiasLabel(item.wangStrategy.actionBias)} / {item.wangStrategy.confidence}
                        </small>
                      </div>
                      <ul>
                        {item.reasons.slice(0, showAdvancedCards ? 3 : 2).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {showAdvancedCards && (
                        <div className="screener-levels">
                          <small>지지 {formatPrice(item.levels.support)}</small>
                          <small>저항 {formatPrice(item.levels.resistance)}</small>
                          <small>넥라인 {formatPrice(item.levels.neckline)}</small>
                        </div>
                      )}
                    </>
                  ))}
                  {detailOpen && item.backtestSummary && (
                    <div className="screener-backtest">
                      <small>거래 {item.backtestSummary.trades}</small>
                      <small>승률 {formatPercent(item.backtestSummary.winRate)}</small>
                      <small>평균손익 {formatPercent(item.backtestSummary.avgReturn)}</small>
                      <small>PF {formatFactor(item.backtestSummary.PF)}</small>
                      <small>MDD {formatPercent(item.backtestSummary.MDD)}</small>
                    </div>
                  )}
                  <div className="screener-card-actions">
                    <button type="button" onClick={() => onSelectSymbol(item.code)}>
                      {isMobileView ? "상세 분석" : "상세 분석으로 이동"}
                    </button>
                    <button type="button" onClick={() => onSelectWangStrategy(item.code)}>
                      {isMobileView ? "왕장군" : "왕장군 전략 보기"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {rankedItems.length === 0 && (
            <div className="card screener-empty-card">
              <h3>조건에 맞는 후보가 없습니다</h3>
              <p className="meta">
                현재 필터({activeFilterChips.join(" · ")})에서는 후보가 비어 있습니다. 조건을 완화해 다시 조회해 주세요.
              </p>
              <div className="screener-empty-actions">
                <button type="button" onClick={resetFiltersAndFetch} disabled={loading}>
                  필터 초기화 후 재조회
                </button>
                <button type="button" onClick={rerunAsAllStrategy} disabled={loading}>
                  전략 ALL로 재조회
                </button>
                <button type="button" onClick={() => void fetchScreener()} disabled={loading}>
                  다시 조회
                </button>
              </div>
              {response.warnings.length > 0 && (
                <ul>
                  {response.warnings.slice(0, 3).map((warning) => (
                    <li key={`empty-${warning}`}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {showAdvancedCards && warningItems.length > 0 && (
            <div className="card">
              <h3>리스크 경고 (H&S 확정)</h3>
              <div className="screener-warning-list">
                {warningItems.map((item) => (
                  <div key={`warn-${item.code}`} className="warning-row">
                    <strong>
                      {item.name} ({item.code})
                    </strong>
                    <span>H&S {item.hits.hs.score}점</span>
                    <span>넥라인 {formatPrice(item.hits.hs.neckline)}</span>
                    <span>목표 {formatPrice(item.hits.hs.target)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
