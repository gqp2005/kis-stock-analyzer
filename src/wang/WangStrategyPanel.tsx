import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import FavoriteButton from "../FavoriteButton";
import { useFavorites } from "../favorites";
import { formatPrice, formatSignedPercent as formatPercent } from "../format";
import WangStrategyChart from "./WangStrategyChart";
import type {
  WangStrategyChecklistItem,
  WangStrategyExecutionState,
  WangStrategyInterpretation,
  WangStrategyMarker,
  WangStrategyMarkerType,
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
  WAIT_MIN_REGION: "최소거래량 구간 대기",
  WAIT_PULLBACK: "눌림 대기",
  READY_ON_DISCOUNT: "20일선 할인",
  READY_ON_ZONE: "zone 진입 관찰",
  READY_ON_RETEST: "zone 재접근 적립",
  READY_ON_PSYCHOLOGY_FLIP: "심리 전환 적립",
  AVOID_BREAKDOWN: "zone 이탈 경계",
  AVOID_EVENT_RISK: "외부 이슈 경계",
  AVOID_OVERHEAT: "과열 추격 금지",
};

const TF_LABEL = { month: "월봉", week: "주봉", day: "일봉" } as const;

const MARKER_GUIDE: Record<WangStrategyMarkerType, { why: string; action: string }> = {
  VOL_LIFE: { why: "큰 자금이 처음 강하게 들어온 anchor입니다.", action: "이후 기준거래량과 기간 조정을 기다립니다." },
  VOL_BASE: { why: "인생거래량 이후 시장이 다시 기준을 만드는 거래량입니다.", action: "반복 횟수와 시초값 방향을 같이 읽습니다." },
  VOL_RISE: { why: "기준거래량 이후 가격을 위로 미는 힘입니다.", action: "탄력거래량으로 이어지는지 확인합니다." },
  VOL_ELASTIC: { why: "적은 힘으로도 가격이 가벼워지는 단계입니다.", action: "이후 최소거래량 구간 진입을 기다립니다." },
  VOL_MIN_REGION: { why: "최소거래량 점이 나오기 전 먼저 형성되는 압축 구간입니다.", action: "3~6개월 시간 조정이 충분한지 함께 봅니다." },
  VOL_MIN: { why: "최소거래량 구간 안에서 실제로 가장 마른 지점입니다.", action: "이 캔들의 고가/저가로 zone을 만들고 재접근을 기다립니다." },
  VOL_RETEST: { why: "주봉 zone을 일봉이 다시 확인하는 자리입니다.", action: "20일선 이하와 재기준거래량이 함께 나오면 우선순위가 높아집니다." },
  VOL_ZONE: { why: "최소거래량 캔들 기준의 실행 범위입니다.", action: "한 번에 진입보다 분할 적립이 우선입니다." },
  VOL_BREAKOUT: { why: "2차 거래량 확인 자리입니다.", action: "돌파 강도가 충분한지 따로 확인합니다." },
  VOL_HALF: { why: "최대 거래량 절반 수준 재출현 경고입니다.", action: "추격보다 경계를 먼저 봅니다." },
  EVENT_SHOCK: { why: "급락 원인을 검증해야 하는 외부 이슈 자리입니다.", action: "직접 영향, 매출 영향, 업황 비전을 나눠 봅니다." },
  PSYCHOLOGY_FLIP: { why: "급락 뒤 심리가 바뀌기 시작한 자리입니다.", action: "관찰에서 적립으로 넘어가는 근거가 됩니다." },
  STRONG_PULLBACK: { why: "강한 종목의 저거래량 눌림일 수 있습니다.", action: "무너지는 약세인지 건강한 조정인지 구분합니다." },
};

const formatVolume = (value: number | null): string =>
  value == null ? "-" : Math.round(value).toLocaleString("ko-KR");

const interpretationClassName = (value: WangStrategyInterpretation): string =>
  value === "ACCUMULATE" ? "badge good" : value === "WATCH" ? "badge neutral" : "badge caution";

const phaseClassName = (value: WangStrategyPhase): string =>
  value === "REACCUMULATION" || value === "MIN_VOLUME"
    ? "confidence good"
    : value === "NONE"
      ? "confidence caution"
      : "confidence neutral";

const executionClassName = (value: WangStrategyExecutionState): string =>
  value.startsWith("READY_ON")
    ? "badge good"
    : value.startsWith("AVOID")
      ? "badge caution"
      : "badge neutral";

const riskClassName = (note: WangStrategyRiskNote): string =>
  note.severity === "danger"
    ? "wang-risk-item danger"
    : note.severity === "warning"
      ? "wang-risk-item warning"
      : "wang-risk-item info";

