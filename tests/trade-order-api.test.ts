import { describe, expect, it, vi } from "vitest";

vi.mock("../functions/lib/tradeMachine", () => ({
  runTradeOrder: vi.fn(async () => ({
    ok: true,
    meta: {
      asOf: "2026-03-05T09:00:00+09:00",
      source: "KIS",
      market: "ALL",
      universeSize: 200,
      dryRun: false,
      autoExecute: false,
      useHashKey: false,
      retryOnce: false,
    },
    result: {
      clientOrderId: "test-order-id",
      code: "005930",
      name: "삼성전자",
      state: "POSITION_OPEN",
      orderNo: "123456",
      filledQty: 1,
      orderedQty: 1,
      remainingQty: 0,
      avgFillPrice: 100000,
      positionOpened: true,
      canceled: false,
      rejected: false,
      message: "전량 체결로 포지션을 열었습니다.",
      transitions: [],
    },
    warnings: [],
    logs: [],
  })),
}));

import { onRequestPost } from "../functions/api/trade/order";

describe("/api/trade/order", () => {
  it("returns 200 payload", async () => {
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };

    const response = await onRequestPost({
      request: new Request("http://localhost/api/trade/order", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          code: "005930",
        }),
      }),
      env: {},
      params: {},
      waitUntil: () => {},
      next: () => Promise.resolve(new Response("unused")),
      data: {},
      functionPath: "/api/trade/order",
    } as unknown as Parameters<typeof onRequestPost>[0]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; result: { code: string } };
    expect(body.ok).toBe(true);
    expect(body.result.code).toBe("005930");
  });
});
