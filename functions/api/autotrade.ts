import { runAutoTrade } from "../lib/autotrade";
import { normalizeAutotradeCapitalMode, normalizeFixedCapitalWon } from "../lib/autotradeCapital";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import { hasAdminOrSessionAccess } from "../lib/siteAuth";
import type { AutotradeCapitalMode, AutotradeMarketFilter, Env } from "../lib/types";

const parseMarket = (raw: unknown): AutotradeMarketFilter => {
  if (typeof raw !== "string") return "ALL";
  const normalized = raw.trim().toUpperCase();
  if (normalized === "KOSPI" || normalized === "KOSDAQ") return normalized;
  return "ALL";
};

const parseUniverse = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return undefined;
};

const parseBoolean = (raw: unknown, fallback: boolean): boolean => {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const parseGetOptions = (request: Request) => {
  const url = new URL(request.url);
  const execute = parseBoolean(url.searchParams.get("execute"), false);
  const dryRun = parseBoolean(url.searchParams.get("dryRun"), true);
  const market = parseMarket(url.searchParams.get("market"));
  const universe = parseUniverse(url.searchParams.get("universe"));
  const capitalMode = normalizeAutotradeCapitalMode(url.searchParams.get("capitalMode"));
  const fixedCapitalWon = normalizeFixedCapitalWon(url.searchParams.get("fixedCapitalWon"));
  const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token");
  return {
    execute,
    dryRun,
    market,
    universe,
    capitalMode,
    fixedCapitalWon,
    adminToken: token,
  };
};

const parsePostBody = async (request: Request) => {
  let payload: unknown = null;
  if (request.headers.get("content-type")?.includes("application/json")) {
    payload = await request.json();
  }
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const execute = parseBoolean(row.execute, false);
  const dryRun = parseBoolean(row.dryRun, true);
  const market = parseMarket(row.market);
  const universe = parseUniverse(row.universe);
  const capitalMode = normalizeAutotradeCapitalMode(row.capitalMode);
  const fixedCapitalWon = normalizeFixedCapitalWon(row.fixedCapitalWon);
  const token =
    (typeof row.adminToken === "string" ? row.adminToken : null) ??
    request.headers.get("x-admin-token") ??
    null;
  return {
    execute,
    dryRun,
    market,
    universe,
    capitalMode,
    fixedCapitalWon,
    adminToken: token,
  };
};

const handleRun = async (
  context: Parameters<PagesFunction<Env>>[0],
  options: {
    execute: boolean;
    dryRun: boolean;
    market: AutotradeMarketFilter;
    universe?: number;
    capitalMode: AutotradeCapitalMode;
    fixedCapitalWon: number;
    adminToken?: string | null;
  },
): Promise<Response> => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const cache = await caches.open("kis-analyzer-cache-v3");
    const adminAuthorized = options.execute
      ? await hasAdminOrSessionAccess(context.request, context.env, options.adminToken ?? null)
      : false;
    const result = await runAutoTrade(
      context.env,
      cache,
      {
        execute: options.execute,
        dryRun: options.dryRun,
        market: options.market,
        universe: options.universe,
        capitalMode: options.capitalMode,
        fixedCapitalWon: options.fixedCapitalWon,
        adminAuthorized,
        adminToken: options.adminToken ?? null,
      },
      metrics,
    );

    return finalize(
      json(result, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "autotrade endpoint error";
    if (message.includes("admin token")) {
      return finalize(badRequest(message, context.request));
    }
    return finalize(serverError(message, context.request));
  }
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const options = parseGetOptions(context.request);
  return handleRun(context, options);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const options = await parsePostBody(context.request);
  return handleRun(context, options);
};
