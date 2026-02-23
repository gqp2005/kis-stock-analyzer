export interface Env {
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_BASE_URL?: string;
  KIS_ENV?: "real" | "demo";
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_SEC?: string;
  ADMIN_TOKEN?: string;
}

export type Timeframe = "month" | "week" | "day";
export type Regime = "UP" | "SIDE" | "DOWN";
export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";
export type InvestmentProfile = "short" | "mid";

export interface Candle {
  time: string; // day/week/month: YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLevels {
  ma20: number | null;
  maFast: number | null;
  maMid: number | null;
  maLong: number | null;
  rsi14: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  atr14: number | null;
  atrPercent: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  volumeMa20: number | null;
  support: number | null;
  resistance: number | null;
}

export interface RiskBreakdown {
  atrScore: number;
  bbScore: number;
  mddScore: number;
  sharpDropScore: number;
  rawTotal: number;
  finalRisk: number;
}

export interface TradePlan {
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  note: string;
}

export interface IndicatorPoint {
  time: string;
  value: number | null;
}

export interface IndicatorSeries {
  ma: {
    ma1Period: number;
    ma2Period: number;
    ma3Period: number | null;
    ma1: IndicatorPoint[];
    ma2: IndicatorPoint[];
    ma3: IndicatorPoint[];
  };
  rsi14: IndicatorPoint[];
  bb: {
    upper: IndicatorPoint[];
    mid: IndicatorPoint[];
    lower: IndicatorPoint[];
  };
  macd: {
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
    line: IndicatorPoint[];
    signal: IndicatorPoint[];
    hist: IndicatorPoint[];
  };
}

export interface Scores {
  trend: number;
  momentum: number;
  risk: number;
  overall: Overall;
}

export interface ProfileScore {
  mode: InvestmentProfile;
  score: number;
  overall: Overall;
  weights: {
    trend: number;
    momentum: number;
    risk: number;
  };
  description: string;
}

export type VolumePatternType =
  | "BreakoutConfirmed"
  | "Upthrust"
  | "PullbackReaccumulation"
  | "ClimaxUp"
  | "CapitulationAbsorption"
  | "WeakBounce";

export interface VolumePatternSignal {
  t: string;
  type: VolumePatternType;
  label: string;
  desc: string;
  strength?: number;
  ref?: Record<string, number | string | null>;
  details?: {
    price: number;
    volume: number;
    volRatio: number;
    checklist: Array<{
      label: string;
      ok: boolean;
    }>;
    refLevel?: number | null;
    message: string;
    tone: "confirm" | "warning";
  };
}

export type FundamentalLabel = "UNDERVALUED" | "FAIR" | "OVERVALUED" | "N/A";
export type FlowLabel = "BUYING" | "BALANCED" | "SELLING" | "N/A";

export interface FundamentalSignal {
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  marketCap: number | null;
  settlementMonth: string | null;
  label: FundamentalLabel;
  reasons: string[];
}

export interface FlowSignal {
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
  programNet: number | null;
  foreignHoldRate: number | null;
  label: FlowLabel;
  reasons: string[];
}

export interface Signals {
  trend: {
    closeAboveMid: boolean;
    fastAboveMid: boolean;
    midSlopeUp: boolean;
    midAboveLong: boolean;
    breakout: boolean;
  };
  momentum: {
    rsi: number | null;
    rsiBand: "HIGH" | "MID" | "LOW";
    rsiUpN: boolean;
    closeAboveFast: boolean;
    returnNPositive: boolean;
    volumeAboveMa20: boolean;
    macd: number | null;
    macdSignal: number | null;
    macdHist: number | null;
    macdBullish: boolean;
  };
  risk: {
    atrPercent: number | null;
    atrBucket: "<=2" | "2~4" | "4~6" | ">6" | "N/A";
    bbPosition: "ABOVE_UPPER" | "INSIDE_BAND" | "BELOW_LOWER" | "N/A";
    mddN: number | null;
    sharpDropBar: boolean;
      breakdown: RiskBreakdown;
    };
  volumePatterns: VolumePatternSignal[];
  volume: {
    volRatio: number;
    turnover: number;
    bodyPct: number;
    upperWickPct: number;
    lowerWickPct: number;
    pos20: number;
    volumeScore: number;
    reasons: string[];
  };
  fundamental: FundamentalSignal;
  flow: FlowSignal;
}

