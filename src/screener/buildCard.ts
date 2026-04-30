import type {
  ScreenerBooleanFilter,
  ScreenerItem,
  ScreenerStrategyFilter,
  ScreenerWangActionBiasFilter,
  ScreenerWangPhaseFilter,
} from "../types";
import { formatPrice } from "../format";
import {
  type ScreenerVerdict,
  type SortKey,
  cupHandleStateLabel,
  dryUpStrengthLabel,
  formatDepth,
  formatMultiple,
  formatRiskPercent,
  formatScore,
  formatSignedPercent,
  formatSignedRatioPercent,
  leadershipLabel,
  rsStrengthLabel,
  washoutPositionLabel,
  washoutStateLabel,
  washoutStatePriority,
} from "./labels";

export interface ScreenerCompactItem {
  label: string;
  value: string;
}

export type WangFilterState = {
  wangEligible: ScreenerBooleanFilter;
  wangActionBias: ScreenerWangActionBiasFilter;
  wangPhase: ScreenerWangPhaseFilter;
  wangZoneReady: ScreenerBooleanFilter;
  wangMa20DiscountReady: ScreenerBooleanFilter;
};

export type WangPresetId =
  | "ACCUMULATE"
  | "REACCUMULATION"
  | "MIN_VOLUME"
  | "ZONE_READY"
  | "MA20_DISCOUNT"
  | "CLEAR";

export const WANG_FILTER_DEFAULTS: WangFilterState = {
  wangEligible: "ALL",
  wangActionBias: "ALL",
  wangPhase: "ALL",
  wangZoneReady: "ALL",
  wangMa20DiscountReady: "ALL",
};

export const WANG_PRESETS: Array<{
  id: WangPresetId;
  label: string;
  summary: string;
  filters: WangFilterState;
  sortKey: SortKey;
}> = [
  {
    id: "ACCUMULATE",
    label: "적립 후보",
    summary: "적합도 YES + 적립 바이어스",
    filters: {
      ...WANG_FILTER_DEFAULTS,
      wangEligible: "YES",
      wangActionBias: "ACCUMULATE",
    },
    sortKey: "WANG_SCORE",
  },
  {
    id: "REACCUMULATION",
    label: "재축적",
    summary: "주봉 재축적 phase",
    filters: {
      ...WANG_FILTER_DEFAULTS,
      wangPhase: "REACCUMULATION",
    },
    sortKey: "WANG_SCORE",
  },
  {
    id: "MIN_VOLUME",
    label: "최소거래량",
    summary: "최소거래량 phase",
    filters: {
      ...WANG_FILTER_DEFAULTS,
      wangPhase: "MIN_VOLUME",
    },
    sortKey: "WANG_SCORE",
  },
  {
    id: "ZONE_READY",
    label: "Zone Ready",
    summary: "zone 진입 준비 완료",
    filters: {
      ...WANG_FILTER_DEFAULTS,
      wangZoneReady: "YES",
    },
    sortKey: "WANG_SCORE",
  },
  {
    id: "MA20_DISCOUNT",
    label: "MA20 할인",
    summary: "20일선 이하 할인 구간",
    filters: {
      ...WANG_FILTER_DEFAULTS,
      wangMa20DiscountReady: "YES",
    },
    sortKey: "WANG_SCORE",
  },
  {
    id: "CLEAR",
    label: "왕장군 해제",
    summary: "왕장군 필터 초기화",
    filters: WANG_FILTER_DEFAULTS,
    sortKey: "SCORE",
  },
];

