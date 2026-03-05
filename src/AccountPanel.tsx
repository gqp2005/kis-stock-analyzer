import { useEffect, useMemo, useState } from "react";
import type { AccountResponse } from "./types";

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

  const loadAccount = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/account`);
      const body = await readJsonBody<AccountResponse | { error?: string; message?: string }>(
        response,
        "/api/account",
      );
      if (!response.ok) {
        throw new Error(pickApiError(body, `계좌 조회 실패 (HTTP ${response.status})`));
      }
      setAccount(body as AccountResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계좌 조회 실패");
      setAccount(null);
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
                      {item.name} ({item.code})
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

