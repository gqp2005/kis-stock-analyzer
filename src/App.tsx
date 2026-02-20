import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineStyle, createChart, type Time } from "lightweight-charts";
import stockMap from "../data/kr-stocks.json";
import type { MultiAnalysisResponse, Overall, Timeframe, TimeframeAnalysis } from "./types";

interface StockLookup {
  code: string;
  name: string;
  market: string;
}

const stocks = stockMap as StockLookup[];

const normalizeSearch = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

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

export default function App() {
  const [query, setQuery] = useState("005930");
  const [days, setDays] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MultiAnalysisResponse | null>(null);
  const [activeTf, setActiveTf] = useState<Timeframe>("day");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const apiBase = useMemo(() => import.meta.env.VITE_API_BASE ?? "", []);

  const suggestions = useMemo(() => {
    const raw = query.trim();
    if (!raw) return [];
    const qCode = raw.toUpperCase();
    const qName = normalizeSearch(raw);

    const ranked = stocks
      .map((stock) => {
        const code = stock.code.toUpperCase();
        const name = normalizeSearch(stock.name);
        let rank = Number.MAX_SAFE_INTEGER;
        if (code === qCode) rank = 0;
        else if (name === qName) rank = 1;
        else if (code.startsWith(qCode)) rank = 2;
        else if (name.startsWith(qName)) rank = 3;
        else if (code.includes(qCode)) rank = 4;
        else if (name.includes(qName)) rank = 5;
        else return null;

        return { ...stock, rank };
      })
      .filter((item): item is StockLookup & { rank: number } => item !== null)
      .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.code.localeCompare(b.code));

    return ranked.slice(0, 8);
  }, [query]);

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
    if (!chartRef.current || !result) return;
    const active = result.timeframes[activeTf];
    if (!active || active.candles.length === 0) return;

    const container = chartRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
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

    const candleSeries = chart.addCandlestickSeries({
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

    if (active.levels.support != null) {
      candleSeries.createPriceLine({
        price: active.levels.support,
        color: "rgba(0, 179, 134, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Support",
      });
    }
    if (active.levels.resistance != null) {
      candleSeries.createPriceLine({
        price: active.levels.resistance,
        color: "rgba(255, 90, 118, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Resistance",
      });
    }

    const volumeSeries = chart.addHistogramSeries({
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

    const onResize = () => chart.applyOptions({ width: container.clientWidth });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [result, activeTf]);

  const activeAnalysis: TimeframeAnalysis | null = result ? result.timeframes[activeTf] : null;

  return (
    <div className="page">
      <main className="panel">
        <header className="hero">
          <p className="eyebrow">KIS DEVELOPERS OPENAPI</p>
          <h1>KR Stock Signal Board</h1>
          <p className="subtitle">멀티 타임프레임(월/주/일/15분) 스코어링으로 종목 상태를 확인합니다.</p>
        </header>

        <form className="search" onSubmit={onSubmit}>
          <div className="search-input-wrap" ref={searchWrapRef}>
            <input
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="005930 또는 삼성전자"
              aria-label="종목 코드 또는 종목명"
            />
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
                  {result.meta.market} · {result.meta.asOf} · source {result.meta.source}
                </p>
              </div>
              <div className="summary-right">
                <div className="final-badges">
                  <span className={overallClass(result.final.overall)}>{result.final.overall}</span>
                  <span className={confidenceClass(result.final.confidence)}>
                    confidence {result.final.confidence}
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
                    <h3>Trend</h3>
                    <strong>{activeAnalysis.scores.trend}</strong>
                  </article>
                  <article className={scoreClass(activeAnalysis.scores.momentum)}>
                    <h3>Momentum</h3>
                    <strong>{activeAnalysis.scores.momentum}</strong>
                  </article>
                  <article className={scoreClass(activeAnalysis.scores.risk)}>
                    <h3>Risk</h3>
                    <strong>{activeAnalysis.scores.risk}</strong>
                  </article>
                </div>

                {activeTf === "min15" && (
                  <div className="timing-box">
                    {activeAnalysis.timing ? (
                      <>
                        <h3>
                          15분 타이밍: {activeAnalysis.timing.timingScore} ({activeAnalysis.timing.timingLabel})
                        </h3>
                        <ul>
                          {activeAnalysis.timing.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
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
                    {activeAnalysis.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>

                <div className="card">
                  <h3>OHLCV Chart ({TF_LABEL[activeTf]})</h3>
                  <div ref={chartRef} className="chart" />
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
