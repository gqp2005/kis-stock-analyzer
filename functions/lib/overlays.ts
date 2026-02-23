import type {
  Candle,
  ConfluenceBand,
  IndicatorLevels,
  Overlays,
  OverlayMarker,
  OverlaySegment,
  Signals,
  Timeframe,
  VolumePatternType,
} from "./types";
import { clamp, round2 } from "./utils";

interface PivotPoint {
  index: number;
  time: string;
  price: number;
}

interface ZoneCandidate {
  id: string;
  kind: "support" | "resistance";
  low: number;
  high: number;
  center: number;
  touches: number;
  reason: string;
}

interface LineModel {
  slope: number;
  intercept: number;
  r2: number;
  points: PivotPoint[];
}

interface ConfluenceCandidate {
  price: number;
  weight: number;
  reason: string;
}

const PIVOT_L = 3;
const LEVEL_CLUSTER_PCT = 0.025; // +-2.5%

const MARKER_STYLE: Record<
  VolumePatternType,
  { position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square"; text: string; color: string }
> = {
  BreakoutConfirmed: { position: "aboveBar", shape: "arrowUp", text: "BRK", color: "#00b386" },
  Upthrust: { position: "aboveBar", shape: "arrowDown", text: "TRAP", color: "#ff5a76" },
  PullbackReaccumulation: { position: "belowBar", shape: "arrowUp", text: "PB", color: "#57a3ff" },
  ClimaxUp: { position: "aboveBar", shape: "square", text: "HOT", color: "#ff9f43" },
  CapitulationAbsorption: { position: "belowBar", shape: "circle", text: "CAP", color: "#00d2d3" },
  WeakBounce: { position: "aboveBar", shape: "circle", text: "WB", color: "#c792ea" },
};

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const detectPivots = (
  candles: Candle[],
  kind: "high" | "low",
  l = PIVOT_L,
  lookback = 120,
): PivotPoint[] => {
  if (candles.length < l * 2 + 1) return [];
  const start = Math.max(l, candles.length - lookback);
  const pivots: PivotPoint[] = [];

  for (let i = start; i < candles.length - l; i += 1) {
    const price = kind === "high" ? candles[i].high : candles[i].low;
    let valid = true;
    for (let j = i - l; j <= i + l; j += 1) {
      if (j === i) continue;
      const compare = kind === "high" ? candles[j].high : candles[j].low;
      if (kind === "high" && compare >= price) {
        valid = false;
        break;
      }
      if (kind === "low" && compare <= price) {
        valid = false;
        break;
      }
    }
    if (valid) {
      pivots.push({
        index: i,
        time: candles[i].time,
        price,
      });
    }
  }

  return pivots;
};

const clusterPivotPrices = (pivots: PivotPoint[], tolerancePct = LEVEL_CLUSTER_PCT) => {
  const clusters: Array<{ center: number; min: number; max: number; touches: number; prices: number[] }> = [];
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  for (const pivot of sorted) {
    const cluster = clusters.find(
      (item) => Math.abs(pivot.price - item.center) / Math.max(1, item.center) <= tolerancePct,
    );
    if (!cluster) {
      clusters.push({
        center: pivot.price,
        min: pivot.price,
        max: pivot.price,
        touches: 1,
        prices: [pivot.price],
      });
    } else {
      cluster.prices.push(pivot.price);
      cluster.touches += 1;
      cluster.min = Math.min(cluster.min, pivot.price);
      cluster.max = Math.max(cluster.max, pivot.price);
      cluster.center = average(cluster.prices);
    }
  }
  return clusters;
};

const pickZoneCandidates = (
  candles: Candle[],
  levels: IndicatorLevels,
): { support: ZoneCandidate; resistance: ZoneCandidate } => {
  const close = candles[candles.length - 1].close;
  const lowPivots = detectPivots(candles, "low", PIVOT_L, 120);
  const highPivots = detectPivots(candles, "high", PIVOT_L, 120);
  const lowClusters = clusterPivotPrices(lowPivots);
  const highClusters = clusterPivotPrices(highPivots);

  const supportCluster =
    [...lowClusters]
      .filter((cluster) => cluster.center <= close)
      .sort((a, b) => b.center - a.center)[0] ?? lowClusters.sort((a, b) => b.center - a.center)[0];
  const resistanceCluster =
    [...highClusters]
      .filter((cluster) => cluster.center >= close)
      .sort((a, b) => a.center - b.center)[0] ?? highClusters.sort((a, b) => a.center - b.center)[0];

  const supportCenter = supportCluster?.center ?? levels.support ?? close * 0.99;
  const resistanceCenter = resistanceCluster?.center ?? levels.resistance ?? close * 1.01;

  const supportPad = Math.max(supportCenter * 0.004, 1);
  const resistancePad = Math.max(resistanceCenter * 0.004, 1);
  const supportLow = supportCluster?.min ?? supportCenter - supportPad;
  const supportHigh = supportCluster?.max ?? supportCenter + supportPad;
  const resistanceLow = resistanceCluster?.min ?? resistanceCenter - resistancePad;
  const resistanceHigh = resistanceCluster?.max ?? resistanceCenter + resistancePad;

  return {
    support: {
      id: "zone-support",
      kind: "support",
      low: Math.min(supportLow, supportHigh),
      high: Math.max(supportLow, supportHigh),
      center: supportCenter,
      touches: supportCluster?.touches ?? 1,
      reason: supportCluster
        ? `최근 스윙 저점 ${supportCluster.touches}회 클러스터`
        : "스윙 데이터 부족으로 기본 지지 레벨 사용",
    },
    resistance: {
      id: "zone-resistance",
      kind: "resistance",
      low: Math.min(resistanceLow, resistanceHigh),
      high: Math.max(resistanceLow, resistanceHigh),
      center: resistanceCenter,
      touches: resistanceCluster?.touches ?? 1,
      reason: resistanceCluster
        ? `최근 스윙 고점 ${resistanceCluster.touches}회 클러스터`
        : "스윙 데이터 부족으로 기본 저항 레벨 사용",
    },
  };
};

const linearRegression = (points: PivotPoint[]): LineModel | null => {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.index);
  const ys = points.map((point) => point.price);
  const xMean = average(xs);
  const yMean = average(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < points.length; i += 1) {
    numerator += (xs[i] - xMean) * (ys[i] - yMean);
    denominator += (xs[i] - xMean) ** 2;
  }
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const predicted = xs.map((x) => slope * x + intercept);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < ys.length; i += 1) {
    ssRes += (ys[i] - predicted[i]) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : clamp(1 - ssRes / ssTot, 0, 1);
  return { slope, intercept, r2, points };
};

