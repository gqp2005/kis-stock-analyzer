import { getPersistedJson, persistenceBackend, putPersistedJson } from "./screenerPersistence";
import type { Env } from "./types";

export interface OwnerFavoriteStock {
  code: string;
  name: string;
}

const OWNER_FAVORITES_KEY = "owner:favorites";
const OWNER_FAVORITES_TTL_SEC = 365 * 24 * 60 * 60;
const MAX_OWNER_FAVORITES = 100;

const normalizeFavorites = (items: unknown): OwnerFavoriteStock[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    }))
    .filter((item) => /^\d{6}$/.test(item.code))
    .reduce<OwnerFavoriteStock[]>((acc, item) => {
      if (acc.some((existing) => existing.code === item.code)) return acc;
      acc.push(item);
      return acc;
    }, [])
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, MAX_OWNER_FAVORITES);
};

export const loadOwnerFavorites = async (
  env: Env,
): Promise<{
  items: OwnerFavoriteStock[];
  backend: ReturnType<typeof persistenceBackend>;
  enabled: boolean;
}> => {
  const backend = persistenceBackend(env);
  if (backend === "none") {
    return { items: [], backend, enabled: false };
  }

  const items =
    backend === "kv"
      ? await getPersistedJson<OwnerFavoriteStock[]>(env, OWNER_FAVORITES_KEY, "kv")
      : await getPersistedJson<OwnerFavoriteStock[]>(env, OWNER_FAVORITES_KEY, "d1");

  return {
    items: normalizeFavorites(items),
    backend,
    enabled: true,
  };
};

export const saveOwnerFavorites = async (
  env: Env,
  items: OwnerFavoriteStock[],
): Promise<{
  items: OwnerFavoriteStock[];
  backend: ReturnType<typeof persistenceBackend>;
  enabled: boolean;
}> => {
  const backend = persistenceBackend(env);
  if (backend === "none") {
    return { items: normalizeFavorites(items), backend, enabled: false };
  }

  const normalized = normalizeFavorites(items);
  await putPersistedJson(
    env,
    OWNER_FAVORITES_KEY,
    normalized,
    OWNER_FAVORITES_TTL_SEC,
    backend,
  );

  return {
    items: normalized,
    backend,
    enabled: true,
  };
};

export const addOwnerFavorite = async (
  env: Env,
  item: OwnerFavoriteStock,
) => {
  const current = await loadOwnerFavorites(env);
  return await saveOwnerFavorites(env, [...current.items, item]);
};

export const removeOwnerFavorite = async (env: Env, code: string) => {
  const current = await loadOwnerFavorites(env);
  return await saveOwnerFavorites(
    env,
    current.items.filter((item) => item.code !== code.trim()),
  );
};
