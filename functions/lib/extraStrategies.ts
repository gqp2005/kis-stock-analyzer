import { rsi, sma } from "./indicators";
import type {
  Candle,
  DarvasRetestCard,
  FlowPersistenceCard,
  FlowSignal,
  Nr7InsideBarCard,
  RsiDivergenceCard,
  SimpleStrategyOverlay,
  StrategyCards,
  StrategyOverlays,
  StrategySignalState,
  TrendTemplateCard,
} from "./types";
import { clamp, round2 } from "./utils";

interface ExtraStrategiesResult {
  cards: {
    darvasRetest: DarvasRetestCard;
    nr7InsideBar: Nr7InsideBarCard;
    trendTemplate: TrendTemplateCard;
    rsiDivergence: RsiDivergenceCard;
    flowPersistence: FlowPersistenceCard;
  };
  overlays: {
    darvasRetest: SimpleStrategyOverlay;
    nr7InsideBar: SimpleStrategyOverlay;
    trendTemplate: SimpleStrategyOverlay;
    rsiDivergence: SimpleStrategyOverlay;
    flowPersistence: SimpleStrategyOverlay;
  };
}

const avg = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const safeRound = (value: number | null): number | null => round2(value);

const defaultOverlay = (): SimpleStrategyOverlay => ({
  markers: [],
  lines: [],
});

const defaultDarvasCard = (reason: string): DarvasRetestCard => ({
  id: "darvas_retest_v1",
  displayName: "다르바스 박스 돌파-리테스트",
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  boxHigh: null,
  boxLow: null,
  boxWidthPct: null,
  breakoutDate: null,
  retestDate: null,
  triggerPrice: null,
  supportPrice: null,
  invalidationPrice: null,
  summary: "다르바스 박스 조건이 부족합니다.",
  reasons: [reason],
  warnings: [],
});

const defaultNr7Card = (reason: string): Nr7InsideBarCard => ({
  id: "nr7_insidebar_v1",
  displayName: "NR7+인사이드바 변동성 수축 돌파",
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  setupDate: null,
  triggerHigh: null,
  triggerLow: null,
  breakoutDate: null,
  breakoutDirection: "NONE",
  summary: "NR7+인사이드바 패턴 조건이 부족합니다.",
  reasons: [reason],
  warnings: [],
});

const defaultTrendTemplateCard = (reason: string): TrendTemplateCard => ({
  id: "trend_template_v1",
  displayName: "추세 템플릿 + RS 필터",
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  ma50: null,
  ma150: null,
  ma200: null,
  high52w: null,
  low52w: null,
  nearHigh52wPct: null,
  summary: "추세 템플릿 조건이 부족합니다.",
  reasons: [reason],
  warnings: [],
});

const defaultRsiDivCard = (reason: string): RsiDivergenceCard => ({
  id: "rsi_divergence_v1",
  displayName: "RSI 다이버전스 + 넥라인 돌파",
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  low1Date: null,
  low2Date: null,
  low1Price: null,
  low2Price: null,
  rsiLow1: null,
  rsiLow2: null,
  neckline: null,
  breakoutDate: null,
  summary: "RSI 다이버전스 조건이 부족합니다.",
  reasons: [reason],
  warnings: [],
});

const defaultFlowCard = (reason: string): FlowPersistenceCard => ({
  id: "flow_persistence_v1",
  displayName: "기관/외인 수급 지속성 추종",
  detected: false,
  state: "NONE",
  score: 0,
  confidence: 0,
  upVolumeRatio20: null,
  obvSlope20: null,
  flowSignalUsed: false,
  foreignNet: null,
  institutionNet: null,
  programNet: null,
  summary: "수급 지속성 조건이 부족합니다.",
  reasons: [reason],
  warnings: [],
});

