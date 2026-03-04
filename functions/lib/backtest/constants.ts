export const DAY_SCORE_RULE_ID = "score-card-v1-day-overall";
export const WASHOUT_PULLBACK_RULE_V1 = "washout-pullback-v1";
export const WASHOUT_PULLBACK_RULE_V1_1 = "washout-pullback-v1.1";

export const MIN_LOOKBACK_BARS = 160;
export const DEFAULT_HOLD_BARS = 10;
export const MIN_WASHOUT_LOOKBACK_BARS = 240;
export const DEFAULT_WASHOUT_HOLD_BARS = 20;
export const MAX_RECENT_TRADES = 80;

export const PERIOD_WINDOWS = [
  { label: "3개월", bars: 63 },
  { label: "6개월", bars: 126 },
  { label: "1년", bars: 252 },
] as const;
