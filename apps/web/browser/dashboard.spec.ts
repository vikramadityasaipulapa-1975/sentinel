import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(process.env.SENTINEL_WEB_TEST_FIXTURE!, "utf8"),
);
async function login(page: Page, role = "viewer", path = "/dashboard/") {
  await page.goto(path);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${role}@p9.example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SENTINEL_WEB_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
test("real login, registry, keyboard skip navigation and logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("viewer@p9.example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("credentials invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SENTINEL_WEB_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Service overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "payment-service" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Skip to main content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(errors).toEqual([]);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
test("viewer reads real saved evidence, exact chart samples, citations and replay", async ({
  page,
  request,
}) => {
  await login(
    page,
    "viewer",
    `/dashboard/incidents/${fixture.incident}?investigation=${fixture.run}`,
  );
  await expect(
    page.getByRole("heading", { name: "P9 browser: payment evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "INSUFFICIENT EVIDENCE" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source snapshots" }),
  ).toBeVisible();
  await expect(
    page.getByText("PARTIAL", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start investigation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve reviewed proposal" }),
  ).toHaveCount(0);
  const samples = page.getByText(/Sample values/);
  if (await samples.count()) {
    await samples.first().click();
    const table = page.locator("figure").first().getByRole("table");
    await expect(table).toBeVisible();
    const authResponse = await request.post("/api/v1/auth/login", {
      data: {
        email: "viewer@p9.example.test",
        password: process.env.SENTINEL_WEB_TEST_PASSWORD,
      },
    });
    const access = (await authResponse.json()).access_token;
    const source = await request.get(
      `/api/v1/investigations/${fixture.run}/evidence?limit=4`,
      { headers: { authorization: `Bearer ${access}` } },
    );
    const evidence = (await source.json()).snapshots.find(
      (item: { source: string }) => item.source === "prometheus",
    ).evidence;
    const point = evidence.data.series.request_rate[0];
    await expect(
      table.locator("tbody tr").first().locator("td").nth(1),
    ).toHaveText(String(Number(point[1].toPrecision(6))));
  }
  await expect(page.getByText("Following saved and live events")).toBeVisible();
  await page.getByRole("button", { name: "Pause updates" }).click();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByText("Following saved and live events")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: "../../.artifacts/p9-evidence-desktop.png",
    fullPage: true,
  });
});
test("operator creates an incident and observes a real test-harness investigation finish", async ({
  page,
}) => {
  await login(page, "operator", "/dashboard/incidents");
  await page
    .getByRole("button", { name: "Create incident", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Service", exact: true })
    .selectOption("22222222-2222-4222-8222-222222222222");
  await page
    .getByLabel("Title", { exact: true })
    .fill("P9 browser: new incident");
  await page
    .getByRole("button", { name: "Save incident", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "P9 browser: new incident" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.getByText(/Investigation accepted:/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "INSUFFICIENT EVIDENCE" }),
  ).toBeVisible({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Mark investigating", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark mitigating", exact: true }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await login(page, "operator", url);
  await expect(
    page.getByRole("button", { name: "Mark mitigating", exact: true }),
  ).toBeVisible();
});
test("ADMIN confirms exact synthetic proposal once and backend rejects forged viewer decision", async ({
  page,
  request,
}) => {
  const session = await request.post("/api/v1/auth/login", {
    data: {
      email: "viewer@p9.example.test",
      password: process.env.SENTINEL_WEB_TEST_PASSWORD,
    },
  });
  const token = (await session.json()).access_token;
  expect(
    (
      await request.post(`/api/v1/remediations/${fixture.action}/decision`, {
        headers: { authorization: `Bearer ${token}` },
        data: { decision: "APPROVE" },
      })
    ).status(),
  ).toBe(403);
  let decisionRequests = 0;
  page.on("request", (value) => {
    if (value.method() === "POST" && value.url().endsWith("/decision"))
      decisionRequests++;
  });
  await login(page, "admin", `/dashboard/incidents/${fixture.incident}`);
  await page.getByLabel("Saved sandbox proposal").selectOption(fixture.action);
  const approve = page.getByRole("button", {
    name: "Approve reviewed proposal",
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I reviewed this exact proposal/ })
    .check();
  await expect(approve).toBeEnabled();
  await approve.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("payment-v1");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await dialog
    .getByRole("button", { name: "Confirm sandbox approval", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("APPROVED", { exact: true }).first(),
  ).toBeVisible();
  await expect(approve).toHaveCount(0);
  expect(decisionRequests).toBe(1);
});
test("URL filters, cursor pagination and responsive mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "viewer", "/dashboard/incidents");
  await page
    .getByLabel("Service filter")
    .selectOption("11111111-1111-4111-8111-111111111111");
  await expect(page).toHaveURL(/service_id=/);
  await page.getByRole("button", { name: "Older incidents" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("CLOSED");
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByText("No incidents match")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: "../../.artifacts/p9-mobile.png",
    fullPage: true,
  });
});
test("untrusted service text is escaped and a revoked session clears protected content", async ({
  page,
}) => {
  await page.route("**/api/v1/services", (route) =>
    route.fulfill({
      json: {
        services: [
          {
            id: "s",
            name: "<img src=x onerror=alert(1)>",
            owner: "synthetic",
            environment: "test",
          },
        ],
      },
    }),
  );
  await login(page);
  await expect(
    page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" }),
  ).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await page.unroute("**/api/v1/services");
  await page.route("**/api/v1/services", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: { code: "UNAUTHORIZED", message: "Synthetic revoked session" },
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh services" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});
test("missing storage shows an error, and malformed data does not become an empty success", async ({
  page,
}) => {
  await page.route("**/api/v1/incidents?**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Synthetic storage outage",
        },
      },
    }),
  );
  await login(page, "viewer", "/dashboard/incidents");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic storage outage",
  );
  await expect(page.getByText("No incidents match")).toHaveCount(0);
  await page.unroute("**/api/v1/incidents?**");
  await page.route("**/api/v1/incidents?**", (route) =>
    route.fulfill({ json: { incidents: "invalid", next_cursor: null } }),
  );
  await page.getByRole("button", { name: "Refresh incidents" }).click();
  await expect(page.getByRole("alert")).toContainText("Unexpected server list");
});

test("expired synthetic proposal keeps approval disabled", async ({ page }) => {
  let decisions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/decision"))
      decisions++;
  });
  await page.route(
    `**/api/v1/remediations/${fixture.action}`,
    async (route) => {
      const response = await route.fetch();
      const original = await response.json();
      await route.fulfill({
        json: {
          ...original,
          status: "PENDING",
          expires_at: "2020-01-01T00:00:00Z",
        },
      });
    },
  );
  await login(page, "admin", `/dashboard/incidents/${fixture.incident}`);
  await page.getByLabel("Saved sandbox proposal").selectOption(fixture.action);
  await page
    .getByRole("checkbox", { name: /I reviewed this exact proposal/ })
    .check();
  await expect(
    page.getByRole("button", {
      name: "Approve reviewed proposal",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "This proposal has expired" }),
  ).toBeVisible();
  expect(decisions).toBe(0);
});

test("mobile evidence remains readable and keyboard-scrollable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(
    page,
    "viewer",
    `/dashboard/incidents/${fixture.incident}?investigation=${fixture.run}`,
  );
  await expect(
    page.getByRole("heading", { name: "Source snapshots" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: "../../.artifacts/p9-evidence-mobile.png",
    fullPage: true,
  });
});
