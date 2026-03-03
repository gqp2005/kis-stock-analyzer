import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Overall,
  PatternState,
  VcpLeadershipLabel,
  VcpPivotLabel,
  VcpRiskGrade,
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
const formatSignedScore = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${Math.round(value)}점`;

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

const vcpStateLabel = (state: PatternState): string => {
  if (state === "CONFIRMED") return "확정";
  if (state === "POTENTIAL") return "잠재";
  return "없음";
};

const formatDepth = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(1)}%`;

const formatSignedPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatSignedRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

const formatDistancePercent = (value: number | null): string =>
  value == null ? "-" : `${(Math.abs(value) * 100).toFixed(2)}%`;

const formatRatioPercent = (value: number | null): string =>
  value == null ? "-" : `${(value * 100).toFixed(2)}%`;

const dryUpStrengthLabel = (value: "NONE" | "WEAK" | "STRONG"): string => {
  if (value === "STRONG") return "강함";
  if (value === "WEAK") return "보통";
  return "약함";
};

const leadershipLabel = (value: VcpLeadershipLabel): string => {
  if (value === "STRONG") return "STRONG";
  if (value === "OK") return "OK";
  return "WEAK";
};

const pivotLabel = (value: VcpPivotLabel): string => {
  if (value === "PIVOT_READY") return "PIVOT_READY";
  if (value === "PIVOT_NEAR_52W") return "PIVOT_NEAR_52W";
  if (value === "PIVOT_52W_BREAK") return "PIVOT_52W_BREAK";
  if (value === "BREAKOUT_CONFIRMED") return "CONFIRMED";
  return "NONE";
};

const riskGradeLabel = (value: VcpRiskGrade): string => {
  if (value === "OK") return "OK";
  if (value === "HIGH") return "HIGH";
  if (value === "BAD") return "BAD";
  return "N/A";
};

const rsStrengthLabel = (value: "STRONG" | "NEUTRAL" | "WEAK" | "N/A"): string => {
  if (value === "STRONG") return "강함";
  if (value === "NEUTRAL") return "보통";
  if (value === "WEAK") return "약함";
  return "N/A";
};

