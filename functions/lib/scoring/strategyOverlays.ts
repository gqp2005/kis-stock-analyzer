import type {
  FlowSignal,
  OverlayMarkerType,
  SimpleStrategyOverlay,
  StrategyCards,
  StrategyOverlays,
  TimeframeAnalysis,
} from "../types";

export const emptyWashoutStrategy = (
  reason: string,
): { strategyCards: StrategyCards; strategyOverlays: StrategyOverlays } => ({
  strategyCards: {
    washoutPullback: {
      id: "washout_pullback_v1",
      displayName: "거래대금 설거지 + 눌림목 전략",
      detected: false,
      state: "NONE",
      score: 0,
      confidence: 0,
      anchorSpike: {
        date: null,
        priceHigh: null,
        priceClose: null,
        turnover: null,
        turnoverRatio: null,
      },
      washoutReentry: {
        date: null,
        price: null,
        turnoverRatio: null,
      },
      pullbackZone: {
        low: null,
        high: null,
      },
      entryPlan: {
        style: "분할매수",
        entries: [],
        invalidLow: null,
      },
      statusSummary: "일봉 기준 데이터가 부족해 전략 판단을 보류했습니다.",
      reasons: [reason],
      warnings: ["조건 미충족 시 전략 후보를 강제하지 않습니다."],
    },
  },
  strategyOverlays: {
    washoutPullback: {
      anchorSpike: {
        time: null,
        price: null,
        turnover: null,
        turnoverRatio: null,
        marker: null,
      },
      washoutReentry: {
        time: null,
        price: null,
        turnoverRatio: null,
        marker: null,
      },
      pullbackZone: {
        timeStart: null,
        timeEnd: null,
        low: null,
        high: null,
        label: "눌림목 존",
        strength: 0,
      },
      invalidLow: {
        price: null,
        label: "무효화",
        style: "dashed-bold",
      },
      entryPlan: {
        entries: [],
      },
    },
  },
});

export const defaultFlowSignal = (reason: string): FlowSignal => ({
  foreignNet: null,
  institutionNet: null,
  individualNet: null,
  programNet: null,
  foreignHoldRate: null,
  label: "N/A",
  reasons: [reason],
});

const toStrategyMarkerType = (label: string): OverlayMarkerType => {
  if (label.startsWith("DARVAS BRK")) return "DarvasBreakout";
  if (label.startsWith("DARVAS RT")) return "DarvasRetest";
  if (label.startsWith("NR7 BRK") || label.startsWith("NR7 DN")) return "NR7Breakout";
  if (label.startsWith("NR7")) return "NR7Setup";
  if (label.startsWith("TREND")) return "TrendTemplate";
  if (label.startsWith("RSI L1")) return "RsiDivLow1";
  if (label.startsWith("RSI L2")) return "RsiDivLow2";
  if (label.startsWith("RSI BRK")) return "RsiDivBreakout";
  if (label.startsWith("FLOW")) return "FlowPersistence";
  return "FlowPersistence";
};

export const appendStrategyOverlays = (
  overlays: TimeframeAnalysis["overlays"],
  strategyOverlays: StrategyOverlays,
): void => {
  const entries: Array<{
    key:
      | "darvasRetest"
      | "nr7InsideBar"
      | "trendTemplate"
      | "rsiDivergence"
      | "flowPersistence";
    overlay: SimpleStrategyOverlay | undefined;
  }> = [
    { key: "darvasRetest", overlay: strategyOverlays.darvasRetest },
    { key: "nr7InsideBar", overlay: strategyOverlays.nr7InsideBar },
    { key: "trendTemplate", overlay: strategyOverlays.trendTemplate },
    { key: "rsiDivergence", overlay: strategyOverlays.rsiDivergence },
    { key: "flowPersistence", overlay: strategyOverlays.flowPersistence },
  ];

  for (const entry of entries) {
    const overlay = entry.overlay;
    if (!overlay) continue;
    for (const line of overlay.lines) {
      if (line.price == null) continue;
      overlays.priceLines.push({
        id: `${entry.key}:${line.label}:${line.price}`,
        group: "level",
        price: line.price,
        label: line.label,
        color: line.color,
      });
    }
    for (const marker of overlay.markers) {
      if (!marker.time || marker.price == null) continue;
      overlays.markers.push({
        id: `${entry.key}:${marker.label}:${marker.time}`,
        t: marker.time,
        type: toStrategyMarkerType(marker.label),
        label: marker.label,
        desc: marker.label,
        position: marker.shape === "arrowUp" ? "belowBar" : "aboveBar",
        shape: marker.shape,
        text: marker.label.replace(/\s+/g, ""),
        color: marker.color,
      });
    }
  }
};
