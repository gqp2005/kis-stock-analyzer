import { atr, bollingerBands, macd, rsi, sma } from "./indicators";
import { buildMultiViewArtifacts } from "./overlays";
import { detectVcpPattern } from "./vcp";
import { detectWashoutPullback } from "./washoutPullback";
import { detectExtraStrategies, emptyExtraStrategies } from "./extraStrategies";
import type {
  Candle,
  FlowSignal,
  IndicatorSeries,
  IndicatorLevels,
  InvestmentProfile,
  Overall,
  ProfileScore,
  Scores,
  Signals,
  TradePlan,
  Timeframe,
  TimeframeAnalysis,
  VcpHit,
  StrategyCards,
  StrategyOverlays,
} from "./types";
import { clamp, round2 } from "./utils";
import {
  lastValue,
  mddPercent,
  pickNearestAbove,
  pickNearestBelow,
  valueAt,
} from "./scoring/utils";
import {
  adjustSupportResistance,
  buildTradePlan,
  pivotLevels,
  swingCandidates,
} from "./scoring/levels";
import {
  buildProfileScore,
  downgradeOverall,
  momentumLabel,
  overallFromScores,
  regimeFromTrend,
  riskLabel,
  toIndicatorPoints,
  trendLabel,
} from "./scoring/profile";
import { buildVolumeSignals } from "./scoring/volumePatterns";
import { detectCupHandlePattern, emptyCupHandleSignal } from "./scoring/cupHandle";
import {
  appendStrategyOverlays,
  defaultFlowSignal,
  emptyWashoutStrategy,
} from "./scoring/strategyOverlays";

interface TimeframeConfig {
  tf: Timeframe;
  maFast: number;
  maMid: number;
  maLong?: number;
  breakoutLookback: number;
  trendWeights: {
    closeAboveMid: number;
    fastAboveMid: number;
    midSlopeUp: number;
    midAboveLong: number;
    breakout: number;
  };
}

