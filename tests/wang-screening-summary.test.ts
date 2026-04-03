import { describe, expect, it } from "vitest";
import { summarizeWangStrategyPayload } from "../functions/lib/wangStrategy";
import { buildWangPayloadFixture } from "./fixtures/wang/payload";

describe("summarizeWangStrategyPayload", () => {
  it("marks a weekly minimum + daily retest setup as an eligible accumulate candidate", () => {
    const summary = summarizeWangStrategyPayload(buildWangPayloadFixture());

    expect(summary.eligible).toBe(true);
    expect(summary.currentPhase).toBe("MIN_VOLUME");
    expect(summary.actionBias).toBe("ACCUMULATE");
    expect(summary.executionState).toBe("READY_ON_RETEST");
    expect(summary.zoneReady).toBe(true);
    expect(summary.ma20DiscountReady).toBe(true);
    expect(summary.dailyRebaseReady).toBe(true);
    expect(summary.retestReady).toBe(true);
  });

  it("keeps the same weekly structure as a watch candidate when daily pullback completion is missing", () => {
    const summary = summarizeWangStrategyPayload(
      buildWangPayloadFixture({ executionState: "WAIT_PULLBACK" }),
    );

    expect(summary.eligible).toBe(false);
    expect(summary.currentPhase).toBe("MIN_VOLUME");
    expect(summary.actionBias).toBe("WATCH");
    expect(summary.executionState).toBe("WAIT_PULLBACK");
    expect(summary.zoneReady).toBe(true);
    expect(summary.retestReady).toBe(true);
  });

  it("blocks eligibility when external event impact dominates the setup", () => {
    const summary = summarizeWangStrategyPayload(buildWangPayloadFixture({ eventRisk: true }));

    expect(summary.eligible).toBe(false);
    expect(summary.actionBias).toBe("CAUTION");
    expect(summary.executionState).toBe("AVOID_EVENT_RISK");
    expect(summary.zoneReady).toBe(true);
    expect(summary.ma20DiscountReady).toBe(true);
  });
});
