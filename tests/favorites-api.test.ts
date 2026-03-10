import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../functions/lib/siteAuth", () => ({
  hasAdminOrSessionAccess: vi.fn(async () => true),
}));

vi.mock("../functions/lib/ownerFavorites", () => ({
  loadOwnerFavorites: vi.fn(async () => ({
    items: [{ code: "005930", name: "삼성전자" }],
    backend: "kv",
    enabled: true,
  })),
  addOwnerFavorite: vi.fn(async (_env, item) => ({
    items: [item],
    backend: "kv",
    enabled: true,
  })),
  removeOwnerFavorite: vi.fn(async () => ({
    items: [],
    backend: "kv",
    enabled: true,
  })),
  saveOwnerFavorites: vi.fn(async (_env, items) => ({
    items,
    backend: "kv",
    enabled: true,
  })),
}));

import { onRequestDelete, onRequestGet, onRequestPost, onRequestPut } from "../functions/api/favorites";

const makeContext = (request: Request): Parameters<typeof onRequestGet>[0] =>
  ({
    request,
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "secret-token",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/favorites",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns owner favorites", async () => {
    const response = await onRequestGet(
      makeContext(new Request("http://localhost/api/favorites")),
    );
    const body = (await response.json()) as { items: Array<{ code: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.code).toBe("005930");
  });

  it("adds a favorite", async () => {
    const response = await onRequestPost(
      makeContext(
        new Request("http://localhost/api/favorites", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "000660", name: "SK하이닉스" }),
        }),
      ),
    );
    const body = (await response.json()) as { items: Array<{ code: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.code).toBe("000660");
  });

  it("replaces favorites", async () => {
    const response = await onRequestPut(
      makeContext(
        new Request("http://localhost/api/favorites", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ items: [{ code: "035420", name: "NAVER" }] }),
        }),
      ),
    );
    const body = (await response.json()) as { items: Array<{ code: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.code).toBe("035420");
  });

  it("removes a favorite", async () => {
    const response = await onRequestDelete(
      makeContext(new Request("http://localhost/api/favorites?code=005930", { method: "DELETE" })),
    );
    const body = (await response.json()) as { items: unknown[] };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(0);
  });
});
