import type { ReactNode } from "react";

interface DecisionPlanItem {
  label: string;
  value: string;
}

interface DecisionScoreItem {
  label: string;
  value: number;
  className: string;
}

interface DecisionReasonItem {
  text: string;
  toneLabel: string;
  toneClassName: string;
}

interface AnalysisDecisionSummaryProps {
  name: string;
  symbol: string;
  summary: string;
  metaLine: string;
  favoriteButton: ReactNode;
  overallLabel: string;
  overallClassName: string;
  confidence: number;
  confidenceClassName: string;
  activeTfLabel: string;
  currentPrice: string;
  currentChange: string | null;
  currentChangeClassName: string | null;
  warnings: string[];
  planItems: DecisionPlanItem[];
  planNote: string;
  scoreItems: DecisionScoreItem[];
  scoreNote: string;
  coreReasons: DecisionReasonItem[];
  reasonNote: string;
}

export default function AnalysisDecisionSummary(props: AnalysisDecisionSummaryProps) {
  const {
    name,
    symbol,
    summary,
    metaLine,
    favoriteButton,
    overallLabel,
    overallClassName,
    confidence,
    confidenceClassName,
    activeTfLabel,
    currentPrice,
    currentChange,
    currentChangeClassName,
    warnings,
    planItems,
    planNote,
    scoreItems,
    scoreNote,
    coreReasons,
    reasonNote,
  } = props;

  const focusSteps = [
    {
      step: "1",
      title: "매매 계획",
      description: "진입, 손절, 목표가부터 먼저 확인합니다.",
    },
    {
      step: "2",
      title: "핵심 점수",
      description: `현재 ${activeTfLabel} 기준 강도와 신뢰도를 판단합니다.`,
    },
    {
      step: "3",
      title: "근거·차트",
      description: "세부 근거와 차트는 아래에서 이어서 확인합니다.",
    },
  ];

  return (
    <section className="analysis-summary-shell">
      <div className="sticky-summary-bar analysis-sticky-summary">
        <div className="sticky-summary-main">
          <div>
            <strong>
              {name} ({symbol})
            </strong>
            <p>{summary}</p>
          </div>
          {favoriteButton}
          <div className="sticky-summary-price">
            <span>{currentPrice}</span>
            {currentChange && currentChangeClassName && <small className={currentChangeClassName}>{currentChange}</small>}
          </div>
        </div>
        <div className="sticky-summary-side">
          <span className={overallClassName}>{overallLabel}</span>
          <span className={confidenceClassName}>신뢰도 {confidence}</span>
          <span className="badge neutral">{activeTfLabel} 보기</span>
        </div>
      </div>

      <p className="meta summary-meta-bottom">{metaLine}</p>

      <section className="analysis-reading-guide" aria-label="분석 읽는 순서">
        <div className="analysis-reading-copy">
          <strong>읽는 순서</strong>
          <p>첫 화면은 판단부터 보고, 세부 차트와 보조 지표는 그다음에 보는 흐름으로 정리했습니다.</p>
        </div>
        <div className="analysis-reading-steps">
          {focusSteps.map((item) => (
            <div key={item.step} className="analysis-reading-step">
              <span>{item.step}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </div>
          ))}
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="analysis-warning-shell" aria-label="주의 사항">
          <strong>체크할 점</strong>
          <div className="warning-box analysis-warning-box">
            {warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        </section>
      )}

      <div className="analysis-decision-grid">
        <article className="card decision-card">
          <div className="decision-card-head">
            <h3>매매 계획</h3>
            <small className="badge neutral">판단 우선</small>
          </div>
          <div className="decision-plan-grid">
            {planItems.map((item) => (
              <div key={item.label} className="plan-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p className="decision-card-note">{planNote}</p>
        </article>

        <article className="card decision-card">
          <div className="decision-card-head">
            <h3>핵심 점수</h3>
            <small className="badge neutral">현재 {activeTfLabel}</small>
          </div>
          <div className="decision-score-grid">
            {scoreItems.map((item) => (
              <div key={item.label} className={item.className}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p className="decision-card-note">{scoreNote}</p>
        </article>

        <article className="card decision-card">
          <div className="decision-card-head">
            <h3>핵심 근거 3개</h3>
            <small className="badge neutral">요약</small>
          </div>
          <ul className="decision-reason-list">
            {coreReasons.map((item) => (
              <li key={item.text}>
                <span>{item.text}</span>
                <small className={item.toneClassName}>{item.toneLabel}</small>
              </li>
            ))}
          </ul>
          <p className="decision-card-note">{reasonNote}</p>
        </article>
      </div>
    </section>
  );
}
