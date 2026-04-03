import type { Candle, IndicatorPoint } from "../../../functions/lib/types";
import type { WangDailyDetectorBundle, WangDetectorResult } from "../../../functions/lib/wangCore/types";

export const makeDayExecutionFixture = (): { candles: Candle[]; ma20: IndicatorPoint[] } => {
  const candles = Array.from({ length: 18 }, (_, index) => {
    const day = new Date(Date.UTC(2024, 5, 17 + index));
    return {
      time: day.toISOString().slice(0, 10),
      open: 110.4 - index * 0.08,
      high: 111.2 - index * 0.04,
      low: 108.6 - index * 0.06,
      close: 109.8 - index * 0.1,
      volume: 3600 + (index % 3) * 220,
    };
  });

  const apply = (index: number, patch: Partial<Candle>) => {
    candles[index] = { ...candles[index], ...patch };
  };

  apply(4, { open: 109.4, high: 109.7, low: 106.9, close: 107.2, volume: 11200 });
  apply(5, { open: 107.4, high: 108.9, low: 107.1, close: 108.6, volume: 6400 });
  apply(8, { open: 108.2, high: 108.8, low: 107.4, close: 108.5, volume: 5900 });
  apply(10, { open: 108.4, high: 108.5, low: 107.0, close: 107.5, volume: 3300 });
  apply(11, { open: 107.6, high: 108.2, low: 106.9, close: 107.3, volume: 3100 });
  apply(17, { open: 107.8, high: 108.3, low: 107.0, close: 107.6, volume: 3500 });

  const ma20 = candles.map((candle) => ({
    time: candle.time,
    value: 108.4,
  }));

  return { candles, ma20 };
};

export const makeDetectorResult = <T>(
  key: string,
  ok: boolean,
  value: T,
  reasons: string[] = [],
  score = ok ? 80 : 0,
  confidence = ok ? 80 : 0,
): WangDetectorResult<T> => ({
  key,
  ok,
  score,
  confidence,
  value,
  reasons,
  evidence: [],
});

