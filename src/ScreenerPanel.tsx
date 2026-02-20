import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Overall,
  PatternState,
  ScreenerItem,
  ScreenerMarketFilter,
  ScreenerResponse,
  ScreenerStrategyFilter,
  VolumePatternType,
} from "./types";

interface ScreenerPanelProps {
  apiBase: string;
  onSelectSymbol: (code: string) => void;
}

type SortKey = "SCORE" | "CONFIDENCE" | "BACKTEST";

const overallLabel = (overall: Overall): string => {
  if (overall === "GOOD") return "양호";
  if (overall === "NEUTRAL") return "중립";
  return "주의";
};

const overallClass = (overall: Overall): string => {
  if (overall === "GOOD") return "badge good";
  if (overall === "NEUTRAL") return "badge neutral";
  return "badge caution";
};

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatScore = (value: number): string => `${Math.round(value)}점`;
const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;

const formatFactor = (value: number | null): string =>
  value == null ? "-" : value.toFixed(2);

const patternTypeLabel = (type: VolumePatternType): string => {
  if (type === "BreakoutConfirmed") return "돌파확인";
  if (type === "Upthrust") return "불트랩";
  if (type === "PullbackReaccumulation") return "눌림재개";
  if (type === "ClimaxUp") return "상승과열";
  if (type === "CapitulationAbsorption") return "투매흡수";
  return "약한반등";
};

const hsStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

const sortItems = (items: ScreenerItem[], sortKey: SortKey): ScreenerItem[] => {
  const cloned = [...items];
  if (sortKey === "CONFIDENCE") {
    return cloned.sort((a, b) => b.confidence - a.confidence || b.scoreTotal - a.scoreTotal);
  }
  if (sortKey === "BACKTEST") {
    return cloned.sort((a, b) => {
      const ar = a.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      const br = b.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      if (br !== ar) return br - ar;
      return b.scoreTotal - a.scoreTotal;
    });
  }
  return cloned.sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);
};

