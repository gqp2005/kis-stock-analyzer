import { getCachedJson, putCachedJson } from "./cache";
import {
  addDaysToYmd,
  formatKstDate,
  nowIsoKst,
  timeframeCacheTtlSec,
} from "./market";
import { bumpMetric, type RequestMetrics } from "./observability";
import type {
  Candle,
  Env,
  FlowSignal,
  FundamentalSignal,
  Timeframe,
} from "./types";
import { parseKisDate, round2, toNumber } from "./utils";

interface KisTokenRecord {
  access_token: string;
  expires_at: number; // epoch seconds
}

interface KisTokenLockRecord {
  owner: string;
  expires_at: number; // epoch seconds
}

interface KisResponseBase {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
}

interface KisDailyChartResponse extends KisResponseBase {
  output1?: Record<string, string>;
  output2?: Array<Record<string, string>>;
}

interface KisIndexChartResponse extends KisResponseBase {
  output1?: Record<string, string>;
  output2?: Array<Record<string, string>>;
}

interface KisPriceResponse extends KisResponseBase {
  output?: Record<string, string>;
}

interface KisInvestorResponse extends KisResponseBase {
  output?: Array<Record<string, string>> | Record<string, string>;
}

export interface KisMarketSnapshot {
  fundamental: FundamentalSignal;
  flow: FlowSignal;
}

const TOKEN_REFRESH_WINDOW_SEC = 2 * 60 * 60; // 2h
const TOKEN_LOCK_EXPIRE_SEC = 30;
const TOKEN_LOCK_KV_TTL_SEC = 60; // Cloudflare KV minimum expirationTtl
const TOKEN_LOCK_RETRY_DELAYS_MS = [200, 400, 800];
const KIS_TOKEN_KEY = "kis:token";
const KIS_TOKEN_LOCK_KEY = "kis:token:lock";
let memoryToken: (KisTokenRecord & { cacheIdentity: string }) | null = null;

const normalizeBaseUrl = (raw?: string): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    // KIS 공식 호스트만 허용하고, 나머지는 안전하게 기본값으로 폴백한다.
    if (!parsed.hostname.endsWith("koreainvestment.com")) {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
};

const getBaseUrl = (env: Env): string => {
  const normalized = normalizeBaseUrl(env.KIS_BASE_URL);
  if (normalized) return normalized;
  if (env.KIS_BASE_URL) {
    console.warn("[kis-config] KIS_BASE_URL가 유효하지 않아 기본 KIS URL을 사용합니다.");
  }
  if (env.KIS_ENV === "demo") return "https://openapivts.koreainvestment.com:29443";
  return "https://openapi.koreainvestment.com:9443";
};

const parseTokenExpiry = (raw: unknown): number | null => {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d, h, mi, s] = m;

  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(s));
  return Math.floor(ms / 1000);
};

