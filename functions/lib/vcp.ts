import { atr, sma } from "./indicators";
import type {
  Candle,
  PatternState,
  VcpContraction,
  VcpHit,
  VcpLeadershipLabel,
  VcpPivotLabel,
  VcpRiskGrade,
} from "./types";
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

interface RawContraction {
  peakIndex: number;
  nextPeakIndex: number;
  peakTime: string;
  troughTime: string;
  peak: number;
  trough: number;
  depth: number;
  durationBars: number;
}

interface BenchmarkInput {
  index: "KOSPI" | "KOSDAQ";
  candles: Candle[];
}

interface RsSignal {
  ok: boolean;
  rsVsMa90: boolean;
  rsRet63: number | null;
}

const MIN_VCP_CANDLES = 200;
const PIVOT_L = 3;
const RESIST_LOOKBACK = 120;
const RESIST_CLUSTER_TOLERANCE = 0.025;
const BREAKOUT_RULE = "close>R && volRatio>=1.5";

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
  resistance: {
    price: null,
    zoneLow: null,
    zoneHigh: null,
    touches: 0,
  },
  distanceToR: null,
  breakDate: null,
  contractions: [],
  atr: {
    atrPct20: null,
    atrPct120: null,
    shrink: false,
  },
  leadership: {
    label: "WEAK",
    ret63: null,
    ret126: null,
  },
  pivot: {
    label: "NONE",
    nearHigh52: false,
    newHigh52: false,
    pivotReady: false,
  },
  volume: {
    dryUp: false,
    dryUpStrength: "NONE",
    volRatioLast: null,
    volRatioAvg10: null,
  },
    rs: {
      index: "KOSPI",
      ok: false,
      rsVsMa90: false,
    rsRet63: null,
  },
  risk: {
    invalidLow: null,
    entryRef: null,
    riskPct: null,
    riskGrade: "N/A",
  },
  breakout: {
    confirmed: false,
    rule: BREAKOUT_RULE,
  },
  trendPass: false,
  quality: {
    baseWidthOk: false,
    depthShrinkOk: false,
    durationOk: false,
    baseSpanBars: null,
    baseLenOk: false,
    baseDepthMax: null,
    gapCrashFlags: 0,
  },
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
): { resistance: ResistanceCluster; touchesPass: boolean } => {
  if (pivotHighs.length === 0) {
    return {
      resistance: {
        center: fallbackHigh,
        min: fallbackHigh,
        max: fallbackHigh,
        touches: 1,
      },
      touchesPass: false,
    };
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

  const strongCandidates = clusters.filter((cluster) => cluster.touches >= 2);
  const strongest =
    [...strongCandidates].sort((a, b) => {
      if (b.touches !== a.touches) return b.touches - a.touches;
      const distA = Math.abs(a.center - close);
      const distB = Math.abs(b.center - close);
      if (distA !== distB) return distA - distB;
      return a.center - b.center;
    })[0] ??
    [...clusters].sort((a, b) => {
      if (b.touches !== a.touches) return b.touches - a.touches;
      return a.center - b.center;
    })[0];

  if (!strongest) {
    return {
      resistance: {
        center: fallbackHigh,
        min: fallbackHigh,
        max: fallbackHigh,
        touches: 1,
      },
      touchesPass: false,
    };
  }

  return {
    resistance: strongest,
    touchesPass: strongest.touches >= 2,
  };
};

const findContractions = (candles: Candle[]): RawContraction[] => {
  const peaks = detectPivots(candles, "high", 160, PIVOT_L);
  if (peaks.length < 2) return [];

  const raw: RawContraction[] = [];
  for (let i = 0; i + 1 < peaks.length; i += 1) {
    const peak = peaks[i];
    const nextPeak = peaks[i + 1];
    if (nextPeak.index - peak.index < PIVOT_L + 1) continue;
    const trough = findLowestBetween(candles, peak.index, nextPeak.index);
    if (!trough) continue;
    const depth = peak.price > 0 ? (peak.price - trough.price) / peak.price : 0;
    const durationBars = nextPeak.index - peak.index;
    if (!Number.isFinite(depth) || depth <= 0) continue;
    raw.push({
      peakIndex: peak.index,
      nextPeakIndex: nextPeak.index,
      peakTime: peak.time,
      troughTime: trough.time,
      peak: peak.price,
      trough: trough.price,
      depth,
      durationBars,
    });
  }

  return raw.slice(-8);
};

const toPublicContraction = (item: RawContraction): VcpContraction => ({
  peakTime: item.peakTime,
  troughTime: item.troughTime,
  peak: toRounded(item.peak),
  trough: toRounded(item.trough),
  depth: toRounded(item.depth),
  durationBars: item.durationBars,
});

const pickContractionWindow = (
  contractions: RawContraction[],
): {
  selected: RawContraction[];
  depthShrinkOk: boolean;
  durationOk: boolean;
  baseSpanBars: number | null;
} => {
  if (contractions.length < 2) {
    return { selected: contractions, depthShrinkOk: false, durationOk: false, baseSpanBars: null };
  }

  let bestWindow: RawContraction[] = contractions.slice(-2);
  let bestDepthShrink = false;
  let bestDuration = false;
  let bestBaseSpan: number | null = null;
  let bestScore = -1;

  for (let i = 0; i < contractions.length - 1; i += 1) {
    for (let size = 2; size <= 4; size += 1) {
      const window = contractions.slice(i, i + size);
      if (window.length < 2) continue;

      const d1 = window[0].depth;
      const d2 = window[1].depth;
      const d3 = window.length >= 3 ? window[2].depth : null;
      const lastDepth = window[window.length - 1].depth;
      const depthShrinkOk =
        d1 >= 0.12 &&
        d2 <= d1 * 0.75 &&
        (d3 == null || d3 <= d2 * 0.85) &&
        lastDepth <= 0.09;

      const durationOk = window.every((item) => item.durationBars >= 5);
      const baseSpanBars = window[window.length - 1].nextPeakIndex - window[0].peakIndex;
      const baseSpanBonus = baseSpanBars >= 30 && baseSpanBars <= 120;
      const recentBias = i;

      const score =
        (depthShrinkOk ? 1000 : 0) +
        (durationOk ? 250 : 0) +
        (baseSpanBonus ? 150 : 0) +
        window.length * 30 +
        recentBias;

      if (score > bestScore) {
        bestScore = score;
        bestWindow = window;
        bestDepthShrink = depthShrinkOk;
        bestDuration = durationOk;
        bestBaseSpan = baseSpanBars;
      }
    }
  }

  return {
    selected: bestWindow,
    depthShrinkOk: bestDepthShrink,
    durationOk: bestDuration,
    baseSpanBars: bestBaseSpan,
  };
};

const computeReturn = (closes: number[], lookbackBars: number): number | null => {
  if (closes.length <= lookbackBars) return null;
  const latest = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookbackBars];
  if (latest <= 0 || prev <= 0) return null;
  return latest / prev - 1;
};

