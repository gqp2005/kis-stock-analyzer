import type { Candle, IndicatorPoint, TimeframeAnalysis } from "./types";
import type {
  WangStrategyChartOverlays,
  WangStrategyChecklistItem,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyPayload,
  WangStrategyPhase,
  WangStrategyPhaseItem,
  WangStrategyPhaseOccurrence,
  WangStrategyRefLevel,
  WangStrategyRiskNote,
  WangStrategyTimeframeSummary,
  WangStrategyTradeZone,
  WangStrategyTrainingNote,
  WangStrategyZoneOverlay,
} from "./wangTypes";
import { clamp, round2 } from "./utils";

const WANG_STRATEGY_CONSTANTS = {
  referenceVolumeRatio: 0.11,
  referenceVolumeLower: 0.1,
  referenceVolumeUpper: 0.12,
  baseVolumeMinRatio: 1,
  risingVolumeMinRatio: 1.15,
  elasticVolumeMinRatio: 1.35,
  elasticBodyRatio: 0.55,
  elasticDailyRisePct: 3.5,
  minVolumeMaxRatio: 0.85,
  minVolumeMa20Buffer: 1.08,
  zoneBuildBars: 3,
  refLineBars: 5,
  inZoneTolerancePct: 0.012,
  breakZoneTolerancePct: 0.015,
  overheatFromZonePct: 0.12,
  overheatFromMa20Pct: 0.1,
  splitPlanWeights: [40, 35, 25] as const,
  activeRetestLookbackBars: 12,
} as const;

const PHASE_LABEL: Record<Exclude<WangStrategyPhase, "NONE">, string> = {
  LIFE_VOLUME: "인생거래량",
  BASE_VOLUME: "기준거래량",
  RISING_VOLUME: "상승거래량",
  ELASTIC_VOLUME: "탄력거래량",
  MIN_VOLUME: "최소거래량",
  REACCUMULATION: "재적립",
};

const INTERPRETATION_LABEL: Record<WangStrategyInterpretation, string> = {
  WATCH: "관찰",
  ACCUMULATE: "적립",
  CAUTION: "경계",
  OVERHEAT: "과열",
};

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const bodyRatio = (candle: Candle): number => {
  const range = Math.max(candle.high - candle.low, 0.0001);
  return Math.abs(candle.close - candle.open) / range;
};

const percentDiff = (value: number, reference: number | null): number | null => {
  if (reference == null || reference === 0) return null;
  return ((value - reference) / reference) * 100;
};

const dailyChangePct = (candles: Candle[], index: number): number => {
  if (index <= 0) return 0;
  const prev = candles[index - 1].close;
  if (prev === 0) return 0;
  return ((candles[index].close - prev) / prev) * 100;
};

const isLocalVolumePivot = (candles: Candle[], index: number, span = 2): boolean => {
  const target = candles[index]?.volume ?? 0;
  if (!target) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (candles[index - offset] && candles[index - offset].volume > target) return false;
    if (candles[index + offset] && candles[index + offset].volume > target) return false;
  }
  return true;
};

const isLocalVolumeTrough = (candles: Candle[], index: number, span = 1): boolean => {
  const target = candles[index]?.volume ?? 0;
  if (!target) return false;
  for (let offset = 1; offset <= span; offset += 1) {
    if (candles[index - offset] && candles[index - offset].volume < target) return false;
    if (candles[index + offset] && candles[index + offset].volume < target) return false;
  }
  return true;
};

const phaseOrder: WangStrategyPhase[] = [
  "LIFE_VOLUME",
  "BASE_VOLUME",
  "RISING_VOLUME",
  "ELASTIC_VOLUME",
  "MIN_VOLUME",
  "REACCUMULATION",
];

const toRoundedNumber = (value: number): number => round2(value) ?? value;

const toTimeframeSummary = (analysis: TimeframeAnalysis | null): WangStrategyTimeframeSummary | null => {
  if (!analysis) return null;

  const structure =
    analysis.regime === "UP"
      ? "가르기"
      : analysis.regime === "DOWN"
        ? "모으기"
        : "혼합";

  let phaseBias: WangStrategyPhase = "BASE_VOLUME";
  if (analysis.regime === "DOWN" && !analysis.signals.trend.closeAboveMid) {
    phaseBias = "MIN_VOLUME";
  } else if (analysis.signals.momentum.volumeAboveMa20 && analysis.scores.trend >= 70) {
    phaseBias = "RISING_VOLUME";
  } else if (analysis.scores.momentum >= 65 && analysis.signals.volume.volumeScore >= 65) {
    phaseBias = "ELASTIC_VOLUME";
  }

  return {
    tf: analysis.tf,
    regime: analysis.regime,
    structure,
    score: analysis.profile.score,
    phaseBias,
    summary: analysis.summaryText,
    reasons: analysis.reasons.slice(0, 3),
  };
};

