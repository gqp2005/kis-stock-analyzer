import { atr, sma } from "./indicators";
import type { Candle, PatternState, VcpContraction, VcpHit } from "./types";
import { clamp, round2 } from "./utils";

interface PivotPoint {
  index: number;
  time: string;
  price: number;
}

interface ResistanceCluster {
  center: number;
  min: number;
  max: number;
  touches: number;
}

const MIN_VCP_CANDLES = 200;
const PIVOT_L = 3;
const RESIST_LOOKBACK = 120;
const RESIST_CLUSTER_TOLERANCE = 0.025;

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toRounded = (value: number): number => round2(value) ?? value;
const toNullableRounded = (value: number | null): number | null => round2(value);

const defaultVcpHit = (reason: string): VcpHit => ({
  detected: false,
  state: "NONE",
  score: 0,
  resistanceR: null,
  distanceToR: null,
  breakDate: null,
  contractions: [],
  atrShrink: false,
  volumeDryUp: false,
  trendPass: false,
  atrPctMean20: null,
  atrPctMean120: null,
  reasons: [reason],
});

const detectPivots = (
  candles: Candle[],
  kind: "high" | "low",
  lookback: number,
  l = PIVOT_L,
): PivotPoint[] => {
  if (candles.length < l * 2 + 1) return [];

  const pivots: PivotPoint[] = [];
  const start = Math.max(l, candles.length - lookback);

  for (let i = start; i < candles.length - l; i += 1) {
    const price = kind === "high" ? candles[i].high : candles[i].low;
    let isPivot = true;
    for (let j = i - l; j <= i + l; j += 1) {
      if (j === i) continue;
      const compare = kind === "high" ? candles[j].high : candles[j].low;
      if (kind === "high" && compare >= price) {
        isPivot = false;
        break;
      }
      if (kind === "low" && compare <= price) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      pivots.push({
        index: i,
        time: candles[i].time,
        price,
      });
    }
  }

  return pivots;
};

const findLowestBetween = (
  candles: Candle[],
  startIdx: number,
  endIdx: number,
): { index: number; price: number; time: string } | null => {
  if (endIdx - startIdx < 2) return null;
  let minPrice = Number.POSITIVE_INFINITY;
  let minIdx = -1;
  for (let i = startIdx + 1; i < endIdx; i += 1) {
    if (candles[i].low < minPrice) {
      minPrice = candles[i].low;
      minIdx = i;
    }
  }
  if (minIdx < 0) return null;
  return {
    index: minIdx,
    price: minPrice,
    time: candles[minIdx].time,
  };
};

const clusterResistance = (
  pivotHighs: PivotPoint[],
  fallbackHigh: number,
  close: number,
): { resistanceR: number; touches: number } => {
  if (pivotHighs.length === 0) {
    return { resistanceR: fallbackHigh, touches: 1 };
  }

  const sorted = [...pivotHighs].sort((a, b) => a.price - b.price);
  const clusters: ResistanceCluster[] = [];
  for (const pivot of sorted) {
    const found = clusters.find(
      (cluster) =>
        Math.abs(pivot.price - cluster.center) / Math.max(1, cluster.center) <=
        RESIST_CLUSTER_TOLERANCE,
    );
    if (!found) {
      clusters.push({
        center: pivot.price,
        min: pivot.price,
        max: pivot.price,
        touches: 1,
      });
    } else {
      found.touches += 1;
      found.min = Math.min(found.min, pivot.price);
      found.max = Math.max(found.max, pivot.price);
      found.center = (found.center * (found.touches - 1) + pivot.price) / found.touches;
    }
  }

  const nearestAbove =
    [...clusters]
      .filter((cluster) => cluster.center >= close)
      .sort((a, b) => a.center - b.center)[0] ?? null;
  if (nearestAbove) {
    return { resistanceR: nearestAbove.center, touches: nearestAbove.touches };
  }

  const strongest = [...clusters].sort(
    (a, b) => b.touches - a.touches || b.center - a.center,
  )[0];
  return {
    resistanceR: strongest?.center ?? fallbackHigh,
    touches: strongest?.touches ?? 1,
  };
};