const getTokenCacheIdentity = (env: Env): string => {
  const base = getBaseUrl(env);
  const app = env.KIS_APP_KEY?.slice(0, 6) || "app";
  return `${base}:${app}`;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const nowSec = (): number => Math.floor(Date.now() / 1000);

const normalizeTokenRecord = (raw: unknown): KisTokenRecord | null => {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const accessToken = typeof row.access_token === "string" ? row.access_token : "";
  const expiresAt = Number(row.expires_at);
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return {
    access_token: accessToken,
    expires_at: Math.floor(expiresAt),
  };
};

const fetchNewToken = async (env: Env, metrics?: RequestMetrics): Promise<KisTokenRecord> => {
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET env가 필요합니다.");
  }

  console.log("[kis-call] oauth2/tokenP");
  bumpMetric(metrics, "kisCalls");
  const response = await fetch(`${getBaseUrl(env)}/oauth2/tokenP`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`KIS 토큰 발급 실패: HTTP ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const token = typeof data.access_token === "string" ? data.access_token : "";
  if (!token) throw new Error("KIS 토큰 발급 응답에 access_token이 없습니다.");

  const now = nowSec();
  const expiresInRaw = Number(data.expires_in);
  const expiryFromSeconds =
    Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? now + Math.floor(expiresInRaw)
      : null;
  const expiryFromDate = parseTokenExpiry(data.access_token_token_expired);
  const expiresAt = expiryFromSeconds ?? expiryFromDate ?? now + 23 * 60 * 60;

  return {
    access_token: token,
    expires_at: expiresAt,
  };
};

const readTokenFromKv = async (env: Env): Promise<KisTokenRecord | null> => {
  if (!env.KIS_KV) return null;
  const raw = await env.KIS_KV.get(KIS_TOKEN_KEY, { type: "json" });
  return normalizeTokenRecord(raw);
};

const writeTokenToKv = async (env: Env, token: KisTokenRecord): Promise<void> => {
  if (!env.KIS_KV) return;
  const ttl = Math.max(60, token.expires_at - nowSec() + 3600);
  await env.KIS_KV.put(KIS_TOKEN_KEY, JSON.stringify(token), {
    expirationTtl: ttl,
  });
};

const readTokenLock = async (env: Env): Promise<KisTokenLockRecord | null> => {
  if (!env.KIS_KV) return null;
  const raw = await env.KIS_KV.get(KIS_TOKEN_LOCK_KEY, { type: "json" });
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const owner = typeof row.owner === "string" ? row.owner : "";
  const expiresAt = Number(row.expires_at);
  if (!owner || !Number.isFinite(expiresAt)) return null;
  return {
    owner,
    expires_at: Math.floor(expiresAt),
  };
};

const acquireTokenLock = async (env: Env): Promise<string | null> => {
  if (!env.KIS_KV) return null;

  for (let attempt = 0; attempt <= TOKEN_LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    const now = nowSec();
    const existing = await readTokenLock(env);
    if (existing && existing.expires_at > now) {
      if (attempt < TOKEN_LOCK_RETRY_DELAYS_MS.length) {
        await sleep(TOKEN_LOCK_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return null;
    }

    const owner = crypto.randomUUID();
    const record: KisTokenLockRecord = {
      owner,
      expires_at: now + TOKEN_LOCK_EXPIRE_SEC,
    };
    await env.KIS_KV.put(KIS_TOKEN_LOCK_KEY, JSON.stringify(record), {
      expirationTtl: TOKEN_LOCK_KV_TTL_SEC,
    });
    const confirmed = await readTokenLock(env);
    if (confirmed?.owner === owner) return owner;

    if (attempt < TOKEN_LOCK_RETRY_DELAYS_MS.length) {
      await sleep(TOKEN_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }

  return null;
};

const releaseTokenLock = async (env: Env, owner: string | null): Promise<void> => {
  if (!env.KIS_KV || !owner) return;
  const current = await readTokenLock(env);
  if (current?.owner === owner) {
    await env.KIS_KV.delete(KIS_TOKEN_LOCK_KEY);
  }
};

const getAccessToken = async (
  env: Env,
  forceRefresh = false,
  metrics?: RequestMetrics,
): Promise<string> => {
  const cacheIdentity = getTokenCacheIdentity(env);
  const now = nowSec();

  if (!forceRefresh && memoryToken && memoryToken.cacheIdentity === cacheIdentity) {
    if (memoryToken.expires_at - now > TOKEN_REFRESH_WINDOW_SEC) {
      bumpMetric(metrics, "tokenCacheHits");
      return memoryToken.access_token;
    }
  }

  if (!forceRefresh) {
    const fromKv = await readTokenFromKv(env);
    if (fromKv && fromKv.expires_at - now > TOKEN_REFRESH_WINDOW_SEC) {
      memoryToken = { ...fromKv, cacheIdentity };
      bumpMetric(metrics, "tokenCacheHits");
      return fromKv.access_token;
    }
  }

  if (!env.KIS_KV) {
    // KV 미연결 시 런타임 메모리 기반으로만 토큰을 유지한다.
    bumpMetric(metrics, "tokenCacheMisses");
    bumpMetric(metrics, "tokenRefreshes");
    const fresh = await fetchNewToken(env, metrics);
    memoryToken = { ...fresh, cacheIdentity };
    return fresh.access_token;
  }

  const lockOwner = await acquireTokenLock(env);
  if (!lockOwner) {
    const latest = await readTokenFromKv(env);
    if (latest) {
      memoryToken = { ...latest, cacheIdentity };
      bumpMetric(metrics, "tokenCacheHits");
      return latest.access_token;
    }
    throw new Error("KIS 토큰 잠금 대기 후에도 유효 토큰을 확보하지 못했습니다.");
  }

  try {
    const latest = await readTokenFromKv(env);
    const remain = latest ? latest.expires_at - nowSec() : -1;
    if (!forceRefresh && latest && remain > TOKEN_REFRESH_WINDOW_SEC) {
      memoryToken = { ...latest, cacheIdentity };
      bumpMetric(metrics, "tokenCacheHits");
      return latest.access_token;
    }

    bumpMetric(metrics, "tokenCacheMisses");
    bumpMetric(metrics, "tokenRefreshes");
    const fresh = await fetchNewToken(env, metrics);
    await writeTokenToKv(env, fresh);
    memoryToken = { ...fresh, cacheIdentity };
    return fresh.access_token;
  } finally {
    await releaseTokenLock(env, lockOwner);
  }
};

const isTokenRelatedError = (data: unknown): boolean => {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<KisResponseBase>;
  const msg = `${row.msg_cd ?? ""} ${row.msg1 ?? ""}`.toLowerCase();
  return msg.includes("token") || msg.includes("토큰") || msg.includes("authorization");
};

interface KisFetchOptions {
  method?: "GET" | "POST";
  trId?: string;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  metrics?: RequestMetrics;
}

const kisFetch = async <T extends KisResponseBase>(
  env: Env,
  path: string,
  options: KisFetchOptions,
): Promise<{ response: Response; data: T }> => {
  const baseUrl = getBaseUrl(env);
  const method = options.method ?? "GET";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken(env, attempt === 1, options.metrics);
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }

    console.log(`[kis-call] ${path}${options.trId ? ` tr_id=${options.trId}` : ""}`);
    bumpMetric(options.metrics, "kisCalls");
    const response = await fetch(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.KIS_APP_KEY,
        appsecret: env.KIS_APP_SECRET,
        custtype: "P",
        "content-type": "application/json",
        ...(options.trId ? { tr_id: options.trId } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = {
        rt_cd: "1",
        msg_cd: `HTTP_${response.status}`,
        msg1: "KIS 응답(JSON 아님)",
      } satisfies KisResponseBase;
    }

    const tokenIssue = response.status === 401 || isTokenRelatedError(data);
    if (attempt === 0 && tokenIssue) {
      continue;
    }

    return {
      response,
      data: data as T,
    };
  }

  throw new Error("KIS API 호출 실패: 토큰 재발급 후에도 요청이 실패했습니다.");
};

const kisGet = async <T extends KisResponseBase>(
  env: Env,
  _cache: Cache,
  path: string,
  trId: string,
  params: Record<string, string>,
  metrics?: RequestMetrics,
): Promise<T> => {
  const { data: json } = await kisFetch<T>(env, path, {
    method: "GET",
    trId,
    params,
    metrics,
  });
  if (json.rt_cd === "0") {
    return json;
  }
  throw new Error(`KIS API 오류(${json.msg_cd}): ${json.msg1}`);
};

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

const pickNumber = (
  row: Record<string, string> | null,
  candidates: string[],
): number | null => {
  if (!row) return null;
  for (const key of candidates) {
    if (key in row) {
      const value = toNullableNumber(row[key]);
      if (value != null) return value;
    }
  }
  return null;
};

const pickText = (
  row: Record<string, string> | null,
  candidates: string[],
): string | null => {
  if (!row) return null;
  for (const key of candidates) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const outputRows = (
  output: Array<Record<string, string>> | Record<string, string> | undefined,
): Array<Record<string, string>> => {
  if (Array.isArray(output)) return output.filter((row) => row && typeof row === "object");
  if (output && typeof output === "object") return [output];
  return [];
};

const INVESTOR_NET_KEYS = [
  "prsn_ntby_qty",
  "frgn_ntby_qty",
  "orgn_ntby_qty",
  "prsn_ntby_tr_pbmn",
  "frgn_ntby_tr_pbmn",
  "orgn_ntby_tr_pbmn",
];

const hasInvestorNetData = (row: Record<string, string>): boolean =>
  INVESTOR_NET_KEYS.some((key) => toNullableNumber(row[key]) != null);

const pickLatestInvestorRow = (
  output: Array<Record<string, string>> | Record<string, string> | undefined,
): Record<string, string> | null => {
  const rows = outputRows(output);
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) =>
    String(b.stck_bsop_date ?? "").localeCompare(String(a.stck_bsop_date ?? "")),
  );

  // KIS는 최신 영업일 행이 빈 문자열로 내려오는 경우가 있어,
  // 값이 실제로 존재하는 가장 최신 행을 우선 선택한다.
  return sorted.find((row) => hasInvestorNetData(row)) ?? sorted[0];
};

const buildFundamentalSignal = (
  priceRow: Record<string, string> | null,
  errorMessage?: string,
): FundamentalSignal => {
  const per = pickNumber(priceRow, ["per"]);
  const pbr = pickNumber(priceRow, ["pbr"]);
  const eps = pickNumber(priceRow, ["eps"]);
  const bps = pickNumber(priceRow, ["bps"]);
  const marketCap = pickNumber(priceRow, ["hts_avls", "acml_tr_pbmn"]);
  const settlementMonth = pickText(priceRow, ["stac_month"]);

  let label: FundamentalSignal["label"] = "N/A";
  if (per != null && pbr != null) {
    if (per > 0 && per <= 10 && pbr <= 1.2) label = "UNDERVALUED";
    else if (per >= 25 || pbr >= 3) label = "OVERVALUED";
    else label = "FAIR";
  }

  const reasons: string[] = [];
  if (per != null) reasons.push(`PER ${round2(per)}배`);
  if (pbr != null) reasons.push(`PBR ${round2(pbr)}배`);
  if (eps != null) reasons.push(`EPS ${Math.round(eps).toLocaleString("ko-KR")}`);
  if (bps != null) reasons.push(`BPS ${Math.round(bps).toLocaleString("ko-KR")}`);
  if (marketCap != null) reasons.push(`시가총액 ${Math.round(marketCap).toLocaleString("ko-KR")}`);
  if (settlementMonth) reasons.push(`결산월 ${settlementMonth}`);

  if (reasons.length === 0) {
    reasons.push(errorMessage ? `펀더멘털 조회 실패: ${errorMessage}` : "펀더멘털 데이터가 부족합니다.");
  }

  return {
    per: round2(per),
    pbr: round2(pbr),
    eps: round2(eps),
    bps: round2(bps),
    marketCap: round2(marketCap),
    settlementMonth,
    label,
    reasons: reasons.slice(0, 5),
  };
};

const buildFlowSignal = (
  priceRow: Record<string, string> | null,
  investorRow: Record<string, string> | null,
  errorMessage?: string,
): FlowSignal => {
  const foreignNet = pickNumber(investorRow, ["frgn_ntby_qty"]);
  const institutionNet = pickNumber(investorRow, ["orgn_ntby_qty"]);
  const individualNet = pickNumber(investorRow, ["prsn_ntby_qty"]);
  const programNet = pickNumber(priceRow, ["pgtr_ntby_qty"]);
  const foreignHoldRate = pickNumber(priceRow, ["frgn_hldn_rate", "hts_frgn_ehrt"]);
  const investorAsOf = pickText(investorRow, ["stck_bsop_date"]);
  const todayYmd = nowIsoKst().slice(0, 10).replace(/-/g, "");
  const investorQtyMissing =
    foreignNet == null && institutionNet == null && individualNet == null;

  let score = 0;
  if (foreignNet != null) score += foreignNet > 0 ? 1 : foreignNet < 0 ? -1 : 0;
  if (institutionNet != null) score += institutionNet > 0 ? 1 : institutionNet < 0 ? -1 : 0;
  if (programNet != null) score += programNet > 0 ? 0.5 : programNet < 0 ? -0.5 : 0;

  let label: FlowSignal["label"] = "N/A";
  if (score >= 1.5) label = "BUYING";
  else if (score <= -1.5) label = "SELLING";
  else if (foreignNet != null || institutionNet != null || individualNet != null || programNet != null) {
    label = "BALANCED";
  }

  const reasons: string[] = [];
  if (investorAsOf && investorAsOf !== todayYmd) {
    reasons.push(`투자자 순매수는 최근 영업일(${investorAsOf}) 기준입니다.`);
  } else if (investorAsOf === todayYmd && investorQtyMissing) {
    reasons.push("당일 투자자 순매수는 장 마감 후 반영될 수 있습니다.");
  }
  if (foreignNet != null) {
    reasons.push(`외국인 순매수 ${Math.round(foreignNet).toLocaleString("ko-KR")}주`);
  }
  if (institutionNet != null) {
    reasons.push(`기관 순매수 ${Math.round(institutionNet).toLocaleString("ko-KR")}주`);
  }
  if (individualNet != null) {
    reasons.push(`개인 순매수 ${Math.round(individualNet).toLocaleString("ko-KR")}주`);
  }
  if (programNet != null) {
    reasons.push(`프로그램 순매수 ${Math.round(programNet).toLocaleString("ko-KR")}주`);
  }
  if (foreignHoldRate != null) {
    reasons.push(`외국인 보유율 ${round2(foreignHoldRate)}%`);
  }

  if (reasons.length === 0) {
    reasons.push(errorMessage ? `수급 조회 실패: ${errorMessage}` : "수급 데이터가 부족합니다.");
  }

  return {
    foreignNet: round2(foreignNet),
    institutionNet: round2(institutionNet),
    individualNet: round2(individualNet),
    programNet: round2(programNet),
    foreignHoldRate: round2(foreignHoldRate),
    label,
    reasons: reasons.slice(0, 6),
  };
};

const snapshotCacheKey = (symbol: string): string =>
  `https://cache.local/kis/snapshot/v2?symbol=${encodeURIComponent(symbol)}`;

export const fetchMarketSnapshot = async (
  env: Env,
  cache: Cache,
  symbol: string,
  metrics?: RequestMetrics,
): Promise<{ snapshot: KisMarketSnapshot; cacheTtlSec: number }> => {
  const ttlSec = timeframeCacheTtlSec("day");
  const cacheKey = snapshotCacheKey(symbol);
  const cached = await getCachedJson<KisMarketSnapshot>(cache, cacheKey);
  if (cached) {
    console.log(`[data-cache-hit] snapshot symbol=${symbol}`);
    bumpMetric(metrics, "dataCacheHits");
    return { snapshot: cached, cacheTtlSec: ttlSec };
  }

  console.log(`[data-cache-miss] snapshot symbol=${symbol}`);
  bumpMetric(metrics, "dataCacheMisses");

  const [priceResult, investorResult] = await Promise.allSettled([
    kisGet<KisPriceResponse>(
      env,
      cache,
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: symbol,
      },
      metrics,
    ),
    kisGet<KisInvestorResponse>(
      env,
      cache,
      "/uapi/domestic-stock/v1/quotations/inquire-investor",
      "FHKST01010900",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: symbol,
      },
      metrics,
    ),
  ]);

  const priceRow = priceResult.status === "fulfilled" ? priceResult.value.output ?? null : null;
  const investorRow =
    investorResult.status === "fulfilled"
      ? pickLatestInvestorRow(investorResult.value.output)
      : null;

  if (!priceRow && !investorRow) {
    const priceErr = priceResult.status === "rejected" ? priceResult.reason : null;
    const invErr = investorResult.status === "rejected" ? investorResult.reason : null;
    const message = [
      priceErr instanceof Error ? `price=${priceErr.message}` : null,
      invErr instanceof Error ? `investor=${invErr.message}` : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join(", ");
    throw new Error(message ? `KIS 시세/수급 조회 실패: ${message}` : "KIS 시세/수급 조회 실패");
  }

  const snapshot: KisMarketSnapshot = {
    fundamental: buildFundamentalSignal(
      priceRow,
      priceResult.status === "rejected" && priceResult.reason instanceof Error
        ? priceResult.reason.message
        : undefined,
    ),
    flow: buildFlowSignal(
      priceRow,
      investorRow,
      investorResult.status === "rejected" && investorResult.reason instanceof Error
        ? investorResult.reason.message
        : undefined,
    ),
  };

  await putCachedJson(cache, cacheKey, snapshot, ttlSec);
  return { snapshot, cacheTtlSec: ttlSec };
};

const fetchPeriodChunk = async (
  env: Env,
  cache: Cache,
  symbol: string,
  periodCode: "D" | "W" | "M",
  startDate: string,
  endDate: string,
  metrics?: RequestMetrics,
): Promise<KisDailyChartResponse> => {
  return kisGet<KisDailyChartResponse>(
    env,
    cache,
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "FHKST03010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: symbol,
      FID_INPUT_DATE_1: startDate,
      FID_INPUT_DATE_2: endDate,
      FID_PERIOD_DIV_CODE: periodCode,
      FID_ORG_ADJ_PRC: "1",
    },
    metrics,
  );
};

