import { atr, sma } from "./indicators";
import type {
  Candle,
  WashoutPullbackCard,
  WashoutPullbackOverlay,
  WashoutPullbackState,
} from "./types";
import { clamp, round2 } from "./utils";

const MIN_CANDLES = 240;

interface DetectionResult {
  card: WashoutPullbackCard;
  overlay: WashoutPullbackOverlay;
}

interface AnchorCandidate {
  index: number;
  time: string;
  high: number;
  close: number;
  turnover: number;
  turnoverRatio: number;
}

interface ReentryCandidate {
  index: number;
  time: string;
  price: number;
  turnoverRatio: number;
}

interface PullbackZoneCandidate {
  timeStart: string | null;
  timeEnd: string | null;
  low: number | null;
  high: number | null;
  strength: number;
  indexStart: number | null;
  indexEnd: number | null;
}

const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const seriesMean = (values: number[], from: number, to: number): number => {
  const start = Math.max(0, from);
  const end = Math.min(values.length - 1, to);
  if (start > end) return 0;
  return mean(values.slice(start, end + 1));
};

const uniqueTexts = (items: string[]): string[] => [...new Set(items.filter(Boolean))];

const stateSummary = (state: WashoutPullbackState): string => {
  if (state === "REBOUND_CONFIRMED") return "눌림 이후 반등 재개가 확인되어 시나리오 강도가 높아졌습니다.";
  if (state === "PULLBACK_READY") return "눌림 구간이 형성되어 분할매수 관점 후보로 볼 수 있습니다.";
  if (state === "WASHOUT_CANDIDATE") return "설거지 반등 후보 단계이며 눌림 안정화 확인이 필요합니다.";
  if (state === "ANCHOR_DETECTED") return "큰 거래대금 고점은 확인됐으나 후속 구조가 아직 약합니다.";
  return "전략 조건이 부족해 참고용 시나리오를 생성하지 않았습니다.";
};

const emptyOverlay = (): WashoutPullbackOverlay => ({
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
});

const emptyCard = (reason: string): WashoutPullbackCard => ({
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
  statusSummary: stateSummary("NONE"),
  reasons: [reason],
  warnings: ["데이터 부족/조건 미충족 시 후보를 강제하지 않습니다."],
});

const wickRatios = (candle: Candle): { lowerWickPct: number; range: number } => {
  const range = Math.max(0, candle.high - candle.low);
  if (range <= 0) return { lowerWickPct: 0, range: 0 };
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  return {
    lowerWickPct: clamp(lowerWick / range, 0, 1),
    range,
  };
};

const findAnchorSpike = (
  candles: Candle[],
  turnoverSeries: number[],
  turnoverMa20Series: Array<number | null>,
): AnchorCandidate | null => {
  const end = candles.length - 1;
  const start = Math.max(20, end - 119);
  let best: AnchorCandidate | null = null;
  let bestScore = -1;

  for (let i = start; i <= end; i += 1) {
    const turnoverMa20 = turnoverMa20Series[i];
    if (turnoverMa20 == null || turnoverMa20 <= 0) continue;
    const ratio = turnoverSeries[i] / turnoverMa20;
    if (ratio < 3) continue;

    const high60 = Math.max(...candles.slice(Math.max(0, i - 59), i + 1).map((candle) => candle.high));
    const inHighCluster = candles[i].high >= high60 * 0.98;
    const shortReturn =
      i >= 5 && candles[i - 5].close > 0
        ? (candles[i].close - candles[i - 5].close) / candles[i - 5].close
        : 0;
    const surgeMove = shortReturn >= 0.1;
    if (!inHighCluster && !surgeMove) continue;

    const score = ratio * 100 + (inHighCluster ? 14 : 0) + clamp(shortReturn * 100, 0, 30);
    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      index: i,
      time: candles[i].time,
      high: candles[i].high,
      close: candles[i].close,
      turnover: turnoverSeries[i],
      turnoverRatio: ratio,
    };
  }

  return best;
};

