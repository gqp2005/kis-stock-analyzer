import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPersistedJson,
  listPersistedByPrefix,
  persistenceBackend,
} from "../functions/lib/screenerPersistence";

vi.mock("../functions/lib/screenerPersistence", () => ({
  persistenceBackend: vi.fn(() => "none"),
  listPersistedByPrefix: vi.fn(async () => []),
  getPersistedJson: vi.fn(async () => null),
}));

import { onRequestGet } from "../functions/api/admin/rebuild-screener/history";

const mockedPersistenceBackend = vi.mocked(persistenceBackend);
const mockedListPersistedByPrefix = vi.mocked(listPersistedByPrefix);
const mockedGetPersistedJson = vi.mocked(getPersistedJson);

const makeContext = (url: string): Parameters<typeof onRequestGet>[0] =>
  ({
    request: new Request(url),
    env: {
      KIS_APP_KEY: "dummy",
      KIS_APP_SECRET: "dummy",
      ADMIN_TOKEN: "secret-token",
    },
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("unused")),
    data: {},
    functionPath: "/api/admin/rebuild-screener/history",
  }) as unknown as Parameters<typeof onRequestGet>[0];

describe("/api/admin/rebuild-screener/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPersistenceBackend.mockReturnValue("none");
    mockedListPersistedByPrefix.mockResolvedValue([]);
    mockedGetPersistedJson.mockResolvedValue(null);
  });

  it("returns 401 when token is invalid", async () => {
    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/history?token=wrong"),
    );
    expect(response.status).toBe(401);
  });

  it("returns empty history with message when persistence backend is disabled", async () => {
    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/history?token=secret-token"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      backend: string;
      changes: unknown[];
      failures: unknown[];
      message: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.backend).toBe("none");
    expect(body.changes.length).toBe(0);
    expect(body.failures.length).toBe(0);
    expect(body.message).toContain("영속 저장소");
  });

  it("returns mapped history data when persistence backend is enabled", async () => {
    mockedPersistenceBackend.mockReturnValue("kv");
    mockedListPersistedByPrefix.mockImplementation(async (_env, prefix) => {
      if (prefix === "history:changes:") {
        return [
          {
            key: "history:changes:2026-02-23",
            value: {
              date: "2026-02-23",
              updatedAt: "2026-02-23T06:00:00+09:00",
              changeSummary: { basisTopN: 30, added: [], removed: [], risers: [], fallers: [] },
              alertsMeta: { topN: 5, sentCount: 2, skippedCount: 1 },
            },
          },
        ] as never;
      }
      return [
        {
          key: "history:failures:2026-02-23",
          value: {
            date: "2026-02-23",
            updatedAt: "2026-02-23T06:00:00+09:00",
            failedItems: [{ code: "005930", name: "삼성전자", market: "KOSPI", reason: "x", retries: 1, at: "t" }],
            retryStats: { totalRetries: 1, retriedSymbols: 1, maxRetryPerSymbol: 1 },
          },
        },
      ] as never;
    });
    mockedGetPersistedJson.mockResolvedValue({
      updatedAt: "2026-02-23T06:00:00+09:00",
      sent: {
        "added:005930": { sentAt: "2026-02-23T06:00:00+09:00" },
      },
    } as never);

    const response = await onRequestGet(
      makeContext("http://localhost/api/admin/rebuild-screener/history?token=secret-token&limit=7"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      backend: string;
      changes: Array<{ date: string }>;
      failures: Array<{ date: string; failedItems: unknown[] }>;
      alerts: { count: number };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.backend).toBe("kv");
    expect(body.changes[0]?.date).toBe("2026-02-23");
    expect(body.failures[0]?.failedItems.length).toBe(1);
    expect(body.alerts.count).toBe(1);
  });
});

