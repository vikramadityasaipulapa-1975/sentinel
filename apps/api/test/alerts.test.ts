import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAlert, readWebhookSecret } from "../src/alert-ingestion.js";
import { alertFixture } from "./alert-database-checks.js";

test("alert inputs bind group identity and canonical timestamps; secret validation fails closed", () => {
  assert.equal(readWebhookSecret({}), undefined);
  assert.throws(() =>
    readWebhookSecret({ SENTINEL_ALERT_WEBHOOK_SECRET: "not-a-key" }),
  );
  const body = alertFixture();
  assert.equal(
    parseAlert(body).key,
    parseAlert({ ...body, groupKey: "untrusted-extra-key" }).key,
  );
  for (const bad of [
    null,
    {},
    { ...body, status: "resolved" },
    { ...body, alerts: [] },
    { ...body, alerts: [{ ...body.alerts[0], startsAt: "bad" }] },
    {
      ...body,
      alerts: [
        {
          ...body.alerts[0],
          startsAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    },
  ])
    assert.throws(() => parseAlert(bad));
});
