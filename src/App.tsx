import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type LineData,
  type LogicalRange,
  type SeriesMarker,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import type {
  BacktestRuleId,
  BacktestResponse,
  BacktestWashoutExitMode,
  BacktestWashoutTargetMode,
  IndicatorPoint,
  InvestmentProfile,
  MultiAnalysisResponse,
  OverlayMarker,
  OverlayMarkerType,
  Overall,
  Timeframe,
  TimeframeAnalysis,
  StrategySignalState,
  WashoutPullbackState,
  VolumePatternSignal,
  VolumePatternType,
} from "./types";
import AdminOpsPanel from "./AdminOpsPanel";
import ScreenerPanel from "./ScreenerPanel";
import StrategyPanel from "./StrategyPanel";

interface StockLookup {
  code: string;
  name: string;
  market: string;
}

interface SearchResponse {
  query: string;
  count: number;
  items: StockLookup[];
}

const scoreClass = (score: number): string => {
  if (score >= 70) return "score good";
  if (score >= 45) return "score neutral";
  return "score caution";
};

const overallClass = (overall: Overall): string => {
  if (overall === "GOOD") return "badge good";
  if (overall === "NEUTRAL") return "badge neutral";
  return "badge caution";
};

const overallLabel = (overall: Overall): string => {
  if (overall === "GOOD") return "양호";
  if (overall === "NEUTRAL") return "중립";
  return "주의";
};

const profileOverallFromScore = (score: number): Overall => {
  if (score >= 70) return "GOOD";
  if (score >= 45) return "NEUTRAL";
  return "CAUTION";
};

const buildProfileScoreFromBase = (
  mode: InvestmentProfile,
  trend: number,
  momentum: number,
  risk: number,
) => {
  const cfg = PROFILE_WEIGHT_CONFIG[mode];
  const score = Math.max(
    0,
    Math.min(100, Math.round((trend * cfg.trend + momentum * cfg.momentum + risk * cfg.risk) / 100)),
  );
  return {
    mode,
    score,
    overall: profileOverallFromScore(score),
    weights: {
      trend: cfg.trend,
      momentum: cfg.momentum,
      risk: cfg.risk,
    },
    description: cfg.description,
  };
};

const confidenceClass = (confidence: number): string => {
  if (confidence >= 70) return "confidence good";
  if (confidence >= 45) return "confidence neutral";
  return "confidence caution";
};

const TF_LABEL: Record<Timeframe, string> = {
  month: "월봉",
  week: "주봉",
  day: "일봉",
};

const PROFILE_LABEL: Record<InvestmentProfile, string> = {
  short: "단기",
  mid: "중기",
};

const PROFILE_WEIGHT_CONFIG: Record<
  InvestmentProfile,
  { trend: number; momentum: number; risk: number; description: string }
> = {
  short: {
    trend: 30,
    momentum: 50,
    risk: 20,
    description: "단기 성향: 모멘텀/수급 비중을 높여 빠른 변화를 우선합니다.",
  },
  mid: {
    trend: 50,
    momentum: 20,
    risk: 30,
    description: "중기 성향: 추세/리스크 비중을 높여 안정적인 흐름을 우선합니다.",
  },
};

const TF_TABS: Timeframe[] = ["month", "week", "day"];
const TF_FALLBACK_ORDER: Timeframe[] = ["day", "week", "month"];
const DEFAULT_PRICE_CHART_HEIGHT = 420;
const MIN_PRICE_CHART_HEIGHT = 320;
const MAX_PRICE_CHART_HEIGHT = 980;
const PRICE_CHART_HEIGHT_STEP = 80;
const BACKTEST_RULE_LABEL: Record<BacktestRuleId, string> = {
  "score-card-v1-day-overall": "일봉 점수룰 v1",
  "washout-pullback-v1": "설거지+눌림 v1(단일)",
  "washout-pullback-v1.1": "설거지+눌림 v1.1(분할)",
};
const VOLUME_PATTERN_TEXT: Record<VolumePatternType, string> = {
  BreakoutConfirmed: "돌파 확인(A)",
  Upthrust: "불트랩(B)",
  PullbackReaccumulation: "눌림 재축적(C)",
  ClimaxUp: "상승 클라이맥스(D)",
  CapitulationAbsorption: "투매 흡수(E)",
  WeakBounce: "약한 반등(F)",
};

const BASIC_PATTERN_TYPES = new Set<OverlayMarkerType>([
  "BreakoutConfirmed",
  "Upthrust",
  "PullbackReaccumulation",
  "DarvasBreakout",
  "DarvasRetest",
  "NR7Setup",
  "NR7Breakout",
  "TrendTemplate",
  "RsiDivLow1",
  "RsiDivLow2",
  "RsiDivBreakout",
  "FlowPersistence",
]);
const isVcpMarkerType = (type: OverlayMarkerType): boolean =>
  type === "VCPPeak" || type === "VCPTrough" || type === "VCPBreakout";

const canShowMarkerByType = (
  type: OverlayMarkerType,
  showAdvanced: boolean,
): boolean => isVcpMarkerType(type) || showAdvanced || BASIC_PATTERN_TYPES.has(type);

const toChartTime = (value: string): Time => {
  if (value.includes("T")) {
    return Math.floor(new Date(value).getTime() / 1000) as Time;
  }
  return value as Time;
};

const toPatternTimeKey = (value: string): string => (value.includes("T") ? value.slice(0, 16) : value);

const fromChartTimeKey = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return toPatternTimeKey(value);
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value !== null && "year" in value && "month" in value && "day" in value) {
    const businessDay = value as { year: number; month: number; day: number };
    return `${businessDay.year}-${String(businessDay.month).padStart(2, "0")}-${String(businessDay.day).padStart(2, "0")}`;
  }
  return null;
};

const findCandleIndexByPatternTime = (
  candles: Array<{ time: string }>,
  patternTime: string,
): number => {
  const selectedKey = toPatternTimeKey(patternTime);
  return candles.findIndex((candle) => {
    const candleKey = toPatternTimeKey(candle.time);
    return candleKey === selectedKey || candle.time.startsWith(`${selectedKey}T`);
  });
};

const pickDefaultTf = (payload: MultiAnalysisResponse): Timeframe =>
  TF_FALLBACK_ORDER.find((tf) => payload.timeframes[tf] !== null) ?? "day";

const toLineData = (points: IndicatorPoint[]): Array<LineData<Time> | WhitespaceData<Time>> =>
  points.map((point) =>
    point.value == null ? { time: toChartTime(point.time) } : { time: toChartTime(point.time), value: point.value },
  );

const findLastIndicatorPoint = (points: IndicatorPoint[]): IndicatorPoint | null => {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].value != null) return points[i];
  }
  return null;
};

const toOverlayMarkers = (
  markers: OverlayMarker[],
): SeriesMarker<Time>[] =>
  markers.map((marker) => ({
    time: toChartTime(marker.t),
    position: marker.position,
    shape: marker.shape,
    color: marker.color,
    text: marker.text,
  })) as SeriesMarker<Time>[];

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatSigned = (value: number): string => `${value > 0 ? "+" : ""}${value}`;
const formatRiskReward = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value)}대1`;
const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;
const formatR = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}R`;
const formatFactor = (value: number | null): string =>
  value == null ? "-" : value.toFixed(2);
const formatRatio = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}배`;
const formatSignedDecimal = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
const formatSignedQty = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("ko-KR")}주`;
const formatPctPoint = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;
const formatBars = (value: number | null): string => (value == null ? "-" : `${value}봉`);
const backtestExitReasonLabel = (value: string): string => {
  if (value === "TARGET") return "목표";
  if (value === "STOP") return "손절";
  return "기간만료";
};
const backtestEntriesLabel = (
  entries: Array<{ label: string; price: number; weight: number }> | undefined,
): string => {
  if (!entries || entries.length === 0) return "-";
  return entries
    .map((entry) => `${entry.label} ${formatPrice(entry.price)}(${Math.round(entry.weight * 100)}%)`)
    .join(" / ");
};

type LevelGuideItem = {
  id: string;
  label: string;
  price: number;
  meaning: string;
};

const levelMeaningText = (label: string): string => {
  if (label.includes("52주 고점")) {
    return "최근 52주 최고가 기준선입니다. 돌파 시 신고가 추세 강화, 미돌파 시 장기 저항으로 해석합니다.";
  }
  if (label.includes("다르바스 상단")) {
    return "다르바스 박스 상단 트리거입니다. 상단 안착 여부로 추세 지속 가능성을 확인합니다.";
  }
  if (label.includes("다르바스 하단")) {
    return "다르바스 박스 하단 지지선입니다. 하향 이탈 시 박스 전략 무효 가능성이 커집니다.";
  }
  if (label.includes("NR7 상단")) {
    return "NR7(변동성 축소) 패턴의 상방 트리거입니다. 상향 돌파 시 단기 확장 신호로 봅니다.";
  }
  if (label.includes("NR7 하단")) {
    return "NR7 패턴의 하방 기준선입니다. 하향 이탈 시 약세 전개 가능성을 경계합니다.";
  }
  if (label.includes("다이버전스 넥라인")) {
    return "RSI 다이버전스 확인용 넥라인입니다. 상향 돌파 시 반등 확증 신호로 해석합니다.";
  }
  if (label.includes("추세 MA50")) {
    return "추세 템플릿의 50일 이동평균선입니다. 가격이 위에 있으면 중기 추세가 상대적으로 우호적입니다.";
  }
  if (label.includes("수급 MA20")) {
    return "수급 지속성 관찰용 20일 평균선입니다. 평균선 위 유지 여부로 수급 우위를 확인합니다.";
  }
  if (label.includes("핵심 지지") || label.includes("지지 레벨")) {
    return "최근 스윙/클러스터에서 계산한 핵심 지지 가격대입니다. 눌림 시 방어 여부를 봅니다.";
  }
  if (label.includes("핵심 저항") || label.includes("저항 레벨")) {
    return "최근 스윙/클러스터에서 계산한 핵심 저항 가격대입니다. 돌파/반락 분기점으로 봅니다.";
  }
  if (label.includes("지지존")) {
    return "지지 구간 경계선입니다. 하단 이탈 여부보다 구간 재진입/유지 여부를 함께 확인합니다.";
  }
  if (label.includes("저항존")) {
    return "저항 구간 경계선입니다. 상단 돌파 후 안착 여부가 중요합니다.";
  }
  if (label.includes("VCP 저항R") || label.includes("VCP R-zone")) {
    return "VCP 패턴의 저항 기준 구간입니다. 거래량 동반 돌파 시 패턴 완성 확률이 높아집니다.";
  }
  if (label.includes("VCP 무효화") || label.includes("무효화")) {
    return "전략 무효화 기준선입니다. 이탈 시 보수적으로 리스크 관리(손절/비중 축소)합니다.";
  }
  if (label.includes("눌림목 존")) {
    return "설거지+눌림목 전략의 관찰 구간입니다. 구간 내에서 분할 접근과 거래대금 감소 여부를 확인합니다.";
  }
  const maMatch = label.match(/^MA(\d+)/);
  if (maMatch) {
    return `${maMatch[1]}일 이동평균선입니다. 가격이 위에 있으면 추세 우위, 아래면 단기 약세 가능성을 시사합니다.`;
  }
  if (label.includes("지지")) return "가격이 반등하기 쉬운 지지 후보선입니다. 이탈 여부를 리스크 기준으로 사용합니다.";
  if (label.includes("저항")) return "가격이 막히기 쉬운 저항 후보선입니다. 돌파 후 안착 여부를 함께 확인합니다.";
  return "차트 해석을 위한 참고 레벨입니다. 단일 선보다 거래량/추세와 함께 판단하는 것이 안전합니다.";
};

const rsiSignalLabel = (rsiBand: "HIGH" | "MID" | "LOW"): string => {
  if (rsiBand === "HIGH") return "과열 구간";
  if (rsiBand === "MID") return "중립 구간";
  return "침체 구간";
};

const bbSignalLabel = (position: "ABOVE_UPPER" | "INSIDE_BAND" | "BELOW_LOWER" | "N/A"): string => {
  if (position === "ABOVE_UPPER") return "상단 이탈(과열 경계)";
  if (position === "INSIDE_BAND") return "밴드 내부(안정)";
  if (position === "BELOW_LOWER") return "하단 이탈(약세 경계)";
  return "데이터 부족";
};

const valuationLabelMeta = (
  label: "UNDERVALUED" | "FAIR" | "OVERVALUED" | "N/A",
): { text: string; className: string } => {
  if (label === "UNDERVALUED") return { text: "상대 저평가", className: "signal-tag positive" };
  if (label === "OVERVALUED") return { text: "상대 고평가", className: "signal-tag negative" };
  if (label === "FAIR") return { text: "중립 구간", className: "signal-tag neutral" };
  return { text: "데이터 부족", className: "signal-tag muted" };
};

const flowLabelMeta = (
  label: "BUYING" | "BALANCED" | "SELLING" | "N/A",
): { text: string; className: string } => {
  if (label === "BUYING") return { text: "매수 우위", className: "signal-tag positive" };
  if (label === "SELLING") return { text: "매도 우위", className: "signal-tag negative" };
  if (label === "BALANCED") return { text: "중립", className: "signal-tag neutral" };
  return { text: "데이터 부족", className: "signal-tag muted" };
};

const cupHandleStateLabel = (state: "NONE" | "POTENTIAL" | "CONFIRMED"): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "없음";
};

const cupHandleStateClass = (state: "NONE" | "POTENTIAL" | "CONFIRMED"): string => {
  if (state === "CONFIRMED") return "signal-tag positive";
  if (state === "POTENTIAL") return "signal-tag neutral";
  return "signal-tag muted";
};

const regimeLabel = (direction: "UP" | "SIDE" | "DOWN"): string => {
  if (direction === "UP") return "상승";
  if (direction === "DOWN") return "하락";
  return "혼조";
};

const regimeChipClass = (direction: "UP" | "SIDE" | "DOWN"): string => {
  if (direction === "UP") return "signal-tag positive";
  if (direction === "DOWN") return "signal-tag negative";
  return "signal-tag neutral";
};

const regimeAlignmentLabel = (alignment: "UP" | "DOWN" | "MIXED"): string => {
  if (alignment === "UP") return "상승 정렬";
  if (alignment === "DOWN") return "하락 정렬";
  return "혼합/혼조";
};

const reliabilityLevelLabel = (score: number): string => {
  if (score >= 75) return "강함";
  if (score >= 55) return "보통";
  return "약함";
};

