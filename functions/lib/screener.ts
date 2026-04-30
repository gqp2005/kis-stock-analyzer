import stockList from "../../data/kr-stocks.json";
import { analyzeTimeframe } from "./scoring";
import { detectVcpPattern } from "./vcp";
import { runWalkForwardTuning } from "./walkforward";
import type {
  Candle,
  CupHandleHit,
  DarvasRetestHit,
  FlowPersistenceHit,
  Nr7InsideBarHit,
  PatternHit,
  RsiDivergenceHit,
  ScreenerWashoutPositionFilter,
  ScreenerWashoutStateFilter,
  ScreenerBooleanFilter,
  ScreenerItem,
  ScreenerMarketFilter,
  ScreenerStrategyFilter,
  ScreenerWangActionBiasFilter,
  ScreenerWangPhaseFilter,
  StrategyBacktestSummary,
  TrendTemplateHit,
  WashoutPullbackHit,
} from "./types";
import { clamp } from "./utils";
import { evaluateQualityGate } from "./screener/qualityGate";
import {
  defaultBacktestSummary,
  defaultCupHandleHit,
  defaultDarvasRetestHit,
  defaultFlowPersistenceHit,
  defaultNr7InsideBarHit,
  defaultRsiDivergenceHit,
  defaultTrendTemplateHit,
  defaultWangStrategySummary,
  defaultWashoutPullbackHit,
} from "./screener/defaults";
import {
  detectHeadShouldersPattern,
  detectInverseHeadShouldersPattern,
} from "./screener/headShoulders";
import {
  buildBacktestSummary,
  buildBullishSignalIndexes,
  computeRsLabel,
  computeVcpConfidence,
  computeVolumeHit,
  computeWashoutConfidence,
  computeWashoutPosition,
  computeWashoutRiskPct,
  confidenceAdjustmentFromRs,
  confidenceAdjustmentFromTuning,
  getDataAdjustment,
  getLiquidityAdjustment,
  getOverallLabel,
  scoreAdjustmentFromRs,
  washoutStatePriority,
} from "./screener/scoring";
import type {
  ScreenerBenchmarkMap,
  ScreenerStoredCandidate,
  ScreenerUniverseEntry,
} from "./screener/types";
import { average, averageNullable, clampScore, toNullableRounded, toRounded } from "./screener/utils";

export type {
  ScreenerBenchmarkInput,
  ScreenerBenchmarkMap,
  ScreenerStoredCandidate,
  ScreenerUniverseEntry,
} from "./screener/types";
export {
  detectHeadShouldersPattern,
  detectInverseHeadShouldersPattern,
} from "./screener/headShoulders";

interface StockEntry {
  code: string;
  name: string;
  market: string;
}

const stocks = stockList as StockEntry[];
const VALID_CODE_RE = /^\d{6}$/;
const EXCLUDE_NAME_RE =
  /(스팩|ETN|ETF|인버스|레버리지|커버드콜|회사채|채권|TDF|리츠|채권혼합)/i;

export const getScreenerUniverse = (
  market: ScreenerMarketFilter,
  limit: number,
): ScreenerUniverseEntry[] => {
  const target = Math.max(20, Math.min(1200, Math.floor(limit)));
  const filtered = stocks
    .filter((item) => VALID_CODE_RE.test(item.code))
    .filter((item) => !EXCLUDE_NAME_RE.test(item.name))
    .filter((item) => (market === "ALL" ? true : item.market === market))
    .sort((a, b) => a.code.localeCompare(b.code));

  return filtered.slice(0, target).map((item) => ({
    code: item.code,
    name: item.name,
    market: item.market,
  }));
};

