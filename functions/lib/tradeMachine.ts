import { kisFetch, type KisResponseBase } from "./kis";
import { nowIsoKst } from "./market";
import type { RequestMetrics } from "./observability";
import {
  normalizeAutotradeCapitalMode,
  normalizeFixedCapitalWon,
  resolveAutotradeCapitalConfig,
} from "./autotradeCapital";
import {
  type AutotradeCapitalConfig,
  type AutotradeMarketFilter,
  type AutotradeOpenPosition,
  type Env,
  type TradeCandidateCard,
  type TradeCandidatesPayload,
  type TradeOrderPayload,
  type TradeOrderResult,
  type TradeOrderState,
  type TradeStateTransition,
} from "./types";
import { round2 } from "./utils";
import { runAutoTrade } from "./autotrade";

const MAX_CONCURRENT_POSITIONS = 2;
const WORKING_MAX_WAIT_MS = 45_000;
const WORKING_POLL_INTERVAL_MS = 5_000;
const IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60;
const TRADE_LOG_TTL_SEC = 30 * 24 * 60 * 60;

const OPEN_POSITIONS_KEY = "autotrade:positions:open";
const DAILY_STATE_PREFIX = "autotrade:state:";
const IDEMPOTENCY_PREFIX = "trade:idempotency:";
const TRADE_LOG_PREFIX = "trade:logs:";

interface OrderCashResponse extends KisResponseBase {
  output?: Record<string, string>;
}

interface InquireDailyCcldResponse extends KisResponseBase {
  output1?: Array<Record<string, string>>;
  output2?: Array<Record<string, string>> | Record<string, string>;
}

interface CancelOrderResponse extends KisResponseBase {
  output?: Record<string, string>;
}

interface DailyStateRow {
  date: string;
  dailyLossWon: number;
  updatedAt: string;
}

export interface TradeCandidateQueryOptions {
  market: AutotradeMarketFilter;
  universe: number;
  capitalMode: "FIXED" | "ACCOUNT_CASH";
  fixedCapitalWon: number;
}