const TF_CONFIG: Record<Timeframe, TimeframeConfig> = {
  month: {
    tf: "month",
    maFast: 6,
    maMid: 12,
    maLong: 24,
    breakoutLookback: 12,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
  week: {
    tf: "week",
    maFast: 10,
    maMid: 30,
    maLong: 60,
    breakoutLookback: 20,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
  day: {
    tf: "day",
    maFast: 20,
    maMid: 60,
    maLong: 120,
    breakoutLookback: 20,
    trendWeights: {
      closeAboveMid: 25,
      fastAboveMid: 25,
      midSlopeUp: 20,
      midAboveLong: 20,
      breakout: 10,
    },
  },
};

const analyzeWithConfig = (
  candles: Candle[],
  config: TimeframeConfig,
  profile: InvestmentProfile,
  flowSignalInput: FlowSignal | null = null,
): TimeframeAnalysis => {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const latest = candles[candles.length - 1];

  const maFastSeries = sma(closes, config.maFast);
  const maMidSeries = sma(closes, config.maMid);
  const maLongSeries = config.maLong ? sma(closes, config.maLong) : Array(closes.length).fill(null);
  const ma20Series = sma(closes, 20);
  const ma60Series = sma(closes, 60);
  const volMa20Series = sma(volumes, 20);
  const rsi14Series = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const atr14Series = atr(candles, 14);
  const macdSeries = macd(closes, 12, 26, 9);

  const maFast = lastValue(maFastSeries);
  const maMid = lastValue(maMidSeries);
  const maLong = lastValue(maLongSeries);
  const ma20 = lastValue(ma20Series);
  const ma60 = lastValue(ma60Series);
  const maMidPrev5 = valueAt(maMidSeries, 5);
  const rsi14 = lastValue(rsi14Series);
  const rsiPrev5 = valueAt(rsi14Series, 5);
  const macdLine = lastValue(macdSeries.line);
  const macdSignalLine = lastValue(macdSeries.signal);
  const macdHist = lastValue(macdSeries.hist);
  const macdBullish =
    macdLine != null && macdSignalLine != null ? macdLine >= macdSignalLine : false;
  const bbUpper = lastValue(bb.upper);
  const bbMid = lastValue(bb.mid);
  const bbLower = lastValue(bb.lower);
  const atr14 = lastValue(atr14Series);
  const volMa20 = lastValue(volMa20Series);
  const atrPct = atr14 != null ? (atr14 / latest.close) * 100 : null;
  const recent = closes.slice(-config.breakoutLookback);
  const recentHigh = recent.length > 0 ? Math.max(...recent) : null;
  const recentLow = recent.length > 0 ? Math.min(...recent) : null;
  const mdd20 = mddPercent(closes.slice(-20));

  const closeAboveMid = maMid != null ? latest.close > maMid : false;
  const fastAboveMid = maFast != null && maMid != null ? maFast > maMid : false;
  const midSlopeUp = maMid != null && maMidPrev5 != null ? maMid > maMidPrev5 : false;
  const midAboveLong =
    config.maLong == null ? false : maMid != null && maLong != null ? maMid > maLong : false;
  const breakout = recentHigh != null ? latest.close >= recentHigh : false;

  const rsiBand: Signals["momentum"]["rsiBand"] =
    rsi14 == null ? "LOW" : rsi14 >= 55 ? "HIGH" : rsi14 >= 45 ? "MID" : "LOW";
  const rsiUpN = rsi14 != null && rsiPrev5 != null ? rsi14 > rsiPrev5 : false;
  const closeAboveFast = maFast != null ? latest.close > maFast : false;
  const return5 =
    closes.length >= 6 ? ((latest.close - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
  const returnNPositive = closes.length >= 6 ? return5 > 0 : false;
  const volumeAboveMa20 = volMa20 != null ? latest.volume > volMa20 : false;

  let atrBucket: Signals["risk"]["atrBucket"] = "N/A";
  let atrScore = 0;
  if (atrPct != null) {
    if (atrPct <= 2) {
      atrBucket = "<=2";
      atrScore = 30;
    } else if (atrPct <= 4) {
      atrBucket = "2~4";
      atrScore = 20;
    } else if (atrPct <= 6) {
      atrBucket = "4~6";
      atrScore = 10;
    } else {
      atrBucket = ">6";
      atrScore = 0;
    }
  }

  let bbPosition: Signals["risk"]["bbPosition"] = "N/A";
  let bbScore = 0;
  if (bbUpper != null && bbLower != null) {
    if (latest.close > bbUpper) {
      bbPosition = "ABOVE_UPPER";
      bbScore = -20;
    } else if (latest.close < bbLower) {
      bbPosition = "BELOW_LOWER";
      bbScore = -10;
    } else {
      bbPosition = "INSIDE_BAND";
      bbScore = 10;
    }
  }

  let mddScore = 0;
  if (mdd20 != null) {
    if (mdd20 >= -5) mddScore = 20;
    else if (mdd20 >= -10) mddScore = 10;
  }

  const oneBarReturn =
    closes.length >= 2 ? ((latest.close - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;
  const sharpDropBar = closes.length >= 2 ? oneBarReturn <= -5 : false;
  const sharpDropScore = sharpDropBar ? -20 : 0;

  let trend = 0;
  if (closeAboveMid) trend += config.trendWeights.closeAboveMid;
  if (fastAboveMid) trend += config.trendWeights.fastAboveMid;
  if (midSlopeUp) trend += config.trendWeights.midSlopeUp;
  if (midAboveLong) trend += config.trendWeights.midAboveLong;
  if (breakout) trend += config.trendWeights.breakout;
  trend = clamp(trend, 0, 100);

  let momentum = 0;
  if (rsiBand === "HIGH") momentum += 20;
  else if (rsiBand === "MID") momentum += 10;
  if (rsiUpN) momentum += 20;
  if (closeAboveFast) momentum += 20;
  if (returnNPositive) momentum += 20;
  if (volumeAboveMa20) momentum += 20;
  momentum = clamp(momentum, 0, 100);

  const riskRaw = atrScore + bbScore + mddScore + sharpDropScore;
  let risk = riskRaw;
  risk = clamp(risk, 0, 100);
  const volumeSignal = buildVolumeSignals(
    candles,
    trend,
    ma20Series,
    ma60Series,
    volMa20Series,
  );
  const cupHandleSignal =
    config.tf === "day"
      ? detectCupHandlePattern(candles, volMa20Series)
      : emptyCupHandleSignal("컵앤핸들 분석은 일봉 기준으로 제공합니다.");
  const washoutArtifacts =
    config.tf === "day"
      ? (() => {
          const detected = detectWashoutPullback(candles);
          return {
            strategyCards: {
              washoutPullback: detected.card,
            },
            strategyOverlays: {
              washoutPullback: detected.overlay,
            },
          };
        })()
      : emptyWashoutStrategy("거래대금 설거지 + 눌림목 전략은 일봉 기준으로만 계산합니다.");
  const extraArtifacts =
    config.tf === "day"
      ? detectExtraStrategies(candles, flowSignalInput)
      : emptyExtraStrategies("해당 전략은 일봉 기준으로만 계산합니다.");
  const extraCards = extraArtifacts.cards;
  const extraOverlays = extraArtifacts.overlays;

  const overall = overallFromScores(trend, momentum, risk);
  const profileScore = buildProfileScore(profile, trend, momentum, risk);
  const summaryText = `${trendLabel(trend)} · ${momentumLabel(momentum)} · ${riskLabel(risk)}`;
  const vcp: VcpHit =
    config.tf === "day"
      ? detectVcpPattern(candles)
      : {
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
            rule: "close>R && volRatio>=1.5",
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
          reasons: ["VCP는 일봉 기준으로만 계산합니다."],
        };

  const reasons: string[] = [
    closeAboveMid
      ? `종가가 MA${config.maMid} 위에 있어 추세가 유지됩니다.`
      : `종가가 MA${config.maMid} 아래에 있어 추세가 약합니다.`,
    fastAboveMid
      ? `MA${config.maFast} > MA${config.maMid} 정렬입니다.`
      : `MA${config.maFast} <= MA${config.maMid} 상태입니다.`,
    breakout
      ? `최근 ${config.breakoutLookback}봉 고점 돌파가 발생했습니다.`
      : `최근 ${config.breakoutLookback}봉 고점 돌파는 아직 없습니다.`,
    rsiBand === "HIGH"
      ? `RSI(${round2(rsi14)})가 높아 모멘텀이 강합니다.`
      : rsiBand === "MID"
        ? `RSI(${round2(rsi14)})가 중립 영역입니다.`
        : `RSI(${round2(rsi14)})가 낮아 모멘텀이 약합니다.`,
    atrPct != null && atrPct <= 4
      ? `ATR%(${round2(atrPct)}%)가 안정 구간입니다.`
      : `ATR%(${round2(atrPct)}%)가 높아 변동성 부담이 있습니다.`,
    sharpDropBar
      ? `직전 봉 급락(${round2(oneBarReturn)}%)이 발생했습니다.`
      : `직전 봉 급락 조건은 발생하지 않았습니다.`,
  ];

  const prevBar = candles[candles.length - 2] ?? latest;
  const pivots = pivotLevels(prevBar);
  const swings = swingCandidates(candles, latest.close, 60, 3);
  const allCandidates = [
    ...pivots,
    ...(bbLower != null ? [bbLower] : []),
    ...(bbUpper != null ? [bbUpper] : []),
    ...(swings.support != null ? [swings.support] : []),
    ...(swings.resistance != null ? [swings.resistance] : []),
  ];

  const sr = adjustSupportResistance(
    pickNearestBelow(allCandidates, latest.close),
    pickNearestAbove(allCandidates, latest.close),
    latest.close,
    ma20,
  );

  const levels: IndicatorLevels = {
    ma20: round2(ma20),
    maFast: round2(maFast),
    maMid: round2(maMid),
    maLong: round2(maLong),
    rsi14: round2(rsi14),
    bbUpper: round2(bbUpper),
    bbMid: round2(bbMid),
    bbLower: round2(bbLower),
    atr14: round2(atr14),
    atrPercent: round2(atrPct),
    recentHigh: round2(recentHigh),
    recentLow: round2(recentLow),
    volumeMa20: round2(volMa20),
    support: round2(sr.support),
    resistance: round2(sr.resistance),
  };
  const tradePlan: TradePlan = buildTradePlan(latest.close, sr.support, sr.resistance, atr14);

  const indicators: IndicatorSeries = {
    ma: {
      ma1Period: config.maFast,
      ma2Period: config.maMid,
      ma3Period: config.maLong ?? null,
      ma1: toIndicatorPoints(candles, maFastSeries),
      ma2: toIndicatorPoints(candles, maMidSeries),
      ma3: toIndicatorPoints(candles, maLongSeries),
    },
    rsi14: toIndicatorPoints(candles, rsi14Series),
    bb: {
      upper: toIndicatorPoints(candles, bb.upper),
      mid: toIndicatorPoints(candles, bb.mid),
      lower: toIndicatorPoints(candles, bb.lower),
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      line: toIndicatorPoints(candles, macdSeries.line),
      signal: toIndicatorPoints(candles, macdSeries.signal),
      hist: toIndicatorPoints(candles, macdSeries.hist),
    },
  };

  const flowSignal =
    flowSignalInput ??
    defaultFlowSignal("수급 데이터가 아직 제공되지 않았습니다.");

  const signals: Signals = {
    trend: {
      closeAboveMid,
      fastAboveMid,
      midSlopeUp,
      midAboveLong,
      breakout,
    },
    momentum: {
      rsi: round2(rsi14),
      rsiBand,
      rsiUpN,
      closeAboveFast,
      returnNPositive,
      volumeAboveMa20,
      macd: round2(macdLine),
      macdSignal: round2(macdSignalLine),
      macdHist: round2(macdHist),
      macdBullish,
    },
    risk: {
      atrPercent: round2(atrPct),
      atrBucket,
      bbPosition,
      mddN: round2(mdd20),
      sharpDropBar,
      breakdown: {
        atrScore,
        bbScore,
        mddScore,
        sharpDropScore,
        rawTotal: riskRaw,
        finalRisk: risk,
      },
    },
    volumePatterns: volumeSignal.volumePatterns,
    volume: volumeSignal.volume,
    cupHandle: cupHandleSignal,
    vcp,
    fundamental: {
      per: null,
      pbr: null,
      eps: null,
      bps: null,
      marketCap: null,
      settlementMonth: null,
      label: "N/A",
      reasons: ["펀더멘털 데이터가 아직 제공되지 않았습니다."],
    },
    flow: flowSignal,
  };
  const multiView = buildMultiViewArtifacts(config.tf, candles, levels, signals);
  const strategyCards: StrategyCards = {
    washoutPullback: washoutArtifacts.strategyCards.washoutPullback,
    darvasRetest: extraCards.darvasRetest,
    nr7InsideBar: extraCards.nr7InsideBar,
    trendTemplate: extraCards.trendTemplate,
    rsiDivergence: extraCards.rsiDivergence,
    flowPersistence: extraCards.flowPersistence,
  };
  const strategyOverlays: StrategyOverlays = {
    washoutPullback: washoutArtifacts.strategyOverlays.washoutPullback,
    darvasRetest: extraOverlays.darvasRetest,
    nr7InsideBar: extraOverlays.nr7InsideBar,
    trendTemplate: extraOverlays.trendTemplate,
    rsiDivergence: extraOverlays.rsiDivergence,
    flowPersistence: extraOverlays.flowPersistence,
  };
  if (config.tf === "day") {
    appendStrategyOverlays(multiView.overlays, strategyOverlays);
  }

  return {
    tf: config.tf,
    regime: regimeFromTrend(trend),
    summaryText,
    scores: { trend, momentum, risk, overall },
    profile: profileScore,
    signals,
    reasons: reasons.slice(0, 6),
    levels,
    tradePlan,
    indicators,
    strategyCards,
    strategyOverlays,
    overlays: multiView.overlays,
    confluence: multiView.confluence,
    explanations: multiView.explanations,
    candles,
  };
};

export const analyzeTimeframe = (
  tf: Timeframe,
  candles: Candle[],
  profile: InvestmentProfile = "short",
  flowSignalInput: FlowSignal | null = null,
): TimeframeAnalysis => {
  const config = TF_CONFIG[tf];
  return analyzeWithConfig(candles, config, profile, flowSignalInput);
};

export const computeMultiFinal = (
  month: TimeframeAnalysis | null,
  week: TimeframeAnalysis | null,
  day: TimeframeAnalysis | null,
  profile: InvestmentProfile = "short",
): {
  overall: Overall;
  confidence: number;
  summary: string;
  profile: ProfileScore | null;
  warnings: string[];
} => {
  const warnings: string[] = [];
  const base = day ?? week ?? month;
  let overall: Overall = base?.profile.overall ?? base?.scores.overall ?? "CAUTION";

  if (!day) {
    warnings.push("일봉 데이터 부족: final은 제한적으로 계산");
  }

  if (month?.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("장기 역풍");
  }
  if (week?.regime === "DOWN") {
    overall = downgradeOverall(overall);
    warnings.push("중기 역풍");
  }
  if (month?.regime === "DOWN" && week?.regime === "DOWN") {
    overall = "CAUTION";
  }

  let confidence = 50;
  if (month) confidence += month.regime === "UP" ? 15 : month.regime === "SIDE" ? 5 : -15;
  if (week) confidence += week.regime === "UP" ? 15 : week.regime === "SIDE" ? 5 : -15;
  if (day) {
    if (day.scores.trend >= 70) confidence += 10;
    if (day.scores.momentum >= 60) confidence += 5;
    if (day.scores.risk < 35) confidence -= 15;
    if (day.signals.momentum.volumeAboveMa20) confidence += 5;

    let volumeAdjustment = day.signals.volume.volumeScore >= 70 ? 8 : day.signals.volume.volumeScore >= 50 ? 3 : -5;
    if (day.scores.risk < 35) {
      volumeAdjustment *= 0.5;
    }
    confidence += volumeAdjustment;
    warnings.push(
      `거래량/수급 점수 ${day.signals.volume.volumeScore}점 반영(${volumeAdjustment > 0 ? "+" : ""}${round2(volumeAdjustment)})`,
    );
  }

  if (month?.regime === "UP" && week?.regime === "UP") {
    confidence += 10;
  }

  confidence = clamp(Math.round(confidence), 0, 100);

  const summaryBase = day?.summaryText ?? week?.summaryText ?? month?.summaryText ?? "분석 데이터 부족";
  const profileText = profile === "short" ? "단기 성향" : "중기 성향";
  const profileScore = day?.profile ?? base?.profile ?? null;

  return {
    overall,
    confidence,
    summary: `${summaryBase} · ${profileText}`,
    profile: profileScore,
    warnings,
  };
};

export const analyzeCandles = (
  candles: Candle[],
): {
  scores: Scores;
  profile: ProfileScore;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  summaryText: string;
} => {
  const day = analyzeTimeframe("day", candles);
  return {
    scores: day.scores,
    profile: day.profile,
    signals: day.signals,
    reasons: day.reasons,
    levels: day.levels,
    summaryText: day.summaryText,
  };
};