export const analyzeScreenerRawCandidate = (
  stock: ScreenerUniverseEntry,
  candles: Candle[],
  includeBacktest: boolean,
  benchmarks: ScreenerBenchmarkMap | null = null,
): ScreenerStoredCandidate | null => {
  if (candles.length < 140) return null;

  const marketKey: "KOSPI" | "KOSDAQ" = stock.market === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
  const marketBenchmark = benchmarks?.[marketKey] ?? null;
  const day = analyzeTimeframe("day", candles.slice(-260));
  const qualityGate = evaluateQualityGate(day.candles);
  if (!qualityGate.passed) return null;
  const hs = detectHeadShouldersPattern(day.candles);
  const ihs = detectInverseHeadShouldersPattern(day.candles);
  const volume = computeVolumeHit(day);
  const vcp = detectVcpPattern(day.candles, marketBenchmark);
  const cupHandle = day.signals.cupHandle ?? defaultCupHandleHit("컵앤핸들 패턴 데이터가 없습니다.");
  const washoutBase = day.strategyCards?.washoutPullback;
  const darvasBase = day.strategyCards?.darvasRetest;
  const nr7Base = day.strategyCards?.nr7InsideBar;
  const trendTemplateBase = day.strategyCards?.trendTemplate;
  const rsiDivergenceBase = day.strategyCards?.rsiDivergence;
  const flowPersistenceBase = day.strategyCards?.flowPersistence;
  const washoutFallback = defaultWashoutPullbackHit("거래대금 설거지 + 눌림목 전략 데이터가 없습니다.");
  const darvasFallback = defaultDarvasRetestHit("다르바스 전략 데이터가 없습니다.");
  const nr7Fallback = defaultNr7InsideBarHit("NR7+인사이드바 전략 데이터가 없습니다.");
  const trendTemplateFallback = defaultTrendTemplateHit("추세 템플릿 전략 데이터가 없습니다.");
  const rsiDivergenceFallback = defaultRsiDivergenceHit("RSI 다이버전스 전략 데이터가 없습니다.");
  const flowPersistenceFallback = defaultFlowPersistenceHit("수급 지속성 전략 데이터가 없습니다.");
  const entryRef =
    washoutBase?.pullbackZone.high ??
    washoutBase?.entryPlan.entries?.[0]?.price ??
    null;
  const riskPct = computeWashoutRiskPct(entryRef, washoutBase?.entryPlan.invalidLow ?? null);
  const avgTurnover20 = average(day.candles.slice(-20).map((candle) => candle.close * candle.volume));
  const washout: WashoutPullbackHit = washoutBase
    ? {
        detected: washoutBase.detected,
        state: washoutBase.state,
        score: clampScore(washoutBase.score),
        confidence: clampScore(washoutBase.confidence),
        anchorTurnoverRatio: toNullableRounded(washoutBase.anchorSpike.turnoverRatio),
        reentryTurnoverRatio: toNullableRounded(washoutBase.washoutReentry.turnoverRatio),
        pullbackZone: {
          low: toNullableRounded(washoutBase.pullbackZone.low),
          high: toNullableRounded(washoutBase.pullbackZone.high),
        },
        invalidPrice: toNullableRounded(washoutBase.entryPlan.invalidLow),
        riskPct: toNullableRounded(riskPct),
        position: computeWashoutPosition(
          day.candles[day.candles.length - 1].close,
          washoutBase.pullbackZone.low,
          washoutBase.pullbackZone.high,
        ),
        reasons: washoutBase.reasons.slice(0, 6),
        warnings: washoutBase.warnings.slice(0, 3),
      }
    : washoutFallback;
  const darvasRetest: DarvasRetestHit = darvasBase
    ? {
        detected: darvasBase.detected,
        state: darvasBase.state,
        score: clampScore(darvasBase.score),
        confidence: clampScore(darvasBase.confidence),
        boxHigh: toNullableRounded(darvasBase.boxHigh),
        boxLow: toNullableRounded(darvasBase.boxLow),
        breakoutDate: darvasBase.breakoutDate,
        retestDate: darvasBase.retestDate,
        reasons: darvasBase.reasons.slice(0, 6),
      }
    : darvasFallback;
  const nr7InsideBar: Nr7InsideBarHit = nr7Base
    ? {
        detected: nr7Base.detected,
        state: nr7Base.state,
        score: clampScore(nr7Base.score),
        confidence: clampScore(nr7Base.confidence),
        setupDate: nr7Base.setupDate,
        triggerHigh: toNullableRounded(nr7Base.triggerHigh),
        triggerLow: toNullableRounded(nr7Base.triggerLow),
        breakoutDate: nr7Base.breakoutDate,
        breakoutDirection: nr7Base.breakoutDirection,
        reasons: nr7Base.reasons.slice(0, 6),
      }
    : nr7Fallback;
  const trendTemplate: TrendTemplateHit = trendTemplateBase
    ? {
        detected: trendTemplateBase.detected,
        state: trendTemplateBase.state,
        score: clampScore(trendTemplateBase.score),
        confidence: clampScore(trendTemplateBase.confidence),
        nearHigh52wPct: toNullableRounded(trendTemplateBase.nearHigh52wPct),
        reasons: trendTemplateBase.reasons.slice(0, 6),
      }
    : trendTemplateFallback;
  const rsiDivergence: RsiDivergenceHit = rsiDivergenceBase
    ? {
        detected: rsiDivergenceBase.detected,
        state: rsiDivergenceBase.state,
        score: clampScore(rsiDivergenceBase.score),
        confidence: clampScore(rsiDivergenceBase.confidence),
        neckline: toNullableRounded(rsiDivergenceBase.neckline),
        breakoutDate: rsiDivergenceBase.breakoutDate,
        reasons: rsiDivergenceBase.reasons.slice(0, 6),
      }
    : rsiDivergenceFallback;
  const flowPersistence: FlowPersistenceHit = flowPersistenceBase
    ? {
        detected: flowPersistenceBase.detected,
        state: flowPersistenceBase.state,
        score: clampScore(flowPersistenceBase.score),
        confidence: clampScore(flowPersistenceBase.confidence),
        upVolumeRatio20: toNullableRounded(flowPersistenceBase.upVolumeRatio20),
        obvSlope20: toNullableRounded(flowPersistenceBase.obvSlope20),
        reasons: flowPersistenceBase.reasons.slice(0, 6),
      }
    : flowPersistenceFallback;
  const rsInfo = computeRsLabel(day.candles, marketBenchmark);
  const rsScoreAdj = scoreAdjustmentFromRs(rsInfo.label);
  const rsConfidenceAdj = confidenceAdjustmentFromRs(rsInfo.label);

  const tuningResult = runWalkForwardTuning(day.candles);
  const tuningQuality = toNullableRounded(
    average([
      tuningResult.metrics.volume.quality,
      tuningResult.metrics.hs.quality,
      tuningResult.metrics.ihs.quality,
      tuningResult.metrics.vcp.quality,
    ]),
  );
  const tuningScoreAdj =
    (volume.score >= tuningResult.thresholds.volume ? 2 : -2) +
    (ihs.score >= tuningResult.thresholds.ihs ? 2 : -2) +
    (vcp.score >= tuningResult.thresholds.vcp ? 3 : -3) +
    (hs.score >= tuningResult.thresholds.hs ? -2 : 1);

  const dataAdj = getDataAdjustment(day.candles);
  const liquidityAdj = getLiquidityAdjustment(day.candles);
  const adjustment = dataAdj.adjustment + liquidityAdj.adjustment + rsConfidenceAdj;

  const hsRisk = hs.detected ? hs.score : 50;
  const ihsStrength = ihs.detected ? ihs.score : 45;
  const vcpStrength = vcp.detected ? vcp.score : 35;

  const allScore = clampScore(
    0.35 * volume.score +
      0.25 * ihsStrength +
      0.2 * (100 - hsRisk) +
      0.2 * vcpStrength +
      rsScoreAdj +
      tuningScoreAdj,
  );
  const volumeScore = clampScore(volume.score);
  const hsScore = clampScore(hs.score);
  const ihsScore = clampScore(ihs.score);
  const vcpScore = clampScore(vcp.score);
  const washoutScore = clampScore(washout.score);
  const darvasScore = clampScore(darvasRetest.score);
  const nr7Score = clampScore(nr7InsideBar.score);
  const trendTemplateScore = clampScore(trendTemplate.score);
  const rsiDivergenceScore = clampScore(rsiDivergence.score);
  const flowPersistenceScore = clampScore(flowPersistence.score);

  const volumeConfidence = clampScore(
    volume.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        volume.score,
        tuningResult.thresholds.volume,
        tuningResult.metrics.volume.quality,
      ),
  );
  const hsConfidence = clampScore(
    hs.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        hs.score,
        tuningResult.thresholds.hs,
        tuningResult.metrics.hs.quality,
      ),
  );
  const ihsConfidence = clampScore(
    ihs.confidence +
      adjustment +
      confidenceAdjustmentFromTuning(
        ihs.score,
        tuningResult.thresholds.ihs,
        tuningResult.metrics.ihs.quality,
      ),
  );
  const vcpConfidence = clampScore(
    computeVcpConfidence(vcp) +
      adjustment +
      confidenceAdjustmentFromTuning(
        vcp.score,
        tuningResult.thresholds.vcp,
        tuningResult.metrics.vcp.quality,
      ),
  );
  const washoutConfidence = computeWashoutConfidence(
    washout.confidence + adjustment,
    washout.riskPct,
    avgTurnover20,
  );
  const darvasConfidence = clampScore(darvasRetest.confidence + adjustment);
  const nr7Confidence = clampScore(nr7InsideBar.confidence + adjustment);
  const trendTemplateConfidence = clampScore(trendTemplate.confidence + adjustment);
  const rsiDivergenceConfidence = clampScore(rsiDivergence.confidence + adjustment);
  const flowPersistenceConfidence = clampScore(flowPersistence.confidence + adjustment);
  const allConfidence = clampScore(
    0.3 * volumeConfidence + 0.25 * ihsConfidence + 0.2 * hsConfidence + 0.25 * vcpConfidence,
  );

  const sharedReasons: string[] = [];
  if (dataAdj.reason) sharedReasons.push(dataAdj.reason);
  if (liquidityAdj.reason) sharedReasons.push(liquidityAdj.reason);
  sharedReasons.push("유동성/거래정지/급락 품질 필터를 통과한 종목입니다.");
  if (hs.state === "CONFIRMED") sharedReasons.push("헤드앤숄더 확정 패턴이 감지되어 하방 리스크 경고가 있습니다.");
  if (ihs.state === "CONFIRMED") sharedReasons.push("역헤드앤숄더 확정 패턴이 감지되어 반등 가능성이 강화되었습니다.");
  if (vcp.detected) {
    sharedReasons.push(
      `VCP ${vcp.state === "CONFIRMED" ? "돌파 확정" : "잠재"} 패턴(${vcp.score}점)이 포착되었습니다.`,
    );
  }
  if (cupHandle.state === "CONFIRMED") {
    sharedReasons.push(`컵앤핸들 돌파가 확정되었습니다(점수 ${cupHandle.score}점).`);
  } else if (cupHandle.state === "POTENTIAL") {
    sharedReasons.push(`컵앤핸들 후보 구간입니다(점수 ${cupHandle.score}점).`);
  }
  if (washout.detected) {
    sharedReasons.push(
      `거래대금 설거지+눌림목 상태 ${washout.state} (${washout.score}점, 신뢰도 ${washoutConfidence}점)입니다.`,
    );
  }
  if (darvasRetest.detected) {
    sharedReasons.push(
      `다르바스 상태 ${darvasRetest.state} (${darvasRetest.score}점)로 박스 재돌파 흐름을 점검 중입니다.`,
    );
  }
  if (nr7InsideBar.detected) {
    sharedReasons.push(
      `NR7+인사이드바 상태 ${nr7InsideBar.state} (${nr7InsideBar.score}점)로 수축 후 방향 신호가 나타났습니다.`,
    );
  }
  if (trendTemplate.detected) {
    sharedReasons.push(
      `추세 템플릿 상태 ${trendTemplate.state} (${trendTemplate.score}점)로 장기 정배열 조건을 확인했습니다.`,
    );
  }
  if (rsiDivergence.detected) {
    sharedReasons.push(
      `RSI 다이버전스 상태 ${rsiDivergence.state} (${rsiDivergence.score}점)로 반등 구조를 점검 중입니다.`,
    );
  }
  if (flowPersistence.detected) {
    sharedReasons.push(
      `수급 지속성 상태 ${flowPersistence.state} (${flowPersistence.score}점)로 거래량/OBV 흐름이 유지됩니다.`,
    );
  }
  if (washout.position === "IN_ZONE") {
    sharedReasons.push("눌림목 존 내부 구간으로 분할매수 관점의 관찰 구간입니다.");
  } else if (washout.position === "ABOVE_ZONE") {
    sharedReasons.push("현재가가 눌림목 존 위에 있어 추격보다 재눌림 확인이 유리합니다.");
  } else if (washout.position === "BELOW_ZONE") {
    sharedReasons.push("현재가가 눌림목 존 아래로 내려가 방어 확인이 필요합니다.");
  }
  if (vcp.pivot.pivotReady) {
    sharedReasons.push("VCP 피벗 준비 조건(distance/dry-up/depth)이 충족되었습니다.");
  }
  if (vcp.risk.riskGrade === "HIGH") {
    sharedReasons.push("VCP 리스크가 다소 높은 구간(10~12%)입니다.");
  }
  if (vcp.risk.riskGrade === "BAD") {
    sharedReasons.push("VCP 리스크가 과도한 구간(>12%)으로 후보 우선순위를 낮췄습니다.");
  }
  if (vcp.quality.gapCrashFlags >= 2) {
    sharedReasons.push("최근 급락 플래그가 누적되어 품질 필터가 보수적으로 작동했습니다.");
  }
  if (!vcp.rs.ok) {
    sharedReasons.push("VCP RS 필터가 미충족이거나 지수 데이터가 부족합니다.");
  }
  if (rsInfo.label === "STRONG") {
    sharedReasons.push(
      `${rsInfo.benchmark} 대비 상대강도가 강합니다${
        rsInfo.ret63Diff != null ? ` (63일 초과수익 ${(rsInfo.ret63Diff * 100).toFixed(1)}%)` : ""
      }.`,
    );
  } else if (rsInfo.label === "WEAK") {
    sharedReasons.push(
      `${rsInfo.benchmark} 대비 상대강도가 약해 보수적으로 반영했습니다${
        rsInfo.ret63Diff != null ? ` (63일 열위 ${(rsInfo.ret63Diff * 100).toFixed(1)}%)` : ""
      }.`,
    );
  } else if (rsInfo.label === "N/A") {
    sharedReasons.push("지수 상대강도 데이터가 부족해 RS 필터를 약하게 적용했습니다.");
  }
  sharedReasons.push(
    `워크포워드 튜닝 임계값 V/H/I/VCP=${tuningResult.thresholds.volume}/${tuningResult.thresholds.hs}/${tuningResult.thresholds.ihs}/${tuningResult.thresholds.vcp}, 품질 ${tuningQuality ?? 0}점.`,
  );

  const allReasons = [
    ...volume.reasons,
    cupHandle.reasons[0],
    vcp.reasons[0],
    ihs.reasons[0],
    hs.reasons[0],
    ...sharedReasons,
  ].slice(0, 6);

  const volumeReasons = [...volume.reasons, ...sharedReasons].slice(0, 6);
  const hsReasons = [...hs.reasons, ...sharedReasons].slice(0, 6);
  const ihsReasons = [...ihs.reasons, ...sharedReasons].slice(0, 6);
  const vcpReasons = [...vcp.reasons, ...sharedReasons].slice(0, 6);
  const washoutReasons = [...washout.reasons, ...washout.warnings, ...sharedReasons].slice(0, 6);
  const darvasReasons = [...darvasRetest.reasons, ...sharedReasons].slice(0, 6);
  const nr7Reasons = [...nr7InsideBar.reasons, ...sharedReasons].slice(0, 6);
  const trendTemplateReasons = [...trendTemplate.reasons, ...sharedReasons].slice(0, 6);
  const rsiDivergenceReasons = [...rsiDivergence.reasons, ...sharedReasons].slice(0, 6);
  const flowPersistenceReasons = [...flowPersistence.reasons, ...sharedReasons].slice(0, 6);

  const backtestAll = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "ALL"))
    : defaultBacktestSummary();
  const backtestVolume = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "VOLUME"))
    : defaultBacktestSummary();
  const backtestIhs = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "IHS"))
    : defaultBacktestSummary();
  const backtestVcp = includeBacktest
    ? buildBacktestSummary(day.candles, buildBullishSignalIndexes(day.candles, day, ihs, vcp, "VCP"))
    : defaultBacktestSummary();
  const backtestWashout = defaultBacktestSummary();
  const backtestHs = defaultBacktestSummary();
  const backtestDarvas = defaultBacktestSummary();
  const backtestNr7 = defaultBacktestSummary();
  const backtestTrendTemplate = defaultBacktestSummary();
  const backtestRsiDivergence = defaultBacktestSummary();
  const backtestFlowPersistence = defaultBacktestSummary();

  return {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    lastClose: toRounded(day.candles[day.candles.length - 1].close),
    lastDate: day.candles[day.candles.length - 1].time,
    levels: {
      support: day.levels.support,
      resistance: vcp.resistance.price ?? day.levels.resistance,
      neckline: ihs.neckline ?? hs.neckline,
    },
    hits: {
      volume,
      hs,
      ihs,
      vcp,
      cupHandle,
      washoutPullback: washout,
      darvasRetest,
      nr7InsideBar,
      trendTemplate,
      rsiDivergence,
      flowPersistence,
    },
    scoring: {
      all: { score: allScore, confidence: allConfidence },
      volume: { score: volumeScore, confidence: volumeConfidence },
      hs: { score: hsScore, confidence: hsConfidence },
      ihs: { score: ihsScore, confidence: ihsConfidence },
      vcp: { score: vcpScore, confidence: vcpConfidence },
      washoutPullback: { score: washoutScore, confidence: washoutConfidence },
      darvasRetest: { score: darvasScore, confidence: darvasConfidence },
      nr7InsideBar: { score: nr7Score, confidence: nr7Confidence },
      trendTemplate: { score: trendTemplateScore, confidence: trendTemplateConfidence },
      rsiDivergence: { score: rsiDivergenceScore, confidence: rsiDivergenceConfidence },
      flowPersistence: { score: flowPersistenceScore, confidence: flowPersistenceConfidence },
    },
    reasons: {
      all: allReasons,
      volume: volumeReasons,
      hs: hsReasons,
      ihs: ihsReasons,
      vcp: vcpReasons,
      washoutPullback: washoutReasons,
      darvasRetest: darvasReasons,
      nr7InsideBar: nr7Reasons,
      trendTemplate: trendTemplateReasons,
      rsiDivergence: rsiDivergenceReasons,
      flowPersistence: flowPersistenceReasons,
    },
    backtestSummary: {
      all: backtestAll,
      volume: backtestVolume,
      hs: backtestHs,
      ihs: backtestIhs,
      vcp: backtestVcp,
      washoutPullback: backtestWashout,
      darvasRetest: backtestDarvas,
      nr7InsideBar: backtestNr7,
      trendTemplate: backtestTrendTemplate,
      rsiDivergence: backtestRsiDivergence,
      flowPersistence: backtestFlowPersistence,
    },
    rs: rsInfo,
    wangStrategy: defaultWangStrategySummary(),
    tuning: {
      thresholds: tuningResult.thresholds,
      quality: tuningQuality,
    },
  };
};

