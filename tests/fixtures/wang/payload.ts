import { detectWeeklyWangStructure } from "../../../functions/lib/wangCore/detectors/weekly";
import { buildWangPayload } from "../../../functions/lib/wangCore/payload/buildWangPayload";
import { makeDailyBundleFixture, makeDayExecutionFixture } from "./daily";
import { makeWeeklyStructureCandles } from "./weekly";

export const makeWangPayloadInputFixture = (options?: {
  eventRisk?: boolean;
  executionState?: NonNullable<Parameters<typeof makeDailyBundleFixture>[0]>["executionState"];
}) => {
  const weekCandles = makeWeeklyStructureCandles();
  const weekly = detectWeeklyWangStructure({
    candles: weekCandles,
    ma20Series: [],
  });
  const day = makeDayExecutionFixture();

  return {
    meta: {
      input: "005930",
      symbol: "005930",
      name: "삼성전자",
      market: "KOSPI",
      asOf: "2026-04-03T00:00:00+09:00",
      source: "KIS" as const,
      cacheTtlSec: 300,
      tf: "multi" as const,
      candleCount: day.candles.length,
      maxVolume: weekly.metrics.maxVolume,
      averageVolume: weekly.metrics.averageVolume,
      referenceVolume: weekly.metrics.referenceVolume,
    },
    candles: {
      week: weekCandles,
      day: day.candles,
    },
    dayMa20Series: day.ma20,
    weekly,
    daily: makeDailyBundleFixture(options),
    multiTimeframe: {
      month: null,
      week: null,
      day: null,
    },
    warnings: [],
  };
};

export const buildWangPayloadFixture = (options?: {
  eventRisk?: boolean;
  executionState?: NonNullable<Parameters<typeof makeDailyBundleFixture>[0]>["executionState"];
}) => buildWangPayload(makeWangPayloadInputFixture(options));