export interface TradeOrderRunOptions extends TradeCandidateQueryOptions {
  code: string;
  dryRun: boolean;
  autoExecute: boolean;
  useHashKey: boolean;
  retryOnce: boolean;
  clientOrderId: string | null;
  adminToken: string | null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toNumber = (raw: unknown): number | null => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const normalized = raw.replace(/,/g, "").trim();
    if (!normalized || normalized === "-" || normalized === "--") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickNumber = (row: Record<string, string> | null, keys: string[]): number | null => {
  if (!row) return null;
  for (const key of keys) {
    if (!(key in row)) continue;
    const parsed = toNumber(row[key]);
    if (parsed != null) return parsed;
  }
  return null;
};

const todayKstDate = (): string => nowIsoKst().slice(0, 10);

const normalizeUniverse = (raw: number): number => {
  if (!Number.isFinite(raw)) return 200;
  return Math.max(200, Math.min(500, Math.floor(raw)));
};

const normalizeCapitalOptions = (options: TradeCandidateQueryOptions): TradeCandidateQueryOptions => ({
  market: options.market,
  universe: normalizeUniverse(options.universe),
  capitalMode: normalizeAutotradeCapitalMode(options.capitalMode),
  fixedCapitalWon: normalizeFixedCapitalWon(options.fixedCapitalWon),
});

const parseAccountConfig = (env: Env): { cano: string; acntPrdtCd: string } => {
  const cano = (env.KIS_ACCOUNT_NO ?? "").trim();
  const acntPrdtCd = (env.KIS_ACCOUNT_PRDT_CD ?? "01").trim() || "01";
  if (!cano) {
    throw new Error("KIS_ACCOUNT_NO 환경변수가 없어 주문을 실행할 수 없습니다.");
  }
  return { cano, acntPrdtCd };
};

const readOpenPositions = async (env: Env): Promise<AutotradeOpenPosition[]> => {
  if (!env.AUTOTRADE_KV) return [];
  const raw = await env.AUTOTRADE_KV.get(OPEN_POSITIONS_KEY, { type: "json" });
  return Array.isArray(raw) ? (raw as AutotradeOpenPosition[]) : [];
};

const saveOpenPositions = async (env: Env, positions: AutotradeOpenPosition[]): Promise<void> => {
  if (!env.AUTOTRADE_KV) return;
  await env.AUTOTRADE_KV.put(OPEN_POSITIONS_KEY, JSON.stringify(positions));
};

const readDailyState = async (env: Env, date: string): Promise<DailyStateRow> => {
  if (!env.AUTOTRADE_KV) {
    return {
      date,
      dailyLossWon: 0,
      updatedAt: nowIsoKst(),
    };
  }
  const raw = await env.AUTOTRADE_KV.get(`${DAILY_STATE_PREFIX}${date}`, { type: "json" });
  if (!raw || typeof raw !== "object") {
    return {
      date,
      dailyLossWon: 0,
      updatedAt: nowIsoKst(),
    };
  }
  const row = raw as Record<string, unknown>;
  return {
    date,
    dailyLossWon: toNumber(row.dailyLossWon) ?? 0,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIsoKst(),
  };
};

const saveDailyState = async (env: Env, state: DailyStateRow): Promise<void> => {
  if (!env.AUTOTRADE_KV) return;
  await env.AUTOTRADE_KV.put(`${DAILY_STATE_PREFIX}${state.date}`, JSON.stringify(state), {
    expirationTtl: 14 * 24 * 60 * 60,
  });
};

const readIdempotency = async (env: Env, clientOrderId: string): Promise<TradeOrderPayload | null> => {
  if (!env.AUTOTRADE_KV) return null;
  const raw = await env.AUTOTRADE_KV.get(`${IDEMPOTENCY_PREFIX}${clientOrderId}`, { type: "json" });
  if (!raw || typeof raw !== "object") return null;
  return raw as TradeOrderPayload;
};

const writeIdempotency = async (
  env: Env,
  clientOrderId: string,
  payload: TradeOrderPayload,
): Promise<void> => {
  if (!env.AUTOTRADE_KV) return;
  await env.AUTOTRADE_KV.put(`${IDEMPOTENCY_PREFIX}${clientOrderId}`, JSON.stringify(payload), {
    expirationTtl: IDEMPOTENCY_TTL_SEC,
  });
};

const appendTradeLogs = async (env: Env, date: string, logs: string[]): Promise<void> => {
  if (!env.AUTOTRADE_KV || logs.length === 0) return;
  const key = `${TRADE_LOG_PREFIX}${date}`;
  const existing = (await env.AUTOTRADE_KV.get(key, { type: "json" })) as string[] | null;
  const merged = [...(Array.isArray(existing) ? existing : []), ...logs].slice(-400);
  await env.AUTOTRADE_KV.put(key, JSON.stringify(merged), {
    expirationTtl: TRADE_LOG_TTL_SEC,
  });
};

const placeCashOrder = async (
  env: Env,
  side: "BUY" | "SELL",
  symbol: string,
  qty: number,
  useHashKey: boolean,
  metrics?: RequestMetrics,
): Promise<{ success: boolean; message: string; orderNo: string | null; branchNo: string | null }> => {
  const account = parseAccountConfig(env);
  const trId =
    env.KIS_ENV === "demo"
      ? side === "BUY"
        ? "VTTC0012U"
        : "VTTC0011U"
      : side === "BUY"
        ? "TTTC0012U"
        : "TTTC0011U";

  const { data } = await kisFetch<OrderCashResponse>(
    env,
    "/uapi/domestic-stock/v1/trading/order-cash",
    {
      method: "POST",
      trId,
      useHashKey,
      metrics,
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
      branchNo: null,
    };
  }

  const orderNo = data.output?.ODNO ?? data.output?.odno ?? null;
  const branchNo = data.output?.KRX_FWDG_ORD_ORGNO ?? data.output?.krx_fwdg_ord_orgno ?? null;
  return {
    success: true,
    message: `${side === "BUY" ? "매수" : "매도"} 주문이 접수되었습니다.`,
    orderNo,
    branchNo,
  };
};

const inquireDailyCcld = async (
  env: Env,
  symbol: string,
  orderNo: string,
  metrics?: RequestMetrics,
): Promise<{
  success: boolean;
  orderedQty: number;
  filledQty: number;
  remainingQty: number;
  avgFillPrice: number | null;
  message: string;
}> => {
  const account = parseAccountConfig(env);
  const today = todayKstDate().replace(/-/g, "");
  const trId = env.KIS_ENV === "demo" ? "VTTC8001R" : "TTTC8001R";

  const { data } = await kisFetch<InquireDailyCcldResponse>(
    env,
    "/uapi/domestic-stock/v1/trading/inquire-daily-ccld",
    {
      method: "GET",
      trId,
      metrics,
      params: {
        CANO: account.cano,
        ACNT_PRDT_CD: account.acntPrdtCd,
        INQR_STRT_DT: today,
        INQR_END_DT: today,
        SLL_BUY_DVSN_CD: "00",
        INQR_DVSN: "00",
        PDNO: symbol,
        CCLD_DVSN: "00",
        ORD_GNO_BRNO: "",
        ODNO: orderNo,
        INQR_DVSN_3: "00",
        INQR_DVSN_1: "",
        CTX_AREA_FK100: "",
        CTX_AREA_NK100: "",
      },
    },
  );

  if (data.rt_cd !== "0") {
    return {
      success: false,
      orderedQty: 0,
      filledQty: 0,
      remainingQty: 0,
      avgFillPrice: null,
      message: `체결조회 실패(${data.msg_cd}): ${data.msg1}`,
    };
  }

  const rows = Array.isArray(data.output1) ? data.output1 : [];
  const match =
    rows.find((row) => {
      const rowOrderNo = String(row.odno ?? row.ODNO ?? row.orgn_odno ?? "");
      return rowOrderNo === orderNo;
    }) ?? rows[0] ?? null;

  const orderedQty = Math.max(
    0,
    Math.floor(pickNumber(match, ["ord_qty", "tot_ord_qty", "ord_qty_total"]) ?? 0),
  );
  const filledQty = Math.max(
    0,
    Math.floor(
      pickNumber(match, ["tot_ccld_qty", "ccld_qty", "tot_ccld_qty_sum", "cntr_qty"]) ?? 0,
    ),
  );
  const remainingQtyRaw = pickNumber(match, ["rmn_qty", "nccs_qty", "ord_rmn_qty"]);
  const remainingQty = Math.max(
    0,
    Math.floor(
      remainingQtyRaw != null
        ? remainingQtyRaw
        : Math.max(0, (orderedQty || 0) - (filledQty || 0)),
    ),
  );
  const avgFillPrice = round2(
    pickNumber(match, ["avg_cntr_prc", "avg_pric", "avg_ccld_unpr", "cntr_unpr"]),
  );

  return {
    success: true,
    orderedQty,
    filledQty,
    remainingQty,
    avgFillPrice,
    message: `체결 ${filledQty}주 / 미체결 ${remainingQty}주`,
  };
};

const cancelOrder = async (
  env: Env,
  symbol: string,
  orderNo: string,
  qty: number,
  useHashKey: boolean,
  metrics?: RequestMetrics,
): Promise<{ success: boolean; message: string }> => {
  const account = parseAccountConfig(env);
  const trId = env.KIS_ENV === "demo" ? "VTTC0803U" : "TTTC0803U";

  const { data } = await kisFetch<CancelOrderResponse>(
    env,
    "/uapi/domestic-stock/v1/trading/order-rvsecncl",
    {
      method: "POST",
      trId,
      useHashKey,
      metrics,
      body: {
        CANO: account.cano,
        ACNT_PRDT_CD: account.acntPrdtCd,
        KRX_FWDG_ORD_ORGNO: "",
        ORGN_ODNO: orderNo,
        ORD_DVSN: "01",
        RVSE_CNCL_DVSN_CD: "02",
        ORD_QTY: String(Math.max(1, Math.floor(qty))),
        ORD_UNPR: "0",
        QTY_ALL_ORD_YN: "Y",
      },
    },
  );

  if (data.rt_cd !== "0") {
    return {
      success: false,
      message: `주문 취소 실패(${data.msg_cd}): ${data.msg1}`,
    };
  }
  return {
    success: true,
    message: "미체결 취소 요청이 접수되었습니다.",
  };
};

const toCandidateCards = (
  candidates: Awaited<ReturnType<typeof runAutoTrade>>["candidates"],
  capital: AutotradeCapitalConfig,
): TradeCandidateCard[] =>
  candidates.map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    market: candidate.market,
    state: candidate.state,
    entry: candidate.entryPrice,
    stop: candidate.stopPrice,
    tp1: candidate.target1Price,
    tp2: candidate.target2Price,
    qty: candidate.qty,
    maxLossWon: round2(Math.min(capital.maxRiskPerTradeWon, candidate.riskWon)) ?? 0,
    riskPct: candidate.riskPct,
    reasons: candidate.reasons.slice(0, 3),
    warnings: candidate.warnings.slice(0, 2),
  }));