const strategyKey = (
  strategy: ScreenerStrategyFilter,
): keyof ScreenerStoredCandidate["scoring"] => {
  if (strategy === "VOLUME") return "volume";
  if (strategy === "HS") return "hs";
  if (strategy === "IHS") return "ihs";
  if (strategy === "VCP") return "vcp";
  if (strategy === "WASHOUT_PULLBACK") return "washoutPullback";
  if (strategy === "DARVAS") return "darvasRetest";
  if (strategy === "NR7") return "nr7InsideBar";
  if (strategy === "TREND_TEMPLATE") return "trendTemplate";
  if (strategy === "RSI_DIVERGENCE") return "rsiDivergence";
  if (strategy === "FLOW_PERSISTENCE") return "flowPersistence";
  return "all";
};

export const materializeScreenerItem = (
  raw: ScreenerStoredCandidate,
  strategy: ScreenerStrategyFilter,
): ScreenerItem => {
  const key = strategyKey(strategy);
  const scoreNode = raw.scoring[key] ?? raw.scoring.all;
  const scoreTotal = scoreNode.score;
  const confidence = scoreNode.confidence;
  const cupHandle = (raw.hits as { cupHandle?: CupHandleHit }).cupHandle ??
    defaultCupHandleHit("구버전 스냅샷에는 컵앤핸들 데이터가 없습니다.");
  const washoutPullback =
    (raw.hits as { washoutPullback?: WashoutPullbackHit }).washoutPullback ??
    defaultWashoutPullbackHit("구버전 스냅샷에는 거래대금 설거지+눌림목 데이터가 없습니다.");
  const darvasRetest =
    (raw.hits as { darvasRetest?: DarvasRetestHit }).darvasRetest ??
    defaultDarvasRetestHit("구버전 스냅샷에는 다르바스 전략 데이터가 없습니다.");
  const nr7InsideBar =
    (raw.hits as { nr7InsideBar?: Nr7InsideBarHit }).nr7InsideBar ??
    defaultNr7InsideBarHit("구버전 스냅샷에는 NR7 전략 데이터가 없습니다.");
  const trendTemplate =
    (raw.hits as { trendTemplate?: TrendTemplateHit }).trendTemplate ??
    defaultTrendTemplateHit("구버전 스냅샷에는 추세 템플릿 데이터가 없습니다.");
  const rsiDivergence =
    (raw.hits as { rsiDivergence?: RsiDivergenceHit }).rsiDivergence ??
    defaultRsiDivergenceHit("구버전 스냅샷에는 RSI 다이버전스 데이터가 없습니다.");
  const flowPersistence =
    (raw.hits as { flowPersistence?: FlowPersistenceHit }).flowPersistence ??
    defaultFlowPersistenceHit("구버전 스냅샷에는 수급 지속성 데이터가 없습니다.");
  const hits: ScreenerItem["hits"] = {
    volume: raw.hits.volume,
    hs: raw.hits.hs,
    ihs: raw.hits.ihs,
    vcp: raw.hits.vcp,
    cupHandle,
    washoutPullback,
    darvasRetest,
    nr7InsideBar,
    trendTemplate,
    rsiDivergence,
    flowPersistence,
  };
  const overallLabel = getOverallLabel(scoreTotal, confidence, hits.hs);
  const rs =
    raw.rs ??
    ({
      benchmark: "KOSPI",
      ret63Diff: null,
      label: "N/A",
    } as const);
  const wangStrategy = raw.wangStrategy ?? defaultWangStrategySummary();
  const reasonsByKey = (raw.reasons?.[key] ?? raw.reasons?.all ?? []).slice(0, 6);
  const backtestByKey = raw.backtestSummary?.[key] ?? raw.backtestSummary?.all ?? null;

  return {
    code: raw.code,
    name: raw.name,
    market: raw.market,
    lastClose: raw.lastClose,
    lastDate: raw.lastDate,
    scoreTotal,
    confidence,
    overallLabel,
    hits,
    reasons: reasonsByKey,
    levels: raw.levels,
    backtestSummary: backtestByKey,
    rs,
    wangStrategy,
    tuning: raw.tuning ?? null,
  };
};