const bestLineFromPivots = (
  pivots: PivotPoint[],
  expected: "up" | "down",
): LineModel | null => {
  if (pivots.length < 2) return null;
  const recent = pivots.slice(-6);
  const candidates: PivotPoint[][] = [];
  if (recent.length >= 3) candidates.push(recent.slice(-3));
  candidates.push(recent.slice(-2));
  candidates.push([recent[0], recent[recent.length - 1]]);

  let best: LineModel | null = null;
  for (const points of candidates) {
    const line = linearRegression(points);
    if (!line) continue;
    const slopeOk = expected === "up" ? line.slope > 0 : line.slope < 0;
    const score = line.r2 + (slopeOk ? 0.3 : 0);
    const bestScore =
      best == null
        ? -1
        : best.r2 + ((expected === "up" ? best.slope > 0 : best.slope < 0) ? 0.3 : 0);
    if (score > bestScore) best = line;
  }
  return best;
};

const makeSegmentFromLine = (
  id: string,
  kind: OverlaySegment["kind"],
  label: string,
  line: LineModel,
  lastIndex: number,
  lastTime: string,
): OverlaySegment => {
  const first = line.points[0];
  const p1 = line.slope * first.index + line.intercept;
  const p2 = line.slope * lastIndex + line.intercept;
  return {
    id,
    kind,
    t1: first.time,
    p1: round2(p1) ?? p1,
    t2: lastTime,
    p2: round2(p2) ?? p2,
    label,
    score: Math.round(line.r2 * 100),
  };
};