const buildResult = (
  base: Omit<TradeOrderResult, "transitions">,
  transitions: TradeStateTransition[],
): TradeOrderResult => ({
  ...base,
  transitions,
});

export const getTradeCandidates = async (
  env: Env,
  cache: Cache,
  options: TradeCandidateQueryOptions,
  metrics?: RequestMetrics,
): Promise<TradeCandidatesPayload> => {
  const normalizedOptions = normalizeCapitalOptions(options);
  const autoPayload = await runAutoTrade(
    env,
    cache,
    {
      execute: false,
      dryRun: true,
      market: normalizedOptions.market,
      universe: normalizedOptions.universe,
      capitalMode: normalizedOptions.capitalMode,
      fixedCapitalWon: normalizedOptions.fixedCapitalWon,
      adminToken: null,
    },
    metrics,
  );

  return {
    ok: true,
    meta: {
      asOf: nowIsoKst(),
      source: "KIS",
      market: normalizedOptions.market,
      universeSize: normalizedOptions.universe,
      capital: autoPayload.meta.capital,
    },
    summary: {
      capitalMode: autoPayload.summary.capitalMode,
      capitalWon: autoPayload.summary.capitalWon,
      configuredCapitalWon: autoPayload.summary.configuredCapitalWon,
      availableCashWon: autoPayload.summary.availableCashWon,
      maxRiskPerTradeWon: autoPayload.summary.maxRiskPerTradeWon,
      maxDailyLossWon: autoPayload.summary.maxDailyLossWon,
      maxPositionWon: autoPayload.summary.maxPositionWon,
      dailyLossWon: autoPayload.summary.dailyLossWon,
      blockedByDailyLoss: autoPayload.summary.blockedByDailyLoss,
      openPositionCount: autoPayload.summary.openPositionCount,
      strategyId: autoPayload.summary.strategyId,
      sourceDate: autoPayload.summary.sourceDate,
    },
    candidates: toCandidateCards(autoPayload.candidates, autoPayload.meta.capital),
    warnings: autoPayload.warnings,
  };
};

