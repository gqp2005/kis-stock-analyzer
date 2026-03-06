import { useEffect, useMemo, useState } from "react";
import FavoriteButton from "./FavoriteButton";
import { useFavorites } from "./favorites";
import type { AccountDiagnosticsResponse, AccountResponse } from "./types";

interface AccountPanelProps {
  apiBase: string;
}

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

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatSignedPrice = (value: number | null): string => {
  if (value == null) return "-";
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("ko-KR");
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${abs}원`;
};

const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatQty = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}주`;

export default function AccountPanel(props: AccountPanelProps) {
  const { apiBase } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<AccountDiagnosticsResponse | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const { isFavorite, toggleFavorite } = useFavorites();

  const loadAccount = async () => {
    setLoading(true);
    setError("");
    setDiagnosticError("");
    setDiagnostics(null);
    try {
      const [accountResponse, diagnosticResponse] = await Promise.all([
        fetch(`${apiBase}/api/account`),
        fetch(`${apiBase}/api/account-diagnostics`),
      ]);
      const accountBody = await readJsonBody<AccountResponse | { error?: string; message?: string }>(
        accountResponse,
        "/api/account",
      );
      if (!accountResponse.ok) {
        throw new Error(pickApiError(accountBody, `계좌 조회 실패 (HTTP ${accountResponse.status})`));
      }
      setAccount(accountBody as AccountResponse);
      const diagnosticBody = await readJsonBody<AccountDiagnosticsResponse | { error?: string; message?: string }>(
        diagnosticResponse,
        "/api/account-diagnostics",
      );
      if (!diagnosticResponse.ok) {
        setDiagnosticError(pickApiError(diagnosticBody, `계좌 진단 실패 (HTTP ${diagnosticResponse.status})`));
      } else {
        setDiagnostics(diagnosticBody as AccountDiagnosticsResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "계좌 조회 실패");
      setAccount(null);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalHoldingValue = useMemo(
    () =>
      (account?.holdings ?? []).reduce((sum, item) => sum + (item.evaluationAmount ?? 0), 0),
    [account?.holdings],
  );

  return (
    <section className="account-panel">
      <div className="card">
        <div className="strategy-head">
          <div>
            <h3>내 계좌</h3>
            <p className="meta">
              계좌 {account?.meta.account ?? "-"} · 기준 시각 {account?.meta.asOf ?? "-"} · 출처 KIS
            </p>
          </div>
          <button type="button" onClick={() => void loadAccount()} disabled={loading}>
            {loading ? "조회 중..." : "다시 조회"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {account && (
          <>
            <div className="account-summary-grid">
              <div className="plan-item">
                <span>총 자산</span>
                <strong>{formatPrice(account.summary.totalAssetAmount)}</strong>
              </div>
              <div className="plan-item">
                <span>총 평가금액</span>
                <strong>{formatPrice(account.summary.totalEvaluationAmount)}</strong>
              </div>
              <div className="plan-item">
                <span>총 매입금액</span>
                <strong>{formatPrice(account.summary.totalPurchaseAmount)}</strong>
              </div>
              <div className="plan-item">
                <span>평가손익</span>
                <strong>{formatSignedPrice(account.summary.totalProfitAmount)}</strong>
              </div>
              <div className="plan-item">
                <span>손익률</span>
                <strong>{formatPercent(account.summary.totalProfitRate)}</strong>
              </div>
              <div className="plan-item">
                <span>예수금</span>
                <strong>{formatPrice(account.summary.cashAmount)}</strong>
              </div>
            </div>
            <p className="plan-note">
              보유 종목 {account.holdings.length}개 · 보유 평가 합계 {formatPrice(totalHoldingValue)}
            </p>
            {account.warnings.length > 0 && (
              <div className="warning-box">
                {account.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>보유종목 진단</h3>
        {diagnosticError && <p className="error">{diagnosticError}</p>}
        {!loading && diagnostics && (
          <>
            <div className="account-summary-grid">
              <div className="plan-item">
                <span>보유 종목</span>
                <strong>{diagnostics.summary.holdingCount}개</strong>
              </div>
              <div className="plan-item">
                <span>보유 유지</span>
                <strong>{diagnostics.summary.keepCount}개</strong>
              </div>
              <div className="plan-item">
                <span>손절 점검</span>
                <strong>{diagnostics.summary.riskCount}개</strong>
              </div>
              <div className="plan-item">
                <span>스냅샷 미포함</span>
                <strong>{diagnostics.summary.uncoveredCount}개</strong>
              </div>
            </div>
            {diagnostics.warnings.length > 0 && (
              <div className="warning-box">
                {diagnostics.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
            <div className="strategy-mini-grid" style={{ marginTop: "12px" }}>
              {diagnostics.items.map((item) => (
                <article key={`diag-${item.code}`} className="strategy-mini-item">
                  <div className="strategy-mini-head">
                    <div>
                      <strong>
                        {item.name} ({item.code})
                      </strong>
                      <p className="meta">
                        현재가 {formatPrice(item.currentPrice)} · 수익률 {formatPercent(item.profitRate)} · 비중 {formatPercent(item.weightPercent)}
                      </p>
                    </div>
                    <div className="final-badges">
                      <FavoriteButton
                        small
                        active={isFavorite(item.code)}
                        onClick={() => toggleFavorite({ code: item.code, name: item.name })}
                      />
                      <small className={`reason-tag ${item.tone === "positive" ? "positive" : item.tone === "negative" ? "negative" : "neutral"}`}>
                        {item.action}
                      </small>
                    </div>
                  </div>
                  <p>{item.riskNote}</p>
                  <p>지지 {formatPrice(item.support)} · 저항 {formatPrice(item.resistance)} · 신뢰도 {item.confidence ?? "-"}</p>
                  <p>전략: {item.strategies.length > 0 ? item.strategies.join(", ") : "현재 강한 전략 감지 없음"}</p>
                  <ul>
                    {item.reasons.map((reason) => (
                      <li key={`${item.code}-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </>
        )}
        {!loading && !diagnostics && !diagnosticError && <p className="meta">진단 데이터가 없습니다.</p>}
      </div>

      <div className="card">
        <h3>보유 종목</h3>
        {loading && <p className="meta">계좌 정보를 불러오는 중입니다.</p>}
        {!loading && !account && !error && <p className="meta">계좌 데이터가 없습니다.</p>}
        {!loading && account && account.holdings.length === 0 && (
          <p className="meta">현재 보유 종목이 없습니다.</p>
        )}
        {!loading && account && account.holdings.length > 0 && (
          <div className="backtest-table-wrap">
            <table className="backtest-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>보유수량</th>
                  <th>주문가능</th>
                  <th>평균단가</th>
                  <th>현재가</th>
                  <th>평가금액</th>
                  <th>손익</th>
                  <th>손익률</th>
                  <th>비중</th>
                </tr>
              </thead>
              <tbody>
                {account.holdings.map((item) => (
                  <tr key={`holding-${item.code}`}>
                    <td>
                      <span className="holding-name-cell">
                        {item.name} ({item.code})
                        <FavoriteButton
                          small
                          active={isFavorite(item.code)}
                          onClick={() => toggleFavorite({ code: item.code, name: item.name })}
                        />
                      </span>
                    </td>
                    <td>{formatQty(item.quantity)}</td>
                    <td>{formatQty(item.orderableQuantity)}</td>
                    <td>{formatPrice(item.purchaseAvgPrice)}</td>
                    <td>{formatPrice(item.currentPrice)}</td>
                    <td>{formatPrice(item.evaluationAmount)}</td>
                    <td>{formatSignedPrice(item.profitAmount)}</td>
                    <td>{formatPercent(item.profitRate)}</td>
                    <td>{formatPercent(item.weightPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
