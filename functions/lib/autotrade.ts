
import { getCachedJson } from "./cache";
import {
  normalizeAutotradeCapitalMode,
  normalizeFixedCapitalWon,
  resolveAutotradeCapitalConfig,
} from "./autotradeCapital";
import { atr, sma } from "./indicators";
import { fetchTimeframeCandles, kisFetch, type KisResponseBase } from "./kis";
import { nowIsoKst } from "./market";
import type { RequestMetrics } from "./observability";
import { getPersistedJson } from "./screenerPersistence";
import {
  persistScreenerDateKey,
  persistScreenerLastSuccessKey,
  screenerDateKey,
  screenerLastSuccessKey,
  type ScreenerSnapshot,
} from "./screenerStore";
import type {
  AutotradeCandidate,
  AutotradeDailyState,
  AutotradeExecutionResult,
  AutotradeCapitalConfig,
  AutotradeMarketFilter,
  AutotradeOpenPosition,
  AutotradePayload,
  AutotradeRunOptions,
  AutotradeRunSummary,
  Env,
  WashoutPullbackCard,
} from "./types";
import { clamp, round2 } from "./utils";
import { detectWashoutPullback } from "./washoutPullback";
import type { ScreenerStoredCandidate } from "./screener";

const AUTOTRADE_VERSION = "autotrade-washout-v1";
const MAX_CONCURRENT_POSITIONS = 2;
const MAX_STOP_PCT = 0.05;
const MAX_HOLD_DAYS = 10;
const REENTRY_COOLDOWN_DAYS = 3;
const MIN_UNIVERSE = 200;
const MAX_UNIVERSE = 500;
const DEFAULT_UNIVERSE = 200;
const MIN_CANDLES = 240;
const AVG_TURNOVER_MIN = 700_000_000;

const COOLDOWNS_KEY = "autotrade:cooldowns";
const OPEN_POSITIONS_KEY = "autotrade:positions:open";
const LOG_PREFIX = "autotrade:logs:";
const DAILY_STATE_PREFIX = "autotrade:state:";

interface OrderCashResponse extends KisResponseBase {
  output?: Record<string, string>;
}