const fetchPeriodCandles = async (
  env: Env,
  cache: Cache,
  symbol: string,
  tf: "day" | "week" | "month",
  minCount: number,
  metrics?: RequestMetrics,
): Promise<{ name: string; candles: Candle[] }> => {
  const periodCode = tf === "day" ? "D" : tf === "week" ? "W" : "M";
  const windowDays = tf === "day" ? 420 : tf === "week" ? 4500 : 12000;
  const targetCount = Math.max(minCount, tf === "day" ? 170 : tf === "week" ? 120 : 80);
  const maxPage = tf === "day" ? Math.max(6, Math.ceil(targetCount / 90) + 2) : 4;
  const candleByDate = new Map<string, Candle>();

  let endDate = formatKstDate(new Date());
  let latestName = symbol;
  let lastOldest = "";

  for (let page = 0; page < maxPage && candleByDate.size < targetCount; page += 1) {
    const startDate = addDaysToYmd(endDate, -windowDays);
    const data = await fetchPeriodChunk(env, cache, symbol, periodCode, startDate, endDate, metrics);
    if (data.output1?.hts_kor_isnm) latestName = data.output1.hts_kor_isnm;

    const rows = Array.isArray(data.output2) ? data.output2 : [];
    if (rows.length === 0) break;

    let oldest = "99999999";
    for (const row of rows) {
      const day = String(row.stck_bsop_date ?? "");
      if (!/^\d{8}$/.test(day)) continue;
      if (day < oldest) oldest = day;

      const candle: Candle = {
        time: parseKisDate(day),
        open: toNumber(row.stck_oprc),
        high: toNumber(row.stck_hgpr),
        low: toNumber(row.stck_lwpr),
        close: toNumber(row.stck_clpr),
        volume: toNumber(row.acml_vol),
      };

      if (candle.close <= 0 || candle.high < candle.low) continue;
      candleByDate.set(day, candle);
    }

    if (!/^\d{8}$/.test(oldest) || oldest === lastOldest) break;
    lastOldest = oldest;

    const nextEnd = addDaysToYmd(oldest, -1);
    if (nextEnd >= endDate) break;
    endDate = nextEnd;
  }

  const candles = [...candleByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => entry[1]);

  if (candles.length === 0) {
    throw new Error(`KIS에서 ${tf} OHLCV 데이터를 받지 못했습니다.`);
  }

  return { name: latestName, candles };
};

