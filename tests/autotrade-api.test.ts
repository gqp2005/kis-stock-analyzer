import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

import { onRequestGet } from "../functions/api/autotrade";

describe("/api/autotrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns 200 with warnings when screener snapshot is missing", async () => {
    const response = await onRequestGet({
      request: new Request("http://localhost/api/autotrade"),
      env: {},
      params: {},
      waitUntil: () => {},
      next: () => Promise.resolve(new Response("not-used")),
      data: {},
      functionPath: "/api/autotrade",
    } as unknown as Parameters<typeof onRequestGet>[0]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      candidates: unknown[];
      warnings: string[];
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates.length).toBe(0);
    expect(body.warnings.length).toBeGreaterThan(0);
  });
});
