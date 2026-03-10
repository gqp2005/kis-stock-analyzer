import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  DashboardOverviewResponse,
  Overall,
  PatternState,
  StrategySignalState,
  WashoutZonePosition,
  ScreenerWashoutPositionFilter,
  ScreenerWashoutStateFilter,
  VcpLeadershipLabel,
  VcpPivotLabel,
  VcpRiskGrade,
  ScreenerItem,
  ScreenerMarketFilter,
  ScreenerResponse,
  ScreenerStrategyFilter,
  VolumePatternType,
} from "./types";
import FavoriteButton from "./FavoriteButton";
import {
  readFavoriteNotificationState,
  useFavorites,
  writeFavoriteNotificationState,
} from "./favorites";

interface ScreenerPanelProps {
  apiBase: string;
  onSelectSymbol: (code: string) => void;
}

const FAVORITE_NOTIFY_KEY = "kis-favorite-notify-enabled";

type SortKey = "SCORE" | "CONFIDENCE" | "BACKTEST";
type ScreenerVerdict = "매수 검토" | "관망" | "비중 축소";

interface ScreenerQueryState {
  market: ScreenerMarketFilter;
  strategy: ScreenerStrategyFilter;
  washoutState: ScreenerWashoutStateFilter;
  washoutPosition: ScreenerWashoutPositionFilter;
  washoutRiskMax: string;
  count: number;
  universe: number;
}

interface ScreenerCompactItem {
  label: string;
  value: string;
}

const overallLabel = (overall: Overall): string => {
  if (overall === "GOOD") return "양호";
  if (overall === "NEUTRAL") return "중립";
  return "주의";
};

const overallClass = (overall: Overall): string => {
  if (overall === "GOOD") return "badge good";
  if (overall === "NEUTRAL") return "badge neutral";
  return "badge caution";
};

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatScore = (value: number): string => `${Math.round(value)}점`;
const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;

const formatFactor = (value: number | null): string =>
  value == null ? "-" : value.toFixed(2);
const formatSignedScore = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${Math.round(value)}점`;

const formatMultiple = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}x`;

const patternTypeLabel = (type: VolumePatternType): string => {
  if (type === "BreakoutConfirmed") return "돌파확인";
  if (type === "Upthrust") return "불트랩";
  if (type === "PullbackReaccumulation") return "눌림재개";
  if (type === "ClimaxUp") return "상승과열";
  if (type === "CapitulationAbsorption") return "투매흡수";
  return "약한반등";
};

const hsStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

const vcpStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

const cupHandleStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "없음";
};

const formatDepth = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(1)}%`;

const formatSignedPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatSignedRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

const formatDistancePercent = (value: number | null): string =>
  value == null ? "-" : `${(Math.abs(value) * 100).toFixed(2)}%`;

const formatRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(2)}%`;

