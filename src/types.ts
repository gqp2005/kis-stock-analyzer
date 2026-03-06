export type Overall = "GOOD" | "NEUTRAL" | "CAUTION";
export type Timeframe = "month" | "week" | "day";
export type Regime = "UP" | "SIDE" | "DOWN";
export type InvestmentProfile = "short" | "mid";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
export type WashoutPullbackState =
  | "NONE"
  | "ANCHOR_DETECTED"
  | "WASHOUT_CANDIDATE"
  | "PULLBACK_READY"
  | "REBOUND_CONFIRMED";
export type StrategySignalState = "NONE" | "POTENTIAL" | "CONFIRMED";

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

export interface WashoutPullbackEntry {
  label: string;
  price: number;
}

export interface WashoutPullbackCard {
  id: "washout_pullback_v1";
  displayName: "거래대금 설거지 + 눌림목 전략";
  detected: boolean;
  state: WashoutPullbackState;
  score: number;
  confidence: number;
  anchorSpike: {
    date: string | null;
    priceHigh: number | null;
    priceClose: number | null;
    turnover: number | null;
    turnoverRatio: number | null;
  };
  washoutReentry: {
    date: string | null;
    price: number | null;
    turnoverRatio: number | null;
  };
  pullbackZone: {
    low: number | null;
    high: number | null;
  };
  entryPlan: {
    style: "분할매수";
    entries: WashoutPullbackEntry[];
    invalidLow: number | null;
  };
  statusSummary: string;
  reasons: string[];
  warnings: string[];
}

export interface WashoutPullbackOverlay {
  anchorSpike: {
    time: string | null;
    price: number | null;
    turnover: number | null;
    turnoverRatio: number | null;
    marker: "ANCHOR" | null;
  };
  washoutReentry: {
    time: string | null;
    price: number | null;
    turnoverRatio: number | null;
    marker: "REIN" | null;
  };
  pullbackZone: {
    timeStart: string | null;
    timeEnd: string | null;
    low: number | null;
    high: number | null;
    label: string;
    strength: number;
  };
  invalidLow: {
    price: number | null;
    label: string;
    style: "dashed-bold";
  };
  entryPlan: {
    entries: WashoutPullbackEntry[];
  };
}

