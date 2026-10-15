# P1 learning guide: demo services and HTTP foundations

Repository root: `V:\sentinel\sentinel`. All PowerShell commands start there unless
stated otherwise. This is a local educational system: payments are simulated,
not real charges. There is no persistence, authentication, or production deployment.

## Approval checkpoint and scope

The user authorized completing P1.3 through P1.7 in one run, with complete learning
documentation and regression verification. This supersedes stopping for approval
between those tasks. It does not authorize P2. Student answers and independent
exercises remain pending until the student performs them.

## P1.1: repository and reproducible setup

### Concept

Git records reviewed file snapshots. Editing changes the working tree; staging
selects changes; committing records a local snapshot; pushing publishes commits.
A remote is a named repository connection. npm installs packages and runs commands;
Node executes JavaScript outside the browser. TypeScript checks source types and
compiles source to JavaScript. package.json declares dependencies and commands;
package-lock.json records exact resolved versions and integrity metadata.

### Architecture/data flow

Project configuration -> npm install (intentional dependency update) -> lockfile ->
npm ci (reproduce locked installation) -> ignored node_modules. Reviewed files ->
Git staging -> local commit. No runtime API or database existed at P1.1.

### File plan and approval checkpoint

The user approved using the already initialized V:\sentinel\sentinel repository.
AGENTS.md and the master plan were copied inside it, preserving their text except
trailing blank lines. README.md explains setup; .gitignore excludes generated and
secret files; docs/PROGRESS.md records evidence; package.json/package-lock.json
establish the npm package. Existing origin was retained. No GitHub push occurred.

### Implementation and walkthrough

private: true prevents accidental npm publication. engines documents Node 24/npm
11 support, but npm can warn rather than enforce these versions. .gitignore permits
.env.example and excludes .env files; it cannot erase secrets already committed.
There were no runtime/development packages at P1.1; later phases add them deliberately.

### Run/test

```powershell
git rev-parse --show-toplevel
git remote -v
npm ci
git check-ignore --no-index .env
git check-ignore --no-index .env.example
git status --short
```

Expected: correct root/remote, successful install, .env ignored (exit 0), example
not ignored (exit 1). A committed unchanged checkout has empty status. Negative:
in a disposable folder containing package.json but no lockfile, npm ci rejects
installation with EUSAGE. Never remove the real lockfile for that exercise.

### Debug

Wrong folder causes "not a git repository". Lock mismatch calls for reviewing the
intentional manifest change, not blindly regenerating the lock. Missing Git identity
requires setting the intended user.name/user.email. npm ci may recreate workspace
links; Windows permissions must permit them. Keep generated tools/reports ignored.

### Understanding check

1. What is staging compared with committing?
2. Why commit a lockfile but ignore installed packages?
3. Why does .gitignore fail to protect a secret already committed?

Exercise: add a README sentence in your own words; explain git diff -- README.md.

### Commit summary

P1.1 foundation: d5f368c. Measured installation/ignore results are in PROGRESS.md.

## P1.2: checkout health server

### Concept

HTTP requests have a method and path; responses have status, headers and body.
A host identifies a machine; a port identifies a listener; a route matches a
method/path. Express dispatches routes and ordered middleware. A GET reads state;
200 signals success; 404 means no handler matched. JSON is a data interchange format.

### Architecture/data flow

Client -> loopback port 3001 -> Node/Express -> GET /health -> fixed JSON 200.
Unknown routes go to final 404 middleware. Health proves responsiveness only.

### File plan and approval checkpoint

The user approved app.ts, server.ts, TypeScript configuration, checkout tests,
workspace manifests and documentation. No later service or infrastructure was
created prematurely. P1.2 implementation was approved separately.

### Implementation and walkthrough

createApp() constructs routes without binding a port; server.ts starts listening.
The health handler receives request/response objects and sends status plus JSON.
Middleware order determines whether the route or fallback responds. TypeScript
strict checks catch source errors; noEmitOnError prevents new broken build output.
ES module imports use .js extensions corresponding to emitted output. A workspace
isolates service dependencies while the root lockfile locks the whole npm tree.

