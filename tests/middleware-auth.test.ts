import { describe, expect, it } from "vitest";
import { onRequest } from "../functions/_middleware";
import { hasValidSiteSession } from "../functions/lib/siteAuth";

const makeContext = (
  request: Request,
  env: Record<string, string | undefined>,
): Parameters<typeof onRequest>[0] =>
  ({
    request,
    env,
    params: {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response("next")),
    data: {},
    functionPath: "/",
  }) as unknown as Parameters<typeof onRequest>[0];

describe("site auth middleware", () => {
  it("keeps the owner login working", async () => {
    const response = await onRequest(
      makeContext(
        new Request("http://localhost/__auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            username: "owner",
            password: "owner-pass",
            redirect: "/dashboard",
          }),
        }),
        {
          SITE_AUTH_USERNAME: "owner",
          SITE_AUTH_PASSWORD: "owner-pass",
        },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
    expect(response.headers.get("set-cookie")).toContain("kis_auth_session=");
  });

  it("accepts the extra test account and creates a reusable session", async () => {
    const env = {
      ADMIN_TOKEN: "admin-token",
      SITE_AUTH_TEST_USERNAME: "tester",
      SITE_AUTH_TEST_PASSWORD: "test-pass",
    };
    const loginResponse = await onRequest(
      makeContext(
        new Request("http://localhost/__auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            username: "tester",
            password: "test-pass",
            redirect: "/",
          }),
        }),
        env,
      ),
    );

    expect(loginResponse.status).toBe(302);
    const sessionCookie = loginResponse.headers.get("set-cookie");
    expect(sessionCookie).toContain("kis_auth_session=");

    const valid = await hasValidSiteSession(
      new Request("http://localhost/api/favorites", {
        headers: {
          cookie: sessionCookie?.split(";")[0] ?? "",
        },
      }),
      env,
    );

    expect(valid).toBe(true);
  });

  it("rejects an unknown extra account password", async () => {
    const response = await onRequest(
      makeContext(
        new Request("http://localhost/__auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            username: "tester",
            password: "wrong-pass",
            redirect: "/",
          }),
        }),
        {
          SITE_AUTH_TEST_USERNAME: "tester",
          SITE_AUTH_TEST_PASSWORD: "test-pass",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("KIS Stock Analyzer");
  });
});
