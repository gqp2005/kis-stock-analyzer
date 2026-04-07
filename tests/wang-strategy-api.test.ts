import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { onRequestGet } from "../functions/api/wang-strategy";
import {
  fetchTimeframeCandles,
  resampleDayToMonthCandles,
  resampleDayToWeekCandles,
} from "../functions/lib/kis";
import { makeLectureMinimumWeekCandles } from "./fixtures/wang/weekly";

const fetchMock = vi.mocked(fetchTimeframeCandles);
const resampleWeekMock = vi.mocked(resampleDayToWeekCandles);
const resampleMonthMock = vi.mocked(resampleDayToMonthCandles);

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
    functionPath: "/api/wang-strategy",
  }) as unknown as Parameters<typeof onRequestGet>[0];

const makeWangCandles = (count: number): Candle[] => {
  const candles = Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index));
    const base = 90 + index * 0.12;
    return {
      time: day.toISOString().slice(0, 10),
      open: base - 0.45,
      high: base + 0.8,
      low: base - 0.8,
      close: base + 0.18,
      volume: 9000 + (index % 5) * 180,
    };
  });

  const apply = (
    index: number,
    patch: Partial<Candle>,
  ) => {
    if (index >= candles.length) return;
    candles[index] = {
      ...candles[index],
      ...patch,
    };
  };

  apply(180, { open: 111, high: 117, low: 110.5, close: 116, volume: 120000 });
  apply(190, { open: 112, high: 114.4, low: 111.6, close: 114, volume: 15500 });
  apply(198, { open: 113, high: 115, low: 112.8, close: 114.6, volume: 16800 });
  apply(206, { open: 114.5, high: 117.5, low: 114.1, close: 117.2, volume: 21000 });
  apply(214, { open: 116.2, high: 122.5, low: 115.9, close: 121.8, volume: 31000 });
  apply(222, { open: 113.4, high: 114.1, low: 112.4, close: 112.9, volume: 7200 });
  apply(223, { open: 112.9, high: 114.4, low: 112.6, close: 113.7, volume: 7800 });
  apply(224, { open: 113.6, high: 114.2, low: 112.8, close: 113.1, volume: 7600 });
  apply(225, { open: 113.0, high: 113.8, low: 112.5, close: 112.8, volume: 7400 });
  apply(233, { open: 113.5, high: 114.3, low: 112.7, close: 113.0, volume: 9800 });
  apply(count - 1, { open: 113.1, high: 113.8, low: 112.7, close: 113.0, volume: 9600 });

  return candles;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/wang-strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns independent wang strategy payload with chart overlays and teaching notes", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "삼성전자",
          candles: makeWangCandles(360),
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(makeWangCandles(200));
    resampleMonthMock.mockReturnValue(makeWangCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&tf=multi&count=240"),
    );
    const body = (await response.json()) as {
      meta: { tf: string; candleCount: number };
      summary: { interpretation: string };
      weeklyPhaseContext: { phase: string; baseRepeatCount: number };
      dailyExecutionContext: { state: string; dailyRebaseCount: number; belowMa20: boolean };
      currentPhase: string;
      phases: Array<{ phase: string; occurrences: unknown[] }>;
      checklist: Array<{ ok: boolean }>;
      tradeZones: Array<{ low: number; high: number }>;
      chartOverlays: {
        week: { refLevels: unknown[]; zones: unknown[]; movingAverages: unknown[] };
        day: { refLevels: unknown[]; zones: unknown[]; movingAverages: Array<{ points: unknown[] }> };
      };
      markers: {
        week: Array<{ type: string }>;
        day: Array<{ type: string }>;
      };
      candles: {
        week: unknown[];
        day: unknown[];
      };
      trainingNotes: Array<{ title: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.tf).toBe("multi");
    expect(body.meta.candleCount).toBe(240);
    expect(body.currentPhase).toBe("MIN_VOLUME");
    expect(body.summary.interpretation).toBe("ACCUMULATE");
    expect(body.weeklyPhaseContext.phase).toBe("MIN_VOLUME");
    expect(body.weeklyPhaseContext.baseRepeatCount).toBeGreaterThan(0);
    expect(body.dailyExecutionContext.state).toBe("READY_ON_RETEST");
    expect(body.dailyExecutionContext.belowMa20).toBe(true);
    expect(body.dailyExecutionContext.dailyRebaseCount).toBeGreaterThanOrEqual(1);
    expect(body.phases.some((item) => item.phase === "BASE_VOLUME" && item.occurrences.length > 0)).toBe(true);
    expect(body.checklist.length).toBeGreaterThanOrEqual(8);
    expect(body.tradeZones.length).toBeGreaterThan(0);
    expect(body.candles.week.length).toBeGreaterThan(0);
    expect(body.candles.day.length).toBe(240);
    expect(body.chartOverlays.week.refLevels.length).toBeGreaterThan(0);
    expect(body.chartOverlays.week.zones.length).toBeGreaterThan(0);
    expect(body.chartOverlays.day.zones.length).toBeGreaterThan(0);
    expect(body.chartOverlays.day.movingAverages[0]?.points.length).toBe(240);
    expect(body.markers.week.some((marker) => marker.type === "VOL_MIN")).toBe(true);
    expect(body.markers.day.some((marker) => marker.type === "VOL_BASE" || marker.type === "VOL_RETEST")).toBe(true);
    expect(body.trainingNotes.length).toBeGreaterThanOrEqual(5);
  });

  it("falls back to direct week/month fetch when resampled higher timeframes are insufficient", async () => {
    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "삼성전자",
          candles: makeWangCandles(360),
          cacheTtlSec: 60,
        };
      }
      if (tf === "week") {
        return {
          name: "삼성전자",
          candles: makeWangCandles(210),
          cacheTtlSec: 60,
        };
      }
      if (tf === "month") {
        return {
          name: "삼성전자",
          candles: makeWangCandles(85),
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(makeWangCandles(50));
    resampleMonthMock.mockReturnValue(makeWangCandles(20));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&count=240"),
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.some((call) => call[3] === "week" && call[4] === 200)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => call[3] === "month" && call[4] === 80)).toBe(true);
  });

  it("marks weekly minimum volume as the absolute lowest bar after the active sequence", async () => {
    const weekCandles = makeLectureMinimumWeekCandles(200);

    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "삼성전자",
          candles: makeWangCandles(360),
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(weekCandles);
    resampleMonthMock.mockReturnValue(makeWangCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&tf=multi&count=240"),
    );
    const body = (await response.json()) as {
      currentPhase: string;
      markers: {
        week: Array<{ type: string; volume: number; t: string }>;
      };
    };

    const minMarker = body.markers.week.find((marker) => marker.type === "VOL_MIN");

    expect(response.status).toBe(200);
    expect(body.currentPhase).toBe("MIN_VOLUME");
    expect(minMarker).toBeDefined();
    expect(minMarker?.volume).toBe(13500);
    expect(minMarker?.t).toBe(weekCandles[198].time);
  });

  it("adds lecture-1 short-volume and cooldown context to weekly payload", async () => {
    const weekCandles = makeLectureMinimumWeekCandles(200);

    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "?쇱꽦?꾩옄",
          candles: makeWangCandles(360),
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(weekCandles);
    resampleMonthMock.mockReturnValue(makeWangCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&tf=multi&count=240"),
    );
    const body = (await response.json()) as {
      weeklyPhaseContext: {
        minVolume: number | null;
        relativeShortVolumeScore: number;
        cooldownBarsFromLife: number | null;
        cooldownReady: boolean;
      };
      checklist: Array<{ id: string; ok: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.weeklyPhaseContext.minVolume).toBe(13500);
    expect(body.weeklyPhaseContext.relativeShortVolumeScore).toBeGreaterThan(0);
    expect(body.weeklyPhaseContext.cooldownBarsFromLife).toBeGreaterThanOrEqual(8);
    expect(body.weeklyPhaseContext.cooldownReady).toBe(true);
    expect(body.checklist.some((item) => item.id === "week-short-volume")).toBe(true);
    expect(body.checklist.some((item) => item.id === "week-cooldown" && item.ok)).toBe(true);
    expect(body.checklist.some((item) => item.id === "week-breakout-reset")).toBe(true);
  });

  it("ignores the current week even after market close when picking weekly minimum volume", async () => {
    const weekCandles = makeLectureMinimumWeekCandles(200);
    weekCandles[weekCandles.length - 1] = {
      ...weekCandles[weekCandles.length - 1],
      volume: 1000,
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${weekCandles[weekCandles.length - 1].time}T08:00:00Z`));

    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "?쇱꽦?꾩옄",
          candles: makeWangCandles(360),
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(weekCandles);
    resampleMonthMock.mockReturnValue(makeWangCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&tf=multi&count=240"),
    );
    const body = (await response.json()) as {
      markers: {
        week: Array<{ type: string; volume: number; t: string }>;
      };
    };

    const minMarker = body.markers.week.find((marker) => marker.type === "VOL_MIN");

    expect(response.status).toBe(200);
    expect(minMarker).toBeDefined();
    expect(minMarker?.volume).toBe(13500);
    expect(minMarker?.t).toBe(weekCandles[198].time);
  });

  it("ignores the current day even after market close when picking daily minimum volume", async () => {
    const dayCandles = makeWangCandles(360);
    dayCandles[dayCandles.length - 1] = {
      ...dayCandles[dayCandles.length - 1],
      volume: 1000,
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${dayCandles[dayCandles.length - 1].time}T08:00:00Z`));

    fetchMock.mockImplementation(async (_env, _cache, _symbol, tf) => {
      if (tf === "day") {
        return {
          name: "?쇱꽦?꾩옄",
          candles: dayCandles,
          cacheTtlSec: 60,
        };
      }
      throw new Error(`unexpected tf=${tf}`);
    });
    resampleWeekMock.mockReturnValue(makeLectureMinimumWeekCandles(200));
    resampleMonthMock.mockReturnValue(makeWangCandles(80));

    const response = await onRequestGet(
      makeContext("http://localhost/api/wang-strategy?query=005930&tf=multi&count=240"),
    );
    const body = (await response.json()) as {
      markers: {
        day: Array<{ type: string; volume: number; t: string }>;
      };
    };

    const minMarker = body.markers.day.find((marker) => marker.type === "VOL_MIN");

    expect(response.status).toBe(200);
    expect(minMarker).toBeDefined();
    expect(minMarker?.volume).toBe(7200);
    expect(minMarker?.t).toBe(dayCandles[222].time);
  });

  it("returns 400 when query is missing", async () => {
    const response = await onRequestGet(makeContext("http://localhost/api/wang-strategy"));
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });
});
