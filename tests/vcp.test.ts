import { describe, expect, it } from "vitest";
import { detectVcpPattern } from "../functions/lib/vcp";
import type { Candle } from "../functions/lib/types";

const makeCandles = (tailLastClose: number, tailLastVolume = 100_000): Candle[] => {
  const base = Array.from({ length: 200 }, (_, index) => 88 + index * 0.24);
  const prefix = [
    140, 145, 152, 160, 170, 166, 158, 150, 145, 142, 147, 153, 159, 164, 161, 156, 152, 150,
    154, 158, 161, 159, 156, 154,
  ];
  const rampCount = 36;
  const rampStart = 155;
  const ramp = Array.from({ length: rampCount }, (_, index) => {
    const ratio = index / (rampCount - 1);
    return rampStart + (tailLastClose - rampStart) * ratio;
  });
  const tail = [...prefix, ...ramp];
  const closes = [...base, ...tail];

  return closes.map((close, index) => {
    const time = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
    const prev = index === 0 ? close : closes[index - 1];
    const volume = index === closes.length - 1 ? tailLastVolume : 100_000;
    return {
      time,
      open: prev,
      high: close + 1,
      low: close - 1,
      close,
      volume,
    };
  });
};

describe("VCP detector", () => {
  it("returns safe fallback when candles are insufficient", () => {
    const candles = makeCandles(156).slice(-120);
    const vcp = detectVcpPattern(candles);

    expect(vcp.detected).toBe(false);
    expect(vcp.state).toBe("NONE");
    expect(vcp.score).toBe(0);
    expect(vcp.reasons[0]).toContain("데이터가 부족");
  });

  it("detects potential VCP with shrinking contractions near resistance", () => {
    const candles = makeCandles(160, 100_000);
    const vcp = detectVcpPattern(candles);

    expect(vcp.detected).toBe(true);
    expect(vcp.state).toBe("POTENTIAL");
    expect(vcp.score).toBeGreaterThanOrEqual(60);
    expect(vcp.contractions.length).toBeGreaterThanOrEqual(2);
    expect(vcp.distanceToR).not.toBeNull();
    expect(vcp.distanceToR!).toBeGreaterThanOrEqual(0);
    expect(vcp.distanceToR!).toBeLessThanOrEqual(0.08);
  });

  it("detects confirmed VCP breakout when close is above R with volume expansion", () => {
    const candles = makeCandles(175, 260_000);
    const vcp = detectVcpPattern(candles);

    expect(vcp.detected).toBe(true);
    expect(vcp.state).toBe("CONFIRMED");
    expect(vcp.breakDate).toBe(candles[candles.length - 1].time);
    expect(vcp.score).toBeGreaterThanOrEqual(70);
    expect(vcp.resistanceR).not.toBeNull();
    expect(candles[candles.length - 1].close).toBeGreaterThan(vcp.resistanceR!);
  });
});
