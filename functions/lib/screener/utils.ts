import { clamp, round2 } from "../utils";

export const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const averageNullable = (
  values: Array<number | null | undefined>,
): number | null => {
  const filtered = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (filtered.length === 0) return null;
  return average(filtered);
};

export const toNullableRounded = (value: number | null): number | null => round2(value);

export const toRounded = (value: number): number => round2(value) ?? value;

export const clampScore = (value: number): number => clamp(Math.round(value), 0, 100);

export const dateKey = (value: string): string => value.slice(0, 10);

export const computeReturn = (candles: { close: number }[], bars: number): number | null => {
  if (candles.length <= bars) return null;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 1 - bars].close;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return last / prev - 1;
};