export interface DarvasRetestCard {
  id: "darvas_retest_v1";
  displayName: "다르바스 박스 돌파-리테스트";
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  boxHigh: number | null;
  boxLow: number | null;
  boxWidthPct: number | null;
  breakoutDate: string | null;
  retestDate: string | null;
  triggerPrice: number | null;
  supportPrice: number | null;
  invalidationPrice: number | null;
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface Nr7InsideBarCard {
  id: "nr7_insidebar_v1";
  displayName: "NR7+인사이드바 변동성 수축 돌파";
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  setupDate: string | null;
  triggerHigh: number | null;
  triggerLow: number | null;
  breakoutDate: string | null;
  breakoutDirection: "UP" | "DOWN" | "NONE";
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface TrendTemplateCard {
  id: "trend_template_v1";
  displayName: "추세 템플릿 + RS 필터";
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;
  high52w: number | null;
  low52w: number | null;
  nearHigh52wPct: number | null;
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface RsiDivergenceCard {
  id: "rsi_divergence_v1";
  displayName: "RSI 다이버전스 + 넥라인 돌파";
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  low1Date: string | null;
  low2Date: string | null;
  low1Price: number | null;
  low2Price: number | null;
  rsiLow1: number | null;
  rsiLow2: number | null;
  neckline: number | null;
  breakoutDate: string | null;
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface FlowPersistenceCard {
  id: "flow_persistence_v1";
  displayName: "기관/외인 수급 지속성 추종";
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  upVolumeRatio20: number | null;
  obvSlope20: number | null;
  flowSignalUsed: boolean;
  foreignNet: number | null;
  institutionNet: number | null;
  programNet: number | null;
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface SimpleStrategyOverlay {
  markers: Array<{
    time: string | null;
    price: number | null;
    label: string;
    shape: "arrowUp" | "arrowDown" | "circle" | "square";
    color: string;
  }>;
  lines: Array<{
    price: number | null;
    label: string;
    style: "solid" | "dashed" | "dotted";
    color: string;
  }>;
}

export interface StrategyCards {
  washoutPullback: WashoutPullbackCard;
  darvasRetest?: DarvasRetestCard;
  nr7InsideBar?: Nr7InsideBarCard;
  trendTemplate?: TrendTemplateCard;
  rsiDivergence?: RsiDivergenceCard;
  flowPersistence?: FlowPersistenceCard;
}

export interface StrategyOverlays {
  washoutPullback: WashoutPullbackOverlay;
  darvasRetest?: SimpleStrategyOverlay;
  nr7InsideBar?: SimpleStrategyOverlay;
  trendTemplate?: SimpleStrategyOverlay;
  rsiDivergence?: SimpleStrategyOverlay;
  flowPersistence?: SimpleStrategyOverlay;
}

export type OverlayLineGroup = "level" | "zone";
export type OverlaySegmentKind =
  | "trendlineUp"
  | "trendlineDown"
  | "channelLow"
  | "channelHigh"
  | "fanlineUp"
  | "fanlineDown";
export type OverlayMarkerType =
  | VolumePatternType
  | "VCPPeak"
  | "VCPTrough"
  | "VCPBreakout"
  | "DarvasBreakout"
  | "DarvasRetest"
  | "NR7Setup"
  | "NR7Breakout"
  | "TrendTemplate"
  | "RsiDivLow1"
  | "RsiDivLow2"
  | "RsiDivBreakout"
  | "FlowPersistence";

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

export interface OverlayReliabilityLine {
  id: string;
  label: string;
  kind: OverlaySegmentKind;
  score: number;
  touches: number;
  breaks: number;
  lookback: number;
}

export interface OverlayRegimeItem {
  window: number;
  label: "장기" | "중기" | "단기";
  direction: Regime;
  score: number;
  lineId: string | null;
}

export interface OverlaySummary {
  reliability: {
    total: number;
    shown: number;
    hidden: number;
    averageScore: number;
    topLines: OverlayReliabilityLine[];
  };
  regime: {
    alignment: "UP" | "DOWN" | "MIXED";
    items: OverlayRegimeItem[];
  };
}

export interface Overlays {
  priceLines: OverlayPriceLine[];
  zones: OverlayZone[];
  segments: OverlaySegment[];
  markers: OverlayMarker[];
  summary?: OverlaySummary;
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
  levels: {
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
  };
  tradePlan: TradePlan;
  indicators: IndicatorSeries;
  strategyCards: StrategyCards;
  strategyOverlays: StrategyOverlays;
  overlays: Overlays;
  confluence: ConfluenceBand[];
  explanations: string[];
  candles: Candle[];
}

export interface MultiAnalysisResponse {
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

export interface AccountHolding {
  code: string;
  name: string;
  quantity: number;
  orderableQuantity: number | null;
  purchaseAvgPrice: number | null;
  currentPrice: number | null;
  purchaseAmount: number | null;
  evaluationAmount: number | null;
  profitAmount: number | null;
  profitRate: number | null;
  weightPercent: number | null;
}

export interface AccountResponse {
  meta: {
    asOf: string;
    source: "KIS";
    account: string;
    cacheTtlSec: number;
  };
  summary: {
    totalAssetAmount: number | null;
    totalEvaluationAmount: number | null;
    totalPurchaseAmount: number | null;
    totalProfitAmount: number | null;
    totalProfitRate: number | null;
    cashAmount: number | null;
  };
  holdings: AccountHolding[];
  warnings: string[];
}

export interface AccountDiagnosticsItem {
  code: string;
  name: string;
  quantity: number;
  currentPrice: number | null;
  purchaseAvgPrice: number | null;
  weightPercent: number | null;
  profitRate: number | null;
  overallLabel: Overall;
  confidence: number | null;
  support: number | null;
  resistance: number | null;
  action: "보유 유지" | "일부 차익 검토" | "손절 점검" | "관찰";
  tone: "positive" | "neutral" | "negative";
  riskNote: string;
  strategies: string[];
  coveredByScreener: boolean;
  reasons: string[];
}

export interface AccountDiagnosticsResponse {
  meta: {
    asOf: string;
    source: "KIS";
    lastUpdatedAt: string | null;
    snapshotDate: string | null;
    account: string;
  };
  summary: {
    holdingCount: number;
    keepCount: number;
    riskCount: number;
    uncoveredCount: number;
  };
  items: AccountDiagnosticsItem[];
  warnings: string[];
}

export type AutotradeMarketFilter = "ALL" | "KOSPI" | "KOSDAQ";
export type AutotradeCapitalMode = "FIXED" | "ACCOUNT_CASH";

export interface AutotradeCapitalConfig {
  mode: AutotradeCapitalMode;
  configuredCapitalWon: number | null;
  effectiveCapitalWon: number;
  availableCashWon: number | null;
  maxRiskPerTradeWon: number;
  maxDailyLossWon: number;
  maxPositionWon: number;
}

export interface AutotradeCandidate {
  code: string;
  name: string;
  market: string;
  state: WashoutPullbackState;
  entryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  qty: number;
  investedWon: number;
  riskWon: number;
  riskPct: number;
  score: number;
  confidence: number;
  triggerType: "A" | "B" | "C" | "N/A";
  currentPrice: number;
  positionToZone: WashoutZonePosition;
  reasons: string[];
  warnings: string[];
}

export interface AutotradeExecutionResult {
  code: string;
  name: string;
  side: "BUY" | "SELL";
  action:
    | "ENTRY"
    | "ENTRY_DRY_RUN"
    | "TARGET1_PARTIAL"
    | "TARGET2_EXIT"
    | "STOP_EXIT"
    | "TIME_EXIT"
    | "EXIT_FAILED";
  qty: number;
  success: boolean;
  orderNo: string | null;
  message: string;
  price: number;
  at: string;
}

export interface AutotradeOpenPosition {
  code: string;
  name: string;
  market: string;
  qty: number;
  avgEntryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  status: "OPEN" | "PLANNED" | "CLOSED";
  target1Hit: boolean;
  createdAt: string;
  lastUpdatedAt: string;
  entryDate: string;
  exitReason: "STOP" | "TARGET2" | "TIMEOUT" | null;
  closedAt: string | null;
  realizedPnlWon: number | null;
}

export interface AutotradeRunSummary {
  strategyId: string;
  capitalMode: AutotradeCapitalMode;
  capitalWon: number;
  configuredCapitalWon: number | null;
  availableCashWon: number | null;
  maxRiskPerTradeWon: number;
  maxDailyLossWon: number;
  maxPositionWon: number;
  maxConcurrentPositions: number;
  execute: boolean;
  dryRun: boolean;
  market: AutotradeMarketFilter;
  universeSize: number;
  sourceDate: string | null;
  dailyLossWon: number;
  blockedByDailyLoss: boolean;
  openPositionCount: number;
  executedCount: number;
  blockedReasons: string[];
}

export interface AutotradeResponse {
  ok: boolean;
  meta: {
    asOf: string;
    source: "KIS";
    strategyId: string;
    market: AutotradeMarketFilter;
    universeSize: number;
    execute: boolean;
    dryRun: boolean;
    accountMode: "모의" | "실전";
    storage: {
      kvEnabled: boolean;
    };
    capital: AutotradeCapitalConfig;
  };
  summary: AutotradeRunSummary;
  candidates: AutotradeCandidate[];
  executions: AutotradeExecutionResult[];
  positions: AutotradeOpenPosition[];
  warnings: string[];
  logs: string[];
}

export type TradeOrderState =
  | "IDLE"
  | "PRECHECK"
  | "ORDER_SUBMITTING"
  | "ORDER_ACCEPTED"
  | "WORKING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "POSITION_OPEN"
  | "EXIT_SUBMITTING"
  | "CLOSED"
  | "CANCEL_REQUESTED"
  | "CANCELED"
  | "ORDER_REJECTED";

export interface TradeCandidateCard {
  code: string;
  name: string;
  market: string;
  state: WashoutPullbackState;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  qty: number;
  maxLossWon: number;
  riskPct: number;
  reasons: string[];
  warnings: string[];
}

export interface TradeCandidatesResponse {
  ok: boolean;
  meta: {
    asOf: string;
    source: "KIS";
    market: AutotradeMarketFilter;
    universeSize: number;
    capital: AutotradeCapitalConfig;
  };
  summary: {
    capitalMode: AutotradeCapitalMode;
    capitalWon: number;
    configuredCapitalWon: number | null;
    availableCashWon: number | null;
    maxRiskPerTradeWon: number;
    maxDailyLossWon: number;
    maxPositionWon: number;
    dailyLossWon: number;
    blockedByDailyLoss: boolean;
    openPositionCount: number;
    strategyId: string;
    sourceDate: string | null;
  };
  candidates: TradeCandidateCard[];
  warnings: string[];
}

export interface TradeStateTransition {
  at: string;
  state: TradeOrderState;
  reason: string;
  summary?: string | null;
}

export interface TradeOrderResult {
  clientOrderId: string;
  code: string;
  name: string;
  state: TradeOrderState;
  orderNo: string | null;
  filledQty: number;
  orderedQty: number;
  remainingQty: number;
  avgFillPrice: number | null;
  positionOpened: boolean;
  canceled: boolean;
  rejected: boolean;
  message: string;
  transitions: TradeStateTransition[];
}

export interface TradeOrderResponse {
  ok: boolean;
  meta: {
    asOf: string;
    source: "KIS";
    market: AutotradeMarketFilter;
    universeSize: number;
    capital: AutotradeCapitalConfig;
    dryRun: boolean;
    autoExecute: boolean;
    useHashKey: boolean;
    retryOnce: boolean;
  };
  result: TradeOrderResult;
  warnings: string[];
  logs: string[];
}

export type ScreenerMarketFilter = "KOSPI" | "KOSDAQ" | "ALL";
export type ScreenerStrategyFilter =
  | "ALL"
  | "VOLUME"
  | "HS"
  | "IHS"
  | "VCP"
  | "WASHOUT_PULLBACK"
  | "DARVAS"
  | "NR7"
  | "TREND_TEMPLATE"
  | "RSI_DIVERGENCE"
  | "FLOW_PERSISTENCE";
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

export type WashoutZonePosition = "IN_ZONE" | "ABOVE_ZONE" | "BELOW_ZONE" | "N/A";

export interface WashoutPullbackHit {
  detected: boolean;
  state: WashoutPullbackState;
  score: number;
  confidence: number;
  anchorTurnoverRatio: number | null;
  reentryTurnoverRatio: number | null;
  pullbackZone: {
    low: number | null;
    high: number | null;
  };
  invalidPrice: number | null;
  riskPct: number | null;
  position: WashoutZonePosition;
  reasons: string[];
  warnings: string[];
}

export interface DarvasRetestHit {
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  boxHigh: number | null;
  boxLow: number | null;
  breakoutDate: string | null;
  retestDate: string | null;
  reasons: string[];
}

export interface Nr7InsideBarHit {
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  setupDate: string | null;
  triggerHigh: number | null;
  triggerLow: number | null;
  breakoutDate: string | null;
  breakoutDirection: "UP" | "DOWN" | "NONE";
  reasons: string[];
}

export interface TrendTemplateHit {
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  nearHigh52wPct: number | null;
  reasons: string[];
}

export interface RsiDivergenceHit {
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  neckline: number | null;
  breakoutDate: string | null;
  reasons: string[];
}

export interface FlowPersistenceHit {
  detected: boolean;
  state: StrategySignalState;
  score: number;
  confidence: number;
  upVolumeRatio20: number | null;
  obvSlope20: number | null;
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
    washoutPullback: WashoutPullbackHit;
    darvasRetest?: DarvasRetestHit;
    nr7InsideBar?: Nr7InsideBarHit;
    trendTemplate?: TrendTemplateHit;
    rsiDivergence?: RsiDivergenceHit;
    flowPersistence?: FlowPersistenceHit;
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

export interface ScreenerResponse {
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
    filters?: {
      washoutState: ScreenerWashoutStateFilter;
      washoutPosition: ScreenerWashoutPositionFilter;
      washoutRiskMax: number | null;
    };
  };
  items: ScreenerItem[];
  warningItems: ScreenerItem[];
  warnings: string[];
}

export interface DashboardFavoriteAlert {
  code: string;
  name: string;
  market: string;
  lastDate: string;
  lastClose: number;
  severity: "positive" | "neutral" | "warning";
  title: string;
  summary: string;
  reasons: string[];
}

export interface StrategyRankingItem {
  key: string;
  label: string;
  candidateCount: number;
  avgScore: number | null;
  avgConfidence: number | null;
  avgWinRate: number | null;
  avgPf: number | null;
  avgMdd: number | null;
  qualityScore: number | null;
  topSymbols: string[];
}

export interface StrategyTimelineEvent {
  date: string;
  code: string;
  name: string;
  market: string;
  strategyKey: string;
  strategyLabel: string;
  stateLabel: string;
  score: number;
  confidence: number | null;
  summary: string;
}

export interface DashboardOverviewResponse {
  meta: {
    asOf: string;
    lastUpdatedAt: string | null;
    snapshotDate: string | null;
    universeLabel: string;
    source: "KIS";
    candidateCount: number;
  };
  marketTemperature: {
    totalCandidates: number;
    avgScore: number | null;
    avgConfidence: number | null;
    strongCount: number;
    neutralCount: number;
    cautionCount: number;
    rsStrongCount: number;
    rsWeakCount: number;
    cupHandleCount: number;
    washoutCount: number;
    vcpCount: number;
    darvasCount: number;
    nr7Count: number;
    trendTemplateCount: number;
    rsiDivergenceCount: number;
    flowPersistenceCount: number;
    heatScore: number;
    heatLabel: "강세" | "중립" | "혼조" | "위축";
    summary: string;
  };
  strategyRanking: StrategyRankingItem[];
  timeline: StrategyTimelineEvent[];
  favorites: {
    trackedCount: number;
    activeCount: number;
    missingCodes: string[];
    alerts: DashboardFavoriteAlert[];
  };
  warnings: string[];
}

export type ScreenerWashoutStateFilter =
  | "ALL"
  | "ANCHOR_DETECTED"
  | "WASHOUT_CANDIDATE"
  | "PULLBACK_READY"
  | "REBOUND_CONFIRMED";

export type ScreenerWashoutPositionFilter = "ALL" | "IN_ZONE" | "ABOVE_ZONE" | "BELOW_ZONE";

export interface AdminRebuildStatusResponse {
  ok: boolean;
  inProgress: boolean;
  date: string;
  storage?: {
    backend: "kv" | "d1" | "none";
    runtimeBackend: "cache" | "d1";
    enabled: boolean;
    snapshotSource: "cache" | "kv" | "d1" | "none";
  };
  lock: {
    exists: boolean;
    startedAt: string | null;
    ageSec: number | null;
    stale: boolean;
    staleAfterSec: number;
    ttlSec: number;
  };
  progress: {
    processed: number;
    total: number;
    remaining: number;
    processedCount: number;
    ohlcvFailures: number;
    insufficientData: number;
    failedCount: number;
    failedItems: Array<{
      code: string;
      name: string;
      market: string;
      reason: string;
      retries: number;
      at: string;
    }>;
    retryStats: {
      totalRetries: number;
      retriedSymbols: number;
      maxRetryPerSymbol: number;
    };
    lastBatch: {
      from: number;
      to: number;
      batchSize: number;
    } | null;
    startedAt: string;
    updatedAt: string;
  } | null;
  snapshot: {
    date: string;
    updatedAt: string;
    universeCount: number;
    processedCount: number;
    candidateCount: number;
    topStored: number;
    warnings: string[];
    changeSummary: ScreenerResponse["meta"]["changeSummary"] | null;
    rsSummary: ScreenerResponse["meta"]["rsSummary"] | null;
    tuningSummary: ScreenerResponse["meta"]["tuningSummary"] | null;
    validationSummary: ScreenerResponse["meta"]["validationSummary"] | null;
    rebuildMeta: {
      durationMs: number;
      batchSize: number;
      kisCalls: number;
      ohlcvFailures: number;
      insufficientData: number;
      failedItems: Array<{
        code: string;
        name: string;
        market: string;
        reason: string;
        retries: number;
        at: string;
      }>;
      retryStats: {
        totalRetries: number;
        retriedSymbols: number;
        maxRetryPerSymbol: number;
      };
    } | null;
  } | null;
  message: string;
}

export interface AdminRebuildHistoryResponse {
  ok: boolean;
  backend: "kv" | "d1" | "none";
  limit: number;
  changes: Array<{
    date: string;
    updatedAt: string | null;
    changeSummary: ScreenerResponse["meta"]["changeSummary"] | null;
    alertsMeta: ScreenerResponse["meta"]["alertsMeta"] | null;
    validationSummary?: ScreenerResponse["meta"]["validationSummary"] | null;
  }>;
  failures: Array<{
    date: string;
    updatedAt: string | null;
    failedItems: Array<{
      code: string;
      name: string;
      market: string;
      reason: string;
      retries: number;
      at: string;
    }>;
    retryStats: {
      totalRetries: number;
      retriedSymbols: number;
      maxRetryPerSymbol: number;
    } | null;
  }>;
  alerts: {
    updatedAt: string | null;
    count: number;
  };
  message?: string;
}

export type BacktestOutcome = "WIN" | "LOSS" | "FLAT";
export type BacktestExitReason = "TARGET" | "STOP" | "TIMEOUT";
export type BacktestRuleId =
  | "score-card-v1-day-overall"
  | "washout-pullback-v1"
  | "washout-pullback-v1.1";
export type BacktestWashoutTargetMode = "2R" | "3R" | "ANCHOR_HIGH";
export type BacktestWashoutExitMode = "PARTIAL" | "SINGLE_2R";

export interface BacktestTradeEntry {
  label: string;
  time: string;
  price: number;
  weight: number;
}

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
  entries?: BacktestTradeEntry[];
  avgEntry?: number | null;
  invalidLow?: number | null;
  r?: number;
  tranchesFilled?: number;
  partialExited?: boolean;
  target2Reached?: boolean;
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

export interface BacktestStrategyMetrics {
  avgTranchesFilled: number | null;
  fillRate1: number | null;
  fillRate2: number | null;
  fillRate3: number | null;
  partialExitRate: number | null;
  target2HitRate: number | null;
}

export interface BacktestResponse {
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
    ruleId: BacktestRuleId;
    targetMode?: BacktestWashoutTargetMode;
    exitMode?: BacktestWashoutExitMode;
  };
  summary: BacktestSummary;
  periods: BacktestPeriodMetrics[];
  trades: BacktestTrade[];
  strategyMetrics?: BacktestStrategyMetrics | null;
  warnings: string[];
}