const isoWeekId = (dateText: string): string => {
  const [y, m, d] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const aggregateCandles = (
  candles: Candle[],
  keyFn: (candle: Candle) => string,
): Candle[] => {
  const sorted = [...candles].sort((a, b) => a.time.localeCompare(b.time));
  const map = new Map<string, Candle>();
  const order: string[] = [];

  for (const candle of sorted) {
    const key = keyFn(candle);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...candle });
      order.push(key);
    } else {
      cur.high = Math.max(cur.high, candle.high);
      cur.low = Math.min(cur.low, candle.low);
      cur.close = candle.close;
      cur.volume += candle.volume;
      cur.time = candle.time; // 마지막 봉 시점을 대표 시간으로 사용
    }
  }

  return order.map((key) => map.get(key) as Candle).filter((c) => c.close > 0);
};

export const resampleDayToWeekCandles = (dayCandles: Candle[]): Candle[] =>
  aggregateCandles(dayCandles, (candle) => isoWeekId(candle.time.slice(0, 10)));

export const resampleDayToMonthCandles = (dayCandles: Candle[]): Candle[] =>
  aggregateCandles(dayCandles, (candle) => candle.time.slice(0, 7));

const cacheKeyForTf = (symbol: string, tf: Timeframe, minCount: number): string => {
  return `https://cache.local/kis/ohlcv/v2?symbol=${encodeURIComponent(symbol)}&tf=${tf}&min=${minCount}`;
};