interface LoggerEvent {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface SignalResult {
  passed: boolean;
  score: number;
  confidence: number;
  reasons: string[];
  triggerType: "A" | "B" | "C" | "N/A";
  entryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  riskPct: number;
  washout: WashoutPullbackCard;
}

interface CandidateScanContext {
  symbol: string;
  name: string;
  market: string;
  candles: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

interface RiskPlan {
  qty: number;
  investedWon: number;
  riskWon: number;
  riskPerShare: number;
  rejectedReason?: string;
}

interface CooldownState {
  [code: string]: string;
}

const todayKstDate = (): string => nowIsoKst().slice(0, 10);

const addDays = (dateText: string, delta: number): string => {
  const base = new Date(`${dateText}T00:00:00+09:00`);
  const next = new Date(base.getTime() + delta * 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
};

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const pickTodayDailyState = (
  date: string,
  existing: AutotradeDailyState | null,
): AutotradeDailyState => {
  if (existing && existing.date === date) return existing;
  return {
    date,
    dailyLossWon: 0,
    realizedPnlWon: 0,
    blockedByDailyLoss: false,
    newBuyCount: 0,
    stopExitCount: 0,
    targetExitCount: 0,
    timeoutExitCount: 0,
    updatedAt: nowIsoKst(),
  };
};

const normalizeUniverseSize = (raw: number | null | undefined): number => {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_UNIVERSE;
  return Math.max(MIN_UNIVERSE, Math.min(MAX_UNIVERSE, Math.floor(raw)));
};

const loadCandidatesFromSnapshot = async (
  env: Env,
  cache: Cache,
  market: AutotradeMarketFilter,
  universeSize: number,
): Promise<{ candidates: ScreenerStoredCandidate[]; warnings: string[]; sourceDate: string | null }> => {
  const warnings: string[] = [];
  const today = todayKstDate();
  let snapshot = await getCachedJson<ScreenerSnapshot>(cache, screenerDateKey(today));

  if (!snapshot) {
    snapshot = await getCachedJson<ScreenerSnapshot>(cache, screenerLastSuccessKey());
  }
  if (!snapshot) {
    snapshot = await getPersistedJson<ScreenerSnapshot>(env, persistScreenerDateKey(today));
  }
  if (!snapshot) {
    snapshot = await getPersistedJson<ScreenerSnapshot>(env, persistScreenerLastSuccessKey());
  }

  if (!snapshot) {
    return {
      candidates: [],
      warnings: [
        "스크리너 스냅샷이 없어 자동매매 후보를 구성하지 못했습니다. 먼저 /api/admin/rebuild-screener 실행이 필요합니다.",
      ],
      sourceDate: null,
    };
  }

  const filtered = snapshot.candidates.filter((item) => (market === "ALL" ? true : item.market === market));
  const excludedByName = /(관리|투자주의|스팩|ETF|ETN|인버스|레버리지|우선주|리츠)/;
  const eligible = filtered
    .filter((item) => !excludedByName.test(item.name))
    .sort(
      (a, b) =>
        b.scoring.washoutPullback.score - a.scoring.washoutPullback.score ||
        b.scoring.all.score - a.scoring.all.score ||
        b.scoring.all.confidence - a.scoring.all.confidence,
    )
    .slice(0, normalizeUniverseSize(universeSize));

  if (eligible.length === 0) {
    warnings.push("유니버스 필터 조건에 맞는 종목이 없습니다.");
  }

  return {
    candidates: eligible,
    warnings,
    sourceDate: snapshot.date,
  };
};

class StrategyLogger {
  private readonly events: LoggerEvent[] = [];

  info(message: string): void {
    this.events.push({ ts: nowIsoKst(), level: "info", message });
  }

  warn(message: string): void {
    this.events.push({ ts: nowIsoKst(), level: "warn", message });
  }

  error(message: string): void {
    this.events.push({ ts: nowIsoKst(), level: "error", message });
  }

  toMessages(limit = 100): string[] {
    return this.events.slice(-limit).map((item) => `[${item.level}] ${item.ts} ${item.message}`);
  }
}
class SignalEngine {
  evaluate(context: CandidateScanContext): SignalResult {
    const { candles } = context;
    if (candles.length < MIN_CANDLES) {
      return {
        passed: false,
        score: 0,
        confidence: 0,
        reasons: [`일봉 데이터 부족(${candles.length}/${MIN_CANDLES})`],
        triggerType: "N/A",
        entryPrice: 0,
        stopPrice: 0,
        target1Price: 0,
        target2Price: 0,
        riskPct: 0,
        washout: detectWashoutPullback(candles).card,
      };
    }

    const latest = candles[candles.length - 1];
    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);
    const turnover = candles.map((candle) => candle.close * candle.volume);

    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60);
    const ma20Vol = sma(volumes, 20);
    const ma20Turnover = sma(turnover, 20);
    const atr14 = atr(candles, 14);
    const latestIndex = candles.length - 1;

    const ma20Now = ma20[latestIndex];
    const ma60Now = ma60[latestIndex];
    const volMa20Now = ma20Vol[latestIndex];
    const atrNow = atr14[latestIndex];

    const washout = detectWashoutPullback(candles).card;

    const trendUp =
      ma20Now != null &&
      ma60Now != null &&
      latest.close > ma60Now &&
      ma20Now > ma60Now;

    const recent20Start = Math.max(20, latestIndex - 19);
    let maxTurnoverRatio20 = 0;
    for (let i = recent20Start; i <= latestIndex; i += 1) {
      const base = ma20Turnover[i];
      if (base != null && base > 0) {
        maxTurnoverRatio20 = Math.max(maxTurnoverRatio20, turnover[i] / base);
      }
    }
    const hasTurnoverTrace =
      maxTurnoverRatio20 >= 1.8 ||
      washout.state === "WASHOUT_CANDIDATE" ||
      washout.state === "PULLBACK_READY" ||
      washout.state === "REBOUND_CONFIRMED";

    const correctionWindowStart = Math.max(30, latestIndex - 15);
    const correctionSlice = candles.slice(correctionWindowStart, latestIndex + 1);
    let localHigh = -1;
    let localHighIndex = -1;
    for (let i = 0; i < correctionSlice.length; i += 1) {
      if (correctionSlice[i].high > localHigh) {
        localHigh = correctionSlice[i].high;
        localHighIndex = correctionWindowStart + i;
      }
    }
    const barsSinceHigh = latestIndex - localHighIndex;
    const correctionBarsOk = barsSinceHigh >= 3 && barsSinceHigh <= 10;
    const correctionPct = localHigh > 0 ? (localHigh - latest.close) / localHigh : 0;
    const correctionOk = correctionBarsOk && correctionPct >= 0.03;

    const correctionStart = Math.max(localHighIndex + 1, latestIndex - 10);
    const correctionVolumes = volumes.slice(correctionStart, latestIndex + 1);
    const preVolumes = volumes.slice(Math.max(0, localHighIndex - 20), localHighIndex);
    const volumeDecline =
      correctionVolumes.length >= 3 &&
      preVolumes.length >= 5 &&
      average(correctionVolumes) <= average(preVolumes) * 0.85;

    const range = Math.max(0.0001, latest.high - latest.low);
    const lowerWick = Math.min(latest.open, latest.close) - latest.low;
    const lowerWickPct = clamp(lowerWick / range, 0, 1);
    const support20 = Math.min(...candles.slice(Math.max(0, latestIndex - 19), latestIndex + 1).map((item) => item.low));

    const triggerA =
      latest.close > latest.open &&
      volMa20Now != null &&
      volMa20Now > 0 &&
      latest.volume >= volMa20Now * 1.05;

    const triggerB =
      ma20Now != null &&
      lowerWickPct >= 0.4 &&
      (latest.low <= ma20Now * 1.01 || latest.low <= support20 * 1.01) &&
      latest.close >= ma20Now * 0.995;

    const prev5High = Math.max(...candles.slice(Math.max(0, latestIndex - 5), latestIndex).map((item) => item.high));
    const triggerC =
      volMa20Now != null &&
      volMa20Now > 0 &&
      latest.close > prev5High &&
      latest.volume >= volMa20Now;

    let triggerType: "A" | "B" | "C" | "N/A" = "N/A";
    if (triggerA) triggerType = "A";
    else if (triggerB) triggerType = "B";
    else if (triggerC) triggerType = "C";

    const recentSwingLow = Math.min(...candles.slice(Math.max(0, latestIndex - 10), latestIndex + 1).map((item) => item.low));
    const invalidLowCandidate = washout.entryPlan.invalidLow ?? null;
    const stopBase =
      invalidLowCandidate != null && Number.isFinite(invalidLowCandidate)
        ? Math.min(invalidLowCandidate, recentSwingLow)
        : recentSwingLow;
    const stopPrice = Math.max(stopBase, latest.close * (1 - MAX_STOP_PCT));
    const riskPerShare = Math.max(0, latest.close - stopPrice);
    const riskPct = latest.close > 0 ? (riskPerShare / latest.close) * 100 : 0;

    const target1Price = latest.close + riskPerShare;
    const target2Price = latest.close + riskPerShare * 2;

    const reasons: string[] = [];
    reasons.push(
      trendUp
        ? "종가가 MA60 위이고 MA20 > MA60 추세 조건을 충족했습니다."
        : "추세 조건(close>MA60, MA20>MA60)을 충족하지 못했습니다.",
    );
    reasons.push(
      hasTurnoverTrace
        ? `최근 거래대금 유입 흔적이 있습니다(20일 최대 ${round2(maxTurnoverRatio20)}배).`
        : "최근 거래대금 유입(스파이크/재유입) 흔적이 약합니다.",
    );
    reasons.push(
      correctionOk
        ? `최근 ${barsSinceHigh}봉 조정(${round2(correctionPct * 100)}%)이 확인됐습니다.`
        : "최근 3~10봉 조정 구조가 약해 눌림 판단이 어렵습니다.",
    );
    reasons.push(
      volumeDecline ? "조정 구간 거래량이 감소해 매물 소화 신호가 보입니다." : "조정 구간 거래량 감소가 약합니다.",
    );
    reasons.push(
      triggerType === "A"
        ? "A 조건(양봉 전환 + 거래량 회복)이 확인됐습니다."
        : triggerType === "B"
          ? "B 조건(MA20/지지존 부근 아래꼬리 후 종가 회복)이 확인됐습니다."
          : triggerType === "C"
            ? "C 조건(단기 고점 재돌파 + 거래량 평균 이상)이 확인됐습니다."
            : "A/B/C 진입 트리거가 아직 부족합니다.",
    );

    let score = 0;
    if (trendUp) score += 30;
    if (hasTurnoverTrace) score += 20;
    if (correctionOk) score += 15;
    if (volumeDecline) score += 15;
    if (triggerType !== "N/A") score += 10;
    if (washout.state === "PULLBACK_READY" || washout.state === "REBOUND_CONFIRMED") score += 10;

    let confidence = 55;
    if (maxTurnoverRatio20 >= 3) confidence += 10;
    else if (maxTurnoverRatio20 >= 1.8) confidence += 5;

    if (barsSinceHigh < 3 || barsSinceHigh > 12) confidence -= 8;
    if (volumeDecline) confidence += 6;

    const atrPct = atrNow != null && latest.close > 0 ? (atrNow / latest.close) * 100 : null;
    if (atrPct != null && atrPct > 6) confidence -= 15;
    else if (atrPct != null && atrPct > 4.5) confidence -= 8;

    const avgTurnover20 = average(turnover.slice(-20));
    if (avgTurnover20 < AVG_TURNOVER_MIN) confidence -= 10;

    const passed =
      trendUp && hasTurnoverTrace && correctionOk && volumeDecline && triggerType !== "N/A" && riskPerShare > 0;

    return {
      passed,
      score: Math.round(clamp(score, 0, 100)),
      confidence: Math.round(clamp(confidence, 0, 100)),
      reasons,
      triggerType,
      entryPrice: round2(latest.close) ?? latest.close,
      stopPrice: round2(stopPrice) ?? stopPrice,
      target1Price: round2(target1Price) ?? target1Price,
      target2Price: round2(target2Price) ?? target2Price,
      riskPct: round2(riskPct) ?? riskPct,
      washout,
    };
  }
}

class RiskEngine {
  constructor(private readonly capital: AutotradeCapitalConfig) {}