The tests await server readiness, fetch HTTP responses, then close connections in
teardown. Tests select temporary ports, not the regular development port. In P1.6,
the simple fallback is upgraded to an error boundary and startup logs become JSON.
Original health response stays unchanged.

### Run/test

```powershell
npm ci
npm run build
npm test
npm run start:checkout
```

In another terminal, GET http://127.0.0.1:3001/health returns
`{"status":"ok","service":"checkout-service"}` with 200 and JSON content type.
GET /unknown and POST /health return 404. Starting a second copy while the first
owns port 3001 must fail with EADDRINUSE and exit 1. Stop with Ctrl+C.

### Debug

Connection refused means inspect startup/port. Unexpected 404 means inspect the
method and path. Old behavior after editing means rebuild and restart. TypeScript
does not validate HTTP input at runtime; P1.5 explicitly adds that boundary.

### Understanding check

1. How does a port differ from a route?
2. Why separate app construction from listening?
3. Why can health pass even when a dependency is down?

Exercise: add a component field to health and update the exact-body test.

### Commit summary

P1.2 health server: 61eed70. Three initial HTTP tests and occupied-port checks passed.

## P1.3: Python payment health server

### Concept

A virtual environment isolates Python packages. FastAPI maps HTTP routes to Python
functions. Uvicorn is an ASGI server: it translates network requests into the
asynchronous interface FastAPI understands. Pydantic supplies runtime schemas.
OpenAPI is a machine-readable API description; /docs renders an interactive UI.
Compared with a second Express service, FastAPI gives cross-language HTTP practice
and generated schemas, at the cost of another runtime and dependency environment.

### Architecture/data flow

Client -> local Uvicorn port 3002 -> FastAPI -> /health handler -> 200 JSON.
No payment or database call occurs. An async function can yield during future I/O;
this health function just returns a small dictionary. FastAPI serializes it.

### File plan and implementation

- services/payment-service/main.py: create_app() takes no arguments, returns a
  FastAPI application; module-level app is Uvicorn's import target.
- requirements.in: direct dependency ranges; requirements.txt: exact resolved
  versions including transitives, generated inside the project virtual environment.
- test_main.py: TestClient calls the ASGI application in-process (not a TCP test).
  Each context closes its resources. Assertions cover health, OpenAPI/docs, and 404.

### Walkthrough

The decorator @app.get registers a route. health() returns a dictionary, not an
HTTP socket. Uvicorn owns sockets; FastAPI owns routing/serialization. Importing
main creates an app but does not start a server. Separating these boundaries makes
tests possible without claiming in-process tests prove network startup.

### Run/test

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/payment-service/requirements.txt
.\.venv\Scripts\python.exe -m pytest services/payment-service -q
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir services/payment-service --host 127.0.0.1 --port 3002 --no-access-log
```

In another terminal: `curl.exe -i http://127.0.0.1:3002/health` should return 200
with status ok and service payment-service. /openapi.json should list /health;
/docs should return HTML (its interactive assets may require internet access).
Negative: /unknown returns 404. Stop Uvicorn with Ctrl+C.

### Debug

Use the virtual environment's explicit executable to avoid PowerShell activation
policy issues. ModuleNotFoundError usually means the wrong interpreter or app-dir.
Address-in-use means an existing listener owns port 3002; stop only your own server.

### Understanding check

1. What does Uvicorn do that FastAPI does not?
2. Why use a virtual environment?
3. How does an in-process TestClient check differ from a real HTTP smoke test?

Exercise: add a fixed component field to payment health and update its test.

### Commit summary

P1.3 adds the payment HTTP foundation only; later sections document subsequent
changes to these same files. Actual command results are recorded in PROGRESS.md.

## P1.4: validated demo payments

### Concept and architecture/data flow

A JSON contract specifies names, types, bounds, and allowed values. HTTP JSON ->
Pydantic PaymentRequest -> route -> PaymentResponse -> JSON 201. Invalid input
stops before the route and returns 422. Type annotations alone are not validation;
Pydantic performs the actual runtime checks. FastAPI publishes these schemas in
OpenAPI. Response validation catches programming mistakes in server output.

