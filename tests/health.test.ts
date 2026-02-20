import { describe, expect, it } from "vitest";
import { onRequestGet } from "../functions/api/health";

describe("/api/health", () => {
  it("returns 200", async () => {
    const response = await onRequestGet({
      request: new Request("http://localhost/api/health"),
      env: {},
      params: {},
      waitUntil: () => {},
      next: () => Promise.resolve(new Response("not-used")),
      data: {},
      functionPath: "/api/health",
    } as unknown as Parameters<typeof onRequestGet>[0]);

    expect(response.status).toBe(200);
  });
});