const findContractions = (candles: Candle[]): VcpContraction[] => {
  const peaks = detectPivots(candles, "high", 160, PIVOT_L);
  if (peaks.length < 2) return [];

  const raw: VcpContraction[] = [];
  for (let i = 0; i + 1 < peaks.length; i += 1) {
    const peak = peaks[i];
    const nextPeak = peaks[i + 1];
    if (nextPeak.index - peak.index < PIVOT_L + 1) continue;
    const trough = findLowestBetween(candles, peak.index, nextPeak.index);
    if (!trough) continue;
    const depth = peak.price > 0 ? (peak.price - trough.price) / peak.price : 0;
    if (!Number.isFinite(depth) || depth <= 0) continue;
    raw.push({
      peakTime: peak.time,
      troughTime: trough.time,
      peak: toRounded(peak.price),
      trough: toRounded(trough.price),
      depth: toRounded(depth),
    });
  }

  return raw.slice(-6);
};

const pickShrinkingContractions = (
  contractions: VcpContraction[],
): { selected: VcpContraction[]; depthShrinkOk: boolean } => {
  if (contractions.length < 2) {
    return { selected: contractions, depthShrinkOk: false };
  }

  let bestWindow: VcpContraction[] = contractions.slice(-2);
  let bestShrink = false;
  let bestScore = -1;

  for (let i = 0; i < contractions.length - 1; i += 1) {
    for (let size = 2; size <= 4; size += 1) {
      const window = contractions.slice(i, i + size);
      if (window.length < 2) continue;

      const d1 = window[0].depth;
      const d2 = window[1].depth;
      let shrink = d1 >= 0.12 && d2 <= d1 * 0.75;
      if (shrink && window.length >= 3) {
        shrink = window[2].depth <= d2 * 0.8;
      }

      const score = (shrink ? 200 : 0) + window.length * 10 + i;
      if (score > bestScore) {
        bestScore = score;
        bestWindow = window;
        bestShrink = shrink;
      }
    }
  }

  return { selected: bestWindow, depthShrinkOk: bestShrink };
};

