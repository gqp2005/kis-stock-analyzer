import type {
  LineData,
  SeriesMarker,
  Time,
  WhitespaceData,
} from "lightweight-charts";
import type {
  IndicatorPoint,
  OverlayMarker,
  OverlayMarkerType,
  TimeframeAnalysis,
} from "../types";

export const CHART_THEME = {
  background: "#fbfdff",
  textColor: "#5f7890",
  gridColor: "#d9e4ee",
  borderColor: "#c7d7e6",
};

export const BASIC_PATTERN_TYPES = new Set<OverlayMarkerType>([
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

export const STRATEGY_MARKER_TYPES = new Set<OverlayMarkerType>([
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

export const STRATEGY_OVERLAY_ID_PREFIXES = [
  "darvasRetest:",
  "nr7InsideBar:",
  "trendTemplate:",
  "rsiDivergence:",
  "flowPersistence:",
];

export const isVcpMarkerType = (type: OverlayMarkerType): boolean =>
  type === "VCPPeak" || type === "VCPTrough" || type === "VCPBreakout";

export const isStrategyMarkerType = (type: OverlayMarkerType): boolean =>
  STRATEGY_MARKER_TYPES.has(type);

export const canShowMarkerByType = (
  type: OverlayMarkerType,
  showAdvanced: boolean,
): boolean => isVcpMarkerType(type) || showAdvanced || BASIC_PATTERN_TYPES.has(type);

export const canShowMainChartMarkerByType = (
  type: OverlayMarkerType,
  showAdvanced: boolean,
): boolean => !isStrategyMarkerType(type) && canShowMarkerByType(type, showAdvanced);

export const filterCommonOverlayPriceLines = (
  lines: TimeframeAnalysis["overlays"]["priceLines"] | undefined,
) =>
  (lines ?? []).filter(
    (line) => !STRATEGY_OVERLAY_ID_PREFIXES.some((prefix) => line.id.startsWith(prefix)),
  );

export const filterCommonOverlayMarkers = (
  markers: TimeframeAnalysis["overlays"]["markers"] | undefined,
) => (markers ?? []).filter((marker) => !isStrategyMarkerType(marker.type));

export const toChartTime = (value: string): Time => {
  if (value.includes("T")) {
    return Math.floor(new Date(value).getTime() / 1000) as Time;
  }
  return value as Time;
};

export const toPatternTimeKey = (value: string): string =>
  value.includes("T") ? value.slice(0, 16) : value;

export const fromChartTimeKey = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return toPatternTimeKey(value);
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
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

export const findCandleIndexByPatternTime = (
  candles: Array<{ time: string }>,
  patternTime: string,
): number => {
  const selectedKey = toPatternTimeKey(patternTime);
  return candles.findIndex((candle) => {
    const candleKey = toPatternTimeKey(candle.time);
    return candleKey === selectedKey || candle.time.startsWith(`${selectedKey}T`);
  });
};

export const toLineData = (
  points: IndicatorPoint[],
): Array<LineData<Time> | WhitespaceData<Time>> =>
  points.map((point) =>
    point.value == null
      ? { time: toChartTime(point.time) }
      : { time: toChartTime(point.time), value: point.value },
  );

export const findLastIndicatorPoint = (points: IndicatorPoint[]): IndicatorPoint | null => {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].value != null) return points[i];
  }
  return null;
};

export const toOverlayMarkers = (markers: OverlayMarker[]): SeriesMarker<Time>[] =>
  markers.map((marker) => ({
    time: toChartTime(marker.t),
    position: marker.position,
    shape: marker.shape,
    color: marker.color,
    text: marker.text,
  })) as SeriesMarker<Time>[];

export type LevelGuideItem = {
  id: string;
  label: string;
  price: number;
  meaning: string;
};

export type PriceClusterItem = {
  id: string;
  label: string;
  price: number;
  meaning?: string;
  color?: string;
  group?: string;
};

export const levelMeaningText = (label: string): string => {
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
  if (label.includes("지지"))
    return "가격이 반등하기 쉬운 지지 후보선입니다. 이탈 여부를 리스크 기준으로 사용합니다.";
  if (label.includes("저항"))
    return "가격이 막히기 쉬운 저항 후보선입니다. 돌파 후 안착 여부를 함께 확인합니다.";
  return "차트 해석을 위한 참고 레벨입니다. 단일 선보다 거래량/추세와 함께 판단하는 것이 안전합니다.";
};

export const pickNearestPriceItems = <T extends { price: number; label: string }>(
  items: T[],
  referencePrice: number | null,
  limit: number,
): T[] => {
  if (referencePrice == null || items.length <= limit) return items;
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = `${item.label}:${Math.round(item.price * 100) / 100}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()]
    .sort((a, b) => Math.abs(a.price - referencePrice) - Math.abs(b.price - referencePrice))
    .slice(0, limit)
    .sort((a, b) => b.price - a.price);
};

export const clusterPriceItems = <T extends PriceClusterItem>(
  items: T[],
  toleranceRatio: number,
): T[] => {
  if (items.length <= 1 || toleranceRatio <= 0) return items;
  const sorted = [...items].sort((a, b) => b.price - a.price);
  const result: T[] = [];
  let bucket: T[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    if (bucket.length === 1) {
      result.push(bucket[0]);
      bucket = [];
      return;
    }
    const avgPrice = bucket.reduce((sum, item) => sum + item.price, 0) / bucket.length;
    const first = bucket[0];
    const mergedMeaning = bucket
      .map((item) => item.meaning)
      .filter((item): item is string => Boolean(item))
      .slice(0, 2)
      .join(" · ");
    result.push({
      ...first,
      price: avgPrice,
      label: `${first.label} 외 ${bucket.length - 1}`,
      meaning:
        mergedMeaning ||
        bucket
          .map((item) => item.label)
          .slice(0, 2)
          .join(" · "),
    });
    bucket = [];
  };

  for (const item of sorted) {
    if (bucket.length === 0) {
      bucket.push(item);
      continue;
    }
    const anchor = bucket[0].price;
    const diffRatio = Math.abs(item.price - anchor) / Math.max(Math.abs(anchor), 1);
    if (diffRatio <= toleranceRatio) {
      bucket.push(item);
    } else {
      flush();
      bucket.push(item);
    }
  }
  flush();
  return result;
};