const buildOccurrence = (
  candles: Candle[],
  index: number,
  note: string,
  strength: number,
): WangStrategyPhaseOccurrence => ({
  time: candles[index].time,
  price: toRoundedNumber(candles[index].close),
  volume: Math.round(candles[index].volume),
  strength,
  note,
});

const buildRefLevel = (
  candles: Candle[],
  index: number,
  price: number,
  label: string,
  color: string,
  style: "solid" | "dashed",
): WangStrategyRefLevel => ({
  id: `wang-ref-${label}-${candles[index].time}`,
  label,
  price: toRoundedNumber(price),
  startTime: candles[index].time,
  endTime: candles[Math.min(candles.length - 1, index + WANG_STRATEGY_CONSTANTS.refLineBars)].time,
  color,
  style,
});

const buildMarker = (
  candles: Candle[],
  index: number,
  type: WangStrategyMarker["type"],
  label: string,
  desc: string,
  strength: number,
  position: WangStrategyMarker["position"],
  shape: WangStrategyMarker["shape"],
  color: string,
): WangStrategyMarker => ({
  id: `wang-marker-${type}-${candles[index].time}`,
  t: candles[index].time,
  type,
  label,
  desc,
  price: toRoundedNumber(candles[index].close),
  volume: Math.round(candles[index].volume),
  strength,
  position,
  shape,
  color,
});

const buildPhaseItem = (
  phase: Exclude<WangStrategyPhase, "NONE">,
  currentPhase: WangStrategyPhase,
  occurrences: WangStrategyPhaseOccurrence[],
  summary: string,
  nextCondition: string,
): WangStrategyPhaseItem => ({
  phase,
  title: PHASE_LABEL[phase],
  status: phase === currentPhase ? "active" : occurrences.length > 0 ? "completed" : "pending",
  summary,
  nextCondition,
  occurrences,
});

const buildTrainingNotes = (referenceVolume: number, maxVolume: number): WangStrategyTrainingNote[] => [
  {
    id: "wang-training-reference",
    title: "기준거래량 기준선",
    text: `이번 종목의 최대거래량은 ${Math.round(maxVolume).toLocaleString("ko-KR")}이고, 기준거래량 참고치는 그 10~12% 구간인 ${Math.round(
      maxVolume * WANG_STRATEGY_CONSTANTS.referenceVolumeLower,
    ).toLocaleString("ko-KR")}~${Math.round(maxVolume * WANG_STRATEGY_CONSTANTS.referenceVolumeUpper).toLocaleString("ko-KR")}입니다.`,
    emphasis: "core",
  },
  {
    id: "wang-training-base-repeat",
    title: "기준거래량은 반복된다",
    text: "한 번 나온 기준거래량만 보지 않고, 같은 레퍼런스를 다시 넘는 봉이 나오는지 반복 확인해야 합니다.",
    emphasis: "core",
  },
  {
    id: "wang-training-min-zone",
    title: "최소거래량 이후 zone",
    text: "최소거래량 자체보다 그 뒤의 캔들 고저가 더 중요합니다. 실제 분할 적립 구간은 이후 캔들로 좁혀서 봅니다.",
    emphasis: "practice",
  },
  {
    id: "wang-training-ma20",
    title: "20일선 아래는 적립 후보",
    text: "20일선 아래라고 무조건 매수하는 것이 아니라, 최소거래량 zone과 함께 겹칠 때 적극적 분할 적립 후보로 봅니다.",
    emphasis: "practice",
  },
  {
    id: "wang-training-mtf",
    title: "월·주·일 연결 해석",
    text: "월봉은 큰 균형가격, 주봉은 모으기/가르기 전환, 일봉은 실제 실행 위치로 연결해서 해석해야 합니다.",
    emphasis: "warning",
  },
  {
    id: "wang-training-reference-exact",
    title: "현재 계산 기준",
    text: `이번 응답에서는 기준거래량 계산값을 ${Math.round(referenceVolume).toLocaleString("ko-KR")}으로 고정해 phase를 판정했습니다.`,
    emphasis: "practice",
  },
];