export const detectVcpPattern = (candles: Candle[]): VcpHit => {
  if (candles.length < MIN_VCP_CANDLES) {
    return defaultVcpHit(`VCP 분석에 필요한 일봉 데이터가 부족합니다. (${candles.length}/${MIN_VCP_CANDLES})`);
  }

  const sample = candles.slice(-Math.max(260, MIN_VCP_CANDLES));
  const latest = sample[sample.length - 1];
  const closes = sample.map((candle) => candle.close);
  const volumes = sample.map((candle) => candle.volume);

  const ma50 = sma(closes, 50)[sample.length - 1];
  const ma150 = sma(closes, 150)[sample.length - 1];
  const high52w = Math.max(...sample.slice(-252).map((candle) => candle.high));
  const trendPass =
    ma50 != null &&
    ma150 != null &&
    latest.close > ma50 &&
    ma50 > ma150 &&
    latest.close >= high52w * 0.75;

  const high120 = Math.max(...sample.slice(-RESIST_LOOKBACK).map((candle) => candle.high));
  const pivotHighs = detectPivots(sample, "high", RESIST_LOOKBACK, PIVOT_L);
  const resistance = clusterResistance(pivotHighs, high120, latest.close);
  const resistanceR = resistance.resistanceR;
  const distanceToR = resistanceR > 0 ? (resistanceR - latest.close) / resistanceR : null;

  const allContractions = findContractions(sample);
  const contractionWindow = pickShrinkingContractions(allContractions);
  const contractions = contractionWindow.selected;
  const contractionCount = contractions.length;
  const depthShrinkOk = contractionWindow.depthShrinkOk;
  const lastDepth = contractionCount > 0 ? contractions[contractionCount - 1].depth : null;

  const atrSeries = atr(sample, 14);
  const atrPctSeries = sample.map((candle, index) => {
    const atrValue = atrSeries[index];
    if (atrValue == null || candle.close <= 0) return null;
    return atrValue / candle.close;
  });
  const atrPct20 = atrPctSeries.slice(-20).filter((value): value is number => value != null);
  const atrPct120 = atrPctSeries.slice(-120).filter((value): value is number => value != null);
  const atrPctMean20 = atrPct20.length > 0 ? average(atrPct20) : null;
  const atrPctMean120 = atrPct120.length > 0 ? average(atrPct120) : null;
  const atrShrink =
    atrPctMean20 != null &&
    atrPctMean120 != null &&
    atrPctMean120 > 0 &&
    atrPctMean20 <= atrPctMean120 * 0.75;

  const volMa20 = sma(volumes, 20);
  const volRatioSeries = sample.map((candle, index) => {
    const ma = volMa20[index];
    if (ma == null || ma <= 0) return 1;
    return candle.volume / ma;
  });
  const avgVol20 = average(volumes.slice(-20));
  const avgVol120 = average(volumes.slice(-120));
  const lowVolDays = volRatioSeries.slice(-10).filter((ratio) => ratio < 0.8).length;
  const volumeDryUp = avgVol20 <= avgVol120 * 0.7 || lowVolDays >= 6;

  const latestVolRatio = volRatioSeries[volRatioSeries.length - 1] ?? 1;
  const nearResistance =
    distanceToR != null && distanceToR >= 0 && distanceToR <= 0.08;
  const confirmedBreakout =
    resistanceR > 0 && latest.close > resistanceR && latestVolRatio >= 1.5;

  const detected =
    trendPass &&
    contractionCount >= 2 &&
    depthShrinkOk &&
    (nearResistance || confirmedBreakout);
  const state: PatternState = confirmedBreakout ? "CONFIRMED" : detected ? "POTENTIAL" : "NONE";

  let score = 0;
  if (trendPass) score += 20;
  if (distanceToR != null) {
    const absDistance = Math.abs(distanceToR);
    if (absDistance <= 0.03) score += 20;
    else if (absDistance <= 0.08) score += 15;
  }
  if (contractionCount >= 4) score += 35;
  else if (contractionCount === 3) score += 30;
  else if (contractionCount === 2) score += 20;
  if (depthShrinkOk) score += 15;
  if (lastDepth != null && lastDepth <= 0.08) score += 5;
  if (atrShrink) score += 10;
  if (volumeDryUp) score += 10;
  if (confirmedBreakout) score += 10;
  score = clamp(Math.round(score), 0, 100);

  const reasons: string[] = [];
  if (trendPass) {
    reasons.push(
      `추세 필터 충족(C>${toRounded(ma50 ?? 0)}, MA50>${toRounded(ma150 ?? 0)}, 52주고점 대비 ${toRounded((latest.close / high52w) * 100)}%).`,
    );
  } else {
    reasons.push("추세 필터 미충족으로 VCP 신호 신뢰가 낮습니다.");
  }

  if (resistanceR > 0 && distanceToR != null) {
    reasons.push(
      `저항 R=${Math.round(resistanceR).toLocaleString("ko-KR")}원, 거리 ${(distanceToR * 100).toFixed(2)}%.`,
    );
  } else {
    reasons.push("저항 R 산출 데이터가 부족합니다.");
  }

  if (contractionCount >= 2) {
    const depthText = contractions
      .map((item) => `${(item.depth * 100).toFixed(1)}%`)
      .join(" → ");
    reasons.push(`컨트랙션 ${contractionCount}회: ${depthText}`);
  } else {
    reasons.push("컨트랙션이 2회 미만이라 패턴이 불충분합니다.");
  }

  reasons.push(
    atrShrink
      ? `ATR 축소 확인(20평균 ${(atrPctMean20! * 100).toFixed(2)}% <= 120평균 ${(atrPctMean120! * 100).toFixed(2)}%의 75%).`
      : "ATR 축소 조건은 아직 충족되지 않았습니다.",
  );
  reasons.push(
    volumeDryUp
      ? `거래량 드라이업 확인(20일 평균 ${Math.round(avgVol20).toLocaleString("ko-KR")}주).`
      : "거래량 드라이업 조건이 약합니다.",
  );
  reasons.push(
    confirmedBreakout
      ? `저항 돌파 확정(종가>R, 거래량 ${latestVolRatio.toFixed(2)}배).`
      : detected
        ? "저항 인근 POTENTIAL 구간입니다."
        : "현재는 VCP 후보 조건을 완전히 충족하지 못했습니다.",
  );

  return {
    detected,
    state,
    score,
    resistanceR: toNullableRounded(resistanceR),
    distanceToR: toNullableRounded(distanceToR),
    breakDate: confirmedBreakout ? latest.time : null,
    contractions: contractions.slice(-4).map((item) => ({
      ...item,
      peak: toRounded(item.peak),
      trough: toRounded(item.trough),
      depth: toRounded(item.depth),
    })),
    atrShrink,
    volumeDryUp,
    trendPass,
    atrPctMean20: toNullableRounded(atrPctMean20),
    atrPctMean120: toNullableRounded(atrPctMean120),
    reasons: reasons.slice(0, 6),
  };
};