const detectDarvasRetest = (
  candles: Candle[],
  volRatioSeries: number[],
): { card: DarvasRetestCard; overlay: SimpleStrategyOverlay } => {
  if (candles.length < 90) {
    return {
      card: defaultDarvasCard("다르바스 분석에 필요한 일봉 데이터(90봉)가 부족합니다."),
      overlay: defaultOverlay(),
    };
  }

  const latestIndex = candles.length - 1;
  const boxStart = Math.max(20, latestIndex - 85);
  const boxEnd = Math.max(boxStart + 20, latestIndex - 6);
  const boxSample = candles.slice(boxStart, boxEnd + 1);
  const boxHigh = Math.max(...boxSample.map((item) => item.high));
  const boxLow = Math.min(...boxSample.map((item) => item.low));
  const boxWidthPct = boxHigh > 0 ? (boxHigh - boxLow) / boxHigh : 0;

  let breakoutIndex: number | null = null;
  for (let i = Math.max(boxStart + 10, latestIndex - 35); i <= latestIndex; i += 1) {
    if (candles[i].close > boxHigh * 1.002 && volRatioSeries[i] >= 1.2) {
      breakoutIndex = i;
      break;
    }
  }

  let retestIndex: number | null = null;
  if (breakoutIndex != null) {
    for (let i = breakoutIndex + 1; i <= latestIndex; i += 1) {
      const touched = candles[i].low <= boxHigh * 1.02;
      const defended = candles[i].close >= boxHigh * 0.985;
      if (touched && defended) {
        retestIndex = i;
        break;
      }
    }
  }

  const breakout = breakoutIndex != null;
  const retest = retestIndex != null;
  const narrowBox = boxWidthPct <= 0.2;
  const state: StrategySignalState = breakout
    ? retest && candles[latestIndex].close >= boxHigh
      ? "CONFIRMED"
      : "POTENTIAL"
    : candles[latestIndex].close >= boxHigh * 0.97 && narrowBox
      ? "POTENTIAL"
      : "NONE";

  const score = clamp(
    Math.round(
      (state === "CONFIRMED" ? 76 : state === "POTENTIAL" ? 52 : 0) +
        (narrowBox ? 10 : 0) +
        (retest ? 12 : 0),
    ),
    0,
    100,
  );
  const confidence = clamp(
    Math.round(
      35 +
        (breakout ? 20 : 0) +
        (retest ? 18 : 0) +
        (narrowBox ? 12 : -8) +
        (breakoutIndex != null ? Math.min(12, volRatioSeries[breakoutIndex] * 4) : 0),
    ),
    0,
    100,
  );

  const reasons: string[] = [
    `박스 상단 ${Math.round(boxHigh).toLocaleString("ko-KR")}원, 하단 ${Math.round(boxLow).toLocaleString("ko-KR")}원입니다.`,
    breakout
      ? `상단 돌파가 ${candles[breakoutIndex as number].time.slice(0, 10)}에 확인됐습니다.`
      : "박스 상단 돌파는 아직 확인되지 않았습니다.",
    retest
      ? `리테스트 지지(${candles[retestIndex as number].time.slice(0, 10)})가 확인됐습니다.`
      : "리테스트 지지 확인이 필요합니다.",
    `박스 폭은 ${(boxWidthPct * 100).toFixed(2)}%입니다.`,
  ];
  const warnings: string[] = [];
  if (!narrowBox) warnings.push("박스 폭이 넓어(20% 초과) 신호 신뢰도가 낮습니다.");
  if (state === "NONE") warnings.push("돌파 전 구간으로 성급한 추격보다는 관찰이 유리합니다.");

  const trigger = safeRound(boxHigh);
  const support = safeRound(boxLow);
  const invalid = safeRound(boxLow * 0.985);

  return {
    card: {
      id: "darvas_retest_v1",
      displayName: "다르바스 박스 돌파-리테스트",
      detected: state !== "NONE",
      state,
      score,
      confidence,
      boxHigh: trigger,
      boxLow: support,
      boxWidthPct: safeRound(boxWidthPct * 100),
      breakoutDate: breakoutIndex != null ? candles[breakoutIndex].time : null,
      retestDate: retestIndex != null ? candles[retestIndex].time : null,
      triggerPrice: trigger,
      supportPrice: support,
      invalidationPrice: invalid,
      summary:
        state === "CONFIRMED"
          ? "돌파 후 리테스트 지지가 확인되어 추세 재개 가능성이 높아졌습니다."
          : state === "POTENTIAL"
            ? "박스 돌파 또는 상단 근접 구간으로 리테스트 확인이 중요합니다."
            : "박스 내부 흐름으로 확정 신호 전입니다.",
      reasons: reasons.slice(0, 6),
      warnings: warnings.slice(0, 3),
    },
    overlay: {
      markers: [
        breakoutIndex != null
          ? {
              time: candles[breakoutIndex].time,
              price: safeRound(candles[breakoutIndex].close),
              label: "DARVAS BRK",
              shape: "arrowUp",
              color: "#f6c75f",
            }
          : {
              time: null,
              price: null,
              label: "DARVAS BRK",
              shape: "arrowUp",
              color: "#f6c75f",
            },
        retestIndex != null
          ? {
              time: candles[retestIndex].time,
              price: safeRound(candles[retestIndex].close),
              label: "DARVAS RT",
              shape: "circle",
              color: "#00c389",
            }
          : {
              time: null,
              price: null,
              label: "DARVAS RT",
              shape: "circle",
              color: "#00c389",
            },
      ],
      lines: [
        { price: trigger, label: "다르바스 상단", style: "dashed", color: "rgba(246,199,95,0.95)" },
        { price: support, label: "다르바스 하단", style: "dotted", color: "rgba(246,199,95,0.7)" },
      ],
    },
  };
};

