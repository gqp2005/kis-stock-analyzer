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

      {warnings.length > 0 && (
        <div className="warning-box">
          {warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
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
