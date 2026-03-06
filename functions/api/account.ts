import { fetchAccountSnapshot } from "../lib/accountSnapshot";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import type { Env } from "../lib/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    const payload = await fetchAccountSnapshot(context.env, metrics);
    return finalize(
      json(payload, 200, {
        "cache-control": "no-store",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "account endpoint error";
    if (message.includes("KIS_ACCOUNT_NO")) {
      return finalize(badRequest(message, context.request));
    }
    return finalize(serverError(message, context.request));
  }
};
