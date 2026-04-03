import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import FavoriteButton from "../FavoriteButton";
import { useFavorites } from "../favorites";
import WangStrategyChart from "./WangStrategyChart";
import type {
  WangStrategyChecklistItem,
  WangStrategyExecutionState,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyPhase,
  WangStrategyResponse,
  WangStrategyRiskNote,
  WangStrategyTimeframeSummary,
} from "./types";

interface WangStrategyPanelProps {
  apiBase: string;
  initialQuery?: string;
}

interface StockLookup {
  code: string;
  name: string;
  market: string;
}

interface SearchResponse {
  query: string;
  count: number;
  items: StockLookup[];
}

const PHASE_LABEL: Record<WangStrategyPhase, string> = {
  LIFE_VOLUME: "인생거래량",
  BASE_VOLUME: "기준거래량",
  RISING_VOLUME: "상승거래량",
  ELASTIC_VOLUME: "탄력거래량",
  MIN_VOLUME: "최소거래량",
  REACCUMULATION: "재축적",
  NONE: "미확정",
};

const INTERPRETATION_LABEL: Record<WangStrategyInterpretation, string> = {
  WATCH: "관찰",
  ACCUMULATE: "적립",
  CAUTION: "경계",
  OVERHEAT: "과열",
};

const EXECUTION_LABEL: Record<WangStrategyExecutionState, string> = {
  WAIT_WEEKLY_STRUCTURE: "주봉 구조 대기",
  WAIT_PULLBACK: "당김 대기",
  READY_ON_ZONE: "zone 진입 관찰",
  READY_ON_RETEST: "재접근 적립 후보",
  AVOID_BREAKDOWN: "zone 이탈 경계",
  AVOID_OVERHEAT: "과열 추격 금지",
};

const TF_LABEL = {
  month: "월봉",
  week: "주봉",
  day: "일봉",
} as const;

const formatPrice = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}원`;

const formatVolume = (value: number | null): string =>
  value == null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}`;

const interpretationClassName = (value: WangStrategyInterpretation): string => {
  if (value === "ACCUMULATE") return "badge good";
  if (value === "WATCH") return "badge neutral";
  return "badge caution";
};

const phaseClassName = (value: WangStrategyPhase): string => {
  if (value === "REACCUMULATION" || value === "MIN_VOLUME") return "confidence good";
  if (value === "NONE") return "confidence caution";
  return "confidence neutral";
};

const riskClassName = (note: WangStrategyRiskNote): string => {
  if (note.severity === "danger") return "wang-risk-item danger";
  if (note.severity === "warning") return "wang-risk-item warning";
  return "wang-risk-item info";
};

const checklistTone = (item: WangStrategyChecklistItem): string =>
  item.ok ? "reason-tag positive" : "reason-tag negative";

const executionClassName = (value: WangStrategyExecutionState): string => {
  if (value === "READY_ON_ZONE" || value === "READY_ON_RETEST") return "badge good";
  if (value === "AVOID_BREAKDOWN" || value === "AVOID_OVERHEAT") return "badge caution";
  return "badge neutral";
};

const regimeLabel = (value: WangStrategyTimeframeSummary["regime"]): string => {
  if (value === "UP") return "상승";
  if (value === "DOWN") return "하락";
  return "횡보";
};

const pickDefaultMarker = (markers: WangStrategyMarker[]): WangStrategyMarker | null => {
  if (markers.length === 0) return null;
  return (
    markers.find((marker) => marker.type === "VOL_RETEST") ??
    markers.find((marker) => marker.type === "VOL_MIN") ??
    markers[markers.length - 1]
  );
};

