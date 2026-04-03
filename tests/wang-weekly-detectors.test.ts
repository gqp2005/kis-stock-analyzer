import { describe, expect, it } from "vitest";
import { detectWeeklyWangStructure } from "../functions/lib/wangCore/detectors/weekly";
import { makeLectureMinimumWeekCandles, makeWeeklyStructureCandles } from "./fixtures/wang/weekly";

describe("detectWeeklyWangStructure", () => {
  it("detects the weekly volume chain from life volume to minimum volume point", () => {
    const result = detectWeeklyWangStructure({
      candles: makeWeeklyStructureCandles(),
      ma20Series: [],
    });

    expect(result.lifeVolume.ok).toBe(true);
    expect(result.baseVolume.ok).toBe(true);
    expect(result.baseRepeat.ok).toBe(true);
    expect(result.risingVolume.ok).toBe(true);
    expect(result.elasticVolume.ok).toBe(true);
    expect(result.minVolumeRegion.ok).toBe(true);
    expect(result.minVolumePoint.ok).toBe(true);
    expect(result.minVolumePoint.value.index).toBe(24);
  });

  it("keeps minimum-volume region and minimum-volume point as separate weekly assertions", () => {
    const result = detectWeeklyWangStructure({
      candles: makeWeeklyStructureCandles(),
      ma20Series: [],
    });

    expect(result.minVolumeRegion.value.startIndex).toBeLessThan(result.minVolumePoint.value.index);
    expect(result.minVolumePoint.value.index).toBeLessThanOrEqual(result.minVolumeRegion.value.endIndex);
    expect(result.minVolumeRegion.value.startTime).not.toBe(result.minVolumePoint.value.time);
    expect(result.minVolumePoint.value.volume).toBeLessThanOrEqual(
      result.minVolumeRegion.value.thresholdVolume ?? Number.POSITIVE_INFINITY,
    );
  });

  it("uses the absolute lowest weekly bar inside the post-base minimum region", () => {
    const candles = makeLectureMinimumWeekCandles(200);
    const result = detectWeeklyWangStructure({
      candles,
      ma20Series: [],
    });

    expect(result.minVolumeRegion.ok).toBe(true);
    expect(result.minVolumePoint.ok).toBe(true);
    expect(result.minVolumePoint.value.index).toBe(198);
    expect(result.minVolumePoint.value.volume).toBe(13500);
    expect(result.minVolumePoint.value.time).toBe(candles[198].time);
  });

  it("detects the accumulation window and flush-style weekly structure", () => {
    const result = detectWeeklyWangStructure({
      candles: makeWeeklyStructureCandles(),
      ma20Series: [],
    });

    expect(result.accumulationWindow.value.activeBars).toBeGreaterThan(0);
    expect(result.pitDigging.ok).toBe(true);
    expect(result.supplyFlushTest.ok).toBe(true);
  });
});
