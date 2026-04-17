import { describe, expect, it } from "vitest";
import { onRequestGet } from "../functions/api/search";
import { searchStocks } from "../functions/lib/search";

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {},
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/search",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/search", () => {
  it("returns search results for partial query", async () => {
    const response = await onRequestGet(makeContext("http://localhost/api/search?q=%EC%99%80%EC%9D%B4%EC%A7%80"));
    const body = (await response.json()) as { count: number; items: Array<{ code: string; name: string }> };

    expect(response.status).toBe(200);
    expect(body.count).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("returns 400 when q is missing", async () => {
    const response = await onRequestGet(makeContext("http://localhost/api/search"));
    const body = (await response.json()) as { error?: string; code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(typeof body.error).toBe("string");
  });

  it("prioritizes actual name matches ahead of choseong-only matches", () => {
    const items = searchStocks("삼성", 8);
    const samsungIndex = items.findIndex((item) => item.code === "005930");
    const seosanIndex = items.findIndex((item) => item.code === "079650");

    expect(samsungIndex).toBeGreaterThanOrEqual(0);
    expect(items[0]?.name.startsWith("삼성")).toBe(true);
    expect(seosanIndex === -1 || seosanIndex > samsungIndex).toBe(true);
  });

  it("still supports choseong-only search", () => {
    const items = searchStocks("ㅅㅅㅈㅈ", 8);

    expect(items.some((item) => item.code === "005930")).toBe(true);
  });
});
