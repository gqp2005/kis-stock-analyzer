import { fetchAccountSnapshot } from "../lib/accountSnapshot";
import { loadLatestScreenerSnapshot } from "../lib/dashboard";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { json, serverError, badRequest } from "../lib/response";
import type { Env } from "../lib/types";
import type { ScreenerStoredCandidate } from "../lib/screener";

const round = (value: number | null): number | null =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;

const buildAction = (
  holding: {
    profitRate: number | null;
    currentPrice: number | null;
    weightPercent: number | null;
  },
  candidate: ScreenerStoredCandidate | null,
): {
  action: "보유 유지" | "일부 차익 검토" | "손절 점검" | "관찰";
  tone: "positive" | "neutral" | "negative";
  note: string;
} => {
  const profitRate = holding.profitRate ?? 0;
  const currentPrice = holding.currentPrice;
  const support = candidate?.levels.support ?? null;
  const resistance = candidate?.levels.resistance ?? null;

  if (candidate?.hits.hs.state === "CONFIRMED") {
    return {
      action: "손절 점검",
      tone: "negative",
      note: "하락 패턴 경고가 있어 보유 논리를 다시 점검해야 합니다.",
    };
  }
  if (
    profitRate >= 10 &&
    currentPrice != null &&
    resistance != null &&
    currentPrice >= resistance * 0.98
  ) {
    return {
      action: "일부 차익 검토",
      tone: "neutral",
      note: "수익 구간이며 저항 접근 상태라 일부 차익 실현을 검토할 수 있습니다.",
    };
  }
  if (
    profitRate <= -5 ||
    (support != null && currentPrice != null && currentPrice < support * 0.99)
  ) {
    return {
      action: "손절 점검",
      tone: "negative",
      note: "손실 확대 또는 핵심 지지 이탈이 나타나 방어적 점검이 필요합니다.",
    };
  }
  if ((candidate?.scoring.all.score ?? 0) >= 70 && (candidate?.scoring.all.confidence ?? 0) >= 65) {
    return {
      action: "보유 유지",
      tone: "positive",
      note: "점수와 신뢰도가 유지돼 추세 보유 논리가 아직 살아 있습니다.",
    };
  }
  return {
    action: "관찰",
    tone: "neutral",
    note: "명확한 강화 신호와 경계 신호가 혼재해 관찰 우선이 적절합니다.",
  };
};

const strategyLabels = (candidate: ScreenerStoredCandidate | null): string[] => {
  if (!candidate) return [];
  const labels: string[] = [];
  if (candidate.hits.washoutPullback.detected && candidate.hits.washoutPullback.state !== "NONE") {
    labels.push("설거지+눌림목");
  }
  if (candidate.hits.cupHandle.detected || candidate.hits.cupHandle.state !== "NONE") {
    labels.push("컵앤핸들");
  }
  if (candidate.hits.vcp.detected && candidate.hits.vcp.state !== "NONE") labels.push("VCP");
  if (candidate.hits.darvasRetest.detected) labels.push("다르바스");
  if (candidate.hits.nr7InsideBar.detected) labels.push("NR7");
  if (candidate.hits.trendTemplate.detected) labels.push("추세 템플릿");
  if (candidate.hits.rsiDivergence.detected) labels.push("RSI 다이버전스");
  if (candidate.hits.flowPersistence.detected) labels.push("수급 지속성");
  return labels.slice(0, 4);
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    if (!(context.env.KIS_ACCOUNT_NO ?? "").trim()) {
      return finalize(
        badRequest("계좌 진단을 위해 KIS_ACCOUNT_NO 환경변수가 필요합니다.", context.request),
      );
    }

    const cache = await caches.open("kis-analyzer-cache-v3");
    const [account, snapshotBundle] = await Promise.all([
      fetchAccountSnapshot(context.env, metrics),
      loadLatestScreenerSnapshot(context.env, cache),
    ]);
    const candidates = snapshotBundle.snapshot?.candidates ?? [];

    const items = account.holdings.map((holding) => {
      const matched = candidates.find((candidate) => candidate.code === holding.code) ?? null;
      const action = buildAction(holding, matched);
      const support = matched?.levels.support ?? null;
      const resistance = matched?.levels.resistance ?? null;
      const reasons = matched
        ? [...matched.reasons.all.slice(0, 2), action.note]
        : [action.note, "거래대금 상위 500 스냅샷 밖 종목이라 상세 전략 데이터가 제한적입니다."];
      return {
        code: holding.code,
        name: holding.name,
        quantity: holding.quantity,
        currentPrice: holding.currentPrice,
        purchaseAvgPrice: holding.purchaseAvgPrice,
        weightPercent: holding.weightPercent,
        profitRate: holding.profitRate,
        overallLabel:
          matched == null ? "NEUTRAL" : matched.scoring.all.score >= 70 ? "GOOD" : matched.scoring.all.score >= 45 ? "NEUTRAL" : "CAUTION",
        confidence: matched?.scoring.all.confidence ?? null,
        support,
        resistance,
        action: action.action,
        tone: action.tone,
        riskNote:
          support != null && holding.currentPrice != null
            ? `${round(((holding.currentPrice - support) / holding.currentPrice) * 100) ?? 0}% 하단에 핵심 지지가 있습니다.`
            : "핵심 지지/저항 데이터가 부족합니다.",
        strategies: strategyLabels(matched),
        coveredByScreener: matched != null,
        reasons: reasons.slice(0, 4),
      };
    });

    const riskCount = items.filter((item) => item.tone === "negative").length;
    const keepCount = items.filter((item) => item.tone === "positive").length;

    return finalize(
      json(
        {
          meta: {
            asOf: account.meta.asOf,
            source: "KIS",
            lastUpdatedAt: snapshotBundle.snapshot?.updatedAt ?? null,
            snapshotDate: snapshotBundle.snapshot?.date ?? null,
            account: account.meta.account,
          },
          summary: {
            holdingCount: items.length,
            keepCount,
            riskCount,
            uncoveredCount: items.filter((item) => !item.coveredByScreener).length,
          },
          items,
          warnings: [...account.warnings, ...snapshotBundle.warnings],
        },
        200,
        {
          "cache-control": "no-store",
        },
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "account diagnostics error";
    return finalize(serverError(message, context.request));
  }
};
