import { DAY_SCORE_RULE_ID } from "./constants";
import { runDayBacktestEngine } from "./engine";
import { evaluateDayScoreRuleSignal } from "./strategy";
import type { DayBacktestOptions } from "./types";
import type { Candle } from "../types";

export { DAY_SCORE_RULE_ID };
export type { DayBacktestOptions };

export const runDayBacktest = (candles: Candle[], options: DayBacktestOptions = {}) =>
  runDayBacktestEngine(candles, evaluateDayScoreRuleSignal, options);