const patternStateText = (state: "NONE" | "POTENTIAL" | "CONFIRMED"): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "없음";
};

const washoutStateLabel = (state: WashoutPullbackState): string => {
  if (state === "ANCHOR_DETECTED") return "앵커 감지";
  if (state === "WASHOUT_CANDIDATE") return "설거지 후보";
  if (state === "PULLBACK_READY") return "눌림 준비";
  if (state === "REBOUND_CONFIRMED") return "반등 확인";
  return "미감지";
};

const washoutStateClass = (state: WashoutPullbackState): string => {
  if (state === "REBOUND_CONFIRMED") return "signal-tag positive";
  if (state === "PULLBACK_READY" || state === "WASHOUT_CANDIDATE" || state === "ANCHOR_DETECTED") {
    return "signal-tag neutral";
  }
  return "signal-tag muted";
};

const strategySignalStateLabel = (state: StrategySignalState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "미감지";
};

const strategySignalStateClass = (state: StrategySignalState): string => {
  if (state === "CONFIRMED") return "signal-tag positive";
  if (state === "POTENTIAL") return "signal-tag neutral";
  return "signal-tag muted";
};

const verdictToneClass = (verdict: "매수 검토" | "관망" | "비중 축소"): string => {
  if (verdict === "매수 검토") return "signal-tag positive";
  if (verdict === "비중 축소") return "signal-tag negative";
  return "signal-tag neutral";
};

type ReasonTone = "positive" | "negative";

const toneBadge = (tone: ReasonTone): { text: "긍정" | "부정"; className: string } =>
  tone === "positive"
    ? { text: "긍정", className: "reason-tag positive" }
    : { text: "부정", className: "reason-tag negative" };

const coreReasonTone = (analysis: TimeframeAnalysis, index: number): ReasonTone => {
  if (index === 0) return analysis.signals.trend.closeAboveMid ? "positive" : "negative";
  if (index === 1) return analysis.signals.trend.fastAboveMid ? "positive" : "negative";
  if (index === 2) return analysis.signals.trend.breakout ? "positive" : "negative";
  if (index === 3) return analysis.signals.momentum.rsiBand === "LOW" ? "negative" : "positive";
  if (index === 4) {
    const atrPercent = analysis.signals.risk.atrPercent;
    return atrPercent != null && atrPercent <= 4 ? "positive" : "negative";
  }
  if (index === 5) return analysis.signals.risk.sharpDropBar ? "negative" : "positive";
  return "negative";
};