export default function WangStrategyPanel(props: WangStrategyPanelProps) {
  const { apiBase, initialQuery } = props;
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(240);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<WangStrategyResponse | null>(null);
  const [suggestions, setSuggestions] = useState<StockLookup[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedWeekMarker, setSelectedWeekMarker] = useState<WangStrategyMarker | null>(null);
  const [selectedDayMarker, setSelectedDayMarker] = useState<WangStrategyMarker | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  const fetchStrategy = async (value: string, nextCount: number) => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiBase}/api/wang-strategy?query=${encodeURIComponent(value)}&tf=multi&count=${nextCount}`;
      const result = await fetch(url);
      const data = (await result.json()) as WangStrategyResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "왕장군 전략 조회에 실패했습니다.");
      const payload = data as WangStrategyResponse;
      setResponse(payload);
      setQuery(payload.meta.symbol);
      setSelectedWeekMarker(pickDefaultMarker(payload.markers.week));
      setSelectedDayMarker(pickDefaultMarker(payload.markers.day));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "알 수 없는 오류");
      setResponse(null);
      setSelectedWeekMarker(null);
      setSelectedDayMarker(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setShowSuggestions(false);
    void fetchStrategy(normalized, count);
  };

  const refreshCurrent = () => {
    const normalized = response?.meta.symbol ?? query.trim();
    if (!normalized) return;
    void fetchStrategy(normalized, count);
  };

  const onSelectSuggestion = (stock: StockLookup) => {
    setShowSuggestions(false);
    void fetchStrategy(stock.code, count);
  };

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(event.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const normalized = initialQuery?.trim() ?? "";
    if (!normalized) return;
    setQuery((current) => (current === normalized ? current : normalized));
    setShowSuggestions(false);
    void fetchStrategy(normalized, count);
  }, [initialQuery]);

  useEffect(() => {
    if (!showSuggestions) return;
    const normalized = query.trim();
    if (!normalized) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const searchUrl = `${apiBase}/api/search?q=${encodeURIComponent(normalized)}&limit=8`;
        const result = await fetch(searchUrl, { signal: controller.signal });
        if (!result.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await result.json()) as SearchResponse;
        setSuggestions(data.items ?? []);
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setSuggestions([]);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiBase, query, showSuggestions]);

  const structureChecklist = useMemo(
    () => (response?.checklist ?? []).filter((item) => item.group === "structure"),
    [response],
  );
  const executionChecklist = useMemo(
    () => (response?.checklist ?? []).filter((item) => item.group === "execution"),
    [response],
  );
  const riskChecklist = useMemo(
    () => (response?.checklist ?? []).filter((item) => item.group === "risk"),
    [response],
  );
  const activeZone = response?.tradeZones.find((item) => item.active) ?? response?.tradeZones[0] ?? null;
  const timeframeSummaries = useMemo(
    () => [response?.multiTimeframe.month, response?.multiTimeframe.week, response?.multiTimeframe.day].filter(Boolean) as WangStrategyTimeframeSummary[],
    [response],
  );

  return (
    <section className="wang-panel">
      <div className="card wang-header-card">
        <div className="wang-header-copy">
          <div>
            <p className="eyebrow">Wang Strategy Workspace</p>
            <h2>왕장군 전략</h2>
            <p className="meta">
              주봉 메인 + 일봉 상세 구조로 거래량 강의 1~11편 관점의 phase, zone, 재접근, 20일선 위치를 설명형 UI로 보여줍니다.
            </p>
          </div>
          <div className="wang-header-actions">
            <button
              type="button"
              className="preset-btn"
              onClick={refreshCurrent}
              disabled={loading || (!response && !query.trim())}
            >
              {loading ? "조회 중..." : "재조회"}
            </button>
            {response && (
              <FavoriteButton
                active={isFavorite(response.meta.symbol)}
                onClick={() => toggleFavorite({ code: response.meta.symbol, name: response.meta.name })}
              />
            )}
          </div>
        </div>

        <form className="search wang-search-form" onSubmit={onSubmit}>
          <div className="search-input-wrap" ref={searchWrapRef}>
            <input
              ref={queryInputRef}
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowSuggestions(true);
              }}
              placeholder="005930 또는 삼성전자"
              aria-label="왕장군 전략 종목 검색"
            />
            {query.trim().length > 0 && (
              <button
                type="button"
                className="search-clear-btn"
                aria-label="검색어 지우기"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setSuggestions([]);
                  setShowSuggestions(false);
                  queryInputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="suggestions" role="listbox" aria-label="종목 추천 목록">
                {suggestions.map((stock) => (
                  <li key={`${stock.market}-${stock.code}`}>
                    <button
                      type="button"
                      className="suggestion-item"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelectSuggestion(stock)}
                    >
                      <span className="suggestion-main">
                        <strong>{stock.code}</strong>
                        <em>{stock.name}</em>
                      </span>
                      <small>{stock.market}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <select value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label="왕장군 전략 조회 개수">
            <option value={180}>최근 180봉</option>
            <option value={240}>최근 240봉</option>
            <option value={320}>최근 320봉</option>
          </select>
          <button type="submit" disabled={loading}>
            {loading ? "불러오는 중..." : "전략 해석"}
          </button>
        </form>

        <div className="wang-favorite-row">
          <span>즐겨찾기</span>
          {favorites.length === 0 ? (
            <small className="meta">아직 등록한 즐겨찾기가 없습니다.</small>
          ) : (
            favorites.slice(0, 8).map((item) => (
              <button
                key={item.code}
                type="button"
                className={response?.meta.symbol === item.code ? "preset-btn active wang-chip-btn" : "preset-btn wang-chip-btn"}
                onClick={() => void fetchStrategy(item.code, count)}
              >
                {item.name || item.code}
              </button>
            ))
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!response && !loading && !error && (
        <div className="card wang-empty-state">
          <h3>1차 구현 범위</h3>
          <div className="wang-empty-grid">
            <div className="plan-item">
              <span>1단계</span>
              <strong>독립 메뉴</strong>
              <small className="plan-note">종목 분석과 분리된 왕장군 전략 탭</small>
            </div>
            <div className="plan-item">
              <span>2단계</span>
              <strong>주봉/일봉 차트</strong>
              <small className="plan-note">주봉 메인 + 일봉 상세 2단 구조</small>
            </div>
            <div className="plan-item">
              <span>3단계</span>
              <strong>설명 패널</strong>
              <small className="plan-note">phase, checklist, zone, risk, MTF 요약</small>
            </div>
          </div>
        </div>
      )}

      {response && (
        <>
          <div className="wang-summary-grid">
            <article className="card wang-hero-card">
              <div className="wang-hero-head">
                <div>
                  <h3>
                    {response.meta.name} ({response.meta.symbol})
                  </h3>
                  <p className="meta">
                    {response.meta.market} · {response.meta.asOf} · 기준거래량 {formatVolume(response.meta.referenceVolume)}
                  </p>
                </div>
                <div className="final-badges">
                  <span className={phaseClassName(response.currentPhase)}>{PHASE_LABEL[response.currentPhase]}</span>
                  <span className={interpretationClassName(response.summary.interpretation)}>
                    {INTERPRETATION_LABEL[response.summary.interpretation]}
                  </span>
                </div>
              </div>
              <p className="wang-summary-headline">{response.summary.headline}</p>
              <p className="meta">{response.summary.posture}</p>
              <div className="wang-kpi-grid">
                <div className="plan-item">
                  <span>currentPhase</span>
                  <strong>{PHASE_LABEL[response.currentPhase]}</strong>
                </div>
                <div className="plan-item">
                  <span>confidence</span>
                  <strong>{response.confidence}</strong>
                </div>
                <div className="plan-item">
                  <span>현재 해석</span>
                  <strong>{INTERPRETATION_LABEL[response.summary.interpretation]}</strong>
                </div>
                <div className="plan-item">
                  <span>실행 요약</span>
                  <strong>{response.movingAverageContext.verdict}</strong>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="wang-card-head">
                <h3>주봉 phase 판단</h3>
                <small className={phaseClassName(response.weeklyPhaseContext.phase)}>
                  {PHASE_LABEL[response.weeklyPhaseContext.phase]}
                </small>
              </div>
              <p className="meta">{response.weeklyPhaseContext.headline}</p>
              <p className="plan-note">{response.weeklyPhaseContext.stageSummary}</p>
              <div className="wang-kpi-grid wang-kpi-grid-compact">
                <div className="plan-item">
                  <span>score</span>
                  <strong>{response.weeklyPhaseContext.score}</strong>
                </div>
                <div className="plan-item">
                  <span>base 반복</span>
                  <strong>{response.weeklyPhaseContext.baseRepeatCount}</strong>
                </div>
                <div className="plan-item">
                  <span>최대거래량</span>
                  <strong>{formatVolume(response.weeklyPhaseContext.maxVolume)}</strong>
                </div>
                <div className="plan-item">
                  <span>기준거래량</span>
                  <strong>{formatVolume(response.weeklyPhaseContext.referenceVolume)}</strong>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="wang-card-head">
                <h3>일봉 실행 판단</h3>
                <small className={executionClassName(response.dailyExecutionContext.state)}>
                  {EXECUTION_LABEL[response.dailyExecutionContext.state]}
                </small>
              </div>
              <p className="meta">{response.dailyExecutionContext.headline}</p>
              <p className="plan-note">{response.dailyExecutionContext.action}</p>
              <div className="wang-kpi-grid wang-kpi-grid-compact">
                <div className="plan-item">
                  <span>score</span>
                  <strong>{response.dailyExecutionContext.score}</strong>
                </div>
                <div className="plan-item">
                  <span>20일선 아래</span>
                  <strong>{response.dailyExecutionContext.belowMa20 ? "예" : "아니오"}</strong>
                </div>
                <div className="plan-item">
                  <span>재접근</span>
                  <strong>{response.dailyExecutionContext.retestDetected ? "확인" : "대기"}</strong>
                </div>
                <div className="plan-item">
                  <span>재기준거래량</span>
                  <strong>{response.dailyExecutionContext.dailyRebaseCount}</strong>
                </div>
              </div>
            </article>
          </div>

          <article className="card">
            <h3>전략 요약</h3>
              <ul className="insight-list">
                {response.reasons.map((reason) => (
                  <li key={reason}>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {response.warnings.length > 0 && (
                <div className="warning-box wang-warning-box">
                  {response.warnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              )}
          </article>

          <div className="wang-chart-stack">
            <article className="card wang-chart-card">
              <div className="wang-card-head">
                <div>
                  <h3>주봉 메인 차트</h3>
                  <p className="meta">캔들 + 거래량 + 인생/기준/상승/탄력/최소거래량 마커 + zone 박스</p>
                </div>
                <small className="confidence neutral">메인 해석 축</small>
              </div>
              <WangStrategyChart
                candles={response.candles.week}
                chartOverlays={response.chartOverlays.week}
                markers={response.markers.week}
                height={390}
                onSelectMarker={setSelectedWeekMarker}
              />
              {selectedWeekMarker ? (
                <div className="wang-selected-card">
                  <div className="wang-card-head">
                    <strong>{selectedWeekMarker.label}</strong>
                    <small>{selectedWeekMarker.t}</small>
                  </div>
                  <div className="wang-selected-grid">
                    <div className="plan-item">
                      <span>가격</span>
                      <strong>{formatPrice(selectedWeekMarker.price)}</strong>
                    </div>
                    <div className="plan-item">
                      <span>거래량</span>
                      <strong>{formatVolume(selectedWeekMarker.volume)}</strong>
                    </div>
                    <div className="plan-item">
                      <span>강도</span>
                      <strong>{selectedWeekMarker.strength}</strong>
                    </div>
                  </div>
                  <p className="plan-note">{selectedWeekMarker.desc}</p>
                </div>
              ) : (
                <p className="plan-note">주봉 마커를 클릭하면 해당 단계의 의미를 바로 읽을 수 있습니다.</p>
              )}
            </article>

            <article className="card wang-chart-card">
              <div className="wang-card-head">
                <div>
                  <h3>일봉 상세 차트</h3>
                  <p className="meta">주봉 zone 투영 + 일봉 재기준거래량 + MA20 + ref.level + 선택 캔들 하이라이트</p>
                </div>
                <small className={response.movingAverageContext.belowMa20 ? "confidence good" : "confidence neutral"}>
                  {response.movingAverageContext.verdict}
                </small>
              </div>
              <WangStrategyChart
                candles={response.candles.day}
                chartOverlays={response.chartOverlays.day}
                markers={response.markers.day}
                height={350}
                onSelectMarker={setSelectedDayMarker}
              />
              {selectedDayMarker ? (
                <div className="wang-selected-card">
                  <div className="wang-card-head">
                    <strong>{selectedDayMarker.label}</strong>
                    <small>{selectedDayMarker.t}</small>
                  </div>
                  <div className="wang-selected-grid">
                    <div className="plan-item">
                      <span>가격</span>
                      <strong>{formatPrice(selectedDayMarker.price)}</strong>
                    </div>
                    <div className="plan-item">
                      <span>거래량</span>
                      <strong>{formatVolume(selectedDayMarker.volume)}</strong>
                    </div>
                    <div className="plan-item">
                      <span>강도</span>
                      <strong>{selectedDayMarker.strength}</strong>
                    </div>
                  </div>
                  <p className="plan-note">{selectedDayMarker.desc}</p>
                </div>
              ) : (
                <p className="plan-note">{response.movingAverageContext.guidance}</p>
              )}
            </article>
          </div>

          <div className="wang-main-grid">
            <article className="card">
              <h3>단계별 해석</h3>
              <div className="wang-phase-stack">
                {response.phases.map((phase) => (
                  <div key={phase.phase} className="wang-phase-item">
                    <div className="wang-phase-head">
                      <strong>{phase.title}</strong>
                      <small
                        className={
                          phase.status === "active"
                            ? "badge good"
                            : phase.status === "completed"
                              ? "badge neutral"
                              : "badge caution"
                        }
                      >
                        {phase.status === "active" ? "현재" : phase.status === "completed" ? "통과" : "대기"}
                      </small>
                    </div>
                    <p className="meta">{phase.summary}</p>
                    {phase.occurrences.length > 0 ? (
                      <ul className="insight-list">
                        {phase.occurrences.map((item) => (
                          <li key={`${phase.phase}-${item.time}`}>
                            <span>
                              {item.time} · {formatPrice(item.price)} · 거래량 {formatVolume(item.volume)}
                            </span>
                            <small>{item.note}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="plan-note">아직 해당 단계가 명확하게 관찰되지 않았습니다.</p>
                    )}
                    <p className="insight-opinion">
                      <small className="reason-tag neutral">다음 조건</small>
                      {phase.nextCondition}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article className="card">
              <h3>체크리스트</h3>
              <div className="wang-checklist-columns">
                <div>
                  <h4>구조 판정</h4>
                  <ul className="insight-list">
                    {structureChecklist.map((item) => (
                      <li key={item.id}>
                        <span>
                          <small className={checklistTone(item)}>{item.ok ? "충족" : "미충족"}</small> {item.label}
                        </span>
                        <small>{item.detail}</small>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>실행 판정</h4>
                  <ul className="insight-list">
                    {executionChecklist.map((item) => (
                      <li key={item.id}>
                        <span>
                          <small className={checklistTone(item)}>{item.ok ? "충족" : "미충족"}</small> {item.label}
                        </span>
                        <small>{item.detail}</small>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>리스크 판정</h4>
                  <ul className="insight-list">
                    {riskChecklist.map((item) => (
                      <li key={item.id}>
                        <span>
                          <small className={checklistTone(item)}>{item.ok ? "충족" : "미충족"}</small> {item.label}
                        </span>
                        <small>{item.detail}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          </div>

          <div className="wang-secondary-grid">
            <article className="card">
              <h3>실전 적립 구간</h3>
              {activeZone ? (
                <>
                  <div className="wang-zone-kpis">
                    <div className="plan-item">
                      <span>zone</span>
                      <strong>
                        {formatPrice(activeZone.low)} ~ {formatPrice(activeZone.high)}
                      </strong>
                    </div>
                    <div className="plan-item">
                      <span>source</span>
                      <strong>{activeZone.sourceTf === "week" ? "주봉" : "일봉"}</strong>
                    </div>
                    <div className="plan-item">
                      <span>20일선 이하</span>
                      <strong>{response.movingAverageContext.belowMa20 ? "예" : "아니오"}</strong>
                    </div>
                    <div className="plan-item">
                      <span>무효 가격</span>
                      <strong>{formatPrice(activeZone.invalidationPrice)}</strong>
                    </div>
                  </div>
                  <p className="plan-note">{activeZone.scenario}</p>
                  <p className="insight-opinion">
                    <small className={executionClassName(response.dailyExecutionContext.state)}>
                      {EXECUTION_LABEL[response.dailyExecutionContext.state]}
                    </small>
                    {response.dailyExecutionContext.action}
                  </p>
                  <ul className="insight-list">
                    {activeZone.splitPlan.map((item) => (
                      <li key={item.label}>
                        <span>
                          {item.label} · {item.weightPct}% · {formatPrice(item.price)}
                        </span>
                        <small>{item.note}</small>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="meta">아직 최소거래량 이후 zone이 명확하게 형성되지 않았습니다.</p>
              )}
            </article>

            <article className="card">
              <h3>리스크 / 주의</h3>
              <div className="wang-risk-stack">
                {response.riskNotes.map((note) => (
                  <div key={note.id} className={riskClassName(note)}>
                    <strong>{note.title}</strong>
                    <p>{note.detail}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="wang-tertiary-grid">
            <article className="card">
              <h3>멀티 타임프레임 요약</h3>
              <div className="wang-timeframe-grid">
                {timeframeSummaries.map((item) => (
                  <div key={item.tf} className="wang-timeframe-item">
                    <div className="wang-card-head">
                      <strong>{TF_LABEL[item.tf]}</strong>
                      <small className="reason-tag neutral">
                        {regimeLabel(item.regime)} / {item.structure}
                      </small>
                    </div>
                    <p className="meta">{item.summary}</p>
                    <p className="plan-note">
                      phase bias: {PHASE_LABEL[item.phaseBias]} · score {item.score}
                    </p>
                    <ul className="insight-list">
                      {item.reasons.map((reason) => (
                        <li key={`${item.tf}-${reason}`}>
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>

            <article className="card">
              <h3>훈련 노트</h3>
              <div className="wang-training-stack">
                {response.trainingNotes.map((note) => (
                  <div key={note.id} className="wang-training-item">
                    <div className="wang-card-head">
                      <strong>{note.title}</strong>
                      <small
                        className={
                          note.emphasis === "core"
                            ? "reason-tag positive"
                            : note.emphasis === "warning"
                              ? "reason-tag negative"
                              : "reason-tag neutral"
                        }
                      >
                        {note.emphasis === "core" ? "핵심" : note.emphasis === "warning" ? "주의" : "실전"}
                      </small>
                    </div>
                    <p>{note.text}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
