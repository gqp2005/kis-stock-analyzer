import { describe, expect, it } from "vitest";
import { analyzeCandles } from "../functions/lib/scoring";
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
    expect((result.levels.support as number) < latestClose).toBe(true);
    expect((result.levels.resistance as number) > latestClose).toBe(true);
  });
});