export default function App() {
  const ANALYSIS_PROFILE: InvestmentProfile = "short";
  const [pageMode, setPageMode] = useState<"analysis" | "screener" | "strategy" | "admin">("analysis");
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MultiAnalysisResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [backtestRuleId, setBacktestRuleId] = useState<BacktestRuleId>("score-card-v1-day-overall");
  const [backtestTargetMode, setBacktestTargetMode] = useState<BacktestWashoutTargetMode>("2R");
  const [backtestExitMode, setBacktestExitMode] = useState<BacktestWashoutExitMode>("PARTIAL");
  const [backtestSignal, setBacktestSignal] = useState<Overall>("GOOD");
  const [backtestHoldBars, setBacktestHoldBars] = useState(10);
  const [riskBreakdownOpen, setRiskBreakdownOpen] = useState(false);
  const [activeTf, setActiveTf] = useState<Timeframe>("day");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<StockLookup[]>([]);
  const [showMa1, setShowMa1] = useState(true);
  const [showMa2, setShowMa2] = useState(true);
  const [showMa3, setShowMa3] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [showTrendlines, setShowTrendlines] = useState(false);
  const [showChannels, setShowChannels] = useState(false);
  const [showFanLines, setShowFanLines] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showAdvancedPatternMarkers, setShowAdvancedPatternMarkers] = useState(false);
  const [showPatternReferenceLevel, setShowPatternReferenceLevel] = useState(true);
  const [highlightSelectedCandle, setHighlightSelectedCandle] = useState(true);
  const [showWashoutEntries, setShowWashoutEntries] = useState(false);
  const [priceChartHeight, setPriceChartHeight] = useState(DEFAULT_PRICE_CHART_HEIGHT);
  const [selectedPattern, setSelectedPattern] = useState<VolumePatternSignal | null>(null);

  const priceChartRef = useRef<HTMLDivElement | null>(null);
  const rsiChartRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const apiBase = useMemo(() => import.meta.env.VITE_API_BASE ?? "", []);

  const fetchAnalysis = async (value: string, lookback: number) => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiBase}/api/analysis?query=${encodeURIComponent(value)}&count=${lookback}&tf=multi&view=multi&profile=${ANALYSIS_PROFILE}`;
      const response = await fetch(url);
      const data = (await response.json()) as MultiAnalysisResponse | { error: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "분석 요청 실패");
      const payload = data as MultiAnalysisResponse;
      setResult(payload);
      setActiveTf((prev) => (payload.timeframes[prev] ? prev : pickDefaultTf(payload)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchBacktest = async (
    value: string,
    lookback: number,
    holdBars: number,
    signalOverall: Overall,
    ruleId: BacktestRuleId,
    targetMode: BacktestWashoutTargetMode,
    exitMode: BacktestWashoutExitMode,
  ) => {
    setBacktestLoading(true);
    setBacktestError("");
    setBacktest(null);
    try {
      const query = new URLSearchParams({
        query: value,
        count: String(Math.max(lookback, 420)),
        holdBars: String(holdBars),
        signal: signalOverall,
        ruleId,
      });
      if (ruleId !== "score-card-v1-day-overall") {
        query.set("target", targetMode);
        query.set("exit", exitMode);
      }
      const url = `${apiBase}/api/backtest?${query.toString()}`;
      const response = await fetch(url);
      const data = (await response.json()) as BacktestResponse | { error: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "백테스트 요청 실패");
      setBacktest(data as BacktestResponse);
    } catch (e) {
      setBacktestError(e instanceof Error ? e.message : "알 수 없는 오류");
      setBacktest(null);
    } finally {
      setBacktestLoading(false);
    }
  };

  const fetchDashboard = (
    value: string,
    lookback: number,
    holdBars: number,
    signalOverall: Overall,
    ruleId: BacktestRuleId,
    targetMode: BacktestWashoutTargetMode,
    exitMode: BacktestWashoutExitMode,
  ) => {
    void fetchAnalysis(value, lookback);
    void fetchBacktest(value, lookback, holdBars, signalOverall, ruleId, targetMode, exitMode);
  };

  const applyDrawingPreset = (preset: "basic" | "detail") => {
    if (preset === "basic") {
      setShowMa1(true);
      setShowMa2(true);
      setShowMa3(false);
      setShowLevels(true);
      setShowTrendlines(false);
      setShowChannels(false);
      setShowFanLines(false);
      setShowZones(false);
      setShowMarkers(true);
      setShowAdvancedPatternMarkers(false);
      setShowPatternReferenceLevel(true);
      setHighlightSelectedCandle(true);
      setShowWashoutEntries(false);
      return;
    }
    setShowMa1(true);
    setShowMa2(true);
    setShowMa3(true);
    setShowLevels(true);
    setShowTrendlines(true);
    setShowChannels(true);
    setShowFanLines(true);
    setShowZones(true);
    setShowMarkers(true);
    setShowAdvancedPatternMarkers(true);
    setShowPatternReferenceLevel(true);
    setHighlightSelectedCandle(true);
    setShowWashoutEntries(true);
  };

  useEffect(() => {
    setBacktestHoldBars(backtestRuleId === "score-card-v1-day-overall" ? 10 : 20);
  }, [backtestRuleId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setShowSuggestions(false);
    fetchDashboard(
      normalized,
      days,
      backtestHoldBars,
      backtestSignal,
      backtestRuleId,
      backtestTargetMode,
      backtestExitMode,
    );
  };

  const onSelectSuggestion = (stock: StockLookup) => {
    moveToAnalysisWithSymbol(stock.code);
  };

  const clearQuery = () => {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    queryInputRef.current?.focus();
  };

  const moveToAnalysisWithSymbol = (code: string) => {
    setPageMode("analysis");
    setQuery(code);
    setShowSuggestions(false);
    fetchDashboard(
      code,
      days,
      backtestHoldBars,
      backtestSignal,
      backtestRuleId,
      backtestTargetMode,
      backtestExitMode,
    );
  };

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(event.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!showSuggestions) return;
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `${apiBase}/api/search?q=${encodeURIComponent(q)}&limit=8`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await response.json()) as SearchResponse;
        setSuggestions(data.items ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSuggestions([]);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiBase, query, showSuggestions]);

  useEffect(() => {
    if (activeTf !== "day" || !showMarkers) {
      setSelectedPattern(null);
    }
  }, [activeTf, showMarkers]);

  useEffect(() => {
    if (!priceChartRef.current || !result) return;
    const active = result.timeframes[activeTf];
    if (!active || active.candles.length === 0) return;

    const mainContainer = priceChartRef.current;
    const mainChart = createChart(mainContainer, {
      width: mainContainer.clientWidth,
      height: priceChartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#0f1722" },
        textColor: "#9fb2c7",
      },
      grid: {
        vertLines: { color: "#1e2d3f" },
        horzLines: { color: "#1e2d3f" },
      },
      rightPriceScale: {
        borderColor: "#30445a",
      },
      timeScale: {
        borderColor: "#30445a",
        timeVisible: false,
        secondsVisible: false,
      },
    });

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: "#00b386",
      downColor: "#ff5a76",
      borderVisible: false,
      wickUpColor: "#00b386",
      wickDownColor: "#ff5a76",
    });
    candleSeries.setData(
      active.candles.map((c) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const showMaOverlay = true;
    if (showMaOverlay) {
      const maDefs = [
        {
          enabled: showMa1,
          series: active.indicators.ma.ma1,
          period: active.indicators.ma.ma1Period,
          color: "#ffcc66",
        },
        {
          enabled: showMa2,
          series: active.indicators.ma.ma2,
          period: active.indicators.ma.ma2Period,
          color: "#57a3ff",
        },
        {
          enabled: showMa3 && active.indicators.ma.ma3Period != null,
          series: active.indicators.ma.ma3,
          period: active.indicators.ma.ma3Period ?? 0,
          color: "#c792ea",
        },
      ];

      for (const ma of maDefs) {
        if (!ma.enabled) continue;
        const maSeries = mainChart.addLineSeries({
          color: ma.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        maSeries.setData(toLineData(ma.series));
        const last = findLastIndicatorPoint(ma.series);
        if (last?.value != null) {
          maSeries.createPriceLine({
            price: last.value,
            color: ma.color,
            lineStyle: LineStyle.Solid,
            lineVisible: false,
            axisLabelVisible: true,
            title: `MA${ma.period} ${Math.round(last.value).toLocaleString("ko-KR")}원`,
          });
        }
      }
    }

    const markerPatterns =
      activeTf === "day"
        ? (active.signals.volumePatterns ?? []).filter(
            (pattern) => showAdvancedPatternMarkers || BASIC_PATTERN_TYPES.has(pattern.type),
          )
        : [];
    const strategyWashout = activeTf === "day" ? active.strategyOverlays?.washoutPullback : null;
    const overlayMarkers =
      activeTf === "day"
        ? (active.overlays?.markers ?? []).filter(
            (marker) => canShowMarkerByType(marker.type, showAdvancedPatternMarkers),
          )
        : [];
    const washoutMarkers: SeriesMarker<Time>[] = [];
    if (activeTf === "day" && strategyWashout?.anchorSpike.time && strategyWashout.anchorSpike.price != null) {
      washoutMarkers.push({
        time: toChartTime(strategyWashout.anchorSpike.time),
        position: "aboveBar",
        shape: "circle",
        color: "#f6c75f",
        text: "ANCHOR",
      });
    }
    if (activeTf === "day" && strategyWashout?.washoutReentry.time && strategyWashout.washoutReentry.price != null) {
      washoutMarkers.push({
        time: toChartTime(strategyWashout.washoutReentry.time),
        position: "belowBar",
        shape: "arrowUp",
        color: "#00d5a0",
        text: "REIN",
      });
    }

    if (showMarkers && activeTf === "day") {
      candleSeries.setMarkers([...toOverlayMarkers(overlayMarkers), ...washoutMarkers]);
    } else {
      candleSeries.setMarkers([]);
    }

    const levelLines = (active.overlays?.priceLines ?? []).filter((line) => line.group === "level");
    const zoneLines = (active.overlays?.priceLines ?? []).filter((line) => line.group === "zone");
    if (showLevels) {
      for (const line of levelLines) {
        candleSeries.createPriceLine({
          price: line.price,
          color: line.color ?? "rgba(87,163,255,0.9)",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.label,
        });
      }
    }
    if (showZones) {
      for (const line of zoneLines) {
        candleSeries.createPriceLine({
          price: line.price,
          color: line.color ?? "rgba(155,176,198,0.85)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: line.label,
        });
      }
    }
    if (activeTf === "day" && strategyWashout?.pullbackZone.low != null && strategyWashout.pullbackZone.high != null) {
      candleSeries.createPriceLine({
        price: strategyWashout.pullbackZone.low,
        color: "rgba(0, 179, 134, 0.7)",
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${strategyWashout.pullbackZone.label} 하단`,
      });
      candleSeries.createPriceLine({
        price: strategyWashout.pullbackZone.high,
        color: "rgba(0, 179, 134, 0.7)",
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${strategyWashout.pullbackZone.label} 상단`,
      });
    }
    if (activeTf === "day" && strategyWashout?.invalidLow.price != null) {
      candleSeries.createPriceLine({
        price: strategyWashout.invalidLow.price,
        color: "rgba(255, 90, 118, 0.95)",
        lineWidth: 3,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: strategyWashout.invalidLow.label,
      });
    }
    if (activeTf === "day" && showWashoutEntries && strategyWashout?.entryPlan.entries?.length) {
      for (const entry of strategyWashout.entryPlan.entries) {
        candleSeries.createPriceLine({
          price: entry.price,
          color: "rgba(87, 163, 255, 0.9)",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${entry.label} 진입`,
        });
      }
    }

    const overlaySegments = active.overlays?.segments ?? [];
    const segmentVisible = overlaySegments.filter((segment) => {
      if (segment.kind === "trendlineUp" || segment.kind === "trendlineDown") return showTrendlines;
      if (segment.kind === "channelLow" || segment.kind === "channelHigh") return showChannels;
      if (segment.kind === "fanlineUp" || segment.kind === "fanlineDown") return showFanLines;
      return false;
    });
    for (const segment of segmentVisible) {
      const color =
        segment.kind === "trendlineUp"
          ? "#00b386"
          : segment.kind === "trendlineDown"
            ? "#ff5a76"
            : segment.kind === "channelLow"
              ? "#4db5ff"
              : segment.kind === "channelHigh"
                ? "#9f7aea"
                : segment.kind === "fanlineUp"
                  ? "#7ee787"
                  : "#ff9db4";
      const segmentSeries = mainChart.addLineSeries({
        color,
        lineWidth: segment.score >= 75 ? 2 : 1,
        lineStyle:
          segment.kind.startsWith("channel")
            ? LineStyle.Dotted
            : segment.kind.startsWith("fanline")
              ? LineStyle.Dashed
              : LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      segmentSeries.setData([
        { time: toChartTime(segment.t1), value: segment.p1 },
        { time: toChartTime(segment.t2), value: segment.p2 },
      ]);
    }

    const selectedCandleIndex =
      activeTf === "day" && selectedPattern
        ? findCandleIndexByPatternTime(active.candles, selectedPattern.t)
        : -1;

    if (
      activeTf === "day" &&
      showPatternReferenceLevel &&
      selectedPattern?.details?.refLevel != null &&
      Number.isFinite(selectedPattern.details.refLevel) &&
      selectedCandleIndex >= 0
    ) {
      const startIndex = Math.max(0, selectedCandleIndex - 10);
      const endIndex = Math.min(active.candles.length - 1, selectedCandleIndex + 10);
      const refLevel = selectedPattern.details.refLevel;
      const refSeries = mainChart.addLineSeries({
        color: "rgba(246, 199, 95, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      refSeries.setData([
        { time: toChartTime(active.candles[startIndex].time), value: refLevel },
        { time: toChartTime(active.candles[endIndex].time), value: refLevel },
      ]);
    }

    if (activeTf === "day" && highlightSelectedCandle && selectedCandleIndex >= 0) {
      const selectedCandle = active.candles[selectedCandleIndex];
      const highlightSeries = mainChart.addHistogramSeries({
        priceScaleId: "selected-candle-highlight",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      highlightSeries.priceScale().applyOptions({
        scaleMargins: { top: 0, bottom: 0 },
      });
      highlightSeries.setData([
        {
          time: toChartTime(selectedCandle.time),
          value: 1,
          color: "rgba(87, 163, 255, 0.25)",
        },
      ]);
    }

    const volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volumeSeries.setData(
      active.candles.map((c) => ({
        time: toChartTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? "rgba(0,179,134,0.45)" : "rgba(255,90,118,0.45)",
      })),
    );

    const rsiPoints = active.indicators.rsi14;
    const hasRsi = rsiPoints.some((point) => point.value != null);
    let rsiChart: ReturnType<typeof createChart> | null = null;
    let onMainRangeChange: ((range: LogicalRange | null) => void) | null = null;
    let onMainChartClick: ((param: unknown) => void) | null = null;

    if (activeTf === "day") {
      onMainChartClick = (param: unknown) => {
        if (!showMarkers) return;
        const clicked = param as { time?: unknown };
        const clickedKey = fromChartTimeKey(clicked.time);
        if (!clickedKey) return;

        let matched: VolumePatternSignal | null = null;
        for (let i = markerPatterns.length - 1; i >= 0; i -= 1) {
          const pattern = markerPatterns[i];
          const patternKey = toPatternTimeKey(pattern.t);
          if (patternKey === clickedKey || pattern.t.startsWith(`${clickedKey}T`)) {
            matched = pattern;
            break;
          }
        }
        if (matched) {
          setSelectedPattern(matched);
        }
      };
      mainChart.subscribeClick(onMainChartClick);
    }

    if (hasRsi && rsiChartRef.current) {
      const rsiContainer = rsiChartRef.current;
      rsiChart = createChart(rsiContainer, {
        width: rsiContainer.clientWidth,
        height: 180,
        layout: {
          background: { type: ColorType.Solid, color: "#0f1722" },
          textColor: "#9fb2c7",
        },
        grid: {
          vertLines: { color: "#1e2d3f" },
          horzLines: { color: "#1e2d3f" },
        },
        rightPriceScale: {
          borderColor: "#30445a",
        },
        timeScale: {
          borderColor: "#30445a",
          timeVisible: false,
          secondsVisible: false,
        },
      });

      const rsiSeries = rsiChart.addLineSeries({
        color: "#7ee787",
        lineWidth: 2,
      });
      rsiSeries.setData(toLineData(rsiPoints));
      rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(255,90,118,0.7)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "70",
      });
      rsiSeries.createPriceLine({
        price: 50,
        color: "rgba(159,178,199,0.75)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "50",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(87,163,255,0.75)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "30",
      });

      const lastRsi = findLastIndicatorPoint(rsiPoints);
      if (lastRsi?.value != null) {
        rsiSeries.createPriceLine({
          price: lastRsi.value,
          color: "#7ee787",
          lineStyle: LineStyle.Solid,
          lineVisible: false,
          axisLabelVisible: true,
          title: `RSI ${lastRsi.value.toFixed(2)}`,
        });
      }

      onMainRangeChange = (range) => {
        if (!range) return;
        rsiChart?.timeScale().setVisibleLogicalRange(range);
      };
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(onMainRangeChange);
      mainChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
    } else if (rsiChartRef.current) {
      rsiChartRef.current.innerHTML = "";
    }

    const onResize = () => {
      mainChart.applyOptions({ width: mainContainer.clientWidth, height: priceChartHeight });
      if (rsiChart && rsiChartRef.current) {
        rsiChart.applyOptions({ width: rsiChartRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (onMainRangeChange) {
        mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(onMainRangeChange);
      }
      if (onMainChartClick) {
        mainChart.unsubscribeClick(onMainChartClick);
      }
      rsiChart?.remove();
      mainChart.remove();
    };
  }, [
    result,
    activeTf,
    showMa1,
    showMa2,
    showMa3,
    showLevels,
    showTrendlines,
    showChannels,
    showFanLines,
    showZones,
    showMarkers,
    showAdvancedPatternMarkers,
    showPatternReferenceLevel,
    highlightSelectedCandle,
    showWashoutEntries,
    priceChartHeight,
    selectedPattern,
  ]);

  const decreasePriceChartHeight = () =>
    setPriceChartHeight((prev) => Math.max(MIN_PRICE_CHART_HEIGHT, prev - PRICE_CHART_HEIGHT_STEP));
  const increasePriceChartHeight = () =>
    setPriceChartHeight((prev) => Math.min(MAX_PRICE_CHART_HEIGHT, prev + PRICE_CHART_HEIGHT_STEP));
  const resetPriceChartHeight = () => setPriceChartHeight(DEFAULT_PRICE_CHART_HEIGHT);

  const activeAnalysis: TimeframeAnalysis | null = result ? result.timeframes[activeTf] : null;
  const maInfo = activeAnalysis?.indicators.ma ?? null;
  const activeRsiPoints = activeAnalysis?.indicators.rsi14 ?? [];
  const activeRsiLast = findLastIndicatorPoint(activeRsiPoints);
  const hasRsiPanel = activeRsiPoints.some((point) => point.value != null);
  const levelGuideRows = useMemo(() => {
    if (!activeAnalysis) return [] as LevelGuideItem[];
    const rows: LevelGuideItem[] = [];
    const seen = new Set<string>();
    const addRow = (id: string, label: string, price: number | null | undefined, enabled = true) => {
      if (!enabled || price == null || !Number.isFinite(price)) return;
      const rounded = Math.round(price * 100) / 100;
      const dedupeKey = `${label}:${rounded}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      rows.push({
        id,
        label,
        price: rounded,
        meaning: levelMeaningText(label),
      });
    };

    const overlayLines = activeAnalysis.overlays?.priceLines ?? [];
    for (const line of overlayLines) {
      if (line.group === "level") addRow(line.id, line.label, line.price, showLevels);
      if (line.group === "zone") addRow(line.id, line.label, line.price, showZones);
    }

    const ma = activeAnalysis.indicators.ma;
    const maRows: Array<{ enabled: boolean; period: number | null; series: IndicatorPoint[] }> = [
      { enabled: showMa1, period: ma.ma1Period, series: ma.ma1 },
      { enabled: showMa2, period: ma.ma2Period, series: ma.ma2 },
      { enabled: showMa3, period: ma.ma3Period, series: ma.ma3 },
    ];
    for (const item of maRows) {
      if (!item.enabled || item.period == null) continue;
      const last = findLastIndicatorPoint(item.series);
      addRow(`ma-${item.period}`, `MA${item.period}`, last?.value ?? null, true);
    }

    if (activeTf === "day") {
      const washoutOverlay = activeAnalysis.strategyOverlays?.washoutPullback;
      if (washoutOverlay?.pullbackZone.low != null) {
        addRow(
          "washout-zone-low",
          `${washoutOverlay.pullbackZone.label} 하단`,
          washoutOverlay.pullbackZone.low,
          true,
        );
      }
      if (washoutOverlay?.pullbackZone.high != null) {
        addRow(
          "washout-zone-high",
          `${washoutOverlay.pullbackZone.label} 상단`,
          washoutOverlay.pullbackZone.high,
          true,
        );
      }
      if (washoutOverlay?.invalidLow.price != null) {
        addRow("washout-invalid", washoutOverlay.invalidLow.label, washoutOverlay.invalidLow.price, true);
      }
      if (showWashoutEntries && washoutOverlay?.entryPlan.entries?.length) {
        for (const entry of washoutOverlay.entryPlan.entries) {
          addRow(`washout-entry-${entry.label}`, `${entry.label} 분할 진입`, entry.price, true);
        }
      }
    }

    return rows.sort((a, b) => b.price - a.price);
  }, [activeAnalysis, activeTf, showLevels, showZones, showMa1, showMa2, showMa3, showWashoutEntries]);
  const riskBreakdown = activeAnalysis?.signals.risk.breakdown ?? null;
  const volumeSignal = activeAnalysis?.signals.volume ?? null;
  const cupHandleSignal = activeAnalysis?.signals.cupHandle ?? null;
  const washoutCard = activeAnalysis?.strategyCards?.washoutPullback ?? null;
  const darvasCard = activeAnalysis?.strategyCards?.darvasRetest ?? null;
  const nr7Card = activeAnalysis?.strategyCards?.nr7InsideBar ?? null;
  const trendTemplateCard = activeAnalysis?.strategyCards?.trendTemplate ?? null;
  const rsiDivergenceCard = activeAnalysis?.strategyCards?.rsiDivergence ?? null;
  const flowPersistenceCard = activeAnalysis?.strategyCards?.flowPersistence ?? null;
  const fundamentalSignal = activeAnalysis?.signals.fundamental ?? null;
  const flowSignal = activeAnalysis?.signals.flow ?? null;
  const recentVolumePatterns = [...(activeAnalysis?.signals.volumePatterns ?? [])]
    .slice(-10)
    .reverse();
  const majorVolumePatterns = recentVolumePatterns.slice(0, 2);
  const selectedPatternDetails = selectedPattern?.details ?? null;
  const tradePlan = activeAnalysis?.tradePlan ?? null;
  const backtestSummary = backtest?.summary ?? null;
  const backtestStrategyMetrics = backtest?.strategyMetrics ?? null;
  const recentBacktestTrades = [...(backtest?.trades ?? [])].slice(-12).reverse();
  const rsiDisabledMessage = "RSI(14) 데이터가 부족해 패널이 비활성입니다.";
  const momentumSignal = activeAnalysis?.signals.momentum ?? null;
  const riskSignal = activeAnalysis?.signals.risk ?? null;
  const confluenceBands = activeAnalysis?.confluence ?? [];
  const overlayExplanations = activeAnalysis?.explanations ?? [];
  const overlaySummary = activeAnalysis?.overlays.summary ?? null;
  const reliabilitySummary = overlaySummary?.reliability ?? null;
  const regimeSummary = overlaySummary?.regime ?? null;
  const latestClose =
    activeAnalysis && activeAnalysis.candles.length > 0
      ? activeAnalysis.candles[activeAnalysis.candles.length - 1].close
      : null;
  const confluenceTop = confluenceBands.slice(0, 3).map((band) => {
    const center = (band.bandLow + band.bandHigh) / 2;
    const distancePct = latestClose != null && latestClose > 0 ? (Math.abs(center - latestClose) / latestClose) * 100 : null;
    return { ...band, distancePct };
  });
  const vcpSignal = activeAnalysis?.signals.vcp ?? null;
  const patternStateRows = [
    {
      key: "vcp",
      title: "VCP",
      state: patternStateText(vcpSignal?.state ?? "NONE"),
      score: vcpSignal?.score ?? 0,
      note: vcpSignal?.reasons[0] ?? "VCP 패턴 데이터가 부족합니다.",
    },
    {
      key: "cup-handle",
      title: "컵앤핸들",
      state: patternStateText(cupHandleSignal?.state ?? "NONE"),
      score: cupHandleSignal?.score ?? 0,
      note: cupHandleSignal?.reasons[0] ?? "컵앤핸들 패턴 데이터가 부족합니다.",
    },
  ];
  const volumePatternsAll = activeAnalysis?.signals.volumePatterns ?? [];
  const recent20DateSet = new Set((activeAnalysis?.candles ?? []).slice(-20).map((candle) => candle.time.slice(0, 10)));
  const recent20Patterns = volumePatternsAll.filter((pattern) => recent20DateSet.has(pattern.t.slice(0, 10)));
  const positivePatternTypes = new Set<VolumePatternType>([
    "BreakoutConfirmed",
    "PullbackReaccumulation",
    "CapitulationAbsorption",
  ]);
  const negativePatternTypes = new Set<VolumePatternType>(["Upthrust", "ClimaxUp", "WeakBounce"]);
  const recentPositiveCount = recent20Patterns.filter((pattern) => positivePatternTypes.has(pattern.type)).length;
  const recentNegativeCount = recent20Patterns.filter((pattern) => negativePatternTypes.has(pattern.type)).length;
  const volumeMonitorLabel =
    recentPositiveCount > recentNegativeCount
      ? "긍정 우위"
      : recentPositiveCount < recentNegativeCount
        ? "부정 우위"
        : "중립";
  const executionRiskPct =
    tradePlan?.entry != null && tradePlan.stop != null && tradePlan.entry > 0
      ? ((tradePlan.entry - tradePlan.stop) / tradePlan.entry) * 100
      : null;
  const executionTargetPct =
    tradePlan?.entry != null && tradePlan.target != null && tradePlan.entry > 0
      ? ((tradePlan.target - tradePlan.entry) / tradePlan.entry) * 100
      : null;
  const executionRiskLabel =
    executionRiskPct == null ? "데이터 부족" : executionRiskPct <= 4 ? "낮음" : executionRiskPct <= 8 ? "보통" : "높음";
  const headerQuote = (() => {
    const dayCandles = result?.timeframes.day?.candles ?? [];
    const fallbackCandles = activeAnalysis?.candles ?? [];
    const candles = dayCandles.length > 0 ? dayCandles : fallbackCandles;
    if (candles.length === 0) return null;
    const latest = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : null;
    const change = prev ? latest.close - prev.close : null;
    const changePct = prev && prev.close !== 0 ? (change / prev.close) * 100 : null;
    const tone = change == null ? "neutral" : change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
    return { close: latest.close, change, changePct, tone };
  })();
  const washoutZonePosition = (() => {
    if (!washoutCard || latestClose == null || washoutCard.pullbackZone.low == null || washoutCard.pullbackZone.high == null) {
      return "-";
    }
    if (latestClose < washoutCard.pullbackZone.low) return "존 아래";
    if (latestClose > washoutCard.pullbackZone.high) return "존 위";
    return "존 내부";
  })();
  const reliabilityOneLiner = (() => {
    if (!reliabilitySummary) {
      return {
        verdict: "관망" as const,
        text: "작도 신뢰도 데이터가 부족해 방향 판단을 보류하는 것이 좋습니다.",
      };
    }
    if (reliabilitySummary.averageScore >= 75 && regimeSummary?.alignment === "UP") {
      return {
        verdict: "매수 검토" as const,
        text: "상승 추세선 신뢰가 높아 눌림 구간 분할 접근을 검토할 수 있습니다.",
      };
    }
    if (reliabilitySummary.averageScore < 55 || regimeSummary?.alignment === "DOWN") {
      return {
        verdict: "비중 축소" as const,
        text: "하락/약한 작도 신호가 우세해 신규 진입보다 비중 관리가 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "추세 해석이 혼조라 돌파 또는 지지 확인 후 대응이 안전합니다.",
    };
  })();
  const confluenceOneLiner = (() => {
    if (confluenceTop.length === 0 || latestClose == null) {
      return {
        verdict: "관망" as const,
        text: "컨플루언스 구간이 약해 명확한 진입 타이밍으로 보기 어렵습니다.",
      };
    }
    const top = confluenceTop[0];
    const center = (top.bandLow + top.bandHigh) / 2;
    const isSupportBand = center < latestClose;
    if ((top.distancePct ?? 99) <= 1.2 && isSupportBand) {
      return {
        verdict: "매수 검토" as const,
        text: "가까운 지지 컨플루언스가 있어 지지 확인 시 분할 접근을 검토할 수 있습니다.",
      };
    }
    if ((top.distancePct ?? 99) <= 1.2 && !isSupportBand) {
      return {
        verdict: "비중 축소" as const,
        text: "가까운 상단 저항대와 맞닿아 추격보다 이익 보호가 유리합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "핵심 구간과 거리가 있어 진입보다 구간 접근을 기다리는 편이 좋습니다.",
    };
  })();
  const patternOneLiner = (() => {
    const vcpState = vcpSignal?.state ?? "NONE";
    const cupState = cupHandleSignal?.state ?? "NONE";
    if (vcpState === "CONFIRMED" || cupState === "CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "돌파 확정 패턴이 있어 손절 기준을 둔 조건부 접근을 고려할 수 있습니다.",
      };
    }
    if (vcpState === "POTENTIAL" || cupState === "POTENTIAL") {
      return {
        verdict: "관망" as const,
        text: "패턴 후보 단계라 확정 돌파 전까지 대기하는 전략이 유리합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "패턴 근거가 약해 추격 진입보다 신호 누적을 기다리는 편이 좋습니다.",
    };
  })();
  const volumeOneLiner = (() => {
    if (recentNegativeCount > recentPositiveCount) {
      return {
        verdict: "비중 축소" as const,
        text: "부정 거래량 패턴이 우세해 단기 추격은 피하고 리스크 축소가 우선입니다.",
      };
    }
    if (recentPositiveCount >= 2 && (volumeSignal?.volumeScore ?? 0) >= 65) {
      return {
        verdict: "매수 검토" as const,
        text: "긍정 거래량 패턴이 누적되어 눌림 매수 관점의 우위가 있습니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "거래량 시그널이 중립권이라 추가 확증(돌파/지지)을 기다리는 편이 안전합니다.",
    };
  })();
  const executionOneLiner = (() => {
    const rr = tradePlan?.riskReward ?? null;
    if (executionRiskPct != null && executionRiskPct > 10) {
      return {
        verdict: "비중 축소" as const,
        text: "손절 폭이 커 손익 관리가 불리하므로 진입 규모를 줄이는 편이 좋습니다.",
      };
    }
    if (executionRiskPct != null && executionRiskPct <= 6 && rr != null && rr >= 2) {
      return {
        verdict: "매수 검토" as const,
        text: "리스크 대비 보상 비율이 양호해 계획된 손절 기준 하 접근이 가능합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "진입 대비 보상 우위가 크지 않아 가격 우호 구간 재진입을 기다리는 것이 좋습니다.",
    };
  })();
  const regimeOneLiner = (() => {
    if (!regimeSummary) {
      return {
        verdict: "관망" as const,
        text: "레짐 정보가 부족해 방향성 판단을 보류하는 것이 안전합니다.",
      };
    }
    if (regimeSummary.alignment === "UP") {
      return {
        verdict: "매수 검토" as const,
        text: "장·중·단기 레짐이 상방 정렬되어 눌림 매수 관점이 상대적으로 유리합니다.",
      };
    }
    if (regimeSummary.alignment === "DOWN") {
      return {
        verdict: "비중 축소" as const,
        text: "다중 레짐이 하방이라 역추세 진입보다 방어적 대응이 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "레짐 혼합 구간이라 한 방향 베팅보다 확인 후 대응이 유리합니다.",
    };
  })();
  const shortProfileScore = activeAnalysis
    ? buildProfileScoreFromBase(
        "short",
        activeAnalysis.scores.trend,
        activeAnalysis.scores.momentum,
        activeAnalysis.scores.risk,
      )
    : null;
  const midProfileScore = activeAnalysis
    ? buildProfileScoreFromBase(
        "mid",
        activeAnalysis.scores.trend,
        activeAnalysis.scores.momentum,
        activeAnalysis.scores.risk,
      )
    : null;
  const profileOneLiner = (() => {
    if (!shortProfileScore || !midProfileScore) {
      return {
        verdict: "관망" as const,
        text: "성향 점수 데이터가 부족해 종합 판단을 보류합니다.",
      };
    }
    const short = shortProfileScore.score;
    const mid = midProfileScore.score;
    if (short >= 70 && mid >= 65) {
      return {
        verdict: "매수 검토" as const,
        text: "단기·중기 성향 점수가 모두 양호해 조건부 분할 접근을 검토할 수 있습니다.",
      };
    }
    if (short < 45 && mid < 45) {
      return {
        verdict: "비중 축소" as const,
        text: "단기·중기 성향이 모두 약해 신규 진입보다 리스크 축소가 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "성향 신호가 혼재되어 지지/돌파 확인 후 대응하는 편이 안전합니다.",
    };
  })();
  const technicalOneLiner = (() => {
    if (!momentumSignal || !riskSignal) {
      return {
        verdict: "관망" as const,
        text: "기술 지표 데이터가 부족해 판단을 보류합니다.",
      };
    }
    const rsiHighOrMid = momentumSignal.rsiBand === "HIGH" || momentumSignal.rsiBand === "MID";
    const bbStable = riskSignal.bbPosition === "INSIDE_BAND";
    if (momentumSignal.macdBullish && rsiHighOrMid && bbStable) {
      return {
        verdict: "매수 검토" as const,
        text: "MACD 우위와 RSI/볼린저 안정 조합으로 단기 모멘텀 우위가 확인됩니다.",
      };
    }
    if (!momentumSignal.macdBullish && riskSignal.bbPosition === "BELOW_LOWER") {
      return {
        verdict: "비중 축소" as const,
        text: "MACD 둔화와 밴드 하단 이탈 조합으로 하방 리스크 관리가 필요합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "지표가 혼조 구간이라 추격보다 확인 신호 누적을 기다리는 편이 유리합니다.",
    };
  })();
  const cupHandleOneLiner = (() => {
    if (!cupHandleSignal) {
      return {
        verdict: "관망" as const,
        text: "컵앤핸들 패턴 데이터가 없어 판단을 보류합니다.",
      };
    }
    if (cupHandleSignal.state === "CONFIRMED" && cupHandleSignal.breakout) {
      return {
        verdict: "매수 검토" as const,
        text: "컵앤핸들 돌파가 확인되어 손절 기준 하 조건부 접근을 검토할 수 있습니다.",
      };
    }
    if (cupHandleSignal.state === "POTENTIAL" || cupHandleSignal.detected) {
      return {
        verdict: "관망" as const,
        text: "패턴 후보 단계라 넥라인 돌파·거래량 확증이 나오기 전까지 대기가 적절합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "현재 컵앤핸들 근거가 약해 다른 추세/거래량 신호를 우선 확인해야 합니다.",
    };
  })();
  const backtestOneLiner = (() => {
    if (!backtestSummary) {
      return {
        verdict: "관망" as const,
        text: "백테스트 표본이 없어 전략 성능을 해석할 수 없습니다.",
      };
    }
    if (backtestSummary.tradeCount < 8) {
      return {
        verdict: "관망" as const,
        text: "거래 표본이 적어 신뢰도가 낮습니다. 구간을 늘려 재확인이 필요합니다.",
      };
    }
    if (
      (backtestSummary.profitFactor ?? 0) >= 1.3 &&
      (backtestSummary.winRate ?? 0) >= 55 &&
      (backtestSummary.maxDrawdownPercent ?? 999) <= 12
    ) {
      return {
        verdict: "매수 검토" as const,
        text: "승률·PF·낙폭 조합이 양호해 동일한 리스크 규칙 하에서 전략 후보로 참고할 수 있습니다.",
      };
    }
    if (
      (backtestSummary.profitFactor ?? 0) < 1 ||
      (backtestSummary.expectancyR ?? 0) < 0 ||
      (backtestSummary.maxDrawdownPercent ?? 0) >= 20
    ) {
      return {
        verdict: "비중 축소" as const,
        text: "기대값 또는 손실 지표가 불리해 진입 비중 축소와 엄격한 손절 관리가 필요합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "지표가 중립권이라 추가 확증(표본 확대/최근 구간 개선) 후 전략 적용이 안전합니다.",
    };
  })();
  const fundamentalOneLiner = (() => {
    if (!fundamentalSignal) {
      return {
        verdict: "관망" as const,
        text: "펀더멘털 데이터가 부족해 가치 측면 판단을 보류합니다.",
      };
    }
    if (fundamentalSignal.label === "UNDERVALUED") {
      return {
        verdict: "매수 검토" as const,
        text: "밸류에이션이 상대적으로 저평가 구간이라 기술 신호와 함께 조건부 접근을 검토할 수 있습니다.",
      };
    }
    if (fundamentalSignal.label === "OVERVALUED") {
      return {
        verdict: "비중 축소" as const,
        text: "밸류에이션 부담이 있어 신규 진입보다 가격 조정 확인이 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "가치 지표가 중립권이라 수급/추세 확증과 함께 보는 편이 안전합니다.",
    };
  })();
  const flowOneLiner = (() => {
    if (!flowSignal) {
      return {
        verdict: "관망" as const,
        text: "수급 데이터가 부족해 매매 주체 방향을 판단하기 어렵습니다.",
      };
    }
    if (flowSignal.label === "BUYING") {
      return {
        verdict: "매수 검토" as const,
        text: "주요 수급이 순유입 상태라 추세 확인 시 분할 접근 우위가 있습니다.",
      };
    }
    if (flowSignal.label === "SELLING") {
      return {
        verdict: "비중 축소" as const,
        text: "매도 우위 수급으로 단기 변동성 확대 가능성이 있어 방어적 대응이 필요합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "수급이 균형 구간이라 단독 신호보다는 가격 레벨 확인이 중요합니다.",
    };
  })();
  const volumeCardOneLiner = (() => {
    if (!volumeSignal) {
      return {
        verdict: "관망" as const,
        text: "거래량 신호가 부족해 패턴 해석 신뢰도가 낮습니다.",
      };
    }
    if (volumeSignal.volumeScore >= 70 && recentPositiveCount >= recentNegativeCount) {
      return {
        verdict: "매수 검토" as const,
        text: "거래량 점수와 긍정 패턴 누적이 양호해 눌림 확인 시 진입 후보로 볼 수 있습니다.",
      };
    }
    if (volumeSignal.volumeScore < 45 || recentNegativeCount > recentPositiveCount) {
      return {
        verdict: "비중 축소" as const,
        text: "부정 거래량 신호가 우세해 추격보다 리스크 축소가 유리합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "거래량이 중립권이라 돌파/지지 확증 전까지 대기 전략이 적절합니다.",
    };
  })();
  const washoutCardOneLiner = (() => {
    if (!washoutCard) {
      return {
        verdict: "관망" as const,
        text: "설거지+눌림목 데이터가 없어 전략 판단을 보류합니다.",
      };
    }
    if (washoutCard.state === "REBOUND_CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "눌림 이후 반등 재개 조건이 확인되어 손절 기준 하 조건부 접근이 가능합니다.",
      };
    }
    if (washoutCard.state === "PULLBACK_READY" || washoutCard.state === "WASHOUT_CANDIDATE") {
      return {
        verdict: "관망" as const,
        text: "후보/준비 단계라 지지 유지와 거래대금 재유입을 추가 확인한 뒤 대응이 안전합니다.",
      };
    }
    if (washoutCard.state === "ANCHOR_DETECTED") {
      return {
        verdict: "관망" as const,
        text: "대금 흔적만 있는 초기 단계라 눌림 구조가 형성되는지 관찰이 필요합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "전략 신호가 약해 다른 추세/수급 신호를 우선 확인해야 합니다.",
    };
  })();
  const darvasCardOneLiner = (() => {
    if (!darvasCard || !darvasCard.detected) {
      return {
        verdict: "관망" as const,
        text: "다르바스 박스 돌파 신호가 없어 상단 돌파/리테스트 확인이 필요합니다.",
      };
    }
    if (darvasCard.state === "CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "박스 돌파 후 리테스트 지지가 확인되어 추세 재개 관점의 후보입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "박스 상단 근접/돌파 후보 구간으로 재지지 확인 후 대응이 안전합니다.",
    };
  })();
  const nr7CardOneLiner = (() => {
    if (!nr7Card || !nr7Card.detected) {
      return {
        verdict: "관망" as const,
        text: "NR7 수축 패턴이 없어 변동성 확장 신호를 기다리는 구간입니다.",
      };
    }
    if (nr7Card.state === "CONFIRMED" && nr7Card.breakoutDirection === "UP") {
      return {
        verdict: "매수 검토" as const,
        text: "NR7 수축 이후 상방 돌파가 확인되어 단기 모멘텀 우위가 나타났습니다.",
      };
    }
    if (nr7Card.breakoutDirection === "DOWN") {
      return {
        verdict: "비중 축소" as const,
        text: "NR7 세팅 후 하방 이탈이 발생해 방어적 대응이 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "NR7 세팅은 형성됐지만 방향성 돌파 확증 전입니다.",
    };
  })();
  const trendTemplateOneLiner = (() => {
    if (!trendTemplateCard || !trendTemplateCard.detected) {
      return {
        verdict: "관망" as const,
        text: "장기 정배열/고점 근접 조건이 약해 추세 템플릿 신호가 제한적입니다.",
      };
    }
    if (trendTemplateCard.state === "CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "추세 템플릿 핵심 조건이 충족되어 강한 추세 종목 후보로 볼 수 있습니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "추세 템플릿 일부만 충족한 후보 단계로 추가 정렬 확인이 필요합니다.",
    };
  })();
  const rsiDivergenceOneLiner = (() => {
    if (!rsiDivergenceCard || !rsiDivergenceCard.detected) {
      return {
        verdict: "관망" as const,
        text: "RSI 다이버전스 근거가 약해 반등 확증 신호를 더 기다려야 합니다.",
      };
    }
    if (rsiDivergenceCard.state === "CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "강세 다이버전스 후 넥라인 돌파가 확인되어 반등 시나리오가 강화됐습니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "다이버전스 후보 구간으로 넥라인 돌파 확인 전까지는 보수적 대응이 적절합니다.",
    };
  })();
  const flowPersistenceOneLiner = (() => {
    if (!flowPersistenceCard || !flowPersistenceCard.detected) {
      return {
        verdict: "관망" as const,
        text: "수급 지속성 신호가 약해 가격/거래량 우위 확인이 더 필요합니다.",
      };
    }
    if (flowPersistenceCard.state === "CONFIRMED") {
      return {
        verdict: "매수 검토" as const,
        text: "수급/거래량 지속성이 확인되어 추세 추종 관점에서 우호적입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "수급 지속성 일부만 충족한 단계라 추세 유지 여부를 추가 확인해야 합니다.",
    };
  })();
  const riskBreakdownOneLiner = (() => {
    if (!riskBreakdown) {
      return {
        verdict: "관망" as const,
        text: "위험도 분해 데이터가 없어 상세 리스크 판단을 보류합니다.",
      };
    }
    if (riskBreakdown.finalRisk >= 70) {
      return {
        verdict: "매수 검토" as const,
        text: "변동성/낙폭 리스크가 상대적으로 낮은 편이라 계획된 진입 전략과 궁합이 좋습니다.",
      };
    }
    if (riskBreakdown.finalRisk < 40) {
      return {
        verdict: "비중 축소" as const,
        text: "리스크 점수가 낮아 급변동 구간일 수 있어 보수적 비중 관리가 필요합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "리스크가 중립권이라 손절/분할 규칙을 엄격히 지키는 접근이 중요합니다.",
    };
  })();
  const tradePlanOneLiner = (() => {
    if (!tradePlan) {
      return {
        verdict: "관망" as const,
        text: "진입/손절/목표 데이터가 부족해 실행 판단을 보류합니다.",
      };
    }
    if ((tradePlan.riskReward ?? 0) >= 2 && (executionRiskPct ?? 999) <= 6) {
      return {
        verdict: "매수 검토" as const,
        text: "손익비 대비 손절 폭이 양호해 계획된 리스크 한도 내 접근을 검토할 수 있습니다.",
      };
    }
    if ((tradePlan.riskReward ?? 0) < 1 || (executionRiskPct ?? 0) > 10) {
      return {
        verdict: "비중 축소" as const,
        text: "손절 폭 대비 기대 보상이 부족해 진입 비중을 낮추거나 대기하는 편이 유리합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "실행 지표가 중간 구간이라 추가 확증 후 접근하는 전략이 안전합니다.",
    };
  })();
  const overlayOneLiner = (() => {
    if (overlayExplanations.length === 0) {
      return {
        verdict: "관망" as const,
        text: "오버레이 설명이 부족해 선 해석 신뢰도가 낮습니다.",
      };
    }
    if ((reliabilitySummary?.averageScore ?? 0) >= 75) {
      return {
        verdict: "매수 검토" as const,
        text: "작도 신뢰도가 높은 편이라 핵심 레벨 중심의 시나리오 접근이 가능합니다.",
      };
    }
    if ((reliabilitySummary?.averageScore ?? 100) < 55) {
      return {
        verdict: "비중 축소" as const,
        text: "작도 신뢰도가 낮아 선 기반 매매 비중을 줄이고 확인 신호를 우선해야 합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "오버레이는 참고 신호로 사용하고, 가격/거래량 확증과 함께 판단하는 편이 안전합니다.",
    };
  })();
  const reasonsOneLiner = (() => {
    if (!activeAnalysis || activeAnalysis.reasons.length === 0) {
      return {
        verdict: "관망" as const,
        text: "근거 데이터가 부족해 종합 판정을 보류합니다.",
      };
    }
    const positiveCount = activeAnalysis.reasons.reduce(
      (acc, _, index) => acc + (coreReasonTone(activeAnalysis, index) === "positive" ? 1 : 0),
      0,
    );
    const negativeCount = activeAnalysis.reasons.length - positiveCount;
    if (positiveCount >= negativeCount + 2) {
      return {
        verdict: "매수 검토" as const,
        text: "긍정 근거가 우세해 추세 연장 가능성을 우선 시나리오로 볼 수 있습니다.",
      };
    }
    if (negativeCount >= positiveCount + 2) {
      return {
        verdict: "비중 축소" as const,
        text: "부정 근거가 우세해 신규 진입보다 리스크 방어가 우선입니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "긍·부정 근거가 혼재되어 핵심 레벨 확인 후 대응하는 편이 유리합니다.",
    };
  })();
  const chartOneLiner = (() => {
    if (!activeAnalysis) {
      return {
        verdict: "관망" as const,
        text: "차트 데이터가 부족해 추세 판단을 보류합니다.",
      };
    }
    if (activeAnalysis.regime === "UP" && activeAnalysis.scores.trend >= 70) {
      return {
        verdict: "매수 검토" as const,
        text: "상승 레짐과 추세 점수가 양호해 지지 구간 분할 접근을 검토할 수 있습니다.",
      };
    }
    if (activeAnalysis.regime === "DOWN" || activeAnalysis.scores.trend < 40) {
      return {
        verdict: "비중 축소" as const,
        text: "하락 레짐/약한 추세 구간이라 추격보다 반등 확인 후 대응이 안전합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "추세가 혼조라 과도한 베팅보다 주요 레벨 확인 중심 대응이 적절합니다.",
    };
  })();
  const rsiPanelOneLiner = (() => {
    if (!hasRsiPanel || activeRsiLast?.value == null) {
      return {
        verdict: "관망" as const,
        text: "RSI 데이터가 충분하지 않아 모멘텀 해석을 보류합니다.",
      };
    }
    if (activeRsiLast.value >= 70) {
      return {
        verdict: "비중 축소" as const,
        text: "RSI 과열 구간이라 추격보다 눌림 확인 후 진입이 유리합니다.",
      };
    }
    if (activeRsiLast.value >= 55 && momentumSignal?.macdBullish) {
      return {
        verdict: "매수 검토" as const,
        text: "RSI와 MACD가 함께 우호적이라 단기 모멘텀 관점 접근이 가능합니다.",
      };
    }
    return {
      verdict: "관망" as const,
      text: "RSI가 중립권이라 방향 확증 신호가 더 필요합니다.",
    };
  })();

  useEffect(() => {
    if (!selectedPattern) return;
    const exists = (activeAnalysis?.signals.volumePatterns ?? []).some(
      (pattern) => pattern.t === selectedPattern.t && pattern.type === selectedPattern.type,
    );
    if (!exists) setSelectedPattern(null);
  }, [activeAnalysis, selectedPattern]);

  return (
    <div className="page">
      <main className="panel">
        <header className="hero">
          <p className="eyebrow">KIS 개발자 오픈API</p>
          <h1>한국 주식 시그널 보드</h1>
          <p className="subtitle">멀티 타임프레임(월/주/일) 스코어링으로 종목 상태를 확인합니다.</p>
        </header>

        <div className="mode-tabs">
          <button
            type="button"
            className={pageMode === "analysis" ? "tab active" : "tab"}
            onClick={() => setPageMode("analysis")}
          >
            종목 분석
          </button>
          <button
            type="button"
            className={pageMode === "screener" ? "tab active" : "tab"}
            onClick={() => setPageMode("screener")}
          >
            종목 추천(스크리너)
          </button>
          <button
            type="button"
            className={pageMode === "strategy" ? "tab active" : "tab"}
            onClick={() => setPageMode("strategy")}
          >
            전략
          </button>
          <button
            type="button"
            className={pageMode === "admin" ? "tab active" : "tab"}
            onClick={() => setPageMode("admin")}
          >
            운영(관리자)
          </button>
        </div>

        {pageMode === "analysis" ? (
          <>

        <form className="search" onSubmit={onSubmit}>
          <div className="search-input-wrap" ref={searchWrapRef}>
            <input
              ref={queryInputRef}
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="005930 또는 삼성전자"
              aria-label="종목 코드 또는 종목명"
            />
            {query.trim().length > 0 && (
              <button
                type="button"
                className="search-clear-btn"
                aria-label="입력값 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearQuery}
              >
                ×
              </button>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="suggestions" role="listbox" aria-label="종목 추천 목록">
                {suggestions.map((stock) => (
                  <li key={`${stock.market}-${stock.code}`}>
                    <button
                      type="button"
                      className="suggestion-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectSuggestion(stock)}
                    >
                      <span className="suggestion-main">
                        <strong>{stock.code}</strong>
                        <em>{stock.name}</em>
                      </span>
                      <small>{stock.market}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="조회 기간">
            <option value={120}>최근 120봉</option>
            <option value={180}>최근 180봉</option>
            <option value={240}>최근 240봉</option>
          </select>
          <button type="submit" disabled={loading || backtestLoading}>
            {loading ? "조회 중..." : "조회"}
          </button>
        </form>
        <div className="backtest-controls">
          <label>
            백테스트 룰
            <select
              value={backtestRuleId}
              onChange={(e) => setBacktestRuleId(e.target.value as BacktestRuleId)}
              aria-label="백테스트 룰"
            >
              <option value="score-card-v1-day-overall">일봉 점수룰 v1</option>
              <option value="washout-pullback-v1">설거지+눌림 v1(단일)</option>
              <option value="washout-pullback-v1.1">설거지+눌림 v1.1(분할)</option>
            </select>
          </label>
          <label>
            백테스트 진입 신호
            <select
              value={backtestSignal}
              onChange={(e) => setBacktestSignal(e.target.value as Overall)}
              aria-label="백테스트 진입 신호"
              disabled={backtestRuleId !== "score-card-v1-day-overall"}
            >
              <option value="GOOD">양호</option>
              <option value="NEUTRAL">중립</option>
              <option value="CAUTION">주의</option>
            </select>
          </label>
          {backtestRuleId !== "score-card-v1-day-overall" && (
            <label>
              목표 모드(v1)
              <select
                value={backtestTargetMode}
                onChange={(e) => setBacktestTargetMode(e.target.value as BacktestWashoutTargetMode)}
                aria-label="설거지 백테스트 목표 모드"
              >
                <option value="2R">2R</option>
                <option value="3R">3R</option>
                <option value="ANCHOR_HIGH">Anchor 고점</option>
              </select>
            </label>
          )}
          {backtestRuleId === "washout-pullback-v1.1" && (
            <label>
              청산 방식(v1.1)
              <select
                value={backtestExitMode}
                onChange={(e) => setBacktestExitMode(e.target.value as BacktestWashoutExitMode)}
                aria-label="설거지 백테스트 청산 방식"
              >
                <option value="PARTIAL">1R 절반 + 2R 전량</option>
                <option value="SINGLE_2R">단일 2R 전량</option>
              </select>
            </label>
          )}
          <label>
            최대 보유 봉
            <select
              value={backtestHoldBars}
              onChange={(e) => setBacktestHoldBars(Number(e.target.value))}
              aria-label="최대 보유 봉"
            >
              {backtestRuleId === "score-card-v1-day-overall" ? (
                <>
                  <option value={5}>5봉</option>
                  <option value={10}>10봉</option>
                  <option value={15}>15봉</option>
                  <option value={20}>20봉</option>
                </>
              ) : (
                <>
                  <option value={10}>10봉</option>
                  <option value={20}>20봉</option>
                  <option value={30}>30봉</option>
                  <option value={40}>40봉</option>
                </>
              )}
            </select>
          </label>
          <p>값을 바꾼 뒤 조회를 누르면 선택한 룰로 백테스트가 다시 계산됩니다.</p>
        </div>

        {error && <p className="error">{error}</p>}

        {result && (
          <section className="result">
            <div className="summary">
              <div>
                <h2>
                  {result.meta.name} ({result.meta.symbol})
                </h2>
                <p className="meta current-quote">
                  <span>현재가 {formatPrice(headerQuote?.close ?? null)}</span>
                  {headerQuote?.changePct != null && (
                    <small className={`reason-tag ${headerQuote.tone}`}>
                      {`${headerQuote.change != null && headerQuote.change > 0 ? "+" : ""}${headerQuote.change != null ? Math.round(headerQuote.change).toLocaleString("ko-KR") : "0"}원 (${formatSignedDecimal(headerQuote.changePct)}%)`}
                    </small>
                  )}
                </p>
              </div>
              <div className="summary-right">
                <div className="final-badges">
                  <span className={overallClass(result.final.overall)}>
                    {overallLabel(result.final.overall)}
                  </span>
                  <span className={confidenceClass(result.final.confidence)}>
                    신뢰도 {result.final.confidence}
                  </span>
                </div>
                <p className="summary-text">{result.final.summary}</p>
              </div>
            </div>
            <p className="meta summary-meta-bottom">
              {result.meta.market} · {result.meta.asOf} · 성향 단기/중기 동시 표시 · 출처 {result.meta.source}
            </p>

            {result.warnings.length > 0 && (
              <div className="warning-box">
                {result.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}

            <div className="tf-tabs">
              {TF_TABS.map((tf) => {
                const disabled = !result.timeframes[tf];
                return (
                  <button
                    key={tf}
                    type="button"
                    className={tf === activeTf ? "tab active" : disabled ? "tab disabled" : "tab"}
                    disabled={disabled}
                    onClick={() => setActiveTf(tf)}
                  >
                    {TF_LABEL[tf]}
                  </button>
                );
              })}
            </div>

            {activeAnalysis && (
              <>
                <div className="score-grid">
                  <article className={scoreClass(activeAnalysis.scores.trend)}>
                    <h3>추세</h3>
                    <strong>{activeAnalysis.scores.trend}</strong>
                  </article>
                  <article className={scoreClass(activeAnalysis.scores.momentum)}>
                    <h3>모멘텀</h3>
                    <strong>{activeAnalysis.scores.momentum}</strong>
                  </article>
                  <article className={scoreClass(activeAnalysis.scores.risk)}>
                    <h3>위험도</h3>
                    <strong>{activeAnalysis.scores.risk}</strong>
                  </article>
                </div>

                <div className="insight-grid">
                  <div className="card insight-card">
                    <h3>자동 작도 신뢰도 요약</h3>
                    {reliabilitySummary ? (
                      <>
                        <div className="insight-kpi-grid">
                          <div className="plan-item">
                            <span>노출/전체</span>
                            <strong>
                              {reliabilitySummary.shown}/{reliabilitySummary.total}
                            </strong>
                          </div>
                          <div className="plan-item">
                            <span>숨김 선</span>
                            <strong>{reliabilitySummary.hidden}</strong>
                          </div>
                          <div className="plan-item">
                            <span>평균 신뢰도</span>
                            <strong>{reliabilitySummary.averageScore}점</strong>
                          </div>
                        </div>
                        <ul className="insight-list">
                          {reliabilitySummary.topLines.slice(0, 3).map((line) => (
                            <li key={line.id}>
                              <span>{line.label}</span>
                              <small className="signal-tag neutral">
                                {reliabilityLevelLabel(line.score)} {line.score}점
                              </small>
                            </li>
                          ))}
                        </ul>
                        <p className="insight-opinion">
                          <small className={verdictToneClass(reliabilityOneLiner.verdict)}>
                            {reliabilityOneLiner.verdict}
                          </small>
                          {reliabilityOneLiner.text}
                        </p>
                      </>
                    ) : (
                      <p className="plan-note">신뢰도 요약 데이터가 아직 없습니다.</p>
                    )}
                  </div>

                  <div className="card insight-card">
                    <h3>컨플루언스 TOP</h3>
                    {confluenceTop.length > 0 ? (
                      <>
                        <ul className="insight-list">
                          {confluenceTop.map((band, index) => (
                            <li key={`${band.bandLow}-${band.bandHigh}-${index}`}>
                              <span>
                                {formatPrice(band.bandLow)} ~ {formatPrice(band.bandHigh)}
                              </span>
                              <small className="signal-tag neutral">
                                강도 {band.strength}
                                {band.distancePct != null ? ` · 현재가 거리 ${band.distancePct.toFixed(2)}%` : ""}
                              </small>
                            </li>
                          ))}
                        </ul>
                        <p className="insight-opinion">
                          <small className={verdictToneClass(confluenceOneLiner.verdict)}>
                            {confluenceOneLiner.verdict}
                          </small>
                          {confluenceOneLiner.text}
                        </p>
                      </>
                    ) : (
                      <p className="plan-note">컨플루언스 상위 구간이 없습니다.</p>
                    )}
                  </div>

                  <div className="card insight-card">
                    <h3>패턴 상태 (VCP/컵앤핸들)</h3>
                    <div className="insight-kpi-grid">
                      {patternStateRows.map((item) => (
                        <div key={item.key} className="plan-item">
                          <span>{item.title}</span>
                          <strong>{item.state}</strong>
                          <small className="plan-note">{item.score}점</small>
                        </div>
                      ))}
                    </div>
                    <ul className="insight-list">
                      {patternStateRows.map((item) => (
                        <li key={`${item.key}-note`}>
                          <span>{item.note}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(patternOneLiner.verdict)}>
                        {patternOneLiner.verdict}
                      </small>
                      {patternOneLiner.text}
                    </p>
                  </div>

                  <div className="card insight-card">
                    <h3>거래량 패턴 모니터</h3>
                    <div className="insight-kpi-grid">
                      <div className="plan-item">
                        <span>최근 20봉 감지</span>
                        <strong>{recent20Patterns.length}건</strong>
                      </div>
                      <div className="plan-item">
                        <span>긍정/부정</span>
                        <strong>
                          {recentPositiveCount}/{recentNegativeCount}
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>해석</span>
                        <strong>{volumeMonitorLabel}</strong>
                      </div>
                    </div>
                    <p className="plan-note">
                      최근 패턴:{" "}
                      {recentVolumePatterns[0]
                        ? `${VOLUME_PATTERN_TEXT[recentVolumePatterns[0].type] ?? recentVolumePatterns[0].label} (${recentVolumePatterns[0].t.slice(0, 10)})`
                        : "없음"}
                    </p>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(volumeOneLiner.verdict)}>
                        {volumeOneLiner.verdict}
                      </small>
                      {volumeOneLiner.text}
                    </p>
                  </div>

                  <div className="card insight-card">
                    <h3>리스크 실행</h3>
                    <div className="insight-kpi-grid">
                      <div className="plan-item">
                        <span>진입/손절</span>
                        <strong>
                          {formatPrice(tradePlan?.entry ?? null)} / {formatPrice(tradePlan?.stop ?? null)}
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>목표/손익비</span>
                        <strong>
                          {formatPrice(tradePlan?.target ?? null)} / {formatRiskReward(tradePlan?.riskReward ?? null)}
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>실행 리스크</span>
                        <strong>
                          {executionRiskPct != null ? `${executionRiskPct.toFixed(2)}%` : "-"} ({executionRiskLabel})
                        </strong>
                      </div>
                    </div>
                    <p className="plan-note">
                      목표 여력: {executionTargetPct != null ? `${executionTargetPct.toFixed(2)}%` : "-"} · ATR%{" "}
                      {riskSignal?.atrPercent != null ? `${riskSignal.atrPercent.toFixed(2)}%` : "-"}
                    </p>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(executionOneLiner.verdict)}>
                        {executionOneLiner.verdict}
                      </small>
                      {executionOneLiner.text}
                    </p>
                  </div>

                  <div className="card insight-card">
                    <h3>추세 레짐 (240/120/60봉)</h3>
                    {regimeSummary ? (
                      <>
                        <div className="insight-headline">
                          <span className="plan-note">정렬 상태</span>
                          <small
                            className={
                              regimeSummary.alignment === "UP"
                                ? "signal-tag positive"
                                : regimeSummary.alignment === "DOWN"
                                  ? "signal-tag negative"
                                  : "signal-tag neutral"
                            }
                          >
                            {regimeAlignmentLabel(regimeSummary.alignment)}
                          </small>
                        </div>
                        <div className="insight-kpi-grid">
                          {regimeSummary.items.map((item) => (
                            <div key={`${item.window}-${item.lineId ?? "none"}`} className="plan-item">
                              <span>{item.label}</span>
                              <strong>{regimeLabel(item.direction)}</strong>
                              <small className={regimeChipClass(item.direction)}>
                                신뢰도 {item.score}점
                              </small>
                            </div>
                          ))}
                        </div>
                        <p className="insight-opinion">
                          <small className={verdictToneClass(regimeOneLiner.verdict)}>
                            {regimeOneLiner.verdict}
                          </small>
                          {regimeOneLiner.text}
                        </p>
                      </>
                    ) : (
                      <p className="plan-note">레짐 요약 데이터가 없습니다.</p>
                    )}
                  </div>
                </div>

                {shortProfileScore && midProfileScore && (
                  <div className="card">
                    <h3>투자 성향 맞춤 전략 (단기/중기 동시)</h3>
                    <div className="profile-dual-grid">
                      {[shortProfileScore, midProfileScore].map((item) => (
                        <article key={item.mode} className="profile-card">
                          <h4>{PROFILE_LABEL[item.mode]} 성향</h4>
                          <div className="profile-grid">
                            <div className="plan-item">
                              <span>가중 점수</span>
                              <strong>{item.score}</strong>
                            </div>
                            <div className="plan-item">
                              <span>가중 판정</span>
                              <strong>{overallLabel(item.overall)}</strong>
                            </div>
                            <div className="plan-item">
                              <span>가중치(추세/모멘텀/위험)</span>
                              <strong>
                                {item.weights.trend}/{item.weights.momentum}/{item.weights.risk}
                              </strong>
                            </div>
                          </div>
                          <p className="plan-note">{item.description}</p>
                        </article>
                      ))}
                    </div>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(profileOneLiner.verdict)}>
                        {profileOneLiner.verdict}
                      </small>
                      {profileOneLiner.text}
                    </p>
                  </div>
                )}

                {momentumSignal && riskSignal && (
                  <div className="card">
                    <h3>기술적 분석 (Technical)</h3>
                    <div className="tech-grid">
                      <div className="tech-item">
                        <strong>RSI</strong>
                        <p>
                          {momentumSignal.rsi != null ? momentumSignal.rsi.toFixed(2) : "-"} ·{" "}
                          {rsiSignalLabel(momentumSignal.rsiBand)}
                        </p>
                      </div>
                      <div className="tech-item">
                        <strong>MACD</strong>
                        <p>
                          {formatSignedDecimal(momentumSignal.macd)} / 시그널{" "}
                          {formatSignedDecimal(momentumSignal.macdSignal)} / 히스토그램{" "}
                          {formatSignedDecimal(momentumSignal.macdHist)}
                        </p>
                        <small className={momentumSignal.macdBullish ? "tech-positive" : "tech-negative"}>
                          {momentumSignal.macdBullish
                            ? "MACD 우위(상승 모멘텀)"
                            : "Signal 우위(하락/둔화 모멘텀)"}
                        </small>
                      </div>
                      <div className="tech-item">
                        <strong>볼린저</strong>
                        <p>{bbSignalLabel(riskSignal.bbPosition)}</p>
                      </div>
                    </div>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(technicalOneLiner.verdict)}>
                        {technicalOneLiner.verdict}
                      </small>
                      {technicalOneLiner.text}
                    </p>
                  </div>
                )}

                {cupHandleSignal && (
                  <div className="card">
                    <h3>컵앤핸들 분석</h3>
                    <div className="fund-grid">
                      <div className="plan-item">
                        <span>패턴 상태</span>
                        <strong className="fund-label-wrap">
                          {cupHandleStateLabel(cupHandleSignal.state)}
                          <small className={cupHandleStateClass(cupHandleSignal.state)}>
                            {cupHandleSignal.detected ? "감지됨" : "미감지"}
                          </small>
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>패턴 점수</span>
                        <strong>{cupHandleSignal.score}점</strong>
                      </div>
                      <div className="plan-item">
                        <span>넥라인(기준)</span>
                        <strong>{formatPrice(cupHandleSignal.neckline)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>돌파 여부</span>
                        <strong>
                          <small className={cupHandleSignal.breakout ? "signal-tag positive" : "signal-tag neutral"}>
                            {cupHandleSignal.breakout ? "돌파 확인" : "돌파 대기"}
                          </small>
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>컵 깊이</span>
                        <strong>{formatPctPoint(cupHandleSignal.cupDepthPct)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>핸들 깊이</span>
                        <strong>{formatPctPoint(cupHandleSignal.handleDepthPct)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>컵 폭</span>
                        <strong>{formatBars(cupHandleSignal.cupWidthBars)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>핸들 기간</span>
                        <strong>{formatBars(cupHandleSignal.handleBars)}</strong>
                      </div>
                    </div>
                    <ul className="volume-reasons">
                      {cupHandleSignal.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(cupHandleOneLiner.verdict)}>
                        {cupHandleOneLiner.verdict}
                      </small>
                      {cupHandleOneLiner.text}
                    </p>
                  </div>
                )}

                {fundamentalSignal && (
                  <div className="card">
                    <h3>펀더멘털 분석 (Fundamental)</h3>
                    <div className="fund-grid">
                      <div className="plan-item">
                        <span>PER</span>
                        <strong>{formatRatio(fundamentalSignal.per)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>PBR</span>
                        <strong>{formatRatio(fundamentalSignal.pbr)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>EPS</span>
                        <strong>{formatPrice(fundamentalSignal.eps)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>BPS</span>
                        <strong>{formatPrice(fundamentalSignal.bps)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>시가총액</span>
                        <strong>{formatPrice(fundamentalSignal.marketCap)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>결산월 / 밸류에이션</span>
                        <strong className="fund-label-wrap">
                          {fundamentalSignal.settlementMonth ?? "-"}
                          <small className={valuationLabelMeta(fundamentalSignal.label).className}>
                            {valuationLabelMeta(fundamentalSignal.label).text}
                          </small>
                        </strong>
                      </div>
                    </div>
                    <ul className="volume-reasons">
                      {fundamentalSignal.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(fundamentalOneLiner.verdict)}>
                        {fundamentalOneLiner.verdict}
                      </small>
                      {fundamentalOneLiner.text}
                    </p>
                  </div>
                )}

                {flowSignal && (
                  <div className="card">
                    <h3>수급 분석 (Flow)</h3>
                    <div className="fund-grid">
                      <div className="plan-item">
                        <span>외국인 순매수</span>
                        <strong>{formatSignedQty(flowSignal.foreignNet)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>기관 순매수</span>
                        <strong>{formatSignedQty(flowSignal.institutionNet)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>개인 순매수</span>
                        <strong>{formatSignedQty(flowSignal.individualNet)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>프로그램 순매수</span>
                        <strong>{formatSignedQty(flowSignal.programNet)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>외국인 보유율</span>
                        <strong>{formatPercent(flowSignal.foreignHoldRate)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>수급 레이블</span>
                        <strong>
                          <small className={flowLabelMeta(flowSignal.label).className}>
                            {flowLabelMeta(flowSignal.label).text}
                          </small>
                        </strong>
                      </div>
                    </div>
                    <ul className="volume-reasons">
                      {flowSignal.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(flowOneLiner.verdict)}>
                        {flowOneLiner.verdict}
                      </small>
                      {flowOneLiner.text}
                    </p>
                  </div>
                )}

                {volumeSignal && (
                  <div className="card">
                    <h3>거래량/수급</h3>
                    <div className="volume-grid">
                      <div className="plan-item">
                        <span>VolumeScore</span>
                        <strong>{volumeSignal.volumeScore}</strong>
                      </div>
                      <div className="plan-item">
                        <span>거래량 비율</span>
                        <strong>{formatRatio(volumeSignal.volRatio)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>대금(종가×거래량)</span>
                        <strong>{formatPrice(volumeSignal.turnover)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>20일 위치(pos20)</span>
                        <strong>{formatPercent(volumeSignal.pos20 * 100)}</strong>
                      </div>
                    </div>
                    <div className="volume-patterns">
                      <span>주요 패턴</span>
                      {majorVolumePatterns.length > 0 ? (
                        <div className="volume-pattern-tags">
                          {majorVolumePatterns.map((pattern) => (
                            <small key={`${pattern.t}-${pattern.type}`} className="reason-tag positive">
                              {VOLUME_PATTERN_TEXT[pattern.type] ?? pattern.label}
                            </small>
                          ))}
                        </div>
                      ) : (
                        <small className="volume-empty">패턴 없음</small>
                      )}
                    </div>
                    <ul className="volume-reasons">
                      {volumeSignal.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <div className="volume-pattern-list">
                      <h4>최근 패턴 10개</h4>
                      {recentVolumePatterns.length > 0 ? (
                        <ul>
                          {recentVolumePatterns.map((pattern) => (
                            <li key={`${pattern.t}-${pattern.type}`}>
                              <button
                                type="button"
                                className={
                                  selectedPattern?.t === pattern.t && selectedPattern?.type === pattern.type
                                    ? "pattern-row active"
                                    : "pattern-row"
                                }
                                onClick={() => setSelectedPattern(pattern)}
                              >
                                <span>{pattern.t.slice(0, 10)}</span>
                                <strong>{VOLUME_PATTERN_TEXT[pattern.type] ?? pattern.label}</strong>
                                <em>{pattern.desc}</em>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>최근 10개 구간에서 감지된 패턴이 없습니다.</p>
                      )}
                    </div>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(volumeCardOneLiner.verdict)}>
                        {volumeCardOneLiner.verdict}
                      </small>
                      {volumeCardOneLiner.text}
                    </p>
                  </div>
                )}

                {activeTf === "day" && washoutCard && (
                  <div className="card">
                    <div className="insight-headline">
                      <h3>{washoutCard.displayName}</h3>
                      <div className="final-badges">
                        <small className={washoutStateClass(washoutCard.state)}>
                          {washoutStateLabel(washoutCard.state)}
                        </small>
                        <span className={confidenceClass(washoutCard.score)}>점수 {washoutCard.score}</span>
                        <span className={confidenceClass(washoutCard.confidence)}>
                          신뢰도 {washoutCard.confidence}
                        </span>
                      </div>
                    </div>

                    <div className="washout-grid">
                      <div className="plan-item">
                        <span>Anchor 거래대금</span>
                        <strong>{formatRatio(washoutCard.anchorSpike.turnoverRatio)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>재유입 거래대금</span>
                        <strong>{formatRatio(washoutCard.washoutReentry.turnoverRatio)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>현재 상태</span>
                        <strong>{washoutStateLabel(washoutCard.state)}</strong>
                      </div>
                    </div>

                    <div className="washout-grid">
                      <div className="plan-item">
                        <span>Pullback Zone</span>
                        <strong>
                          {washoutCard.pullbackZone.low != null && washoutCard.pullbackZone.high != null
                            ? `${formatPrice(washoutCard.pullbackZone.low)} ~ ${formatPrice(washoutCard.pullbackZone.high)}`
                            : "-"}
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>Entry Plan</span>
                        <strong>
                          {washoutCard.entryPlan.entries.length > 0
                            ? `${washoutCard.entryPlan.style} (${washoutCard.entryPlan.entries
                                .map((entry) => `${entry.label} ${formatPrice(entry.price)}`)
                                .join(" / ")})`
                            : `${washoutCard.entryPlan.style} (대기)`}
                        </strong>
                      </div>
                      <div className="plan-item">
                        <span>Invalidation</span>
                        <strong>{formatPrice(washoutCard.entryPlan.invalidLow)}</strong>
                      </div>
                    </div>

                    <div className="washout-grid">
                      <div className="plan-item">
                        <span>존 위치</span>
                        <strong>{washoutZonePosition}</strong>
                      </div>
                      <div className="plan-item">
                        <span>Anchor 일자</span>
                        <strong>{washoutCard.anchorSpike.date ?? "-"}</strong>
                      </div>
                      <div className="plan-item">
                        <span>재유입 일자</span>
                        <strong>{washoutCard.washoutReentry.date ?? "-"}</strong>
                      </div>
                    </div>

                    <div className="washout-columns">
                      <div>
                        <h4>근거</h4>
                        <ul className="volume-reasons">
                          {washoutCard.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4>주의</h4>
                        {washoutCard.warnings.length > 0 ? (
                          <ul className="volume-reasons">
                            {washoutCard.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="plan-note">현재 추가 경고는 없습니다.</p>
                        )}
                      </div>
                    </div>

                    <p className="plan-note">{washoutCard.statusSummary}</p>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(washoutCardOneLiner.verdict)}>
                        {washoutCardOneLiner.verdict}
                      </small>
                      {washoutCardOneLiner.text}
                    </p>
                  </div>
                )}

                {activeTf === "day" &&
                  darvasCard &&
                  nr7Card &&
                  trendTemplateCard &&
                  rsiDivergenceCard &&
                  flowPersistenceCard && (
                    <div className="card">
                      <h3>추가 전략 카드 (1~5)</h3>
                      <div className="strategy-mini-grid">
                        <article className="strategy-mini-item">
                          <div className="strategy-mini-head">
                            <strong>다르바스 박스</strong>
                            <small className={strategySignalStateClass(darvasCard.state)}>
                              {strategySignalStateLabel(darvasCard.state)}
                            </small>
                          </div>
                          <p className="plan-note">
                            점수 {darvasCard.score} · 신뢰도 {darvasCard.confidence}
                          </p>
                          <p>{darvasCard.summary}</p>
                          <p className="insight-opinion">
                            <small className={verdictToneClass(darvasCardOneLiner.verdict)}>
                              {darvasCardOneLiner.verdict}
                            </small>
                            {darvasCardOneLiner.text}
                          </p>
                        </article>
                        <article className="strategy-mini-item">
                          <div className="strategy-mini-head">
                            <strong>NR7+인사이드바</strong>
                            <small className={strategySignalStateClass(nr7Card.state)}>
                              {strategySignalStateLabel(nr7Card.state)}
                            </small>
                          </div>
                          <p className="plan-note">
                            점수 {nr7Card.score} · 신뢰도 {nr7Card.confidence}
                          </p>
                          <p>{nr7Card.summary}</p>
                          <p className="insight-opinion">
                            <small className={verdictToneClass(nr7CardOneLiner.verdict)}>
                              {nr7CardOneLiner.verdict}
                            </small>
                            {nr7CardOneLiner.text}
                          </p>
                        </article>
                        <article className="strategy-mini-item">
                          <div className="strategy-mini-head">
                            <strong>추세 템플릿</strong>
                            <small className={strategySignalStateClass(trendTemplateCard.state)}>
                              {strategySignalStateLabel(trendTemplateCard.state)}
                            </small>
                          </div>
                          <p className="plan-note">
                            점수 {trendTemplateCard.score} · 신뢰도 {trendTemplateCard.confidence}
                          </p>
                          <p>{trendTemplateCard.summary}</p>
                          <p className="insight-opinion">
                            <small className={verdictToneClass(trendTemplateOneLiner.verdict)}>
                              {trendTemplateOneLiner.verdict}
                            </small>
                            {trendTemplateOneLiner.text}
                          </p>
                        </article>
                        <article className="strategy-mini-item">
                          <div className="strategy-mini-head">
                            <strong>RSI 다이버전스</strong>
                            <small className={strategySignalStateClass(rsiDivergenceCard.state)}>
                              {strategySignalStateLabel(rsiDivergenceCard.state)}
                            </small>
                          </div>
                          <p className="plan-note">
                            점수 {rsiDivergenceCard.score} · 신뢰도 {rsiDivergenceCard.confidence}
                          </p>
                          <p>{rsiDivergenceCard.summary}</p>
                          <p className="insight-opinion">
                            <small className={verdictToneClass(rsiDivergenceOneLiner.verdict)}>
                              {rsiDivergenceOneLiner.verdict}
                            </small>
                            {rsiDivergenceOneLiner.text}
                          </p>
                        </article>
                        <article className="strategy-mini-item">
                          <div className="strategy-mini-head">
                            <strong>수급 지속성</strong>
                            <small className={strategySignalStateClass(flowPersistenceCard.state)}>
                              {strategySignalStateLabel(flowPersistenceCard.state)}
                            </small>
                          </div>
                          <p className="plan-note">
                            점수 {flowPersistenceCard.score} · 신뢰도 {flowPersistenceCard.confidence}
                          </p>
                          <p>{flowPersistenceCard.summary}</p>
                          <p className="insight-opinion">
                            <small className={verdictToneClass(flowPersistenceOneLiner.verdict)}>
                              {flowPersistenceOneLiner.verdict}
                            </small>
                            {flowPersistenceOneLiner.text}
                          </p>
                        </article>
                      </div>
                    </div>
                  )}

                {riskBreakdown && (
                  <div className="card">
                    <div className="collapsible-head">
                      <h3>위험도 점수 분해</h3>
                      <button
                        type="button"
                        className="collapse-toggle"
                        aria-expanded={riskBreakdownOpen}
                        onClick={() => setRiskBreakdownOpen((prev) => !prev)}
                      >
                        {riskBreakdownOpen ? "접기" : "펼치기"}
                      </button>
                    </div>
                    {riskBreakdownOpen ? (
                      <>
                        <div className="risk-breakdown-grid">
                          <div className="risk-row">
                            <span>ATR 구간</span>
                            <strong>{formatSigned(riskBreakdown.atrScore)}</strong>
                          </div>
                          <div className="risk-row">
                            <span>볼린저 위치</span>
                            <strong>{formatSigned(riskBreakdown.bbScore)}</strong>
                          </div>
                          <div className="risk-row">
                            <span>20일 MDD</span>
                            <strong>{formatSigned(riskBreakdown.mddScore)}</strong>
                          </div>
                          <div className="risk-row">
                            <span>급락 패널티</span>
                            <strong>{formatSigned(riskBreakdown.sharpDropScore)}</strong>
                          </div>
                          <div className="risk-row total">
                            <span>원점수 / 최종</span>
                            <strong>
                              {riskBreakdown.rawTotal} / {riskBreakdown.finalRisk}
                            </strong>
                          </div>
                        </div>
                        <p className="plan-note">위험도 = ATR + 볼린저 + MDD + 급락 패널티 (0~100 보정)</p>
                      </>
                    ) : (
                      <p className="plan-note">기본은 접힘 상태입니다. 펼치기를 누르면 상세 점수를 확인할 수 있습니다.</p>
                    )}
                    <p className="insight-opinion">
                      <small className={verdictToneClass(riskBreakdownOneLiner.verdict)}>
                        {riskBreakdownOneLiner.verdict}
                      </small>
                      {riskBreakdownOneLiner.text}
                    </p>
                  </div>
                )}

                {tradePlan && (
                  <div className="card">
                    <h3>진입가 / 손절가 / 목표가 (참고)</h3>
                    <div className="plan-grid">
                      <div className="plan-item">
                        <span>진입가</span>
                        <strong>{formatPrice(tradePlan.entry)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>손절가</span>
                        <strong>{formatPrice(tradePlan.stop)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>목표가</span>
                        <strong>{formatPrice(tradePlan.target)}</strong>
                      </div>
                      <div className="plan-item">
                        <span>손익비</span>
                        <strong>{formatRiskReward(tradePlan.riskReward)}</strong>
                      </div>
                    </div>
                    <p className="plan-note">{tradePlan.note}</p>
                    <p className="insight-opinion">
                      <small className={verdictToneClass(tradePlanOneLiner.verdict)}>
                        {tradePlanOneLiner.verdict}
                      </small>
                      {tradePlanOneLiner.text}
                    </p>
                  </div>
                )}

                <div className="card">
                  <div className="backtest-head">
                    <h3>
                      백테스트 ({BACKTEST_RULE_LABEL[backtest?.meta.ruleId ?? backtestRuleId]})
                      {(backtest?.meta.ruleId ?? backtestRuleId) === "score-card-v1-day-overall"
                        ? ` · 시그널 ${overallLabel(backtest?.meta.signalOverall ?? backtestSignal)}`
                        : ""}
                    </h3>
                    {backtestLoading && <span className="backtest-state">계산 중...</span>}
                  </div>
                  {backtestError && <p className="backtest-error">{backtestError}</p>}
                  {backtestSummary ? (
                    <>
                      <div className="backtest-summary-grid">
                        <div className="plan-item">
                          <span>총 거래 수</span>
                          <strong>{backtestSummary.tradeCount}건</strong>
                        </div>
                        <div className="plan-item">
                          <span>승률</span>
                          <strong>{formatPercent(backtestSummary.winRate)}</strong>
                        </div>
                        <div className="plan-item">
                          <span>평균 손익률</span>
                          <strong>{formatPercent(backtestSummary.avgReturnPercent)}</strong>
                        </div>
                        <div className="plan-item">
                          <span>손익비</span>
                          <strong>{formatFactor(backtestSummary.payoffRatio)}</strong>
                        </div>
                        <div className="plan-item">
                          <span>최대 낙폭(MDD)</span>
                          <strong>{formatPercent(backtestSummary.maxDrawdownPercent)}</strong>
                        </div>
                      </div>
                      {backtestStrategyMetrics && (
                        <div className="backtest-summary-grid">
                          <div className="plan-item">
                            <span>평균 분할 체결 수</span>
                            <strong>
                              {backtestStrategyMetrics.avgTranchesFilled == null
                                ? "-"
                                : `${backtestStrategyMetrics.avgTranchesFilled.toFixed(2)}개`}
                            </strong>
                          </div>
                          <div className="plan-item">
                            <span>1차 체결률</span>
                            <strong>{formatPercent(backtestStrategyMetrics.fillRate1)}</strong>
                          </div>
                          <div className="plan-item">
                            <span>2차 체결률</span>
                            <strong>{formatPercent(backtestStrategyMetrics.fillRate2)}</strong>
                          </div>
                          <div className="plan-item">
                            <span>3차 체결률</span>
                            <strong>{formatPercent(backtestStrategyMetrics.fillRate3)}</strong>
                          </div>
                          <div className="plan-item">
                            <span>부분청산률</span>
                            <strong>{formatPercent(backtestStrategyMetrics.partialExitRate)}</strong>
                          </div>
                          <div className="plan-item">
                            <span>2R 도달률</span>
                            <strong>{formatPercent(backtestStrategyMetrics.target2HitRate)}</strong>
                          </div>
                        </div>
                      )}
                      <p className="backtest-opinion">
                        <small className={verdictToneClass(backtestOneLiner.verdict)}>
                          {backtestOneLiner.verdict}
                        </small>
                        {backtestOneLiner.text}
                      </p>
                      <div className="backtest-table-wrap">
                        <table className="backtest-table">
                          <thead>
                            <tr>
                              <th>기간</th>
                              <th>거래수</th>
                              <th>승률</th>
                              <th>평균손익</th>
                              <th>평균 R</th>
                              <th>손익비</th>
                              <th>PF</th>
                              <th>MDD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {backtest.periods.map((period) => (
                              <tr key={period.label}>
                                <td>{period.label}</td>
                                <td>{period.tradeCount}</td>
                                <td>{formatPercent(period.winRate)}</td>
                                <td>{formatPercent(period.avgReturnPercent)}</td>
                                <td>{formatR(period.avgRMultiple)}</td>
                                <td>{formatFactor(period.payoffRatio)}</td>
                                <td>{formatFactor(period.profitFactor)}</td>
                                <td>{formatPercent(period.maxDrawdownPercent)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="backtest-table-wrap" style={{ marginTop: "10px" }}>
                        <table className="backtest-table">
                          <thead>
                            <tr>
                              <th>진입일</th>
                              <th>체결 단계</th>
                              <th>평균단가</th>
                              <th>무효화</th>
                              <th>청산일</th>
                              <th>청산 사유</th>
                              <th>수익률</th>
                              <th>R</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentBacktestTrades.length > 0 ? (
                              recentBacktestTrades.map((trade, index) => (
                                <tr key={`${trade.entryTime}-${trade.exitTime}-${index}`}>
                                  <td>{trade.entryTime}</td>
                                  <td>{backtestEntriesLabel(trade.entries)}</td>
                                  <td>{formatPrice(trade.avgEntry ?? trade.entryPrice)}</td>
                                  <td>{formatPrice(trade.invalidLow ?? trade.stopPrice)}</td>
                                  <td>{trade.exitTime}</td>
                                  <td>{backtestExitReasonLabel(trade.exitReason)}</td>
                                  <td>{formatPercent(trade.returnPercent)}</td>
                                  <td>{formatR(trade.r ?? trade.rMultiple)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={8}>최근 거래 내역이 없습니다.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <p className="plan-note">
                        룰 {backtest.meta.ruleId} · 보유기간 {backtest.meta.holdBars}봉 기준 시뮬레이션입니다.
                      </p>
                      <p className="plan-note">
                        전체 기대값 {formatR(backtestSummary.expectancyR)} · 전체 손익비 {formatFactor(backtestSummary.payoffRatio)} · 전체 PF {formatFactor(backtestSummary.profitFactor)}
                        {backtest.meta.targetMode ? ` · 목표모드 ${backtest.meta.targetMode}` : ""}
                        {backtest.meta.exitMode ? ` · 청산모드 ${backtest.meta.exitMode}` : ""}
                      </p>
                      {backtest.warnings.length > 0 && (
                        <p className="plan-note">{backtest.warnings.join(" · ")}</p>
                      )}
                    </>
                  ) : (
                    !backtestLoading && !backtestError && (
                      <p className="plan-note">백테스트 결과가 없습니다.</p>
                    )
                  )}
                </div>

                <div className="card">
                  <h3>강한 지지/저항 구간 (Confluence)</h3>
                  {confluenceBands.length > 0 ? (
                    <div className="confluence-grid">
                      {confluenceBands.slice(0, 5).map((band, index) => (
                        <article key={`${band.bandLow}-${band.bandHigh}-${index}`} className="confluence-item">
                          <div className="confluence-head">
                            <strong>
                              {formatPrice(band.bandLow)} ~ {formatPrice(band.bandHigh)}
                            </strong>
                            <small>강도 {band.strength}</small>
                          </div>
                          <p>{band.reasons.join(" · ")}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="plan-note">컨플루언스 구간이 아직 충분하지 않습니다.</p>
                  )}
                  <p className="insight-opinion">
                    <small className={verdictToneClass(confluenceOneLiner.verdict)}>
                      {confluenceOneLiner.verdict}
                    </small>
                    {confluenceOneLiner.text}
                  </p>
                </div>

                <div className="card">
                  <h3>오버레이 설명</h3>
                  {overlayExplanations.length > 0 ? (
                    <ul>
                      {overlayExplanations.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="plan-note">오버레이 설명이 없습니다.</p>
                  )}
                  <p className="insight-opinion">
                    <small className={verdictToneClass(overlayOneLiner.verdict)}>
                      {overlayOneLiner.verdict}
                    </small>
                    {overlayOneLiner.text}
                  </p>
                </div>

                <div className="card">
                  <h3>{TF_LABEL[activeTf]} 근거</h3>
                  <ul>
                    {activeAnalysis.reasons.map((reason, index) => (
                      <li key={reason} className="reason-item">
                        <span>{reason}</span>
                        {(() => {
                          const tone = toneBadge(coreReasonTone(activeAnalysis, index));
                          return <small className={tone.className}>{tone.text}</small>;
                        })()}
                      </li>
                    ))}
                  </ul>
                  <p className="insight-opinion">
                    <small className={verdictToneClass(reasonsOneLiner.verdict)}>
                      {reasonsOneLiner.verdict}
                    </small>
                    {reasonsOneLiner.text}
                  </p>
                </div>

                <div className="card">
                  <h3>OHLCV 차트 ({TF_LABEL[activeTf]})</h3>
                  {maInfo && (
                    <div className="indicator-controls">
                      <div className="drawing-presets">
                        <span>자동 작도 프리셋</span>
                        <button type="button" className="preset-btn" onClick={() => applyDrawingPreset("basic")}>
                          기본형
                        </button>
                        <button type="button" className="preset-btn" onClick={() => applyDrawingPreset("detail")}>
                          상세형
                        </button>
                      </div>
                      <div className="chart-height-controls">
                        <span>차트 높이</span>
                        <div className="chart-height-buttons">
                          <button
                            type="button"
                            className="preset-btn"
                            onClick={decreasePriceChartHeight}
                            disabled={priceChartHeight <= MIN_PRICE_CHART_HEIGHT}
                          >
                            -80
                          </button>
                          <strong>{priceChartHeight}px</strong>
                          <button
                            type="button"
                            className="preset-btn"
                            onClick={increasePriceChartHeight}
                            disabled={priceChartHeight >= MAX_PRICE_CHART_HEIGHT}
                          >
                            +80
                          </button>
                          <button type="button" className="preset-btn" onClick={resetPriceChartHeight}>
                            기본
                          </button>
                        </div>
                      </div>
                      <>
                        <label>
                          <input
                            type="checkbox"
                            checked={showMa1}
                            onChange={(e) => setShowMa1(e.target.checked)}
                          />
                          MA{maInfo.ma1Period}
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={showMa2}
                            onChange={(e) => setShowMa2(e.target.checked)}
                          />
                          MA{maInfo.ma2Period}
                        </label>
                        {maInfo.ma3Period != null && (
                          <label>
                            <input
                              type="checkbox"
                              checked={showMa3}
                              onChange={(e) => setShowMa3(e.target.checked)}
                            />
                            MA{maInfo.ma3Period}
                          </label>
                        )}
                      </>
                      <label>
                        <input
                          type="checkbox"
                          checked={showLevels}
                          onChange={(e) => setShowLevels(e.target.checked)}
                        />
                        레벨
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showTrendlines}
                          onChange={(e) => setShowTrendlines(e.target.checked)}
                        />
                        추세선
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showChannels}
                          onChange={(e) => setShowChannels(e.target.checked)}
                        />
                        채널
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showFanLines}
                          onChange={(e) => setShowFanLines(e.target.checked)}
                        />
                        팬 라인
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showZones}
                          onChange={(e) => setShowZones(e.target.checked)}
                        />
                        존
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showMarkers}
                          onChange={(e) => setShowMarkers(e.target.checked)}
                        />
                        마커
                      </label>
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showAdvancedPatternMarkers}
                            onChange={(e) => setShowAdvancedPatternMarkers(e.target.checked)}
                          />
                          고급 마커(HOT/CAP/WB)
                        </label>
                      )}
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showPatternReferenceLevel}
                            onChange={(e) => setShowPatternReferenceLevel(e.target.checked)}
                          />
                          패턴 기준선 표시
                        </label>
                      )}
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={highlightSelectedCandle}
                            onChange={(e) => setHighlightSelectedCandle(e.target.checked)}
                          />
                          선택 캔들 강조
                        </label>
                      )}
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showWashoutEntries}
                            onChange={(e) => setShowWashoutEntries(e.target.checked)}
                          />
                          눌림목 분할 진입선
                        </label>
                      )}
                    </div>
                  )}
                  <div ref={priceChartRef} className="chart" style={{ height: `${priceChartHeight}px` }} />
                  {activeTf === "day" && showMarkers && selectedPattern && (
                    <div className="marker-detail-panel">
                      <div className="marker-detail-head">
                        <h4>패턴 상세</h4>
                        <button
                          type="button"
                          className="marker-detail-close"
                          onClick={() => setSelectedPattern(null)}
                        >
                          닫기
                        </button>
                      </div>
                      <div className="marker-detail-meta">
                        <span>{selectedPattern.t.slice(0, 10)}</span>
                        <strong>{VOLUME_PATTERN_TEXT[selectedPattern.type] ?? selectedPattern.label}</strong>
                        <em>{selectedPattern.desc}</em>
                      </div>
                      <div className="marker-detail-grid">
                        <div>
                          <span>가격</span>
                          <strong>{formatPrice(selectedPatternDetails?.price ?? null)}</strong>
                        </div>
                        <div>
                          <span>거래량</span>
                          <strong>{(selectedPatternDetails?.volume ?? 0).toLocaleString("ko-KR")}</strong>
                        </div>
                        <div>
                          <span>거래량 비율</span>
                          <strong>{formatRatio(selectedPatternDetails?.volRatio ?? null)}</strong>
                        </div>
                        <div>
                          <span>ref.level</span>
                          <strong>{formatPrice(selectedPatternDetails?.refLevel ?? null)}</strong>
                        </div>
                      </div>
                      <div className="marker-checklist">
                        <h5>조건 체크리스트</h5>
                        <ul>
                          {(selectedPatternDetails?.checklist ?? []).map((item) => (
                            <li key={item.label} className={item.ok ? "ok" : "no"}>
                              {item.ok ? "✓" : "✕"} {item.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p
                        className={
                          selectedPatternDetails?.tone === "warning"
                            ? "marker-signal warning"
                            : "marker-signal confirm"
                        }
                      >
                        {selectedPatternDetails?.message ?? selectedPattern.desc}
                      </p>
                    </div>
                  )}
                  {activeTf === "day" && showMarkers && !selectedPattern && (
                    <p className="marker-detail-hint">차트 마커를 클릭하면 패턴 상세가 표시됩니다.</p>
                  )}
                  {activeTf === "day" && (
                    <p className="plan-note">CONFIRMED 조건: close&gt;R &amp;&amp; volRatio&gt;=1.5</p>
                  )}
                  {showLevels && (
                    <div className="level-guide">
                      <div className="level-guide-head">
                        <h4>레벨 설명</h4>
                        <small>표시 중 {levelGuideRows.length}개</small>
                      </div>
                      {levelGuideRows.length > 0 ? (
                        <ul className="level-guide-list">
                          {levelGuideRows.map((item) => (
                            <li key={`${item.id}-${item.price}`}>
                              <div>
                                <strong>{item.label}</strong>
                                <p>{item.meaning}</p>
                              </div>
                              <span>{formatPrice(item.price)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="plan-note">현재 표시 가능한 레벨이 없습니다.</p>
                      )}
                    </div>
                  )}
                  <p className="insight-opinion">
                    <small className={verdictToneClass(chartOneLiner.verdict)}>
                      {chartOneLiner.verdict}
                    </small>
                    {chartOneLiner.text}
                  </p>
                </div>

                <div className="card">
                  <div className="rsi-header">
                    <h3>RSI(14) 패널</h3>
                    <span className="rsi-badge">
                      RSI {activeRsiLast?.value != null ? activeRsiLast.value.toFixed(2) : "-"}
                    </span>
                  </div>
                  {hasRsiPanel ? (
                    <div ref={rsiChartRef} className="rsi-chart" />
                  ) : (
                    <p className="rsi-empty">{rsiDisabledMessage}</p>
                  )}
                  <p className="insight-opinion">
                    <small className={verdictToneClass(rsiPanelOneLiner.verdict)}>
                      {rsiPanelOneLiner.verdict}
                    </small>
                    {rsiPanelOneLiner.text}
                  </p>
                </div>
              </>
            )}
            {!activeAnalysis && (
              <div className="card">
                <h3>{TF_LABEL[activeTf]} 데이터 없음</h3>
                <p>해당 타임프레임 데이터가 부족해 비활성화되었습니다. 다른 탭을 선택해 주세요.</p>
              </div>
            )}
          </section>
        )}
          </>
        ) : pageMode === "screener" ? (
          <ScreenerPanel apiBase={apiBase} onSelectSymbol={moveToAnalysisWithSymbol} />
        ) : pageMode === "strategy" ? (
          <StrategyPanel apiBase={apiBase} onSelectSymbol={moveToAnalysisWithSymbol} />
        ) : (
          <AdminOpsPanel apiBase={apiBase} />
        )}
      </main>
    </div>
  );
}