export const buildCardOneLiner = (
  item: ScreenerItem,
  strategy: ScreenerStrategyFilter,
): { verdict: ScreenerVerdict; text: string } => {
  if (strategy === "WASHOUT_PULLBACK") {
    const hit = item.hits.washoutPullback;
    if (hit.state === "REBOUND_CONFIRMED" && (hit.riskPct ?? 1) <= 0.1) {
      return {
        verdict: "매수 검토",
        text: "반등 확인 단계이며 리스크가 관리 가능한 수준이라 분할 접근 후보로 볼 수 있습니다.",
      };
    }
    if (hit.state === "PULLBACK_READY") {
      return {
        verdict: "관망",
        text: "눌림 준비 구간으로 존 방어와 거래대금 재유입을 추가 확인한 뒤 대응이 유리합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "설거지 구조 확증이 약하거나 리스크가 커서 보수적 대응이 필요합니다.",
    };
  }

  if (strategy === "VCP") {
    if (item.hits.vcp.state === "CONFIRMED" && item.hits.vcp.score >= 88) {
      return {
        verdict: "매수 검토",
        text: "VCP 확정 신호와 점수 우위가 확인되어 손절 기준 하 조건부 접근을 검토할 수 있습니다.",
      };
    }
    if (item.hits.vcp.detected) {
      return {
        verdict: "관망",
        text: "VCP 후보 단계로 저항 돌파와 거래량 확증 전까지 대기 전략이 안전합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "VCP 근거가 약해 추격 진입보다 신호 누적을 기다리는 편이 좋습니다.",
    };
  }

  if (strategy === "DARVAS") {
    const hit = item.hits.darvasRetest;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "다르바스 돌파-리테스트 확정 상태로 지지 유지 시나리오를 우선 볼 수 있습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "다르바스 후보 구간으로 리테스트 지지 확인 전까지는 대기가 유리합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "다르바스 조건이 약해 추격 진입보다 관찰 우선이 적절합니다.",
    };
  }

  if (strategy === "NR7") {
    const hit = item.hits.nr7InsideBar;
    if (hit?.state === "CONFIRMED" && hit.breakoutDirection === "UP") {
      return {
        verdict: "매수 검토",
        text: "NR7 수축 후 상방 돌파가 확인되어 단기 모멘텀 우위가 나타났습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "NR7 세팅은 형성됐지만 방향성 돌파 확증이 필요합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "NR7 신호가 약하거나 하방 이탈 이력이 있어 보수적 대응이 필요합니다.",
    };
  }

  if (strategy === "TREND_TEMPLATE") {
    const hit = item.hits.trendTemplate;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "장기 정배열 템플릿이 충족되어 추세 추종 후보로 해석할 수 있습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "추세 템플릿 일부 충족 상태라 추가 정렬 확인이 필요합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "추세 템플릿 근거가 약해 단기 신호보다 장기 정렬 확인이 우선입니다.",
    };
  }

  if (strategy === "RSI_DIVERGENCE") {
    const hit = item.hits.rsiDivergence;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "RSI 다이버전스 확정으로 반등 시나리오 우위가 강화됐습니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "다이버전스 후보 단계라 넥라인 돌파 확증을 먼저 확인해야 합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "다이버전스 근거가 약해 반등 매매의 우선순위가 낮습니다.",
    };
  }

  if (strategy === "FLOW_PERSISTENCE") {
    const hit = item.hits.flowPersistence;
    if (hit?.state === "CONFIRMED") {
      return {
        verdict: "매수 검토",
        text: "수급 지속성 확정 신호로 추세 유지 관점의 조건부 접근이 가능합니다.",
      };
    }
    if (hit?.state === "POTENTIAL") {
      return {
        verdict: "관망",
        text: "수급 지속성 후보 단계로 거래량/가격 동시 확증을 더 기다려야 합니다.",
      };
    }
    return {
      verdict: "비중 축소",
      text: "수급 지속성 신호가 약해 관망 또는 비중 축소 대응이 유리합니다.",
    };
  }

  if (item.overallLabel === "GOOD" && item.confidence >= 65 && item.hits.hs.state !== "CONFIRMED") {
    return {
      verdict: "매수 검토",
      text: "점수/신뢰도 조합이 양호해 지지 확인 시 분할 진입을 검토할 수 있습니다.",
    };
  }
  if (item.overallLabel === "CAUTION" || item.hits.hs.state === "CONFIRMED") {
    return {
      verdict: "비중 축소",
      text: "주의 또는 하락 패턴 신호가 있어 신규 진입보다 방어적 대응이 우선입니다.",
    };
  }
  return {
    verdict: "관망",
    text: "신호가 혼조 구간이라 명확한 돌파/지지 확증이 나오기 전까지 대기가 유리합니다.",
  };
};