const buildTrendAndChannelSegments = (
  candles: Candle[],
): {
  trendSegments: OverlaySegment[];
  channelSegments: OverlaySegment[];
  trendExplanation: string;
  channelExplanation: string;
} => {
  const lowPivots = detectPivots(candles, "low", PIVOT_L, 120);
  const highPivots = detectPivots(candles, "high", PIVOT_L, 120);
  const upLine = bestLineFromPivots(lowPivots, "up");
  const downLine = bestLineFromPivots(highPivots, "down");

  const lastIndex = candles.length - 1;
  const lastTime = candles[lastIndex].time;
  const trendSegments: OverlaySegment[] = [];
  const channelSegments: OverlaySegment[] = [];

  if (upLine) {
    trendSegments.push(
      makeSegmentFromLine("trend-up", "trendlineUp", "상승 추세선", upLine, lastIndex, lastTime),
    );
  }
  if (downLine) {
    trendSegments.push(
      makeSegmentFromLine("trend-down", "trendlineDown", "하락 추세선", downLine, lastIndex, lastTime),
    );
  }

  if (trendSegments.length === 0) {
    const first = candles[Math.max(0, candles.length - 120)];
    const last = candles[lastIndex];
    const kind = last.close >= first.close ? "trendlineUp" : "trendlineDown";
    trendSegments.push({
      id: "trend-fallback",
      kind,
      t1: first.time,
      p1: round2(first.close) ?? first.close,
      t2: last.time,
      p2: round2(last.close) ?? last.close,
      label: "기본 추세선",
      score: 25,
    });
  }

  const recentRange = average(candles.slice(-30).map((candle) => candle.high - candle.low));
  if (upLine) {
    const distances = highPivots
      .map((pivot) => pivot.price - (upLine.slope * pivot.index + upLine.intercept))
      .filter((distance) => distance > 0);
    const offset = Math.max(average(distances), recentRange * 0.8, candles[lastIndex].close * 0.006);
    const highChannelLine: LineModel = {
      slope: upLine.slope,
      intercept: upLine.intercept + offset,
      r2: upLine.r2,
      points: upLine.points,
    };
    channelSegments.push(
      makeSegmentFromLine("channel-low", "channelLow", "상승 채널 하단", upLine, lastIndex, lastTime),
    );
    channelSegments.push(
      makeSegmentFromLine(
        "channel-high",
        "channelHigh",
        "상승 채널 상단",
        highChannelLine,
        lastIndex,
        lastTime,
      ),
    );
  } else if (downLine) {
    const distances = lowPivots
      .map((pivot) => downLine.slope * pivot.index + downLine.intercept - pivot.price)
      .filter((distance) => distance > 0);
    const offset = Math.max(average(distances), recentRange * 0.8, candles[lastIndex].close * 0.006);
    const lowChannelLine: LineModel = {
      slope: downLine.slope,
      intercept: downLine.intercept - offset,
      r2: downLine.r2,
      points: downLine.points,
    };
    channelSegments.push(
      makeSegmentFromLine(
        "channel-high",
        "channelHigh",
        "하락 채널 상단",
        downLine,
        lastIndex,
        lastTime,
      ),
    );
    channelSegments.push(
      makeSegmentFromLine(
        "channel-low",
        "channelLow",
        "하락 채널 하단",
        lowChannelLine,
        lastIndex,
        lastTime,
      ),
    );
  }

  return {
    trendSegments,
    channelSegments,
    trendExplanation:
      trendSegments[0].id === "trend-fallback"
        ? "유효한 스윙 포인트가 부족해 기본 추세선을 사용했습니다."
        : `스윙 고저점 기반 추세선 ${trendSegments.length}개를 추정했습니다.`,
    channelExplanation:
      channelSegments.length > 0
        ? "추세선과 반대편 스윙 거리 평균으로 평행 채널을 구성했습니다."
        : "채널 추정에 필요한 스윙 데이터가 부족했습니다.",
  };
};

const buildVolumeMarkers = (signals: Signals): OverlayMarker[] =>
  signals.volumePatterns.map((pattern) => {
    const style = MARKER_STYLE[pattern.type];
    return {
      id: `marker-${pattern.type}-${pattern.t}`,
      t: pattern.t,
      type: pattern.type,
      label: pattern.label,
      desc: pattern.desc,
      position: style.position,
      shape: style.shape,
      text: style.text,
      color: style.color,
      strength: pattern.strength,
    };
  });

