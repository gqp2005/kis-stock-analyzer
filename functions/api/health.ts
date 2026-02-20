import { attachMetrics, createRequestMetrics } from "../lib/observability";
import { json } from "../lib/response";

export const onRequestGet: PagesFunction = async (context) => {
  const metrics = createRequestMetrics(context.request);
  const response = json(
    {
      ok: true,
      service: "kis-stock-analyzer",
      timestamp: new Date().toISOString(),
    },
    200,
  );
  return attachMetrics(response, metrics);
};