export const runTradeOrder = async (
  env: Env,
  cache: Cache,
  options: TradeOrderRunOptions,
  metrics?: RequestMetrics,
): Promise<TradeOrderPayload> => {
  const warnings: string[] = [];
  const logs: string[] = [];
  const transitions: TradeStateTransition[] = [];
  const clientOrderId = options.clientOrderId?.trim() || crypto.randomUUID();
  const today = todayKstDate();

  const normalizedOptions = {
    ...options,
    universe: normalizeUniverse(options.universe),
    capitalMode: normalizeAutotradeCapitalMode(options.capitalMode),
    fixedCapitalWon: normalizeFixedCapitalWon(options.fixedCapitalWon),
  };
  const pushState = (
    state: TradeOrderState,
    reason: string,
    summary?: string | null,
  ): void => {
    const at = nowIsoKst();
    transitions.push({
      at,
      state,
      reason,
      summary: summary ?? null,
    });
    logs.push(`[${state}] ${at} ${reason}${summary ? ` (${summary})` : ""}`);
  };

  pushState("IDLE", "주문 상태 머신 시작");

  if (env.ADMIN_TOKEN?.trim()) {
    const provided = options.adminToken?.trim() ?? "";
    if (!provided || provided !== env.ADMIN_TOKEN.trim()) {
      pushState("ORDER_REJECTED", "관리자 토큰 검증 실패");
      const payload: TradeOrderPayload = {
        ok: false,
        meta: {
          asOf: nowIsoKst(),
          source: "KIS",
          market: normalizedOptions.market,
          universeSize: normalizedOptions.universe,
          capital: {
            mode: normalizedOptions.capitalMode,
            configuredCapitalWon: normalizedOptions.capitalMode === "FIXED" ? normalizedOptions.fixedCapitalWon : null,
            effectiveCapitalWon: normalizedOptions.fixedCapitalWon,
            availableCashWon: null,
            maxRiskPerTradeWon: 0,
            maxDailyLossWon: 0,
            maxPositionWon: 0,
          },
          dryRun: options.dryRun,
          autoExecute: options.autoExecute,
          useHashKey: options.useHashKey,
          retryOnce: options.retryOnce,
        },
        result: buildResult(
          {
            clientOrderId,
            code: options.code,
            name: options.code,
            state: "ORDER_REJECTED",
            orderNo: null,
            filledQty: 0,
            orderedQty: 0,
            remainingQty: 0,
            avgFillPrice: null,
            positionOpened: false,
            canceled: false,
            rejected: true,
            message: "유효한 admin token이 필요합니다.",
          },
          transitions,
        ),
        warnings,
        logs,
      };
      return payload;
    }
  }

  const duplicated = await readIdempotency(env, clientOrderId);
  if (duplicated) {
    warnings.push("중복 주문 요청을 방지하기 위해 기존 실행 결과를 반환합니다.");
    duplicated.warnings = [...(duplicated.warnings ?? []), ...warnings];
    duplicated.logs = [...(duplicated.logs ?? []), ...logs];
    return duplicated;
  }

  const candidatesPayload = await getTradeCandidates(
    env,
    cache,
    {
      market: normalizedOptions.market,
      universe: normalizedOptions.universe,
      capitalMode: normalizedOptions.capitalMode,
      fixedCapitalWon: normalizedOptions.fixedCapitalWon,
    },
    metrics,
  );
  warnings.push(...candidatesPayload.warnings);
  const capitalConfig = candidatesPayload.meta.capital;
  const candidate = candidatesPayload.candidates.find((item) => item.code === options.code.trim());
  if (!candidate) {
    pushState("ORDER_REJECTED", "후보 목록에서 종목을 찾지 못함");
    const payload: TradeOrderPayload = {
      ok: false,
        meta: {
          asOf: nowIsoKst(),
          source: "KIS",
          market: normalizedOptions.market,
          universeSize: normalizedOptions.universe,
          capital: capitalConfig,
          dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: options.code,
          name: options.code,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: 0,
          remainingQty: 0,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: "해당 종목은 오늘 자동매매 후보에 없습니다.",
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }

  pushState("PRECHECK", "주문 전 리스크/한도 검증");
  const dailyState = await readDailyState(env, today);
  const positions = await readOpenPositions(env);
  const openPositions = positions.filter((item) => item.status === "OPEN");

  if (!env.AUTOTRADE_KV) {
    warnings.push("AUTOTRADE_KV 미연결: idempotency/포지션/손실 상태 영속 저장이 제한됩니다.");
  }
  if (dailyState.dailyLossWon >= capitalConfig.maxDailyLossWon) {
    pushState("ORDER_REJECTED", "일일 손실 제한 초과");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
          market: normalizedOptions.market,
          universeSize: normalizedOptions.universe,
          capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: `일일 손실 ${capitalConfig.maxDailyLossWon.toLocaleString("ko-KR")}원 제한에 도달하여 신규 매수를 금지합니다.`,
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }
  if (openPositions.length >= MAX_CONCURRENT_POSITIONS) {
    pushState("ORDER_REJECTED", "동시 보유 제한 초과");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
          market: normalizedOptions.market,
          universeSize: normalizedOptions.universe,
          capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: "동시 보유 최대 2종목 제한으로 주문할 수 없습니다.",
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }
  if (openPositions.some((item) => item.code === candidate.code)) {
    pushState("ORDER_REJECTED", "동일 종목 중복 진입 차단");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
          market: normalizedOptions.market,
          universeSize: normalizedOptions.universe,
          capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: "이미 보유 중인 종목이라 신규 진입을 차단했습니다.",
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }
  if (candidate.qty < 1) {
    pushState("ORDER_REJECTED", "수량 1주 미만");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        market: normalizedOptions.market,
        universeSize: normalizedOptions.universe,
        capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: 0,
          remainingQty: 0,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: "qty<1 이므로 주문하지 않습니다.",
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }
  if (candidate.maxLossWon > capitalConfig.maxRiskPerTradeWon) {
    pushState("ORDER_REJECTED", "1회 손실 한도 초과");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        market: normalizedOptions.market,
        universeSize: normalizedOptions.universe,
        capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: `1회 손실 ${capitalConfig.maxRiskPerTradeWon.toLocaleString("ko-KR")}원 제한을 초과해 주문을 차단했습니다.`,
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }
  const estimatedInvestWon = candidate.entry * candidate.qty;
  if (estimatedInvestWon > capitalConfig.maxPositionWon) {
    pushState("ORDER_REJECTED", "1종목 최대투입 초과");
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        market: normalizedOptions.market,
        universeSize: normalizedOptions.universe,
        capital: capitalConfig,
        dryRun: options.dryRun,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: `1종목 최대 투입금 ${capitalConfig.maxPositionWon.toLocaleString("ko-KR")}원 제한을 초과해 주문을 차단했습니다.`,
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    return payload;
  }

  if (options.dryRun) {
    pushState("ORDER_SUBMITTING", "DRY_RUN 주문 제출 시뮬레이션");
    pushState("ORDER_ACCEPTED", "DRY_RUN 주문 접수 가정");
    pushState("WORKING", "DRY_RUN 체결 대기 가정");
    pushState("FILLED", "DRY_RUN 전량 체결 가정");
    pushState("POSITION_OPEN", "DRY_RUN 포지션 오픈(미저장)");
    const payload: TradeOrderPayload = {
      ok: true,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        market: normalizedOptions.market,
        universeSize: normalizedOptions.universe,
        capital: capitalConfig,
        dryRun: true,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "POSITION_OPEN",
          orderNo: `DRY-${clientOrderId.slice(0, 8)}`,
          filledQty: candidate.qty,
          orderedQty: candidate.qty,
          remainingQty: 0,
          avgFillPrice: candidate.entry,
          positionOpened: true,
          canceled: false,
          rejected: false,
          message: "DRY_RUN 모드로 주문 상태 머신을 시뮬레이션했습니다.",
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    await appendTradeLogs(env, today, logs);
    return payload;
  }

  let orderNo: string | null = null;
  let filledQty = 0;
  let avgFillPrice: number | null = null;
  let orderedQty = candidate.qty;
  let canceled = false;
  let rejected = false;

  pushState("ORDER_SUBMITTING", "KIS 주문 API 호출");
  const orderResult = await placeCashOrder(
    env,
    "BUY",
    candidate.code,
    candidate.qty,
    options.useHashKey,
    metrics,
  );
  if (!orderResult.success || !orderResult.orderNo) {
    pushState("ORDER_REJECTED", "주문 접수 실패", orderResult.message);
    rejected = true;
    const payload: TradeOrderPayload = {
      ok: false,
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        market: normalizedOptions.market,
        universeSize: normalizedOptions.universe,
        capital: capitalConfig,
        dryRun: false,
        autoExecute: options.autoExecute,
        useHashKey: options.useHashKey,
        retryOnce: options.retryOnce,
      },
      result: buildResult(
        {
          clientOrderId,
          code: candidate.code,
          name: candidate.name,
          state: "ORDER_REJECTED",
          orderNo: null,
          filledQty: 0,
          orderedQty: candidate.qty,
          remainingQty: candidate.qty,
          avgFillPrice: null,
          positionOpened: false,
          canceled: false,
          rejected: true,
          message: orderResult.message,
        },
        transitions,
      ),
      warnings,
      logs,
    };
    await writeIdempotency(env, clientOrderId, payload);
    await appendTradeLogs(env, today, logs);
    return payload;
  }
  orderNo = orderResult.orderNo;
  pushState("ORDER_ACCEPTED", "주문 접수 완료", `주문번호 ${orderNo}`);
  pushState("WORKING", "체결 대기 폴링 시작", `${Math.floor(WORKING_MAX_WAIT_MS / 1000)}초`);

  const startedAt = Date.now();
  let partialNotified = false;
  let pollAttempts = 0;
  while (Date.now() - startedAt < WORKING_MAX_WAIT_MS) {
    pollAttempts += 1;
    const status = await inquireDailyCcld(env, candidate.code, orderNo, metrics);
    if (!status.success) {
      warnings.push(status.message);
    } else {
      orderedQty = status.orderedQty > 0 ? status.orderedQty : orderedQty;
      filledQty = status.filledQty;
      avgFillPrice = status.avgFillPrice ?? avgFillPrice;
      if (filledQty > 0 && filledQty < orderedQty && !partialNotified) {
        pushState("PARTIALLY_FILLED", "부분 체결 발생", status.message);
        partialNotified = true;
      }
      if (filledQty >= orderedQty) {
        pushState("FILLED", "전량 체결 확인", status.message);
        break;
      }
    }
    await sleep(WORKING_POLL_INTERVAL_MS);
  }

  let remainingQty = Math.max(0, orderedQty - filledQty);
  if (filledQty < orderedQty && remainingQty > 0) {
    pushState("CANCEL_REQUESTED", "체결 대기 시간 초과로 미체결 취소", `남은수량 ${remainingQty}주`);
    const cancelResult = await cancelOrder(
      env,
      candidate.code,
      orderNo,
      remainingQty,
      options.useHashKey,
      metrics,
    );
    if (cancelResult.success) {
      canceled = true;
      pushState("CANCELED", "취소 완료", cancelResult.message);
    } else {
      rejected = true;
      pushState("ORDER_REJECTED", "취소 실패", cancelResult.message);
      warnings.push(cancelResult.message);
    }
  }

  if (options.retryOnce && filledQty === 0 && !rejected) {
    pushState("ORDER_SUBMITTING", "미체결 취소 후 1회 재주문");
    const retryOrder = await placeCashOrder(
      env,
      "BUY",
      candidate.code,
      candidate.qty,
      options.useHashKey,
      metrics,
    );
    if (retryOrder.success && retryOrder.orderNo) {
      orderNo = retryOrder.orderNo;
      orderedQty = candidate.qty;
      pushState("ORDER_ACCEPTED", "재주문 접수 완료", `주문번호 ${orderNo}`);
      pushState("WORKING", "재주문 체결 대기 폴링 시작", "20초");

      const retryStart = Date.now();
      while (Date.now() - retryStart < 20_000) {
        const retryStatus = await inquireDailyCcld(env, candidate.code, orderNo, metrics);
        if (!retryStatus.success) {
          warnings.push(retryStatus.message);
        } else {
          orderedQty = retryStatus.orderedQty > 0 ? retryStatus.orderedQty : orderedQty;
          filledQty = retryStatus.filledQty;
          avgFillPrice = retryStatus.avgFillPrice ?? avgFillPrice;
          if (filledQty > 0 && filledQty < orderedQty && !partialNotified) {
            pushState("PARTIALLY_FILLED", "재주문 부분 체결", retryStatus.message);
            partialNotified = true;
          }
          if (filledQty >= orderedQty) {
            pushState("FILLED", "재주문 전량 체결", retryStatus.message);
            break;
          }
        }
        await sleep(WORKING_POLL_INTERVAL_MS);
      }

      remainingQty = Math.max(0, orderedQty - filledQty);
      if (filledQty < orderedQty && remainingQty > 0) {
        pushState("CANCEL_REQUESTED", "재주문 미체결 취소", `남은수량 ${remainingQty}주`);
        const retryCancel = await cancelOrder(
          env,
          candidate.code,
          orderNo,
          remainingQty,
          options.useHashKey,
          metrics,
        );
        if (retryCancel.success) {
          canceled = true;
          pushState("CANCELED", "재주문 취소 완료", retryCancel.message);
        } else {
          rejected = true;
          pushState("ORDER_REJECTED", "재주문 취소 실패", retryCancel.message);
          warnings.push(retryCancel.message);
        }
      }
    } else {
      rejected = true;
      pushState("ORDER_REJECTED", "재주문 접수 실패", retryOrder.message);
      warnings.push(retryOrder.message);
    }
  }

  if (filledQty > 0) {
    const position: AutotradeOpenPosition = {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      qty: filledQty,
      avgEntryPrice: avgFillPrice ?? candidate.entry,
      stopPrice: candidate.stop,
      target1Price: candidate.tp1,
      target2Price: candidate.tp2,
      status: "OPEN",
      target1Hit: false,
      createdAt: nowIsoKst(),
      lastUpdatedAt: nowIsoKst(),
      entryDate: today,
      exitReason: null,
      closedAt: null,
      realizedPnlWon: null,
    };
    const merged = [...positions.filter((item) => item.code !== candidate.code || item.status !== "OPEN"), position];
    await saveOpenPositions(env, merged);
    dailyState.updatedAt = nowIsoKst();
    await saveDailyState(env, dailyState);
    pushState("POSITION_OPEN", "포지션 오픈 완료", `체결수량 ${filledQty}주`);
  } else if (!rejected) {
    pushState("CLOSED", "체결 없이 주문 종료");
  }

  remainingQty = Math.max(0, orderedQty - filledQty);
  const finalState: TradeOrderState =
    rejected
      ? "ORDER_REJECTED"
      : filledQty > 0
        ? "POSITION_OPEN"
        : canceled
          ? "CANCELED"
          : "CLOSED";
  const message =
    finalState === "POSITION_OPEN"
      ? remainingQty > 0
        ? "부분 체결 후 잔량 취소로 포지션을 열었습니다."
        : "전량 체결로 포지션을 열었습니다."
      : finalState === "CANCELED"
        ? "체결 없이 주문이 취소되었습니다."
        : finalState === "ORDER_REJECTED"
          ? "주문 처리 중 오류로 실패했습니다."
          : "주문이 종료되었습니다.";

  const payload: TradeOrderPayload = {
    ok: finalState !== "ORDER_REJECTED",
    meta: {
      asOf: nowIsoKst(),
      source: "KIS",
      market: normalizedOptions.market,
      universeSize: normalizedOptions.universe,
      capital: capitalConfig,
      dryRun: false,
      autoExecute: options.autoExecute,
      useHashKey: options.useHashKey,
      retryOnce: options.retryOnce,
    },
    result: buildResult(
      {
        clientOrderId,
        code: candidate.code,
        name: candidate.name,
        state: finalState,
        orderNo,
        filledQty,
        orderedQty,
        remainingQty,
        avgFillPrice,
        positionOpened: finalState === "POSITION_OPEN",
        canceled,
        rejected,
        message,
      },
      transitions,
    ),
    warnings,
    logs,
  };

  await writeIdempotency(env, clientOrderId, payload);
  await appendTradeLogs(env, today, logs);
  return payload;
};
