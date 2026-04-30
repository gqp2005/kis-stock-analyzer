import { useEffect, type MutableRefObject } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type LogicalRange,
} from "lightweight-charts";
import type {
  MultiAnalysisResponse,
  Timeframe,
  VolumePatternSignal,
} from "../types";
import {
  BASIC_PATTERN_TYPES,
  CHART_THEME,
  canShowMainChartMarkerByType,
  clusterPriceItems,
  filterCommonOverlayMarkers,
  filterCommonOverlayPriceLines,
  findCandleIndexByPatternTime,
  findLastIndicatorPoint,
  fromChartTimeKey,
  levelMeaningText,
  pickNearestPriceItems,
  toChartTime,
  toLineData,
  toOverlayMarkers,
  toPatternTimeKey,
} from "./chartHelpers";

interface UseAnalysisChartOptions {
  priceChartRef: MutableRefObject<HTMLDivElement | null>;
  rsiChartRef: MutableRefObject<HTMLDivElement | null>;
  result: MultiAnalysisResponse | null;
  activeTf: Timeframe;
  priceChartHeight: number;
  showMa1: boolean;
  showMa2: boolean;
  showMa3: boolean;
  showLevels: boolean;
  effectiveShowTrendlines: boolean;
  effectiveShowChannels: boolean;
  effectiveShowFanLines: boolean;
  effectiveShowZones: boolean;
  showMarkers: boolean;
  effectiveShowAdvancedPatternMarkers: boolean;
  showPatternReferenceLevel: boolean;
  highlightSelectedCandle: boolean;
  shouldCondenseOverlays: boolean;
  compactLabelMode: boolean;
  showWashoutEntries: boolean;
  selectedPattern: VolumePatternSignal | null;
  onSelectPattern: (pattern: VolumePatternSignal) => void;
}

export function useAnalysisChart(options: UseAnalysisChartOptions) {
  const {
    priceChartRef,
    rsiChartRef,
    result,
    activeTf,
    priceChartHeight,
    showMa1,
    showMa2,
    showMa3,
    showLevels,
    effectiveShowTrendlines,
    effectiveShowChannels,
    effectiveShowFanLines,
    effectiveShowZones,
    showMarkers,
    effectiveShowAdvancedPatternMarkers,
    showPatternReferenceLevel,
    highlightSelectedCandle,
    shouldCondenseOverlays,
    compactLabelMode,
    showWashoutEntries,
    selectedPattern,
    onSelectPattern,
  } = options;

  useEffect(() => {
    if (!priceChartRef.current || !result) return;
    const active = result.timeframes[activeTf];
    if (!active || active.candles.length === 0) return;

    const mainContainer = priceChartRef.current;
    const mainChart = createChart(mainContainer, {
      width: mainContainer.clientWidth,
      height: priceChartHeight,
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
          color: "#d58b3d",
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
          color: "#db6e5c",
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
            (pattern) => effectiveShowAdvancedPatternMarkers || BASIC_PATTERN_TYPES.has(pattern.type),
          )
        : [];
    const commonOverlayMarkers = filterCommonOverlayMarkers(active.overlays?.markers);
    const overlayMarkers =
      activeTf === "day"
        ? commonOverlayMarkers.filter((marker) =>
            canShowMainChartMarkerByType(marker.type, effectiveShowAdvancedPatternMarkers),
          )
        : [];

    if (showMarkers && activeTf === "day") {
      candleSeries.setMarkers(toOverlayMarkers(overlayMarkers));
    } else {
      candleSeries.setMarkers([]);
    }

    const latestChartClose = active.candles.length > 0 ? active.candles[active.candles.length - 1].close : null;
    const commonOverlayPriceLines = filterCommonOverlayPriceLines(active.overlays?.priceLines);
    const baseLevelLines = pickNearestPriceItems(
      commonOverlayPriceLines.filter((line) => line.group === "level"),
      compactLabelMode ? latestChartClose : null,
      compactLabelMode ? 8 : 12,
    );
    const levelLines = clusterPriceItems(
      baseLevelLines.map((line) => ({
        ...line,
        meaning: levelMeaningText(line.label),
      })),
      compactLabelMode ? 0.006 : 0,
    );
    const baseZoneLines = pickNearestPriceItems(
      commonOverlayPriceLines.filter((line) => line.group === "zone"),
      compactLabelMode ? latestChartClose : null,
      compactLabelMode ? 4 : 8,
    );
    const zoneLines = clusterPriceItems(
      baseZoneLines.map((line) => ({
        ...line,
        meaning: levelMeaningText(line.label),
      })),
      compactLabelMode ? 0.006 : 0,
    );
    if (showLevels) {
      for (const line of levelLines) {
        candleSeries.createPriceLine({
          price: line.price,
          color: line.color ?? "rgba(47, 122, 209, 0.82)",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.label,
        });
      }
    }
    if (effectiveShowZones) {
      for (const line of zoneLines) {
        candleSeries.createPriceLine({
          price: line.price,
          color: line.color ?? "rgba(106, 129, 152, 0.72)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: line.label,
        });
      }
    }

    const overlaySegments = active.overlays?.segments ?? [];
    const segmentVisible = overlaySegments.filter((segment) => {
      if (segment.kind === "trendlineUp" || segment.kind === "trendlineDown") return effectiveShowTrendlines;
      if (segment.kind === "channelLow" || segment.kind === "channelHigh") return effectiveShowChannels;
      if (segment.kind === "fanlineUp" || segment.kind === "fanlineDown") return effectiveShowFanLines;
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
                  ? "#d5862f"
                  : segment.kind === "fanlineUp"
                    ? "#5ea67f"
                    : "#d9738c";
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
        color: "rgba(213, 139, 61, 0.92)",
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
          color: "rgba(47, 122, 209, 0.18)",
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
        color: c.close >= c.open ? "rgba(11, 141, 101, 0.28)" : "rgba(196, 84, 110, 0.28)",
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
          onSelectPattern(matched);
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

      const rsiSeries = rsiChart.addLineSeries({
        color: "#1f9d74",
        lineWidth: 2,
      });
      rsiSeries.setData(toLineData(rsiPoints));
      rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(196, 84, 110, 0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "70",
      });
      rsiSeries.createPriceLine({
        price: 50,
        color: "rgba(106, 129, 152, 0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "50",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(47, 122, 209, 0.55)",
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
    priceChartRef,
    rsiChartRef,
    onSelectPattern,
    result,
    activeTf,
    showMa1,
    showMa2,
    showMa3,
    showLevels,
    effectiveShowTrendlines,
    effectiveShowChannels,
    effectiveShowFanLines,
    effectiveShowZones,
    showMarkers,
    effectiveShowAdvancedPatternMarkers,
    showPatternReferenceLevel,
    highlightSelectedCandle,
    shouldCondenseOverlays,
    compactLabelMode,
    showWashoutEntries,
    priceChartHeight,
    selectedPattern,
  ]);
}
