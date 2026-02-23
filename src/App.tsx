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
  BacktestResponse,
  IndicatorPoint,
  InvestmentProfile,
  MultiAnalysisResponse,
  OverlayMarker,
  Overall,
  Timeframe,
  TimeframeAnalysis,
  VolumePatternSignal,
  VolumePatternType,
} from "./types";
import ScreenerPanel from "./ScreenerPanel";

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
const VOLUME_PATTERN_TEXT: Record<VolumePatternType, string> = {
  BreakoutConfirmed: "돌파 확인(A)",
  Upthrust: "불트랩(B)",
  PullbackReaccumulation: "눌림 재축적(C)",
  ClimaxUp: "상승 클라이맥스(D)",
  CapitulationAbsorption: "투매 흡수(E)",
  WeakBounce: "약한 반등(F)",
};

const BASIC_PATTERN_TYPES = new Set<VolumePatternType>([
  "BreakoutConfirmed",
  "Upthrust",
  "PullbackReaccumulation",
]);

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
  showAdvanced: boolean,
): SeriesMarker<Time>[] =>
  markers
    .filter((marker) => showAdvanced || BASIC_PATTERN_TYPES.has(marker.type))
    .map((marker) => ({
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
  const [pageMode, setPageMode] = useState<"analysis" | "screener">("analysis");
  const [query, setQuery] = useState("005930");
  const [days, setDays] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MultiAnalysisResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
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
  const [showZones, setShowZones] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showAdvancedPatternMarkers, setShowAdvancedPatternMarkers] = useState(false);
  const [showPatternReferenceLevel, setShowPatternReferenceLevel] = useState(true);
  const [highlightSelectedCandle, setHighlightSelectedCandle] = useState(true);
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
  ) => {
    setBacktestLoading(true);
    setBacktestError("");
    setBacktest(null);
    try {
      const url = `${apiBase}/api/backtest?query=${encodeURIComponent(value)}&count=${Math.max(lookback, 420)}&holdBars=${holdBars}&signal=${signalOverall}`;
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
  ) => {
    void fetchAnalysis(value, lookback);
    void fetchBacktest(value, lookback, holdBars, signalOverall);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setShowSuggestions(false);
    fetchDashboard(normalized, days, backtestHoldBars, backtestSignal);
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
    fetchDashboard(code, days, backtestHoldBars, backtestSignal);
  };

  useEffect(() => {
    fetchDashboard("005930", 180, 10, "GOOD");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      height: 420,
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
    const overlayMarkers =
      activeTf === "day"
        ? (active.overlays?.markers ?? []).filter(
            (marker) => showAdvancedPatternMarkers || BASIC_PATTERN_TYPES.has(marker.type),
          )
        : [];

    if (showMarkers && activeTf === "day") {
      candleSeries.setMarkers(toOverlayMarkers(overlayMarkers, true));
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

    const overlaySegments = active.overlays?.segments ?? [];
    const segmentVisible = overlaySegments.filter((segment) => {
      if (segment.kind === "trendlineUp" || segment.kind === "trendlineDown") return showTrendlines;
      if (segment.kind === "channelLow" || segment.kind === "channelHigh") return showChannels;
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
              : "#9f7aea";
      const segmentSeries = mainChart.addLineSeries({
        color,
        lineWidth: 2,
        lineStyle: segment.kind.startsWith("channel") ? LineStyle.Dotted : LineStyle.Solid,
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
      mainChart.applyOptions({ width: mainContainer.clientWidth });
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
    showZones,
    showMarkers,
    showAdvancedPatternMarkers,
    showPatternReferenceLevel,
    highlightSelectedCandle,
    selectedPattern,
  ]);

  const activeAnalysis: TimeframeAnalysis | null = result ? result.timeframes[activeTf] : null;
  const maInfo = activeAnalysis?.indicators.ma ?? null;
  const activeRsiPoints = activeAnalysis?.indicators.rsi14 ?? [];
  const activeRsiLast = findLastIndicatorPoint(activeRsiPoints);
  const hasRsiPanel = activeRsiPoints.some((point) => point.value != null);
  const riskBreakdown = activeAnalysis?.signals.risk.breakdown ?? null;
  const volumeSignal = activeAnalysis?.signals.volume ?? null;
  const fundamentalSignal = activeAnalysis?.signals.fundamental ?? null;
  const flowSignal = activeAnalysis?.signals.flow ?? null;
  const recentVolumePatterns = [...(activeAnalysis?.signals.volumePatterns ?? [])]
    .slice(-10)
    .reverse();
  const majorVolumePatterns = recentVolumePatterns.slice(0, 2);
  const selectedPatternDetails = selectedPattern?.details ?? null;
  const tradePlan = activeAnalysis?.tradePlan ?? null;
  const backtestSummary = backtest?.summary ?? null;
  const rsiDisabledMessage = "RSI(14) 데이터가 부족해 패널이 비활성입니다.";
  const momentumSignal = activeAnalysis?.signals.momentum ?? null;
  const riskSignal = activeAnalysis?.signals.risk ?? null;
  const confluenceBands = activeAnalysis?.confluence ?? [];
  const overlayExplanations = activeAnalysis?.explanations ?? [];
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
            백테스트 진입 신호
            <select
              value={backtestSignal}
              onChange={(e) => setBacktestSignal(e.target.value as Overall)}
              aria-label="백테스트 진입 신호"
            >
              <option value="GOOD">양호</option>
              <option value="NEUTRAL">중립</option>
              <option value="CAUTION">주의</option>
            </select>
          </label>
          <label>
            최대 보유 봉
            <select
              value={backtestHoldBars}
              onChange={(e) => setBacktestHoldBars(Number(e.target.value))}
              aria-label="최대 보유 봉"
            >
              <option value={5}>5봉</option>
              <option value={10}>10봉</option>
              <option value={15}>15봉</option>
              <option value={20}>20봉</option>
            </select>
          </label>
          <p>값을 바꾼 뒤 조회를 누르면 백테스트 조건이 적용됩니다.</p>
        </div>

        {error && <p className="error">{error}</p>}

        {result && (
          <section className="result">
            <div className="summary">
              <div>
                <h2>
                  {result.meta.name} ({result.meta.symbol})
                </h2>
                <p className="meta">
                  {result.meta.market} · {result.meta.asOf} · 성향 단기/중기 동시 표시 · 출처 {result.meta.source}
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
                  </div>
                )}

                <div className="card">
                  <div className="backtest-head">
                    <h3>일봉 백테스트 (시그널: {overallLabel(backtest?.meta.signalOverall ?? backtestSignal)})</h3>
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
                      <p className="plan-note">
                        신호 발생 다음 봉 시가 진입, 목표/손절/보유기간({backtest.meta.holdBars}봉) 기준 시뮬레이션입니다.
                      </p>
                      <p className="plan-note">
                        룰 {backtest.meta.ruleId} · 전체 기대값 {formatR(backtestSummary.expectancyR)} · 전체 손익비 {formatFactor(backtestSummary.payoffRatio)} · 전체 PF {formatFactor(backtestSummary.profitFactor)}
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
                </div>

                <div className="card">
                  <h3>OHLCV 차트 ({TF_LABEL[activeTf]})</h3>
                  {maInfo && (
                    <div className="indicator-controls">
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
                        Levels
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showTrendlines}
                          onChange={(e) => setShowTrendlines(e.target.checked)}
                        />
                        Trendlines
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showChannels}
                          onChange={(e) => setShowChannels(e.target.checked)}
                        />
                        Channels
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showZones}
                          onChange={(e) => setShowZones(e.target.checked)}
                        />
                        Zones
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showMarkers}
                          onChange={(e) => setShowMarkers(e.target.checked)}
                        />
                        Markers
                      </label>
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showAdvancedPatternMarkers}
                            onChange={(e) => setShowAdvancedPatternMarkers(e.target.checked)}
                          />
                          고급 패턴(HOT/CAP/WB)
                        </label>
                      )}
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showPatternReferenceLevel}
                            onChange={(e) => setShowPatternReferenceLevel(e.target.checked)}
                          />
                          Show pattern reference level
                        </label>
                      )}
                      {activeTf === "day" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={highlightSelectedCandle}
                            onChange={(e) => setHighlightSelectedCandle(e.target.checked)}
                          />
                          Highlight selected candle
                        </label>
                      )}
                    </div>
                  )}
                  <div ref={priceChartRef} className="chart" />
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
        ) : (
          <ScreenerPanel apiBase={apiBase} onSelectSymbol={moveToAnalysisWithSymbol} />
        )}
      </main>
    </div>
  );
}