const buildVcpContractionMarkers = (signals: Signals): OverlayMarker[] => {
  if (!signals.vcp.detected || signals.vcp.contractions.length === 0) return [];

  const recentContractions = signals.vcp.contractions.slice(-4);
  const contractionMarkers = recentContractions.flatMap((contraction, index) => {
    const order = index + 1;
    return [
      {
        id: `marker-vcp-peak-${contraction.peakTime}-${order}`,
        t: contraction.peakTime,
        type: "VCPPeak",
        label: `VCP 고점 ${order}`,
        desc: `컨트랙션 ${order} 고점 (${(contraction.depth * 100).toFixed(1)}%)`,
        position: "aboveBar",
        shape: "circle",
        text: `VH${order}`,
        color: "#f6c75f",
        strength: clamp(Math.round((0.2 - contraction.depth) * 400), 20, 90),
      },
      {
        id: `marker-vcp-trough-${contraction.troughTime}-${order}`,
        t: contraction.troughTime,
        type: "VCPTrough",
        label: `VCP 저점 ${order}`,
        desc: `컨트랙션 ${order} 저점`,
        position: "belowBar",
        shape: "circle",
        text: `VL${order}`,
        color: "#7ed0ff",
        strength: clamp(Math.round((0.2 - contraction.depth) * 350), 20, 80),
      },
    ];
  });

  if (signals.vcp.breakout.confirmed && signals.vcp.breakDate) {
    contractionMarkers.push({
      id: `marker-vcp-breakout-${signals.vcp.breakDate}`,
      t: signals.vcp.breakDate,
      type: "VCPBreakout",
      label: "VCP 돌파",
      desc: "VCP CONFIRMED (close>R && volRatio>=1.5)",
      position: "aboveBar",
      shape: "arrowUp",
      text: "BRK",
      color: "#00b386",
      strength: 92,
    });
  }

  return contractionMarkers;
};

const buildConfluenceBands = (
  candles: Candle[],
  levels: IndicatorLevels,
  zones: ZoneCandidate[],
  segments: OverlaySegment[],
  signals: Signals,
): ConfluenceBand[] => {
  const latest = candles[candles.length - 1];
  const latestClose = latest.close;
  const lookback = candles.slice(-120);
  const recentHigh = Math.max(...lookback.map((candle) => candle.high));
  const recentLow = Math.min(...lookback.map((candle) => candle.low));

  const fibLevels = [0.382, 0.5, 0.618].map((ratio) => recentLow + (recentHigh - recentLow) * ratio);

  const candidates: ConfluenceCandidate[] = [];
  for (const zone of zones) {
    candidates.push({ price: zone.low, weight: 2.8, reason: `${zone.kind === "support" ? "지지" : "저항"}존 하단` });
    candidates.push({ price: zone.high, weight: 2.8, reason: `${zone.kind === "support" ? "지지" : "저항"}존 상단` });
    candidates.push({ price: zone.center, weight: 2.5, reason: `${zone.kind === "support" ? "지지" : "저항"}존 중심` });
  }

  const levelCandidates: Array<[number | null, string, number]> = [
    [levels.support, "핵심 지지 레벨", 2.2],
    [levels.resistance, "핵심 저항 레벨", 2.2],
    [levels.maFast, "단기 MA", 1.3],
    [levels.maMid, "중기 MA", 1.5],
    [levels.maLong, "장기 MA", 1.1],
  ];
  for (const [value, reason, weight] of levelCandidates) {
    if (value != null) candidates.push({ price: value, weight, reason });
  }
  fibLevels.forEach((fib, idx) => {
    candidates.push({
      price: fib,
      weight: 1.4,
      reason: `피보나치 ${[38.2, 50, 61.8][idx]}%`,
    });
  });

  for (const segment of segments) {
    candidates.push({
      price: segment.p2,
      weight: segment.kind.startsWith("channel") ? 1.8 : 2.1,
      reason: segment.label,
    });
  }

  for (const pattern of signals.volumePatterns.slice(-30)) {
    const refLevel = pattern.details?.refLevel ?? null;
    if (refLevel != null && Number.isFinite(refLevel)) {
      candidates.push({
        price: refLevel,
        weight: 2.4,
        reason: `${pattern.label} 기준가`,
      });
    }
  }
  if (signals.vcp.detected && signals.vcp.resistance.price != null) {
    candidates.push({
      price: signals.vcp.resistance.price,
      weight: 2.2,
      reason: "VCP 저항 R",
    });
  }

  const tolerancePct = 0.008; // +-0.8%
  const bands: Array<{
    center: number;
    min: number;
    max: number;
    totalWeight: number;
    count: number;
    reasons: string[];
  }> = [];
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  for (const candidate of sorted) {
    const band = bands.find(
      (item) =>
        Math.abs(candidate.price - item.center) / Math.max(1, item.center) <= tolerancePct,
    );
    if (!band) {
      bands.push({
        center: candidate.price,
        min: candidate.price,
        max: candidate.price,
        totalWeight: candidate.weight,
        count: 1,
        reasons: [candidate.reason],
      });
    } else {
      band.center =
        (band.center * band.totalWeight + candidate.price * candidate.weight) /
        (band.totalWeight + candidate.weight);
      band.min = Math.min(band.min, candidate.price);
      band.max = Math.max(band.max, candidate.price);
      band.totalWeight += candidate.weight;
      band.count += 1;
      if (!band.reasons.includes(candidate.reason)) band.reasons.push(candidate.reason);
    }
  }

  const result = bands
    .filter((band) => band.count >= 2)
    .map((band) => ({
      bandLow: round2(band.min) ?? band.min,
      bandHigh: round2(band.max) ?? band.max,
      strength: clamp(Math.round(band.totalWeight * 8 + band.count * 6), 0, 100),
      reasons: band.reasons.slice(0, 6),
      distance: Math.abs(band.center - latestClose) / Math.max(1, latestClose),
    }))
    .sort((a, b) => b.strength - a.strength || a.distance - b.distance)
    .slice(0, 5)
    .map(({ distance: _distance, ...band }) => band);

  if (result.length > 0) return result;

  return zones.map((zone) => ({
    bandLow: round2(zone.low) ?? zone.low,
    bandHigh: round2(zone.high) ?? zone.high,
    strength: 30,
    reasons: [zone.reason],
  }));
};