  plan(entryPrice: number, stopPrice: number): RiskPlan {
    if (!Number.isFinite(entryPrice) || !Number.isFinite(stopPrice) || entryPrice <= 0 || stopPrice <= 0) {
      return {
        qty: 0,
        investedWon: 0,
        riskWon: 0,
        riskPerShare: 0,
        rejectedReason: "진입가/손절가가 유효하지 않습니다.",
      };
    }

    const riskPerShare = entryPrice - stopPrice;
    if (riskPerShare <= 0) {
      return {
        qty: 0,
        investedWon: 0,
        riskWon: 0,
        riskPerShare,
        rejectedReason: "손절가가 진입가보다 높아 주문할 수 없습니다.",
      };
    }

    const qtyByRisk = Math.floor(this.capital.maxRiskPerTradeWon / riskPerShare);
    const qtyByCapital = Math.floor(this.capital.maxPositionWon / entryPrice);
    const qty = Math.max(0, Math.min(qtyByRisk, qtyByCapital));

    if (qty < 1) {
      return {
        qty,
        investedWon: 0,
        riskWon: 0,
        riskPerShare,
        rejectedReason: "리스크/포지션 한도 기준 수량이 1주 미만입니다.",
      };
    }

    const investedWon = qty * entryPrice;
    const riskWon = qty * riskPerShare;

    return {
      qty,
      investedWon: round2(investedWon) ?? investedWon,
      riskWon: round2(riskWon) ?? riskWon,
      riskPerShare: round2(riskPerShare) ?? riskPerShare,
    };
  }
}

class OrderExecutor {
  constructor(
    private readonly env: Env,
    private readonly metrics?: RequestMetrics,
  ) {}

