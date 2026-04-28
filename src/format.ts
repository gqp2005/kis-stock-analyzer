import type { Overall } from "./types";

export const formatPrice = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value)
    ? "-"
    : `${Math.round(value).toLocaleString("ko-KR")}원`;

export const formatPercent = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}%`;

export const formatSignedPercent = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export const formatFactor = (value: number | null): string =>
  value == null ? "-" : value.toFixed(2);

export const formatRatio = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}배`;

export const formatR = (value: number | null): string =>
  value == null ? "-" : `${value.toFixed(2)}R`;

export const formatBars = (value: number | null): string =>
  value == null ? "-" : `${value}봉`;

export const formatSignedDecimal = (value: number | null): string =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

export const formatSignedPriceChange = (
  change: number | null,
  changePct: number | null,
): string => {
  if (change == null || changePct == null) return "-";
  const rounded = Math.round(change);
  const priceText = `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ko-KR")}원`;
  return `${priceText} (${formatSignedDecimal(changePct)}%)`;
};

export const overallLabel = (overall: Overall): string => {
  if (overall === "GOOD") return "양호";
  if (overall === "NEUTRAL") return "중립";
  return "주의";
};

export const overallClass = (overall: Overall): string => {
  if (overall === "GOOD") return "badge good";
  if (overall === "NEUTRAL") return "badge neutral";
  return "badge caution";
};

export const scoreClass = (score: number): string => {
  if (score >= 70) return "score good";
  if (score >= 45) return "score neutral";
  return "score caution";
};

export const confidenceClass = (confidence: number): string => {
  if (confidence >= 70) return "confidence good";
  if (confidence >= 45) return "confidence neutral";
  return "confidence caution";
};

export const verdictToneClass = (
  verdict: "매수 검토" | "관망" | "비중 축소",
): string => {
  if (verdict === "매수 검토") return "signal-tag positive";
  if (verdict === "비중 축소") return "signal-tag negative";
  return "signal-tag neutral";
};
