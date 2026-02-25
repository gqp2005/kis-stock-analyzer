import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AdminRebuildHistoryResponse, AdminRebuildStatusResponse } from "./types";

interface AdminOpsPanelProps {
  apiBase: string;
}

const REBUILD_POLL_INTERVAL_MS = 1500;
const REBUILD_MAX_ATTEMPTS = 180;

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "-";
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return value;
  return dt.toLocaleString("ko-KR");
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const compactText = (raw: string, max = 180): string =>
  raw.replace(/\s+/g, " ").trim().slice(0, max);

const readJsonBody = async <T,>(response: Response, endpoint: string): Promise<T> => {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const preview = compactText(raw);
    throw new Error(
      `API가 JSON이 아닌 응답을 반환했습니다 (${response.status}) [${endpoint}] ${preview || "empty body"}`,
    );
  }
};

const pickApiError = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const error = typeof record.error === "string" ? record.error : "";
  const message = typeof record.message === "string" ? record.message : "";
  return error || message || fallback;
};

const toPercent = (processed: number, total: number): number => {
  if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (processed / total) * 100));
};

export default function AdminOpsPanel(props: AdminOpsPanelProps) {
  const { apiBase } = props;
  const [token, setToken] = useState("");
  const [batchSize, setBatchSize] = useState(20);
  const [historyLimit, setHistoryLimit] = useState(7);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusData, setStatusData] = useState<AdminRebuildStatusResponse | null>(null);
  const [historyData, setHistoryData] = useState<AdminRebuildHistoryResponse | null>(null);

  const loadDashboard = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("admin token을 입력하세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const statusUrl = `${apiBase}/api/admin/rebuild-screener/status?token=${encodeURIComponent(trimmed)}`;
      const historyUrl = `${apiBase}/api/admin/rebuild-screener/history?token=${encodeURIComponent(trimmed)}&limit=${historyLimit}`;
      const [statusResp, historyResp] = await Promise.all([fetch(statusUrl), fetch(historyUrl)]);
      const statusJson = await readJsonBody<AdminRebuildStatusResponse | { error?: string; message?: string }>(
        statusResp,
        "/api/admin/rebuild-screener/status",
      );
      const historyJson = await readJsonBody<AdminRebuildHistoryResponse | { error?: string; message?: string }>(
        historyResp,
        "/api/admin/rebuild-screener/history",
      );
      if (!statusResp.ok) {
        throw new Error(
          pickApiError(statusJson, `상태 조회 실패 (HTTP ${statusResp.status})`),
        );
      }
      if (!historyResp.ok) {
        throw new Error(
          pickApiError(historyJson, `히스토리 조회 실패 (HTTP ${historyResp.status})`),
        );
      }
      setStatusData(statusJson as AdminRebuildStatusResponse);
      setHistoryData(historyJson as AdminRebuildHistoryResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "관리자 대시보드 조회 실패");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadDashboard();
  };

  const triggerRebuild = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("admin token을 입력하세요.");
      return;
    }
    setRebuildLoading(true);
    setError("");
    try {
      const rebuildUrl = `${apiBase}/api/admin/rebuild-screener?batch=${batchSize}&token=${encodeURIComponent(trimmed)}`;
      for (let attempt = 1; attempt <= REBUILD_MAX_ATTEMPTS; attempt += 1) {
        const response = await fetch(rebuildUrl, { method: "POST" });
        const body = await readJsonBody<{
          ok?: boolean;
          inProgress?: boolean;
          error?: string;
          message?: string;
        }>(response, "/api/admin/rebuild-screener");
        if (!response.ok || body.ok === false) {
          throw new Error(
            pickApiError(body, `rebuild 실행 실패 (HTTP ${response.status})`),
          );
        }

        await loadDashboard();

        if (body.inProgress !== true) {
          return;
        }
        if (attempt >= REBUILD_MAX_ATTEMPTS) {
          throw new Error(
            `rebuild가 ${REBUILD_MAX_ATTEMPTS}회 시도 내 완료되지 않았습니다. 잠시 후 다시 실행하세요.`,
          );
        }
        await sleep(REBUILD_POLL_INTERVAL_MS);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "rebuild 실행 실패");
    } finally {
      setRebuildLoading(false);
    }
  };

  useEffect(() => {
    if (!autoRefresh) return;
    if (!token.trim()) return;
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, token, historyLimit]);

  const progressPercent = useMemo(() => {
    if (!statusData?.progress) return 0;
    return toPercent(statusData.progress.processed, statusData.progress.total);
  }, [statusData?.progress]);

  const latestChange = historyData?.changes?.[0] ?? null;
  const latestFailure = historyData?.failures?.[0] ?? null;

  return (
    <section className="admin-ops">
      <form className="admin-controls" onSubmit={onSubmit}>
        <label>
          Admin Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="x-admin-token"
            autoComplete="off"
          />
        </label>
        <label>
          Batch
          <select value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label>
          History
          <select value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
            <option value={5}>5일</option>
            <option value={7}>7일</option>
            <option value={14}>14일</option>
            <option value={30}>30일</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          자동 새로고침(10초)
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "조회 중..." : "상태 조회"}
        </button>
        <button type="button" onClick={triggerRebuild} disabled={rebuildLoading}>
          {rebuildLoading ? "실행 중..." : "Rebuild 실행"}
        </button>
      </form>

      <p className="screener-note">
        운영 화면은 관리자 전용입니다. 토큰은 브라우저 메모리에만 유지되며 저장하지 않습니다.
      </p>

      {error && <p className="error">{error}</p>}

      {statusData && (
        <>
          <div className="card">
            <h3>운영 요약</h3>
            <div className="ops-grid">
              <div className="plan-item">
                <span>리빌드 상태</span>
                <strong>{statusData.inProgress ? "진행 중" : "대기"}</strong>
              </div>
              <div className="plan-item">
                <span>스토리지</span>
                <strong>
                  {statusData.storage?.enabled
                    ? `${statusData.storage.backend.toUpperCase()} (${statusData.storage.snapshotSource})`
                    : "Cache API만 사용"}
                </strong>
              </div>
              <div className="plan-item">
                <span>락 상태</span>
                <strong>
                  {statusData.lock.exists
                    ? `${statusData.lock.stale ? "stale" : "활성"} / ${statusData.lock.ageSec ?? 0}s`
                    : "없음"}
                </strong>
              </div>
              <div className="plan-item">
                <span>마지막 갱신</span>
                <strong>{formatDateTime(statusData.snapshot?.updatedAt ?? null)}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>진행률</h3>
            {statusData.progress ? (
              <>
                <div className="ops-progress">
                  <div className="ops-progress-bar" style={{ width: `${progressPercent}%` }} />
                </div>
                <p className="meta">
                  {statusData.progress.processed}/{statusData.progress.total} ({progressPercent.toFixed(1)}%) ·
                  실패 {statusData.progress.failedCount} · 재시도{" "}
                  {statusData.progress.retryStats.totalRetries}회
                </p>
                <p className="meta">
                  마지막 배치: {statusData.progress.lastBatch
                    ? `${statusData.progress.lastBatch.from}~${statusData.progress.lastBatch.to}`
                    : "-"}{" "}
                  · 업데이트 {formatDateTime(statusData.progress.updatedAt)}
                </p>
              </>
            ) : (
              <p className="meta">현재 진행 중인 배치가 없습니다.</p>
            )}
          </div>

          <div className="card">
            <h3>실패 종목 (최근)</h3>
            {statusData.progress?.failedItems && statusData.progress.failedItems.length > 0 ? (
              <div className="ops-fail-list">
                {statusData.progress.failedItems.map((item) => (
                  <div key={`${item.code}-${item.at}`} className="warning-row">
                    <strong>
                      {item.name}({item.code})
                    </strong>
                    <span>{item.market}</span>
                    <span>재시도 {item.retries}회</span>
                    <span>{item.reason}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="meta">현재 진행 데이터 기준 실패 종목이 없습니다.</p>
            )}
          </div>
        </>
      )}

      {historyData && (
        <>
          <div className="card">
            <h3>변동 히스토리</h3>
            <p className="meta">
              저장 백엔드: {historyData.backend.toUpperCase()} · 알림 상태 키 {historyData.alerts.count}개 · 업데이트{" "}
              {formatDateTime(historyData.alerts.updatedAt)}
            </p>
            {historyData.changes.length > 0 ? (
              <div className="ops-history-grid">
                {historyData.changes.map((change) => (
                  <article key={`change-${change.date}`} className="ops-history-item">
                    <h4>{change.date}</h4>
                    <p className="meta">기준: {formatDateTime(change.updatedAt)}</p>
                    <p className="meta">
                      신규 {change.changeSummary?.added.length ?? 0} · 상승{" "}
                      {change.changeSummary?.risers.length ?? 0} · 하락{" "}
                      {change.changeSummary?.fallers.length ?? 0}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="meta">저장된 변동 히스토리가 없습니다.</p>
            )}
          </div>

          <div className="card">
            <h3>실패 히스토리</h3>
            {historyData.failures.length > 0 ? (
              <div className="ops-history-grid">
                {historyData.failures.map((failure) => (
                  <article key={`failure-${failure.date}`} className="ops-history-item">
                    <h4>{failure.date}</h4>
                    <p className="meta">기준: {formatDateTime(failure.updatedAt)}</p>
                    <p className="meta">
                      실패 {failure.failedItems.length}개 · 재시도{" "}
                      {failure.retryStats?.totalRetries ?? 0}회
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="meta">저장된 실패 히스토리가 없습니다.</p>
            )}
          </div>

          <div className="card">
            <h3>최근 요약</h3>
            <p className="meta">
              최근 변동일: {latestChange?.date ?? "-"} · 최근 실패일: {latestFailure?.date ?? "-"}
            </p>
            {historyData.message && <p className="plan-note">{historyData.message}</p>}
          </div>
        </>
      )}
    </section>
  );
}