const cacheKeyForBenchmark = (index: "KOSPI" | "KOSDAQ", minCount: number): string =>
  `https://cache.local/kis/index/v1?index=${index}&min=${minCount}`;

const INDEX_CODE_BY_MARKET: Record<"KOSPI" | "KOSDAQ", string> = {
  KOSPI: "0001",
  KOSDAQ: "1001",
};

const parseIndexDailyRow = (row: Record<string, string>): Candle | null => {
  const dateRaw =
    row.stck_bsop_date ??
    row.bstp_bsop_date ??
    row.bas_dt ??
    "";
  if (!/^\d{8}$/.test(String(dateRaw))) return null;

  const open = toNumber(row.bstp_oprc ?? row.stck_oprc ?? row.oprc ?? row.open_pric);
  const high = toNumber(row.bstp_hgpr ?? row.stck_hgpr ?? row.hgpr ?? row.high_pric);
  const low = toNumber(row.bstp_lwpr ?? row.stck_lwpr ?? row.lwpr ?? row.low_pric);
  const close = toNumber(
    row.bstp_nmix_prpr ??
      row.stck_clpr ??
      row.clpr ??
      row.prpr ??
      row.close_pric,
  );
  const volume = toNumber(
    row.acml_vol ?? row.acml_tr_pbmn ?? row.cntg_vol ?? row.cntg_qty ?? "0",
  );

  if (close <= 0 || high < low) return null;

  return {
    time: parseKisDate(String(dateRaw)),
    open: open > 0 ? open : close,
    high,
    low,
    close,
    volume: volume > 0 ? volume : 0,
  };
};

