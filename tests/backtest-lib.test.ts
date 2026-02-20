import { describe, expect, it } from "vitest";
import { runDayBacktest } from "../functions/lib/backtest";
import type { Candle } from "../functions/lib/types";

const makeTrendCandles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index));
    const drift = index * 0.12 + Math.sin(index / 7) * 0.35;
    const base = 100 + drift;
    const open = base - 0.1;
    const close = base + 0.15;
    return {
      time: day.toISOString().slice(0, 10),
      open,
      high: close + 0.45,
      low: open - 0.45,
      close,
      volume: 100000 + index * 60,
    };
  });

describe("runDayBacktest", () => {
  it("returns summary and period metrics when candles are sufficient", () => {
    const candles = makeTrendCandles(620);
    const result = runDayBacktest(candles, { holdBars: 10, signalOverall: "GOOD" });

    expect(result.summary.tradeCount).toBeGreaterThan(0);
    expect(result.periods).toHaveLength(3);
    expect(result.periods[0].label).toBe("3개월");
    expect(result.periods[1].label).toBe("6개월");
    expect(result.periods[2].label).toBe("1년");
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it("returns warning with empty trades when candles are insufficient", () => {
    const candles = makeTrendCandles(120);
    const result = runDayBacktest(candles, { holdBars: 10 });

    expect(result.summary.tradeCount).toBe(0);
    expect(result.trades).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("데이터가 부족"))).toBe(true);
  });
});