const findReentry = (
  candles: Candle[],
  anchorIndex: number,
  turnoverSeries: number[],
  turnoverMa20Series: Array<number | null>,
  ma20Series: Array<number | null>,
): ReentryCandidate | null => {
  let best: ReentryCandidate | null = null;
  let bestScore = -1;
  const latestIndex = candles.length - 1;
  const start = anchorIndex + 10;

  for (let i = start; i <= latestIndex; i += 1) {
    const turnoverMa20 = turnoverMa20Series[i];
    if (turnoverMa20 == null || turnoverMa20 <= 0) continue;
    const ratio = turnoverSeries[i] / turnoverMa20;
    if (ratio < 1.8) continue;

    const candle = candles[i];
    const wick = wickRatios(candle);
    const bullish = candle.close > candle.open || wick.lowerWickPct >= 0.45;
    if (!bullish) continue;

    const ma20 = ma20Series[i];
    const closeRecover = ma20 != null ? candle.close >= ma20 : false;
    const supportBase = Math.min(...candles.slice(Math.max(anchorIndex + 1, i - 20), i + 1).map((item) => item.low));
    const supportHold = candle.low <= supportBase * 1.03 && candle.close >= supportBase * 0.99;
    if (!closeRecover && !supportHold) continue;

    const recencyPenalty = (latestIndex - i) * 0.08;
    const score = ratio * 12 + (closeRecover ? 4 : 0) + (wick.lowerWickPct >= 0.45 ? 2 : 0) - recencyPenalty;
    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      index: i,
      time: candle.time,
      price: candle.close,
      turnoverRatio: ratio,
    };
  }

  return best;
};

const findPullbackZone = (
  candles: Candle[],
  reentryIndex: number,
  turnoverSeries: number[],
  ma20Series: Array<number | null>,
  atr14Series: Array<number | null>,
): PullbackZoneCandidate => {
  const latestIndex = candles.length - 1;
  const start = reentryIndex + 3;
  const end = Math.min(reentryIndex + 20, latestIndex);
  if (start > end) {
    return {
      timeStart: null,
      timeEnd: null,
      low: null,
      high: null,
      strength: 0,
      indexStart: null,
      indexEnd: null,
    };
  }

  const supportBase = Math.min(...candles.slice(Math.max(0, reentryIndex - 5), end + 1).map((item) => item.low));
  const validIndices: number[] = [];

  for (let i = start; i <= end; i += 1) {
    const candle = candles[i];
    const ma20 = ma20Series[i];
    const defend = (ma20 != null && candle.close >= ma20 * 0.97) || candle.close >= supportBase * 1.01;
    const turnover5 = seriesMean(turnoverSeries, i - 4, i);
    const turnover20 = seriesMean(turnoverSeries, i - 19, i);
    const cooling = turnover20 > 0 && turnover5 <= turnover20;
    const atr = atr14Series[i];
    const atrPct = atr != null && candle.close > 0 ? (atr / candle.close) * 100 : null;
    const stableVolatility = atrPct == null || atrPct <= 6;
    const dailyDrop =
      i > 0 && candles[i - 1].close > 0 ? (candle.close - candles[i - 1].close) / candles[i - 1].close : 0;
    const noCrash = dailyDrop > -0.08;
    if (defend && cooling && stableVolatility && noCrash) {
      validIndices.push(i);
    }
  }

  if (validIndices.length === 0) {
    return {
      timeStart: null,
      timeEnd: null,
      low: null,
      high: null,
      strength: 0,
      indexStart: null,
      indexEnd: null,
    };
  }

  const zoneEnd = validIndices[validIndices.length - 1];
  const zoneStart = Math.max(start, zoneEnd - 6);
  const zoneIndices = validIndices.filter((index) => index >= zoneStart && index <= zoneEnd);
  const zoneCandles = zoneIndices.map((index) => candles[index]);
  const low = Math.min(...zoneCandles.map((candle) => candle.low));
  const high = Math.max(...zoneCandles.map((candle) => candle.high));
  const strength = clamp(Math.round(52 + zoneIndices.length * 6), 35, 95);

  return {
    timeStart: candles[zoneStart].time,
    timeEnd: candles[zoneEnd].time,
    low,
    high,
    strength,
    indexStart: zoneStart,
    indexEnd: zoneEnd,
  };
};

