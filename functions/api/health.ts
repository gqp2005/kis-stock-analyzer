import { json } from "../lib/response";

export const onRequestGet: PagesFunction = async () => {
  return json(
    {
      ok: true,
      service: "kis-stock-analyzer",
      timestamp: new Date().toISOString(),
    },
    200,
  );
};