export const isWarningCandidate = (item: ScreenerItem): boolean =>
  item.hits.hs.detected && item.hits.hs.state === "CONFIRMED";

const isRsQualified = (item: ScreenerItem): boolean =>
  item.rs.label !== "WEAK";

const sortByScore = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);

const sortByHsRisk = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort(
    (a, b) =>
      b.hits.hs.score - a.hits.hs.score ||
      b.hits.hs.confidence - a.hits.hs.confidence ||
      b.confidence - a.confidence,
  );

const sortByWashoutPriority = (items: ScreenerItem[]): ScreenerItem[] =>
  [...items].sort((a, b) => {
    const stateDiff =
      washoutStatePriority(b.hits.washoutPullback.state) -
      washoutStatePriority(a.hits.washoutPullback.state);
    if (stateDiff !== 0) return stateDiff;
    if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const riskA = a.hits.washoutPullback.riskPct ?? 999;
    const riskB = b.hits.washoutPullback.riskPct ?? 999;
    return riskA - riskB;
  });

export interface WashoutScreenerFilters {
  state: ScreenerWashoutStateFilter;
  position: ScreenerWashoutPositionFilter;
  riskPctMax: number | null;
}

export interface WangScreenerFilters {
  eligible: ScreenerBooleanFilter;
  actionBias: ScreenerWangActionBiasFilter;
  phase: ScreenerWangPhaseFilter;
  zoneReady: ScreenerBooleanFilter;
  ma20DiscountReady: ScreenerBooleanFilter;
}

