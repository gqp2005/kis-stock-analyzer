import type { FormEvent, RefObject } from "react";

interface AnalysisSuggestion {
  code: string;
  name: string;
  market: string;
}

interface AnalysisSearchHeaderProps {
  query: string;
  days: number;
  loading: boolean;
  backtestLoading: boolean;
  showSuggestions: boolean;
  suggestions: AnalysisSuggestion[];
  showEmptyState: boolean;
  searchWrapRef: RefObject<HTMLDivElement | null>;
  queryInputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onInputFocus: () => void;
  onDaysChange: (value: number) => void;
  onClearQuery: () => void;
  onSelectSuggestion: (item: AnalysisSuggestion) => void;
}

export default function AnalysisSearchHeader(props: AnalysisSearchHeaderProps) {
  const {
    query,
    days,
    loading,
    backtestLoading,
    showSuggestions,
    suggestions,
    showEmptyState,
    searchWrapRef,
    queryInputRef,
    onSubmit,
    onQueryChange,
    onInputFocus,
    onDaysChange,
    onClearQuery,
    onSelectSuggestion,
  } = props;

  return (
    <section className="analysis-search-shell">
      <form className="search analysis-search-form" onSubmit={onSubmit}>
        <div className="search-input-wrap" ref={searchWrapRef}>
          <input
            ref={queryInputRef}
            value={query}
            onFocus={onInputFocus}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="005930 또는 삼성전자"
            aria-label="종목 코드 또는 종목명"
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="입력값 지우기"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClearQuery}
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
        <select value={days} onChange={(event) => onDaysChange(Number(event.target.value))} aria-label="조회 기간">
          <option value={120}>최근 120봉</option>
          <option value={180}>최근 180봉</option>
          <option value={240}>최근 240봉</option>
        </select>
        <button type="submit" disabled={loading || backtestLoading}>
          {loading ? "조회 중..." : "조회"}
        </button>
      </form>

      {showEmptyState && (
        <div className="card analysis-empty-state">
          <div className="analysis-empty-copy">
            <p className="eyebrow">Decision First</p>
            <h2>종목을 고르면 판단용 요약부터 먼저 정리됩니다.</h2>
            <p className="subtitle">
              코드 또는 종목명을 검색해 조회하면 상단에는 판정과 매매 계획만, 상세 분석은 아래에서 차례대로 확인할 수 있습니다.
            </p>
          </div>
          <div className="analysis-empty-grid">
            <div className="plan-item">
              <span>1단계</span>
              <strong>종목 선택</strong>
              <small className="plan-note">코드/종목명 자동완성 지원</small>
            </div>
            <div className="plan-item">
              <span>2단계</span>
              <strong>판단 확인</strong>
              <small className="plan-note">판정, 가격, 진입/손절 우선 노출</small>
            </div>
            <div className="plan-item">
              <span>3단계</span>
              <strong>깊이 탐색</strong>
              <small className="plan-note">패턴, 수급, 백테스트는 아래 상세 섹션</small>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