  private accountConfig(): { cano: string; acntPrdtCd: string } {
    const cano = (this.env.KIS_ACCOUNT_NO ?? "").trim();
    const acntPrdtCd = (this.env.KIS_ACCOUNT_PRDT_CD ?? "01").trim() || "01";
    if (!cano) {
      throw new Error("KIS_ACCOUNT_NO 환경변수가 없어 주문을 실행할 수 없습니다.");
    }
    return { cano, acntPrdtCd };
  }

  async placeMarketOrder(
    side: "BUY" | "SELL",
    symbol: string,
    qty: number,
  ): Promise<{ success: boolean; message: string; orderNo: string | null }> {
    if (qty < 1) {
      return {
        success: false,
        message: "주문 수량이 1주 미만입니다.",
        orderNo: null,
      };
    }

    const account = this.accountConfig();
    const trId =
      this.env.KIS_ENV === "demo"
        ? side === "BUY"
          ? "VTTC0012U"
          : "VTTC0011U"
        : side === "BUY"
          ? "TTTC0012U"
          : "TTTC0011U";

    const { data } = await kisFetch<OrderCashResponse>(
      this.env,
      "/uapi/domestic-stock/v1/trading/order-cash",
      {
        method: "POST",
        trId,
        metrics: this.metrics,
        body: {
          CANO: account.cano,
          ACNT_PRDT_CD: account.acntPrdtCd,
          PDNO: symbol,
          ORD_DVSN: "01",
          ORD_QTY: String(Math.floor(qty)),
          ORD_UNPR: "0",
        },
      },
    );

    if (data.rt_cd !== "0") {
      return {
        success: false,
        message: `KIS 주문 실패(${data.msg_cd}): ${data.msg1}`,
        orderNo: null,
      };
    }

    const orderNo = data.output?.ODNO ?? data.output?.odno ?? data.output?.KRX_FWDG_ORD_ORGNO ?? null;

    return {
      success: true,
      message: `${side === "BUY" ? "매수" : "매도"} 주문 접수 완료`,
      orderNo,
    };
  }
}
class PositionManager {
  constructor(private readonly env: Env) {}

  private kvEnabled(): boolean {
    return !!this.env.AUTOTRADE_KV;
  }

  async loadOpenPositions(): Promise<AutotradeOpenPosition[]> {
    if (!this.kvEnabled()) return [];
    const row = await this.env.AUTOTRADE_KV!.get(OPEN_POSITIONS_KEY, { type: "json" });
    return Array.isArray(row) ? (row as AutotradeOpenPosition[]) : [];
  }

