# P1 learning guide: demo services and HTTP foundations

Repository root: `V:\sentinel\sentinel`. All PowerShell commands start there unless
stated otherwise. This is a local educational system: payments are simulated,
not real charges. There is no persistence, authentication, or production deployment.

## Approval checkpoint and scope

The user authorized completing P1.3 through P1.7 in one run, with complete learning
documentation and regression verification. This supersedes stopping for approval
between those tasks. It does not authorize P2. Student answers and independent
exercises remain pending until the student performs them.

## P1.1 and P1.2 reference

Git records reviewed snapshots; npm workspaces give the checkout service its own
package while retaining one root lockfile. See README.md for the build/run commands
and docs/PROGRESS.md for historical measured results and pending exercises.

Checkout's app factory defines routes without opening a port. Its server entry
point opens the local listener. TypeScript checks types, emits JavaScript into
ignored dist output, and Node executes that JavaScript. Runtime HTTP validation
is separate from TypeScript checking. Existing health/404 tests remain regressions.

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
{"order_id":"11111111-1111-4111-8111-111111111111","amount_minor":12500,"currency":"INR"}
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
