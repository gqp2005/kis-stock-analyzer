import {
  DAY_SCORE_RULE_ID,
  WASHOUT_PULLBACK_RULE_V1,
  WASHOUT_PULLBACK_RULE_V1_1,
} from "./constants";
import { runDayBacktestEngine } from "./engine";
import { evaluateDayScoreRuleSignal } from "./strategy";
import { runWashoutPullbackBacktest } from "./washout";
import type { DayBacktestOptions, WashoutBacktestOptions } from "./types";
import type { Candle } from "../types";

export {
  DAY_SCORE_RULE_ID,
  WASHOUT_PULLBACK_RULE_V1,
  WASHOUT_PULLBACK_RULE_V1_1,
};
export type { DayBacktestOptions, WashoutBacktestOptions };

export const runDayBacktest = (candles: Candle[], options: DayBacktestOptions = {}) =>
  runDayBacktestEngine(candles, evaluateDayScoreRuleSignal, options);

export const runWashoutBacktestV1 = (
  candles: Candle[],
  options: WashoutBacktestOptions = {},
) => runWashoutPullbackBacktest(candles, WASHOUT_PULLBACK_RULE_V1, options);

export const runWashoutBacktestV1_1 = (
  candles: Candle[],
  options: WashoutBacktestOptions = {},
) => runWashoutPullbackBacktest(candles, WASHOUT_PULLBACK_RULE_V1_1, options);
