import { listPersistedByPrefix, putPersistedJson } from "./screenerPersistence";
import type { AccountSnapshotPayload } from "./accountSnapshot";
import type { Env } from "./types";
import { round2 } from "./utils";

export type AccountAssetHistoryPeriod = "day" | "week" | "month";

export interface AccountAssetHistoryPoint {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  asOf: string;
  totalAssetAmount: number | null;
  totalEvaluationAmount: number | null;
  cashAmount: number | null;
  changeAmount: number | null;
  changeRate: number | null;
}

export interface AccountAssetHistorySeries {
  period: AccountAssetHistoryPeriod;
  points: AccountAssetHistoryPoint[];
  latestChangeAmount: number | null;
  latestChangeRate: number | null;
  totalChangeAmount: number | null;
  totalChangeRate: number | null;
  averageChangeAmount: number | null;
}

export interface AccountAssetHistoryPayload {
  storage: {
    enabled: boolean;
    backend: "kv" | "d1" | "none";
  };
  day: AccountAssetHistorySeries;
  week: AccountAssetHistorySeries;
  month: AccountAssetHistorySeries;
  warnings: string[];
}

interface StoredAccountAssetPoint {
  version: 1;
  period: AccountAssetHistoryPeriod;
  key: string;
  startDate: string;
  endDate: string;
  asOf: string;
  account: string;
  totalAssetAmount: number | null;
  totalEvaluationAmount: number | null;
  cashAmount: number | null;
}

