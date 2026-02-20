import stockList from "../../data/kr-stocks.json";

interface StockEntry {
  code: string;
  name: string;
  market: string;
}

export interface SearchResultItem {
  code: string;
  name: string;
  market: string;
  rank: number;
}

const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

const stocks = stockList as StockEntry[];

const normalize = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

const toChoseong = (value: string): string => {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const index = Math.floor((code - 0xac00) / 588);
      result += CHOSEONG[index] ?? "";
    } else if (/[ㄱ-ㅎ]/.test(char)) {
      result += char;
    }
  }
  return result;
};

export const searchStocks = (rawQuery: string, limit = 8): SearchResultItem[] => {
  const query = rawQuery.trim();
  if (!query) return [];

  const qCode = query.toUpperCase();
  const qName = normalize(query);
  const qCho = toChoseong(query);

  const matched = stocks
    .map((stock) => {
      const code = stock.code.toUpperCase();
      const name = normalize(stock.name);
      const cho = toChoseong(stock.name);
      let rank = Number.MAX_SAFE_INTEGER;

      if (code === qCode) rank = 0;
      else if (name === qName) rank = 1;
      else if (cho === qCho && qCho) rank = 2;
      else if (code.startsWith(qCode)) rank = 3;
      else if (name.startsWith(qName)) rank = 4;
      else if (cho.startsWith(qCho) && qCho) rank = 5;
      else if (code.includes(qCode)) rank = 6;
      else if (name.includes(qName)) rank = 7;
      else if (cho.includes(qCho) && qCho) rank = 8;
      else return null;

      return {
        code: stock.code,
        name: stock.name,
        market: stock.market,
        rank,
      };
    })
    .filter((item): item is SearchResultItem => item !== null)
    .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.code.localeCompare(b.code));

  return matched.slice(0, Math.max(1, Math.min(limit, 20)));
};