### File plan, implementation, and walkthrough

models.py defines PaymentRequest and PaymentResponse. UUID order_id strings become
UUID objects. amount_minor is a strict integer from 1 to 100,000,000: booleans,
floating point numbers, numeric strings, and nonpositive values are rejected.
currency is exactly INR or USD. Extra fields are forbidden, including card data.
Integer minor units avoid binary floating-point rounding; 12500 means INR 125.00
or USD 125.00 under this deliberately small currency set.

PaymentResponse inherits the request fields and adds a generated UUID payment_id
and fixed succeeded status. main.py's create_payment(payment) returns that model.
model_dump() produces its field mapping; uuid4() generates the demo identifier.
No asynchronous I/O occurs yet. Each valid request generates another simulated
result: no retry/idempotency/persistence guarantees until P2.

### Approval checkpoint

Covered by the user's approval to finish P1; no production payments authorized.

### Run/test

Run `.\.venv\Scripts\python.exe -m pytest services/payment-service -q`.
Positive: POST /payments with the following body returns 201 and a payment UUID:

```json
{
  "order_id": "11111111-1111-4111-8111-111111111111",
  "amount_minor": 12500,
  "currency": "INR"
}
```

From PowerShell while payment is running:

```powershell
$body = '{"order_id":"11111111-1111-4111-8111-111111111111","amount_minor":12500,"currency":"INR"}'
Invoke-RestMethod http://127.0.0.1:3002/payments -Method Post -ContentType 'application/json' -Body $body
```

Negative tests cover zero/negative/oversized amounts, strings, booleans, fractions,
bad UUID, unsupported currency, extra fields, and missing required fields: 422.
The existing health/OpenAPI/404 tests must continue to pass.

### Debug

422 means the boundary rejected the request; check the types and field names.
Do not add real banking fields to get past validation. Later error handling
deliberately avoids echoing rejected input values. No database schema changes.

### Understanding check

1. Why is 12500 stored instead of 125.00?
2. How is TypeScript checking different from Pydantic validation?
3. Why would blindly retrying this endpoint be unsafe for real payments?

Exercise: try amount_minor as a quoted string, then an integer; explain the result.

### Commit summary

P1.4 adds request/response models, POST /payments, and validation regressions.

## P1.5: checkout calls payment over HTTP

### Concept

Service discovery means knowing the downstream address. In P1 it is a configured
local origin, not a registry. A timeout bounds waiting; it does not prove the
remote action never happened. async/await pauses a function while I/O completes
without blocking the Node event loop. No automatic retries are safe yet.

### Architecture/data flow

POST /checkout -> JSON parser (8 KiB) -> runtime contract check -> POST /payments
with a 2-second deadline -> validate downstream status/body -> 201 payment result.
An unavailable dependency yields 502; expiration yields 504. Invalid checkout is
422; unsupported content type 415. No database schema, stored order, or real money.

### Approval checkpoint

Covered by approval through P1.7. Ports/targets are local demo services only.

### File plan, implementation, walkthrough

- contracts.ts: interfaces document request/response types. isPaymentRequest takes
  unknown and returns a type predicate after checking required fields, types,
  UUID syntax, integer amount bounds and currency. It rejects extra fields.
  isPaymentResponse also checks that payment echoes the requested amount, currency,
  and order (UUID comparison ignores letter case).
- config.ts: readConfig(env) defaults to process.env; returns validated origin and
  bounded timeout. Invalid configuration fails before listening. PAYMENT_URL may
  only be a local HTTP origin; request bodies cannot change it (SSRF boundary).
- payment-client.ts: pay(request, config) returns a Promise of validated payment.
  It sends one POST, rejects redirects, caps response data at 16 KiB, and applies
  a deadline to headers and body. PaymentError carries safe status/code, never raw
  downstream text. Reader cleanup happens in finally, including validation errors.
- app.ts: JSON middleware precedes checkout. The handler checks media/input, awaits
  pay, and converts expected dependency failures into controlled errors.
