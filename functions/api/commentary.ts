import { getCachedJson, putCachedJson } from "../lib/cache";
import { timeframeCacheTtlSec } from "../lib/market";
import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { badRequest, json, serverError } from "../lib/response";
import type { CommentaryPayload, CommentaryRequestPayload, Env, Overall, Timeframe } from "../lib/types";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 4500;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null;

const toOverallLabel = (overall: Overall): string => {
  if (overall === "GOOD") return "양호";
  if (overall === "NEUTRAL") return "중립";
  return "주의";
};

const toTfLabel = (tf: Timeframe): string => {
  if (tf === "month") return "월봉";
  if (tf === "week") return "주봉";
  return "일봉";
};

const toRiskTone = (risk: number): string => {
  if (risk >= 70) return "변동성 부담이 낮습니다";
  if (risk >= 40) return "변동성은 보통 수준입니다";
  return "변동성 경계가 필요합니다";
};

const toTrendTone = (trend: number): string => {
  if (trend >= 70) return "추세 우위";
  if (trend >= 40) return "혼조 흐름";
  return "추세 약세";
};

const toMomentumTone = (momentum: number): string => {
  if (momentum >= 65) return "모멘텀 강함";
  if (momentum >= 45) return "모멘텀 보통";
  return "모멘텀 약함";
};

const sanitizeComment = (text: string): string => text.replace(/\s+/g, " ").trim();

const buildRuleComment = (payload: CommentaryRequestPayload): string => {
  const { meta, final, timeframe } = payload;
  const volumeTone =
    timeframe.volumeScore == null
      ? ""
      : timeframe.volumeScore >= 70
        ? ", 거래량 확증이 동반됩니다"
        : timeframe.volumeScore < 50
          ? ", 거래량 확증은 약한 편입니다"
          : "";
  const base = `${meta.name}(${meta.symbol}) ${toTfLabel(timeframe.tf)} 기준 ${toOverallLabel(final.overall)} 흐름입니다`;
  const detail = `${toTrendTone(timeframe.trend)}, ${toMomentumTone(timeframe.momentum)}, ${toRiskTone(timeframe.risk)}${volumeTone}.`;
  return sanitizeComment(`${base}. ${detail}`);
};

const hashText = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
};

const toStringValue = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const parsePayload = (raw: unknown): CommentaryRequestPayload | null => {
  if (!isRecord(raw)) return null;
  const metaRaw = isRecord(raw.meta) ? raw.meta : null;
  const finalRaw = isRecord(raw.final) ? raw.final : null;
  const tfRaw = isRecord(raw.timeframe) ? raw.timeframe : null;
  if (!metaRaw || !finalRaw || !tfRaw) return null;

  const tfValue = toStringValue(tfRaw.tf);
  const tf: Timeframe = tfValue === "month" || tfValue === "week" || tfValue === "day" ? tfValue : "day";
  const reasons = Array.isArray(tfRaw.reasons)
    ? tfRaw.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 6)
    : [];
  const overallRaw = toStringValue(finalRaw.overall).toUpperCase();
  const overall: Overall =
    overallRaw === "GOOD" || overallRaw === "NEUTRAL" || overallRaw === "CAUTION"
      ? overallRaw
      : "NEUTRAL";
  const profileRaw = toStringValue(metaRaw.profile).toLowerCase();

  const payload: CommentaryRequestPayload = {
    meta: {
      symbol: toStringValue(metaRaw.symbol),
      name: toStringValue(metaRaw.name),
      market: toStringValue(metaRaw.market),
      asOf: toStringValue(metaRaw.asOf),
      profile: profileRaw === "mid" ? "mid" : "short",
    },
    final: {
      overall,
      confidence: toNumber(finalRaw.confidence),
      summary: toStringValue(finalRaw.summary),
    },
    timeframe: {
      tf,
      trend: toNumber(tfRaw.trend),
      momentum: toNumber(tfRaw.momentum),
      risk: toNumber(tfRaw.risk),
      reasons,
      volumeScore: tfRaw.volumeScore == null ? null : toNumber(tfRaw.volumeScore),
      volRatio: tfRaw.volRatio == null ? null : toNumber(tfRaw.volRatio),
    },
  };

  if (!payload.meta.symbol || !payload.meta.name) return null;
  return payload;
};

const extractOpenAiText = (raw: unknown): string | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.output_text === "string" && raw.output_text.trim().length > 0) {
    return sanitizeComment(raw.output_text);
  }

  const output = Array.isArray(raw.output) ? raw.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const text = toStringValue(part.text);
      if (text) return sanitizeComment(text);
    }
  }

  return null;
};