const formatNullable = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(1)}`;

const dryUpStrengthLabel = (value: "NONE" | "WEAK" | "STRONG"): string => {
  if (value === "STRONG") return "강함";
  if (value === "WEAK") return "보통";
  return "약함";
};

const leadershipLabel = (value: VcpLeadershipLabel): string => {
  if (value === "STRONG") return "STRONG";
  if (value === "OK") return "OK";
  return "WEAK";
};

const pivotLabel = (value: VcpPivotLabel): string => {
  if (value === "PIVOT_READY") return "PIVOT_READY";
  if (value === "PIVOT_NEAR_52W") return "PIVOT_NEAR_52W";
  if (value === "PIVOT_52W_BREAK") return "PIVOT_52W_BREAK";
  if (value === "BREAKOUT_CONFIRMED") return "CONFIRMED";
  return "NONE";
};

const riskGradeLabel = (value: VcpRiskGrade): string => {
  if (value === "OK") return "OK";
  if (value === "HIGH") return "HIGH";
  if (value === "BAD") return "BAD";
  return "N/A";
};

const rsStrengthLabel = (value: "STRONG" | "NEUTRAL" | "WEAK" | "N/A"): string => {
  if (value === "STRONG") return "강함";
  if (value === "NEUTRAL") return "보통";
  if (value === "WEAK") return "약함";
  return "N/A";
};

const atrShrinkPercent = (atr20: number | null, atr120: number | null): string => {
  if (atr20 == null || atr120 == null || atr120 <= 0) return "-";
  return `${((1 - atr20 / atr120) * 100).toFixed(1)}%`;
};

const cupHandleTagClass = (state: PatternState): string => {
  if (state === "CONFIRMED") return "reason-tag positive";
  if (state === "POTENTIAL") return "reason-tag neutral";
  return "reason-tag neutral";
};

const washoutStatePriority = (state: ScreenerWashoutStateFilter | "NONE"): number => {
  if (state === "REBOUND_CONFIRMED") return 4;
  if (state === "PULLBACK_READY") return 3;
  if (state === "WASHOUT_CANDIDATE") return 2;
  if (state === "ANCHOR_DETECTED") return 1;
  return 0;
};

const washoutStateLabel = (state: ScreenerWashoutStateFilter | "NONE"): string => {
  if (state === "REBOUND_CONFIRMED") return "반등 재개";
  if (state === "PULLBACK_READY") return "눌림 관찰";
  if (state === "WASHOUT_CANDIDATE") return "반등 후보";
  if (state === "ANCHOR_DETECTED") return "대금 흔적";
  return "미감지";
};

const washoutStateBadgeClass = (state: ScreenerWashoutStateFilter | "NONE"): string => {
  if (state === "REBOUND_CONFIRMED") return "badge good";
  if (state === "PULLBACK_READY") return "badge neutral";
  if (state === "WASHOUT_CANDIDATE") return "badge neutral";
  if (state === "ANCHOR_DETECTED") return "badge caution";
  return "badge neutral";
};

const simpleStrategyStateLabel = (state: StrategySignalState | undefined): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "미감지";
};

const simpleStrategyStateClass = (state: StrategySignalState | undefined): string => {
  if (state === "CONFIRMED") return "reason-tag positive";
  if (state === "POTENTIAL") return "reason-tag neutral";
  return "reason-tag neutral";
};

const washoutPositionLabel = (position: WashoutZonePosition): string => {
  if (position === "IN_ZONE") return "존 내부";
  if (position === "ABOVE_ZONE") return "존 위";
  if (position === "BELOW_ZONE") return "존 아래";
  return "N/A";
};

const formatRiskPercent = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(1)}%`;

const strategyLabel = (value: ScreenerStrategyFilter): string => {
  if (value === "ALL") return "전체";
  if (value === "VOLUME") return "거래량";
  if (value === "VCP") return "VCP";
  if (value === "WASHOUT_PULLBACK") return "설거지+눌림목";
  if (value === "DARVAS") return "다르바스";
  if (value === "NR7") return "NR7";
  if (value === "TREND_TEMPLATE") return "추세 템플릿";
  if (value === "RSI_DIVERGENCE") return "RSI 다이버전스";
  if (value === "FLOW_PERSISTENCE") return "수급 지속성";
  if (value === "IHS") return "IHS";
  return "H&S";
};

const marketLabel = (value: ScreenerMarketFilter): string => {
  if (value === "ALL") return "전체";
  if (value === "KOSPI") return "KOSPI";
  return "KOSDAQ";
};

const sortLabel = (value: SortKey): string => {
  if (value === "SCORE") return "점수순";
  if (value === "CONFIDENCE") return "신뢰도순";
  return "백테스트순";
};

const verdictClass = (value: ScreenerVerdict): string => {
  if (value === "매수 검토") return "signal-tag positive";
  if (value === "비중 축소") return "signal-tag negative";
  return "signal-tag neutral";
};

