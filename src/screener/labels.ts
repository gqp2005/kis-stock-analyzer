import type {
  PatternState,
  ScreenerBooleanFilter,
  ScreenerMarketFilter,
  ScreenerStrategyFilter,
  ScreenerWashoutStateFilter,
  StrategySignalState,
  VcpLeadershipLabel,
  VcpPivotLabel,
  VcpRiskGrade,
  VolumePatternType,
  WashoutZonePosition,
  WangStrategyActionBias,
  WangStrategyPhase,
  WangStrategyScreeningSummary,
} from "../types";

export type SortKey = "SCORE" | "CONFIDENCE" | "BACKTEST" | "WANG_SCORE" | "WANG_CONFIDENCE";
export type ScreenerVerdict = "매수 검토" | "관망" | "비중 축소";

export const FAVORITE_NOTIFY_KEY = "kis-favorite-notify-enabled";

export const formatScore = (value: number): string => `${Math.round(value)}점`;

export const formatSignedScore = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${Math.round(value)}점`;

export const formatMultiple = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}x`;

export const patternTypeLabel = (type: VolumePatternType): string => {
  if (type === "BreakoutConfirmed") return "돌파확인";
  if (type === "Upthrust") return "불트랩";
  if (type === "PullbackReaccumulation") return "눌림재개";
  if (type === "ClimaxUp") return "상승과열";
  if (type === "CapitulationAbsorption") return "투매흡수";
  return "약한반등";
};

export const hsStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

export const vcpStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

export const cupHandleStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "없음";
};

export const formatDepth = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(1)}%`;

export const formatSignedPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export const formatSignedRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

export const formatDistancePercent = (value: number | null): string =>
  value == null ? "-" : `${(Math.abs(value) * 100).toFixed(2)}%`;

export const formatRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(2)}%`;

export const formatNullable = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(1)}`;

export const dryUpStrengthLabel = (value: "NONE" | "WEAK" | "STRONG"): string => {
  if (value === "STRONG") return "강함";
  if (value === "WEAK") return "보통";
  return "약함";
};

export const leadershipLabel = (value: VcpLeadershipLabel): string => {
  if (value === "STRONG") return "STRONG";
  if (value === "OK") return "OK";
  return "WEAK";
};

export const pivotLabel = (value: VcpPivotLabel): string => {
  if (value === "PIVOT_READY") return "PIVOT_READY";
  if (value === "PIVOT_NEAR_52W") return "PIVOT_NEAR_52W";
  if (value === "PIVOT_52W_BREAK") return "PIVOT_52W_BREAK";
  if (value === "BREAKOUT_CONFIRMED") return "CONFIRMED";
  return "NONE";
};

export const riskGradeLabel = (value: VcpRiskGrade): string => {
  if (value === "OK") return "OK";
  if (value === "HIGH") return "HIGH";
  if (value === "BAD") return "BAD";
  return "N/A";
};

export const rsStrengthLabel = (value: "STRONG" | "NEUTRAL" | "WEAK" | "N/A"): string => {
  if (value === "STRONG") return "강함";
  if (value === "NEUTRAL") return "보통";
  if (value === "WEAK") return "약함";
  return "N/A";
};

export const atrShrinkPercent = (atr20: number | null, atr120: number | null): string => {
  if (atr20 == null || atr120 == null || atr120 <= 0) return "-";
  return `${((1 - atr20 / atr120) * 100).toFixed(1)}%`;
};

export const cupHandleTagClass = (state: PatternState): string => {
  if (state === "CONFIRMED") return "reason-tag positive";
  if (state === "POTENTIAL") return "reason-tag neutral";
  return "reason-tag neutral";
};

export const washoutStatePriority = (state: ScreenerWashoutStateFilter | "NONE"): number => {
  if (state === "REBOUND_CONFIRMED") return 4;
  if (state === "PULLBACK_READY") return 3;
  if (state === "WASHOUT_CANDIDATE") return 2;
  if (state === "ANCHOR_DETECTED") return 1;
  return 0;
};

export const washoutStateLabel = (state: ScreenerWashoutStateFilter | "NONE"): string => {
  if (state === "REBOUND_CONFIRMED") return "반등 재개";
  if (state === "PULLBACK_READY") return "눌림 관찰";
  if (state === "WASHOUT_CANDIDATE") return "반등 후보";
  if (state === "ANCHOR_DETECTED") return "대금 흔적";
  return "미감지";
};

export const washoutStateBadgeClass = (state: ScreenerWashoutStateFilter | "NONE"): string => {
  if (state === "REBOUND_CONFIRMED") return "badge good";
  if (state === "PULLBACK_READY") return "badge neutral";
  if (state === "WASHOUT_CANDIDATE") return "badge neutral";
  if (state === "ANCHOR_DETECTED") return "badge caution";
  return "badge neutral";
};

export const simpleStrategyStateLabel = (state: StrategySignalState | undefined): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "미감지";
};

export const simpleStrategyStateClass = (state: StrategySignalState | undefined): string => {
  if (state === "CONFIRMED") return "reason-tag positive";
  if (state === "POTENTIAL") return "reason-tag neutral";
  return "reason-tag neutral";
};

export const washoutPositionLabel = (position: WashoutZonePosition): string => {
  if (position === "IN_ZONE") return "존 내부";
  if (position === "ABOVE_ZONE") return "존 위";
  if (position === "BELOW_ZONE") return "존 아래";
  return "N/A";
};

export const formatRiskPercent = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(1)}%`;

