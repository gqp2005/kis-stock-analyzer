import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import type { Candle } from "../types";
import type { WangStrategyChartOverlays, WangStrategyMarker } from "./types";

interface WangStrategyChartProps {
  candles: Candle[];
  chartOverlays: WangStrategyChartOverlays;
  markers: WangStrategyMarker[];
  height?: number;
  onSelectMarker?: (marker: WangStrategyMarker | null) => void;
}

interface ZoneRect {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

interface RefLineRect {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  color: string;
  dashed: boolean;
}

const DEFAULT_CHART_HEIGHT = 360;

const toChartTime = (value: string): Time => {
  if (value.includes("T")) return Math.floor(new Date(value).getTime() / 1000) as Time;
  return value as Time;
};

const fromChartTimeKey = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value * 1000).toISOString().slice(0, 10);
  if (
    typeof value === "object" &&
    value !== null &&
    "year" in value &&
    "month" in value &&
    "day" in value
  ) {
    const businessDay = value as { year: number; month: number; day: number };
    return `${businessDay.year}-${String(businessDay.month).padStart(2, "0")}-${String(businessDay.day).padStart(2, "0")}`;
  }
  return null;
};

const formatOverlayLabel = (label: string): string => {
  switch (label) {
    case "week.min.region":
      return "최소거래량 구간";
    case "week.min.low":
      return "최소거래량 저가";
    case "week.min.high":
      return "최소거래량 고가";
    case "week.projected.zone":
      return "주봉 zone 투영";
    case "week.zone.high":
      return "주봉 zone 상단";
    case "week.zone.low":
      return "주봉 zone 하단";
    default:
      return label;
  }
};

const toSeriesMarkers = (markers: WangStrategyMarker[]): SeriesMarker<Time>[] =>
  markers.map((marker) => ({
    time: toChartTime(marker.t),
    position: marker.position,
    shape: marker.shape,
    color: marker.color,
    text: marker.label,
  }));

const toLineData = (
  points: Array<{ time: string; value: number | null }>,
): Array<LineData<Time> | WhitespaceData<Time>> =>
  points.map((point) =>
    point.value == null ? { time: toChartTime(point.time) } : { time: toChartTime(point.time), value: point.value },
  );

