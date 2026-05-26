import { useMemo, useState } from "react";
import { formatPrice } from "./format";
import type {
  AccountAssetHistory,
  AccountAssetHistoryPeriod,
  AccountAssetHistoryPoint,
  AccountAssetHistorySeries,
} from "./types";

interface AccountAssetChartProps {
  history: AccountAssetHistory | undefined;
}

const PERIOD_OPTIONS: Array<{ id: AccountAssetHistoryPeriod; label: string }> = [
  { id: "day", label: "일" },
  { id: "week", label: "주" },
  { id: "month", label: "월" },
];

const VIEW_LIMIT: Record<AccountAssetHistoryPeriod, number> = {
  day: 32,
  week: 26,
  month: 24,
};

const CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const PAD = { left: 58, right: 22, top: 22, bottom: 34 };
const LINE_AREA_HEIGHT = 148;
const BAR_TOP = 178;
const BAR_HEIGHT = 52;

const formatSignedPrice = (value: number | null): string => {
  if (value == null) return "-";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("ko-KR")}원`;
};

const formatSignedPercent = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatCompactWon = (value: number | null): string => {
  if (value == null) return "-";
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return Math.round(value).toLocaleString("ko-KR");
};

const periodTitle = (period: AccountAssetHistoryPeriod): string => {
  if (period === "day") return "일간";
  if (period === "week") return "주간";
  return "월간";
};

const visiblePointsFor = (
  series: AccountAssetHistorySeries,
  period: AccountAssetHistoryPeriod,
): AccountAssetHistoryPoint[] => series.points.slice(-VIEW_LIMIT[period]);

const buildAssetPath = (
  points: AccountAssetHistoryPoint[],
  minAsset: number,
  maxAsset: number,
): string => {
  const plotWidth = CHART_WIDTH - PAD.left - PAD.right;
  const valueRange = Math.max(maxAsset - minAsset, 1);
  const linePoints = points
    .map((point, index) => {
      if (point.totalAssetAmount == null) return null;
      const x =
        points.length === 1 ? PAD.left + plotWidth / 2 : PAD.left + (plotWidth * index) / (points.length - 1);
      const y = PAD.top + ((maxAsset - point.totalAssetAmount) / valueRange) * LINE_AREA_HEIGHT;
      return { x, y };
    })
    .filter((point): point is { x: number; y: number } => point != null);

  return linePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
};

export default function AccountAssetChart(props: AccountAssetChartProps) {
  const { history } = props;
  const [activePeriod, setActivePeriod] = useState<AccountAssetHistoryPeriod>("day");

  const activeSeries = history?.[activePeriod] ?? null;
  const points = useMemo(
    () => (activeSeries ? visiblePointsFor(activeSeries, activePeriod) : []),
    [activePeriod, activeSeries],
  );

  const chart = useMemo(() => {
    const assets = points
      .map((point) => point.totalAssetAmount)
      .filter((value): value is number => value != null);
    const changes = points
      .map((point) => point.changeAmount)
      .filter((value): value is number => value != null);
    const latestAsset = assets[assets.length - 1] ?? null;
    const minAsset = assets.length > 0 ? Math.min(...assets) : 0;
    const maxAsset = assets.length > 0 ? Math.max(...assets) : 0;
    const assetPadding = Math.max((maxAsset - minAsset) * 0.12, latestAsset == null ? 1 : latestAsset * 0.002, 1);
    const paddedMin = Math.max(0, minAsset - assetPadding);
    const paddedMax = maxAsset + assetPadding;
    const maxAbsChange = Math.max(...changes.map((value) => Math.abs(value)), 1);
    const labelEvery = Math.max(1, Math.ceil(points.length / 6));
    const assetPath = buildAssetPath(points, paddedMin, paddedMax);

    return {
      latestAsset,
      minAsset: paddedMin,
      maxAsset: paddedMax,
      maxAbsChange,
      labelEvery,
      assetPath,
    };
  }, [points]);

  if (!history || !activeSeries) return null;

  const latestPoint = activeSeries.points[activeSeries.points.length - 1] ?? null;
  const plotWidth = CHART_WIDTH - PAD.left - PAD.right;
  const valueRange = Math.max(chart.maxAsset - chart.minAsset, 1);
  const zeroY = BAR_TOP + BAR_HEIGHT / 2;
  const barWidth = Math.max(5, Math.min(18, plotWidth / Math.max(points.length * 1.85, 1)));
  const hasEnoughHistory = activeSeries.points.length >= 2;

  return (
    <section className="account-history-panel">
      <div className="account-history-head">
        <div>
          <h4>자산 상승 추이</h4>
          <p className="meta">총자산 기준 {periodTitle(activePeriod)} 증감</p>
        </div>
        <div className="tf-tabs account-history-tabs">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={activePeriod === option.id ? "tab active" : "tab"}
              onClick={() => setActivePeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="account-history-kpis">
        <div className="plan-item">
          <span>최근 자산</span>
          <strong>{formatPrice(latestPoint?.totalAssetAmount ?? null)}</strong>
        </div>
        <div className="plan-item">
          <span>최근 {periodTitle(activePeriod)} 증감</span>
          <strong className={(activeSeries.latestChangeAmount ?? 0) < 0 ? "negative-value" : "positive-value"}>
            {formatSignedPrice(activeSeries.latestChangeAmount)}
          </strong>
        </div>
        <div className="plan-item">
          <span>누적 증감</span>
          <strong className={(activeSeries.totalChangeAmount ?? 0) < 0 ? "negative-value" : "positive-value"}>
            {formatSignedPrice(activeSeries.totalChangeAmount)}
          </strong>
        </div>
        <div className="plan-item">
          <span>평균 증감</span>
          <strong>{formatSignedPrice(activeSeries.averageChangeAmount)}</strong>
        </div>
      </div>

      <div className="account-history-chart" aria-label={`계좌 ${periodTitle(activePeriod)} 자산 증감 그래프`}>
        {points.length === 0 ? (
          <p className="account-history-empty">자산 히스토리가 없습니다.</p>
        ) : (
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img">
            <title>{`계좌 ${periodTitle(activePeriod)} 자산 증감`}</title>
            <line
              x1={PAD.left}
              x2={CHART_WIDTH - PAD.right}
              y1={PAD.top + LINE_AREA_HEIGHT}
              y2={PAD.top + LINE_AREA_HEIGHT}
              className="account-history-grid-line"
            />
            <line
              x1={PAD.left}
              x2={CHART_WIDTH - PAD.right}
              y1={zeroY}
              y2={zeroY}
              className="account-history-zero-line"
            />
            <text x={8} y={PAD.top + 4} className="account-history-axis-text">
              {formatCompactWon(chart.maxAsset)}
            </text>
            <text x={8} y={PAD.top + LINE_AREA_HEIGHT + 4} className="account-history-axis-text">
              {formatCompactWon(chart.minAsset)}
            </text>
            {chart.assetPath && <path d={chart.assetPath} className="account-history-line" />}
            {points.map((point, index) => {
              const x =
                points.length === 1
                  ? PAD.left + plotWidth / 2
                  : PAD.left + (plotWidth * index) / (points.length - 1);
              const assetY =
                point.totalAssetAmount == null
                  ? PAD.top + LINE_AREA_HEIGHT / 2
                  : PAD.top + ((chart.maxAsset - point.totalAssetAmount) / valueRange) * LINE_AREA_HEIGHT;
              const change = point.changeAmount ?? 0;
              const normalized = Math.min(Math.abs(change) / chart.maxAbsChange, 1);
              const barHeight = Math.max(change === 0 ? 0 : 3, normalized * (BAR_HEIGHT / 2 - 4));
              const barY = change >= 0 ? zeroY - barHeight : zeroY;
              const showLabel = index === points.length - 1 || index % chart.labelEvery === 0;
              return (
                <g key={point.key}>
                  <rect
                    x={x - barWidth / 2}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                    className={change < 0 ? "account-history-bar negative" : "account-history-bar positive"}
                  >
                    <title>{`${point.label} 증감 ${formatSignedPrice(point.changeAmount)} · 총자산 ${formatPrice(point.totalAssetAmount)}`}</title>
                  </rect>
                  {point.totalAssetAmount != null && (
                    <circle
                      cx={x}
                      cy={assetY}
                      r={index === points.length - 1 ? 4.2 : 3}
                      className="account-history-point"
                    >
                      <title>{`${point.label} 총자산 ${formatPrice(point.totalAssetAmount)} · 증감 ${formatSignedPrice(point.changeAmount)} (${formatSignedPercent(point.changeRate)})`}</title>
                    </circle>
                  )}
                  {showLabel && (
                    <text x={x} y={CHART_HEIGHT - 10} textAnchor="middle" className="account-history-x-text">
                      {point.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {!hasEnoughHistory && (
        <p className="plan-note">조회 기록이 2개 이상 쌓이면 기간별 증감이 표시됩니다.</p>
      )}
      {!history.storage.enabled && (
        <p className="plan-note">히스토리 저장소가 비활성화되어 현재 조회값만 표시됩니다.</p>
      )}
    </section>
  );
}
