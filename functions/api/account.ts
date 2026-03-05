import { kisFetch, type KisResponseBase } from "../lib/kis";
import { nowIsoKst } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import type { Env } from "../lib/types";
import { round2 } from "../lib/utils";

type KisRow = Record<string, string>;

interface KisInquireBalanceResponse extends KisResponseBase {
  output1?: KisRow[];
  output2?: KisRow[] | KisRow;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}

interface AccountHolding {
  code: string;
  name: string;
  quantity: number;
  orderableQuantity: number | null;
  purchaseAvgPrice: number | null;
  currentPrice: number | null;
  purchaseAmount: number | null;
  evaluationAmount: number | null;
  profitAmount: number | null;
  profitRate: number | null;
  weightPercent: number | null;
}

interface AccountPayload {
  meta: {
    asOf: string;
    source: "KIS";
    account: string;
    cacheTtlSec: number;
  };
  summary: {
    totalAssetAmount: number | null;
    totalEvaluationAmount: number | null;
    totalPurchaseAmount: number | null;
    totalProfitAmount: number | null;
    totalProfitRate: number | null;
    cashAmount: number | null;
  };
  holdings: AccountHolding[];
  warnings: string[];
}

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized || normalized === "-" || normalized === "--" || normalized === "N/A") {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickNumber = (row: KisRow | null, keys: string[]): number | null => {
  if (!row) return null;
  for (const key of keys) {
    if (!(key in row)) continue;
    const parsed = toNullableNumber(row[key]);
    if (parsed != null) return parsed;
  }
  return null;
};

const pickText = (row: KisRow | null, keys: string[]): string | null => {
  if (!row) return null;
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
};

const toRows = (output: KisInquireBalanceResponse["output2"] | KisInquireBalanceResponse["output1"]): KisRow[] => {
  if (Array.isArray(output)) return output.filter((row) => row && typeof row === "object");
  if (output && typeof output === "object") return [output];
  return [];
};

const firstRow = (output: KisInquireBalanceResponse["output2"] | KisInquireBalanceResponse["output1"]): KisRow | null => {
  const rows = toRows(output);
  return rows.length > 0 ? rows[0] : null;
};

const maskAccount = (accountNo: string, productCode: string): string => {
  const masked = accountNo.replace(/\d(?=\d{4})/g, "*");
  return `${masked}-${productCode}`;
};

const getAccountConfig = (
  env: Env,
): { cano: string; acntPrdtCd: string; trId: string } | null => {
  const cano = (env.KIS_ACCOUNT_NO ?? "").trim();
  const acntPrdtCd = (env.KIS_ACCOUNT_PRDT_CD ?? "01").trim() || "01";
  if (!cano) return null;
  return {
    cano,
    acntPrdtCd,
    trId: env.KIS_ENV === "demo" ? "VTTC8434R" : "TTTC8434R",
  };
};

const toHolding = (row: KisRow): AccountHolding | null => {
  const code = pickText(row, ["pdno", "mksc_shrn_iscd"]) ?? "";
  const name = pickText(row, ["prdt_name", "hts_kor_isnm"]) ?? "";
  const quantity = pickNumber(row, ["hldg_qty"]) ?? 0;
  if (!code || quantity <= 0) return null;

  const purchaseAvgPrice = pickNumber(row, ["pchs_avg_pric"]);
  const currentPrice = pickNumber(row, ["prpr"]);
  const purchaseAmount = pickNumber(row, ["pchs_amt"]);
  const evaluationAmount = pickNumber(row, ["evlu_amt"]);
  const profitAmount = pickNumber(row, ["evlu_pfls_amt"]);
  const orderableQuantity = pickNumber(row, ["ord_psbl_qty"]);
  const rawProfitRate = pickNumber(row, ["evlu_pfls_rt", "evlu_erng_rt"]);

  const fallbackProfitRate =
    rawProfitRate == null &&
    purchaseAvgPrice != null &&
    purchaseAvgPrice > 0 &&
    currentPrice != null
      ? ((currentPrice - purchaseAvgPrice) / purchaseAvgPrice) * 100
      : null;

  return {
    code,
    name,
    quantity: Math.max(0, Math.floor(quantity)),
    orderableQuantity: orderableQuantity == null ? null : Math.max(0, Math.floor(orderableQuantity)),
    purchaseAvgPrice: round2(purchaseAvgPrice),
    currentPrice: round2(currentPrice),
    purchaseAmount: round2(purchaseAmount),
    evaluationAmount: round2(evaluationAmount),
    profitAmount: round2(profitAmount),
    profitRate: round2(rawProfitRate ?? fallbackProfitRate),
    weightPercent: null,
  };
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const config = getAccountConfig(context.env);
    if (!config) {
      return finalize(
        badRequest(
          "계좌 조회를 위해 KIS_ACCOUNT_NO(8자리) 환경변수가 필요합니다.",
          context.request,
        ),
      );
    }

    const holdingsRows: KisRow[] = [];
    let summaryRow: KisRow | null = null;
    let ctxFk100 = "";
    let ctxNk100 = "";
    const maxPages = 10;
    let truncated = false;

    for (let page = 0; page < maxPages; page += 1) {
      const { response, data } = await kisFetch<KisInquireBalanceResponse>(
        context.env,
        "/uapi/domestic-stock/v1/trading/inquire-balance",
        {
          method: "GET",
          trId: config.trId,
          metrics,
          params: {
            CANO: config.cano,
            ACNT_PRDT_CD: config.acntPrdtCd,
            AFHR_FLPR_YN: "N",
            OFL_YN: "",
            INQR_DVSN: "02",
            UNPR_DVSN: "01",
            FUND_STTL_ICLD_YN: "N",
            FNCG_AMT_AUTO_RDPT_YN: "N",
            PRCS_DVSN: "00",
            CTX_AREA_FK100: ctxFk100,
            CTX_AREA_NK100: ctxNk100,
          },
        },
      );

      if (data.rt_cd !== "0") {
        throw new Error(`KIS 계좌 조회 실패(${data.msg_cd}): ${data.msg1}`);
      }

      holdingsRows.push(...toRows(data.output1));
      if (!summaryRow) {
        summaryRow = firstRow(data.output2);
      }

      const trCont = (response.headers.get("tr_cont") ?? "").trim().toUpperCase();
      const hasNext = trCont === "M" || trCont === "F";
      const nextFk = typeof data.ctx_area_fk100 === "string" ? data.ctx_area_fk100 : "";
      const nextNk = typeof data.ctx_area_nk100 === "string" ? data.ctx_area_nk100 : "";

      if (!hasNext || (!nextFk && !nextNk)) {
        break;
      }

      if (page === maxPages - 1) {
        truncated = true;
      }
      ctxFk100 = nextFk;
      ctxNk100 = nextNk;
    }

    const holdings = holdingsRows
      .map(toHolding)
      .filter((item): item is AccountHolding => item !== null);

    const holdingsEvalTotal = holdings.reduce(
      (sum, item) => sum + (item.evaluationAmount ?? 0),
      0,
    );
    const holdingsPurchaseTotal = holdings.reduce(
      (sum, item) => sum + (item.purchaseAmount ?? 0),
      0,
    );
    const holdingsProfitTotal = holdings.reduce(
      (sum, item) => sum + (item.profitAmount ?? 0),
      0,
    );

    const totalEvaluationAmount =
      pickNumber(summaryRow, ["tot_evlu_amt", "evlu_amt_smtl_amt", "evlu_amt_smtl"]) ??
      (holdingsEvalTotal > 0 ? holdingsEvalTotal : null);
    const totalPurchaseAmount =
      pickNumber(summaryRow, ["pchs_amt_smtl_amt", "pchs_amt_smtl"]) ??
      (holdingsPurchaseTotal > 0 ? holdingsPurchaseTotal : null);
    const totalProfitAmount =
      pickNumber(summaryRow, ["evlu_pfls_smtl_amt", "evlu_pfls_amt_smtl"]) ??
      (holdingsProfitTotal !== 0 ? holdingsProfitTotal : null);
    const totalAssetAmount = pickNumber(summaryRow, ["tot_asst_amt", "nass_amt"]);
    const cashAmount = pickNumber(summaryRow, ["dnca_tot_amt", "tot_dncl_amt", "dncl_amt"]);
    const totalProfitRate =
      totalEvaluationAmount != null && totalPurchaseAmount != null && totalPurchaseAmount > 0
        ? ((totalEvaluationAmount - totalPurchaseAmount) / totalPurchaseAmount) * 100
        : null;

    const weightBase = totalEvaluationAmount && totalEvaluationAmount > 0 ? totalEvaluationAmount : holdingsEvalTotal;
    const normalizedHoldings = holdings
      .map((item) => ({
        ...item,
        weightPercent:
          weightBase > 0 && item.evaluationAmount != null
            ? round2((item.evaluationAmount / weightBase) * 100)
            : null,
      }))
      .sort((a, b) => (b.evaluationAmount ?? 0) - (a.evaluationAmount ?? 0));

    const warnings: string[] = [];
    if (normalizedHoldings.length === 0) {
      warnings.push("보유 종목이 없습니다.");
    }
    if (truncated) {
      warnings.push("보유 종목이 많아 일부만 조회되었습니다. batch 조회 확장이 필요할 수 있습니다.");
    }

    const payload: AccountPayload = {
      meta: {
        asOf: nowIsoKst(),
        source: "KIS",
        account: maskAccount(config.cano, config.acntPrdtCd),
        cacheTtlSec: 0,
      },
      summary: {
        totalAssetAmount: round2(totalAssetAmount),
        totalEvaluationAmount: round2(totalEvaluationAmount),
        totalPurchaseAmount: round2(totalPurchaseAmount),
        totalProfitAmount: round2(totalProfitAmount),
        totalProfitRate: round2(totalProfitRate),
        cashAmount: round2(cashAmount),
      },
      holdings: normalizedHoldings,
      warnings,
    };

    return finalize(
      json(payload, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "account endpoint error";
    return finalize(serverError(message, context.request));
  }
};

