import { analyzeTimeframe } from "../scoring";
import type { DaySignalDecision, DaySignalEvaluator } from "./types";

// 현재 운영 중인 day 스코어 룰을 그대로 과거 시점에 롤링 적용한다.
export const evaluateDayScoreRuleSignal: DaySignalEvaluator = (context): DaySignalDecision => {
  if (context.signalIndex < context.lookbackBars - 1) {
    return {
      shouldEnter: false,
      stopPrice: null,
      targetPrice: null,
    };
  }

  const history = context.candles.slice(0, context.signalIndex + 1);
  const analysis = analyzeTimeframe("day", history);
  if (analysis.scores.overall !== context.signalOverall) {
    return {
      shouldEnter: false,
      stopPrice: null,
      targetPrice: null,
    };
  }

  return {
    shouldEnter: true,
    stopPrice: analysis.tradePlan.stop,
    targetPrice: analysis.tradePlan.target,
  };
};