export default function ScreenerPanel(props: ScreenerPanelProps) {
  const { apiBase, onSelectSymbol } = props;
  const [market, setMarket] = useState<ScreenerMarketFilter>("ALL");
  const [strategy, setStrategy] = useState<ScreenerStrategyFilter>("ALL");
  const [count, setCount] = useState(30);
  const [universe, setUniverse] = useState(500);
  const [sortKey, setSortKey] = useState<SortKey>("SCORE");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ScreenerResponse | null>(null);

  const fetchScreener = async () => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiBase}/api/screener?market=${market}&strategy=${strategy}&count=${count}&universe=${universe}`;
      const result = await fetch(url);
      const data = (await result.json()) as ScreenerResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "스크리너 조회 실패");
      setResponse(data as ScreenerResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchScreener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void fetchScreener();
  };

  const rankedItems = useMemo(
    () => sortItems(response?.items ?? [], sortKey),
    [response?.items, sortKey],
  );
  const warningItems = useMemo(
    () => sortItems(response?.warningItems ?? [], "SCORE"),
    [response?.warningItems],
  );

  return (
    <section className="screener">
      <form className="screener-controls" onSubmit={onSubmit}>
        <label>
          시장
          <select value={market} onChange={(e) => setMarket(e.target.value as ScreenerMarketFilter)}>
            <option value="ALL">전체</option>
            <option value="KOSPI">KOSPI</option>
            <option value="KOSDAQ">KOSDAQ</option>
          </select>
        </label>
        <label>
          전략
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as ScreenerStrategyFilter)}>
            <option value="ALL">ALL</option>
            <option value="VOLUME">VOLUME</option>
            <option value="IHS">IHS</option>
            <option value="HS">HS</option>
          </select>
        </label>
        <label>
          정렬
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="SCORE">점수순</option>
            <option value="CONFIDENCE">신뢰도순</option>
            <option value="BACKTEST">백테스트순</option>
          </select>
        </label>
        <label>
          노출 개수
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            <option value={20}>20개</option>
            <option value={30}>30개</option>
            <option value={50}>50개</option>
          </select>
        </label>
        <label>
          유니버스
          <select value={universe} onChange={(e) => setUniverse(Number(e.target.value))} disabled>
            <option value={500}>500개</option>
          </select>
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "조회 중..." : "스크리너 조회"}
        </button>
      </form>

      <p className="screener-note">
        본 결과는 후보/시그널 참고용입니다. 매수 추천이나 수익 보장을 의미하지 않습니다.
      </p>

      {error && <p className="error">{error}</p>}

      {response && (
        <>
          <div className="card">
            <h3>요약</h3>
            <p className="meta">
              {response.meta.universeLabel} · 스캔 {response.meta.scanned}개 · 후보 {response.meta.candidates}개 · 기준 시각{" "}
              {response.meta.asOf}
            </p>
            <p className="meta">
              마지막 갱신: {response.meta.lastUpdatedAt ?? "없음"}
              {response.meta.rebuildRequired ? " · rebuild 필요" : " · 최신"}
            </p>
            {response.warnings.length > 0 && (
              <ul>
                {response.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="screener-grid">
            {rankedItems.map((item) => (
              <article key={`${item.market}-${item.code}`} className="screener-card">
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
                    <span className={overallClass(item.overallLabel)}>{overallLabel(item.overallLabel)}</span>
                    <span className="confidence neutral">점수 {item.scoreTotal}</span>
                    <span className="confidence good">신뢰도 {item.confidence}</span>
                  </div>
                </div>
                <div className="screener-hit-row">
                  <span className="reason-tag positive">
                    거래량 {formatScore(item.hits.volume.score)} / {item.hits.volume.confidence}
                  </span>
                  <span className="reason-tag negative">
                    H&S {hsStateLabel(item.hits.hs.state)} / {item.hits.hs.score}
                  </span>
                  <span className="reason-tag positive">
                    IHS {hsStateLabel(item.hits.ihs.state)} / {item.hits.ihs.score}
                  </span>
                </div>
                <div className="screener-hit-row">
                  {item.hits.volume.patterns.length > 0 ? (
                    item.hits.volume.patterns.slice(0, 3).map((type) => (
                      <small key={type} className="reason-tag positive">
                        {patternTypeLabel(type)}
                      </small>
                    ))
                  ) : (
                    <small className="volume-empty">거래량 패턴 없음</small>
                  )}
                </div>
                <ul>
                  {item.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="screener-levels">
                  <small>지지 {formatPrice(item.levels.support)}</small>
                  <small>저항 {formatPrice(item.levels.resistance)}</small>
                  <small>넥라인 {formatPrice(item.levels.neckline)}</small>
                </div>
                {item.backtestSummary && (
                  <div className="screener-backtest">
                    <small>거래 {item.backtestSummary.trades}</small>
                    <small>승률 {formatPercent(item.backtestSummary.winRate)}</small>
                    <small>평균손익 {formatPercent(item.backtestSummary.avgReturn)}</small>
                    <small>PF {formatFactor(item.backtestSummary.PF)}</small>
                    <small>MDD {formatPercent(item.backtestSummary.MDD)}</small>
                  </div>
                )}
                <button type="button" onClick={() => onSelectSymbol(item.code)}>
                  상세 분석으로 이동
                </button>
              </article>
            ))}
          </div>

          {warningItems.length > 0 && (
            <div className="card">
              <h3>리스크 경고 (H&S 확정)</h3>
              <div className="screener-warning-list">
                {warningItems.map((item) => (
                  <div key={`warn-${item.code}`} className="warning-row">
                    <strong>
                      {item.name} ({item.code})
                    </strong>
                    <span>H&S {item.hits.hs.score}점</span>
                    <span>넥라인 {formatPrice(item.hits.hs.neckline)}</span>
                    <span>목표 {formatPrice(item.hits.hs.target)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
