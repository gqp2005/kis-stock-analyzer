import { describe, expect, it } from "vitest";
import {
  analyzeCandles,
  analyzeTimeframe,
  computeMultiFinal,
} from "../functions/lib/scoring";
import type { Candle } from "../functions/lib/types";

describe("analysis scoring extras", () => {
  it("should include summaryText and valid support/resistance", () => {
    const candles: Candle[] = [];
    let price = 100;

    for (let i = 0; i < 180; i += 1) {
      const drift = Math.sin(i / 9) * 1.4 + 0.25;
      const open = price;
      const close = Math.max(10, price + drift);
      const high = Math.max(open, close) + 0.9;
      const low = Math.min(open, close) - 0.8;
      const volume = 100000 + (i % 17) * 900;
      const day = String((i % 28) + 1).padStart(2, "0");
      candles.push({
        time: `2025-01-${day}`,
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }

    const latestClose = candles[candles.length - 1].close;
    const result = analyzeCandles(candles);

    expect(result.summaryText.includes("·")).toBe(true);
    expect(result.levels.support).not.toBeNull();
    expect(result.levels.resistance).not.toBeNull();
    expect(result.signals.volume.volRatio).toBeTypeOf("number");
    expect(result.signals.volume.volumeScore).toBeGreaterThanOrEqual(0);
    expect(result.signals.volume.volumeScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.signals.volumePatterns)).toBe(true);
    expect((result.levels.support as number) < latestClose).toBe(true);
    expect((result.levels.resistance as number) > latestClose).toBe(true);
  });

  it("should support partial multi final when only day is available", () => {
    const candles: Candle[] = [];
    let price = 120;
    for (let i = 0; i < 180; i += 1) {
      const drift = Math.sin(i / 7) * 1.1 + 0.2;
      const open = price;
      const close = Math.max(10, price + drift);
      candles.push({
        time: `2025-02-${String((i % 28) + 1).padStart(2, "0")}`,
        open,
        high: Math.max(open, close) + 0.7,
        low: Math.min(open, close) - 0.7,
        close,
        volume: 120000 + (i % 11) * 800,
      });
      price = close;
    }

    const day = analyzeTimeframe("day", candles);
    const final = computeMultiFinal(null, null, day);

    expect(final.overall).toBe(day.scores.overall);
    expect(final.summary).toBe(day.summaryText);
  });

  it("should detect breakout pattern and raise volume score", () => {
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 60; i += 1) {
      const open = price;
      const close = price + 0.2;
      candles.push({
        time: `2025-03-${String((i % 28) + 1).padStart(2, "0")}`,
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 100000,
      });
      price = close;
    }

    const prevHigh = Math.max(...candles.slice(-20).map((candle) => candle.high));
    candles.push({
      time: "2025-04-01",
      open: prevHigh - 0.5,
      high: prevHigh + 3,
      low: prevHigh - 1,
      close: prevHigh + 2.5,
      volume: 260000,
    });

    const day = analyzeTimeframe("day", candles);
    expect(day.signals.volumePatterns.some((pattern) => pattern.type === "BreakoutConfirmed")).toBe(true);
    expect(day.signals.volume.volRatio).toBeGreaterThanOrEqual(1.5);
    expect(day.signals.volume.volumeScore).toBeGreaterThan(50);
  });
});