const fetchIndexPeriodChunk = async (
  env: Env,
  cache: Cache,
  indexCode: string,
  startDate: string,
  endDate: string,
  metrics?: RequestMetrics,
): Promise<KisIndexChartResponse> => {
  return kisGet<KisIndexChartResponse>(
    env,
    cache,
    "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
    "FHKUP03500100",
    {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: indexCode,
      FID_INPUT_DATE_1: startDate,
      FID_INPUT_DATE_2: endDate,
      FID_PERIOD_DIV_CODE: "D",
    },
    metrics,
  );
};

const fetchIndexCandles = async (
  env: Env,
  cache: Cache,
  market: "KOSPI" | "KOSDAQ",
  indexCode: string,
  minCount: number,
  metrics?: RequestMetrics,
): Promise<Candle[]> => {
  const targetCount = Math.max(minCount, 280);
  const maxPage = Math.max(4, Math.ceil(targetCount / 90) + 2);
  const windowDays = 420;
  const candleByDate = new Map<string, Candle>();
  let endDate = formatKstDate(new Date());
  let lastOldest = "";

  for (let page = 0; page < maxPage && candleByDate.size < targetCount; page += 1) {
    const startDate = addDaysToYmd(endDate, -windowDays);
    const data = await fetchIndexPeriodChunk(env, cache, indexCode, startDate, endDate, metrics);
    const rows = Array.isArray(data.output2) ? data.output2 : [];
    if (rows.length === 0) break;

    let oldest = "99999999";
    for (const row of rows) {
      const dateRaw =
        row.stck_bsop_date ??
        row.bstp_bsop_date ??
        row.bas_dt ??
        "";
      if (!/^\d{8}$/.test(String(dateRaw))) continue;
      if (String(dateRaw) < oldest) oldest = String(dateRaw);

      const candle = parseIndexDailyRow(row);
      if (!candle) continue;
      candleByDate.set(String(dateRaw), candle);
    }

    if (!/^\d{8}$/.test(oldest) || oldest === lastOldest) break;
    lastOldest = oldest;
    const nextEnd = addDaysToYmd(oldest, -1);
    if (nextEnd >= endDate) break;
    endDate = nextEnd;
  }

  const candles = [...candleByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => entry[1]);
  if (candles.length === 0) {
    throw new Error(`${market} 지수 일봉 조회 결과가 비었습니다.`);
  }
  return candles;
};

