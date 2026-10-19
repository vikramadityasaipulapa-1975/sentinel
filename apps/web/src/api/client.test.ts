import { afterEach, expect, test, vi } from "vitest";
import { ApiError, request, services } from "./client";
afterEach(() => vi.unstubAllGlobals());
test("client authenticates same-origin requests and validates service responses", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        services: [
          {
            id: "s1",
            name: "payment",
            owner: "demo",
            environment: "development",
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    services(await request("/api/v1/services", "test-token"))[0].name,
  ).toBe("payment");
  const options = fetcher.mock.calls[0][1];
  expect(options.headers.get("authorization")).toBe("Bearer test-token");
  expect(options.credentials).toBe("omit");
});
test("client rejects unsafe paths, invalid data and controlled API errors", async () => {
  await expect(request("https://external.invalid", null)).rejects.toThrow(
    "Unsupported API path",
  );
  expect(() => services({ services: [{ name: 1 }] })).toThrow();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Sign in again" },
        }),
        { status: 401 },
      ),
    ),
  );
  await expect(request("/api/v1/services", null)).rejects.toMatchObject({
    status: 401,
    code: "UNAUTHORIZED",
  });
});
test("network failures have a bounded safe error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("internal detail")),
  );
  await expect(request("/api/v1/services", null)).rejects.toBeInstanceOf(
    ApiError,
  );
});