const buildCardOneLiner = (item: ScreenerItem, strategy: ScreenerStrategyFilter): { verdict: ScreenerVerdict; text: string } => {
  if (strategy === "WASHOUT_PULLBACK") {
    const hit = item.hits.washoutPullback;
    if (hit.state === "REBOUND_CONFIRMED" && (hit.riskPct ?? 1) <= 0.1) {
      return {
        verdict: "매수 검토",
        text: "반등 확인 단계이며 리스크가 관리 가능한 수준이라 분할 접근 후보로 볼 수 있습니다.",
      };
    }
    if (hit.state === "PULLBACK_READY") {
      return {
        verdict: "관망",
        text: "눌림 준비 구간으로 존 방어와 거래대금 재유입을 추가 확인한 뒤 대응이 유리합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "설거지 구조 확증이 약하거나 리스크가 커서 보수적 대응이 필요합니다.",
    };
  }

  if (strategy === "VCP") {
    if (item.hits.vcp.state === "CONFIRMED" && item.hits.vcp.score >= 88) {
      return {
        verdict: "매수 검토",
        text: "VCP 확정 신호와 점수 우위가 확인되어 손절 기준 하 조건부 접근을 검토할 수 있습니다.",
      };
    }
    if (item.hits.vcp.detected) {
      return {
        verdict: "관망",
        text: "VCP 후보 단계로 저항 돌파와 거래량 확증 전까지 대기 전략이 안전합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "VCP 근거가 약해 추격 진입보다 신호 누적을 기다리는 편이 좋습니다.",
    };
  }

  if (strategy === "DARVAS") {
    const hit = item.hits.darvasRetest;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "다르바스 돌파-리테스트 확정 상태로 지지 유지 시나리오를 우선 볼 수 있습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "다르바스 후보 구간으로 리테스트 지지 확인 전까지는 대기가 유리합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "다르바스 조건이 약해 추격 진입보다 관찰 우선이 적절합니다.",
    };
  }

  if (strategy === "NR7") {
    const hit = item.hits.nr7InsideBar;
    if (hit?.state === "CONFIRMED" && hit.breakoutDirection === "UP") {
      return {
        verdict: "매수 검토",
        text: "NR7 수축 후 상방 돌파가 확인되어 단기 모멘텀 우위가 나타났습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "NR7 세팅은 형성됐지만 방향성 돌파 확증이 필요합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "NR7 신호가 약하거나 하방 이탈 이력이 있어 보수적 대응이 필요합니다.",
    };
  }

  if (strategy === "TREND_TEMPLATE") {
    const hit = item.hits.trendTemplate;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "장기 정배열 템플릿이 충족되어 추세 추종 후보로 해석할 수 있습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "추세 템플릿 일부 충족 상태라 추가 정렬 확인이 필요합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "추세 템플릿 근거가 약해 단기 신호보다 장기 정렬 확인이 우선입니다.",
    };
  }

  if (strategy === "RSI_DIVERGENCE") {
    const hit = item.hits.rsiDivergence;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "RSI 다이버전스 확정으로 반등 시나리오 우위가 강화됐습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "다이버전스 후보 단계라 넥라인 돌파 확증을 먼저 확인해야 합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "다이버전스 근거가 약해 반등 매매의 우선순위가 낮습니다.",
    };
  }

  if (strategy === "FLOW_PERSISTENCE") {
    const hit = item.hits.flowPersistence;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "수급 지속성 확정 신호로 추세 유지 관점의 조건부 접근이 가능합니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "수급 지속성 후보 단계로 거래량/가격 동시 확증을 더 기다려야 합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "수급 지속성 신호가 약해 관망 또는 비중 축소 대응이 유리합니다.",
    };
  }

  if (item.overallLabel === "GOOD" && item.confidence >= 65 && item.hits.hs.state !== "CONFIRMED") {
    return {
      verdict: "매수 검토",
      text: "점수/신뢰도 조합이 양호해 지지 확인 시 분할 진입을 검토할 수 있습니다.",
    };
  }
  if (item.overallLabel === "CAUTION" || item.hits.hs.state === "CONFIRMED") {
    return {
      verdict: "비중 축소",
      text: "주의 또는 하락 패턴 신호가 있어 신규 진입보다 방어적 대응이 우선입니다.",
    };
  }
  return {
    verdict: "관망",
    text: "신호가 혼조 구간이라 명확한 돌파/지지 확증이 나오기 전까지 대기가 유리합니다.",
  };
};