export const fetchMarketIndexCandles = async (
  env: Env,
  cache: Cache,
  market: "KOSPI" | "KOSDAQ",
  minCount: number,
  metrics?: RequestMetrics,
): Promise<{ index: "KOSPI" | "KOSDAQ"; candles: Candle[]; cacheTtlSec: number }> => {
  const index = market;
  const ttlSec = timeframeCacheTtlSec("day");
  const cacheKey = cacheKeyForBenchmark(index, minCount);
  const cached = await getCachedJson<{ candles: Candle[] }>(cache, cacheKey);
  if (cached && Array.isArray(cached.candles) && cached.candles.length > 0) {
    console.log(`[data-cache-hit] benchmark=${index}`);
    bumpMetric(metrics, "dataCacheHits");
    return { index, candles: cached.candles, cacheTtlSec: ttlSec };
  }

  console.log(`[data-cache-miss] benchmark=${index}`);
  bumpMetric(metrics, "dataCacheMisses");
  const candles = await fetchIndexCandles(
    env,
    cache,
    market,
    INDEX_CODE_BY_MARKET[market],
    minCount,
    metrics,
  );
  await putCachedJson(cache, cacheKey, { candles }, ttlSec);
  return { index, candles, cacheTtlSec: ttlSec };
};

export const fetchKospiIndexCandles = async (
  env: Env,
  cache: Cache,
  minCount: number,
  metrics?: RequestMetrics,
): Promise<{ index: "KOSPI"; candles: Candle[]; cacheTtlSec: number }> => {
  const result = await fetchMarketIndexCandles(env, cache, "KOSPI", minCount, metrics);
  return {
    index: "KOSPI",
    candles: result.candles,
    cacheTtlSec: result.cacheTtlSec,
  };
};

