import stockList from "../../data/kr-stocks.json";

interface StockEntry {
  code: string;
  name: string;
  market: string;
}

export interface ResolvedStock {
  code: string;
  name: string;
  market: string;
  matchedBy: "code" | "name_exact" | "name_prefix" | "name_contains";
}

const stocks = stockList as StockEntry[];
const byCode = new Map<string, StockEntry>();

for (const entry of stocks) {
  byCode.set(entry.code, entry);
}

const normalizeName = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

export const resolveStock = (rawInput: string): ResolvedStock | null => {
  const input = rawInput.trim();
  if (!input) return null;

  // 코드가 들어온 경우는 즉시 처리해서 KIS 호출을 줄입니다.
  if (/^[A-Z0-9]{5,9}$/.test(input)) {
    const found = byCode.get(input);
    if (found) {
      return {
        code: found.code,
        name: found.name,
        market: found.market,
        matchedBy: "code",
      };
    }

    return {
      code: input,
      name: input,
      market: "UNKNOWN",
      matchedBy: "code",
    };
  }

  const normalized = normalizeName(input);

  let candidate = stocks.find((item) => normalizeName(item.name) === normalized);
  if (candidate) {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      matchedBy: "name_exact",
    };
  }

  candidate = stocks.find((item) => normalizeName(item.name).startsWith(normalized));
  if (candidate) {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      matchedBy: "name_prefix",
    };
  }

  candidate = stocks.find((item) => normalizeName(item.name).includes(normalized));
  if (candidate) {
    return {
      code: candidate.code,
      name: candidate.name,
      market: candidate.market,
      matchedBy: "name_contains",
    };
  }

  return null;
};