export const buildCompactItems = (
  item: ScreenerItem,
  strategy: ScreenerStrategyFilter,
): ScreenerCompactItem[] => {
  if (strategy === "WASHOUT_PULLBACK") {
    return [
      { label: "Anchor", value: formatMultiple(item.hits.washoutPullback.anchorTurnoverRatio) },
      { label: "재유입", value: formatMultiple(item.hits.washoutPullback.reentryTurnoverRatio) },
      {
        label: "눌림 존",
        value: `${formatPrice(item.hits.washoutPullback.pullbackZone.low)} ~ ${formatPrice(item.hits.washoutPullback.pullbackZone.high)}`,
      },
      {
        label: "현재 위치",
        value: `${washoutPositionLabel(item.hits.washoutPullback.position)} / ${formatRiskPercent(item.hits.washoutPullback.riskPct)}`,
      },
    ];
  }

  if (strategy === "VCP") {
    return [
      {
        label: "R-zone",
        value: `${formatPrice(item.hits.vcp.resistance.zoneLow)} ~ ${formatPrice(item.hits.vcp.resistance.zoneHigh)}`,
      },
      {
        label: "컨트랙션",
        value:
          item.hits.vcp.contractions.length > 0
            ? `${item.hits.vcp.contractions.length}회 / ${item.hits.vcp.contractions
                .map((contraction) => formatDepth(contraction.depth))
                .join(" → ")}`
            : "없음",
      },
      {
        label: "거래량 수축",
        value: `${dryUpStrengthLabel(item.hits.vcp.volume.dryUpStrength)} / ${
          item.hits.vcp.volume.volRatioAvg10 != null ? `${item.hits.vcp.volume.volRatioAvg10.toFixed(2)}배` : "-"
        }`,
      },
      {
        label: "리더십",
        value: `${leadershipLabel(item.hits.vcp.leadership.label)} / ${formatSignedPercent(
          item.hits.vcp.leadership.ret63 != null ? item.hits.vcp.leadership.ret63 * 100 : null,
        )}`,
      },
    ];
  }

  return [
    { label: "RS", value: `${rsStrengthLabel(item.rs.label)} / ${formatSignedRatioPercent(item.rs.ret63Diff)}` },
    { label: "거래량", value: `${formatScore(item.hits.volume.score)} / ${item.hits.volume.confidence}` },
    {
      label: "컵앤핸들",
      value: `${cupHandleStateLabel(item.hits.cupHandle.state)} / ${item.hits.cupHandle.score}`,
    },
    {
      label: "설거지+눌림",
      value: `${washoutStateLabel(item.hits.washoutPullback.state)} / ${item.hits.washoutPullback.score}`,
    },
  ];
};

export const sortItems = (
  items: ScreenerItem[],
  sortKey: SortKey,
  strategy: ScreenerStrategyFilter,
): ScreenerItem[] => {
  const cloned = [...items];
  if (strategy === "WASHOUT_PULLBACK") {
    return cloned.sort((a, b) => {
      const stateDiff =
        washoutStatePriority(b.hits.washoutPullback.state) -
        washoutStatePriority(a.hits.washoutPullback.state);
      if (stateDiff !== 0) return stateDiff;
      if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const ar = a.hits.washoutPullback.riskPct ?? Number.POSITIVE_INFINITY;
      const br = b.hits.washoutPullback.riskPct ?? Number.POSITIVE_INFINITY;
      return ar - br;
    });
  }
  if (sortKey === "CONFIDENCE") {
    return cloned.sort((a, b) => b.confidence - a.confidence || b.scoreTotal - a.scoreTotal);
  }
  if (sortKey === "WANG_SCORE") {
    return cloned.sort(
      (a, b) =>
        b.wangStrategy.score - a.wangStrategy.score ||
        b.wangStrategy.confidence - a.wangStrategy.confidence ||
        b.scoreTotal - a.scoreTotal,
    );
  }
  if (sortKey === "WANG_CONFIDENCE") {
    return cloned.sort(
      (a, b) =>
        b.wangStrategy.confidence - a.wangStrategy.confidence ||
        b.wangStrategy.score - a.wangStrategy.score ||
        b.scoreTotal - a.scoreTotal,
    );
  }
  if (sortKey === "BACKTEST") {
    return cloned.sort((a, b) => {
      const ar = a.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      const br = b.backtestSummary?.avgReturn ?? Number.NEGATIVE_INFINITY;
      if (br !== ar) return br - ar;
      return b.scoreTotal - a.scoreTotal;
    });
  }
  return cloned.sort((a, b) => b.scoreTotal - a.scoreTotal || b.confidence - a.confidence);
};