export const fetchTimeframeCandles = async (
  env: Env,
  cache: Cache,
  symbol: string,
  tf: Timeframe,
  minCount: number,
  metrics?: RequestMetrics,
): Promise<{ name: string; candles: Candle[]; cacheTtlSec: number }> => {
  const ttlSec = timeframeCacheTtlSec(tf);
  const rawKey = cacheKeyForTf(symbol, tf, minCount);
  const cached = await getCachedJson<{ name: string; candles: Candle[] }>(cache, rawKey);
  if (cached && Array.isArray(cached.candles) && cached.candles.length > 0) {
    console.log(`[data-cache-hit] tf=${tf} symbol=${symbol}`);
    bumpMetric(metrics, "dataCacheHits");
    return { ...cached, cacheTtlSec: ttlSec };
  }

  console.log(`[data-cache-miss] tf=${tf} symbol=${symbol}`);
  bumpMetric(metrics, "dataCacheMisses");
  const data = await fetchPeriodCandles(env, cache, symbol, tf, minCount, metrics);

  await putCachedJson(cache, rawKey, data, ttlSec);
  return { ...data, cacheTtlSec: ttlSec };
};

// Backward compatibility helper (legacy day-only usage)
export const fetchDailyCandles = async (
  env: Env,
  cache: Cache,
  symbol: string,
  minCount = 200,
): Promise<{ name: string; candles: Candle[] }> => {
  const result = await fetchTimeframeCandles(env, cache, symbol, "day", minCount, undefined);
  return {
    name: result.name,
    candles: result.candles,
  };
};
