export const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

export const badRequest = (message: string): Response =>
  json(
    {
      error: message,
    },
    400,
  );

export const serverError = (message: string): Response =>
  json(
    {
      error: message,
    },
    500,
  );