export default function WangStrategyChart(props: WangStrategyChartProps) {
  const { candles, chartOverlays, markers, height = DEFAULT_CHART_HEIGHT, onSelectMarker } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedTimeRef = useRef<string | null>(null);
  const refreshOverlayRef = useRef<(() => void) | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);
  const [refRects, setRefRects] = useState<RefLineRect[]>([]);
  const [selectedX, setSelectedX] = useState<number | null>(null);

  useEffect(() => {
    const fallbackTime =
      chartOverlays.highlightTime ?? markers[markers.length - 1]?.t ?? candles[candles.length - 1]?.time ?? null;
    setSelectedTime(fallbackTime);
  }, [candles, chartOverlays.highlightTime, markers]);

  const selectedMarker = useMemo(
    () => markers.find((marker) => marker.t === selectedTime) ?? null,
    [markers, selectedTime],
  );

  useEffect(() => {
    onSelectMarker?.(selectedMarker);
  }, [onSelectMarker, selectedMarker]);

  useEffect(() => {
    selectedTimeRef.current = selectedTime;
    refreshOverlayRef.current?.();
  }, [selectedTime]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(7, 16, 27, 0.96)" },
        textColor: "#d9e6f4",
      },
      grid: {
        vertLines: { color: "rgba(87, 163, 255, 0.08)" },
        horzLines: { color: "rgba(87, 163, 255, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(87, 163, 255, 0.18)",
      },
      timeScale: {
        borderColor: "rgba(87, 163, 255, 0.18)",
      },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,0.28)" },
        horzLine: { color: "rgba(255,255,255,0.18)" },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00b386",
      downColor: "#ff5a76",
      wickUpColor: "#00b386",
      wickDownColor: "#ff5a76",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      scaleMargins: {
        top: 0.76,
        bottom: 0,
      },
      lastValueVisible: false,
      priceLineVisible: false,
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

    volumeSeries.setData(
      candles.map<HistogramData<Time>>((candle) => ({
        time: toChartTime(candle.time),
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(0, 179, 134, 0.60)" : "rgba(255, 90, 118, 0.55)",
      })),
    );

    chartOverlays.movingAverages.forEach((line) => {
      const series = chart.addLineSeries({
        color: line.color,
        lineWidth: line.lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(toLineData(line.points));
    });

    candleSeries.setMarkers(toSeriesMarkers(markers));
    chart.timeScale().fitContent();

    const updateOverlayLayout = () => {
      const timeScale = chart.timeScale();

      const nextZoneRects = chartOverlays.zones.flatMap((zone) => {
        const startX = timeScale.timeToCoordinate(toChartTime(zone.startTime));
        const endX = timeScale.timeToCoordinate(toChartTime(zone.endTime));
        const highY = candleSeries.priceToCoordinate(zone.high);
        const lowY = candleSeries.priceToCoordinate(zone.low);
        if (startX == null || endX == null || highY == null || lowY == null) return [];
        return [
          {
            id: zone.id,
            label: formatOverlayLabel(zone.label),
            left: Math.min(startX, endX),
            top: Math.min(highY, lowY),
            width: Math.max(Math.abs(endX - startX), 24),
            height: Math.max(Math.abs(lowY - highY), 8),
            color: zone.color,
          },
        ];
      });

      const nextRefRects = chartOverlays.refLevels.flatMap((line) => {
        const startX = timeScale.timeToCoordinate(toChartTime(line.startTime));
        const endX = timeScale.timeToCoordinate(toChartTime(line.endTime));
        const y = candleSeries.priceToCoordinate(line.price);
        if (startX == null || endX == null || y == null) return [];
        return [
          {
            id: line.id,
            label: formatOverlayLabel(line.label),
            left: Math.min(startX, endX),
            top: y,
            width: Math.max(Math.abs(endX - startX), 20),
            color: line.color,
            dashed: line.style === "dashed",
          },
        ];
      });

      const nextSelectedX =
        selectedTimeRef.current != null
          ? timeScale.timeToCoordinate(toChartTime(selectedTimeRef.current)) ?? null
          : null;

      setZoneRects(nextZoneRects);
      setRefRects(nextRefRects);
      setSelectedX(nextSelectedX);
    };

    refreshOverlayRef.current = updateOverlayLayout;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height });
      updateOverlayLayout();
    });

    resizeObserver.observe(container);

    chart.subscribeClick((param) => {
      const timeKey = fromChartTimeKey(param.time);
      if (!timeKey) return;
      setSelectedTime(timeKey);
    });

    chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlayLayout);
    updateOverlayLayout();

    return () => {
      refreshOverlayRef.current = null;
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateOverlayLayout);
      chart.remove();
    };
  }, [candles, chartOverlays, height, markers]);

  if (candles.length === 0) {
    return <p className="plan-note">해당 타임프레임 차트 데이터가 아직 부족합니다.</p>;
  }

  return (
    <div className="wang-chart-shell">
      <div className="wang-chart-stage">
        <div ref={containerRef} className="wang-chart-canvas" />
        <div className="wang-chart-overlay" aria-hidden="true">
          {zoneRects.map((rect) => (
            <div
              key={rect.id}
              className="wang-chart-zone"
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                borderColor: rect.color,
                background: rect.color,
              }}
            >
              <span>{rect.label}</span>
            </div>
          ))}
          {refRects.map((rect) => (
            <div
              key={rect.id}
              className={rect.dashed ? "wang-chart-ref dashed" : "wang-chart-ref"}
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                borderColor: rect.color,
              }}
            >
              <span>{rect.label}</span>
            </div>
          ))}
          {selectedX != null && <div className="wang-chart-selection" style={{ left: `${selectedX}px` }} />}
        </div>
      </div>
      <div className="wang-chart-legend">
        {chartOverlays.movingAverages.map((line) => (
          <span key={line.id} className="wang-legend-chip">
            <i className="wang-chart-legend-line" style={{ borderColor: line.color }} />
            {line.label}
          </span>
        ))}
        <span className="wang-legend-chip">
          <i className="wang-chart-legend-ref" />
          기준선
        </span>
        <span className="wang-chart-legend-zone">zone</span>
      </div>
    </div>
  );
}
