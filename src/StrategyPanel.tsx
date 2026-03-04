import { useEffect, useMemo, useState } from "react";
import type { PatternState, ScreenerItem, ScreenerResponse, WashoutPullbackState } from "./types";

interface StrategyPanelProps {
  apiBase: string;
  onSelectSymbol: (code: string) => void;
}

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatMultiple = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}x`;

const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;

const washoutStateLabel = (state: WashoutPullbackState): string => {
  if (state === "REBOUND_CONFIRMED") return "반등 확인";
  if (state === "PULLBACK_READY") return "눌림 준비";
  if (state === "WASHOUT_CANDIDATE") return "설거지 후보";
  if (state === "ANCHOR_DETECTED") return "앵커 탐지";
  return "없음";
};

const washoutStatePriority = (state: WashoutPullbackState): number => {
  if (state === "REBOUND_CONFIRMED") return 4;
  if (state === "PULLBACK_READY") return 3;
  if (state === "WASHOUT_CANDIDATE") return 2;
  if (state === "ANCHOR_DETECTED") return 1;
  return 0;
};

const cupHandleStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "후보";
  return "없음";
};

const cupHandleStatePriority = (state: PatternState): number => {
  if (state === "CONFIRMED") return 2;
  if (state === "POTENTIAL") return 1;
  return 0;
};

const washoutStateClass = (state: WashoutPullbackState): string => {
  if (state === "REBOUND_CONFIRMED") return "badge good";
  if (state === "PULLBACK_READY" || state === "WASHOUT_CANDIDATE") return "badge neutral";
  if (state === "ANCHOR_DETECTED") return "badge caution";
  return "badge neutral";
};

const cupHandleStateClass = (state: PatternState): string => {
  if (state === "CONFIRMED") return "badge good";
  if (state === "POTENTIAL") return "badge neutral";
  return "badge caution";
};

const isCupHandleCandidate = (item: ScreenerItem): boolean =>
  item.hits.cupHandle.detected || item.hits.cupHandle.state !== "NONE";

const isWashoutCandidate = (item: ScreenerItem): boolean =>
  item.hits.washoutPullback.detected && item.hits.washoutPullback.state !== "NONE";

export default function StrategyPanel(props: StrategyPanelProps) {
  const { apiBase, onSelectSymbol } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ScreenerResponse | null>(null);

  const fetchStrategyCards = async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        market: "ALL",
        strategy: "ALL",
        count: "100",
        universe: "500",
      });
      const result = await fetch(`${apiBase}/api/screener?${query.toString()}`);
      const data = (await result.json()) as ScreenerResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "전략 목록 조회 실패");
      setResponse(data as ScreenerResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStrategyCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceItems = response?.items ?? [];
  const washoutItems = useMemo(
    () =>
      sourceItems
        .filter(isWashoutCandidate)
        .sort((a, b) => {
          const stateDiff =
            washoutStatePriority(b.hits.washoutPullback.state) - washoutStatePriority(a.hits.washoutPullback.state);
          if (stateDiff !== 0) return stateDiff;
          if (b.hits.washoutPullback.score !== a.hits.washoutPullback.score) {
            return b.hits.washoutPullback.score - a.hits.washoutPullback.score;
          }
          return b.hits.washoutPullback.confidence - a.hits.washoutPullback.confidence;
        })
        .slice(0, 30),
    [sourceItems],
  );
  const cupHandleItems = useMemo(
    () =>
      sourceItems
        .filter(isCupHandleCandidate)
        .sort((a, b) => {
          const stateDiff = cupHandleStatePriority(b.hits.cupHandle.state) - cupHandleStatePriority(a.hits.cupHandle.state);
          if (stateDiff !== 0) return stateDiff;
          if (b.hits.cupHandle.score !== a.hits.cupHandle.score) return b.hits.cupHandle.score - a.hits.cupHandle.score;
          return b.confidence - a.confidence;
        })
        .slice(0, 30),
    [sourceItems],
  );

  return (
    <section className="strategy-panel">
      <div className="card">
        <div className="strategy-head">
          <div>
            <h3>전략 카드 모음</h3>
            <p className="meta">
              거래대금 상위 500 유니버스 기준으로 설거지+눌림목/컵앤핸들 후보를 분리해 보여줍니다.
            </p>
          </div>
          <button type="button" onClick={() => void fetchStrategyCards()} disabled={loading}>
            {loading ? "갱신 중..." : "다시 조회"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {response && (
          <div className="strategy-summary-grid">
            <div className="plan-item">
              <span>기준 시각</span>
              <strong>{response.meta.asOf}</strong>
            </div>
            <div className="plan-item">
              <span>마지막 갱신</span>
              <strong>{response.meta.lastUpdatedAt ?? "없음"}</strong>
            </div>
            <div className="plan-item">
              <span>설거지+눌림목 후보</span>
              <strong>{washoutItems.length}개</strong>
            </div>
            <div className="plan-item">
              <span>컵앤핸들 후보</span>
              <strong>{cupHandleItems.length}개</strong>
            </div>
          </div>
        )}
      </div>

      <div className="strategy-sections">
        <article className="card strategy-section">
          <h3>거래대금 설거지 + 눌림목 종목</h3>
          {washoutItems.length === 0 ? (
            <p className="meta">현재 조건에서 감지된 종목이 없습니다.</p>
          ) : (
            <div className="screener-grid">
              {washoutItems.map((item) => (
                <div key={`washout-${item.code}`} className="screener-card washout-card">
                  <div className="screener-card-head">
                    <div>
                      <h3>
                        {item.name} ({item.code})
                      </h3>
                      <p className="meta">
                        {item.market} · {item.lastDate} · 종가 {formatPrice(item.lastClose)}
                      </p>
                    </div>
                    <div className="final-badges">
                      <span className={washoutStateClass(item.hits.washoutPullback.state)}>
                        {washoutStateLabel(item.hits.washoutPullback.state)}
                      </span>
                      <span className="confidence neutral">점수 {item.hits.washoutPullback.score}</span>
                      <span className="confidence good">신뢰도 {item.hits.washoutPullback.confidence}</span>
                    </div>
                  </div>
                  <p className="strategy-line">
                    Anchor {formatMultiple(item.hits.washoutPullback.anchorTurnoverRatio)} · Reentry{" "}
                    {formatMultiple(item.hits.washoutPullback.reentryTurnoverRatio)} · Pullback{" "}
                    {formatPrice(item.hits.washoutPullback.pullbackZone.low)} ~{" "}
                    {formatPrice(item.hits.washoutPullback.pullbackZone.high)}
                  </p>
                  <p className="strategy-line">
                    현재가 {item.hits.washoutPullback.position === "IN_ZONE"
                      ? "존 내부"
                      : item.hits.washoutPullback.position === "ABOVE_ZONE"
                        ? "존 위"
                        : item.hits.washoutPullback.position === "BELOW_ZONE"
                          ? "존 아래"
                          : "N/A"}{" "}
                    · Invalid {formatPrice(item.hits.washoutPullback.invalidPrice)} · Risk{" "}
                    {formatPercent(
                      item.hits.washoutPullback.riskPct != null ? item.hits.washoutPullback.riskPct * 100 : null,
                    )}
                  </p>
                  <ul className="strategy-reasons">
                    {(item.hits.washoutPullback.reasons.length > 0
                      ? item.hits.washoutPullback.reasons
                      : item.reasons
                    )
                      .slice(0, 2)
                      .map((reason) => (
                        <li key={`${item.code}-${reason}`}>{reason}</li>
                      ))}
                  </ul>
                  <button type="button" onClick={() => onSelectSymbol(item.code)}>
                    상세 분석으로 이동
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card strategy-section">
          <h3>컵앤핸들 종목</h3>
          {cupHandleItems.length === 0 ? (
            <p className="meta">현재 조건에서 감지된 종목이 없습니다.</p>
          ) : (
            <div className="screener-grid">
              {cupHandleItems.map((item) => (
                <div key={`cup-${item.code}`} className="screener-card">
                  <div className="screener-card-head">
                    <div>
                      <h3>
                        {item.name} ({item.code})
                      </h3>
                      <p className="meta">
                        {item.market} · {item.lastDate} · 종가 {formatPrice(item.lastClose)}
                      </p>
                    </div>
                    <div className="final-badges">
                      <span className={cupHandleStateClass(item.hits.cupHandle.state)}>
                        {cupHandleStateLabel(item.hits.cupHandle.state)}
                      </span>
                      <span className="confidence neutral">점수 {item.hits.cupHandle.score}</span>
                      <span className="confidence good">신뢰도 {item.confidence}</span>
                    </div>
                  </div>
                  <p className="strategy-line">
                    넥라인 {formatPrice(item.hits.cupHandle.neckline)} · 컵 깊이{" "}
                    {formatPercent(item.hits.cupHandle.cupDepthPct)} · 핸들 깊이{" "}
                    {formatPercent(item.hits.cupHandle.handleDepthPct)}
                  </p>
                  <p className="strategy-line">
                    컵 폭 {item.hits.cupHandle.cupWidthBars != null ? `${item.hits.cupHandle.cupWidthBars}봉` : "-"} ·
                    핸들 기간 {item.hits.cupHandle.handleBars != null ? `${item.hits.cupHandle.handleBars}봉` : "-"} ·
                    돌파 {item.hits.cupHandle.breakout ? "확인" : "대기"}
                  </p>
                  <ul className="strategy-reasons">
                    {(item.hits.cupHandle.reasons.length > 0 ? item.hits.cupHandle.reasons : item.reasons)
                      .slice(0, 2)
                      .map((reason) => (
                        <li key={`${item.code}-${reason}`}>{reason}</li>
                      ))}
                  </ul>
                  <button type="button" onClick={() => onSelectSymbol(item.code)}>
                    상세 분석으로 이동
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