  async saveOpenPositions(positions: AutotradeOpenPosition[]): Promise<void> {
    if (!this.kvEnabled()) return;
    await this.env.AUTOTRADE_KV!.put(OPEN_POSITIONS_KEY, JSON.stringify(positions));
  }

  async loadCooldowns(): Promise<CooldownState> {
    if (!this.kvEnabled()) return {};
    const row = await this.env.AUTOTRADE_KV!.get(COOLDOWNS_KEY, { type: "json" });
    if (!row || typeof row !== "object") return {};
    return row as CooldownState;
  }

  async saveCooldowns(cooldowns: CooldownState): Promise<void> {
    if (!this.kvEnabled()) return;
    await this.env.AUTOTRADE_KV!.put(COOLDOWNS_KEY, JSON.stringify(cooldowns));
  }

  async loadDailyState(date: string): Promise<AutotradeDailyState> {
    if (!this.kvEnabled()) return pickTodayDailyState(date, null);
    const row = await this.env.AUTOTRADE_KV!.get(`${DAILY_STATE_PREFIX}${date}`, { type: "json" });
    return pickTodayDailyState(date, (row as AutotradeDailyState | null) ?? null);
  }

  async saveDailyState(state: AutotradeDailyState): Promise<void> {
    if (!this.kvEnabled()) return;
    await this.env.AUTOTRADE_KV!.put(`${DAILY_STATE_PREFIX}${state.date}`, JSON.stringify(state), {
      expirationTtl: 14 * 24 * 60 * 60,
    });
  }