const atrShrinkPercent = (atr20: number | null, atr120: number | null): string => {
  if (atr20 == null || atr120 == null || atr120 <= 0) return "-";
  return `${((1 - atr20 / atr120) * 100).toFixed(1)}%`;
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
            <option value="VCP">VCP</option>
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
            {response.meta.lastRebuildStatus && (
              <p className="meta">
                리빌드 상태: {response.meta.lastRebuildStatus.inProgress ? "진행 중" : "대기"} ·{" "}
                {response.meta.lastRebuildStatus.processed}/{response.meta.lastRebuildStatus.total} · 실패{" "}
                {response.meta.lastRebuildStatus.failedCount}개 · 재시도{" "}
                {response.meta.lastRebuildStatus.totalRetries}회
              </p>
            )}
            {response.meta.rsSummary && (
              <p className="meta">
                RS 필터: 매칭 {response.meta.rsSummary.matched} · 약세 {response.meta.rsSummary.weak} ·
                데이터부족 {response.meta.rsSummary.missing}
              </p>
            )}
            {response.meta.tuningSummary && (
              <p className="meta">
                워크포워드 튜닝: 표본 {response.meta.tuningSummary.sampleCount} · 평균 임계값
                {response.meta.tuningSummary.avgThresholds
                  ? ` V/H/I/VCP=${response.meta.tuningSummary.avgThresholds.volume}/${response.meta.tuningSummary.avgThresholds.hs}/${response.meta.tuningSummary.avgThresholds.ihs}/${response.meta.tuningSummary.avgThresholds.vcp}`
                  : " 없음"}
              </p>
            )}
            {response.meta.validationSummary && (
              <>
                <p className="meta">
                  자동 검증 컷오프: A/V/H/I/VCP=
                  {response.meta.validationSummary.activeCutoffs.all}/
                  {response.meta.validationSummary.activeCutoffs.volume}/
                  {response.meta.validationSummary.activeCutoffs.hs}/
                  {response.meta.validationSummary.activeCutoffs.ihs}/
                  {response.meta.validationSummary.activeCutoffs.vcp}
                </p>
                <p className="meta">
                  주간 검증 {response.meta.validationSummary.lastWeeklyAt ?? "-"} · 월간 검증{" "}
                  {response.meta.validationSummary.lastMonthlyAt ?? "-"}
                </p>
              </>
            )}
            {response.meta.changeSummary && (
              <div className="screener-hit-row">
                {response.meta.changeSummary.added.slice(0, 3).map((item) => (
                  <small key={`added-${item.code}`} className="reason-tag positive">
                    신규 {item.name} #{item.currRank ?? "-"}
                  </small>
                ))}
                {response.meta.changeSummary.risers.slice(0, 3).map((item) => (
                  <small key={`rise-${item.code}`} className="reason-tag positive">
                    상승 {item.name} #{item.prevRank ?? "-"}→#{item.currRank ?? "-"}
                  </small>
                ))}
                {response.meta.changeSummary.fallers.slice(0, 2).map((item) => (
                  <small key={`fall-${item.code}`} className="reason-tag negative">
                    하락 {item.name} #{item.prevRank ?? "-"}→#{item.currRank ?? "-"}
                  </small>
                ))}
                {response.meta.changeSummary.removed.slice(0, 2).map((item) => (
                  <small key={`removed-${item.code}`} className="reason-tag negative">
                    이탈 {item.name} #{item.prevRank ?? "-"}
                  </small>
                ))}
                {response.meta.changeSummary.scoreRisers.slice(0, 2).map((item) => (
                  <small key={`score-up-${item.code}`} className="reason-tag positive">
                    점수↑ {item.name} {formatSignedScore(item.scoreDelta)}
                  </small>
                ))}
                {response.meta.changeSummary.scoreFallers.slice(0, 2).map((item) => (
                  <small key={`score-down-${item.code}`} className="reason-tag negative">
                    점수↓ {item.name} {formatSignedScore(item.scoreDelta)}
                  </small>
                ))}
              </div>
            )}
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
              <article
                key={`${item.market}-${item.code}`}
                className={strategy === "VCP" ? "screener-card vcp-card" : "screener-card"}
              >
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
                    {strategy === "VCP" ? (
                      <>
                        <span className="confidence neutral">VCPScore {item.hits.vcp.score}</span>
                        <span className={item.hits.vcp.pivot.label === "BREAKOUT_CONFIRMED" ? "badge good" : "badge neutral"}>
                          {pivotLabel(item.hits.vcp.pivot.label)}
                        </span>
                        <span className={item.hits.vcp.state === "CONFIRMED" ? "badge good" : "badge neutral"}>
                          {vcpStateLabel(item.hits.vcp.state)}
                        </span>
                        {item.hits.vcp.score >= 92 && <span className="reason-tag positive">Strong</span>}
                      </>
                    ) : (
                      <>
                        <span className={overallClass(item.overallLabel)}>{overallLabel(item.overallLabel)}</span>
                        <span className="confidence neutral">점수 {item.scoreTotal}</span>
                        <span className="confidence good">신뢰도 {item.confidence}</span>
                      </>
                    )}
                  </div>
                </div>
                {strategy === "VCP" ? (
                  <>
                    <div className="screener-levels vcp-kpi-row">
                      <small>
                        R-zone {formatPrice(item.hits.vcp.resistance.zoneLow)} ~{" "}
                        {formatPrice(item.hits.vcp.resistance.zoneHigh)}
                      </small>
                      <small>R까지 거리 {formatDistancePercent(item.hits.vcp.distanceToR)}</small>
                      <small>
                        컨트랙션 {item.hits.vcp.contractions.length}회 ·{" "}
                        {item.hits.vcp.contractions.length > 0
                          ? item.hits.vcp.contractions
                              .map((contraction) => formatDepth(contraction.depth))
                              .join(" → ")
                          : "-"}
                      </small>
                    </div>
                    <div className="screener-levels vcp-kpi-row">
                      <small>
                        DryUp {dryUpStrengthLabel(item.hits.vcp.volume.dryUpStrength)} (
                        {item.hits.vcp.volume.volRatioAvg10 != null
                          ? `${item.hits.vcp.volume.volRatioAvg10.toFixed(2)}배`
                          : "-"}
                        )
                      </small>
                      <small>
                        Leadership {leadershipLabel(item.hits.vcp.leadership.label)} (
                        {formatSignedPercent(
                          item.hits.vcp.leadership.ret63 != null
                            ? item.hits.vcp.leadership.ret63 * 100
                            : null,
                        )}
                        )
                      </small>
                      <small>
                        Risk {riskGradeLabel(item.hits.vcp.risk.riskGrade)} (
                        {formatRatioPercent(item.hits.vcp.risk.riskPct)} / 무효화{" "}
                        {formatPrice(item.hits.vcp.risk.invalidLow)})
                      </small>
                    </div>
                    <div className="screener-levels vcp-kpi-row">
                      <small>
                        RS {rsStrengthLabel(item.rs.label)} ({formatSignedRatioPercent(item.rs.ret63Diff)})
                      </small>
                      <small>
                        튜닝 품질 {item.tuning?.quality != null ? `${item.tuning.quality}점` : "-"}
                      </small>
                      <small>
                        VCP 컷 {item.tuning?.thresholds.vcp ?? "-"}점
                      </small>
                    </div>
                    <div className="vcp-strip">
                      <small
                        className={item.hits.vcp.pivot.nearHigh52 ? "reason-tag positive" : "reason-tag neutral"}
                        title="close >= 0.90 * high52w"
                      >
                        52W 근접 {item.hits.vcp.pivot.nearHigh52 ? "Y" : "N"}
                      </small>
                      <small
                        className={item.hits.vcp.pivot.pivotReady ? "reason-tag positive" : "reason-tag neutral"}
                        title="distance<=3% && dryUp STRONG && depth_last<=8%"
                      >
                        Pivot Ready {item.hits.vcp.pivot.pivotReady ? "Y" : "N"}
                      </small>
                      <small className="reason-tag neutral" title={item.hits.vcp.breakout.rule}>
                        돌파 조건 {item.hits.vcp.breakout.confirmed ? "충족" : "대기"}
                      </small>
                      <small className="reason-tag neutral">
                        ATR 축소 {atrShrinkPercent(item.hits.vcp.atr.atrPct20, item.hits.vcp.atr.atrPct120)}
                      </small>
                    </div>
                    <ul className="vcp-reasons">
                      {item.hits.vcp.reasons.slice(0, 3).map((reason) => (
                        <li key={`${item.code}-vcp-${reason}`}>✅ {reason}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <div className="screener-hit-row">
                      <span className="reason-tag positive">
                        거래량 {formatScore(item.hits.volume.score)} / {item.hits.volume.confidence}
                      </span>
                      <span
                        className={
                          item.rs.label === "STRONG"
                            ? "reason-tag positive"
                            : item.rs.label === "WEAK"
                              ? "reason-tag negative"
                              : "reason-tag neutral"
                        }
                      >
                        RS {rsStrengthLabel(item.rs.label)} ({formatSignedRatioPercent(item.rs.ret63Diff)})
                      </span>
                      <span className={item.hits.vcp.detected ? "reason-tag positive" : "reason-tag neutral"}>
                        VCP {vcpStateLabel(item.hits.vcp.state)} / {item.hits.vcp.score}
                      </span>
                      <span className="reason-tag negative">
                        H&S {hsStateLabel(item.hits.hs.state)} / {item.hits.hs.score}
                      </span>
                      <span className="reason-tag positive">
                        IHS {hsStateLabel(item.hits.ihs.state)} / {item.hits.ihs.score}
                      </span>
                    </div>
                    <div className="screener-hit-row">
                      <small className="reason-tag neutral">
                        튜닝 임계값 V/H/I/VCP{" "}
                        {item.tuning
                          ? `${item.tuning.thresholds.volume}/${item.tuning.thresholds.hs}/${item.tuning.thresholds.ihs}/${item.tuning.thresholds.vcp}`
                          : "-"}
                      </small>
                      <small className="reason-tag neutral">
                        튜닝 품질 {item.tuning?.quality != null ? `${item.tuning.quality}점` : "-"}
                      </small>
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
                  </>
                )}
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