const buildCompactItems = (item: ScreenerItem, strategy: ScreenerStrategyFilter): ScreenerCompactItem[] => {
  if (strategy === "WASHOUT_PULLBACK") {
    return [
      { label: "Anchor", value: formatMultiple(item.hits.washoutPullback.anchorTurnoverRatio) },
      { label: "재유입", value: formatMultiple(item.hits.washoutPullback.reentryTurnoverRatio) },
      {
        label: "눌림 존",
        value: `${formatPrice(item.hits.washoutPullback.pullbackZone.low)} ~ ${formatPrice(item.hits.washoutPullback.pullbackZone.high)}`,
      },
      {
        label: "현재 위치",
        value: `${washoutPositionLabel(item.hits.washoutPullback.position)} / ${formatRiskPercent(item.hits.washoutPullback.riskPct)}`,
      },
    ];
  }

  if (strategy === "VCP") {
    return [
      {
        label: "R-zone",
        value: `${formatPrice(item.hits.vcp.resistance.zoneLow)} ~ ${formatPrice(item.hits.vcp.resistance.zoneHigh)}`,
      },
      {
        label: "컨트랙션",
        value:
          item.hits.vcp.contractions.length > 0
            ? `${item.hits.vcp.contractions.length}회 / ${item.hits.vcp.contractions
                .map((contraction) => formatDepth(contraction.depth))
                .join(" → ")}`
            : "없음",
      },
      {
        label: "거래량 수축",
        value: `${dryUpStrengthLabel(item.hits.vcp.volume.dryUpStrength)} / ${
          item.hits.vcp.volume.volRatioAvg10 != null ? `${item.hits.vcp.volume.volRatioAvg10.toFixed(2)}배` : "-"
        }`,
      },
      {
        label: "리더십",
        value: `${leadershipLabel(item.hits.vcp.leadership.label)} / ${formatSignedPercent(
          item.hits.vcp.leadership.ret63 != null ? item.hits.vcp.leadership.ret63 * 100 : null,
        )}`,
      },
    ];
  }

  return [
    { label: "RS", value: `${rsStrengthLabel(item.rs.label)} / ${formatSignedRatioPercent(item.rs.ret63Diff)}` },
    { label: "거래량", value: `${formatScore(item.hits.volume.score)} / ${item.hits.volume.confidence}` },
    {
      label: "컵앤핸들",
      value: `${cupHandleStateLabel(item.hits.cupHandle.state)} / ${item.hits.cupHandle.score}`,
    },
    {
      label: "설거지+눌림",
      value: `${washoutStateLabel(item.hits.washoutPullback.state)} / ${item.hits.washoutPullback.score}`,
    },
  ];
};

const sortItems = (
  items: ScreenerItem[],
  sortKey: SortKey,
  strategy: ScreenerStrategyFilter,
): ScreenerItem[] => {
  const cloned = [...items];
  if (strategy === "WASHOUT_PULLBACK") {
    return cloned.sort((a, b) => {
      const stateDiff =
        washoutStatePriority(b.hits.washoutPullback.state) -
        washoutStatePriority(a.hits.washoutPullback.state);
      if (stateDiff !== 0) return stateDiff;
      if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const ar = a.hits.washoutPullback.riskPct ?? Number.POSITIVE_INFINITY;
      const br = b.hits.washoutPullback.riskPct ?? Number.POSITIVE_INFINITY;
      return ar - br;
    });
  }
  if (sortKey === "CONFIDENCE") {
    return cloned.sort((a, b) => b.confidence - a.confidence || b.scoreTotal - a.scoreTotal);
  }
  if (sortKey === "BACKTEST") {
    return cloned.sort((a, b) => {
      const ar = a.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      const br = b.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      if (br !== ar) return br - ar;
      return b.scoreTotal - a.scoreTotal;
    });
  }
  return cloned.sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);
};

