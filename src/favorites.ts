import { useEffect, useMemo, useState } from "react";

export interface FavoriteStock {
  code: string;
  name: string;
}

const FAVORITES_KEY = "kis-stock-favorites-v1";
const FAVORITES_EVENT = "kis-favorites-updated";
const FAVORITE_NOTIFICATIONS_KEY = "kis-favorite-notifications-v1";

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readStorage = (): FavoriteStock[] => {
  if (typeof window === "undefined") return [];
  return safeParse<FavoriteStock[]>(window.localStorage.getItem(FAVORITES_KEY), [])
    .filter((item) => item && typeof item.code === "string")
    .map((item) => ({
      code: item.code.trim(),
      name: typeof item.name === "string" ? item.name.trim() : "",
    }))
    .filter((item) => /^\d{6}$/.test(item.code));
};

const writeStorage = (items: FavoriteStock[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
};

export const readFavoriteNotificationState = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  return safeParse<Record<string, string>>(window.localStorage.getItem(FAVORITE_NOTIFICATIONS_KEY), {});
};

export const writeFavoriteNotificationState = (value: Record<string, string>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITE_NOTIFICATIONS_KEY, JSON.stringify(value));
};

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<FavoriteStock[]>(() => readStorage());

  useEffect(() => {
    const sync = () => setFavorites(readStorage());
    window.addEventListener(FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const codes = useMemo(() => favorites.map((item) => item.code), [favorites]);

  const isFavorite = (code: string): boolean => codes.includes(code);

  const toggleFavorite = (stock: FavoriteStock) => {
    const next = isFavorite(stock.code)
      ? favorites.filter((item) => item.code !== stock.code)
      : [...favorites, { code: stock.code, name: stock.name }].sort((a, b) => a.code.localeCompare(b.code));
    setFavorites(next);
    writeStorage(next);
  };

  return {
    favorites,
    favoriteCodes: codes,
    isFavorite,
    toggleFavorite,
  };
};