const detectNr7InsideBar = (
  candles: Candle[],
  volRatioSeries: number[],
): { card: Nr7InsideBarCard; overlay: SimpleStrategyOverlay } => {
  if (candles.length < 30) {
    return {
      card: defaultNr7Card("NR7+인사이드바 분석에 필요한 데이터가 부족합니다."),
      overlay: defaultOverlay(),
    };
  }

  let setupIndex: number | null = null;
  for (let i = candles.length - 2; i >= Math.max(7, candles.length - 35); i -= 1) {
    const range = candles[i].high - candles[i].low;
    const ranges = candles.slice(i - 6, i + 1).map((item) => item.high - item.low);
    const isNr7 = range <= Math.min(...ranges);
    const prev = candles[i - 1];
    const inside = candles[i].high < prev.high && candles[i].low > prev.low;
    if (isNr7 && inside) {
      setupIndex = i;
      break;
    }
  }

  if (setupIndex == null) {
    return {
      card: defaultNr7Card("최근 구간에서 NR7+인사이드바 세팅이 관찰되지 않았습니다."),
      overlay: defaultOverlay(),
    };
  }

  const triggerHigh = candles[setupIndex].high;
  const triggerLow = candles[setupIndex].low;
  let breakoutIndex: number | null = null;
  let breakoutDirection: "UP" | "DOWN" | "NONE" = "NONE";
  for (let i = setupIndex + 1; i < candles.length; i += 1) {
    if (candles[i].close > triggerHigh && volRatioSeries[i] >= 1.1) {
      breakoutIndex = i;
      breakoutDirection = "UP";
      break;
    }
    if (candles[i].close < triggerLow) {
      breakoutIndex = i;
      breakoutDirection = "DOWN";
      break;
    }
  }

  const state: StrategySignalState =
    breakoutDirection === "UP" ? "CONFIRMED" : breakoutDirection === "NONE" ? "POTENTIAL" : "NONE";
  const score = clamp(
    Math.round((state === "CONFIRMED" ? 78 : state === "POTENTIAL" ? 54 : 20) + (breakoutDirection === "UP" ? 10 : 0)),
    0,
    100,
  );
  const confidence = clamp(
    Math.round(
      40 +
        (state === "CONFIRMED" ? 24 : state === "POTENTIAL" ? 10 : -10) +
        (breakoutIndex != null ? Math.min(14, volRatioSeries[breakoutIndex] * 4) : 0),
    ),
    0,
    100,
  );

  const reasons = [
    `NR7+인사이드바 세팅이 ${candles[setupIndex].time.slice(0, 10)}에 형성됐습니다.`,
    `상단 트리거 ${Math.round(triggerHigh).toLocaleString("ko-KR")}원 / 하단 ${Math.round(triggerLow).toLocaleString("ko-KR")}원입니다.`,
    breakoutDirection === "UP"
      ? `상단 돌파가 ${candles[breakoutIndex as number].time.slice(0, 10)}에 확인됐습니다.`
      : breakoutDirection === "DOWN"
        ? `하단 이탈이 ${candles[breakoutIndex as number].time.slice(0, 10)}에 발생했습니다.`
        : "아직 방향성 돌파가 나오지 않았습니다.",
  ];
  const warnings: string[] = [];
  if (breakoutDirection === "DOWN") warnings.push("하방 이탈이 발생해 상승 시나리오는 무효입니다.");
  if (state === "POTENTIAL") warnings.push("돌파 확인 전까지는 대기 우선이 유리합니다.");

  return {
    card: {
      id: "nr7_insidebar_v1",
      displayName: "NR7+인사이드바 변동성 수축 돌파",
      detected: state !== "NONE",
      state,
      score,
      confidence,
      setupDate: candles[setupIndex].time,
      triggerHigh: safeRound(triggerHigh),
      triggerLow: safeRound(triggerLow),
      breakoutDate: breakoutIndex != null ? candles[breakoutIndex].time : null,
      breakoutDirection,
      summary:
        state === "CONFIRMED"
          ? "변동성 수축 이후 상단 돌파가 확인됐습니다."
          : state === "POTENTIAL"
            ? "세팅은 형성됐고 돌파 대기 구간입니다."
            : "세팅은 있었으나 하방 이탈로 상승 시나리오가 약화됐습니다.",
      reasons: reasons.slice(0, 6),
      warnings: warnings.slice(0, 3),
    },
    overlay: {
      markers: [
        {
          time: candles[setupIndex].time,
          price: safeRound(candles[setupIndex].close),
          label: "NR7",
          shape: "square",
          color: "#57a3ff",
        },
        breakoutIndex != null
          ? {
              time: candles[breakoutIndex].time,
              price: safeRound(candles[breakoutIndex].close),
              label: breakoutDirection === "UP" ? "NR7 BRK" : "NR7 DN",
              shape: breakoutDirection === "UP" ? "arrowUp" : "arrowDown",
              color: breakoutDirection === "UP" ? "#00c389" : "#ff5a76",
            }
          : {
              time: null,
              price: null,
              label: "NR7 BRK",
              shape: "arrowUp",
              color: "#00c389",
            },
      ],
      lines: [
        { price: safeRound(triggerHigh), label: "NR7 상단", style: "dashed", color: "rgba(87,163,255,0.95)" },
        { price: safeRound(triggerLow), label: "NR7 하단", style: "dotted", color: "rgba(87,163,255,0.7)" },
      ],
    },
  };
};

