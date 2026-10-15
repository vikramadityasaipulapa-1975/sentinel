import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const target = __ENV.CHECKOUT_URL || "http://127.0.0.1:3001";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(target)) {
  throw new Error("CHECKOUT_URL must be a local HTTP origin with a port");
}
const expected = Number(__ENV.EXPECT_STATUS || "201");
if (![201, 502, 504].includes(expected))
  throw new Error("EXPECT_STATUS must be 201, 502, or 504");
const matches = new Rate("expected_status");
const maxP95 = Number(__ENV.MAX_P95_MS || "3000");
if (!Number.isFinite(maxP95) || maxP95 <= 0 || maxP95 > 10000)
  throw new Error("Invalid MAX_P95_MS");

export const options = {
  scenarios: {
    local_demo: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 20,
      maxDuration: "30s",
      gracefulStop: "0s",
    },
  },
  thresholds: {
    expected_status: ["rate==1"],
    checks: ["rate==1"],
    http_req_duration: [`p(95)<${maxP95}`],
  },
};

export default function () {
  const response = http.post(
    `${target}/checkout`,
    JSON.stringify({
      order_id: "11111111-1111-4111-8111-111111111111",
      amount_minor: 12500,
      currency: "INR",
    }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: "5s",
      redirects: 0,
    },
  );
  matches.add(response.status === expected);
  check(response, {
    "expected status": (r) => r.status === expected,
    "request ID present": (r) => Boolean(r.headers["X-Request-Id"]),
  });
  sleep(0.05);
}
