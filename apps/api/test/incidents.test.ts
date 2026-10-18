import { domainAuth } from "./auth-fixture.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import {
  assertTransition,
  encodeCursor,
  eventScope,
  IncidentError,
  listScope,
  parseCreate,
  parseId,
  parseList,
  parseTransition,
  readEvent,
  statuses,
  type Incident,
  type IncidentStore,
} from "../src/incidents.js";

const serviceId = "11111111-1111-4111-8111-111111111111";
const incidentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = {
  service_id: serviceId,
  title: "Demo checkout errors",
  severity: "HIGH" as const,
};
const incident: Incident = {
  ...input,
  id: incidentId,
  status: "OPEN",
  started_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  resolved_at: null,
};

test("incident inputs require exact fields and normalize IDs/title", () => {
  assert.deepEqual(
    parseCreate({ ...input, title: "  Demo checkout errors  " }),
    input,
  );
  assert.equal(parseId(incidentId.toUpperCase()), incidentId);
  assert.equal(parseTransition({ status: "INVESTIGATING" }), "INVESTIGATING");
  for (const value of [
    null,
    [],
    {},
    { ...input, extra: true },
    { ...input, service_id: "bad" },
    { ...input, title: " " },
    { ...input, title: "x".repeat(201) },
    { ...input, title: "line\nbreak" },
    { ...input, severity: "urgent" },
    { ...input, severity: ["HIGH"] },
  ])
    assert.throws(() => parseCreate(value), IncidentError);
  for (const value of [
    { status: "wrong" },
    { status: "OPEN", title: "extra" },
    [],
    null,
  ])
    assert.throws(() => parseTransition(value), IncidentError);
});
test("all status pairs enforce the approved state machine including repeated status", () => {
  const allowed = new Set([
    "OPEN:INVESTIGATING",
    "INVESTIGATING:MITIGATING",
    "INVESTIGATING:RESOLVED",
    "MITIGATING:INVESTIGATING",
    "MITIGATING:RESOLVED",
    "RESOLVED:INVESTIGATING",
    "RESOLVED:CLOSED",
  ]);
  for (const from of statuses)
    for (const to of statuses) {
      if (from === to || allowed.has(`${from}:${to}`))
        assert.doesNotThrow(() => assertTransition(from, to));
      else
        assert.throws(
          () => assertTransition(from, to),
          (error) => error instanceof IncidentError && error.status === 409,
        );
    }
});
test("cursor validation binds history and filters and limits unsafe queries", () => {
  const cursor = encodeCursor(
    "9223372036854775807",
    listScope({ status: "OPEN", service_id: serviceId }),
  );
  assert.deepEqual(
    parseList({ limit: "2", status: "OPEN", service_id: serviceId, cursor }),
    {
      limit: 2,
      status: "OPEN",
      service_id: serviceId,
      position: "9223372036854775807",
    },
  );
  const eventCursor = encodeCursor("10", eventScope(incidentId));
  assert.equal(parseList({ cursor: eventCursor }, incidentId).position, "10");
  for (const query of [
    { limit: "0" },
    { limit: "101" },
    { limit: ["2", "3"] },
    { status: ["OPEN", "CLOSED"] },
    { status: "bogus" },
    { service_id: "bad" },
    { unexpected: "x" },
    { cursor },
    { cursor: "x".repeat(513) },
    { cursor: "!!!!" },
    { cursor: eventCursor },
  ])
    assert.throws(() => parseList(query), IncidentError);
  assert.throws(() => parseList({ status: "OPEN" }, incidentId), IncidentError);
  assert.throws(
    () =>
      parseList(
        { cursor: encodeCursor("2", eventScope(serviceId)) },
        incidentId,
      ),
    IncidentError,
  );
  for (const position of ["0", "-1", "01", "9223372036854775808"])
    assert.throws(() => encodeCursor(position, "scope"));
});
test("incident HTTP contracts validate bodies, errors, limits, correlation and log redaction", async (t) => {
  let mode = "healthy";
  const store: IncidentStore = {
    ready: async () => mode !== "unavailable",
    create: async (body) => {
      if (mode === "unavailable")
        throw new IncidentError(
          503,
          "DATABASE_UNAVAILABLE",
          "Incident storage unavailable",
        );
      assert.deepEqual(body, input);
      return incident;
    },
    list: async (options) => {
      assert.equal(options.limit, 20);
      return { incidents: [incident], next_cursor: null };
    },
    get: async (id) => {
      if (id !== incidentId)
        throw new IncidentError(
          404,
          "INCIDENT_NOT_FOUND",
          "Incident not found",
        );
      return incident;
    },
    transition: async (_id, status) => {
      assertTransition("OPEN", status);
      return { ...incident, status };
    },
    events: async () => ({ events: [], next_cursor: null }),
  };
  const logs: Record<string, unknown>[] = [];
  const server = createApp(
    { ready: async () => true, list: async () => [] },
    (record) => logs.push(record),
    store,
    domainAuth,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/incidents`;
  const request = (path = "", options: RequestInit = {}) =>
    fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
  const json = (method: string, body: unknown) => ({
    method,
    headers: {
      "content-type": "application/json",
      "x-request-id": incidentId,
      authorization: "secret-marker",
    },
    body: JSON.stringify(body),
  });
  try {
    await t.test(
      "create, list, detail, events and allowed status change",
      async () => {
        const response = await request("", json("POST", input));
        assert.equal(response.status, 201);
        assert.equal(
          response.headers.get("location"),
          `/api/v1/incidents/${incidentId}`,
        );
        assert.equal(response.headers.get("x-request-id"), incidentId);
        assert.deepEqual(await response.json(), incident);
        assert.deepEqual(await (await request()).json(), {
          incidents: [incident],
          next_cursor: null,
        });
        assert.deepEqual(
          await (await request(`/${incidentId}`)).json(),
          incident,
        );
        assert.deepEqual(
          await (await request(`/${incidentId}/events`)).json(),
          { events: [], next_cursor: null },
        );
        assert.equal(
          (
            await request(
              `/${incidentId}`,
              json("PATCH", { status: "INVESTIGATING" }),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "validation, unsupported media, missing incident and forbidden transition",
      async () => {
        const cases: [string, RequestInit, number, string][] = [
          ["", json("POST", { ...input, title: "" }), 422, "INVALID_INCIDENT"],
          ["", { method: "POST", body: "text" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
          ["/bad", {}, 422, "INVALID_INCIDENT"],
          [`/${serviceId}`, {}, 404, "INCIDENT_NOT_FOUND"],
          [
            `/${incidentId}`,
            json("PATCH", { status: "CLOSED" }),
            409,
            "INVALID_STATUS_TRANSITION",
          ],
          ["?cursor=bad", {}, 400, "INVALID_CURSOR"],
          ["?status=OPEN&status=CLOSED", {}, 422, "INVALID_INCIDENT"],
          [
            "",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{",
            },
            400,
            "INVALID_JSON",
          ],
          [
            "",
            json("POST", { ...input, title: "secret-marker".repeat(1000) }),
            413,
            "PAYLOAD_TOO_LARGE",
          ],
        ];
        for (const [path, options, expected, code] of cases) {
          const response = await request(path, options);
          assert.equal(response.status, expected);
          const body = await response.json();
          assert.equal(body.error.code, code);
          assert.equal(body.request_id, response.headers.get("x-request-id"));
        }
      },
    );
    await t.test(
      "storage outage produces 503 and affects readiness",
      async () => {
        mode = "unavailable";
        assert.equal((await request("", json("POST", input))).status, 503);
        assert.equal(
          (await fetch(`http://127.0.0.1:${address.port}/ready`)).status,
          503,
        );
      },
    );
    assert.ok(!JSON.stringify(logs).includes("secret-marker"));
    assert.ok(!JSON.stringify(logs).includes(incidentId + "/events"));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});

test("stored PARTIAL investigation events are readable and invalid events stay rejected", () => {
  const investigationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const row = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    incident_id: incidentId,
    investigation_id: investigationId,
    sequence: "10",
    type: "INVESTIGATION",
    payload_json: {
      investigation_id: investigationId,
      status: "PARTIAL",
      event: "PARTIAL",
      attempt: "1",
    },
    occurred_at: new Date("2026-10-18T08:38:52Z"),
    created_at: new Date("2026-10-18T08:38:52Z"),
  };
  assert.equal(readEvent(row).payload.event, "PARTIAL");
  for (const payload of [
    { ...row.payload_json, event: "UNKNOWN" },
    { ...row.payload_json, status: "UNKNOWN" },
    { ...row.payload_json, investigation_id: serviceId },
    { ...row.payload_json, attempt: "4" },
  ])
    assert.throws(
      () => readEvent({ ...row, payload_json: payload }),
      /Invalid stored incident event/,
    );
});