- checkout.test.ts: real local HTTP against a clearly labeled payment test double;
  covers success, unavailable dependency, timeout, malformed JSON, mismatched order
  fields, oversized upstream response, invalid inputs/configuration.
- .env.example: documents nonsecret values; neither app automatically loads it.
  The root npm test command now discovers both test files.

### Run/test

Start payment as in P1.3; in a second terminal run `npm run build` then
`npm run start:checkout`. In a third:

```powershell
$body = '{"order_id":"11111111-1111-4111-8111-111111111111","amount_minor":12500,"currency":"INR"}'
Invoke-RestMethod http://127.0.0.1:3001/checkout -Method Post -ContentType 'application/json' -Body $body
```

Expected: succeeded status, payment UUID, echoed request fields. Stop payment and
repeat: controlled 502. `npm test` builds and runs positive/negative regressions.
For configuration, before starting checkout:

```powershell
$env:PAYMENT_URL = 'http://127.0.0.1:3002'
$env:PAYMENT_TIMEOUT_MS = '2000'
```

### Debug and risks

502: confirm payment is listening and speaks the expected contract. 504: inspect
dependency delay and client deadline. A timeout is an uncertain outcome, not proof
of no payment; idempotency belongs to P2. Changing an environment variable affects
new processes only. .env.example is reference, not an automatic configuration loader.

### Understanding check

1. Why validate a response from our own payment service?
2. Why do we bound both response bytes and elapsed time?
3. Why is retrying a timeout different from retrying a health GET?

Exercise: change PAYMENT_TIMEOUT_MS within its allowed range and observe a delayed
test payment. Restore it afterward; never infer an actual charge from this demo.

### Commit summary

P1.5 adds a bounded HTTP dependency call and controlled failure responses.

## P1.6: request IDs, structured logs, intentional errors

### Concept

Correlation IDs connect records from the same request across services. They are
identifiers, not authentication. JSON logs are machine-readable records with
explicit keys; info/warn/error describe outcome severity. An exception boundary
translates internal failures into stable public errors without exposing secrets.

### Architecture/data flow

Checkout validates X-Request-ID as UUID (otherwise generates one) -> response header
and local request context -> outgoing payment header -> payment reuses the ID ->
both emit completion records with the same ID. Errors return
`{error:{code,message},request_id}`. Successful health/payment bodies stay compatible.
UTC timestamps record log time; duration_ms uses a monotonic clock for elapsed time.

### Approval checkpoint

Covered by the approved P1 scope. These are local demo logs, not centralized Loki.

### File plan, implementation, walkthrough

- checkout http.ts: requestContext(log) returns middleware. It selects a safe ID,
  adds the response header, registers a finish callback, then calls next(). The
  callback writes only allowlisted fields. HttpError carries public status/code/
  message. handleError has Express's four-argument signature and maps malformed
  JSON (400), body limit (413), expected errors, and unexpected errors (500).
- app.ts: context precedes JSON parsing so parser errors also have IDs; the error
  handler is last. Express forwards async handler failures to that handler.
- payment-client.ts: pay now receives requestId and forwards it, without forwarding
  credentials or arbitrary client headers. server.ts emits JSON startup records
  and reports invalid configuration without echoing environment values.
- payment observability.py: RequestContext is ASGI middleware. **call** takes
  scope (request metadata), receive (input messages), send (output messages).
  It buffers at most 8 KiB of request body, then replays it to FastAPI; oversized
  input returns 413, including chunked requests. Lifespan messages pass through.
  The send wrapper adds the ID header. finally emits a safe completion record.
- main.py: exception handlers return sanitized 422/HTTP/500 errors. Pydantic's
  raw errors can contain rejected inputs; we intentionally do not return those.
- logging.test.ts/test_main.py: capture log records, inject fake secret markers in
  query/body/header/exception, and verify absence from logs/public errors. This is
  a targeted regression check, not a claim of a full security audit.

### Run/test

```powershell
npm test
.\.venv\Scripts\python.exe -m pytest services/payment-service -q
curl.exe -i -H 'X-Request-ID: 33333333-3333-4333-8333-333333333333' http://127.0.0.1:3001/health
```