  async appendLogs(date: string, messages: string[]): Promise<void> {
    if (!this.kvEnabled() || messages.length === 0) return;
    const key = `${LOG_PREFIX}${date}`;
    const existing = (await this.env.AUTOTRADE_KV!.get(key, { type: "json" })) as string[] | null;
    const merged = [...(Array.isArray(existing) ? existing : []), ...messages].slice(-400);
    await this.env.AUTOTRADE_KV!.put(key, JSON.stringify(merged), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  }
}

const toRunSummary = (
  options: AutotradeRunOptions,
  capital: AutotradeCapitalConfig,
  sourceDate: string | null,
  dailyState: AutotradeDailyState,
  openPositions: AutotradeOpenPosition[],
  executedCount: number,
  blockedReasons: string[],
): AutotradeRunSummary => ({
  strategyId: AUTOTRADE_VERSION,
  capitalMode: capital.mode,
  capitalWon: capital.effectiveCapitalWon,
  configuredCapitalWon: capital.configuredCapitalWon,
  availableCashWon: capital.availableCashWon,
  maxRiskPerTradeWon: capital.maxRiskPerTradeWon,
  maxDailyLossWon: capital.maxDailyLossWon,
  maxPositionWon: capital.maxPositionWon,
  maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
  execute: options.execute,
  dryRun: options.dryRun,
  market: options.market,
  universeSize: options.universe,
  sourceDate,
  dailyLossWon: round2(dailyState.dailyLossWon) ?? dailyState.dailyLossWon,
  blockedByDailyLoss: dailyState.blockedByDailyLoss,
  openPositionCount: openPositions.filter((item) => item.status === "OPEN").length,
  executedCount,
  blockedReasons,
});

const evaluatePositionExit = (
  position: AutotradeOpenPosition,
  latestHigh: number,
  latestLow: number,
  latestClose: number,
  holdingDays: number,
): {
  action: "HOLD" | "EXIT_STOP" | "EXIT_TARGET1" | "EXIT_TARGET2" | "EXIT_TIMEOUT";
  exitPrice?: number;
} => {
  if (latestLow <= position.stopPrice) {
    return {
      action: "EXIT_STOP",
      exitPrice: position.stopPrice,
    };
  }

  if (!position.target1Hit && latestHigh >= position.target1Price) {
    return {
      action: "EXIT_TARGET1",
      exitPrice: position.target1Price,
    };
  }

  if (latestHigh >= position.target2Price) {
    return {
      action: "EXIT_TARGET2",
      exitPrice: position.target2Price,
    };
  }

  if (holdingDays >= MAX_HOLD_DAYS && !position.target1Hit) {
    return {
      action: "EXIT_TIMEOUT",
      exitPrice: latestClose,
    };
  }

  return { action: "HOLD" };
};

const buildCandidate = (
  base: ScreenerStoredCandidate,
  signal: SignalResult,
  riskPlan: RiskPlan,
  currentPrice: number,
): AutotradeCandidate => ({
  code: base.code,
  name: base.name,
  market: base.market,
  state: signal.washout.state,
  entryPrice: signal.entryPrice,
  stopPrice: signal.stopPrice,
  target1Price: signal.target1Price,
  target2Price: signal.target2Price,
  qty: riskPlan.qty,
  investedWon: riskPlan.investedWon,
  riskWon: riskPlan.riskWon,
  riskPct: signal.riskPct,
  score: signal.score,
  confidence: signal.confidence,
  triggerType: signal.triggerType,
  currentPrice: round2(currentPrice) ?? currentPrice,
  positionToZone:
    signal.washout.pullbackZone.low != null && signal.washout.pullbackZone.high != null
      ? currentPrice >= signal.washout.pullbackZone.low && currentPrice <= signal.washout.pullbackZone.high
        ? "IN_ZONE"
        : currentPrice > signal.washout.pullbackZone.high
          ? "ABOVE_ZONE"
          : "BELOW_ZONE"
      : "N/A",
  reasons: signal.reasons.slice(0, 6),
  warnings: [
    ...(riskPlan.rejectedReason ? [riskPlan.rejectedReason] : []),
    ...(signal.washout.warnings ?? []).slice(0, 2),
  ].slice(0, 3),
});

export const runAutoTrade = async (
  env: Env,
  cache: Cache,
  optionsInput: Partial<AutotradeRunOptions> | null,
  metrics?: RequestMetrics,
): Promise<AutotradePayload> => {
  const logger = new StrategyLogger();
  const signalEngine = new SignalEngine();
  const orderExecutor = new OrderExecutor(env, metrics);
  const positionManager = new PositionManager(env);

  const options: AutotradeRunOptions = {
    execute: optionsInput?.execute === true,
    dryRun: optionsInput?.dryRun !== false,
    market: optionsInput?.market ?? "ALL",
    universe: normalizeUniverseSize(optionsInput?.universe),
    capitalMode: normalizeAutotradeCapitalMode(optionsInput?.capitalMode),
    fixedCapitalWon: normalizeFixedCapitalWon(optionsInput?.fixedCapitalWon),
    adminToken: optionsInput?.adminToken ?? null,
  };

  const today = todayKstDate();
  const warnings: string[] = [];

  const adminTokenExpected = (env.ADMIN_TOKEN ?? "").trim();
  if (options.execute && adminTokenExpected) {
    const provided = (options.adminToken ?? "").trim();
    if (!provided || provided !== adminTokenExpected) {
      throw new Error("주문 실행에는 유효한 admin token이 필요합니다.");
    }
  }
  if (options.execute && !adminTokenExpected) {
    throw new Error("ADMIN_TOKEN 환경변수가 없어 주문 실행을 허용하지 않습니다.");
  }

  const autoTradeKvEnabled = !!env.AUTOTRADE_KV;
  if (!autoTradeKvEnabled) {
    warnings.push("AUTOTRADE_KV가 연결되지 않아 재진입 제한/일일상태/포지션 로그 영속 저장이 비활성화됩니다.");
  }

  const { config: capitalConfig, warnings: capitalWarnings } = await resolveAutotradeCapitalConfig(
    env,
    options.capitalMode,
    options.fixedCapitalWon,
    metrics,
  );
  warnings.push(...capitalWarnings);
  const riskEngine = new RiskEngine(capitalConfig);

  const { candidates: universeCandidates, warnings: universeWarnings, sourceDate } = await loadCandidatesFromSnapshot(
    env,
    cache,
    options.market,
    options.universe,
  );
  warnings.push(...universeWarnings);

  const openPositions = await positionManager.loadOpenPositions();
  const cooldowns = await positionManager.loadCooldowns();
  const dailyState = await positionManager.loadDailyState(today);

  const blockedReasons: string[] = [];
  if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) {
    dailyState.blockedByDailyLoss = true;
    blockedReasons.push(`일일 손실 한도(${capitalConfig.maxDailyLossWon.toLocaleString("ko-KR")}원)에 도달해 신규 매수를 중지했습니다.`);
  }

