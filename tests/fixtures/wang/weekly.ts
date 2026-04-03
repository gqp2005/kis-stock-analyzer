import type { Candle } from "../../../functions/lib/types";

const patchCandle = (candles: Candle[], index: number, patch: Partial<Candle>) => {
  candles[index] = { ...candles[index], ...patch };
};

export const makeWeeklyStructureCandles = (): Candle[] => {
  const candles = Array.from({ length: 40 }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index * 7));
    const base = 100 + index * 0.25;
    return {
      time: day.toISOString().slice(0, 10),
      open: base - 0.6,
      high: base + 1.1,
      low: base - 1.1,
      close: base + 0.2,
      volume: 9000 + (index % 4) * 250,
    };
  });

  patchCandle(candles, 5, { open: 104, high: 110, low: 103.5, close: 109, volume: 120000 });
  patchCandle(candles, 10, { open: 107, high: 109, low: 106.5, close: 108.8, volume: 17000 });
  patchCandle(candles, 14, { open: 108.3, high: 110.2, low: 107.8, close: 109.9, volume: 18500 });
  patchCandle(candles, 18, { open: 109.8, high: 114.6, low: 109.4, close: 113.9, volume: 31000 });
  patchCandle(candles, 20, { open: 113.2, high: 118.2, low: 112.9, close: 117.7, volume: 22500 });
  patchCandle(candles, 22, { open: 110.4, high: 110.8, low: 108.8, close: 109.1, volume: 8200 });
  patchCandle(candles, 23, { open: 109.2, high: 109.5, low: 107.4, close: 107.8, volume: 6500 });
  patchCandle(candles, 24, { open: 107.7, high: 108.4, low: 106.6, close: 107.1, volume: 5900 });
  patchCandle(candles, 25, { open: 107.2, high: 108.0, low: 106.8, close: 107.4, volume: 6100 });
  patchCandle(candles, 26, { open: 107.4, high: 108.4, low: 103.8, close: 106.3, volume: 7600 });
  patchCandle(candles, 27, { open: 106.4, high: 109.6, low: 106.0, close: 108.8, volume: 7300 });
  patchCandle(candles, 28, { open: 108.9, high: 110.4, low: 108.2, close: 109.7, volume: 8900 });
  patchCandle(candles, 39, { open: 117.1, high: 119.6, low: 116.8, close: 119.2, volume: 11800 });

  return candles;
};

export const makeLectureMinimumWeekCandles = (count: number): Candle[] => {
  const candles = Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index * 7));
    const price = 100 + index * 0.28;
    return {
      time: day.toISOString().slice(0, 10),
      open: price - 0.45,
      high: price + 0.9,
      low: price - 0.9,
      close: price + 0.18,
      volume: 13800 + (index % 3) * 220,
    };
  });

  patchCandle(candles, 80, { open: 122.1, high: 127.2, low: 121.8, close: 126.4, volume: 140000 });
  patchCandle(candles, 90, { open: 128.5, high: 131.4, low: 128.0, close: 130.9, volume: 16500 });
  patchCandle(candles, 96, { open: 131.2, high: 134.4, low: 130.8, close: 133.8, volume: 19000 });
  patchCandle(candles, 101, { open: 134.0, high: 141.6, low: 133.7, close: 140.8, volume: 26000 });
  patchCandle(candles, 198, { open: 168.4, high: 169.0, low: 167.8, close: 168.2, volume: 13500 });
  patchCandle(candles, 199, { open: 168.0, high: 169.4, low: 167.6, close: 168.7, volume: 14020 });

  return candles;
};
