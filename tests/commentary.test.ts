import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(async () => null),
  putCachedJson: vi.fn(async () => undefined),
}));

import { onRequestPost } from "../functions/api/commentary";
import { getCachedJson, putCachedJson } from "../functions/lib/cache";

const getCachedJsonMock = vi.mocked(getCachedJson);
const putCachedJsonMock = vi.mocked(putCachedJson);

const makePayload = () => ({
  meta: {
    symbol: "005930",
    name: "삼성전자",
    market: "KOSPI",
    asOf: "2026-02-23T10:00:00+09:00",
    profile: "short",
  },
  final: {
    overall: "NEUTRAL",
    confidence: 68,
    summary: "혼조 · 모멘텀 보통 · 변동성 보통",
  },
  timeframe: {
    tf: "day",
    trend: 62,
    momentum: 58,
    risk: 47,
    reasons: ["MA20>MA60", "RSI 55 이상"],
    volumeScore: 55,
    volRatio: 1.12,
  },
});

const makeContext = (
  request: Request,
  envOverrides?: Partial<{
    OPENAI_API_KEY: string;
    OPENAI_MODEL: string;
  }>,
): Parameters<typeof onRequestPost>[0] =>
  ({
    request,
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ...envOverrides,
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/commentary",
  }) as unknown as Parameters<typeof onRequestPost>[0];

describe("/api/commentary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
    getCachedJsonMock.mockResolvedValue(null);
    putCachedJsonMock.mockResolvedValue(undefined);
  });

  it("falls back to rule commentary when OPENAI_API_KEY is missing", async () => {
    const request = new Request("http://localhost/api/commentary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makePayload()),
    });

    const response = await onRequestPost(makeContext(request));
    const body = (await response.json()) as {
      meta: { source: string };
      comment: string;
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.meta.source).toBe("RULE");
    expect(body.comment).toContain("삼성전자(005930)");
    expect(body.warnings.some((warning) => warning.includes("OPENAI_API_KEY"))).toBe(true);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const request = new Request("http://localhost/api/commentary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });

    const response = await onRequestPost(makeContext(request));
    expect(response.status).toBe(400);
  });
});