const defaultWashoutFilters = (): WashoutScreenerFilters => ({
  state: "ALL",
  position: "ALL",
  riskPctMax: null,
});

const defaultWangFilters = (): WangScreenerFilters => ({
  eligible: "ALL",
  actionBias: "ALL",
  phase: "ALL",
  zoneReady: "ALL",
  ma20DiscountReady: "ALL",
});

export interface ScreenerAdaptiveCutoffs {
  all: number;
  volume: number;
  hs: number;
  ihs: number;
  vcp: number;
}

export const DEFAULT_ADAPTIVE_CUTOFFS: ScreenerAdaptiveCutoffs = {
  all: 50,
  volume: 58,
  hs: 68,
  ihs: 62,
  vcp: 80,
};

const clampCutoff = (value: number, min: number, max: number): number =>
  clamp(Math.round(value), min, max);

const computeStrategyAdjustment = (
  summaries: Array<StrategyBacktestSummary | null | undefined>,
  tuningQualities: Array<number | null | undefined>,
): number => {
  const valid = summaries.filter(
    (summary): summary is StrategyBacktestSummary =>
      summary != null &&
      summary.trades >= 3 &&
      summary.winRate != null &&
      summary.PF != null &&
      summary.MDD != null,
  );

  if (valid.length === 0) return 0;

  const avgWinRate = average(valid.map((summary) => summary.winRate as number));
  const avgPf = average(valid.map((summary) => summary.PF as number));
  const avgMdd = average(valid.map((summary) => summary.MDD as number));
  const avgTuningQuality = averageNullable(tuningQualities) ?? 0;

  let adjustment = 0;
  if (avgWinRate < 45) adjustment += 4;
  else if (avgWinRate >= 57) adjustment -= 2;

  if (avgPf < 1.0) adjustment += 4;
  else if (avgPf >= 1.25) adjustment -= 2;

  if (avgMdd <= -18) adjustment += 3;
  else if (avgMdd >= -10) adjustment -= 1;

  if (valid.length < 20) adjustment += 1;
  if (avgTuningQuality < 45) adjustment += 2;
  else if (avgTuningQuality >= 70) adjustment -= 1;

  return adjustment;
};

