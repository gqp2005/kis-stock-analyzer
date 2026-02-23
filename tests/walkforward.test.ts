import { describe, expect, it } from "vitest";
import { runWalkForwardTuning } from "../functions/lib/walkforward";
import type { Candle } from "../functions/lib/types";

const makeCandles = (count: number, drift = 0.3): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const base = 100 + index * drift + Math.sin(index / 8) * 2;
    return {
      time: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open: base - 0.4,
      high: base + 1.2,
      low: base - 1.1,
      close: base,
      volume: 100000 + ((index % 15) + 1) * 700,
    };
  });

describe("walk-forward tuning", () => {
  it("returns defaults when candles are insufficient", () => {
    const result = runWalkForwardTuning(makeCandles(180));
    expect(result.sampleCount).toBe(0);
    expect(result.thresholds.volume).toBe(60);
    expect(result.thresholds.vcp).toBe(80);
  });

  it("builds threshold metrics on sufficient candles", () => {
    const result = runWalkForwardTuning(makeCandles(320));
    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.thresholds.volume).toBeGreaterThanOrEqual(55);
    expect(result.thresholds.vcp).toBeGreaterThanOrEqual(72);
    expect(result.metrics.volume.quality).toBeGreaterThanOrEqual(0);
  });
});