const buildWangTradeZone = (
  candles: Candle[],
  zoneStartIndex: number,
  zoneEndIndex: number,
  zoneLow: number,
  zoneHigh: number,
  belowMa20: boolean,
): WangStrategyTradeZone => {
  const zoneMid = (zoneLow + zoneHigh) / 2;
  const [weight1, weight2, weight3] = WANG_STRATEGY_CONSTANTS.splitPlanWeights;
  const scenario = belowMa20
    ? "20일선 아래 zone 접근으로 해석되어 상단 확인보다 분할 적립 우선 시나리오를 사용합니다."
    : "20일선 위이므로 추격보다 zone 재접근 확인 후 분할 적립 시나리오를 권장합니다.";

  return {
    id: `wang-zone-${candles[zoneStartIndex].time}`,
    label: "최소거래량 이후 재적립 zone",
    low: toRoundedNumber(zoneLow),
    high: toRoundedNumber(zoneHigh),
    active: false,
    anchorPhase: "MIN_VOLUME",
    startTime: candles[zoneStartIndex].time,
    endTime: candles[zoneEndIndex].time,
    invalidationPrice: toRoundedNumber(zoneLow * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct)),
    scenario,
    splitPlan: [
      {
        label: "1차",
        price: toRoundedNumber(zoneHigh),
        weightPct: weight1,
        note: "zone 상단 재진입 확인",
      },
      {
        label: "2차",
        price: toRoundedNumber(zoneMid),
        weightPct: weight2,
        note: "균형가격 재확인",
      },
      {
        label: "3차",
        price: toRoundedNumber(zoneLow),
        weightPct: weight3,
        note: "방어선 최종 점검",
      },
    ],
  };
};