Expected: tests pass; response header contains the supplied UUID. Positive
completion logs include timestamp, level, service, event, request_id, route, status,
duration_ms. Negative malformed/oversized/invalid payload tests produce bounded
errors and safe IDs; invalid incoming IDs are replaced. Payment's malformed JSON
is 422 through FastAPI's validation path; checkout parser returns 400.

### Debug and security boundaries

Search both service outputs for the same request_id. An unknown route is logged as
unmatched; query strings, raw paths, bodies, authorization headers, and raw exception
messages are excluded. Existing client code asserting the entire 404 body must now
allow the added request_id. Request IDs alone never authorize an action.
Uvicorn startup/shutdown messages are server diagnostics; application completion
logs are JSON. Start Uvicorn with --no-access-log to avoid raw URL access records.
No trace IDs or centralized observability backend are implemented in P1.

### Understanding check

1. Why must request context run before JSON parsing?
2. Why exclude query strings as well as authorization headers from logs?
3. What does a matching ID across two services prove, and what does it not prove?

Exercise: supply a valid UUID, then a malformed ID, and compare response headers.

### Commit summary

P1.6 adds safe correlated logs and consistent error envelopes with regression tests.

## P1.7: deterministic faults and load generation

### Concept

Fault injection deliberately creates a known failure so we can compare expected
behavior with observations. Deterministic means the same configured mode produces
the same kind of outcome, not identical timestamps/UUIDs/latencies. We use no random
fault selection. A latency fault yields while sleeping, so it does not block all
requests. A status fault returns a fixed 503. Health remains responsive.

k6 generates HTTP traffic and measures response durations/failure counts. A virtual
user executes the script; one user and 20 iterations keep this educational run
small. p95 is the 95th percentile of measured durations: roughly 95% are no slower
than that value. With only 20 requests it is noisy, not a production benchmark.
Thresholds turn expected observations into an executable pass/fail condition.

### Architecture/data flow

Startup environment -> immutable validated Settings -> payment route -> normal
result, fixed async delay, or fixed 503 -> checkout's normal dependency boundary
-> 201, 502, or 504. A fault_injected JSON record marks deliberate faults.
k6 -> real checkout -> real payment -> measured summary. No Prometheus/Loki/traces
exist yet: these observations are HTTP timings/statuses and local application logs.

### Approval checkpoint

Authorized to finish P1, including small local fault/load demonstrations. No P2
schema/container work, external deployment, or production remediation is included.

### File plan, implementation, walkthrough

- payment config.py: Settings is an immutable dataclass. Constructor defaults to
  normal and a 500 ms delay. **post_init** rejects unknown mode/out-of-range delay.
  from_env reads process settings once at app creation. Request inputs never set it.
- main.py: create_app accepts optional settings for tests. create_payment records
  explicit fault metadata, returns sanitized 503 in error mode, or awaits
  asyncio.sleep in latency mode before generating the usual simulated response.
  Health is separate. No real payment or database work exists after the delay.
- test_main.py: verifies normal default, repeated errors, delay lower bound, invalid
  settings, and attempts to enable faults through requests. Existing tests remain.
- scripts/load-checkout.js: k6-specific imports (not Node). Validates local target,
  expected status and p95 bound, then posts the same documented demo contract.
  Rate records agreement with the expected status; checks also require an ID header.
  Per-request timeout is 5 seconds, redirects disabled, scenario capped at 30 seconds.
- scripts/setup-k6.ps1: downloads a pinned official portable release, verifies the
  publisher's SHA256 manifest, extracts under ignored .tools, and checks version.
  This is a local tool, not a system service. No PATH changes. The matching
  checksum is integrity evidence, not independent authentication of the publisher.
