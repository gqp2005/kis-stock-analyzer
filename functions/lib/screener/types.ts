import type {
  Candle,
  CupHandleHit,
  DarvasRetestHit,
  FlowPersistenceHit,
  Nr7InsideBarHit,
  PatternHit,
  RsiDivergenceHit,
  StrategyBacktestSummary,
  TrendTemplateHit,
  VcpHit,
  VolumeHit,
  WangStrategyScreeningSummary,
  WashoutPullbackHit,
} from "../types";
import type { StrategyThresholds } from "../walkforward";

export interface ScreenerUniverseEntry {
  code: string;
  name: string;
  market: string;
}

export interface ScreenerBenchmarkInput {
  index: "KOSPI" | "KOSDAQ";
  candles: Candle[];
}

export type ScreenerBenchmarkMap = Partial<
  Record<"KOSPI" | "KOSDAQ", ScreenerBenchmarkInput>
>;

export interface ScreenerStoredCandidate {
  code: string;
  name: string;
  market: string;
  lastClose: number;
  lastDate: string;
  levels: {
    support: number | null;
    resistance: number | null;
    neckline: number | null;
  };
  hits: {
    volume: VolumeHit;
    hs: PatternHit;
    ihs: PatternHit;
    vcp: VcpHit;
    cupHandle: CupHandleHit;
    washoutPullback: WashoutPullbackHit;
    darvasRetest: DarvasRetestHit;
    nr7InsideBar: Nr7InsideBarHit;
    trendTemplate: TrendTemplateHit;
    rsiDivergence: RsiDivergenceHit;
    flowPersistence: FlowPersistenceHit;
  };
  scoring: {
    all: { score: number; confidence: number };
    volume: { score: number; confidence: number };
    hs: { score: number; confidence: number };
    ihs: { score: number; confidence: number };
    vcp: { score: number; confidence: number };
    washoutPullback: { score: number; confidence: number };
    darvasRetest: { score: number; confidence: number };
    nr7InsideBar: { score: number; confidence: number };
    trendTemplate: { score: number; confidence: number };
    rsiDivergence: { score: number; confidence: number };
    flowPersistence: { score: number; confidence: number };
  };
  reasons: {
    all: string[];
    volume: string[];
    hs: string[];
    ihs: string[];
    vcp: string[];
    washoutPullback: string[];
    darvasRetest: string[];
    nr7InsideBar: string[];
    trendTemplate: string[];
    rsiDivergence: string[];
    flowPersistence: string[];
  };
  backtestSummary: {
    all: StrategyBacktestSummary | null;
    volume: StrategyBacktestSummary | null;
    hs: StrategyBacktestSummary | null;
    ihs: StrategyBacktestSummary | null;
    vcp: StrategyBacktestSummary | null;
    washoutPullback: StrategyBacktestSummary | null;
    darvasRetest: StrategyBacktestSummary | null;
    nr7InsideBar: StrategyBacktestSummary | null;
    trendTemplate: StrategyBacktestSummary | null;
    rsiDivergence: StrategyBacktestSummary | null;
    flowPersistence: StrategyBacktestSummary | null;
  };
  rs: {
    benchmark: "KOSPI" | "KOSDAQ";
    ret63Diff: number | null;
    label: "STRONG" | "NEUTRAL" | "WEAK" | "N/A";
  };
  wangStrategy: WangStrategyScreeningSummary;
  tuning: {
    thresholds: StrategyThresholds;
    quality: number | null;
  } | null;
}