export const deriveAdaptiveCutoffs = (
  candidates: ScreenerStoredCandidate[],
): ScreenerAdaptiveCutoffs => {
  if (candidates.length === 0) return DEFAULT_ADAPTIVE_CUTOFFS;

  const tuningQualities = candidates.map((candidate) => candidate.tuning?.quality);
  const allAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.all),
    tuningQualities,
  );
  const volumeAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.volume),
    tuningQualities,
  );
  const hsAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.hs),
    tuningQualities,
  );
  const ihsAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.ihs),
    tuningQualities,
  );
  const vcpAdj = computeStrategyAdjustment(
    candidates.map((candidate) => candidate.backtestSummary.vcp),
    tuningQualities,
  );

  return {
    all: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.all + allAdj, 40, 75),
    volume: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.volume + volumeAdj, 50, 85),
    hs: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.hs + hsAdj, 55, 88),
    ihs: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.ihs + ihsAdj, 55, 88),
    vcp: clampCutoff(DEFAULT_ADAPTIVE_CUTOFFS.vcp + vcpAdj, 70, 95),
  };
};

const mergeAdaptiveCutoffs = (
  base: ScreenerAdaptiveCutoffs,
  override?: Partial<ScreenerAdaptiveCutoffs> | null,
): ScreenerAdaptiveCutoffs => ({
  all: clampCutoff(override?.all ?? base.all, 40, 75),
  volume: clampCutoff(override?.volume ?? base.volume, 50, 85),
  hs: clampCutoff(override?.hs ?? base.hs, 55, 88),
  ihs: clampCutoff(override?.ihs ?? base.ihs, 55, 88),
  vcp: clampCutoff(override?.vcp ?? base.vcp, 70, 95),
});

