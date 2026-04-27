import type { MutableRefObject, ReactNode } from "react";

interface AnalysisTabItem {
  id: string;
  label: string;
  disabled: boolean;
}

interface AnalysisChartWorkspaceProps {
  tabs: AnalysisTabItem[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  hasActiveAnalysis: boolean;
  emptyTitle: string;
  emptyDescription: string;
  chartTitle: string;
  priceChartHeight: number;
  mobileChartFullWidth: boolean;
  priceChartRef: MutableRefObject<HTMLDivElement | null>;
  rsiChartRef: MutableRefObject<HTMLDivElement | null>;
  presetMode: "basic" | "detail" | "custom";
  onApplyBasicPreset: () => void;
  onApplyDetailPreset: () => void;
  hasChartSettings: boolean;
  chartSettingsContent: ReactNode;
  chartNotices: ReactNode;
  chartFooter: ReactNode;
  hasRsiPanel: boolean;
  rsiBadge: string;
  rsiDisabledMessage: string;
  rsiOpinionLabel: string;
  rsiOpinionClassName: string;
  rsiOpinionText: string;
}

export default function AnalysisChartWorkspace(props: AnalysisChartWorkspaceProps) {
  const {
    tabs,
    activeTab,
    onSelectTab,
    hasActiveAnalysis,
    emptyTitle,
    emptyDescription,
    chartTitle,
    priceChartHeight,
    mobileChartFullWidth,
    priceChartRef,
    rsiChartRef,
    presetMode,
    onApplyBasicPreset,
    onApplyDetailPreset,
    hasChartSettings,
    chartSettingsContent,
    chartNotices,
    chartFooter,
    hasRsiPanel,
    rsiBadge,
    rsiDisabledMessage,
    rsiOpinionLabel,
    rsiOpinionClassName,
    rsiOpinionText,
  } = props;

  return (
    <section className="analysis-workspace">
      <div className="tf-tabs analysis-tf-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "tab active" : tab.disabled ? "tab disabled" : "tab"}
            disabled={tab.disabled}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {hasActiveAnalysis ? (
        <>
          <div className={mobileChartFullWidth ? "card chart-card analysis-chart-card mobile-full-width" : "card chart-card analysis-chart-card"}>
            <div className="analysis-chart-head">
              <div>
                <h3>{chartTitle}</h3>
                <p className="plan-note">차트는 기본형 프리셋으로 시작하고, 더 많은 오버레이는 필요할 때만 펼쳐 확인합니다.</p>
              </div>
              <div className="analysis-chart-tools">
                <div className="drawing-presets">
                  <span>자동 작도 프리셋</span>
                  <button
                    type="button"
                    className={presetMode === "basic" ? "preset-btn active" : "preset-btn"}
                    onClick={onApplyBasicPreset}
                  >
                    기본형
                  </button>
                  <button
                    type="button"
                    className={presetMode === "detail" ? "preset-btn active" : "preset-btn"}
                    onClick={onApplyDetailPreset}
                  >
                    상세형
                  </button>
                </div>
                {hasChartSettings && (
                  <details className="chart-config-panel">
                    <summary className="chart-config-summary">
                      <span>차트 설정</span>
                      <small>{presetMode === "custom" ? "사용자 조정" : "세부 옵션 열기"}</small>
                    </summary>
                    <div className="chart-config-body">{chartSettingsContent}</div>
                  </details>
                )}
              </div>
            </div>

            {chartNotices}
            <div ref={priceChartRef} className="chart" style={{ height: `${priceChartHeight}px` }} />
            {chartFooter}
          </div>

          <div className="card analysis-rsi-card">
            <div className="rsi-header">
              <h3>RSI(14) 패널</h3>
              <span className="rsi-badge">{rsiBadge}</span>
            </div>
            {hasRsiPanel ? <div ref={rsiChartRef} className="rsi-chart" /> : <p className="rsi-empty">{rsiDisabledMessage}</p>}
            <p className="insight-opinion">
              <small className={rsiOpinionClassName}>{rsiOpinionLabel}</small>
              {rsiOpinionText}
            </p>
          </div>
        </>
      ) : (
        <div className="card">
          <h3>{emptyTitle}</h3>
          <p>{emptyDescription}</p>
        </div>
      )}
    </section>
  );
}
