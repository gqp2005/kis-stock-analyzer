import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type LineWidth,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle } from "../types";

export interface StrategyChartOverlayLine {
  price: number;
  label: string;
  style: "solid" | "dashed" | "dotted";
  color: string;
  lineWidth?: number;
}

export interface StrategyChartOverlayMarker {
  time: string;
  price: number;
  label: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
}

export interface StrategyChartDescriptor {
  id: string;
  title: string;
  summary: string;
  stateLabel: string;
  stateClassName: string;
  score: number;
  scoreClassName: string;
  confidence: number;
  confidenceClassName: string;
  defaultOpen: boolean;
  hasOverlay: boolean;
  emptyOverlayMessage: string;
  lines: StrategyChartOverlayLine[];
  markers: StrategyChartOverlayMarker[];
}

interface AnalysisStrategyChartStackProps {
  items: StrategyChartDescriptor[];
  candles: Candle[];
}

const DESKTOP_CHART_HEIGHT = 232;
const MOBILE_CHART_HEIGHT = 200;
const CHART_THEME = {
  background: "#fbfdff",
  textColor: "#5f7890",
  gridColor: "#d9e4ee",
  borderColor: "#c7d7e6",
};

const toChartTime = (value: string): Time => {
  if (value.includes("T")) {
    return Math.floor(new Date(value).getTime() / 1000) as Time;
  }
  return value as Time;
};

const lineStyleMap: Record<StrategyChartOverlayLine["style"], LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

function StrategyOverlayChart(props: {
  candles: Candle[];
  lines: StrategyChartOverlayLine[];
  markers: StrategyChartOverlayMarker[];
  height: number;
}) {
  const { candles, lines, markers, height } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: CHART_THEME.background },
        textColor: CHART_THEME.textColor,
      },
      grid: {
        vertLines: { color: CHART_THEME.gridColor },
        horzLines: { color: CHART_THEME.gridColor },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.borderColor,
      },
      timeScale: {
        borderColor: CHART_THEME.borderColor,
        timeVisible: false,
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
      candles.map((candle) => ({
        time: toChartTime(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    candleSeries.setMarkers(
      markers.map(
        (marker): SeriesMarker<Time> => ({
          time: toChartTime(marker.time),
          position: marker.shape === "arrowDown" ? "aboveBar" : "belowBar",
          shape: marker.shape,
          color: marker.color,
          text: marker.label,
        }),
      ),
    );

    for (const line of lines) {
      candleSeries.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: (line.lineWidth ?? 2) as LineWidth,
        lineStyle: lineStyleMap[line.style],
        axisLabelVisible: true,
        title: line.label,
      });
    }

    chart.timeScale().fitContent();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? container.clientWidth;
            chart.applyOptions({ width, height });
          })
        : null;

    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      chart.remove();
    };
  }, [candles, height, lines, markers]);

  return <div ref={containerRef} className="analysis-strategy-chart-canvas" style={{ height: `${height}px` }} />;
}

export default function AnalysisStrategyChartStack(props: AnalysisStrategyChartStackProps) {
  const { items, candles } = props;
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 860px)").matches;
  });
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.defaultOpen])),
  );

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
    setOpenMap(Object.fromEntries(items.map((item) => [item.id, item.defaultOpen])));
  }, [items]);

  const chartHeight = isMobileView ? MOBILE_CHART_HEIGHT : DESKTOP_CHART_HEIGHT;
  const hasDayCandles = candles.length > 0;
  const emptyMessage = useMemo(
    () => (hasDayCandles ? "" : "일봉 데이터가 부족해 전략별 차트를 표시할 수 없습니다."),
    [hasDayCandles],
  );

  return (
    <div className="card analysis-strategy-chart-section">
      <div className="analysis-strategy-chart-section-head">
        <div>
          <h3>전략별 차트 (일봉)</h3>
          <p className="plan-note">메인 차트는 공통 오버레이만 유지하고, 전략 전용 시그널은 여기서 분리해 봅니다.</p>
        </div>
      </div>

      {!hasDayCandles ? (
        <p className="analysis-strategy-chart-empty">{emptyMessage}</p>
      ) : (
        <div className="analysis-strategy-chart-stack">
          {items.map((item) => {
            const isOpen = openMap[item.id] ?? item.defaultOpen;
            return (
              <details
                key={item.id}
                className="analysis-strategy-chart-card"
                open={isOpen}
                onToggle={(event) => {
                  const isExpanded = event.currentTarget.open;
                  setOpenMap((prev) => ({
                    ...prev,
                    [item.id]: isExpanded,
                  }));
                }}
              >
                <summary className="analysis-strategy-chart-summary">
                  <div className="analysis-strategy-chart-copy">
                    <div className="analysis-strategy-chart-head">
                      <strong>{item.title}</strong>
                      <div className="analysis-strategy-chart-badges">
                        <small className={item.stateClassName}>{item.stateLabel}</small>
                        <span className={item.scoreClassName}>점수 {item.score}</span>
                        <span className={item.confidenceClassName}>신뢰도 {item.confidence}</span>
                      </div>
                    </div>
                    <p>{item.summary}</p>
                  </div>
                  <span className="analysis-strategy-chart-toggle" aria-hidden="true" />
                </summary>

                <div className="analysis-strategy-chart-body">
                  <div className="analysis-strategy-chart-surface">
                    {isOpen && (
                      <StrategyOverlayChart
                        candles={candles}
                        lines={item.lines}
                        markers={item.markers}
                        height={chartHeight}
                      />
                    )}
                  </div>
                  {!item.hasOverlay && <p className="analysis-strategy-chart-note">{item.emptyOverlayMessage}</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