export interface TimeframeAnalysis {
  tf: Timeframe;
  regime: Regime;
  summaryText: string;
  scores: Scores;
  profile: ProfileScore;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  tradePlan: TradePlan;
  indicators: IndicatorSeries;
  candles: Candle[];
}

export interface AnalysisPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    summaryText: string;
    tf: Timeframe;
    profile: InvestmentProfile;
  };
  scores: Scores;
  profile: ProfileScore;
  signals: Signals;
  reasons: string[];
  levels: IndicatorLevels;
  tradePlan: TradePlan;
  indicators: IndicatorSeries;
  candles: Candle[];
  regime: Regime;
}

export interface MultiAnalysisPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    profile: InvestmentProfile;
  };
  final: {
    overall: Overall;
    confidence: number;
    summary: string;
    profile: ProfileScore | null;
  };
  timeframes: {
    month: TimeframeAnalysis | null;
    week: TimeframeAnalysis | null;
    day: TimeframeAnalysis | null;
  };
  warnings: string[];
}

export type ScreenerMarketFilter = "KOSPI" | "KOSDAQ" | "ALL";
export type ScreenerStrategyFilter = "ALL" | "VOLUME" | "HS" | "IHS";
export type PatternState = "NONE" | "POTENTIAL" | "CONFIRMED";

export interface StrategyBacktestSummary {
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  PF: number | null;
  MDD: number | null;
}

export interface PatternHit {
  detected: boolean;
  state: PatternState;
  neckline: number | null;
  breakDate: string | null;
  target: number | null;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface VolumeHit {
  score: number;
  confidence: number;
  volRatio: number;
  patterns: VolumePatternType[];
  reasons: string[];
}

export interface ScreenerItem {
  code: string;
  name: string;
  market: string;
  lastClose: number;
  lastDate: string;
  scoreTotal: number;
  confidence: number;
  overallLabel: Overall;
  hits: {
    volume: VolumeHit;
    hs: PatternHit;
    ihs: PatternHit;
  };
  reasons: string[];
  levels: {
    support: number | null;
    resistance: number | null;
    neckline: number | null;
  };
  backtestSummary: StrategyBacktestSummary | null;
}

export interface ScreenerPayload {
  meta: {
    market: ScreenerMarketFilter;
    strategy: ScreenerStrategyFilter;
    count: number;
    universe: number;
    scanned: number;
    candidates: number;
    asOf: string;
    lastUpdatedAt: string | null;
    universeLabel: string;
    source: "KIS";
    cacheTtlSec: number;
    includeBacktest: boolean;
    rebuildRequired: boolean;
  };
  items: ScreenerItem[];
  warningItems: ScreenerItem[];
  warnings: string[];
}

export interface OhlcvPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    tf: Timeframe;
  };
  candles: Candle[];
}

export type BacktestOutcome = "WIN" | "LOSS" | "FLAT";
export type BacktestExitReason = "TARGET" | "STOP" | "TIMEOUT";

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  holdBars: number;
  returnPercent: number;
  rMultiple: number;
  outcome: BacktestOutcome;
  exitReason: BacktestExitReason;
}

export interface BacktestPeriodMetrics {
  label: string;
  bars: number;
  tradeCount: number;
  winRate: number | null;
  avgReturnPercent: number | null;
  avgRMultiple: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownPercent: number | null;
}

export interface BacktestSummary {
  tradeCount: number;
  winRate: number | null;
  avgReturnPercent: number | null;
  avgRMultiple: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownPercent: number | null;
}

export interface BacktestPayload {
  meta: {
    input: string;
    symbol: string;
    name: string;
    market: string;
    asOf: string;
    source: "KIS";
    cacheTtlSec: number;
    candleCount: number;
    holdBars: number;
    signalOverall: Overall;
    ruleId: string;
  };
  summary: BacktestSummary;
  periods: BacktestPeriodMetrics[];
  trades: BacktestTrade[];
  warnings: string[];
}