export const makeDailyBundleFixture = (options?: {
  eventRisk?: boolean;
  psychologyFlip?: boolean;
  strongStock?: boolean;
  lowVolumePullback?: boolean;
  executionState?: WangDailyDetectorBundle["reentryEligibility"]["value"]["state"];
}): WangDailyDetectorBundle => {
  const eventRisk = options?.eventRisk ?? false;
  const psychologyFlip = options?.psychologyFlip ?? true;
  const strongStock = options?.strongStock ?? true;
  const lowVolumePullback = options?.lowVolumePullback ?? true;
  const executionState = options?.executionState ?? (eventRisk ? "AVOID_EVENT_RISK" : "READY_ON_RETEST");

  return {
    metrics: {
      maxVolume: 11200,
      averageVolume: 4700,
      referenceVolume: 4500,
      ma20: 108.4,
      close: 107.6,
      belowMa20: true,
      ma20DistancePct: -0.74,
    },
    projectedZone: makeDetectorResult(
      "projectedZone",
      true,
      {
        ready: true,
        low: 106.6,
        high: 108.4,
        sourceTime: "2024-06-17",
        sourceStartTime: "2024-06-17",
        sourceEndTime: "2024-07-04",
        projectedStartIndex: 0,
        projectedEndIndex: 17,
      },
      ["Projected weekly minimum zone into daily execution area."],
    ),
    dailyRebase: makeDetectorResult(
      "dailyRebase",
      true,
      {
        indices: [8],
        count: 1,
        referenceVolume: 4500,
        latestTime: "2024-06-25",
      },
      ["Daily rebase volume appeared after the weekly minimum zone."],
    ),
    ma20Discount: makeDetectorResult(
      "ma20Discount",
      true,
      {
        ma20: 108.4,
        close: 107.6,
        belowMa20: true,
        distancePct: -0.74,
      },
      ["Price is below MA20 and qualifies as a discount area."],
    ),
    retest: makeDetectorResult(
      "retest",
      true,
      {
        indices: [10, 11, 17],
        latestIndex: 17,
        latestTime: "2024-07-04",
        inZoneNow: true,
        brokeDown: false,
      },
      ["Daily candles retested the projected weekly zone."],
    ),
    eventImpact: makeDetectorResult(
      "eventImpact",
      eventRisk,
      {
        evaluated: true,
        present: eventRisk,
        shockDate: eventRisk ? "2024-06-21" : null,
        shockLabel: eventRisk ? "earnings shock" : null,
        priceShockPct: eventRisk ? -8.5 : null,
        directImpact: eventRisk,
        revenueImpact: eventRisk,
        businessImpact: eventRisk,
        actionableRisk: eventRisk,
      },
      eventRisk ? ["External event has direct business impact."] : ["No direct business impact was found."],
      eventRisk ? 82 : 0,
      eventRisk ? 84 : 0,
    ),
    macroShockValidation: makeDetectorResult(
      "macroShockValidation",
      !eventRisk,
      {
        evaluated: true,
        present: !eventRisk,
        shockDate: "2024-06-21",
        shockLabel: "macro shock",
        externalShock: true,
        validatedAsOpportunity: !eventRisk,
      },
      !eventRisk ? ["Macro shock looked external and non-fundamental."] : [],
      !eventRisk ? 78 : 0,
      !eventRisk ? 74 : 0,
    ),
    psychologyFlip: makeDetectorResult(
      "psychologyFlip",
      psychologyFlip,
      {
        confirmed: psychologyFlip,
        index: psychologyFlip ? 5 : -1,
        time: psychologyFlip ? "2024-06-22" : null,
        triggerPrice: psychologyFlip ? 108.6 : null,
      },
      psychologyFlip ? ["Psychology flip appeared after a sharp drop."] : ["No psychology flip yet."],
    ),
    strongStockPullback: makeDetectorResult(
      "strongStockPullback",
      strongStock,
      {
        isStrong: strongStock,
        pullbackDetected: strongStock,
        index: strongStock ? 10 : -1,
        time: strongStock ? "2024-06-27" : null,
        lowVolume: strongStock,
        nearRecentHigh: strongStock,
      },
      strongStock
        ? ["Strong stock showed a low-volume pullback near the projected zone."]
        : ["Strong stock pullback was not detected."],
    ),
    lowVolumePullback: makeDetectorResult(
      "lowVolumePullback",
      lowVolumePullback,
      {
        dropDetected: lowVolumePullback,
        lowVolume: lowVolumePullback,
        nearZone: lowVolumePullback,
        nearMa20: lowVolumePullback,
        accumulationCandidate: lowVolumePullback,
        index: lowVolumePullback ? 10 : -1,
        time: lowVolumePullback ? "2024-06-27" : null,
        dropPct: lowVolumePullback ? -3.9 : null,
      },
      lowVolumePullback
        ? ["Low-volume panic drop was absorbed near the weekly zone."]
        : ["Low-volume pullback setup has not formed."],
    ),
    reentryEligibility: makeDetectorResult(
      "reentryEligibility",
      executionState !== "WAIT_PULLBACK" && executionState !== "AVOID_EVENT_RISK",
      {
        allowed: executionState !== "WAIT_PULLBACK" && executionState !== "AVOID_EVENT_RISK",
        state: executionState,
        reason:
          executionState === "AVOID_EVENT_RISK"
            ? "Event risk still dominates the setup."
            : executionState === "WAIT_PULLBACK"
              ? "Weekly structure exists but the daily pullback is not complete."
              : "Zone retest, MA20 discount, and psychology flip align for reentry.",
        triggers:
          executionState === "READY_ON_RETEST"
            ? ["zoneRetest", "belowMa20", "psychologyFlip"]
            : executionState === "WAIT_PULLBACK"
              ? ["weeklyStructure"]
              : [],
        blockers:
          executionState === "AVOID_EVENT_RISK"
            ? ["eventImpact"]
            : executionState === "WAIT_PULLBACK"
              ? ["pullbackNotReady"]
              : [],
      },
      [
        executionState === "AVOID_EVENT_RISK"
          ? "Avoid reentry until the event impact clears."
          : executionState === "WAIT_PULLBACK"
            ? "Daily execution is not ready yet."
            : "Daily execution is ready on retest.",
      ],
      executionState === "READY_ON_RETEST" ? 88 : executionState === "WAIT_PULLBACK" ? 48 : 30,
      executionState === "READY_ON_RETEST" ? 90 : executionState === "WAIT_PULLBACK" ? 55 : 40,
    ),
  };
};