const HISTORY_PREFIX = "account:asset-history:v1";
const HISTORY_LIMIT = 50;
const HISTORY_TTL_SEC = 730 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const accountHistoryBackend = (env: Env): AccountAssetHistoryPayload["storage"]["backend"] => {
  if (env.SCREENER_DB) return "d1";
  if (env.SCREENER_KV) return "kv";
  return "none";
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const toDateUtc = (yyyyMmDd: string): Date => {
  const [year, month, day] = yyyyMmDd.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
};

const addDays = (yyyyMmDd: string, days: number): string =>
  toIsoDate(new Date(toDateUtc(yyyyMmDd).getTime() + days * DAY_MS));

const startOfIsoWeek = (yyyyMmDd: string): string => {
  const date = toDateUtc(yyyyMmDd);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(yyyyMmDd, mondayOffset);
};

const endOfMonth = (yyyyMm: string): string => {
  const [year, month] = yyyyMm.split("-").map((part) => Number(part));
  return toIsoDate(new Date(Date.UTC(year, month, 0)));
};

const historyAccountKey = (account: string): string => encodeURIComponent(account || "unknown");

const periodPrefix = (account: string, period: AccountAssetHistoryPeriod): string =>
  `${HISTORY_PREFIX}:${historyAccountKey(account)}:${period}:`;

const periodStorageKey = (
  account: string,
  period: AccountAssetHistoryPeriod,
  key: string,
): string => `${periodPrefix(account, period)}${key}`;

const pickAssetAmount = (snapshot: AccountSnapshotPayload): number | null => {
  const explicit = snapshot.summary.totalAssetAmount;
  if (explicit != null) return explicit;
  return snapshot.summary.totalEvaluationAmount ?? snapshot.summary.cashAmount ?? null;
};

const periodBounds = (
  period: AccountAssetHistoryPeriod,
  date: string,
): { key: string; startDate: string; endDate: string } => {
  if (period === "day") {
    return { key: date, startDate: date, endDate: date };
  }
  if (period === "week") {
    const startDate = startOfIsoWeek(date);
    return { key: startDate, startDate, endDate: addDays(startDate, 6) };
  }
  const key = date.slice(0, 7);
  return { key, startDate: `${key}-01`, endDate: endOfMonth(key) };
};

const labelForPoint = (period: AccountAssetHistoryPeriod, point: StoredAccountAssetPoint): string => {
  if (period === "month") {
    return point.key.replace("-", ".");
  }
  const date = period === "week" ? point.startDate : point.endDate;
  const label = `${date.slice(5, 7)}/${date.slice(8, 10)}`;
  return period === "week" ? `${label}주` : label;
};

const toStoredPoint = (
  snapshot: AccountSnapshotPayload,
  period: AccountAssetHistoryPeriod,
): StoredAccountAssetPoint | null => {
  const asOf = snapshot.meta.asOf;
  const date = asOf.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const bounds = periodBounds(period, date);
  return {
    version: 1,
    period,
    key: bounds.key,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    asOf,
    account: snapshot.meta.account,
    totalAssetAmount: round2(pickAssetAmount(snapshot)),
    totalEvaluationAmount: round2(snapshot.summary.totalEvaluationAmount),
    cashAmount: round2(snapshot.summary.cashAmount),
  };
};

const isStoredPoint = (value: StoredAccountAssetPoint | null): value is StoredAccountAssetPoint =>
  !!value &&
  value.version === 1 &&
  (value.period === "day" || value.period === "week" || value.period === "month") &&
  typeof value.key === "string" &&
  typeof value.asOf === "string";

export const buildAccountAssetHistorySeries = (
  period: AccountAssetHistoryPeriod,
  rawPoints: StoredAccountAssetPoint[],
): AccountAssetHistorySeries => {
  const deduped = [...rawPoints]
    .filter((point) => point.period === period)
    .sort((a, b) => a.key.localeCompare(b.key) || a.asOf.localeCompare(b.asOf))
    .reduce<StoredAccountAssetPoint[]>((items, point) => {
      const last = items[items.length - 1];
      if (last?.key === point.key) {
        items[items.length - 1] = point.asOf >= last.asOf ? point : last;
      } else {
        items.push(point);
      }
      return items;
    }, []);

  const points = deduped.map<AccountAssetHistoryPoint>((point, index) => {
    const previous = index > 0 ? deduped[index - 1] : null;
    const asset = point.totalAssetAmount;
    const previousAsset = previous?.totalAssetAmount ?? null;
    const changeAmount =
      asset != null && previousAsset != null ? round2(asset - previousAsset) : null;
    const changeRate =
      changeAmount != null && previousAsset != null && previousAsset > 0
        ? round2((changeAmount / previousAsset) * 100)
        : null;

    return {
      key: point.key,
      label: labelForPoint(period, point),
      startDate: point.startDate,
      endDate: point.endDate,
      asOf: point.asOf,
      totalAssetAmount: asset,
      totalEvaluationAmount: point.totalEvaluationAmount,
      cashAmount: point.cashAmount,
      changeAmount,
      changeRate,
    };
  });

  const firstAsset = points[0]?.totalAssetAmount ?? null;
  const last = points[points.length - 1] ?? null;
  const lastAsset = last?.totalAssetAmount ?? null;
  const totalChangeAmount =
    firstAsset != null && lastAsset != null && points.length > 1 ? round2(lastAsset - firstAsset) : null;
  const totalChangeRate =
    totalChangeAmount != null && firstAsset != null && firstAsset > 0
      ? round2((totalChangeAmount / firstAsset) * 100)
      : null;
  const changes = points
    .map((point) => point.changeAmount)
    .filter((change): change is number => change != null);
  const averageChangeAmount =
    changes.length > 0 ? round2(changes.reduce((sum, change) => sum + change, 0) / changes.length) : null;

  return {
    period,
    points,
    latestChangeAmount: last?.changeAmount ?? null,
    latestChangeRate: last?.changeRate ?? null,
    totalChangeAmount,
    totalChangeRate,
    averageChangeAmount,
  };
};

const emptySeries = (period: AccountAssetHistoryPeriod): AccountAssetHistorySeries =>
  buildAccountAssetHistorySeries(period, []);

const buildPayload = (
  backend: AccountAssetHistoryPayload["storage"]["backend"],
  day: StoredAccountAssetPoint[],
  week: StoredAccountAssetPoint[],
  month: StoredAccountAssetPoint[],
  warnings: string[],
): AccountAssetHistoryPayload => ({
  storage: {
    enabled: backend !== "none",
    backend,
  },
  day: day.length > 0 ? buildAccountAssetHistorySeries("day", day) : emptySeries("day"),
  week: week.length > 0 ? buildAccountAssetHistorySeries("week", week) : emptySeries("week"),
  month: month.length > 0 ? buildAccountAssetHistorySeries("month", month) : emptySeries("month"),
  warnings,
});

const loadPeriodPoints = async (
  env: Env,
  account: string,
  period: AccountAssetHistoryPeriod,
  backend: Exclude<AccountAssetHistoryPayload["storage"]["backend"], "none">,
): Promise<StoredAccountAssetPoint[]> => {
  const items = await listPersistedByPrefix<StoredAccountAssetPoint>(
    env,
    periodPrefix(account, period),
    HISTORY_LIMIT,
    backend,
  );
  return items.map((item) => item.value).filter(isStoredPoint);
};

export const recordAccountAssetHistory = async (
  env: Env,
  snapshot: AccountSnapshotPayload,
): Promise<AccountAssetHistoryPayload> => {
  const backend = accountHistoryBackend(env);
  const currentPoints = {
    day: toStoredPoint(snapshot, "day"),
    week: toStoredPoint(snapshot, "week"),
    month: toStoredPoint(snapshot, "month"),
  };
  const warnings: string[] = [];

  if (backend === "none") {
    warnings.push("SCREENER_KV 또는 SCREENER_DB가 연결되지 않아 계좌 자산 히스토리를 저장하지 못했습니다.");
    return buildPayload(
      backend,
      currentPoints.day ? [currentPoints.day] : [],
      currentPoints.week ? [currentPoints.week] : [],
      currentPoints.month ? [currentPoints.month] : [],
      warnings,
    );
  }

  if (currentPoints.day?.totalAssetAmount == null) {
    warnings.push("총 자산 금액이 비어 있어 이번 계좌 스냅샷은 히스토리에 반영하지 않았습니다.");
  } else {
    for (const period of ["day", "week", "month"] as const) {
      const point = currentPoints[period];
      if (!point) continue;
      await putPersistedJson(
        env,
        periodStorageKey(snapshot.meta.account, period, point.key),
        point,
        HISTORY_TTL_SEC,
        backend,
      );
    }
  }

  const [day, week, month] = await Promise.all([
    loadPeriodPoints(env, snapshot.meta.account, "day", backend),
    loadPeriodPoints(env, snapshot.meta.account, "week", backend),
    loadPeriodPoints(env, snapshot.meta.account, "month", backend),
  ]);

  return buildPayload(backend, day, week, month, warnings);
};