const zoneEntries = (zoneLow: number, zoneHigh: number): Array<{ label: string; price: number }> => {
  const mid = (zoneHigh + zoneLow) / 2;
  return [
    { label: "1차", price: zoneHigh * 0.998 },
    { label: "2차", price: mid },
    { label: "3차", price: zoneLow * 1.002 },
  ].map((entry) => ({ ...entry, price: round2(entry.price) ?? entry.price }));
};

export const detectWashoutPullback = (candles: Candle[]): DetectionResult => {
  if (candles.length < MIN_CANDLES) {
    return {
      card: emptyCard(`전략 계산에 필요한 일봉 데이터가 부족합니다. (${candles.length}/${MIN_CANDLES})`),
      overlay: emptyOverlay(),
    };
  }

  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const turnoverSeries = candles.map((candle) => candle.close * candle.volume);
  const turnoverMa20Series = sma(turnoverSeries, 20);
  const ma20Series = sma(closes, 20);
  const ma60Series = sma(closes, 60);
  const ma120Series = sma(closes, 120);
  const atr14Series = atr(candles, 14);
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const latestAtr = atr14Series[latestIndex];
  const latestAtrPct = latestAtr != null && latest.close > 0 ? (latestAtr / latest.close) * 100 : null;

  const reasons: string[] = [];
  const warnings: string[] = [];

  const anchor = findAnchorSpike(candles, turnoverSeries, turnoverMa20Series);
  if (!anchor) {
    return {
      card: emptyCard("최근 120봉 내 거래대금 스파이크 고점을 찾지 못했습니다."),
      overlay: emptyOverlay(),
    };
  }

  let state: WashoutPullbackState = "ANCHOR_DETECTED";
  reasons.push(
    `Anchor 스파이크(${anchor.time}) 거래대금 비율 ${round2(anchor.turnoverRatio)}배가 고점 구간에서 포착됐습니다.`,
  );

  const barsSinceAnchor = latestIndex - anchor.index;
  if (barsSinceAnchor < 10) {
    warnings.push("anchor 이후 경과 봉 수가 짧아 설거지 구조 확인이 아직 어렵습니다.");
  }

  const postCandles = candles.slice(anchor.index + 1);
  const postLow = postCandles.length > 0 ? Math.min(...postCandles.map((item) => item.low)) : latest.low;
  const postHigh = postCandles.length > 0 ? Math.max(...postCandles.map((item) => item.high)) : latest.high;
  const drawdownFromAnchor = anchor.high > 0 ? (anchor.high - postLow) / anchor.high : 0;
  const trailingSample = candles.slice(Math.max(anchor.index + 1, latestIndex - 39), latestIndex + 1);
  const trailingRangePct =
    trailingSample.length > 0
      ? (Math.max(...trailingSample.map((item) => item.high)) - Math.min(...trailingSample.map((item) => item.low))) /
        Math.max(1, latest.close)
      : 0;
  const trailingReturn =
    trailingSample.length >= 2 && trailingSample[0].close > 0
      ? (trailingSample[trailingSample.length - 1].close - trailingSample[0].close) / trailingSample[0].close
      : 0;
  const hasBoxOrDown = trailingSample.length >= 20 && (trailingRangePct <= 0.18 || trailingReturn <= -0.04);
  const immediateBreakout = barsSinceAnchor <= 25 && postHigh > anchor.high * 1.01;
  const hasWashoutBase = drawdownFromAnchor >= 0.15 || hasBoxOrDown;

  if (drawdownFromAnchor >= 0.15) {
    reasons.push(`Anchor 대비 조정폭 ${round2(drawdownFromAnchor * 100)}%로 설거지 전제 조건을 충족했습니다.`);
  } else if (hasBoxOrDown) {
    reasons.push("Anchor 이후 20봉 이상 박스권/하락 흐름이 확인됐습니다.");
  } else {
    warnings.push("Anchor 이후 의미 있는 조정/횡보가 부족해 신뢰도가 낮습니다.");
  }

  if (immediateBreakout) {
    warnings.push("Anchor 이후 단기 신고가 재갱신 흐름으로 설거지 구조 해석을 보수적으로 적용합니다.");
  }

  let reentry: ReentryCandidate | null = null;
  if (barsSinceAnchor >= 10 && hasWashoutBase && !immediateBreakout) {
    reentry = findReentry(candles, anchor.index, turnoverSeries, turnoverMa20Series, ma20Series);
    if (reentry) {
      state = "WASHOUT_CANDIDATE";
      reasons.push(`재유입 거래대금(${reentry.time}) 비율 ${round2(reentry.turnoverRatio)}배가 확인됐습니다.`);
    } else {
      warnings.push("Anchor 이후 재유입 거래대금 조건(1.8배)을 아직 충족하지 못했습니다.");
    }
  }

  let pullbackZone = findPullbackZone(candles, latestIndex + 1, turnoverSeries, ma20Series, atr14Series);
  let zoneCooling = false;
  let invalidLow: number | null = null;
  let entries: Array<{ label: string; price: number }> = [];
  let reboundConfirmed = false;

  if (reentry) {
    pullbackZone = findPullbackZone(candles, reentry.index, turnoverSeries, ma20Series, atr14Series);
    if (pullbackZone.low != null && pullbackZone.high != null && pullbackZone.indexEnd != null) {
      const recent5 = seriesMean(turnoverSeries, latestIndex - 4, latestIndex);
      const recent20 = seriesMean(turnoverSeries, latestIndex - 19, latestIndex);
      zoneCooling = recent20 > 0 && recent5 <= recent20;
      entries = zoneEntries(pullbackZone.low, pullbackZone.high);
      const zoneMin = Math.min(
        ...candles
          .slice(
            Math.max(0, (pullbackZone.indexStart ?? reentry.index) - 2),
            Math.min(latestIndex, (pullbackZone.indexEnd ?? reentry.index) + 2) + 1,
          )
          .map((item) => item.low),
      );
      invalidLow = round2(Math.min(pullbackZone.low * 0.98, zoneMin * 0.995)) ?? Math.min(pullbackZone.low * 0.98, zoneMin * 0.995);

      if (latestIndex - pullbackZone.indexEnd <= 3) {
        state = "PULLBACK_READY";
        reasons.push(
          `눌림목 존 ${Math.round(pullbackZone.low).toLocaleString("ko-KR")}~${Math.round(pullbackZone.high).toLocaleString("ko-KR")}원이 형성됐습니다.`,
        );
      } else {
        warnings.push("눌림목 존은 형성됐지만 최근 봉 기준으로는 타이밍이 다소 이격됐습니다.");
      }

      if (zoneCooling) {
        reasons.push("눌림 구간에서 거래대금이 식는 모습(공급 소진)이 확인됩니다.");
      }

      const refStart = Math.max(reentry.index, latestIndex - 15);
      const reboundHigh = Math.max(...candles.slice(refStart, latestIndex).map((item) => item.high));
      const latestTurnoverMa20 = turnoverMa20Series[latestIndex];
      const latestTurnoverRatio =
        latestTurnoverMa20 != null && latestTurnoverMa20 > 0 ? turnoverSeries[latestIndex] / latestTurnoverMa20 : 0;
      reboundConfirmed = latest.close > reboundHigh && latestTurnoverRatio >= 1.3;
      if (reboundConfirmed) {
        state = "REBOUND_CONFIRMED";
        reasons.push(
          `단기 고점 돌파와 거래대금 ${round2(latestTurnoverRatio)}배 증가가 동반되어 반등 재개 신호가 확인됐습니다.`,
        );
      }
    } else {
      warnings.push("재유입 이후 눌림목 안정 구간(3~20봉) 조건이 아직 부족합니다.");
    }
  }

  const ma20Last = ma20Series[latestIndex];
  const ma60Last = ma60Series[latestIndex];
  const ma120Last = ma120Series[latestIndex];
  const trendGuard =
    ma20Last != null && ma60Last != null && ma120Last != null
      ? latest.close >= ma20Last && ma20Last >= ma60Last * 0.95 && ma60Last >= ma120Last * 0.9
      : false;
  if (trendGuard) {
    reasons.push("MA20 및 중기 지지대 방어가 유지되고 있습니다.");
  }

  const anchorStrengthScore = clamp(Math.round(((anchor.turnoverRatio - 3) / 2) * 20), 0, 20);
  const drawdownScore = hasWashoutBase ? 10 : 0;
  const reentryScore = reentry ? 20 : 0;
  const pullbackScore = pullbackZone.low != null && pullbackZone.high != null ? 20 : 0;
  const defenseScore =
    pullbackZone.low != null &&
    ((ma20Last != null && latest.close >= ma20Last * 0.99) || latest.close >= pullbackZone.low)
      ? 10
      : 0;
  const reboundScore = reboundConfirmed ? 10 : 0;
  const coolingScore = zoneCooling ? 10 : 0;
  const score = clamp(
    anchorStrengthScore +
      drawdownScore +
      reentryScore +
      pullbackScore +
      defenseScore +
      reboundScore +
      coolingScore,
    0,
    100,
  );

  const turnover20Avg = seriesMean(turnoverSeries, latestIndex - 19, latestIndex);
  const anchorClarity = anchor.turnoverRatio >= 4.5 ? 25 : anchor.turnoverRatio >= 3.5 ? 18 : 12;
  const reentryClarity =
    reentry == null ? 0 : reentry.turnoverRatio >= 2.5 ? 18 : reentry.turnoverRatio >= 2 ? 14 : 10;
  const gapBars = reentry == null ? 0 : reentry.index - anchor.index;
  const gapScore = reentry == null ? -6 : gapBars < 10 ? -10 : gapBars > 140 ? -8 : gapBars <= 90 ? 12 : 4;
  const atrPenalty = latestAtrPct == null ? 0 : latestAtrPct > 6 ? -15 : latestAtrPct > 4 ? -8 : 6;
  const liquidityScore = turnover20Avg < 2_000_000_000 ? -20 : turnover20Avg < 10_000_000_000 ? -10 : 6;
  const stateBonus = state === "REBOUND_CONFIRMED" ? 12 : state === "PULLBACK_READY" ? 8 : state === "WASHOUT_CANDIDATE" ? 4 : 0;
  const confidence = clamp(
    Math.round(anchorClarity + reentryClarity + gapScore + atrPenalty + liquidityScore + stateBonus),
    0,
    100,
  );

  const reasonsFinal = uniqueTexts(reasons).slice(0, 6);
  const warningsFinal = uniqueTexts([
    ...warnings,
    ...(invalidLow != null ? ["무효화 가격(invalidLow) 이탈 시 전략 시나리오는 무효 처리합니다."] : []),
  ]).slice(0, 3);

  const card: WashoutPullbackCard = {
    id: "washout_pullback_v1",
    displayName: "거래대금 설거지 + 눌림목 전략",
    detected: true,
    state,
    score,
    confidence,
    anchorSpike: {
      date: anchor.time,
      priceHigh: round2(anchor.high),
      priceClose: round2(anchor.close),
      turnover: round2(anchor.turnover),
      turnoverRatio: round2(anchor.turnoverRatio),
    },
    washoutReentry: {
      date: reentry?.time ?? null,
      price: round2(reentry?.price ?? null),
      turnoverRatio: round2(reentry?.turnoverRatio ?? null),
    },
    pullbackZone: {
      low: round2(pullbackZone.low),
      high: round2(pullbackZone.high),
    },
    entryPlan: {
      style: "분할매수",
      entries,
      invalidLow: round2(invalidLow),
    },
    statusSummary: stateSummary(state),
    reasons: reasonsFinal.length > 0 ? reasonsFinal : ["조건 누적으로 이어지는 신호가 아직 부족합니다."],
    warnings: warningsFinal,
  };

  const overlay: WashoutPullbackOverlay = {
    anchorSpike: {
      time: anchor.time,
      price: round2(anchor.high),
      turnover: round2(anchor.turnover),
      turnoverRatio: round2(anchor.turnoverRatio),
      marker: "ANCHOR",
    },
    washoutReentry: {
      time: reentry?.time ?? null,
      price: round2(reentry?.price ?? null),
      turnoverRatio: round2(reentry?.turnoverRatio ?? null),
      marker: reentry ? "REIN" : null,
    },
    pullbackZone: {
      timeStart: pullbackZone.timeStart,
      timeEnd: pullbackZone.timeEnd,
      low: round2(pullbackZone.low),
      high: round2(pullbackZone.high),
      label: "눌림목 존",
      strength: pullbackZone.strength,
    },
    invalidLow: {
      price: round2(invalidLow),
      label: "무효화",
      style: "dashed-bold",
    },
    entryPlan: {
      entries,
    },
  };

  return { card, overlay };
};
