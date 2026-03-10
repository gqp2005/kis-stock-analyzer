import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../functions/lib/types";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

vi.mock("../functions/lib/kis", () => ({
  fetchTimeframeCandles: vi.fn(),
  resampleDayToWeekCandles: vi.fn(),
  resampleDayToMonthCandles: vi.fn(),
  fetchMarketSnapshot: vi.fn(async () => ({
    snapshot: {
      fundamental: {
        per: 12,
        pbr: 1.4,
        eps: 5000,
        bps: 42000,
        marketCap: 1000000,
        settlementMonth: "12",
        label: "FAIR",
        reasons: ["PER 12배", "PBR 1.4배"],
      },
      flow: {
        foreignNet: 100000,
        institutionNet: 50000,
        individualNet: -150000,
        programNet: 20000,
        foreignHoldRate: 52,
        label: "BUYING",
        reasons: ["외국인 순매수 100,000주"],
      },
    },
    cacheTtlSec: 60,
  })),
}));

vi.mock("../functions/lib/stockResolver", () => ({
  resolveStock: vi.fn(() => ({
    code: "005930",
    name: "삼성전자",
    market: "KOSPI",
    matchedBy: "code",
  })),
}));

import { onRequestGet } from "../functions/api/analysis";
import {
  fetchMarketSnapshot,
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../functions/lib/kis";

const fetchMock = vi.mocked(fetchTimeframeCandles);
const resampleWeekMock = vi.mocked(resampleDayToWeekCandles);
const resampleMonthMock = vi.mocked(resampleDayToMonthCandles);
const snapshotMock = vi.mocked(fetchMarketSnapshot);

const makeDayCandles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index));
    const base = 100 + index * 0.3;
    return {
      time: day.toISOString().slice(0, 10),
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + 0.8,
      volume: 100000 + index * 120,
    };
  });

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/analysis",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/analysis multi fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotMock.mockResolvedValue({
      snapshot: {
        fundamental: {
          per: 12,
          pbr: 1.4,
          eps: 5000,
          bps: 42000,
          marketCap: 1000000,
          settlementMonth: "12",
          label: "FAIR",
          reasons: ["PER 12배", "PBR 1.4배"],
        },
        flow: {
          foreignNet: 100000,
          institutionNet: 50000,
          individualNet: -150000,
          programNet: 20000,
          foreignHoldRate: 52,
          label: "BUYING",
          reasons: ["외국인 순매수 100,000주"],
        },
      },
      cacheTtlSec: 60,
    });
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns multi payload with month/week/day only", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(260), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });
    resampleWeekMock.mockReturnValue(makeDayCandles(200));
    resampleMonthMock.mockReturnValue(makeDayCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=180"),
    );
    const body = (await response.json()) as {
      meta: { profile: string };
      final: { overall: string; profile: { mode: string } | null };
      timeframes: {
        day: object | null;
        week: object | null;
        month: object | null;
        [key: string]: unknown;
      };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.timeframes.day).not.toBeNull();
    expect(body.timeframes.week).not.toBeNull();
    expect(body.timeframes.month).not.toBeNull();
    expect(Object.keys(body.timeframes).sort()).toEqual(["day", "month", "week"]);
    expect(body.meta.profile).toBe("short");
    expect(body.final.profile?.mode).toBe("short");
    expect(typeof body.final.overall).toBe("string");
  });

  it("applies profile=mid to final profile payload", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(260), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });
    resampleWeekMock.mockReturnValue(makeDayCandles(200));
    resampleMonthMock.mockReturnValue(makeDayCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=180&profile=mid"),
    );
    const body = (await response.json()) as {
      meta: { profile: string };
      final: { profile: { mode: string } | null };
    };

    expect(response.status).toBe(200);
    expect(body.meta.profile).toBe("mid");
    expect(body.final.profile?.mode).toBe("mid");
  });

  it("nulls week/month when resampled candles are insufficient", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(70), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });
    resampleWeekMock.mockReturnValue(makeDayCandles(40));
    resampleMonthMock.mockReturnValue(makeDayCandles(12));

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=120"),
    );
    const body = (await response.json()) as {
      final: { overall: string };
      timeframes: {
        day: object | null;
        week: object | null;
        month: object | null;
      };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.timeframes.day).not.toBeNull();
    expect(body.timeframes.week).toBeNull();
    expect(body.timeframes.month).toBeNull();
    expect(body.warnings.some((w) => w.includes("week 데이터 부족"))).toBe(true);
    expect(body.warnings.some((w) => w.includes("month 데이터 부족"))).toBe(true);
    expect(typeof body.final.overall).toBe("string");
  });

  it("falls back to reduced day fetch and direct higher tf fetch when large multi fetch is rate-limited", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf, minCount) => {
      if (tf === "day" && minCount >= 1400) {
        throw new Error("KIS API 오류(UNKNOWN): 초당 거래건수를 초과하였습니다.");
      }
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(260), cacheTtlSec: 60 };
      if (tf === "week") return { name: "삼성전자", candles: makeDayCandles(220), cacheTtlSec: 60 };
      if (tf === "month") return { name: "삼성전자", candles: makeDayCandles(90), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });
    resampleWeekMock.mockReturnValue(makeDayCandles(52));
    resampleMonthMock.mockReturnValue(makeDayCandles(13));

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=180"),
    );
    const body = (await response.json()) as {
      timeframes: {
        day: object | null;
        week: object | null;
        month: object | null;
      };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.timeframes.day).not.toBeNull();
    expect(body.timeframes.week).not.toBeNull();
    expect(body.timeframes.month).not.toBeNull();
    expect(body.warnings.some((w) => w.includes("day 대량 조회 실패"))).toBe(true);
    expect(body.warnings.some((w) => w.includes("KIS 직접 조회로 보완"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => call[3] === "day" && call[4] === 1400)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => call[3] === "day" && call[4] === 260)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => call[3] === "week" && call[4] === 200)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => call[3] === "month" && call[4] === 80)).toBe(true);
  });

  it("uses internal minimum counts for week/month when higher_tf_source=kis", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(280), cacheTtlSec: 60 };
      if (tf === "week") return { name: "삼성전자", candles: makeDayCandles(220), cacheTtlSec: 60 };
      if (tf === "month") return { name: "삼성전자", candles: makeDayCandles(90), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=120&higher_tf_source=kis"),
    );

    expect(response.status).toBe(200);
    const weekCall = fetchMock.mock.calls.find((call) => call[3] === "week");
    const monthCall = fetchMock.mock.calls.find((call) => call[3] === "month");
    expect(weekCall?.[4]).toBe(200);
    expect(monthCall?.[4]).toBe(80);
  });

  it("returns overlays/confluence/explanations for day tf with view=multi", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(280), cacheTtlSec: 60 };
      throw new Error("unexpected tf");
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?code=005930&tf=day&count=200&view=multi"),
    );
    const body = (await response.json()) as {
      overlays: {
        priceLines: Array<{ group: string }>;
        zones: Array<{ kind: string }>;
        segments: Array<{ kind: string }>;
        markers: Array<object>;
      };
      confluence: Array<{ bandLow: number; bandHigh: number; strength: number; reasons: string[] }>;
      explanations: string[];
      candles: Candle[];
    };

    expect(response.status).toBe(200);
    expect(body.candles.length).toBe(200);
    expect(body.overlays.priceLines.length).toBeGreaterThanOrEqual(4);
    expect(body.overlays.zones.length).toBeGreaterThanOrEqual(2);
    expect(
      body.overlays.segments.some(
        (segment) => segment.kind === "trendlineUp" || segment.kind === "trendlineDown",
      ),
    ).toBe(true);
    expect(Array.isArray(body.overlays.markers)).toBe(true);
    expect(body.confluence.length).toBeGreaterThan(0);
    expect(body.explanations.length).toBeGreaterThan(0);
  });
});
