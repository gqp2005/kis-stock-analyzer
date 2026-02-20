import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineStyle, createChart, type Time } from "lightweight-charts";
import type { AnalysisResponse } from "./types";
import stockMap from "../data/kr-stocks.json";

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

const overallClass = (overall: AnalysisResponse["scores"]["overall"]): string => {
  if (overall === "GOOD") return "badge good";
  if (overall === "NEUTRAL") return "badge neutral";
  return "badge caution";
};

export default function App() {
  const [query, setQuery] = useState("005930");
  const [days, setDays] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
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
      const url = `${apiBase}/api/analysis?query=${encodeURIComponent(value)}&days=${lookback}`;
      const response = await fetch(url);
      const data = (await response.json()) as AnalysisResponse | { error: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error : "분석 요청 실패");
      }
      setResult(data as AnalysisResponse);
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
      if (!searchWrapRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!chartRef.current || !result || result.candles.length === 0) return;

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
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "#30445a",
      },
      timeScale: {
        borderColor: "#30445a",
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
      result.candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    if (result.levels.support != null) {
      candleSeries.createPriceLine({
        price: result.levels.support,
        color: "rgba(0, 179, 134, 0.95)",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Support",
      });
    }

    if (result.levels.resistance != null) {
      candleSeries.createPriceLine({
        price: result.levels.resistance,
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
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    volumeSeries.setData(
      result.candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(0,179,134,0.45)" : "rgba(255,90,118,0.45)",
      })),
    );

    const onResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [result]);

  return (
    <div className="page">
      <main className="panel">
        <header className="hero">
          <p className="eyebrow">KIS Developers OpenAPI</p>
          <h1>KR Stock Signal Board</h1>
          <p className="subtitle">
            종목코드(예: 005930) 또는 종목명(예: 삼성전자)으로 일봉 분석 결과를 확인합니다.
          </p>
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
                  {result.meta.market} · {result.meta.asOf} · candles {result.meta.candleCount}
                </p>
              </div>
              <div className="summary-right">
                <span className={overallClass(result.scores.overall)}>{result.scores.overall}</span>
                <p className="summary-text">{result.meta.summaryText || "요약 없음"}</p>
              </div>
            </div>

            <div className="score-grid">
              <article className={scoreClass(result.scores.trend)}>
                <h3>Trend</h3>
                <strong>{result.scores.trend}</strong>
              </article>
              <article className={scoreClass(result.scores.momentum)}>
                <h3>Momentum</h3>
                <strong>{result.scores.momentum}</strong>
              </article>
              <article className={scoreClass(result.scores.risk)}>
                <h3>Risk</h3>
                <strong>{result.scores.risk}</strong>
              </article>
            </div>

            <div className="card">
              <h3>Reasons</h3>
              <ul>
                {result.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3>OHLCV Chart</h3>
              <div ref={chartRef} className="chart" />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
