export const DAY_SCORE_RULE_ID = "score-card-v1-day-overall";

export const MIN_LOOKBACK_BARS = 160;
export const DEFAULT_HOLD_BARS = 10;
export const MAX_RECENT_TRADES = 80;

export const PERIOD_WINDOWS = [
  { label: "3개월", bars: 63 },
  { label: "6개월", bars: 126 },
  { label: "1년", bars: 252 },
] as const;
