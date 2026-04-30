import { clamp } from "../utils";

export const lastValue = <T>(arr: Array<T | null>): T | null => {
  if (arr.length === 0) return null;
  return arr[arr.length - 1];
};

export const valueAt = <T>(arr: Array<T | null>, offsetFromLast: number): T | null => {
  const index = arr.length - 1 - offsetFromLast;
  if (index < 0 || index >= arr.length) return null;
  return arr[index];
};

export const mddPercent = (closes: number[]): number | null => {
  if (closes.length === 0) return null;
  let peak = closes[0];
  let mdd = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    const drawdown = (close / peak - 1) * 100;
    mdd = Math.min(mdd, drawdown);
  }
  return mdd;
};

export const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const pctWithinRange = (value: number, low: number, high: number): number => {
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  return clamp((value - low) / span, 0, 1);
};

export const pickNearestBelow = (values: number[], reference: number): number | null => {
  const below = values.filter((value) => Number.isFinite(value) && value < reference);
  if (below.length === 0) return null;
  return Math.max(...below);
};

export const pickNearestAbove = (values: number[], reference: number): number | null => {
  const above = values.filter((value) => Number.isFinite(value) && value > reference);
  if (above.length === 0) return null;
  return Math.min(...above);
};