const computeRsSignal = (stockCandles: Candle[], benchmark: BenchmarkInput | null): RsSignal => {
  if (!benchmark || benchmark.candles.length < 120) {
    return { ok: false, rsVsMa90: false, rsRet63: null };
  }

  const benchByDate = new Map(
    benchmark.candles.map((candle) => [candle.time.slice(0, 10), candle.close]),
  );
  const rsValues: number[] = [];
  for (const candle of stockCandles) {
    const benchClose = benchByDate.get(candle.time.slice(0, 10));
    if (benchClose == null || benchClose <= 0) continue;
    rsValues.push(candle.close / benchClose);
  }

  if (rsValues.length < 100) {
    return { ok: false, rsVsMa90: false, rsRet63: null };
  }

  const rsSma30 = sma(rsValues, 30);
  const rsSma90 = sma(rsValues, 90);
  const latestRs = rsValues[rsValues.length - 1];
  const latestSma30 = rsSma30[rsSma30.length - 1];
  const latestSma90 = rsSma90[rsSma90.length - 1];
  const rs63Ago = rsValues[rsValues.length - 64] ?? null;
  const rsRet63 = rs63Ago != null && rs63Ago > 0 ? latestRs / rs63Ago - 1 : null;
  const ok = latestSma30 != null && latestRs >= latestSma30;
  const rsVsMa90 = latestSma90 != null && latestRs >= latestSma90;

  return { ok, rsVsMa90, rsRet63 };
};

const leadershipFromSignals = (
  ret63: number | null,
  ret126: number | null,
  rsOk: boolean,
  rsVsMa90: boolean,
): VcpLeadershipLabel => {
  const strongRet = (ret126 ?? -1) >= 0.15 || (ret63 ?? -1) >= 0.08;
  if (strongRet && rsOk && rsVsMa90) return "STRONG";
  if (rsOk) return "OK";
  return "WEAK";
};

