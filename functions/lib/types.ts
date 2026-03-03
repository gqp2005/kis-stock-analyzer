export interface Env {
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_BASE_URL?: string;
  KIS_ENV?: "real" | "demo";
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_SEC?: string;
  ADMIN_TOKEN?: string;
  KIS_KV?: KVNamespace;
  SCREENER_AUTO_BOOTSTRAP?: string;
  SCREENER_AUTO_BOOTSTRAP_BATCH?: string;
  SCREENER_KV?: KVNamespace;
  SCREENER_DB?: D1Database;
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

export type OverlayLineGroup = "level" | "zone";
export type OverlaySegmentKind =
  | "trendlineUp"
  | "trendlineDown"
  | "channelLow"
  | "channelHigh"
  | "fanlineUp"
  | "fanlineDown";
export type OverlayMarkerType = VolumePatternType | "VCPPeak" | "VCPTrough" | "VCPBreakout";

export interface OverlayPriceLine {
  id: string;
  group: OverlayLineGroup;
  price: number;
  label: string;
  color?: string;
}

export interface OverlayZone {
  id: string;
  kind: "support" | "resistance";
  low: number;
  high: number;
  strength: number;
  touches: number;
  reason: string;
}

export interface OverlaySegment {
  id: string;
  kind: OverlaySegmentKind;
  t1: string;
  p1: number;
  t2: string;
  p2: number;
  label: string;
  score: number;
}

export interface OverlayMarker {
  id: string;
  t: string;
  type: OverlayMarkerType;
  label: string;
  desc: string;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text: string;
  color: string;
  strength?: number;
}

export interface Overlays {
  priceLines: OverlayPriceLine[];
  zones: OverlayZone[];
  segments: OverlaySegment[];
  markers: OverlayMarker[];
}

export interface ConfluenceBand {
  bandLow: number;
  bandHigh: number;
  strength: number;
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
  cupHandle: {
    detected: boolean;
    state: "NONE" | "POTENTIAL" | "CONFIRMED";
    score: number;
    neckline: number | null;
    breakout: boolean;
    cupDepthPct: number | null;
    handleDepthPct: number | null;
    cupWidthBars: number | null;
    handleBars: number | null;
    reasons: string[];
  };
  vcp: VcpHit;
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
  overlays: Overlays;
  confluence: ConfluenceBand[];
  explanations: string[];
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
  overlays: Overlays;
  confluence: ConfluenceBand[];
  explanations: string[];
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
export type ScreenerStrategyFilter = "ALL" | "VOLUME" | "HS" | "IHS" | "VCP";
export type PatternState = "NONE" | "POTENTIAL" | "CONFIRMED";

export interface VcpContraction {
  peakTime: string;
  troughTime: string;
  peak: number;
  trough: number;
  depth: number;
  durationBars: number;
}

export type VcpLeadershipLabel = "STRONG" | "OK" | "WEAK";
export type VcpPivotLabel =
  | "NONE"
  | "PIVOT_READY"
  | "PIVOT_NEAR_52W"
  | "PIVOT_52W_BREAK"
  | "BREAKOUT_CONFIRMED";
export type VcpRiskGrade = "N/A" | "OK" | "HIGH" | "BAD";

export interface VcpHit {
  detected: boolean;
  state: PatternState;
  score: number;
  resistance: {
    price: number | null;
    zoneLow: number | null;
    zoneHigh: number | null;
    touches: number;
  };
  distanceToR: number | null;
  breakDate: string | null;
  contractions: VcpContraction[];
  atr: {
    atrPct20: number | null;
    atrPct120: number | null;
    shrink: boolean;
  };
  leadership: {
    label: VcpLeadershipLabel;
    ret63: number | null;
    ret126: number | null;
  };
  pivot: {
    label: VcpPivotLabel;
    nearHigh52: boolean;
    newHigh52: boolean;
    pivotReady: boolean;
  };
  volume: {
    dryUp: boolean;
    dryUpStrength: "NONE" | "WEAK" | "STRONG";
    volRatioLast: number | null;
    volRatioAvg10: number | null;
  };
  rs: {
    index: "KOSPI" | "KOSDAQ";
    ok: boolean;
    rsVsMa90: boolean;
    rsRet63: number | null;
  };
  risk: {
    invalidLow: number | null;
    entryRef: number | null;
    riskPct: number | null;
    riskGrade: VcpRiskGrade;
  };
  breakout: {
    confirmed: boolean;
    rule: string;
  };
  trendPass: boolean;
  quality: {
    baseWidthOk: boolean;
    depthShrinkOk: boolean;
    durationOk: boolean;
    baseSpanBars: number | null;
    baseLenOk: boolean;
    baseDepthMax: number | null;
    gapCrashFlags: number;
  };
  reasons: string[];
}

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

export interface CupHandleHit {
  detected: boolean;
  state: PatternState;
  score: number;
  neckline: number | null;
  breakout: boolean;
  cupDepthPct: number | null;
  handleDepthPct: number | null;
  cupWidthBars: number | null;
  handleBars: number | null;
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
    vcp: VcpHit;
    cupHandle: CupHandleHit;
  };
  reasons: string[];
  levels: {
    support: number | null;
    resistance: number | null;
    neckline: number | null;
  };
  backtestSummary: StrategyBacktestSummary | null;
  rs: {
    benchmark: "KOSPI" | "KOSDAQ";
    ret63Diff: number | null;
    label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A";
  };
  tuning: {
    thresholds: {
      volume: number;
      hs: number;
      ihs: number;
      vcp: number;
    };
    quality: number | null;
  } | null;
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
    changeSummary?: {
      basisTopN: number;
      added: Array<{
        code: string;
        name: string;
        currRank: number | null;
        currScore: number | null;
      }>;
      removed: Array<{
        code: string;
        name: string;
        prevRank: number | null;
        prevScore: number | null;
      }>;
      risers: Array<{
        code: string;
        name: string;
        prevRank: number | null;
        currRank: number | null;
        deltaRank: number | null;
      }>;
      fallers: Array<{
        code: string;
        name: string;
        prevRank: number | null;
        currRank: number | null;
        deltaRank: number | null;
      }>;
      scoreRisers: Array<{
        code: string;
        name: string;
        prevScore: number | null;
        currScore: number | null;
        scoreDelta: number | null;
      }>;
      scoreFallers: Array<{
        code: string;
        name: string;
        prevScore: number | null;
        currScore: number | null;
        scoreDelta: number | null;
      }>;
    } | null;
    rsSummary?: {
      enabled: boolean;
      benchmarkMarkets: string[];
      matched: number;
      weak: number;
      missing: number;
    } | null;
    tuningSummary?: {
      enabled: boolean;
      sampleCount: number;
      avgThresholds: {
        volume: number;
        hs: number;
        ihs: number;
        vcp: number;
      } | null;
    } | null;
    validationSummary?: {
      updatedAt: string;
      lastWeeklyAt: string | null;
      lastMonthlyAt: string | null;
      activeCutoffs: {
        all: number;
        volume: number;
        hs: number;
        ihs: number;
        vcp: number;
      };
      latestRuns: {
        weekly: {
          period: "weekly";
          generatedAt: string;
          sampleCount: number;
        } | null;
        monthly: {
          period: "monthly";
          generatedAt: string;
          sampleCount: number;
        } | null;
      };
    } | null;
    alertsMeta?: {
      cooldownDays: number;
      minScore: number;
      minRankDelta: number;
      topN: number;
      sentCount: number;
      skippedCount: number;
    } | null;
    lastRebuildStatus?: {
      inProgress: boolean;
      processed: number;
      total: number;
      updatedAt: string | null;
      failedCount: number;
      retriedSymbols: number;
      totalRetries: number;
    } | null;
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