const pickDefaultMarker = (markers: WangStrategyMarker[]): WangStrategyMarker | null =>
  markers.find((marker) => marker.type === "VOL_RETEST") ??
  markers.find((marker) => marker.type === "VOL_MIN") ??
  markers.find((marker) => marker.type === "VOL_MIN_REGION") ??
  markers[markers.length - 1] ??
  null;

const groupChecklist = (items: WangStrategyChecklistItem[], group: WangStrategyChecklistItem["group"]) =>
  items.filter((item) => item.group === group);

const monthsFromBars = (bars: number | null | undefined): string =>
  bars == null ? "-" : `${bars}주 / 약 ${(bars / 4.33).toFixed(1)}개월`;

export default function WangStrategyPanel({ apiBase, initialQuery }: WangStrategyPanelProps) {
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
      const result = await fetch(`${apiBase}/api/wang-strategy?query=${encodeURIComponent(value)}&tf=multi&count=${nextCount}`);
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

  useEffect(() => {
    const normalized = initialQuery?.trim() ?? "";
    if (normalized) void fetchStrategy(normalized, count);
  }, [initialQuery]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!showSuggestions || !query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(query.trim())}&limit=8`, {
          signal: controller.signal,
        });
        if (!result.ok) return setSuggestions([]);
        const data = (await result.json()) as SearchResponse;
        setSuggestions(data.items ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiBase, query, showSuggestions]);

  const structureChecklist = useMemo(() => groupChecklist(response?.checklist ?? [], "structure"), [response]);
  const executionChecklist = useMemo(() => groupChecklist(response?.checklist ?? [], "execution"), [response]);
  const riskChecklist = useMemo(() => groupChecklist(response?.checklist ?? [], "risk"), [response]);
  const activeZone = response?.tradeZones.find((item) => item.active) ?? response?.tradeZones[0] ?? null;
  const timeframeSummaries = useMemo(
    () => [response?.multiTimeframe.month, response?.multiTimeframe.week, response?.multiTimeframe.day].filter(Boolean) as WangStrategyTimeframeSummary[],
    [response],
  );

  const explainers = useMemo(() => {
    if (!response) return [];
    return [
      {
        title: "최소거래량 구간과 점",
        body: response.minVolumeRegionContext
          ? `현재 최소거래량 구간은 ${response.minVolumeRegionContext.startTime ?? "-"}부터 ${response.minVolumeRegionContext.endTime ?? "-"}까지로 읽고 있습니다. 구간은 압축의 시간이고, 실제 실행 기준은 그 안의 최소거래량 점과 이후 zone 재접근입니다.`
          : "최소거래량은 점 하나만이 아니라 먼저 거래량이 마르는 구간부터 봐야 합니다.",
      },
      {
        title: "기준거래량 시초값 방향성",
        body: "기준거래량은 반복될 수 있습니다. 반복 횟수만 보지 말고 첫 기준거래량의 시초값 방향이 이후 흐름의 기준이 되는지도 함께 읽어야 합니다.",
      },
      {
        title: "3~6개월 기간 조정",
        body: `인생거래량 이후 현재까지 ${monthsFromBars(response.weeklyPhaseContext.cooldownBarsFromLife)}가 지나 있습니다. 왕장군 관점에서는 가격 조정만큼 시간 조정도 중요합니다.`,
      },
      {
        title: "굴 파기 / 물량 테스트",
        body: "최소거래량 이후 한 번 더 저점을 찌르는 굴 파기와 빠른 회복형 물량 테스트가 붙으면 바닥 신뢰도가 높아집니다.",
      },
      response.eventImpactContext && {
        title: "외부 이슈 3단 검증",
        body: response.eventImpactContext.actionableRisk
          ? "이번 급락은 실질 영향이 확인되어 리스크 관리가 우선입니다."
          : "이번 급락은 외부 충격 성격이 강하고 실질 영향은 약해 과매도 기회 후보로 볼 수 있습니다.",
      },
      response.psychologyFlipContext?.confirmed && {
        title: "심리가 바뀌는 자리",
        body: `${response.psychologyFlipContext.time ?? "-"} 부근에서 심리 전환 신호가 확인됐습니다. 이런 자리는 관찰에서 적립으로 넘어가는 근거가 됩니다.`,
      },
      response.strongStockContext?.pullbackDetected && {
        title: "강한 종목의 저거래량 급락",
        body: response.strongStockContext.lowVolume
          ? "강한 종목이 저거래량으로 눌리면 무너지는 약세보다 건강한 조정일 가능성이 큽니다."
          : "강한 종목 여부는 보이지만 저거래량 눌림으로 보기에는 추가 확인이 필요합니다.",
      },
    ].filter(Boolean) as Array<{ title: string; body: string }>;
  }, [response]);

  const selectedWeekGuide = selectedWeekMarker ? MARKER_GUIDE[selectedWeekMarker.type] : null;
  const selectedDayGuide = selectedDayMarker ? MARKER_GUIDE[selectedDayMarker.type] : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim()) void fetchStrategy(query.trim(), count);
  };

  return (
    <section className="wang-panel">
      <div className="card wang-header-card">
        <div className="wang-header-copy">
          <div>
            <p className="eyebrow">Wang Strategy Workspace</p>
            <h2>왕장군 전략</h2>
            <p className="meta">주봉 구조와 일봉 실행 판단을 분리해서, 왜 지금이 이 단계인지 문장으로 설명하는 교육형 화면입니다.</p>
          </div>
          <div className="wang-header-actions">
            <button type="button" className="preset-btn" onClick={() => response && fetchStrategy(response.meta.symbol, count)} disabled={loading || !response}>
              {loading ? "조회 중..." : "재조회"}
            </button>
            {response && <FavoriteButton active={isFavorite(response.meta.symbol)} onClick={() => toggleFavorite({ code: response.meta.symbol, name: response.meta.name })} />}
          </div>
        </div>

        <form className="search wang-search-form" onSubmit={onSubmit}>
          <div className="search-input-wrap" ref={searchWrapRef}>
            <input ref={queryInputRef} value={query} onFocus={() => setShowSuggestions(true)} onChange={(event) => { setQuery(event.target.value); setShowSuggestions(true); }} placeholder="005930 또는 삼성전자" aria-label="왕장군 전략 종목 검색" />
            {query.trim().length > 0 && <button type="button" className="search-clear-btn" aria-label="검색어 지우기" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); setSuggestions([]); setShowSuggestions(false); queryInputRef.current?.focus(); }}>×</button>}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="suggestions" role="listbox" aria-label="종목 추천 목록">
                {suggestions.map((stock) => (
                  <li key={`${stock.market}-${stock.code}`}>
                    <button type="button" className="suggestion-item" onMouseDown={(event) => event.preventDefault()} onClick={() => { setShowSuggestions(false); void fetchStrategy(stock.code, count); }}>
                      <span className="suggestion-main"><strong>{stock.code}</strong><em>{stock.name}</em></span>
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
          <button type="submit" disabled={loading}>{loading ? "불러오는 중..." : "전략 해석"}</button>
        </form>

        <div className="wang-favorite-row">
          <span>즐겨찾기</span>
          {favorites.length === 0 ? <small className="meta">아직 등록된 종목이 없습니다.</small> : favorites.slice(0, 8).map((item) => (
            <button key={item.code} type="button" className={response?.meta.symbol === item.code ? "preset-btn active wang-chip-btn" : "preset-btn wang-chip-btn"} onClick={() => void fetchStrategy(item.code, count)}>
              {item.name || item.code}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!response && !loading && !error && <div className="card wang-empty-state"><h3>종목을 선택하면 주봉 구조부터 일봉 실행까지 순서대로 설명합니다.</h3></div>}

      {response && (
        <>
          <div className="wang-summary-grid">
            <article className="card wang-hero-card">
              <div className="wang-hero-head">
                <div>
                  <h3>{response.meta.name} ({response.meta.symbol})</h3>
                  <p className="meta">{response.meta.market} · 기준거래량 {formatVolume(response.meta.referenceVolume)}</p>
                </div>
                <div className="final-badges">
                  <span className={phaseClassName(response.currentPhase)}>{PHASE_LABEL[response.currentPhase]}</span>
                  <span className={interpretationClassName(response.summary.interpretation)}>{INTERPRETATION_LABEL[response.summary.interpretation]}</span>
                </div>
              </div>
              <p className="wang-summary-headline">{response.summary.headline}</p>
              <p className="meta">{response.summary.posture}</p>
              <div className="wang-kpi-grid">
                <div className="plan-item"><span>현재 phase</span><strong>{PHASE_LABEL[response.currentPhase]}</strong></div>
                <div className="plan-item"><span>confidence</span><strong>{response.confidence}</strong></div>
                <div className="plan-item"><span>현재 해석</span><strong>{INTERPRETATION_LABEL[response.summary.interpretation]}</strong></div>
                <div className="plan-item"><span>실행 결론</span><strong>{response.movingAverageContext.verdict}</strong></div>
              </div>
            </article>

            <article className="card">
              <div className="wang-card-head"><h3>주봉 구조 판단</h3><small className={phaseClassName(response.weeklyPhaseContext.phase)}>{PHASE_LABEL[response.weeklyPhaseContext.phase]}</small></div>
              <p className="meta">{response.weeklyPhaseContext.headline}</p>
              <p className="plan-note">{response.weeklyPhaseContext.stageSummary}</p>
              <div className="wang-kpi-grid wang-kpi-grid-compact">
                <div className="plan-item"><span>반복 기준거래량</span><strong>{response.weeklyPhaseContext.baseRepeatCount}회</strong></div>
                <div className="plan-item"><span>상대 최저 점수</span><strong>{response.weeklyPhaseContext.relativeShortVolumeScore}</strong></div>
                <div className="plan-item"><span>기간 조정</span><strong>{monthsFromBars(response.weeklyPhaseContext.cooldownBarsFromLife)}</strong></div>
                <div className="plan-item"><span>최소거래량</span><strong>{formatVolume(response.weeklyPhaseContext.minVolume)}</strong></div>
              </div>
            </article>

            <article className="card">
              <div className="wang-card-head"><h3>일봉 실행 판단</h3><small className={executionClassName(response.dailyExecutionContext.state)}>{EXECUTION_LABEL[response.dailyExecutionContext.state]}</small></div>
              <p className="meta">{response.dailyExecutionContext.headline}</p>
              <p className="plan-note">{response.dailyExecutionContext.action}</p>
              <div className="wang-kpi-grid wang-kpi-grid-compact">
                <div className="plan-item"><span>20일선 이하</span><strong>{response.dailyExecutionContext.belowMa20 ? "예" : "아니오"}</strong></div>
                <div className="plan-item"><span>zone 재접근</span><strong>{response.dailyExecutionContext.retestDetected ? "확인" : "대기"}</strong></div>
                <div className="plan-item"><span>재기준거래량</span><strong>{response.dailyExecutionContext.dailyRebaseCount}회</strong></div>
                <div className="plan-item"><span>zone 폭</span><strong>{formatPercent(response.dailyExecutionContext.zoneWidthPct)}</strong></div>
              </div>
            </article>
          </div>

          <article className="card">
            <h3>왜 지금 이 단계인가</h3>
            <ul className="insight-list">{response.reasons.map((reason) => <li key={reason}><span>{reason}</span></li>)}</ul>
          </article>

          <div className="wang-chart-stack">
            <article className="card wang-chart-card">
              <div className="wang-card-head"><div><h3>주봉 메인 차트</h3><p className="meta">인생거래량부터 최소거래량 구간과 점까지 큰 구조를 먼저 읽습니다.</p></div><small className="confidence neutral">주봉이 메인 판단 축</small></div>
              <WangStrategyChart candles={response.candles.week} chartOverlays={response.chartOverlays.week} markers={response.markers.week} height={390} onSelectMarker={setSelectedWeekMarker} />
              {selectedWeekMarker && <div className="wang-selected-card"><div className="wang-card-head"><strong>{selectedWeekMarker.label}</strong><small>{selectedWeekMarker.t}</small></div><div className="wang-selected-grid"><div className="plan-item"><span>가격</span><strong>{formatPrice(selectedWeekMarker.price)}</strong></div><div className="plan-item"><span>거래량</span><strong>{formatVolume(selectedWeekMarker.volume)}</strong></div><div className="plan-item"><span>강도</span><strong>{selectedWeekMarker.strength}</strong></div></div>{selectedWeekGuide && <div className="wang-marker-guide"><p className="wang-marker-guide-title">{selectedWeekGuide.why}</p><p className="meta">{selectedWeekGuide.action}</p></div>}<p className="plan-note">{selectedWeekMarker.desc}</p></div>}
            </article>

            <article className="card wang-chart-card">
              <div className="wang-card-head"><div><h3>일봉 상세 차트</h3><p className="meta">주봉 zone을 일봉으로 내려서 재접근, 20일선 할인, 심리 전환을 실행 관점으로 봅니다.</p></div><small className={response.movingAverageContext.belowMa20 ? "confidence good" : "confidence neutral"}>{response.movingAverageContext.verdict}</small></div>
              <WangStrategyChart candles={response.candles.day} chartOverlays={response.chartOverlays.day} markers={response.markers.day} height={350} onSelectMarker={setSelectedDayMarker} />
              {selectedDayMarker && <div className="wang-selected-card"><div className="wang-card-head"><strong>{selectedDayMarker.label}</strong><small>{selectedDayMarker.t}</small></div><div className="wang-selected-grid"><div className="plan-item"><span>가격</span><strong>{formatPrice(selectedDayMarker.price)}</strong></div><div className="plan-item"><span>거래량</span><strong>{formatVolume(selectedDayMarker.volume)}</strong></div><div className="plan-item"><span>강도</span><strong>{selectedDayMarker.strength}</strong></div></div>{selectedDayGuide && <div className="wang-marker-guide"><p className="wang-marker-guide-title">{selectedDayGuide.why}</p><p className="meta">{selectedDayGuide.action}</p></div>}<p className="plan-note">{selectedDayMarker.desc}</p></div>}
            </article>
          </div>

          <div className="wang-main-grid">
            <article className="card">
              <h3>단계별 해석</h3>
              <div className="wang-phase-stack">{response.phases.map((phase) => <div key={phase.phase} className="wang-phase-item"><div className="wang-phase-head"><strong>{phase.title}</strong><small className={phase.status === "active" ? "badge good" : phase.status === "completed" ? "badge neutral" : "badge caution"}>{phase.status === "active" ? "현재 단계" : phase.status === "completed" ? "통과" : "대기"}</small></div><p className="meta">{phase.summary}</p><p className="plan-note">{phase.nextCondition}</p></div>)}</div>
            </article>

            <article className="card">
              <h3>체크리스트</h3>
              <div className="wang-checklist-columns">
                {([["구조 판정", structureChecklist], ["실행 판정", executionChecklist], ["리스크 판정", riskChecklist]] as Array<[string, WangStrategyChecklistItem[]]>).map(([title, items]) => <div key={title}><h4>{title}</h4><ul className="insight-list">{items.map((item) => <li key={item.id}><span><small className={item.ok ? "reason-tag positive" : "reason-tag negative"}>{item.ok ? "충족" : "미충족"}</small> {item.label}</span><small>{item.detail}</small></li>)}</ul></div>)}
              </div>
            </article>
          </div>

          <div className="wang-secondary-grid">
            <article className="card">
              <h3>실전 적립 구간</h3>
              {activeZone ? <>
                <div className="wang-zone-kpis">
                  <div className="plan-item"><span>실행 zone</span><strong>{formatPrice(activeZone.low)} ~ {formatPrice(activeZone.high)}</strong></div>
                  <div className="plan-item"><span>20일선 이하</span><strong>{response.movingAverageContext.belowMa20 ? "예" : "아니오"}</strong></div>
                  <div className="plan-item"><span>무효 가격</span><strong>{formatPrice(activeZone.invalidationPrice)}</strong></div>
                </div>
                <p className="plan-note">{activeZone.scenario}</p>
                <ul className="insight-list">{activeZone.splitPlan.map((item) => <li key={item.label}><span>{item.label} · {item.weightPct}% · {formatPrice(item.price)}</span><small>{item.note}</small></li>)}</ul>
              </> : <p className="meta">아직 실행 zone이 명확하게 잡히지 않았습니다.</p>}
            </article>

            <article className="card">
              <h3>교육형 해설</h3>
              <div className="wang-explainer-stack">{explainers.map((item) => <div key={item.title} className="wang-explainer-card"><strong>{item.title}</strong><p>{item.body}</p></div>)}</div>
            </article>

            <article className="card">
              <h3>리스크 / 주의</h3>
              <div className="wang-risk-stack">{response.riskNotes.map((note) => <div key={note.id} className={riskClassName(note)}><strong>{note.title}</strong><p>{note.detail}</p></div>)}</div>
            </article>
          </div>

          <div className="wang-tertiary-grid">
            <article className="card">
              <h3>멀티 타임프레임 요약</h3>
              <div className="wang-timeframe-grid">{timeframeSummaries.map((item) => <div key={item.tf} className="wang-timeframe-item"><div className="wang-card-head"><strong>{TF_LABEL[item.tf]}</strong><small className="reason-tag neutral">{item.regime} / {item.structure}</small></div><p className="meta">{item.summary}</p><p className="plan-note">phase bias: {PHASE_LABEL[item.phaseBias]} · score {item.score}</p></div>)}</div>
            </article>

            <article className="card">
              <h3>훈련 노트</h3>
              <div className="wang-training-stack">{response.trainingNotes.map((note) => <div key={note.id} className="wang-training-item"><div className="wang-card-head"><strong>{note.title}</strong><small className={note.emphasis === "core" ? "reason-tag positive" : note.emphasis === "warning" ? "reason-tag negative" : "reason-tag neutral"}>{note.emphasis === "core" ? "핵심" : note.emphasis === "warning" ? "주의" : "실전"}</small></div><p>{note.text}</p></div>)}</div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