const pivotLabelFromSignals = (
  confirmedBreakout: boolean,
  pivotReady: boolean,
  nearHigh52: boolean,
  newHigh52: boolean,
  latestVolRatio: number,
): VcpPivotLabel => {
  if (confirmedBreakout) return "BREAKOUT_CONFIRMED";
  if (pivotReady) return "PIVOT_READY";
  if (newHigh52 && latestVolRatio >= 1.2) return "PIVOT_52W_BREAK";
  if (nearHigh52) return "PIVOT_NEAR_52W";
  return "NONE";
};

const riskGradeFromPct = (riskPct: number | null): VcpRiskGrade => {
  if (riskPct == null || !Number.isFinite(riskPct)) return "N/A";
  if (riskPct <= 0.1) return "OK";
  if (riskPct <= 0.12) return "HIGH";
  return "BAD";
};

export const detectVcpPattern = (
  candles: Candle[],
  benchmark: BenchmarkInput | null = null,
): VcpHit => {
  if (candles.length < MIN_VCP_CANDLES) {
    return defaultVcpHit(`VCP 분석에 필요한 일봉 데이터가 부족합니다. (${candles.length}/${MIN_VCP_CANDLES})`);
  }

  const sample = candles.slice(-Math.max(280, MIN_VCP_CANDLES));
  const latest = sample[sample.length - 1];
  const closes = sample.map((candle) => candle.close);
  const volumes = sample.map((candle) => candle.volume);

  const ma50Series = sma(closes, 50);
  const ma150Series = sma(closes, 150);
  const ma50 = ma50Series[sample.length - 1];
  const ma150 = ma150Series[sample.length - 1];
  const ma150_63 = ma150Series[sample.length - 64] ?? null;
  const high52w = Math.max(...sample.slice(-252).map((candle) => candle.high));
  const high60 = Math.max(...sample.slice(-60).map((candle) => candle.high));
  const low60 = Math.min(...sample.slice(-60).map((candle) => candle.low));
  const baseWidth = latest.close > 0 ? (high60 - low60) / latest.close : Number.POSITIVE_INFINITY;

  const trendPass =
    ma50 != null &&
    ma150 != null &&
    ma150_63 != null &&
    latest.close > ma50 &&
    ma50 > ma150 &&
    ma150 >= ma150_63 &&
    latest.close >= high52w * 0.75;
  const baseWidthOk = Number.isFinite(baseWidth) && baseWidth <= 0.4;

  const high120 = Math.max(...sample.slice(-RESIST_LOOKBACK).map((candle) => candle.high));
  const pivotHighs = detectPivots(sample, "high", RESIST_LOOKBACK, PIVOT_L);
  const resistanceCluster = clusterResistance(pivotHighs, high120, latest.close);
  const resistance = resistanceCluster.resistance;
  const resistancePrice = resistance.center;
  const distanceToR = resistancePrice > 0 ? (resistancePrice - latest.close) / resistancePrice : null;
  const nearResistance = distanceToR != null && distanceToR >= 0 && distanceToR <= 0.08;

  const rawContractions = findContractions(sample);
  const contractionWindow = pickContractionWindow(rawContractions);
  const contractions = contractionWindow.selected;
  const contractionCount = contractions.length;
  const depthShrinkOk = contractionWindow.depthShrinkOk;
  const durationOk = contractionWindow.durationOk;
  const baseSpanBars = contractionWindow.baseSpanBars;
  const baseLenOk = baseSpanBars != null && baseSpanBars >= 30 && baseSpanBars <= 120;
  const lastDepth = contractionCount > 0 ? contractions[contractionCount - 1].depth : null;
  const baseDepthMax =
    contractionCount > 0
      ? Math.max(...contractions.map((item) => item.depth))
      : null;
  const baseDepthOk = baseDepthMax == null || baseDepthMax <= 0.35;

  const dailyReturns = sample.slice(-60).map((candle, index, arr) => {
    if (index === 0) return 0;
    const prev = arr[index - 1].close;
    if (prev <= 0) return 0;
    return (candle.close - prev) / prev;
  });
  const gapCrashFlags = dailyReturns.filter((ret) => ret <= -0.12).length;
  const gapCrashOk = gapCrashFlags < 2;

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
  const avgVolRatio10 = average(volRatioSeries.slice(-10));
  const volumeDryUp = avgVol20 <= avgVol120 * 0.7 && lowVolDays >= 6;
  const dryUpStrength: "NONE" | "WEAK" | "STRONG" = volumeDryUp
    ? avgVolRatio10 <= 0.65
      ? "STRONG"
      : "WEAK"
    : "NONE";

  const latestVolRatio = volRatioSeries[volRatioSeries.length - 1] ?? 1;
  const confirmedBreakout =
    resistancePrice > 0 && latest.close > resistancePrice && latestVolRatio >= 1.5;

  const ret63 = computeReturn(closes, 63);
  const ret126 = computeReturn(closes, 126);
  const rs = computeRsSignal(sample, benchmark);
  const benchmarkIndex = benchmark?.index ?? "KOSPI";
  const rsOk = rs.ok;
  const rsVsMa90 = rs.rsVsMa90;
  const rsRet63 = rs.rsRet63;
  const leadershipLabel = leadershipFromSignals(ret63, ret126, rsOk, rsVsMa90);

  const nearHigh52 = latest.close >= high52w * 0.9;
  const newHigh52 = latest.close >= high52w;
  const pivotReady =
    contractionCount >= 2 &&
    depthShrinkOk &&
    dryUpStrength === "STRONG" &&
    lastDepth != null &&
    lastDepth <= 0.08 &&
    distanceToR != null &&
    distanceToR >= 0 &&
    distanceToR <= 0.03;
  const pivotLabel = pivotLabelFromSignals(
    confirmedBreakout,
    pivotReady,
    nearHigh52,
    newHigh52,
    latestVolRatio,
  );

  const entryRef = resistance.max > 0 ? resistance.max : resistancePrice;
  const troughLast = contractions.length > 0 ? contractions[contractions.length - 1].trough : null;
  const ma50Guard = ma50 != null ? ma50 * 0.99 : null;
  const invalidLow =
    troughLast != null && ma50Guard != null
      ? Math.min(troughLast, ma50Guard)
      : (troughLast ?? ma50Guard);
  const riskPctRaw =
    entryRef > 0 && invalidLow != null ? (entryRef - invalidLow) / entryRef : null;
  const riskPct =
    riskPctRaw != null && Number.isFinite(riskPctRaw) ? Math.max(0, riskPctRaw) : null;
  const riskGrade = riskGradeFromPct(riskPct);

  const qualityHardFail = !baseDepthOk || !gapCrashOk;
  const coreDetected =
    trendPass &&
    baseWidthOk &&
    resistanceCluster.touchesPass &&
    contractionCount >= 2 &&
    depthShrinkOk &&
    durationOk &&
    (nearResistance || confirmedBreakout);
  const detected = coreDetected && !qualityHardFail && riskGrade !== "BAD";
  const state: PatternState = detected
    ? confirmedBreakout
      ? "CONFIRMED"
      : "POTENTIAL"
    : "NONE";

  let score = 0;
  if (trendPass) score += 20;
  if (distanceToR != null) {
    const absDistance = Math.abs(distanceToR);
    if (absDistance <= 0.08) score += 10;
    if (absDistance <= 0.05) score += 5;
    if (absDistance <= 0.03) score += 5;
  }
  if (contractionCount >= 4) score += 30;
  else if (contractionCount === 3) score += 25;
  else if (contractionCount === 2) score += 15;
  if (depthShrinkOk) score += 15;
  if (durationOk) score += 5;
  if (atrShrink) score += 10;
  if (volumeDryUp) score += dryUpStrength === "STRONG" ? 15 : 10;
  if (rsOk) score += 10;
  if (rsRet63 != null && rsRet63 > 0) score += 5;
  if (leadershipLabel === "STRONG") score += 10;
  else if (leadershipLabel === "OK") score += 5;
  if (pivotReady) score += 10;
  if (nearHigh52) score += 5;
  if (confirmedBreakout || (newHigh52 && latestVolRatio >= 1.2)) score += 10;
  if (riskPct != null) {
    if (riskPct > 0.12) score -= 20;
    else if (riskPct > 0.1) score -= 10;
  }
  if (!baseLenOk) score -= 8;
  if (!baseDepthOk) score -= 25;
  if (!gapCrashOk) score -= 30;
  score = clamp(Math.round(score), 0, 100);

  const reasonRet63 = ret63 != null ? `${(ret63 * 100).toFixed(1)}%` : "N/A";
  const reasonRet126 = ret126 != null ? `${(ret126 * 100).toFixed(1)}%` : "N/A";
  const reasonRs63 = rsRet63 != null ? `${(rsRet63 * 100).toFixed(1)}%` : "N/A";
  const reasonRiskPct = riskPct != null ? `${(riskPct * 100).toFixed(2)}%` : "N/A";

  const reasons: string[] = [
    `리더십 ${leadershipLabel}: ret63=${reasonRet63}, ret126=${reasonRet126}, RS30=${rsOk ? "OK" : "FAIL"}, RS90=${rsVsMa90 ? "OK" : "FAIL"}, RS63=${reasonRs63}.`,
    trendPass
      ? `추세 필터 충족(C>${toRounded(ma50 ?? 0)}, MA50>${toRounded(ma150 ?? 0)}, MA150 63봉 상승) · 베이스 폭 ${(baseWidth * 100).toFixed(1)}%.`
      : `추세/베이스 조건 미충족(MA 구조 또는 52주 고점 비율/베이스 폭 ${(baseWidth * 100).toFixed(1)}%).`,
    `R-zone ${Math.round(resistance.min).toLocaleString("ko-KR")}~${Math.round(resistance.max).toLocaleString("ko-KR")}원(touch ${resistance.touches}) · 거리 ${distanceToR != null ? `${(distanceToR * 100).toFixed(2)}%` : "N/A"} · pivot ${pivotLabel}.`,
    contractionCount >= 2
      ? `컨트랙션 ${contractionCount}회(${contractions.map((item) => `${(item.depth * 100).toFixed(1)}%`).join("→")}), depth 축소 ${depthShrinkOk ? "충족" : "미충족"}, 기간 ${durationOk ? "충족" : "미충족"}.`
      : "컨트랙션 횟수 부족(k<2) 또는 depth 축소 조건 미충족입니다.",
    `드라이업 ${dryUpStrength} (10일 volRatio 평균 ${avgVolRatio10.toFixed(2)}배) · ATR축소 ${atrShrink ? "충족" : "미충족"} (${atrPctMean20 != null ? (atrPctMean20 * 100).toFixed(2) : "N/A"}%/${atrPctMean120 != null ? (atrPctMean120 * 100).toFixed(2) : "N/A"}%).`,
    `리스크 ${riskGrade} (risk=${reasonRiskPct}, invalid=${invalidLow != null ? Math.round(invalidLow).toLocaleString("ko-KR") : "N/A"}원) · 품질 baseLen=${baseSpanBars ?? "N/A"}(${baseLenOk ? "OK" : "주의"}), baseDepth=${baseDepthMax != null ? `${(baseDepthMax * 100).toFixed(1)}%` : "N/A"}, 급락플래그 ${gapCrashFlags}회.`,
  ];

  return {
    detected,
    state,
    score,
    resistance: {
      price: toNullableRounded(resistancePrice),
      zoneLow: toNullableRounded(resistance.min),
      zoneHigh: toNullableRounded(resistance.max),
      touches: resistance.touches,
    },
    distanceToR: toNullableRounded(distanceToR),
    breakDate: detected && confirmedBreakout ? latest.time : null,
    contractions: contractions.slice(-4).map(toPublicContraction),
    atr: {
      atrPct20: toNullableRounded(atrPctMean20),
      atrPct120: toNullableRounded(atrPctMean120),
      shrink: atrShrink,
    },
    leadership: {
      label: leadershipLabel,
      ret63: toNullableRounded(ret63),
      ret126: toNullableRounded(ret126),
    },
    pivot: {
      label: pivotLabel,
      nearHigh52,
      newHigh52,
      pivotReady,
    },
    volume: {
      dryUp: volumeDryUp,
      dryUpStrength,
      volRatioLast: toNullableRounded(latestVolRatio),
      volRatioAvg10: toNullableRounded(avgVolRatio10),
    },
    rs: {
      index: benchmarkIndex,
      ok: rsOk,
      rsVsMa90,
      rsRet63: toNullableRounded(rsRet63),
    },
    risk: {
      invalidLow: toNullableRounded(invalidLow),
      entryRef: toNullableRounded(entryRef),
      riskPct: toNullableRounded(riskPct),
      riskGrade,
    },
    breakout: {
      confirmed: confirmedBreakout,
      rule: BREAKOUT_RULE,
    },
    trendPass,
    quality: {
      baseWidthOk,
      depthShrinkOk,
      durationOk,
      baseSpanBars,
      baseLenOk,
      baseDepthMax: toNullableRounded(baseDepthMax),
      gapCrashFlags,
    },
    reasons: reasons.slice(0, 6),
  };
};