const buildPrompt = (payload: CommentaryRequestPayload): string => {
  const summary = payload.final.summary || "-";
  const reasons = payload.timeframe.reasons.length > 0 ? payload.timeframe.reasons.join(" / ") : "-";
  return [
    `종목: ${payload.meta.name}(${payload.meta.symbol})`,
    `시장: ${payload.meta.market}`,
    `타임프레임: ${toTfLabel(payload.timeframe.tf)}`,
    `판정: ${toOverallLabel(payload.final.overall)} / 신뢰도 ${Math.round(payload.final.confidence)}`,
    `점수: trend ${Math.round(payload.timeframe.trend)}, momentum ${Math.round(payload.timeframe.momentum)}, risk ${Math.round(payload.timeframe.risk)}`,
    `요약: ${summary}`,
    `근거: ${reasons}`,
    `거래량 점수: ${payload.timeframe.volumeScore ?? "-"}, volRatio: ${payload.timeframe.volRatio ?? "-"}`,
  ].join("\n");
};

const callOpenAi = async (
  env: Env,
  payload: CommentaryRequestPayload,
): Promise<{ comment: string; model: string }> => {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 미설정");
  }
  const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "한국 주식 분석 결과를 한줄 요약하세요. 투자 권유/수익보장 표현 금지. 한국어 한 문장(35자 내외)로 작성하고 개행 없이 출력하세요.",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: buildPrompt(payload) }],
          },
        ],
        temperature: 0.35,
        max_output_tokens: 90,
      }),
      signal: controller.signal,
    });

    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      const message =
        isRecord(raw) && typeof raw.error === "object" && raw.error !== null && "message" in raw.error
          ? toStringValue((raw.error as JsonRecord).message)
          : `HTTP ${response.status}`;
      throw new Error(message || `HTTP ${response.status}`);
    }

    const text = extractOpenAiText(raw);
    if (!text) throw new Error("OpenAI 응답 파싱 실패");
    return { comment: text, model };
  } finally {
    clearTimeout(timer);
  }
};

const buildCacheKey = (payload: CommentaryRequestPayload, model: string | null): string => {
  const signature = JSON.stringify({
    symbol: payload.meta.symbol,
    asOf: payload.meta.asOf.slice(0, 16),
    profile: payload.meta.profile,
    overall: payload.final.overall,
    confidence: Math.round(payload.final.confidence),
    summary: payload.final.summary,
    tf: payload.timeframe.tf,
    trend: Math.round(payload.timeframe.trend),
    momentum: Math.round(payload.timeframe.momentum),
    risk: Math.round(payload.timeframe.risk),
    volumeScore: payload.timeframe.volumeScore ?? null,
    volRatio: payload.timeframe.volRatio ?? null,
    reasons: payload.timeframe.reasons.slice(0, 4),
    model: model ?? "rule",
  });
  return `https://cache.local/commentary/v1?sig=${hashText(signature)}`;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const finalize = (response: Response): Response => attachMetrics(response, metrics);

  try {
    let rawBody: unknown;
    try {
      rawBody = await context.request.json();
    } catch {
      return finalize(badRequest("JSON 본문이 필요합니다.", context.request));
    }

    const requestPayload = parsePayload(rawBody);
    if (!requestPayload) {
      return finalize(badRequest("commentary payload 형식이 올바르지 않습니다.", context.request));
    }

    const ttlSec = timeframeCacheTtlSec("day");
    const cache = await caches.open("kis-analyzer-cache-v3");
    const targetModel = context.env.OPENAI_API_KEY ? context.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL : null;
    const cacheKey = buildCacheKey(requestPayload, targetModel);
    const cached = await getCachedJson<CommentaryPayload>(cache, cacheKey);
    if (cached) {
      metrics.apiCacheHits += 1;
      console.log(`[commentary-cache-hit] symbol=${requestPayload.meta.symbol}`);
      return finalize(
        json(cached, 200, {
          "x-cache": "HIT",
          "cache-control": `public, max-age=${ttlSec}`,
        }),
      );
    }
    metrics.apiCacheMisses += 1;
    console.log(`[commentary-cache-miss] symbol=${requestPayload.meta.symbol}`);

    const warnings: string[] = [];
    let source: CommentaryPayload["meta"]["source"] = "OPENAI";
    let model: string | null = targetModel;
    let comment: string;

    try {
      const ai = await callOpenAi(context.env, requestPayload);
      comment = ai.comment;
      model = ai.model;
    } catch (error) {
      // OpenAI가 실패해도 화면이 깨지지 않도록 규칙 기반 한줄평으로 폴백한다.
      source = "RULE";
      model = null;
      warnings.push(error instanceof Error ? error.message : "OpenAI 호출 실패");
      comment = buildRuleComment(requestPayload);
    }

    const responsePayload: CommentaryPayload = {
      meta: {
        symbol: requestPayload.meta.symbol,
        name: requestPayload.meta.name,
        asOf: requestPayload.meta.asOf,
        source,
        model,
        cacheTtlSec: ttlSec,
      },
      comment,
      disclaimer: "본 코멘트는 참고용 정보이며 투자 판단과 책임은 이용자에게 있습니다.",
      warnings,
    };

    await putCachedJson(cache, cacheKey, responsePayload, ttlSec);
    return finalize(
      json(responsePayload, 200, {
        "x-cache": "MISS",
        "cache-control": `public, max-age=${ttlSec}`,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "commentary endpoint error";
    return finalize(serverError(message, context.request));
  }
};