const detectTrendTemplate = (candles: Candle[]): { card: TrendTemplateCard; overlay: SimpleStrategyOverlay } => {
  if (candles.length < 210) {
    return {
      card: defaultTrendTemplateCard("추세 템플릿 분석에 필요한 장기 데이터(210봉)가 부족합니다."),
      overlay: defaultOverlay(),
    };
  }
  const closes = candles.map((item) => item.close);
  const ma50Series = sma(closes, 50);
  const ma150Series = sma(closes, 150);
  const ma200Series = sma(closes, 200);
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const ma50 = ma50Series[latestIndex];
  const ma150 = ma150Series[latestIndex];
  const ma200 = ma200Series[latestIndex];
  const ma200Past = ma200Series[Math.max(0, latestIndex - 20)];
  const sample252 = candles.slice(-252);
  const high52w = Math.max(...sample252.map((item) => item.high));
  const low52w = Math.min(...sample252.map((item) => item.low));
  const nearHighPct = high52w > 0 ? (latest.close / high52w) * 100 : null;
  const condClose50 = ma50 != null && latest.close > ma50;
  const cond50_150 = ma50 != null && ma150 != null && ma50 > ma150;
  const cond150_200 = ma150 != null && ma200 != null && ma150 > ma200;
  const cond200Up = ma200 != null && ma200Past != null && ma200 >= ma200Past;
  const condNearHigh = high52w > 0 && latest.close >= high52w * 0.9;
  const condAboveLow = low52w > 0 && latest.close >= low52w * 1.25;

  const passCount = [
    condClose50,
    cond50_150,
    cond150_200,
    cond200Up,
    condNearHigh,
    condAboveLow,
  ].filter(Boolean).length;
  const state: StrategySignalState =
    passCount >= 5 ? "CONFIRMED" : passCount >= 3 ? "POTENTIAL" : "NONE";
  const score = clamp(Math.round(passCount * 14 + (state === "CONFIRMED" ? 12 : state === "POTENTIAL" ? 6 : 0)), 0, 100);
  const confidence = clamp(
    Math.round(42 + passCount * 8 + (condNearHigh ? 8 : 0) + (cond200Up ? 6 : -6)),
    0,
    100,
  );

  const reasons = [
    `MA50/150/200 정렬: ${condClose50 ? "C>50 " : "C<=50 "}${cond50_150 ? "50>150 " : "50<=150 "}${cond150_200 ? "150>200" : "150<=200"}`,
    `MA200 기울기: ${cond200Up ? "상향 유지" : "둔화/하향"}입니다.`,
    `52주 고점 대비 ${(nearHighPct ?? 0).toFixed(2)}% 위치입니다.`,
    condNearHigh ? "52주 고점 근접 조건을 충족합니다." : "52주 고점 근접 조건은 미충족입니다.",
  ];
  const warnings: string[] = [];
  if (!condNearHigh) warnings.push("고점 근접성이 낮아 강한 리더십 해석은 보수적으로 봐야 합니다.");
  if (!cond200Up) warnings.push("장기 평균선 기울기가 약해 추세 템플릿 확신도가 낮습니다.");

  return {
    card: {
      id: "trend_template_v1",
      displayName: "추세 템플릿 + RS 필터",
      detected: state !== "NONE",
      state,
      score,
      confidence,
      ma50: safeRound(ma50),
      ma150: safeRound(ma150),
      ma200: safeRound(ma200),
      high52w: safeRound(high52w),
      low52w: safeRound(low52w),
      nearHigh52wPct: safeRound(nearHighPct),
      summary:
        state === "CONFIRMED"
          ? "정배열·장기 기울기·52주 고점 근접이 동시에 충족된 추세 템플릿입니다."
          : state === "POTENTIAL"
            ? "추세 템플릿 조건 일부가 충족된 후보 구간입니다."
            : "장기 정렬/리더십 조건이 부족합니다.",
      reasons: reasons.slice(0, 6),
      warnings: warnings.slice(0, 3),
    },
    overlay: {
      markers: [
        state !== "NONE"
          ? {
              time: candles[latestIndex].time,
              price: safeRound(latest.close),
              label: "TREND",
              shape: "circle",
              color: state === "CONFIRMED" ? "#00c389" : "#57a3ff",
            }
          : { time: null, price: null, label: "TREND", shape: "circle", color: "#57a3ff" },
      ],
      lines: [
        { price: safeRound(high52w), label: "52주 고점", style: "dashed", color: "rgba(226,173,34,0.95)" },
        { price: safeRound(ma50), label: "추세 MA50", style: "solid", color: "rgba(87,163,255,0.95)" },
      ],
    },
  };
};

