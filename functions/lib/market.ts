const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toKstDate = (date: Date): Date => new Date(date.getTime() + KST_OFFSET_MS);

export const formatKstDate = (date: Date): string => {
  const kst = toKstDate(date);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const ymdToUtc = (yyyymmdd: string): number => {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return Date.UTC(y, m - 1, d, 0, 0, 0);
};

export const addDaysToYmd = (yyyymmdd: string, deltaDays: number): string => {
  const utc = ymdToUtc(yyyymmdd) + deltaDays * DAY_MS;
  const dt = new Date(utc);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

export const nowIsoKst = (date = new Date()): string => {
  const kst = toKstDate(date);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(
    kst.getUTCDate(),
  ).padStart(2, "0")}T${String(kst.getUTCHours()).padStart(2, "0")}:${String(
    kst.getUTCMinutes(),
  ).padStart(2, "0")}:${String(kst.getUTCSeconds()).padStart(2, "0")}+09:00`;
};

export const isKrxRegularSession = (date = new Date()): boolean => {
  const kst = toKstDate(date);
  const day = kst.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;

  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const open = 9 * 60;
  const close = 15 * 60 + 30;
  return minutes >= open && minutes <= close;
};

export const analysisTtlSec = (date = new Date()): number => {
  const kst = toKstDate(date);
  const day = kst.getUTCDay();

  if (isKrxRegularSession(date)) {
    return 60;
  }

  if (day === 0 || day === 6) {
    return 3600; // weekend: 60 min
  }

  return 1800; // weekday but off-session: 30 min
};

export const timeframeCacheTtlSec = (
  tf: "month" | "week" | "day" | "min5",
  date = new Date(),
): number => {
  const kst = toKstDate(date);
  const day = kst.getUTCDay();
  const weekend = day === 0 || day === 6;
  const regular = isKrxRegularSession(date);

  if (tf === "min5") {
    if (regular) return 15;
    if (weekend) return 60 * 60; // 60m
    return 10 * 60; // 10m
  }

  if (tf === "day") {
    if (regular) return 60;
    if (weekend) return 6 * 60 * 60; // 6h
    return 30 * 60; // 30m
  }

  if (regular) return 30 * 60; // 30m
  if (weekend) return 24 * 60 * 60; // 24h
  return 60 * 60; // 60m
};

export const nowKstDateYmd = (): string => formatKstDate(new Date());

export const hhmmssToMinutes = (hhmmss: string): number => {
  const clean = hhmmss.replace(/\D/g, "");
  if (clean.length < 4) return 0;
  const hh = Number(clean.slice(0, 2));
  const mm = Number(clean.slice(2, 4));
  return hh * 60 + mm;
};

export const minutesToHhmmss = (minutes: number): string => {
  const safe = Math.max(0, Math.floor(minutes));
  const hh = String(Math.floor(safe / 60)).padStart(2, "0");
  const mm = String(safe % 60).padStart(2, "0");
  return `${hh}${mm}00`;
};