export default function ScreenerPanel(props: ScreenerPanelProps) {
  const { apiBase, onSelectSymbol } = props;
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
      setDashboard(data as DashboardOverviewResponse);
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
      const url = `${apiBase}/api/screener?${query.toString()}`;
      const result = await fetch(url);
      const data = (await result.json()) as ScreenerResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "스크리너 조회 실패");
      setResponse(data as ScreenerResponse);
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
      count: 30,
      universe: 500,
    };
    setMarket(defaults.market);
    setStrategy(defaults.strategy);
    setWashoutState(defaults.washoutState);
    setWashoutPosition(defaults.washoutPosition);
    setWashoutRiskMax(defaults.washoutRiskMax);
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
    void fetchScreener({
      strategy: "ALL",
      washoutState: "ALL",
      washoutPosition: "ALL",
      washoutRiskMax: "ALL",
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
      "유니버스 500개",
    ];
    if (strategy === "WASHOUT_PULLBACK") {
      chips.push(`상태 ${washoutState === "ALL" ? "전체" : washoutStateLabel(washoutState)}`);
      chips.push(`현재가 ${washoutPosition === "ALL" ? "전체" : washoutPositionLabel(washoutPosition)}`);
      chips.push(`리스크 ${washoutRiskMax === "ALL" ? "제한 없음" : `${Math.round(Number(washoutRiskMax) * 100)}% 이하`}`);
    }
    return chips;
  }, [market, strategy, sortKey, count, washoutState, washoutPosition, washoutRiskMax]);

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
    return parts.join(" · ");
  }, [count, showAdvancedCards, sortKey, strategy, washoutPosition, washoutRiskMax, washoutState]);
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
          RS 강세 {dashboard.marketTemperature.rsStrongCount} · 컵앤핸들 {dashboard.marketTemperature.cupHandleCount} · 설거지{" "}
          {dashboard.marketTemperature.washoutCount}
        </p>
        <p>{dashboard.marketTemperature.summary}</p>
      </article>

      <article className="strategy-mini-item">
        <div className="strategy-mini-head">
          <strong>전략별 성과 랭킹</strong>
          <small className="signal-tag neutral">상위 5개</small>
        </div>
        <ul className="insight-list">
          {dashboard.strategyRanking.slice(0, 5).map((item) => (
            <li key={`rank-${item.key}`}>
              <span>
                {item.label} · 후보 {item.candidateCount}개 · 품질 {item.qualityScore ?? "-"}
              </span>
              <small className="signal-tag neutral">
                승률 {formatNullable(item.avgWinRate)} / PF {formatNullable(item.avgPf)}
              </small>
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
                        {item.name}({item.code}) · {item.strategyLabel}
                      </span>
                      <small className="signal-tag neutral">{item.stateLabel}</small>
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
              <label>
                정렬
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  disabled={strategy === "WASHOUT_PULLBACK"}
                >
                  <option value="SCORE">점수순</option>
                  <option value="CONFIDENCE">신뢰도순</option>
                  <option value="BACKTEST">백테스트순</option>
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
            <label>
              정렬
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                disabled={strategy === "WASHOUT_PULLBACK"}
              >
                <option value="SCORE">점수순</option>
                <option value="CONFIDENCE">신뢰도순</option>
                <option value="BACKTEST">백테스트순</option>
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
                      <h3>
                        {item.name} ({item.code})
                      </h3>
                      <p className="meta">
                        {item.market} · {item.lastDate} · 종가 {formatPrice(item.lastClose)}
                      </p>
                    </div>
                    <div className="final-badges">
                      <FavoriteButton
                        small
                        active={isFavorite(item.code)}
                        onClick={() => toggleFavorite({ code: item.code, name: item.name })}
                      />
                      {isMobileView ? (
                        <span className={primaryStatusClass}>{primaryStatusLabel}</span>
                      ) : strategy === "WASHOUT_PULLBACK" ? (
                        <>
                          <span className={washoutStateBadgeClass(item.hits.washoutPullback.state)}>
                            {washoutStateLabel(item.hits.washoutPullback.state)}
                          </span>
                          <span className="confidence neutral">
                            점수 {item.hits.washoutPullback.score}
                          </span>
                          <span className="confidence good">
                            신뢰도 {item.hits.washoutPullback.confidence}
                          </span>
                        </>
                      ) : strategy === "VCP" ? (
                        <>
                          <span className="confidence neutral">VCPScore {item.hits.vcp.score}</span>
                          <span className={item.hits.vcp.pivot.label === "BREAKOUT_CONFIRMED" ? "badge good" : "badge neutral"}>
                            {pivotLabel(item.hits.vcp.pivot.label)}
                          </span>
                          <span className={item.hits.vcp.state === "CONFIRMED" ? "badge good" : "badge neutral"}>
                            {vcpStateLabel(item.hits.vcp.state)}
                          </span>
                          {item.hits.vcp.score >= 92 && <span className="reason-tag positive">Strong</span>}
                        </>
                      ) : (
                        <>
                          <span className={overallClass(item.overallLabel)}>{overallLabel(item.overallLabel)}</span>
                          <span className="confidence neutral">점수 {item.scoreTotal}</span>
                          <span className="confidence good">신뢰도 {item.confidence}</span>
                        </>
                      )}
                    </div>
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
                    {compactItems.map((compact) => (
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
                  <button type="button" onClick={() => onSelectSymbol(item.code)}>
                    {isMobileView ? "상세 분석" : "상세 분석으로 이동"}
                  </button>
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
