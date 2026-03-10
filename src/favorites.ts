import { useEffect, useMemo, useRef, useState } from "react";

export interface FavoriteStock {
  code: string;
  name: string;
}

const FAVORITES_KEY = "kis-stock-favorites-v1";
const FAVORITES_EVENT = "kis-favorites-updated";
const FAVORITE_NOTIFICATIONS_KEY = "kis-favorite-notifications-v1";
const FAVORITES_API = "/api/favorites";

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

const normalizeFavorites = (items: FavoriteStock[]): FavoriteStock[] =>
  items
    .map((item) => ({
      code: item.code.trim(),
      name: item.name.trim(),
    }))
    .filter((item) => /^\d{6}$/.test(item.code))
    .reduce<FavoriteStock[]>((acc, item) => {
      if (acc.some((existing) => existing.code === item.code)) return acc;
      acc.push(item);
      return acc;
    }, [])
    .sort((a, b) => a.code.localeCompare(b.code));

const writeStorage = (items: FavoriteStock[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(normalizeFavorites(items)));
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
  const [serverEnabled, setServerEnabled] = useState(false);
  const favoritesRef = useRef<FavoriteStock[]>(favorites);

  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  useEffect(() => {
    const sync = () => setFavorites(readStorage());
    window.addEventListener(FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadServerFavorites = async () => {
      try {
        const response = await fetch(FAVORITES_API, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          setServerEnabled(false);
          return;
        }

        const body = (await response.json()) as {
          items?: FavoriteStock[];
          storage?: { enabled?: boolean };
        };
        const serverItems = normalizeFavorites(body.items ?? []);
        const enabled = !!body.storage?.enabled;
        setServerEnabled(enabled);

        if (!enabled) return;

        if (serverItems.length === 0) {
          const localItems = normalizeFavorites(readStorage());
          if (localItems.length > 0) {
            const migrateResponse = await fetch(FAVORITES_API, {
              method: "PUT",
              credentials: "include",
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              body: JSON.stringify({ items: localItems }),
            });
            if (migrateResponse.ok) {
              const migrated = (await migrateResponse.json()) as { items?: FavoriteStock[] };
              const migratedItems = normalizeFavorites(migrated.items ?? localItems);
              if (!cancelled) {
                setFavorites(migratedItems);
                writeStorage(migratedItems);
              }
              return;
            }
          }
        }

        if (!cancelled) {
          setFavorites(serverItems);
          writeStorage(serverItems);
        }
      } catch {
        setServerEnabled(false);
      }
    };

    void loadServerFavorites();
    return () => {
      cancelled = true;
    };
  }, []);

  const codes = useMemo(() => favorites.map((item) => item.code), [favorites]);

  const isFavorite = (code: string): boolean => codes.includes(code);

  const toggleFavorite = async (stock: FavoriteStock) => {
    const current = favoritesRef.current;
    const removing = current.some((item) => item.code === stock.code);
    const next = removing
      ? current.filter((item) => item.code !== stock.code)
      : [...current, { code: stock.code, name: stock.name }];
    const normalized = normalizeFavorites(next);
    setFavorites(normalized);
    writeStorage(normalized);

    if (!serverEnabled) return;

    try {
      const response = await fetch(
        removing ? `${FAVORITES_API}?code=${stock.code}` : FAVORITES_API,
        {
          method: removing ? "DELETE" : "POST",
          credentials: "include",
          headers:
            removing
              ? undefined
              : {
                  "content-type": "application/json; charset=utf-8",
                },
          body: removing ? undefined : JSON.stringify(stock),
        },
      );

      if (!response.ok) throw new Error("favorites sync failed");
      const body = (await response.json()) as { items?: FavoriteStock[] };
      const synced = normalizeFavorites(body.items ?? normalized);
      setFavorites(synced);
      writeStorage(synced);
    } catch {
      setFavorites(current);
      writeStorage(current);
    }
  };

  return {
    favorites,
    favoriteCodes: codes,
    isFavorite,
    toggleFavorite,
    favoriteSource: serverEnabled ? "owner" : "browser",
  };
};