export const buildWangStrategyPayload = (params: {
  input: string;
  symbol: string;
  name: string;
  market: string;
  asOf: string;
  cacheTtlSec: number;
  dayAnalysis: TimeframeAnalysis;
  weekAnalysis: TimeframeAnalysis | null;
  monthAnalysis: TimeframeAnalysis | null;
  warnings?: string[];
}): WangStrategyPayload => {
  const {
    input,
    symbol,
    name,
    market,
    asOf,
    cacheTtlSec,
    dayAnalysis,
    weekAnalysis,
    monthAnalysis,
    warnings = [],
  } = params;

  const candles = dayAnalysis.candles;
  const ma20Series = dayAnalysis.indicators.ma.ma1;
  const close = candles[candles.length - 1]?.close ?? 0;
  const ma20 = ma20Series[ma20Series.length - 1]?.value ?? null;
  const belowMa20 = ma20 != null ? close <= ma20 : false;
  const maxVolume = Math.max(...candles.map((candle) => candle.volume));
  const averageVolume = average(candles.map((candle) => candle.volume));
  const referenceVolume = maxVolume * WANG_STRATEGY_CONSTANTS.referenceVolumeRatio;
  const lifeIndex = candles.findIndex((candle) => candle.volume === maxVolume);

  const baseIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= lifeIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.baseVolumeMinRatio) return false;
      if (candle.volume >= maxVolume * 0.98) return false;
      const ma20Point = ma20Series[index]?.value ?? null;
      return candle.close >= candle.open || (ma20Point != null && candle.close >= ma20Point * 0.98);
    })
    .map(({ index }) => index)
    .slice(-4);

  const latestBaseIndex = baseIndices.length > 0 ? baseIndices[baseIndices.length - 1] : -1;

  const risingIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= latestBaseIndex) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.risingVolumeMinRatio) return false;
      const referenceClose = latestBaseIndex >= 0 ? candles[latestBaseIndex].close : candles[Math.max(index - 1, 0)].close;
      const ma20Point = ma20Series[index]?.value ?? null;
      return candle.close > referenceClose && (ma20Point == null || candle.close >= ma20Point * 0.99);
    })
    .map(({ index }) => index)
    .slice(-3);

  const latestRisingIndex = risingIndices.length > 0 ? risingIndices[risingIndices.length - 1] : -1;
  const elasticStartIndex = latestRisingIndex >= 0 ? latestRisingIndex : latestBaseIndex;

  const elasticIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index < Math.max(elasticStartIndex, 0)) return false;
      if (!isLocalVolumePivot(candles, index)) return false;
      if (candle.volume < referenceVolume * WANG_STRATEGY_CONSTANTS.elasticVolumeMinRatio) return false;
      if (bodyRatio(candle) < WANG_STRATEGY_CONSTANTS.elasticBodyRatio) return false;
      return dailyChangePct(candles, index) >= WANG_STRATEGY_CONSTANTS.elasticDailyRisePct;
    })
    .map(({ index }) => index)
    .slice(-2);

  const latestElasticIndex = elasticIndices.length > 0 ? elasticIndices[elasticIndices.length - 1] : -1;
  const minSearchStartIndex = Math.max(latestElasticIndex, latestRisingIndex, latestBaseIndex);

  const minIndices = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index <= minSearchStartIndex) return false;
      const ma20Point = ma20Series[index]?.value ?? null;
      if (!isLocalVolumeTrough(candles, index)) return false;
      if (candle.volume > referenceVolume * WANG_STRATEGY_CONSTANTS.minVolumeMaxRatio) return false;
      return ma20Point == null || candle.close <= ma20Point * WANG_STRATEGY_CONSTANTS.minVolumeMa20Buffer;
    })
    .sort((left, right) => left.candle.volume - right.candle.volume || right.index - left.index)
    .map(({ index }) => index);

  const minIndex = minIndices.length > 0 ? minIndices[0] : -1;
  const zoneSourceIndex = minIndex >= 0 ? minIndex : -1;
  const zoneStartIndex =
    zoneSourceIndex >= 0
      ? Math.min(candles.length - 1, zoneSourceIndex + 1)
      : -1;
  const zoneEndIndex =
    zoneStartIndex >= 0
      ? Math.min(candles.length - 1, zoneStartIndex + WANG_STRATEGY_CONSTANTS.zoneBuildBars - 1)
      : -1;
  const zoneCandles =
    zoneStartIndex >= 0
      ? candles.slice(zoneStartIndex, zoneEndIndex + 1)
      : [];
  const zoneLow = zoneCandles.length > 0 ? Math.min(...zoneCandles.map((candle) => candle.low)) : null;
  const zoneHigh = zoneCandles.length > 0 ? Math.max(...zoneCandles.map((candle) => candle.high)) : null;

  const retestIndices =
    zoneLow != null && zoneHigh != null
      ? candles
          .map((candle, index) => ({ candle, index }))
          .filter(({ candle, index }) => {
            if (index <= zoneEndIndex) return false;
            const touchesUpper = candle.low <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            const holdsLower = candle.high >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct);
            return touchesUpper && holdsLower;
          })
          .map(({ index }) => index)
      : [];
  const latestRetestIndex = retestIndices.length > 0 ? retestIndices[retestIndices.length - 1] : -1;

  const inZone =
    zoneLow != null && zoneHigh != null
      ? close >= zoneLow * (1 - WANG_STRATEGY_CONSTANTS.inZoneTolerancePct) &&
        close <= zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.inZoneTolerancePct)
      : false;
  const brokeZone =
    zoneLow != null ? close < zoneLow * (1 - WANG_STRATEGY_CONSTANTS.breakZoneTolerancePct) : false;
  const farAboveZone =
    zoneHigh != null ? close > zoneHigh * (1 + WANG_STRATEGY_CONSTANTS.overheatFromZonePct) : false;
  const latestRetestActive =
    latestRetestIndex >= 0 && candles.length - 1 - latestRetestIndex <= WANG_STRATEGY_CONSTANTS.activeRetestLookbackBars;
  const ma20DistancePct = percentDiff(close, ma20);

  let currentPhase: WangStrategyPhase = "NONE";
  if (latestRetestIndex >= 0 && (inZone || latestRetestActive)) currentPhase = "REACCUMULATION";
  else if (minIndex >= 0) currentPhase = "MIN_VOLUME";
  else if (latestElasticIndex >= 0) currentPhase = "ELASTIC_VOLUME";
  else if (latestRisingIndex >= 0) currentPhase = "RISING_VOLUME";
  else if (latestBaseIndex >= 0) currentPhase = "BASE_VOLUME";
  else if (lifeIndex >= 0) currentPhase = "LIFE_VOLUME";

  let interpretation: WangStrategyInterpretation = "WATCH";
  if (brokeZone || weekAnalysis?.regime === "DOWN" || monthAnalysis?.regime === "DOWN") {
    interpretation = "CAUTION";
  } else if (
    farAboveZone ||
    (ma20DistancePct != null && ma20DistancePct >= WANG_STRATEGY_CONSTANTS.overheatFromMa20Pct * 100)
  ) {
    interpretation = "OVERHEAT";
  } else if (
    zoneLow != null &&
    zoneHigh != null &&
    belowMa20 &&
    (inZone || currentPhase === "MIN_VOLUME" || currentPhase === "REACCUMULATION")
  ) {
    interpretation = "ACCUMULATE";
  }

  const checklist: Array<WangStrategyChecklistItem & { weight: number }> = [
    {
      id: "life-volume",
      label: "인생거래량 기준봉 식별",
      ok: lifeIndex >= 0,
      detail: "최대 거래량을 기준점으로 고정해 이후 모든 거래량 해석의 출발점으로 사용합니다.",
      group: "structure",
      weight: 8,
    },
    {
      id: "base-volume",
      label: "기준거래량 반복 확인",
      ok: baseIndices.length > 0,
      detail: `기준거래량은 최대거래량 대비 약 ${Math.round(WANG_STRATEGY_CONSTANTS.referenceVolumeLower * 100)}~${Math.round(
        WANG_STRATEGY_CONSTANTS.referenceVolumeUpper * 100,
      )}% 구간을 넘는 봉으로 판정합니다.`,
      group: "structure",
      weight: 14,
    },
    {
      id: "rising-volume",
      label: "상승거래량 출현",
      ok: risingIndices.length > 0,
      detail: "기준거래량 이후 가격과 거래량이 같이 한 단계 위로 올라가는지 확인합니다.",
      group: "structure",
      weight: 12,
    },
    {
      id: "elastic-volume",
      label: "탄력거래량 확장",
      ok: elasticIndices.length > 0,
      detail: "몸통과 상승폭이 함께 커지는 탄력 봉이 나와야 심리 전환이 분명해집니다.",
      group: "structure",
      weight: 10,
    },
    {
      id: "min-volume",
      label: "최소거래량 확인",
      ok: minIndex >= 0,
      detail: "가장 싼 확률이 높은 자리인지 보려면 탄력 이후 거래량이 극단적으로 줄어드는 지점이 필요합니다.",
      group: "timing",
      weight: 18,
    },
    {
      id: "zone-built",
      label: "최소거래량 이후 zone 형성",
      ok: zoneLow != null && zoneHigh != null,
      detail: "최소거래량 직후 캔들의 고저를 모아 실제 분할 적립 구간을 만듭니다.",
      group: "timing",
      weight: 12,
    },
    {
      id: "retest",
      label: "zone 재접근 또는 재확인",
      ok: latestRetestIndex >= 0 || inZone,
      detail: "최소거래량 zone을 다시 확인해야 실제 재적립 단계로 읽을 수 있습니다.",
      group: "timing",
      weight: 10,
    },
    {
      id: "below-ma20",
      label: "20일선 이하 적립 후보",
      ok: belowMa20,
      detail: "20일선 아래에서 zone이 겹치면 추격보다 적립 시나리오가 유리합니다.",
      group: "timing",
      weight: 10,
    },
    {
      id: "week-context",
      label: "주봉 하락 정렬 아님",
      ok: weekAnalysis == null || weekAnalysis.regime !== "DOWN",
      detail: "주봉이 하락 정렬이면 일봉 최소거래량 신호도 방어적으로 해석합니다.",
      group: "risk",
      weight: 3,
    },
    {
      id: "month-context",
      label: "월봉 대세 훼손 아님",
      ok: monthAnalysis == null || monthAnalysis.regime !== "DOWN",
      detail: "월봉이 무너지면 일봉 zone만으로는 큰 균형가격을 이기기 어렵습니다.",
      group: "risk",
      weight: 3,
    },
  ];

  const score = clamp(
    checklist.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0),
    0,
    100,
  );
  const confidence = clamp(
    Math.round(
      score * 0.72 +
        (interpretation === "ACCUMULATE" ? 12 : 0) +
        (currentPhase === "REACCUMULATION" ? 8 : 0) -
        (interpretation === "OVERHEAT" ? 10 : 0) -
        (interpretation === "CAUTION" ? 20 : 0),
    ),
    0,
    100,
  );

  const reasons: string[] = [];
  if (lifeIndex >= 0) {
    reasons.push(
      `${candles[lifeIndex].time} 인생거래량을 기준으로 이후 기준거래량 레퍼런스를 ${Math.round(referenceVolume).toLocaleString("ko-KR")}으로 설정했습니다.`,
    );
  }
  if (baseIndices.length > 0) {
    reasons.push(`기준거래량은 총 ${baseIndices.length}회 감지되어 반복 패턴 가능성을 남겼습니다.`);
  } else {
    reasons.push("기준거래량 반복이 아직 충분하지 않아 교육형 관점에서는 관찰 우선입니다.");
  }
  if (minIndex >= 0 && zoneLow != null && zoneHigh != null) {
    reasons.push(
      `최소거래량 이후 zone을 ${Math.round(zoneLow).toLocaleString("ko-KR")}~${Math.round(zoneHigh).toLocaleString("ko-KR")}으로 형성했습니다.`,
    );
  }
  if (belowMa20 && zoneLow != null) {
    reasons.push("현재가가 20일선 아래에 있어 추격보다 분할 적립 후보 해석이 가능합니다.");
  } else if (ma20 != null) {
    reasons.push("현재가는 20일선 위에 있어 zone 재접근 없이 공격적으로 보기에는 부담이 있습니다.");
  }
  if (weekAnalysis?.regime === "DOWN" || monthAnalysis?.regime === "DOWN") {
    reasons.push("상위 타임프레임이 하락 정렬이어서 일봉 신호 단독 확정으로 보지 않습니다.");
  }
  if (farAboveZone) {
    reasons.push("현재가가 zone 상단에서 너무 멀어져 실전 매수보다 교육용 관찰 구간에 가깝습니다.");
  }

  const riskNotes: WangStrategyRiskNote[] = [];
  if (zoneLow == null || zoneHigh == null) {
    riskNotes.push({
      id: "no-zone",
      title: "최소거래량 zone 미완성",
      detail: "최소거래량 이후 캔들이 충분하지 않거나 구조가 좁혀지지 않아 적립 구간 확정이 이릅니다.",
      severity: "warning",
    });
  }
  if (brokeZone && zoneLow != null) {
    riskNotes.push({
      id: "zone-break",
      title: "zone 하단 이탈",
      detail: `현재가가 zone 하단 ${Math.round(zoneLow).toLocaleString("ko-KR")} 아래로 밀리면 최소거래량 해석이 약해집니다.`,
      severity: "danger",
    });
  }
  if (interpretation === "OVERHEAT" && zoneHigh != null) {
    riskNotes.push({
      id: "overheat",
      title: "zone 대비 과열",
      detail: `현재가가 zone 상단 ${Math.round(zoneHigh).toLocaleString("ko-KR")} 대비 많이 올라 추격 리스크가 큽니다.`,
      severity: "warning",
    });
  }
  if (monthAnalysis?.regime === "DOWN") {
    riskNotes.push({
      id: "month-down",
      title: "월봉 대세 역풍",
      detail: "월봉이 하락 정렬이면 일봉 minimum zone 신호도 짧게만 유효할 수 있습니다.",
      severity: "warning",
    });
  }
  if (riskNotes.length === 0) {
    riskNotes.push({
      id: "confirmation",
      title: "확정 대신 조건부",
      detail: "이 화면은 설명 가능한 룰 기반 해석입니다. 다음 캔들의 거래량과 zone 방어 여부가 확정 조건입니다.",
      severity: "info",
    });
  }

  const tradeZones: WangStrategyTradeZone[] = [];
  const zoneOverlays: WangStrategyZoneOverlay[] = [];
  const refLevels: WangStrategyRefLevel[] = [];
  const markers: WangStrategyMarker[] = [];

  if (lifeIndex >= 0) {
    refLevels.push(buildRefLevel(candles, lifeIndex, candles[lifeIndex].close, "life.ref", "#f97316", "dashed"));
    markers.push(
      buildMarker(
        candles,
        lifeIndex,
        "VOL_LIFE",
        "인생거래량",
        "최대 거래량 기준봉",
        96,
        "aboveBar",
        "square",
        "#f97316",
      ),
    );
  }

  baseIndices.forEach((index, order) => {
    refLevels.push(buildRefLevel(candles, index, candles[index].close, `base.ref.${order + 1}`, "#57a3ff", "solid"));
    markers.push(
      buildMarker(
        candles,
        index,
        "VOL_BASE",
        `기준거래량 ${order + 1}`,
        "반복 가능한 기준거래량 후보",
        clamp(Math.round((candles[index].volume / referenceVolume) * 35), 40, 90),
        "aboveBar",
        "circle",
        "#57a3ff",
      ),
    );
  });

  risingIndices.forEach((index) => {
    refLevels.push(buildRefLevel(candles, index, candles[index].close, "rise.ref", "#00b386", "solid"));
    markers.push(
      buildMarker(
        candles,
        index,
        "VOL_RISE",
        "상승거래량",
        "기준거래량 이후 가격과 거래량이 같이 상승",
        clamp(Math.round((candles[index].volume / referenceVolume) * 30), 45, 92),
        "aboveBar",
        "arrowUp",
        "#00b386",
      ),
    );
  });

  elasticIndices.forEach((index) => {
    refLevels.push(buildRefLevel(candles, index, candles[index].high, "elastic.ref", "#facc15", "solid"));
    markers.push(
      buildMarker(
        candles,
        index,
        "VOL_ELASTIC",
        "탄력거래량",
        "심리 전환이 빨라지는 탄력 봉",
        clamp(Math.round(bodyRatio(candles[index]) * 100), 55, 98),
        "aboveBar",
        "square",
        "#facc15",
      ),
    );
  });

  if (minIndex >= 0) {
    refLevels.push(buildRefLevel(candles, minIndex, candles[minIndex].low, "min.ref", "#22d3ee", "dashed"));
    markers.push(
      buildMarker(
        candles,
        minIndex,
        "VOL_MIN",
        "최소거래량",
        "가장 쌀 확률이 높은 후보 봉",
        95,
        "belowBar",
        "circle",
        "#22d3ee",
      ),
    );
  }

  if (zoneLow != null && zoneHigh != null && zoneStartIndex >= 0 && zoneEndIndex >= 0) {
    const tradeZone = buildWangTradeZone(candles, zoneStartIndex, zoneEndIndex, zoneLow, zoneHigh, belowMa20);
    tradeZone.active = inZone || latestRetestActive;
    tradeZones.push(tradeZone);
    zoneOverlays.push({
      id: tradeZone.id,
      label: tradeZone.label,
      low: tradeZone.low,
      high: tradeZone.high,
      startTime: tradeZone.startTime,
      endTime: tradeZone.endTime,
      color: belowMa20 ? "rgba(0, 179, 134, 0.24)" : "rgba(87, 163, 255, 0.2)",
      kind: belowMa20 ? "accumulation" : "warning",
    });
    markers.push({
      id: `wang-marker-zone-${tradeZone.startTime}`,
      t: tradeZone.endTime,
      type: "VOL_ZONE",
      label: "zone",
      desc: "최소거래량 이후 형성된 적립 zone",
      price: toRoundedNumber((tradeZone.low + tradeZone.high) / 2),
      volume: 0,
      strength: tradeZone.active ? 92 : 70,
      position: "belowBar",
      shape: "square",
      color: belowMa20 ? "#00b386" : "#57a3ff",
    });
  }

  if (latestRetestIndex >= 0) {
    markers.push(
      buildMarker(
        candles,
        latestRetestIndex,
        "VOL_RETEST",
        "재접근",
        "zone 재확인 봉",
        88,
        "belowBar",
        "arrowUp",
        "#00d2d3",
      ),
    );
    refLevels.push(buildRefLevel(candles, latestRetestIndex, candles[latestRetestIndex].close, "retest.ref", "#00d2d3", "dashed"));
  }

  const phases: WangStrategyPhaseItem[] = [
    buildPhaseItem(
      "LIFE_VOLUME",
      currentPhase,
      lifeIndex >= 0
        ? [
            buildOccurrence(
              candles,
              lifeIndex,
              "최대 거래량이 기준점으로 확정되었습니다.",
              96,
            ),
          ]
        : [],
      lifeIndex >= 0
        ? "인생거래량이 먼저 확인되어 이후 기준거래량을 비교할 절대 기준이 생겼습니다."
        : "아직 최대 거래량 기준점이 뚜렷하지 않습니다.",
      "다음 단계는 최대거래량의 10~12% 수준을 반복해서 넘는 기준거래량이 나오는지 확인하는 것입니다.",
    ),
    buildPhaseItem(
      "BASE_VOLUME",
      currentPhase,
      baseIndices.map((index) =>
        buildOccurrence(
          candles,
          index,
          "기준거래량은 여러 번 나올 수 있으므로 반복 횟수 자체를 중요하게 봅니다.",
          clamp(Math.round((candles[index].volume / referenceVolume) * 35), 40, 90),
        ),
      ),
      baseIndices.length > 0
        ? `기준거래량이 ${baseIndices.length}회 확인되어 반복 패턴과 균형가격 추정이 가능해졌습니다.`
        : "기준거래량이 아직 부족해 현재 구간을 구조적으로 읽기 어렵습니다.",
      "다음 단계는 기준거래량 이후 가격이 한 단계 위에서 유지되며 상승거래량으로 이어지는지 보는 것입니다.",
    ),
    buildPhaseItem(
      "RISING_VOLUME",
      currentPhase,
      risingIndices.map((index) =>
        buildOccurrence(
          candles,
          index,
          "기준거래량 위에서 실제 상승 에너지가 붙은 구간입니다.",
          clamp(Math.round((candles[index].volume / referenceVolume) * 30), 45, 92),
        ),
      ),
      risingIndices.length > 0
        ? "상승거래량이 확인되어 단순 기준봉이 아니라 실제 추진 구간으로 넘어갔습니다."
        : "기준거래량은 보였지만 상승거래량 연결이 약해 아직 관찰 위주입니다.",
      "다음 단계는 몸통과 상승폭이 함께 커지는 탄력거래량이 나오는지 확인하는 것입니다.",
    ),
    buildPhaseItem(
      "ELASTIC_VOLUME",
      currentPhase,
      elasticIndices.map((index) =>
        buildOccurrence(
          candles,
          index,
          "심리 전환이 급격히 드러나는 탄력 구간입니다.",
          clamp(Math.round(bodyRatio(candles[index]) * 100), 55, 98),
        ),
      ),
      elasticIndices.length > 0
        ? "탄력거래량이 나타나 심리 전환이 분명해졌습니다."
        : "탄력거래량이 없어 아직 에너지 확장이 충분히 확인되지 않았습니다.",
      "다음 단계는 거래량이 급감하는 최소거래량 구간이 나오는지, 즉 가장 싼 확률의 자리로 눌리는지 보는 것입니다.",
    ),
    buildPhaseItem(
      "MIN_VOLUME",
      currentPhase,
      minIndex >= 0
        ? [
            buildOccurrence(
              candles,
              minIndex,
              "거래량이 극단적으로 줄며 가격 부담이 내려온 구간입니다.",
              95,
            ),
          ]
        : [],
      minIndex >= 0
        ? "최소거래량이 확인되어 가장 쌀 확률이 높은 자리 후보가 생겼습니다."
        : "최소거래량이 아직 보이지 않아 적립 zone을 만들기 이릅니다.",
      "다음 단계는 최소거래량 직후 캔들의 고저로 zone을 좁히고, 그 zone을 다시 확인하는 것입니다.",
    ),
    buildPhaseItem(
      "REACCUMULATION",
      currentPhase,
      latestRetestIndex >= 0
        ? [
            buildOccurrence(
              candles,
              latestRetestIndex,
              "최소거래량 이후 zone을 다시 확인하며 재적립 가능성을 높였습니다.",
              88,
            ),
          ]
        : [],
      latestRetestIndex >= 0
        ? "zone 재확인이 발생해 실전 적립 후보 해석이 가능해졌습니다."
        : "재적립 확인이 아직 없어 교육형 관점에서는 확정 대신 조건부 해석입니다.",
      "다음 단계는 zone 하단을 이탈하지 않는지, 그리고 재차 기준거래량이 붙는지 확인하는 것입니다.",
    ),
  ];

  const chartOverlays: WangStrategyChartOverlays = {
    ma20Series,
    refLevels,
    zones: zoneOverlays,
  };

  const summaryHeadline =
    currentPhase === "NONE"
      ? "왕장군 전략 phase를 아직 확정하기 어렵습니다."
      : `${PHASE_LABEL[currentPhase as Exclude<WangStrategyPhase, "NONE">]} 단계로 해석됩니다.`;
  const posture =
    interpretation === "ACCUMULATE"
      ? "최소거래량 zone과 20일선 아래 조건이 겹쳐 분할 적립 후보로 봅니다."
      : interpretation === "OVERHEAT"
        ? "탄력 이후 과열 구간으로 보고 추격보다 눌림 재형성을 기다립니다."
        : interpretation === "CAUTION"
          ? "상위 타임프레임 또는 zone 이탈 위험이 있어 확정보다 경계가 우선입니다."
          : "다음 단계 조건이 이어지는지 관찰이 우선입니다.";

  return {
    meta: {
      input,
      symbol,
      name,
      market,
      asOf,
      source: "KIS",
      cacheTtlSec,
      tf: "multi",
      candleCount: candles.length,
      maxVolume: Math.round(maxVolume),
      averageVolume: Math.round(averageVolume),
      referenceVolume: Math.round(referenceVolume),
    },
    summary: {
      phase: currentPhase,
      confidence,
      score,
      interpretation,
      headline: summaryHeadline,
      posture,
    },
    phases,
    currentPhase,
    confidence,
    score,
    reasons: reasons.slice(0, 6),
    checklist: checklist.map(({ weight: _weight, ...item }) => item),
    riskNotes,
    tradeZones,
    movingAverageContext: {
      ma20: ma20 != null ? toRoundedNumber(ma20) : null,
      close: toRoundedNumber(close),
      belowMa20,
      distancePct: ma20DistancePct != null ? toRoundedNumber(ma20DistancePct) : null,
      verdict: belowMa20 ? "20일선 아래 적립 후보" : "20일선 위 관찰 구간",
      guidance: belowMa20
        ? "20일선 아래에서 zone이 겹치면 적극적 분할 적립 후보로 봅니다."
        : "20일선 위에서는 추격보다 zone 재접근 여부를 우선 확인합니다.",
    },
    multiTimeframe: {
      month: toTimeframeSummary(monthAnalysis),
      week: toTimeframeSummary(weekAnalysis),
      day: toTimeframeSummary(dayAnalysis),
    },
    chartOverlays,
    markers,
    trainingNotes: buildTrainingNotes(referenceVolume, maxVolume),
    candles,
    warnings,
  };
};
