import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type LineData,
  type LogicalRange,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import type {
  IndicatorPoint,
  MultiAnalysisResponse,
  Overall,
  Timeframe,
  TimeframeAnalysis,
} from "./types";

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

const confidenceClass = (confidence: number): string => {
  if (confidence >= 70) return "confidence good";
  if (confidence >= 45) return "confidence neutral";
  return "confidence caution";
};

const TF_LABEL: Record<Timeframe, string> = {
  month: "월봉",
  week: "주봉",
  day: "일봉",
  min15: "15분",
};

const TF_TABS: Timeframe[] = ["month", "week", "day", "min15"];
const TF_FALLBACK_ORDER: Timeframe[] = ["day", "week", "month", "min15"];

const toChartTime = (value: string): Time => {
  if (value.includes("T")) {
    return Math.floor(new Date(value).getTime() / 1000) as Time;
  }
  return value as Time;
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

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatSigned = (value: number): string => `${value > 0 ? "+" : ""}${value}`;
const formatRiskReward = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value)}대1`;

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

const timingReasonTone = (reason: string): ReasonTone => {
  if (reason.includes("위라 단기 방향이 우호적")) return "positive";
  if (reason.includes("정렬로 단기 추세 정렬이 좋습니다")) return "positive";
  if (reason.includes("가 55 이상입니다")) return "positive";
  if (reason.includes("최근 4봉 기준 상승했습니다")) return "positive";

  if (reason.includes("아래라 단기 추세가 약합니다")) return "negative";
  if (reason.includes("정렬이 아직 아닙니다")) return "negative";
  if (reason.includes("하단 이탈")) return "negative";
  if (reason.includes("상단 이탈")) return "negative";
  if (reason.includes("변동성이 높습니다")) return "negative";
  return "negative";
};

export default function App() {
  const [query, setQuery] = useState("005930");
  const [days, setDays] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MultiAnalysisResponse | null>(null);
  const [activeTf, setActiveTf] = useState<Timeframe>("day");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<StockLookup[]>([]);
  const [showMa1, setShowMa1] = useState(true);
  const [showMa2, setShowMa2] = useState(true);
  const [showMa3, setShowMa3] = useState(false);

  const priceChartRef = useRef<HTMLDivElement | null>(null);
  const rsiChartRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const apiBase = useMemo(() => import.meta.env.VITE_API_BASE ?? "", []);

  const fetchAnalysis = async (value: string, lookback: number) => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiBase}/api/analysis?query=${encodeURIComponent(value)}&count=${lookback}&tf=multi`;
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setShowSuggestions(false);
    fetchAnalysis(normalized, days);
  };

  const onSelectSuggestion = (stock: StockLookup) => {
    setQuery(stock.code);
    setShowSuggestions(false);
    fetchAnalysis(stock.code, days);
  };

  const clearQuery = () => {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    queryInputRef.current?.focus();
  };

  useEffect(() => {
    fetchAnalysis("005930", 180);
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
        timeVisible: activeTf === "min15",
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

    const showMaOverlay = activeTf !== "min15";
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

    if (active.levels.support != null) {
      candleSeries.createPriceLine({
        price: active.levels.support,
        color: "rgba(0, 179, 134, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "지지",
      });
    }
    if (active.levels.resistance != null) {
      candleSeries.createPriceLine({
        price: active.levels.resistance,
        color: "rgba(255, 90, 118, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "저항",
      });
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
          timeVisible: activeTf === "min15",
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
      rsiChart?.remove();
      mainChart.remove();
    };
  }, [result, activeTf, showMa1, showMa2, showMa3]);

  const activeAnalysis: TimeframeAnalysis | null = result ? result.timeframes[activeTf] : null;
  const maInfo = activeAnalysis?.indicators.ma ?? null;
  const activeRsiPoints = activeAnalysis?.indicators.rsi14 ?? [];
  const activeRsiLast = findLastIndicatorPoint(activeRsiPoints);
  const hasRsiPanel = activeRsiPoints.some((point) => point.value != null);
  const riskBreakdown = activeAnalysis?.signals.risk.breakdown ?? null;
  const tradePlan = activeAnalysis?.tradePlan ?? null;
  const rsiDisabledMessage =
    activeTf === "min15"
      ? "15분봉 RSI(14) 데이터가 부족해 패널이 비활성입니다."
      : "RSI(14) 데이터가 부족해 패널이 비활성입니다.";

  return (
    <div className="page">
      <main className="panel">
        <header className="hero">
          <p className="eyebrow">KIS 개발자 오픈API</p>
          <h1>한국 주식 시그널 보드</h1>
          <p className="subtitle">멀티 타임프레임(월/주/일/15분) 스코어링으로 종목 상태를 확인합니다.</p>
        </header>

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
          <button type="submit" disabled={loading}>
            {loading ? "조회 중..." : "조회"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        {result && (
          <section className="result">
            <div className="summary">
              <div>
                <h2>
                  {result.meta.name} ({result.meta.symbol})
                </h2>
                <p className="meta">
                  {result.meta.market} · {result.meta.asOf} · 출처 {result.meta.source}
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

                {riskBreakdown && (
                  <div className="card">
                    <h3>위험도 점수 분해</h3>
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

                {activeTf === "min15" && (
                  <div className="timing-box">
                    {activeAnalysis.timing ? (
                      <>
                        <h3>
                          15분 타이밍: {activeAnalysis.timing.timingScore} ({activeAnalysis.timing.timingLabel})
                        </h3>
                        <ul>
                          {activeAnalysis.timing.reasons.map((reason) => (
                            <li key={reason} className="reason-item">
                              <span>{reason}</span>
                              {(() => {
                                const tone = toneBadge(timingReasonTone(reason));
                                return <small className={tone.className}>{tone.text}</small>;
                              })()}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <h3>15분봉은 장중/당일 데이터가 없어 타이밍 분석이 비활성입니다.</h3>
                    )}
                  </div>
                )}

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
                  {maInfo && activeTf !== "min15" && (
                    <div className="indicator-controls">
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
                    </div>
                  )}
                  <div ref={priceChartRef} className="chart" />
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
      </main>
    </div>
  );
}
