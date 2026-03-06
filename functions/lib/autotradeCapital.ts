import { fetchAccountSnapshot } from "./accountSnapshot";
import type { RequestMetrics } from "./observability";
import type { AutotradeCapitalConfig, AutotradeCapitalMode, Env } from "./types";

const BASE_CAPITAL_WON = 500_000;
const BASE_RISK_PER_TRADE_WON = 5_000;
const BASE_DAILY_LOSS_WON = 10_000;
const BASE_MAX_POSITION_WON = 150_000;
const DEFAULT_FIXED_CAPITAL_WON = 500_000;

const sanitizeCapital = (value: number | null | undefined, fallback: number): number => {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(10_000, Math.floor(value));
};

const scaledAmount = (capitalWon: number, baseAmount: number, minimum: number): number =>
  Math.max(minimum, Math.min(capitalWon, Math.floor((capitalWon / BASE_CAPITAL_WON) * baseAmount)));

export const normalizeAutotradeCapitalMode = (raw: unknown): AutotradeCapitalMode => {
  if (typeof raw !== "string") return "FIXED";
  const normalized = raw.trim().toUpperCase();
  return normalized === "ACCOUNT_CASH" ? "ACCOUNT_CASH" : "FIXED";
};

export const normalizeFixedCapitalWon = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return sanitizeCapital(raw, DEFAULT_FIXED_CAPITAL_WON);
  }
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return sanitizeCapital(parsed, DEFAULT_FIXED_CAPITAL_WON);
    }
  }
  return DEFAULT_FIXED_CAPITAL_WON;
};

export const resolveAutotradeCapitalConfig = async (
  env: Env,
  mode: AutotradeCapitalMode,
  fixedCapitalWon: number,
  metrics?: RequestMetrics,
): Promise<{ config: AutotradeCapitalConfig; warnings: string[] }> => {
  const warnings: string[] = [];

  if (mode === "ACCOUNT_CASH") {
    try {
      const account = await fetchAccountSnapshot(env, metrics);
      const availableCashWon = sanitizeCapital(account.summary.cashAmount, 0);
      if (availableCashWon <= 0) {
        warnings.push("계좌 예수금을 확인하지 못해 고정 자금 기준으로 폴백합니다.");
      } else {
        return {
          config: {
            mode,
            configuredCapitalWon: null,
            effectiveCapitalWon: availableCashWon,
            availableCashWon,
            maxRiskPerTradeWon: scaledAmount(availableCashWon, BASE_RISK_PER_TRADE_WON, 500),
            maxDailyLossWon: scaledAmount(availableCashWon, BASE_DAILY_LOSS_WON, 1_000),
            maxPositionWon: scaledAmount(availableCashWon, BASE_MAX_POSITION_WON, 10_000),
          },
          warnings: [...warnings, ...account.warnings],
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "계좌 예수금 조회 실패";
      warnings.push(`계좌 예수금 조회 실패로 고정 자금 기준으로 폴백합니다. (${message})`);
    }
  }

  const capitalWon = sanitizeCapital(fixedCapitalWon, DEFAULT_FIXED_CAPITAL_WON);
  return {
    config: {
      mode: "FIXED",
      configuredCapitalWon: capitalWon,
      effectiveCapitalWon: capitalWon,
      availableCashWon: null,
      maxRiskPerTradeWon: scaledAmount(capitalWon, BASE_RISK_PER_TRADE_WON, 500),
      maxDailyLossWon: scaledAmount(capitalWon, BASE_DAILY_LOSS_WON, 1_000),
      maxPositionWon: scaledAmount(capitalWon, BASE_MAX_POSITION_WON, 10_000),
    },
    warnings,
  };
};