const buildExplanations = (
  zones: ZoneCandidate[],
  trendSegments: OverlaySegment[],
  channelSegments: OverlaySegment[],
  markers: OverlayMarker[],
  confluence: ConfluenceBand[],
  signals: Signals,
): string[] => {
  const list: string[] = [];
  const support = zones.find((zone) => zone.kind === "support");
  const resistance = zones.find((zone) => zone.kind === "resistance");
  if (support) list.push(`지지존: ${support.reason}`);
  if (resistance) list.push(`저항존: ${resistance.reason}`);
  list.push(`추세선: 스윙 피벗 기반 ${trendSegments.length}개 추정`);
  if (channelSegments.length > 0) list.push(`채널: 평행 채널 ${Math.floor(channelSegments.length / 2)}세트 반영`);
  if (markers.length > 0) list.push(`거래량 패턴: 최근 ${markers.length}개 마커 반영`);
  if (confluence.length > 0) {
    list.push(
      `컨플루언스: 최강 구간 ${confluence[0].bandLow.toLocaleString("ko-KR")}~${confluence[0].bandHigh.toLocaleString("ko-KR")}`,
    );
  }
  if (signals.vcp.detected && signals.vcp.resistance.price != null) {
    list.push(
      `VCP: 저항 R ${Math.round(signals.vcp.resistance.price).toLocaleString("ko-KR")}원 · 컨트랙션 ${signals.vcp.contractions.length}회`,
    );
    if (signals.vcp.risk.invalidLow != null) {
      list.push(
        `VCP 무효화 기준 ${Math.round(signals.vcp.risk.invalidLow).toLocaleString("ko-KR")}원 · 리스크 ${signals.vcp.risk.riskGrade}`,
      );
    }
  }
  if (signals.vcp.breakout.confirmed) {
    list.push(`VCP CONFIRMED 조건: ${signals.vcp.breakout.rule}`);
  }
  return list.slice(0, 6);
};