export const strategyLabel = (value: ScreenerStrategyFilter): string => {
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

export const marketLabel = (value: ScreenerMarketFilter): string => {
  if (value === "ALL") return "전체";
  if (value === "KOSPI") return "KOSPI";
  return "KOSDAQ";
};

export const sortLabel = (value: SortKey): string => {
  if (value === "SCORE") return "점수순";
  if (value === "CONFIDENCE") return "신뢰도순";
  if (value === "WANG_SCORE") return "왕장군 점수순";
  if (value === "WANG_CONFIDENCE") return "왕장군 신뢰도순";
  return "백테스트순";
};

export const wangPhaseLabel = (value: WangStrategyPhase): string => {
  if (value === "LIFE_VOLUME") return "인생거래량";
  if (value === "BASE_VOLUME") return "기준거래량";
  if (value === "RISING_VOLUME") return "상승거래량";
  if (value === "ELASTIC_VOLUME") return "탄력거래량";
  if (value === "MIN_VOLUME") return "최소거래량";
  if (value === "REACCUMULATION") return "재축적";
  return "미감지";
};

export const wangActionBiasLabel = (value: WangStrategyActionBias): string => {
  if (value === "ACCUMULATE") return "적립";
  if (value === "CAUTION") return "경계";
  if (value === "OVERHEAT") return "과열";
  return "관찰";
};

export const dashboardStrategyLabel = (key: string): string => {
  if (key === "wangStrategy") return "왕장군 검증";
  if (key === "washoutPullback") return "설거지+눌림목";
  if (key === "darvasRetest") return "다르바스";
  if (key === "nr7InsideBar") return "NR7";
  if (key === "trendTemplate") return "추세 템플릿";
  if (key === "rsiDivergence") return "RSI 다이버전스";
  if (key === "flowPersistence") return "수급 지속성";
  if (key === "volume") return "거래량";
  if (key === "vcp") return "VCP";
  if (key === "ihs") return "IHS";
  if (key === "hs") return "H&S";
  if (key.startsWith("wangActionBias:")) {
    return `행동 · ${wangActionBiasLabel(key.replace("wangActionBias:", "") as WangStrategyActionBias)}`;
  }
  if (key.startsWith("wangPhase:")) {
    return `phase · ${wangPhaseLabel(key.replace("wangPhase:", "") as WangStrategyPhase)}`;
  }
  return key;
};

export const dashboardScoreModeLabel = (
  scoreMode: "primary" | "validation" | undefined,
): string => (scoreMode === "validation" ? "보조 검증" : "본 전략");

export const wangBadgeClass = (wang: WangStrategyScreeningSummary): string => {
  if (wang.eligible) return "badge good";
  if (wang.actionBias === "CAUTION" || wang.actionBias === "OVERHEAT") return "badge caution";
  return "badge neutral";
};

export const booleanFilterLabel = (value: ScreenerBooleanFilter): string => {
  if (value === "YES") return "YES";
  if (value === "NO") return "NO";
  return "ALL";
};

export const isWangSortKey = (value: SortKey): boolean =>
  value === "WANG_SCORE" || value === "WANG_CONFIDENCE";

export const verdictClass = (value: ScreenerVerdict): string => {
  if (value === "매수 검토") return "signal-tag positive";
  if (value === "비중 축소") return "signal-tag negative";
  return "signal-tag neutral";
};
