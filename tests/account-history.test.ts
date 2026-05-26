import { describe, expect, it } from "vitest";
import { buildAccountAssetHistorySeries } from "../functions/lib/accountHistory";

const makePoint = ({
  key,
  asOf,
  totalAssetAmount,
  period = "day",
}: {
  key: string;
  asOf: string;
  totalAssetAmount: number;
  period?: "day" | "week" | "month";
}) => ({
  version: 1,
  period,
  key,
  startDate: period === "month" ? `${key}-01` : key,
  endDate: period === "week" ? "2026-05-31" : period === "month" ? "2026-05-31" : key,
  asOf,
  account: "****2704-01",
  totalAssetAmount,
  totalEvaluationAmount: totalAssetAmount - 100,
  cashAmount: 100,
});

describe("account asset history", () => {
  it("sorts, dedupes by period key, and calculates period changes", () => {
    const series = buildAccountAssetHistorySeries("day", [
      makePoint({
        key: "2026-05-25",
        asOf: "2026-05-25T09:10:00+09:00",
        totalAssetAmount: 1_100,
      }),
      makePoint({
        key: "2026-05-24",
        asOf: "2026-05-24T09:10:00+09:00",
        totalAssetAmount: 1_000,
      }),
      makePoint({
        key: "2026-05-25",
        asOf: "2026-05-25T15:20:00+09:00",
        totalAssetAmount: 1_200,
      }),
      makePoint({
        key: "2026-05-26",
        asOf: "2026-05-26T10:00:00+09:00",
        totalAssetAmount: 1_150,
      }),
    ] as any);

    expect(series.points.map((point) => point.key)).toEqual([
      "2026-05-24",
      "2026-05-25",
      "2026-05-26",
    ]);
    expect(series.points.map((point) => point.changeAmount)).toEqual([null, 200, -50]);
    expect(series.latestChangeAmount).toBe(-50);
    expect(series.totalChangeAmount).toBe(150);
    expect(series.averageChangeAmount).toBe(75);
  });
});
