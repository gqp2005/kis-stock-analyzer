import { getCachedJson, putCachedJson } from "./cache";
import {
  addDaysToYmd,
  formatKstDate,
  hhmmssToMinutes,
  minutesToHhmmss,
  nowKstDateYmd,
  timeframeCacheTtlSec,
} from "./market";
import { bumpMetric, type RequestMetrics } from "./observability";
import type { Candle, Env, Timeframe } from "./types";
import { parseKisDate, toNumber } from "./utils";

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

interface KisMinuteChartResponse extends KisResponseBase {
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

const fetchNewToken = async (env: Env, metrics?: RequestMetrics): Promise<TokenCacheRecord> => {
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

  const now = Date.now();
  const expiryFromSeconds =
    typeof data.expires_in === "number" ? now + data.expires_in * 1000 : null;
  const expiryFromDate = parseTokenExpiry(data.access_token_token_expired);
  const expiresAt = expiryFromSeconds ?? expiryFromDate ?? now + 23 * 60 * 60 * 1000;

  return { token, expiresAt };
};

const getAccessToken = async (
  env: Env,
  cache: Cache,
  forceRefresh = false,
  metrics?: RequestMetrics,
): Promise<string> => {
  const cacheIdentity = getTokenCacheKey(env);
  const now = Date.now();

  if (!forceRefresh && memoryToken && memoryToken.cacheIdentity === cacheIdentity) {
    if (memoryToken.expiresAt - now > TOKEN_BUFFER_MS) {
      bumpMetric(metrics, "tokenCacheHits");
      return memoryToken.token;
    }
  }

  if (!forceRefresh) {
    const cached = await getCachedJson<TokenCacheRecord>(cache, cacheIdentity);
    if (cached && cached.expiresAt - now > TOKEN_BUFFER_MS) {
      memoryToken = { ...cached, cacheIdentity };
      bumpMetric(metrics, "tokenCacheHits");
      return cached.token;
    }
  }

  bumpMetric(metrics, "tokenCacheMisses");
  bumpMetric(metrics, "tokenRefreshes");
  const fresh = await fetchNewToken(env, metrics);
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
  metrics?: RequestMetrics,
): Promise<T> => {
  const baseUrl = getBaseUrl(env);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken(env, cache, attempt === 1, metrics);
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    console.log(`[kis-call] ${path} tr_id=${trId}`);
    bumpMetric(metrics, "kisCalls");
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

const fetchMinuteChunk = async (
  env: Env,
  cache: Cache,
  symbol: string,
  inputHour: string,
  metrics?: RequestMetrics,
): Promise<KisMinuteChartResponse> => {
  return kisGet<KisMinuteChartResponse>(
    env,
    cache,
    "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
    "FHKST03010200",
    {
      FID_ETC_CLS_CODE: "",
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: symbol,
      FID_INPUT_HOUR_1: inputHour,
      FID_PW_DATA_INCU_YN: "Y",
    },
    metrics,
  );
};

const toIsoKst = (yyyymmdd: string, hhmmss: string): string => {
  const day = parseKisDate(yyyymmdd);
  const hh = hhmmss.slice(0, 2);
  const mm = hhmmss.slice(2, 4);
  return `${day}T${hh}:${mm}:00+09:00`;
};

const fetchMinuteCandlesToday = async (
  env: Env,
  cache: Cache,
  symbol: string,
  metrics?: RequestMetrics,
): Promise<{ name: string; candles: Candle[] }> => {
  const minuteMap = new Map<string, Candle>();
  const today = nowKstDateYmd();
  let latestName = symbol;
  let inputHour = "153000";
  let lastOldestKey = "";

  for (let page = 0; page < 30; page += 1) {
    const data = await fetchMinuteChunk(env, cache, symbol, inputHour, metrics);
    if (data.output1?.hts_kor_isnm) latestName = data.output1.hts_kor_isnm;
    const rows = Array.isArray(data.output2) ? data.output2 : [];
    if (rows.length === 0) break;

    let oldestKey = "99999999999999";
    for (const row of rows) {
      const day = String(row.stck_bsop_date ?? "");
      const time = String(row.stck_cntg_hour ?? "");
      if (!/^\d{8}$/.test(day) || !/^\d{6}$/.test(time)) continue;
      if (day !== today) continue;

      const key = `${day}${time}`;
      if (key < oldestKey) oldestKey = key;
      minuteMap.set(key, {
        time: toIsoKst(day, time),
        open: toNumber(row.stck_oprc),
        high: toNumber(row.stck_hgpr),
        low: toNumber(row.stck_lwpr),
        close: toNumber(row.stck_prpr ?? row.stck_clpr),
        volume: toNumber(row.cntg_vol ?? row.acml_vol),
      });
    }

    if (oldestKey === "99999999999999" || oldestKey === lastOldestKey) break;
    lastOldestKey = oldestKey;

    const oldestTime = oldestKey.slice(8);
    if (oldestTime <= "090000") break;
    const nextMinutes = hhmmssToMinutes(oldestTime) - 1;
    if (nextMinutes <= 0) break;
    inputHour = minutesToHhmmss(nextMinutes);
  }

  const candles = [...minuteMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => entry[1])
    .filter((candle) => candle.close > 0 && candle.high >= candle.low);

  if (candles.length === 0) {
    throw new Error("KIS에서 당일 분봉 데이터를 받지 못했습니다.");
  }

  return { name: latestName, candles };
};

const resampleTo5m = (minuteCandles: Candle[]): Candle[] => {
  if (minuteCandles.length === 0) return [];

  const buckets = new Map<string, Candle>();
  const order: string[] = [];

  const sorted = [...minuteCandles].sort((a, b) => a.time.localeCompare(b.time));
  for (const candle of sorted) {
    const day = candle.time.slice(0, 10);
    const hh = Number(candle.time.slice(11, 13));
    const mm = Number(candle.time.slice(14, 16));
    const minuteBucket = Math.floor(mm / 5) * 5;
    const key = `${day}T${String(hh).padStart(2, "0")}:${String(minuteBucket).padStart(2, "0")}:00+09:00`;

    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, {
        time: key,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      order.push(key);
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    }
  }

  return order.map((key) => buckets.get(key) as Candle).filter((c) => c.close > 0);
};

const cacheKeyForTf = (symbol: string, tf: Timeframe, minCount: number): string => {
  if (tf === "min5") {
    return `https://cache.local/kis/ohlcv/v2?symbol=${encodeURIComponent(symbol)}&tf=${tf}&date=${nowKstDateYmd()}`;
  }
  return `https://cache.local/kis/ohlcv/v2?symbol=${encodeURIComponent(symbol)}&tf=${tf}&min=${minCount}`;
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
  let data: { name: string; candles: Candle[] };
  if (tf === "day" || tf === "week" || tf === "month") {
    data = await fetchPeriodCandles(env, cache, symbol, tf, minCount, metrics);
  } else {
    const minute = await fetchMinuteCandlesToday(env, cache, symbol, metrics);
    data = {
      name: minute.name,
      candles: resampleTo5m(minute.candles),
    };
  }

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