export const buildMultiViewArtifacts = (
  tf: Timeframe,
  candles: Candle[],
  levels: IndicatorLevels,
  signals: Signals,
): {
  overlays: Overlays;
  confluence: ConfluenceBand[];
  explanations: string[];
} => {
  if (candles.length === 0) {
    return {
      overlays: { priceLines: [], zones: [], segments: [], markers: [] },
      confluence: [],
      explanations: ["캔들 데이터가 부족해 오버레이를 생성하지 못했습니다."],
    };
  }

  const zones = pickZoneCandidates(candles, levels);
  const zoneItems = [zones.support, zones.resistance];
  const { trendSegments, channelSegments } = buildTrendAndChannelSegments(candles);
  const markers = [...buildVolumeMarkers(signals), ...buildVcpContractionMarkers(signals)];

  const overlays: Overlays = {
    priceLines: [
      {
        id: "level-support",
        group: "level",
        price: round2(levels.support ?? zones.support.center) ?? zones.support.center,
        label: "지지 레벨",
        color: "#00b386",
      },
      {
        id: "level-resistance",
        group: "level",
        price: round2(levels.resistance ?? zones.resistance.center) ?? zones.resistance.center,
        label: "저항 레벨",
        color: "#ff5a76",
      },
      ...(signals.vcp.detected && signals.vcp.resistance.price != null
        ? [
            {
              id: "level-vcp-resistance",
              group: "level" as const,
              price: round2(signals.vcp.resistance.price) ?? signals.vcp.resistance.price,
              label: "VCP 저항R",
              color: "#f6c75f",
            },
            ...(signals.vcp.resistance.zoneLow != null
              ? [
                  {
                    id: "zone-vcp-r-low",
                    group: "zone" as const,
                    price: round2(signals.vcp.resistance.zoneLow) ?? signals.vcp.resistance.zoneLow,
                    label: "VCP R-zone 하단",
                    color: "rgba(246,199,95,0.8)",
                  },
                ]
              : []),
            ...(signals.vcp.resistance.zoneHigh != null
              ? [
                  {
                    id: "zone-vcp-r-high",
                    group: "zone" as const,
                    price: round2(signals.vcp.resistance.zoneHigh) ?? signals.vcp.resistance.zoneHigh,
                    label: "VCP R-zone 상단",
                    color: "rgba(246,199,95,0.8)",
                  },
                ]
              : []),
            ...(signals.vcp.risk.invalidLow != null
              ? [
                  {
                    id: "level-vcp-invalid-low",
                    group: "level" as const,
                    price: round2(signals.vcp.risk.invalidLow) ?? signals.vcp.risk.invalidLow,
                    label: "VCP 무효화",
                    color: "rgba(255,132,132,0.9)",
                  },
                ]
              : []),
          ]
        : []),
      ...zoneItems.flatMap((zone) => [
        {
          id: `${zone.id}-low`,
          group: "zone" as const,
          price: round2(zone.low) ?? zone.low,
          label: `${zone.kind === "support" ? "지지존" : "저항존"} 하단`,
          color: zone.kind === "support" ? "rgba(0,179,134,0.75)" : "rgba(255,90,118,0.75)",
        },
        {
          id: `${zone.id}-high`,
          group: "zone" as const,
          price: round2(zone.high) ?? zone.high,
          label: `${zone.kind === "support" ? "지지존" : "저항존"} 상단`,
          color: zone.kind === "support" ? "rgba(0,179,134,0.75)" : "rgba(255,90,118,0.75)",
        },
      ]),
    ],
    zones: zoneItems.map((zone) => ({
      id: zone.id,
      kind: zone.kind,
      low: round2(zone.low) ?? zone.low,
      high: round2(zone.high) ?? zone.high,
      strength: clamp(Math.round(zone.touches * 15), 20, 95),
      touches: zone.touches,
      reason: zone.reason,
    })),
    segments: [...trendSegments, ...channelSegments].map((segment) => ({
      ...segment,
      p1: round2(segment.p1) ?? segment.p1,
      p2: round2(segment.p2) ?? segment.p2,
    })),
    markers,
  };

  const confluence = buildConfluenceBands(candles, levels, zoneItems, overlays.segments, signals);
  const explanations = buildExplanations(
    zoneItems,
    trendSegments,
    channelSegments,
    markers,
    confluence,
    signals,
  );
  if (tf !== "day") {
    explanations.unshift(`${tf} 타임프레임에서도 동일한 관점 모듈로 오버레이를 계산했습니다.`);
  }

  return { overlays, confluence, explanations };
};
