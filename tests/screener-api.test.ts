import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenerStoredCandidate } from "../functions/lib/screener";
import type { ScreenerSnapshot } from "../functions/lib/screenerStore";

vi.mock("../functions/lib/cache", () => ({
  getCachedJson: vi.fn(),
  putCachedJson: vi.fn(async () => undefined),
}));

import { onRequestGet } from "../functions/api/screener";
import { getCachedJson } from "../functions/lib/cache";

const getCachedJsonMock = vi.mocked(getCachedJson);

const sampleCandidate: ScreenerStoredCandidate = {
  code: "005930",
  name: "삼성전자",
  market: "KOSPI",
  lastClose: 100000,
  lastDate: "2025-01-10",
  levels: {
    support: 98000,
    resistance: 103000,
    neckline: 100500,
  },
  hits: {
    volume: {
      score: 75,
      confidence: 70,
      volRatio: 1.3,
      patterns: ["BreakoutConfirmed"],
      reasons: ["거래량 패턴 테스트"],
    },
    hs: {
      detected: false,
      state: "NONE",
      neckline: null,
      breakDate: null,
      target: null,
      score: 20,
      confidence: 30,
      reasons: ["hs 없음"],
    },
    ihs: {
      detected: true,
      state: "CONFIRMED",
      neckline: 100500,
      breakDate: "2025-01-09",
      target: 108000,
      score: 78,
      confidence: 74,
      reasons: ["ihs 확인"],
    },
  },
  scoring: {
    all: { score: 80, confidence: 72 },
    volume: { score: 75, confidence: 70 },
    hs: { score: 20, confidence: 30 },
    ihs: { score: 78, confidence: 74 },
  },
  reasons: {
    all: ["테스트 all"],
    volume: ["테스트 volume"],
    hs: ["테스트 hs"],
    ihs: ["테스트 ihs"],
  },
  backtestSummary: {
    all: null,
    volume: null,
    hs: null,
    ihs: null,
  },
};

const sampleSnapshot: ScreenerSnapshot = {
  date: "2025-01-10",
  updatedAt: "2025-01-10T15:40:00+09:00",
  universeCount: 500,
  processedCount: 480,
  topN: 50,
  source: "KIS",
  warnings: [],
  candidates: [sampleCandidate],
  topCandidates: [sampleCandidate],
};

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "admin",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/screener",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/screener (cache-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: unknown }).caches = {
      open: vi.fn(async () => ({}) as unknown as Cache),
    };
  });

  it("returns cached snapshot immediately", async () => {
    getCachedJsonMock.mockResolvedValue(sampleSnapshot as never);

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=KOSPI&strategy=ALL&count=30"),
    );
    const body = (await response.json()) as {
      meta: { rebuildRequired: boolean; market: string; strategy: string };
      items: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(false);
    expect(body.meta.market).toBe("KOSPI");
    expect(body.meta.strategy).toBe("ALL");
    expect(body.items[0]?.code).toBe("005930");
  });

  it("returns last-success snapshot with rebuildRequired on cache miss", async () => {
    let calls = 0;
    getCachedJsonMock.mockImplementation(async () => {
      calls += 1;
      return (calls === 1 ? null : sampleSnapshot) as never;
    });

    const response = await onRequestGet(
      makeContext("http://localhost/api/screener?market=ALL&strategy=ALL&count=30"),
    );
    const body = (await response.json()) as {
      meta: { rebuildRequired: boolean };
      warnings: string[];
      items: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.meta.rebuildRequired).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.warnings.some((warning) => warning.includes("재빌드"))).toBe(true);
  });
});

