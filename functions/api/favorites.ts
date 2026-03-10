import { attachMetrics, createRequestMetrics } from "../lib/observability";
import {
  addOwnerFavorite,
  loadOwnerFavorites,
  removeOwnerFavorite,
  saveOwnerFavorites,
} from "../lib/ownerFavorites";
import { errorJson, json, serverError } from "../lib/response";
import { hasAdminOrSessionAccess } from "../lib/siteAuth";
import type { Env } from "../lib/types";

const parseItem = (payload: unknown): { code: string; name: string } | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const code = String(record.code ?? "").trim();
  const name = String(record.name ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  return { code, name };
};

const parseItems = (payload: unknown): Array<{ code: string; name: string }> | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  return record.items
    .map((item) => parseItem(item))
    .filter((item): item is { code: string; name: string } => item !== null);
};

const ensureOwnerAccess = async (request: Request, env: Env): Promise<Response | null> => {
  const allowed = await hasAdminOrSessionAccess(request, env);
  if (allowed) return null;
  return errorJson(401, "UNAUTHORIZED", "owner 관심종목 접근 권한이 필요합니다.", request);
};

const responseFromResult = (
  result: Awaited<ReturnType<typeof loadOwnerFavorites>>,
  status = 200,
): Response =>
  json(
    {
      ok: true,
      items: result.items,
      storage: {
        backend: result.backend,
        enabled: result.enabled,
      },
    },
    status,
    {
      "cache-control": "no-store",
    },
  );

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const authError = await ensureOwnerAccess(context.request, context.env);
    if (authError) return finalize(authError);

    const result = await loadOwnerFavorites(context.env);
    if (!result.enabled) {
      return finalize(
        errorJson(
          503,
          "FAVORITES_STORAGE_DISABLED",
          "관심종목 서버 저장소가 설정되지 않았습니다. SCREENER_KV 또는 SCREENER_DB를 연결해 주세요.",
          context.request,
        ),
      );
    }
    return finalize(responseFromResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "favorites get failed";
    return finalize(serverError(message, context.request));
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const authError = await ensureOwnerAccess(context.request, context.env);
    if (authError) return finalize(authError);

    const payload = await context.request.json().catch(() => null);
    const item = parseItem(payload);
    if (!item) {
      return finalize(errorJson(400, "BAD_REQUEST", "유효한 관심종목(code/name)이 필요합니다.", context.request));
    }

    const result = await addOwnerFavorite(context.env, item);
    if (!result.enabled) {
      return finalize(
        errorJson(
          503,
          "FAVORITES_STORAGE_DISABLED",
          "관심종목 서버 저장소가 설정되지 않았습니다. SCREENER_KV 또는 SCREENER_DB를 연결해 주세요.",
          context.request,
        ),
      );
    }
    return finalize(responseFromResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "favorites post failed";
    return finalize(serverError(message, context.request));
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const authError = await ensureOwnerAccess(context.request, context.env);
    if (authError) return finalize(authError);

    const payload = await context.request.json().catch(() => null);
    const items = parseItems(payload);
    if (!items) {
      return finalize(errorJson(400, "BAD_REQUEST", "유효한 관심종목 목록(items)이 필요합니다.", context.request));
    }

    const result = await saveOwnerFavorites(context.env, items);
    if (!result.enabled) {
      return finalize(
        errorJson(
          503,
          "FAVORITES_STORAGE_DISABLED",
          "관심종목 서버 저장소가 설정되지 않았습니다. SCREENER_KV 또는 SCREENER_DB를 연결해 주세요.",
          context.request,
        ),
      );
    }
    return finalize(responseFromResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "favorites put failed";
    return finalize(serverError(message, context.request));
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const authError = await ensureOwnerAccess(context.request, context.env);
    if (authError) return finalize(authError);

    const url = new URL(context.request.url);
    const queryCode = url.searchParams.get("code");
    const payload = queryCode ? null : await context.request.json().catch(() => null);
    const code = String(queryCode ?? (payload as Record<string, unknown> | null)?.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      return finalize(errorJson(400, "BAD_REQUEST", "삭제할 관심종목 code가 필요합니다.", context.request));
    }

    const result = await removeOwnerFavorite(context.env, code);
    if (!result.enabled) {
      return finalize(
        errorJson(
          503,
          "FAVORITES_STORAGE_DISABLED",
          "관심종목 서버 저장소가 설정되지 않았습니다. SCREENER_KV 또는 SCREENER_DB를 연결해 주세요.",
          context.request,
        ),
      );
    }
    return finalize(responseFromResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "favorites delete failed";
    return finalize(serverError(message, context.request));
  }
};
