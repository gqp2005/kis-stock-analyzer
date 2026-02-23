import { describe, expect, it } from "vitest";
import { atr, bollingerBands, macd, rsi } from "../functions/lib/indicators";
import type { Candle } from "../functions/lib/types";

describe("indicator calculations", () => {
  it("RSI should reach 100 on strictly rising prices", () => {
    const closes = Array.from({ length: 20 }, (_, idx) => idx + 1);
    const result = rsi(closes, 14);
    expect(result[14]).toBe(100);
    expect(result[result.length - 1]).toBe(100);
  });

  it("Bollinger Bands should collapse to same value on constant prices", () => {
    const closes = Array.from({ length: 25 }, () => 10);
    const result = bollingerBands(closes, 20, 2);
    const idx = closes.length - 1;
    expect(result.mid[idx]).toBe(10);
    expect(result.upper[idx]).toBe(10);
    expect(result.lower[idx]).toBe(10);
  });

  it("ATR should follow Wilder smoothing", () => {
    const candles: Candle[] = [
      { time: "2026-01-01", open: 9, high: 10, low: 8, close: 9, volume: 1000 },
      { time: "2026-01-02", open: 10, high: 11, low: 9, close: 10, volume: 1100 },
      { time: "2026-01-03", open: 11, high: 12, low: 10, close: 11, volume: 1200 },
      { time: "2026-01-04", open: 12, high: 15, low: 11, close: 12, volume: 1300 },
    ];

    const result = atr(candles, 3);
    expect(result[2]).toBeCloseTo(2, 6); // initial ATR=(2+2+2)/3
    expect(result[3]).toBeCloseTo(8 / 3, 6); // (2*2 + 4)/3
  });

  it("MACD should stay positive on steadily rising prices", () => {
    const closes = Array.from({ length: 80 }, (_, idx) => 100 + idx * 0.6);
    const result = macd(closes, 12, 26, 9);
    const last = result.line[result.line.length - 1] ?? 0;
    const lastSignal = result.signal[result.signal.length - 1] ?? 0;
    expect(last).toBeGreaterThan(0);
    expect(lastSignal).toBeGreaterThan(0);
  });
});
