import { describe, expect, it } from "vitest";
import { buildWangPayload } from "../functions/lib/wangCore/payload/buildWangPayload";
import { makeWangPayloadInputFixture } from "./fixtures/wang/payload";

describe("buildWangPayload", () => {
  it("keeps the legacy response shape while adding new detector contexts", () => {
    const payload = buildWangPayload(makeWangPayloadInputFixture());

    expect(payload.currentPhase).toBe("MIN_VOLUME");
    expect(payload.summary.interpretation).toBe("ACCUMULATE");
    expect(payload.minVolumeRegionContext?.durationBars).toBeGreaterThan(0);
    expect(payload.eventImpactContext?.actionableRisk).toBe(false);
    expect(payload.psychologyFlipContext?.confirmed).toBe(true);
    expect(payload.strongStockContext?.isStrong).toBe(true);
    expect(payload.markers.week.some((marker) => marker.type === "VOL_MIN_REGION")).toBe(true);
    expect(payload.markers.week.some((marker) => marker.type === "VOL_MIN")).toBe(true);
    expect(payload.tradeZones).toHaveLength(1);
    expect(payload.deprecated?.legacyCurrentPhaseMirrorsSummary).toBe(true);
  });

  it("carries execution fixture signals for psychology flip and low-volume pullback into reasons", () => {
    const payload = buildWangPayload(makeWangPayloadInputFixture());

    expect(payload.dailyExecutionContext.state).toBe("READY_ON_RETEST");
    expect(payload.psychologyFlipContext?.time).toBe("2024-06-22");
    expect(payload.strongStockContext?.pullbackDetected).toBe(true);
    expect(payload.reasons.some((reason) => reason.includes("Psychology flip"))).toBe(true);
    expect(payload.reasons.some((reason) => reason.includes("Low-volume panic drop"))).toBe(true);
  });

  it("surfaces event risk without breaking the old top-level payload fields", () => {
    const payload = buildWangPayload(makeWangPayloadInputFixture({ eventRisk: true }));

    expect(payload.summary.interpretation).toBe("CAUTION");
    expect(payload.dailyExecutionContext.state).toBe("AVOID_EVENT_RISK");
    expect(payload.eventImpactContext?.actionableRisk).toBe(true);
    expect(payload.riskNotes.some((note) => note.id === "risk-event")).toBe(true);
  });
});
