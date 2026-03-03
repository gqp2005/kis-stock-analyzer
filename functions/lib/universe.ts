import stockList from "../../data/kr-stocks.json";
import type { ScreenerUniverseEntry } from "./screener";

interface StockEntry {
  code: string;
  name: string;
  market: string;
}

export interface UniverseTurnoverItem extends ScreenerUniverseEntry {
  turnover: number;
}

export interface UniverseProvider {
  getTopByTurnover(date: string, limit: number): Promise<UniverseTurnoverItem[]>;
}

interface ExternalProviderOptions {
  fetcher?: typeof fetch;
  maxPagesPerMarket?: number;
  timeoutMs?: number;
}

const QUANT_BASE_URL = "https://finance.naver.com/sise/sise_quant.naver";
const MARKET_SUM_BASE_URL = "https://finance.naver.com/sise/sise_market_sum.naver";
const VALID_CODE_RE = /^\d{6}$/;
const MAX_LIMIT = 1200;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_TIMEOUT_MS = 8000;

const stocks = stockList as StockEntry[];
const stockByCode = new Map<string, StockEntry>();
for (const stock of stocks) {
  stockByCode.set(stock.code, stock);
}

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

const stripTags = (value: string): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseNumber = (value: string): number => {
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseMarketRows = (html: string, market: "KOSPI" | "KOSDAQ"): UniverseTurnoverItem[] => {
  const results: UniverseTurnoverItem[] = [];
  const rowRe = /<tr>\s*<td class="no">[\s\S]*?<\/tr>/g;
  const rows = html.match(rowRe) ?? [];

  for (const row of rows) {
    const codeMatch = row.match(/\/item\/main\.naver\?code=(\d{6})/);
    if (!codeMatch) continue;
    const code = codeMatch[1];
    if (!VALID_CODE_RE.test(code)) continue;

    const nameMatch = row.match(/class="tltle">([\s\S]*?)<\/a>/);
    if (!nameMatch) continue;
    const parsedName = decodeHtml(stripTags(nameMatch[1]));
    if (!parsedName) continue;

    const numberCellRe = /<td class="number">([\s\S]*?)<\/td>/g;
    const numberCells: string[] = [];
    let numberMatch: RegExpExecArray | null;
    while ((numberMatch = numberCellRe.exec(row)) !== null) {
      numberCells.push(stripTags(numberMatch[1]));
    }
    if (numberCells.length < 5) continue;

    const turnoverMillion = parseNumber(numberCells[4]);
    if (!Number.isFinite(turnoverMillion) || turnoverMillion <= 0) continue;

    const known = stockByCode.get(code);
    results.push({
      code,
      name: known?.name ?? parsedName,
      market: known?.market === "KOSPI" || known?.market === "KOSDAQ" ? known.market : market,
      turnover: Math.round(turnoverMillion * 1_000_000),
    });
  }

  return results;
};

const parseMarketSumRows = (html: string, market: "KOSPI" | "KOSDAQ"): UniverseTurnoverItem[] => {
  const results: UniverseTurnoverItem[] = [];
  const rowRe = /<tr>\s*<td class="no">[\s\S]*?<\/tr>/g;
  const rows = html.match(rowRe) ?? [];

  for (const row of rows) {
    const codeMatch = row.match(/\/item\/main\.naver\?code=(\d{6})/);
    if (!codeMatch) continue;
    const code = codeMatch[1];
    if (!VALID_CODE_RE.test(code)) continue;

    const nameMatch = row.match(/class="tltle">([\s\S]*?)<\/a>/);
    if (!nameMatch) continue;
    const parsedName = decodeHtml(stripTags(nameMatch[1]));
    if (!parsedName) continue;

    const numberCellRe = /<td class="number">([\s\S]*?)<\/td>/g;
    const numberCells: string[] = [];
    let numberMatch: RegExpExecArray | null;
    while ((numberMatch = numberCellRe.exec(row)) !== null) {
      numberCells.push(stripTags(numberMatch[1]));
    }
    if (numberCells.length < 8) continue;

    const price = parseNumber(numberCells[0]);
    const volume = parseNumber(numberCells[7]);
    if (!Number.isFinite(price) || !Number.isFinite(volume) || price <= 0 || volume <= 0) continue;

    const known = stockByCode.get(code);
    results.push({
      code,
      name: known?.name ?? parsedName,
      market: known?.market === "KOSPI" || known?.market === "KOSDAQ" ? known.market : market,
      turnover: Math.round(price * volume),
    });
  }

  return results;
};

const mergeByCode = (items: UniverseTurnoverItem[]): UniverseTurnoverItem[] => {
  const map = new Map<string, UniverseTurnoverItem>();
  for (const item of items) {
    const prev = map.get(item.code);
    if (!prev || item.turnover > prev.turnover) {
      map.set(item.code, item);
    }
  }
  return [...map.values()];
};

export class StaticProvider implements UniverseProvider {
  private readonly seed: UniverseTurnoverItem[];

  constructor(seed?: UniverseTurnoverItem[]) {
    if (seed && seed.length > 0) {
      this.seed = [...seed];
      return;
    }

    this.seed = stocks
      .filter((stock) => VALID_CODE_RE.test(stock.code))
      .filter((stock) => stock.market === "KOSPI" || stock.market === "KOSDAQ")
      .slice(0, 800)
      .map((stock, index) => ({
        code: stock.code,
        name: stock.name,
        market: stock.market,
        turnover: (800 - index) * 100_000_000,
      }));
  }

  async getTopByTurnover(_date: string, limit: number): Promise<UniverseTurnoverItem[]> {
    const target = Math.max(20, Math.min(MAX_LIMIT, Math.floor(limit)));
    return [...this.seed]
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, target);
  }
}