export const buildScreenerView = (
  candidates: ScreenerStoredCandidate[],
  market: ScreenerMarketFilter,
  strategy: ScreenerStrategyFilter,
  count: number,
  cutoffOverride?: Partial<ScreenerAdaptiveCutoffs> | null,
  filtersInput?: {
    washout?: Partial<WashoutScreenerFilters> | null;
    wang?: Partial<WangScreenerFilters> | null;
  } | null,
): {
  items: ScreenerItem[];
  warningItems: ScreenerItem[];
} => {
  const washoutFilters: WashoutScreenerFilters = {
    ...defaultWashoutFilters(),
    ...(filtersInput?.washout ?? {}),
  };
  const wangFilters: WangScreenerFilters = {
    ...defaultWangFilters(),
    ...(filtersInput?.wang ?? {}),
  };
  const filteredCandidates = candidates.filter((candidate) =>
    market === "ALL" ? true : candidate.market === market,
  );
  const adaptiveCutoffs = mergeAdaptiveCutoffs(
    deriveAdaptiveCutoffs(filteredCandidates),
    cutoffOverride,
  );
  const rawItems = filteredCandidates.map((candidate) =>
    materializeScreenerItem(candidate, strategy),
  );
  const warningItems = sortByHsRisk(rawItems.filter((item) => isWarningCandidate(item))).slice(
    0,
    Math.max(5, count),
  );
  const rsFilteredItems =
    strategy === "HS"
      ? rawItems
      : rawItems.filter((item) => isRsQualified(item));

  const matchesBoolean = (value: boolean, filter: ScreenerBooleanFilter): boolean => {
    if (filter === "ALL") return true;
    return filter === "YES" ? value : !value;
  };

  const wangFilteredItems = rsFilteredItems.filter((item) => {
    if (!matchesBoolean(item.wangStrategy.eligible, wangFilters.eligible)) return false;
    if (wangFilters.actionBias !== "ALL" && item.wangStrategy.actionBias !== wangFilters.actionBias) {
      return false;
    }
    if (wangFilters.phase !== "ALL" && item.wangStrategy.currentPhase !== wangFilters.phase) {
      return false;
    }
    if (!matchesBoolean(item.wangStrategy.zoneReady, wangFilters.zoneReady)) return false;
    if (!matchesBoolean(item.wangStrategy.ma20DiscountReady, wangFilters.ma20DiscountReady)) {
      return false;
    }
    return true;
  });

  const items = wangFilteredItems.filter((item) => {
    if (strategy === "VOLUME") return item.scoreTotal >= adaptiveCutoffs.volume;
    if (strategy === "HS") return item.scoreTotal >= adaptiveCutoffs.hs;
    if (strategy === "IHS") return item.scoreTotal >= adaptiveCutoffs.ihs;
    if (strategy === "VCP") {
      return item.hits.vcp.detected && item.hits.vcp.score >= adaptiveCutoffs.vcp;
    }
    if (strategy === "DARVAS") {
      return (
        !!item.hits.darvasRetest?.detected &&
        item.hits.darvasRetest.state !== "NONE" &&
        item.scoreTotal >= 55
      );
    }
    if (strategy === "NR7") {
      return (
        !!item.hits.nr7InsideBar?.detected &&
        item.hits.nr7InsideBar.state !== "NONE" &&
        item.scoreTotal >= 55
      );
    }
    if (strategy === "TREND_TEMPLATE") {
      return (
        !!item.hits.trendTemplate?.detected &&
        item.hits.trendTemplate.state !== "NONE" &&
        item.scoreTotal >= 60
      );
    }
    if (strategy === "RSI_DIVERGENCE") {
      return (
        !!item.hits.rsiDivergence?.detected &&
        item.hits.rsiDivergence.state !== "NONE" &&
        item.scoreTotal >= 55
      );
    }
    if (strategy === "FLOW_PERSISTENCE") {
      return (
        !!item.hits.flowPersistence?.detected &&
        item.hits.flowPersistence.state !== "NONE" &&
        item.scoreTotal >= 55
      );
    }
    if (strategy === "WASHOUT_PULLBACK") {
      const washout = item.hits.washoutPullback;
      if (!washout.detected || washout.state === "NONE") return false;
      if (washoutFilters.state !== "ALL" && washout.state !== washoutFilters.state) return false;
      if (washoutFilters.position !== "ALL" && washout.position !== washoutFilters.position) return false;
      if (
        washoutFilters.riskPctMax != null &&
        (washout.riskPct == null || washout.riskPct > washoutFilters.riskPctMax)
      ) {
        return false;
      }
      return true;
    }
    return item.scoreTotal >= adaptiveCutoffs.all || isWarningCandidate(item);
  });

  if (strategy === "HS") {
    return {
      items: sortByHsRisk(items).slice(0, count),
      warningItems,
    };
  }
  if (strategy === "VCP") {
    return {
      items: sortByScore(items).slice(0, count),
      warningItems,
    };
  }
  if (strategy === "WASHOUT_PULLBACK") {
    return {
      items: sortByWashoutPriority(items).slice(0, count),
      warningItems,
    };
  }
  if (strategy !== "ALL") {
    return {
      items: sortByScore(items).slice(0, count),
      warningItems,
    };
  }

  const normal = sortByScore(items.filter((item) => !isWarningCandidate(item)));
  const warnings = sortByScore(items.filter((item) => isWarningCandidate(item)));
  return {
    items: [...normal, ...warnings].slice(0, count),
    warningItems,
  };
};
