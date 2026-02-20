import { addDaysToYmd, formatKstDate } from "./market";
import type { Candle, Env } from "./types";
import { parseKisDate, toNumber } from "./utils";
import { getCachedJson, putCachedJson } from "./cache";

interface TokenCacheRecord {
  token: string;
  expiresAt: number;
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

const TOKEN_BUFFER_MS = 10 * 60 * 1000;
let memoryToken: (TokenCacheRecord & { cacheIdentity: string }) | null = null;

const getBaseUrl = (env: Env): string => {
  if (env.KIS_BASE_URL) return env.KIS_BASE_URL;
  if (env.KIS_ENV === "demo") return "https://openapivts.koreainvestment.com:29443";
  return "https://openapi.koreainvestment.com:9443";
};

const parseTokenExpiry = (raw: unknown): number | null => {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d, h, mi, s] = m;

  // KIS 응답은 KST 문자열이므로 UTC로 변환할 때 9시간을 차감합니다.
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h) - 9,
    Number(mi),
    Number(s),
  );
};

const getTokenCacheKey = (env: Env): string => {
  const base = getBaseUrl(env);
  const app = env.KIS_APP_KEY?.slice(0, 6) || "app";
  return `https://cache.local/kis/token?base=${encodeURIComponent(base)}&app=${encodeURIComponent(app)}`;
};

const fetchNewToken = async (env: Env): Promise<TokenCacheRecord> => {
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET env가 필요합니다.");
  }

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

  const now = Date.now();
  const expiryFromSeconds =
    typeof data.expires_in === "number" ? now + data.expires_in * 1000 : null;
  const expiryFromDate = parseTokenExpiry(data.access_token_token_expired);
  const expiresAt = expiryFromSeconds ?? expiryFromDate ?? now + 23 * 60 * 60 * 1000;

  return { token, expiresAt };
};

const getAccessToken = async (env: Env, cache: Cache, forceRefresh = false): Promise<string> => {
  const cacheIdentity = getTokenCacheKey(env);
  const now = Date.now();

  if (!forceRefresh && memoryToken && memoryToken.cacheIdentity === cacheIdentity) {
    if (memoryToken.expiresAt - now > TOKEN_BUFFER_MS) {
      return memoryToken.token;
    }
  }

  if (!forceRefresh) {
    const cached = await getCachedJson<TokenCacheRecord>(cache, cacheIdentity);
    if (cached && cached.expiresAt - now > TOKEN_BUFFER_MS) {
      memoryToken = { ...cached, cacheIdentity };
      return cached.token;
    }
  }

  const fresh = await fetchNewToken(env);
  memoryToken = { ...fresh, cacheIdentity };
  const ttl = Math.max(60, Math.floor((fresh.expiresAt - now) / 1000));
  await putCachedJson(cache, cacheIdentity, fresh, ttl);
  return fresh.token;
};

const isTokenRelatedError = (data: KisResponseBase): boolean => {
  const msg = `${data.msg_cd} ${data.msg1}`.toLowerCase();
  return msg.includes("token") || msg.includes("토큰") || msg.includes("authorization");
};

const kisGet = async <T extends KisResponseBase>(
  env: Env,
  cache: Cache,
  path: string,
  trId: string,
  params: Record<string, string>,
): Promise<T> => {
  const baseUrl = getBaseUrl(env);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken(env, cache, attempt === 1);
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.KIS_APP_KEY,
        appsecret: env.KIS_APP_SECRET,
        tr_id: trId,
        custtype: "P",
        "content-type": "application/json",
      },
    });

    const json = (await response.json()) as T;
    if (response.status === 401 && attempt === 0) {
      continue;
    }

    if (json.rt_cd === "0") {
      return json;
    }

    if (attempt === 0 && isTokenRelatedError(json)) {
      continue;
    }

    throw new Error(`KIS API 오류(${json.msg_cd}): ${json.msg1}`);
  }

  throw new Error("KIS API 호출 실패: 토큰 재발급 후에도 요청이 실패했습니다.");
};

const fetchDailyChunk = async (
  env: Env,
  cache: Cache,
  symbol: string,
  startDate: string,
  endDate: string,
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
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "1",
    },
  );
};

export const fetchDailyCandles = async (
  env: Env,
  cache: Cache,
  symbol: string,
  minCount = 200,
): Promise<{ name: string; candles: Candle[] }> => {
  const targetCount = Math.max(minCount, 130);
  const candleByDate = new Map<string, Candle>();
  let endDate = formatKstDate(new Date());
  let latestName = symbol;
  let lastOldest = "";

  for (let page = 0; page < 6 && candleByDate.size < targetCount; page += 1) {
    const startDate = addDaysToYmd(endDate, -420);
    const data = await fetchDailyChunk(env, cache, symbol, startDate, endDate);

    if (data.output1?.hts_kor_isnm) {
      latestName = data.output1.hts_kor_isnm;
    }

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

    if (!/^\d{8}$/.test(oldest) || oldest === lastOldest) {
      break;
    }
    lastOldest = oldest;

    const nextEnd = addDaysToYmd(oldest, -1);
    if (nextEnd >= endDate) break;
    endDate = nextEnd;
  }

  const candles = [...candleByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => entry[1]);

  if (candles.length === 0) {
    throw new Error("KIS에서 OHLCV 데이터를 받지 못했습니다.");
  }

  return {
    name: latestName,
    candles,
  };
};