const isSwingLow = (candles: Candle[], index: number, l = 3): boolean => {
  if (index < l || index > candles.length - l - 1) return false;
  const current = candles[index].low;
  for (let i = index - l; i <= index + l; i += 1) {
    if (i === index) continue;
    if (candles[i].low <= current) return false;
  }
  return true;
};

const detectRsiDivergence = (
  candles: Candle[],
  rsiSeries: Array<number | null>,
  volRatioSeries: number[],
): { card: RsiDivergenceCard; overlay: SimpleStrategyOverlay } => {
  if (candles.length < 80) {
    return {
      card: defaultRsiDivCard("RSI 다이버전스 분석에 필요한 데이터가 부족합니다."),
      overlay: defaultOverlay(),
    };
  }
  const start = Math.max(3, candles.length - 120);
  const swingLows: number[] = [];
  for (let i = start; i < candles.length - 3; i += 1) {
    if (isSwingLow(candles, i, 3)) swingLows.push(i);
  }
  if (swingLows.length < 2) {
    return {
      card: defaultRsiDivCard("유의미한 스윙 저점 2개를 찾지 못했습니다."),
      overlay: defaultOverlay(),
    };
  }

  const low2 = swingLows[swingLows.length - 1];
  let low1 = swingLows[swingLows.length - 2];
  for (let i = swingLows.length - 2; i >= 0; i -= 1) {
    if (candles[swingLows[i]].low > candles[low2].low) {
      low1 = swingLows[i];
      break;
    }
  }

  const priceLowerLow = candles[low2].low < candles[low1].low * 0.995;
  const rsi1 = rsiSeries[low1];
  const rsi2 = rsiSeries[low2];
  const rsiHigherLow = rsi1 != null && rsi2 != null ? rsi2 > rsi1 + 1 : false;

  let neckline: number | null = null;
  if (low2 - low1 >= 3) {
    neckline = Math.max(...candles.slice(low1 + 1, low2).map((item) => item.high));
  }
  const latestIndex = candles.length - 1;
  const breakout =
    neckline != null && candles[latestIndex].close > neckline && volRatioSeries[latestIndex] >= 1.15;
  const divergence = priceLowerLow && rsiHigherLow && neckline != null;
  const state: StrategySignalState = divergence ? (breakout ? "CONFIRMED" : "POTENTIAL") : "NONE";
  const score = clamp(
    Math.round((divergence ? 58 : 20) + (breakout ? 24 : 0) + (rsiHigherLow ? 10 : 0)),
    0,
    100,
  );
  const confidence = clamp(
    Math.round(34 + (divergence ? 24 : 0) + (breakout ? 18 : 0) + (volRatioSeries[latestIndex] >= 1.3 ? 8 : 0)),
    0,
    100,
  );

  const reasons = [
    divergence
      ? "가격은 저점을 낮췄지만 RSI는 저점을 높이며 강세 다이버전스가 형성됐습니다."
      : "가격/RSI 저점 구조가 다이버전스 조건을 완전히 충족하지 않았습니다.",
    `저점1 ${candles[low1].time.slice(0, 10)}(${Math.round(candles[low1].low).toLocaleString("ko-KR")}원, RSI ${rsi1?.toFixed(2) ?? "-"})`,
    `저점2 ${candles[low2].time.slice(0, 10)}(${Math.round(candles[low2].low).toLocaleString("ko-KR")}원, RSI ${rsi2?.toFixed(2) ?? "-"})`,
    neckline != null
      ? `넥라인 ${Math.round(neckline).toLocaleString("ko-KR")}원 ${breakout ? "상향 돌파" : "돌파 대기"} 상태입니다.`
      : "넥라인 계산 구간이 부족합니다.",
  ];
  const warnings: string[] = [];
  if (divergence && !breakout) warnings.push("넥라인 돌파 전까지는 후보 신호로만 해석해야 합니다.");
  if (!divergence) warnings.push("다이버전스가 약해 단독 매매 근거로 사용하기 어렵습니다.");

  return {
    card: {
      id: "rsi_divergence_v1",
      displayName: "RSI 다이버전스 + 넥라인 돌파",
      detected: state !== "NONE",
      state,
      score,
      confidence,
      low1Date: candles[low1].time,
      low2Date: candles[low2].time,
      low1Price: safeRound(candles[low1].low),
      low2Price: safeRound(candles[low2].low),
      rsiLow1: safeRound(rsi1 ?? null),
      rsiLow2: safeRound(rsi2 ?? null),
      neckline: safeRound(neckline),
      breakoutDate: breakout ? candles[latestIndex].time : null,
      summary:
        state === "CONFIRMED"
          ? "강세 다이버전스 이후 넥라인 돌파가 확인됐습니다."
          : state === "POTENTIAL"
            ? "다이버전스는 형성됐고 넥라인 돌파 대기 구간입니다."
            : "다이버전스 조건이 약해 관망 구간입니다.",
      reasons: reasons.slice(0, 6),
      warnings: warnings.slice(0, 3),
    },
    overlay: {
      markers: [
        {
          time: candles[low1].time,
          price: safeRound(candles[low1].low),
          label: "RSI L1",
          shape: "circle",
          color: "#57a3ff",
        },
        {
          time: candles[low2].time,
          price: safeRound(candles[low2].low),
          label: "RSI L2",
          shape: "circle",
          color: "#00c389",
        },
        breakout
          ? {
              time: candles[latestIndex].time,
              price: safeRound(candles[latestIndex].close),
              label: "RSI BRK",
              shape: "arrowUp",
              color: "#00c389",
            }
          : { time: null, price: null, label: "RSI BRK", shape: "arrowUp", color: "#00c389" },
      ],
      lines: [
        { price: safeRound(neckline), label: "다이버전스 넥라인", style: "dashed", color: "rgba(87,163,255,0.95)" },
      ],
    },
  };
};

