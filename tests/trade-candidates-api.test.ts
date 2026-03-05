import { describe, expect, it, vi } from "vitest";

vi.mock("../functions/lib/tradeMachine", () => ({
  getTradeCandidates: vi.fn(async () => ({
    ok: true,
    meta: {
      asOf: "2026-03-05T09:00:00+09:00",
      source: "KIS",
      market: "ALL",
      universeSize: 200,
    },
    summary: {
      dailyLossWon: 0,
      blockedByDailyLoss: false,
      openPositionCount: 0,
      strategyId: "autotrade-washout-v1",
      sourceDate: "2026-03-05",
    },
    candidates: [],
    warnings: [],
  })),
}));

import { onRequestGet } from "../functions/api/trade/candidates";

describe("/api/trade/candidates", () => {
  it("returns 200 payload", async () => {
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };

    const response = await onRequestGet({
      request: new Request("http://localhost/api/trade/candidates"),
      env: {},
      params: {},
      waitUntil: () => {},
      next: () => Promise.resolve(new Response("unused")),
      data: {},
      functionPath: "/api/trade/candidates",
    } as unknown as Parameters<typeof onRequestGet>[0]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; candidates: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.candidates)).toBe(true);
  });
});