export class ExternalProvider implements UniverseProvider {
  private readonly fetcher: typeof fetch;
  private readonly maxPagesPerMarket: number;
  private readonly timeoutMs: number;

  constructor(options: ExternalProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxPagesPerMarket = Math.max(1, Math.min(20, options.maxPagesPerMarket ?? DEFAULT_MAX_PAGES));
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  private async fetchMarketPage(
    market: "KOSPI" | "KOSDAQ",
    page: number,
  ): Promise<UniverseTurnoverItem[]> {
    const sosok = market === "KOSPI" ? "0" : "1";
    const url = `${QUANT_BASE_URL}?sosok=${sosok}&page=${page}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`external source http ${response.status}`);
      }
      const html = await response.text();
      return parseMarketRows(html, market);
    } finally {
      clearTimeout(timer);
    }
  }

  async getTopByTurnover(_date: string, limit: number): Promise<UniverseTurnoverItem[]> {
    const target = Math.max(20, Math.min(MAX_LIMIT, Math.floor(limit)));
    const all: UniverseTurnoverItem[] = [];

    for (const market of ["KOSPI", "KOSDAQ"] as const) {
      for (let page = 1; page <= this.maxPagesPerMarket; page += 1) {
        const rows = await this.fetchMarketPage(market, page);
        if (rows.length === 0) break;
        all.push(...rows);
      }
    }

    const merged = mergeByCode(all)
      .filter((item) => item.turnover > 0)
      .sort((a, b) => b.turnover - a.turnover);

    if (merged.length < Math.min(100, target / 2)) {
      throw new Error(`external universe too small (${merged.length})`);
    }

    return merged.slice(0, target);
  }
}

export class MarketSummaryProvider implements UniverseProvider {
  private readonly fetcher: typeof fetch;
  private readonly maxPagesPerMarket: number;
  private readonly timeoutMs: number;

  constructor(options: ExternalProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxPagesPerMarket = Math.max(1, Math.min(30, options.maxPagesPerMarket ?? DEFAULT_MAX_PAGES));
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  private async fetchMarketPage(
    market: "KOSPI" | "KOSDAQ",
    page: number,
  ): Promise<UniverseTurnoverItem[]> {
    const sosok = market === "KOSPI" ? "0" : "1";
    const url = `${MARKET_SUM_BASE_URL}?sosok=${sosok}&page=${page}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`market-sum source http ${response.status}`);
      }
      const html = await response.text();
      return parseMarketSumRows(html, market);
    } finally {
      clearTimeout(timer);
    }
  }

  async getTopByTurnover(_date: string, limit: number): Promise<UniverseTurnoverItem[]> {
    const target = Math.max(20, Math.min(MAX_LIMIT, Math.floor(limit)));
    const all: UniverseTurnoverItem[] = [];

    for (const market of ["KOSPI", "KOSDAQ"] as const) {
      for (let page = 1; page <= this.maxPagesPerMarket; page += 1) {
        const rows = await this.fetchMarketPage(market, page);
        if (rows.length === 0) break;
        all.push(...rows);
      }
    }

    const merged = mergeByCode(all)
      .filter((item) => item.turnover > 0)
      .sort((a, b) => b.turnover - a.turnover);

    if (merged.length < Math.min(100, target / 2)) {
      throw new Error(`market-sum universe too small (${merged.length})`);
    }

    return merged.slice(0, target);
  }
}