const computeObvSlope = (candles: Candle[]): number => {
  if (candles.length < 25) return 0;
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const diff = candles[i].close - candles[i - 1].close;
    const next =
      obv[i - 1] + (diff > 0 ? candles[i].volume : diff < 0 ? -candles[i].volume : 0);
    obv.push(next);
  }
  const last = obv[obv.length - 1];
  const prev = obv[Math.max(0, obv.length - 21)];
  const base = Math.max(1, Math.abs(prev));
  return (last - prev) / base;
};

const detectFlowPersistence = (
  candles: Candle[],
  flow: FlowSignal | null | undefined,
  ma20Series: Array<number | null>,
  ma60Series: Array<number | null>,
): { card: FlowPersistenceCard; overlay: SimpleStrategyOverlay } => {
  if (candles.length < 40) {
    return {
      card: defaultFlowCard("수급 지속성 전략 계산에 필요한 데이터가 부족합니다."),
      overlay: defaultOverlay(),
    };
  }
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const ma20 = ma20Series[latestIndex];
  const ma60 = ma60Series[latestIndex];
  const sample20 = candles.slice(-20);
  let upVolume = 0;
  let totalVolume = 0;
  for (let i = 1; i < sample20.length; i += 1) {
    const volume = sample20[i].volume;
    totalVolume += volume;
    if (sample20[i].close > sample20[i - 1].close) upVolume += volume;
  }
  const upVolumeRatio20 = totalVolume > 0 ? upVolume / totalVolume : 0;
  const obvSlope20 = computeObvSlope(candles.slice(-45));

  const hasFlowData = !!flow && flow.label !== "N/A";
  let state: StrategySignalState = "NONE";
  let score = 0;
  let confidence = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (hasFlowData) {
    const foreignPlus = (flow?.foreignNet ?? 0) > 0;
    const instPlus = (flow?.institutionNet ?? 0) > 0;
    const progPlus = (flow?.programNet ?? 0) >= 0;
    const closeGuard = ma20 != null ? latest.close >= ma20 : false;
    if (foreignPlus && instPlus && progPlus && closeGuard) {
      state = "CONFIRMED";
      score = 82;
      confidence = 78;
    } else if ((foreignPlus || instPlus) && closeGuard) {
      state = "POTENTIAL";
      score = 60;
      confidence = 64;
    } else {
      state = "NONE";
      score = 28;
      confidence = 34;
    }
    reasons.push(
      `외인 ${flow?.foreignNet != null ? Math.round(flow.foreignNet).toLocaleString("ko-KR") : "-"}주, 기관 ${flow?.institutionNet != null ? Math.round(flow.institutionNet).toLocaleString("ko-KR") : "-"}주입니다.`,
    );
    reasons.push(
      `프로그램 순매수 ${flow?.programNet != null ? Math.round(flow.programNet).toLocaleString("ko-KR") : "-"}주입니다.`,
    );
  } else {
    const upVolumePass = upVolumeRatio20 >= 0.62;
    const obvPass = obvSlope20 >= 0.05;
    const trendPass = ma20 != null && ma60 != null ? latest.close >= ma20 && ma20 >= ma60 : latest.close >= (ma20 ?? latest.close);
    if (upVolumePass && obvPass && trendPass) {
      state = "CONFIRMED";
      score = 78;
      confidence = 70;
    } else if (upVolumeRatio20 >= 0.55 && obvSlope20 >= 0) {
      state = "POTENTIAL";
      score = 56;
      confidence = 58;
    } else {
      state = "NONE";
      score = 24;
      confidence = 30;
    }
    reasons.push(`최근 20봉 상승일 거래량 비중은 ${(upVolumeRatio20 * 100).toFixed(2)}%입니다.`);
    reasons.push(`OBV 20봉 기울기는 ${(obvSlope20 * 100).toFixed(2)}%입니다.`);
    warnings.push("외인/기관 원천 수급 데이터가 부족해 가격·거래량 프록시로 계산했습니다.");
  }

  reasons.push(
    ma20 != null && ma60 != null
      ? `추세 방어: 종가 ${Math.round(latest.close).toLocaleString("ko-KR")}원, MA20 ${Math.round(ma20).toLocaleString("ko-KR")}원, MA60 ${Math.round(ma60).toLocaleString("ko-KR")}원`
      : "추세 방어선(MA20/MA60) 데이터가 일부 부족합니다.",
  );
  if (state === "NONE") warnings.push("수급 지속성 신호가 약해 추격보다 관망이 유리합니다.");

  return {
    card: {
      id: "flow_persistence_v1",
      displayName: "기관/외인 수급 지속성 추종",
      detected: state !== "NONE",
      state,
      score: clamp(score, 0, 100),
      confidence: clamp(confidence, 0, 100),
      upVolumeRatio20: safeRound(upVolumeRatio20 * 100),
      obvSlope20: safeRound(obvSlope20 * 100),
      flowSignalUsed: hasFlowData,
      foreignNet: flow?.foreignNet ?? null,
      institutionNet: flow?.institutionNet ?? null,
      programNet: flow?.programNet ?? null,
      summary:
        state === "CONFIRMED"
          ? "수급/거래량 지속성 신호가 누적된 상태입니다."
          : state === "POTENTIAL"
            ? "지속성 신호가 부분적으로 형성된 후보 구간입니다."
            : "수급 지속성 신호가 부족합니다.",
      reasons: reasons.slice(0, 6),
      warnings: warnings.slice(0, 3),
    },
    overlay: {
      markers: [
        state !== "NONE"
          ? {
              time: latest.time,
              price: safeRound(latest.close),
              label: "FLOW",
              shape: "circle",
              color: state === "CONFIRMED" ? "#00c389" : "#57a3ff",
            }
          : { time: null, price: null, label: "FLOW", shape: "circle", color: "#57a3ff" },
      ],
      lines: [
        { price: safeRound(ma20), label: "수급 MA20", style: "dashed", color: "rgba(0,179,134,0.85)" },
      ],
    },
  };
};

