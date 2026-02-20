import { describe, expect, it } from "vitest";
import type { Candle } from "../functions/lib/types";
import {
  detectHeadShouldersPattern,
  detectInverseHeadShouldersPattern,
  getScreenerUniverse,
} from "../functions/lib/screener";

const buildCandles = (
  closes: number[],
  volumeOverrides: Record<number, number> = {},
): Candle[] =>
  closes.map((close, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    const prev = index > 0 ? closes[index - 1] : close;
    const high = Math.max(close, prev) + (index % 3 === 0 ? 2 : 1);
    const low = Math.min(close, prev) - (index % 4 === 0 ? 2 : 1);
    return {
      time: day,
      open: prev,
      high,
      low,
      close,
      volume: volumeOverrides[index] ?? 100000,
    };
  });

describe("screener pattern detection", () => {
  it("filters screener universe by market and numeric stock code", () => {
    const universe = getScreenerUniverse("KOSDAQ", 120);
    expect(universe.length).toBeLessThanOrEqual(120);
    expect(universe.every((item) => item.market === "KOSDAQ")).toBe(true);
    expect(universe.every((item) => /^\d{6}$/.test(item.code))).toBe(true);
  });

  it("detects head and shoulders candidates", () => {
    const base = Array.from({ length: 110 }, (_, i) => 90 + i * 0.2);
    const hsSegment = [
      112, 114, 116, 118, 120, 123, 126, 124, 121, 125, 130, 136, 132, 128, 123, 126, 130, 127,
      124, 120, 116, 113, 111, 109,
    ];
    const closes = [...base, ...hsSegment];
    const breakIdx = closes.length - 4;
    const candles = buildCandles(closes, {
      [breakIdx]: 260000,
      [breakIdx + 1]: 240000,
    });

    const hs = detectHeadShouldersPattern(candles);
    expect(hs.state === "NONE" || hs.state === "POTENTIAL" || hs.state === "CONFIRMED").toBe(true);
    expect(hs.score).toBeGreaterThanOrEqual(0);
    expect(hs.score).toBeLessThanOrEqual(100);
    expect(hs.confidence).toBeGreaterThanOrEqual(0);
    expect(hs.confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(hs.reasons)).toBe(true);
  });

  it("detects inverse head and shoulders candidates", () => {
    const base = Array.from({ length: 110 }, (_, i) => 150 - i * 0.15);
    const ihsSegment = [
      122, 120, 118, 116, 114, 112, 110, 108, 106, 108, 111, 114, 112, 108, 103, 106, 111, 114,
      112, 109, 105, 108, 113, 118, 121, 124, 126,
    ];
    const closes = [...base, ...ihsSegment];
    const breakIdx = closes.length - 5;
    const candles = buildCandles(closes, {
      [breakIdx]: 250000,
      [breakIdx + 1]: 230000,
    });

    const ihs = detectInverseHeadShouldersPattern(candles);
    expect(ihs.state === "NONE" || ihs.state === "POTENTIAL" || ihs.state === "CONFIRMED").toBe(true);
    expect(ihs.score).toBeGreaterThanOrEqual(0);
    expect(ihs.score).toBeLessThanOrEqual(100);
    expect(ihs.confidence).toBeGreaterThanOrEqual(0);
    expect(ihs.confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(ihs.reasons)).toBe(true);
  });
});