  const executionResults: AutotradeExecutionResult[] = [];
  const updatedPositions: AutotradeOpenPosition[] = [];
  for (const position of openPositions) {
    if (position.status !== "OPEN") {
      updatedPositions.push(position);
      continue;
    }

    try {
      const candleData = await fetchTimeframeCandles(env, cache, position.code, "day", 60, metrics);
      const candles = candleData.candles;
      if (candles.length === 0) {
        updatedPositions.push(position);
        continue;
      }
      const latest = candles[candles.length - 1];
      const entryIndex = candles.findIndex((item) => item.time === position.entryDate);
      const holdingDays = entryIndex >= 0 ? Math.max(1, candles.length - entryIndex) : candles.length;

      const decision = evaluatePositionExit(position, latest.high, latest.low, latest.close, holdingDays);
      if (decision.action === "HOLD") {
        updatedPositions.push(position);
        continue;
      }

      if (decision.action === "EXIT_TARGET1") {
        if (!position.target1Hit) {
          const soldQty = Math.max(1, Math.floor(position.qty * 0.5));
          let orderSuccess = true;
          let orderMessage = "1R 부분익절 처리";
          let orderNo: string | null = null;

          if (options.execute && !options.dryRun) {
            const order = await orderExecutor.placeMarketOrder("SELL", position.code, soldQty);
            orderSuccess = order.success;
            orderMessage = order.message;
            orderNo = order.orderNo;
          }

          if (orderSuccess) {
            const pnl = (decision.exitPrice! - position.avgEntryPrice) * soldQty;
            position.qty = Math.max(0, position.qty - soldQty);
            position.target1Hit = true;
            position.lastUpdatedAt = nowIsoKst();
            dailyState.realizedPnlWon += round2(pnl) ?? pnl;
            if (pnl < 0) dailyState.dailyLossWon += Math.abs(round2(pnl) ?? pnl);
            dailyState.targetExitCount += 1;
            executionResults.push({
              code: position.code,
              name: position.name,
              side: "SELL",
              action: "TARGET1_PARTIAL",
              qty: soldQty,
              success: true,
              orderNo,
              message: orderMessage,
              price: decision.exitPrice!,
              at: nowIsoKst(),
            });
          } else {
            executionResults.push({
              code: position.code,
              name: position.name,
              side: "SELL",
              action: "TARGET1_PARTIAL",
              qty: soldQty,
              success: false,
              orderNo: null,
              message: orderMessage,
              price: decision.exitPrice!,
              at: nowIsoKst(),
            });
          }
        }

        updatedPositions.push(position);
        continue;
      }

      const exitQty = position.qty;
      if (exitQty <= 0) {
        position.status = "CLOSED";
        position.closedAt = nowIsoKst();
        updatedPositions.push(position);
        continue;
      }

      let orderSuccess = true;
      let orderMessage = "청산 처리";
      let orderNo: string | null = null;

      if (options.execute && !options.dryRun) {
        const order = await orderExecutor.placeMarketOrder("SELL", position.code, exitQty);
        orderSuccess = order.success;
        orderMessage = order.message;
        orderNo = order.orderNo;
      }

      if (orderSuccess) {
        const exitPrice = decision.exitPrice ?? latest.close;
        const pnl = (exitPrice - position.avgEntryPrice) * exitQty;
        const roundedPnl = round2(pnl) ?? pnl;

        position.status = "CLOSED";
        position.qty = 0;
        position.closedAt = nowIsoKst();
        position.exitReason =
          decision.action === "EXIT_STOP"
            ? "STOP"
            : decision.action === "EXIT_TARGET2"
              ? "TARGET2"
              : "TIMEOUT";
        position.realizedPnlWon = roundedPnl;
        position.lastUpdatedAt = nowIsoKst();

        dailyState.realizedPnlWon += roundedPnl;
        if (roundedPnl < 0) {
          dailyState.dailyLossWon += Math.abs(roundedPnl);
          if (decision.action === "EXIT_STOP") {
            const until = addDays(today, REENTRY_COOLDOWN_DAYS);
            cooldowns[position.code] = until;
            dailyState.stopExitCount += 1;
          }
        }
        if (decision.action === "EXIT_TIMEOUT") dailyState.timeoutExitCount += 1;
        if (decision.action === "EXIT_TARGET2") dailyState.targetExitCount += 1;

        executionResults.push({
          code: position.code,
          name: position.name,
          side: "SELL",
          action:
            decision.action === "EXIT_STOP"
              ? "STOP_EXIT"
              : decision.action === "EXIT_TARGET2"
                ? "TARGET2_EXIT"
                : "TIME_EXIT",
          qty: exitQty,
          success: true,
          orderNo,
          message: orderMessage,
          price: exitPrice,
          at: nowIsoKst(),
        });
      } else {
        executionResults.push({
          code: position.code,
          name: position.name,
          side: "SELL",
          action: "EXIT_FAILED",
          qty: exitQty,
          success: false,
          orderNo: null,
          message: orderMessage,
          price: decision.exitPrice ?? latest.close,
          at: nowIsoKst(),
        });
        updatedPositions.push(position);
      }

      if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) {
        dailyState.blockedByDailyLoss = true;
      }

      if (position.status === "CLOSED") {
        updatedPositions.push(position);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "포지션 평가 실패";
      logger.warn(`포지션 ${position.code} 평가 중 오류: ${message}`);
      updatedPositions.push(position);
    }
  }

  const scannedCandidates: AutotradeCandidate[] = [];
  const openCount = updatedPositions.filter((item) => item.status === "OPEN").length;
  let availableSlots = Math.max(0, MAX_CONCURRENT_POSITIONS - openCount);

