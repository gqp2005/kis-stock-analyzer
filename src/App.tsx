import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, type Time } from "lightweight-charts";
import type { AnalysisResponse } from "./types";

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
  const chartRef = useRef<HTMLDivElement | null>(null);
  const apiBase = useMemo(() => import.meta.env.VITE_API_BASE ?? "", []);

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
    fetchAnalysis(normalized, days);
  };

  useEffect(() => {
    fetchAnalysis("005930", 180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="005930 또는 삼성전자"
            aria-label="종목 코드 또는 종목명"
          />
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
              <span className={overallClass(result.scores.overall)}>{result.scores.overall}</span>
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

