import { useEffect, useMemo, useState } from "react";
import type {
  AutotradeMarketFilter,
  TradeCandidateCard,
  TradeCandidatesResponse,
  TradeOrderResponse,
} from "./types";

interface AutoTradePanelProps {
  apiBase: string;
}

const compactText = (raw: string, max = 240): string => raw.replace(/\s+/g, " ").trim().slice(0, max);

const readJsonBody = async <T,>(response: Response, endpoint: string): Promise<T> => {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const preview = compactText(raw);
    throw new Error(`API가 JSON이 아닌 응답을 반환했습니다 (${response.status}) [${endpoint}] ${preview || "empty body"}`);
  }
};

const pickApiError = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== "object") return fallback;
  const row = payload as Record<string, unknown>;
  return (typeof row.error === "string" && row.error) || (typeof row.message === "string" && row.message) || fallback;
};

const formatPrice = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatPct = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(2)}%`;

const stateLabel = (state: string): string => {
  if (state === "REBOUND_CONFIRMED") return "반등 확인";
  if (state === "PULLBACK_READY") return "눌림 준비";
  if (state === "WASHOUT_CANDIDATE") return "설거지 후보";
  if (state === "ANCHOR_DETECTED") return "앵커 탐지";
  return "조건 부족";
};

const orderStateLabel = (state: string): string => {
  const labelMap: Record<string, string> = {
    IDLE: "대기",
    PRECHECK: "사전점검",
    ORDER_SUBMITTING: "주문전송",
    ORDER_ACCEPTED: "접수완료",
    WORKING: "체결대기",
    PARTIALLY_FILLED: "부분체결",
    FILLED: "전량체결",
    POSITION_OPEN: "포지션오픈",
    EXIT_SUBMITTING: "청산전송",
    CLOSED: "종료",
    CANCEL_REQUESTED: "취소요청",
    CANCELED: "취소완료",
    ORDER_REJECTED: "주문거부",
  };
  return labelMap[state] ?? state;
};

const stateBadgeClass = (state: string): string => {
  if (state === "REBOUND_CONFIRMED") return "strategy-status confirmed";
  if (state === "PULLBACK_READY") return "strategy-status ready";
  if (state === "WASHOUT_CANDIDATE") return "strategy-status candidate";
  return "strategy-status";
};

const orderBadgeClass = (state: string): string => {
  if (state === "POSITION_OPEN" || state === "FILLED") return "overall-badge good";
  if (state === "PARTIALLY_FILLED" || state === "WORKING" || state === "ORDER_ACCEPTED") return "overall-badge neutral";
  if (state === "ORDER_REJECTED" || state === "CANCELED") return "overall-badge caution";
  return "overall-badge neutral";
};

const candidateKey = (item: TradeCandidateCard): string => `${item.code}-${item.entry}-${item.stop}-${item.qty}`;

export default function AutoTradePanel(props: AutoTradePanelProps) {
  const { apiBase } = props;

  const [market, setMarket] = useState<AutotradeMarketFilter>("ALL");
  const [universe, setUniverse] = useState<number>(200);
  const [adminToken, setAdminToken] = useState("");
  const [autoExecute, setAutoExecute] = useState(false);
  const [useHashKey, setUseHashKey] = useState(false);
  const [retryOnce, setRetryOnce] = useState(false);

  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [runningCode, setRunningCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [payload, setPayload] = useState<TradeCandidatesResponse | null>(null);
  const [orderResult, setOrderResult] = useState<TradeOrderResponse | null>(null);

  const fetchCandidates = async () => {
    setLoadingCandidates(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("market", market);
      params.set("universe", String(universe));
      const response = await fetch(`${apiBase}/api/trade/candidates?${params.toString()}`);
      const body = await readJsonBody<TradeCandidatesResponse | { error?: string; message?: string }>(
        response,
        "/api/trade/candidates",
      );
      if (!response.ok) {
        throw new Error(pickApiError(body, `후보 조회 실패 (HTTP ${response.status})`));
      }
      setPayload(body as TradeCandidatesResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보 조회 실패");
      setPayload(null);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const runOrder = async (candidate: TradeCandidateCard) => {
    setRunningCode(candidate.code);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/trade/order`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(adminToken.trim() ? { "x-admin-token": adminToken.trim() } : {}),
        },
        body: JSON.stringify({
          code: candidate.code,
          market,
          universe,
          autoExecute,
          useHashKey,
          retryOnce,
          dryRun: false,
          adminToken: adminToken.trim() || undefined,
          clientOrderId: `${candidate.code}-${Date.now()}`,
        }),
      });
      const body = await readJsonBody<TradeOrderResponse | { error?: string; message?: string }>(
        response,
        "/api/trade/order",
      );
      if (!response.ok) {
        throw new Error(pickApiError(body, `주문 실행 실패 (HTTP ${response.status})`));
      }
      setOrderResult(body as TradeOrderResponse);
      await fetchCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "주문 실행 실패");
    } finally {
      setRunningCode(null);
    }
  };

  useEffect(() => {
    void fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidateCount = payload?.candidates.length ?? 0;
  const blocked = payload?.summary.blockedByDailyLoss ?? false;

  const orderedCandidate = useMemo(() => payload?.candidates ?? [], [payload?.candidates]);

  return (
    <section className="account-panel">
      <div className="card">
        <div className="strategy-head">
          <div>
            <h3>오늘의 자동매매 후보 카드</h3>
            <p className="meta">거래대금 눌림 반등 전략 · 50만원 계좌 리스크 규칙 적용</p>
          </div>
        </div>

        <div className="screener-filters" style={{ marginTop: "10px" }}>
          <label>
            시장
            <select value={market} onChange={(e) => setMarket(e.target.value as AutotradeMarketFilter)}>
              <option value="ALL">전체</option>
              <option value="KOSPI">KOSPI</option>
              <option value="KOSDAQ">KOSDAQ</option>
            </select>
          </label>
          <label>
            유니버스
            <select value={universe} onChange={(e) => setUniverse(Number(e.target.value))}>
              <option value={200}>200개</option>
              <option value={300}>300개</option>
              <option value={500}>500개</option>
            </select>
          </label>
          <label>
            관리자 토큰
            <input
              type="password"
              placeholder="주문 실행 시 필요"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
          </label>
        </div>

        <div className="screener-filters" style={{ marginTop: "10px" }}>
          <label className="checkbox-label">
            <input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
            자동 주문 실행 모드
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={useHashKey} onChange={(e) => setUseHashKey(e.target.checked)} />
            hashkey 헤더 사용
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={retryOnce} onChange={(e) => setRetryOnce(e.target.checked)} />
            취소 후 1회 재주문
          </label>
        </div>

        <div className="strategy-head" style={{ marginTop: "10px" }}>
          <button type="button" onClick={() => void fetchCandidates()} disabled={loadingCandidates}>
            {loadingCandidates ? "조회 중..." : "후보 새로고침"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {payload && (
          <>
            <div className="account-summary-grid" style={{ marginTop: "10px" }}>
              <div className="plan-item">
                <span>후보 수</span>
                <strong>{candidateCount}개</strong>
              </div>
              <div className="plan-item">
                <span>일일 손실</span>
                <strong>{formatPrice(payload.summary.dailyLossWon)}</strong>
              </div>
              <div className="plan-item">
                <span>동시 보유</span>
                <strong>{payload.summary.openPositionCount}개</strong>
              </div>
              <div className="plan-item">
                <span>상태</span>
                <strong>{blocked ? "신규 진입 차단" : "진입 가능"}</strong>
              </div>
              <div className="plan-item">
                <span>스냅샷 기준일</span>
                <strong>{payload.summary.sourceDate ?? "-"}</strong>
              </div>
              <div className="plan-item">
                <span>기준 시각</span>
                <strong>{payload.meta.asOf}</strong>
              </div>
            </div>

            {payload.warnings.length > 0 && (
              <div className="warning-box" style={{ marginTop: "10px" }}>
                {payload.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>후보 리스트</h3>
        {!payload && !loadingCandidates && <p className="meta">후보 데이터가 없습니다.</p>}
        {payload && orderedCandidate.length === 0 && <p className="meta">오늘 조건을 충족한 후보가 없습니다.</p>}
        {payload && orderedCandidate.length > 0 && (
          <div className="auto-candidate-grid">
            {orderedCandidate.map((candidate) => (
              <article key={candidateKey(candidate)} className="auto-candidate-card">
                <div className="auto-candidate-head">
                  <div>
                    <h4>
                      {candidate.name} ({candidate.code})
                    </h4>
                    <small>{candidate.market}</small>
                  </div>
                  <span className={stateBadgeClass(candidate.state)}>{stateLabel(candidate.state)}</span>
                </div>

                <div className="auto-candidate-kpis">
                  <div className="plan-item">
                    <span>Entry</span>
                    <strong>{formatPrice(candidate.entry)}</strong>
                  </div>
                  <div className="plan-item">
                    <span>Stop</span>
                    <strong>{formatPrice(candidate.stop)}</strong>
                  </div>
                  <div className="plan-item">
                    <span>TP1 / TP2</span>
                    <strong>
                      {formatPrice(candidate.tp1)} / {formatPrice(candidate.tp2)}
                    </strong>
                  </div>
                  <div className="plan-item">
                    <span>수량</span>
                    <strong>{candidate.qty}주</strong>
                  </div>
                  <div className="plan-item">
                    <span>최대손실</span>
                    <strong>{formatPrice(candidate.maxLossWon)}</strong>
                  </div>
                  <div className="plan-item">
                    <span>리스크%</span>
                    <strong>{formatPct(candidate.riskPct)}</strong>
                  </div>
                </div>

                <div className="auto-candidate-body">
                  <div>
                    <p className="meta">근거</p>
                    <ul className="warning-list">
                      {candidate.reasons.slice(0, 3).map((reason) => (
                        <li key={`${candidate.code}-reason-${reason}`}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="meta">주의</p>
                    <ul className="warning-list">
                      {(candidate.warnings.length > 0 ? candidate.warnings : ["특이 경고 없음"]).slice(0, 2).map((warning) => (
                        <li key={`${candidate.code}-warn-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="strategy-head" style={{ marginTop: "10px" }}>
                  <button
                    type="button"
                    disabled={runningCode === candidate.code || blocked}
                    onClick={() => void runOrder(candidate)}
                  >
                    {runningCode === candidate.code ? "주문 처리 중..." : autoExecute ? "자동 주문 실행" : "반자동 주문 승인"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>KIS 주문 상태 머신</h3>
        {!orderResult && <p className="meta">후보 카드에서 주문을 실행하면 상태 전이가 표시됩니다.</p>}
        {orderResult && (
          <>
            <div className="strategy-head">
              <div>
                <p className="meta">
                  {orderResult.result.name} ({orderResult.result.code}) · 주문ID {orderResult.result.clientOrderId}
                </p>
              </div>
              <span className={orderBadgeClass(orderResult.result.state)}>{orderStateLabel(orderResult.result.state)}</span>
            </div>
            <div className="account-summary-grid" style={{ marginTop: "10px" }}>
              <div className="plan-item">
                <span>주문번호</span>
                <strong>{orderResult.result.orderNo ?? "-"}</strong>
              </div>
              <div className="plan-item">
                <span>주문/체결</span>
                <strong>
                  {orderResult.result.orderedQty} / {orderResult.result.filledQty}
                </strong>
              </div>
              <div className="plan-item">
                <span>미체결</span>
                <strong>{orderResult.result.remainingQty}</strong>
              </div>
              <div className="plan-item">
                <span>평균체결가</span>
                <strong>{formatPrice(orderResult.result.avgFillPrice)}</strong>
              </div>
              <div className="plan-item">
                <span>포지션 오픈</span>
                <strong>{orderResult.result.positionOpened ? "예" : "아니오"}</strong>
              </div>
              <div className="plan-item">
                <span>요약</span>
                <strong>{orderResult.result.message}</strong>
              </div>
            </div>

            <div className="warning-box" style={{ marginTop: "10px" }}>
              {orderResult.warnings.map((warning) => (
                <span key={`order-warning-${warning}`}>{warning}</span>
              ))}
              {orderResult.warnings.length === 0 && <span>추가 경고 없음</span>}
            </div>

            <div className="backtest-table-wrap" style={{ marginTop: "10px" }}>
              <table className="backtest-table">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>상태</th>
                    <th>사유</th>
                    <th>요약</th>
                  </tr>
                </thead>
                <tbody>
                  {orderResult.result.transitions.map((transition, index) => (
                    <tr key={`${transition.at}-${transition.state}-${index}`}>
                      <td>{transition.at}</td>
                      <td>{orderStateLabel(transition.state)}</td>
                      <td>{transition.reason}</td>
                      <td>{transition.summary ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