  for (const base of universeCandidates) {
    if (scannedCandidates.length >= 30) break;

    const hasOpen = updatedPositions.some((item) => item.code === base.code && item.status === "OPEN");
    if (hasOpen) continue;

    const cooldownUntil = cooldowns[base.code];
    if (cooldownUntil && cooldownUntil >= today) {
      continue;
    }

    try {
      const fetched = await fetchTimeframeCandles(env, cache, base.code, "day", 260, metrics);
      const candles = fetched.candles;
      if (candles.length < MIN_CANDLES) continue;

      const latest = candles[candles.length - 1];
      const avgTurnover20 = average(candles.slice(-20).map((item) => item.close * item.volume));
      if (avgTurnover20 < AVG_TURNOVER_MIN) {
        continue;
      }

      const ret5 = candles.length > 5 ? latest.close / candles[candles.length - 6].close - 1 : 0;
      if (ret5 >= 0.25) {
        continue;
      }

      const signal = signalEngine.evaluate({
        symbol: base.code,
        name: base.name,
        market: base.market,
        candles,
      });
      if (!signal.passed) continue;

      const riskPlan = riskEngine.plan(signal.entryPrice, signal.stopPrice);
      const candidate = buildCandidate(base, signal, riskPlan, latest.close);
      if (candidate.qty < 1) continue;
      scannedCandidates.push(candidate);
    } catch (error) {
      logger.warn(`${base.code} 자동매매 후보 계산 실패: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  scannedCandidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.riskPct - b.riskPct);

  if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) {
    dailyState.blockedByDailyLoss = true;
  }

  if (dailyState.blockedByDailyLoss) {
    blockedReasons.push("일일 손실 제한으로 신규 진입을 중지했습니다.");
  }

  const shouldBlockNewBuy = dailyState.blockedByDailyLoss;

  if (!shouldBlockNewBuy && availableSlots > 0 && options.execute) {
    for (const candidate of scannedCandidates) {
      if (availableSlots <= 0) break;
      if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) break;

      const exists = updatedPositions.some((item) => item.code === candidate.code && item.status === "OPEN");
      if (exists) continue;

      let success = true;
      let message = options.dryRun ? "DRY_RUN: 주문 미전송" : "매수 주문 실행";
      let orderNo: string | null = null;

      if (!options.dryRun) {
        const order = await orderExecutor.placeMarketOrder("BUY", candidate.code, candidate.qty);
        success = order.success;
        message = order.message;
        orderNo = order.orderNo;
      }

      executionResults.push({
        code: candidate.code,
        name: candidate.name,
        side: "BUY",
        action: options.dryRun ? "ENTRY_DRY_RUN" : "ENTRY",
        qty: candidate.qty,
        success,
        orderNo,
        message,
        price: candidate.entryPrice,
        at: nowIsoKst(),
      });

      if (!success) continue;
      if (!options.dryRun) {
        const position: AutotradeOpenPosition = {
          code: candidate.code,
          name: candidate.name,
          market: candidate.market,
          qty: candidate.qty,
          avgEntryPrice: candidate.entryPrice,
          stopPrice: candidate.stopPrice,
          target1Price: candidate.target1Price,
          target2Price: candidate.target2Price,
          status: "OPEN",
          target1Hit: false,
          createdAt: nowIsoKst(),
          lastUpdatedAt: nowIsoKst(),
          entryDate: today,
          exitReason: null,
          closedAt: null,
          realizedPnlWon: null,
        };
        updatedPositions.push(position);
      }
      dailyState.newBuyCount += 1;
      availableSlots -= 1;
    }
  }

  dailyState.updatedAt = nowIsoKst();
  if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) {
    dailyState.blockedByDailyLoss = true;
  }

  const normalizedPositions = updatedPositions;

  await positionManager.saveOpenPositions(normalizedPositions);
  await positionManager.saveCooldowns(cooldowns);
  await positionManager.saveDailyState(dailyState);
  await positionManager.appendLogs(today, logger.toMessages(200));

  const summary = toRunSummary(
    options,
    capitalConfig,
    sourceDate,
    dailyState,
    normalizedPositions,
    executionResults.filter((item) => item.side === "BUY" && item.success).length,
    blockedReasons,
  );

  return {
    ok: true,
    meta: {
      asOf: nowIsoKst(),
      source: "KIS",
      strategyId: AUTOTRADE_VERSION,
      market: options.market,
      universeSize: options.universe,
      execute: options.execute,
      dryRun: options.dryRun,
      accountMode: env.KIS_ENV === "demo" ? "모의" : "실전",
      storage: {
        kvEnabled: autoTradeKvEnabled,
      },
      capital: capitalConfig,
    },
    summary,
    candidates: scannedCandidates,
    executions: executionResults,
    positions: normalizedPositions,
    warnings,
    logs: logger.toMessages(60),
  };
};