- scripts/verify-p1.py: first marks its report RUNNING and refuses occupied ports.
  It runs npm/Python regressions and formatting checks with bounded subprocesses.
  run_scenario(name, mode, expected, delay, timeout, k6) starts real Uvicorn and Node
  processes with isolated child environments, waits for health, submits three
  checkouts and validates statuses/IDs. Selected scenarios also run k6. ExitStack
  owns log files, while finally terminates only owned children, with a bounded kill
  fallback if needed. Logs are parsed after process exit; shared IDs and absence
  of fake secret markers are verified. Failure marks the current report FAILED,
  never leaving an old successful report current. An explicit skip is recorded.
- pyproject.toml: project-local Python lint/format and test-path settings.
  Prettier is pinned in the root npm package for consistent TS/JS/JSON/Markdown;
  it changes formatting, not HTTP behavior. npm format:check verifies it.
- .env.example and .gitignore: document fault configuration; keep .tools and
  .artifacts generated output out of history. README is the quick-start index.

### Run/test

Complete setup from README, then stop manual services and run:

```powershell
.\scripts\setup-k6.ps1
npm run verify:p1
```

Expected: checkout/payment regression suites pass, Ruff/Prettier pass, seven
integration scenarios pass, and three 20-request loads meet thresholds. Report:
.artifacts/p1-verification.json; service logs and raw k6 summaries sit alongside it.
Checks exercise real Node/Python TCP calls, unlike payment's in-process unit tests.

| Scenario            | Configuration                  | Expected checkout            |
| ------------------- | ------------------------------ | ---------------------------- |
| normal-a / normal-b | normal; 2000 ms deadline       | 201 in both independent runs |
| error-a / error-b   | payment 503; 2000 ms deadline  | controlled 502 in both runs  |
| latency             | 100 ms sleep; 2000 ms deadline | 201 with observable delay    |
| timeout             | 600 ms sleep; 200 ms deadline  | controlled 504               |
| unavailable         | no payment listener            | controlled 502               |

Positive: default normal payments, delayed-but-successful payments, shared IDs.
Negative: configured 503/timeout/unavailable dependency, invalid fault settings,
request attempts to activate faults, nonlocal load target and invalid expected
status rejected before load traffic. Details/measured results: PROGRESS.md.

For a manual load while normal services run:

```powershell
.\.tools\k6\k6-v1.8.2-windows-amd64\k6.exe run --no-usage-report scripts/load-checkout.js
```

For an injected error run, restart payment with PAYMENT_FAULT_MODE=error and use
`--env EXPECT_STATUS=502`. For timeout, set payment delay above the checkout deadline
and use EXPECT_STATUS=504. Do not enable faults by editing application source.

### Debug, interpretation, and risks

An expected fault can have k6 http_req_failed=100% while the fault test passes:
HTTP failures are the intended observation; expected_status and checks must be
100%. A normal run unexpectedly returning 502 fails those thresholds. The p95
threshold is deliberately loose (3000 ms) for functionality, not a latency SLO.
Timing evidence differs across hardware, process startup and scheduling.

If ports are occupied, stop your own manual services before verification. Do not
run concurrent verifier copies. Restore fault mode normal and restart after manual
experiments. A 504 may occur before payment finishes; the log can later show 201.
This is why P2 needs idempotency and durable records. The fault-injected service
remains responsive, so a green health endpoint is not proof of working checkout.

The report is generated evidence, not committed source. The progress log contains
a dated human-readable snapshot with sample counts and limitations. Test results
do not substitute for the learner completing the explanation/exercise.

### Understanding check

1. Why does an async delay preserve health responsiveness?
2. Why can a correct fault test show 100% HTTP request failures?
3. What does p95 from 20 local requests tell you, and what does it not tell you?

Exercise: choose latency below the checkout deadline, verify 201, then choose a
delay above it, verify 504. Explain both logs using one request ID; restore normal.

### Commit summary

P1.7 adds bounded deterministic faults, k6, real-service regression orchestration,
and complete P1 reference documentation. P2 remains outside the approved scope.

## Final learner checklist (all phases)

- Draw input -> validation -> dependency -> response -> log, including error paths.
- Explain which checks run in-process, with a test double, and against real services.
- Run the documented setup and checks without Codex.
- Complete each small exercise and explain the observed diff/test result.
- Review PROGRESS.md; pending learner work is not automatically marked complete.
