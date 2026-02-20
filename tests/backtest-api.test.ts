import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../functions/lib/types";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

vi.mock("../functions/lib/kis", () => ({
  fetchTimeframeCandles: vi.fn(),
}));

vi.mock("../functions/lib/stockResolver", () => ({
  resolveStock: vi.fn(() => ({
    code: "005930",
    name: "삼성전자",
    market: "KOSPI",
    matchedBy: "code",
  })),
}));

import { onRequestGet } from "../functions/api/backtest";
import { fetchTimeframeCandles } from "../functions/lib/kis";

const fetchMock = vi.mocked(fetchTimeframeCandles);

const makeDayCandles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index));
    const base = 100 + index * 0.1 + Math.sin(index / 6) * 0.25;
    return {
      time: day.toISOString().slice(0, 10),
      open: base - 0.15,
      high: base + 0.45,
      low: base - 0.45,
      close: base + 0.15,
      volume: 120000 + index * 70,
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
    functionPath: "/api/backtest",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/backtest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns 200 with summary and period metrics", async () => {
    fetchMock.mockResolvedValue({
      name: "삼성전자",
      candles: makeDayCandles(620),
      cacheTtlSec: 60,
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/backtest?query=005930&count=520&holdBars=10"),
    );
    const body = (await response.json()) as {
      meta: { signalOverall: string; holdBars: number; ruleId: string };
      summary: { tradeCount: number; payoffRatio: number | null };
      periods: Array<{ label: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.signalOverall).toBe("GOOD");
    expect(body.meta.holdBars).toBe(10);
    expect(body.meta.ruleId).toBe("score-card-v1-day-overall");
    expect(body.summary.tradeCount).toBeGreaterThanOrEqual(0);
    expect(body.summary).toHaveProperty("payoffRatio");
    expect(body.periods).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns 400 when query is missing", async () => {
    const response = await onRequestGet(makeContext("http://localhost/api/backtest"));
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });
});