export const detectExtraStrategies = (
  candles: Candle[],
  flowSignal?: FlowSignal | null,
): ExtraStrategiesResult => {
  if (candles.length < 40) {
    return {
      cards: {
        darvasRetest: defaultDarvasCard("전략 계산에 필요한 데이터가 부족합니다."),
        nr7InsideBar: defaultNr7Card("전략 계산에 필요한 데이터가 부족합니다."),
        trendTemplate: defaultTrendTemplateCard("전략 계산에 필요한 데이터가 부족합니다."),
        rsiDivergence: defaultRsiDivCard("전략 계산에 필요한 데이터가 부족합니다."),
        flowPersistence: defaultFlowCard("전략 계산에 필요한 데이터가 부족합니다."),
      },
      overlays: {
        darvasRetest: defaultOverlay(),
        nr7InsideBar: defaultOverlay(),
        trendTemplate: defaultOverlay(),
        rsiDivergence: defaultOverlay(),
        flowPersistence: defaultOverlay(),
      },
    };
  }

  const closes = candles.map((item) => item.close);
  const volumes = candles.map((item) => item.volume);
  const ma20Series = sma(closes, 20);
  const ma60Series = sma(closes, 60);
  const volMa20Series = sma(volumes, 20);
  const rsiSeries = rsi(closes, 14);
  const volRatioSeries = candles.map((item, index) => {
    const ma = volMa20Series[index];
    if (ma == null || ma <= 0) return 1;
    return item.volume / ma;
  });

  const darvas = detectDarvasRetest(candles, volRatioSeries);
  const nr7 = detectNr7InsideBar(candles, volRatioSeries);
  const trendTemplate = detectTrendTemplate(candles);
  const rsiDiv = detectRsiDivergence(candles, rsiSeries, volRatioSeries);
  const flow = detectFlowPersistence(candles, flowSignal, ma20Series, ma60Series);

  return {
    cards: {
      darvasRetest: darvas.card,
      nr7InsideBar: nr7.card,
      trendTemplate: trendTemplate.card,
      rsiDivergence: rsiDiv.card,
      flowPersistence: flow.card,
    },
    overlays: {
      darvasRetest: darvas.overlay,
      nr7InsideBar: nr7.overlay,
      trendTemplate: trendTemplate.overlay,
      rsiDivergence: rsiDiv.overlay,
      flowPersistence: flow.overlay,
    },
  };
};

export const emptyExtraStrategies = (
  reason: string,
): ExtraStrategiesResult => ({
  cards: {
    darvasRetest: defaultDarvasCard(reason),
    nr7InsideBar: defaultNr7Card(reason),
    trendTemplate: defaultTrendTemplateCard(reason),
    rsiDivergence: defaultRsiDivCard(reason),
    flowPersistence: defaultFlowCard(reason),
  },
  overlays: {
    darvasRetest: defaultOverlay(),
    nr7InsideBar: defaultOverlay(),
    trendTemplate: defaultOverlay(),
    rsiDivergence: defaultOverlay(),
    flowPersistence: defaultOverlay(),
  },
});
