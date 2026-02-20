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
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../functions/lib/kis";

const fetchMock = vi.mocked(fetchTimeframeCandles);
const resampleWeekMock = vi.mocked(resampleDayToWeekCandles);
const resampleMonthMock = vi.mocked(resampleDayToMonthCandles);

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

const makeMin15Candles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const time = new Date(Date.UTC(2025, 0, 2, 0, index * 15));
    const base = 80 + index * 0.08;
    return {
      time: `${time.toISOString().slice(0, 16)}:00+09:00`,
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.3,
      volume: 3000 + index * 15,
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
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns partial success with min15 disabled warning", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(260), cacheTtlSec: 60 };
      if (tf === "min15") throw new Error("당일 분봉 없음");
      throw new Error("unexpected tf");
    });
    resampleWeekMock.mockReturnValue(makeDayCandles(200));
    resampleMonthMock.mockReturnValue(makeDayCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/analysis?query=005930&tf=multi&count=180"),
    );
    const body = (await response.json()) as {
      final: { overall: string };
      timeframes: {
        day: object | null;
        week: object | null;
        month: object | null;
        min15: { timing?: unknown } | null;
      };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.timeframes.day).not.toBeNull();
    expect(body.timeframes.min15).not.toBeNull();
    expect(body.timeframes.min15?.timing ?? null).toBeNull();
    expect(body.warnings.some((w) => w.includes("15분봉은 장중/당일 데이터가 없어서 비활성"))).toBe(true);
    expect(typeof body.final.overall).toBe("string");
  });

  it("nulls week/month when resampled candles are insufficient", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(70), cacheTtlSec: 60 };
      if (tf === "min15") return { name: "삼성전자", candles: makeMin15Candles(80), cacheTtlSec: 60 };
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

  it("uses internal minimum counts for week/month when higher_tf_source=kis", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") return { name: "삼성전자", candles: makeDayCandles(280), cacheTtlSec: 60 };
      if (tf === "week") return { name: "삼성전자", candles: makeDayCandles(220), cacheTtlSec: 60 };
      if (tf === "month") return { name: "삼성전자", candles: makeDayCandles(90), cacheTtlSec: 60 };
      if (tf === "min15") return { name: "삼성전자", candles: makeMin15Candles(120), cacheTtlSec: 60 };
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
});
