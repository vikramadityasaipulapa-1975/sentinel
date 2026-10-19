# P9: React dashboard and user experience

Approved scope: P9.1–P9.6, after the six-task concepts/architecture/files/tests
explanation. Each task is implemented, checked, documented and committed separately.
No cloud resource, paid service or real remediation is included.

## Shared concept and architecture

React components render server data; state controls the current interface; hooks
start/cancel asynchronous reads. TypeScript catches shape mistakes during build,
while runtime readers validate incoming JSON. React Router maps URLs to pages.
Vite supplies development/build tooling, Vitest tests components and API handling,
and Playwright checks real browser behavior. No Redux or external UI kit is needed.

Browser → authenticated API → PostgreSQL; queued investigations run in the existing
worker/engine. Progress comes from authenticated fetch/SSE and durable event replay.
The browser never gets database, collector or Docker credentials. Tokens remain in
memory; refresh requires login. Frontend role controls supplement backend RBAC.

Development runs at http://localhost:5173/dashboard/ with an /api proxy to 3000.
Production assets are built into apps/web/dist and served by the existing API at
/dashboard/. Deep links return the application shell, unknown API paths remain API
errors and missing asset files return 404. Existing /auth-test remains available.
Public hosting still needs the separately documented P5–P8 deployment adaptations.

## P9.1 — Foundation, authentication and service overview

### Concept → Architecture/data flow → File plan

The first screen replaces manual service JSON reads with an authenticated registry
view. Registry presence is not a health claim. Login returns a short-lived token;
SessionProvider keeps it only in React state and clears it on expiry, sign-out or 401. Concurrent/stale login responses cannot resurrect a signed-out session.

- apps/web/package.json, tsconfig.json, vite.config.ts, index.html: pinned workspace,
  strict TS, Vite development proxy/build and Vitest setup. Node 24.11 is supported;
  jsdom 29 is pinned because the newest major needs a later Node minor.
- src/main.tsx and App.tsx: mount the session/router, protected layout, overview and
  unknown-route screen. src/styles.css/tokens.css: reusable accessible color tokens.
- src/api/client.ts: request(path, token, options, signal) returns parsed unknown
  JSON or throws ApiError with safe message/request ID. Requests have deadlines,
  omit cookies, and allow only /api/v1 paths. Runtime readers reject malformed data.
- src/auth/Session.tsx: login, logout, api and an expiry timer. Context shares the
  current profile without prop chains. Password state is cleared after submission.
- src/pages/Login.tsx/Services.tsx: controlled form and service cards; loading,
  network/validation errors, empty registry and manual refresh are explicit.
- src/components/Common.tsx: notice, badges, timestamps and abortable read hook.
  useLoad aborts on unmount/dependency changes so late replies cannot replace data.
- apps/api/src/dashboard.ts and app.ts: serve built assets/deep links with CSP.
  No database migration or auth contract change is required.
- Tests: client/App component tests and built-asset HTTP route integration check.

### Approval checkpoint → Implementation

The user approved all six task plans before source/dependency changes. This task
adds only foundation behavior; later incident/evidence/action pages follow below.

### Run/test → Debug

From the repository root:

```powershell
npm ci
npm run build --workspace=@sentinel/web
npm run build --workspace=@sentinel/api
npm run test:web
node --test apps/api/dist/test/dashboard.test.js
npm run dev:web
```

Expected development URL: http://localhost:5173/dashboard/. Keep api-local.py and
Docker dependencies running. Built same-origin assets need an API restart once the
new serving code is compiled. There are no new manual credentials or cloud steps.

Positive coverage: login/service response rendering, sign-out removal, correct
Bearer header and built/deep-link asset serving. Negative coverage: wrong login,
unsafe request path, malformed service data, missing assets and network/API errors.
Mock tokens/data are explicitly synthetic. Asset HTTP tests run a real local server.
Actual measured results are in PROGRESS.md; tests are not assumed passed.

If API tests say the dashboard is missing, build apps/web first. If dev login cannot
connect, check API /ready and the Vite proxy, not permissive CORS. Reload clears the
session by design. Never put database secrets in Vite/browser environment variables.

### Understanding check

1. Why are TypeScript types insufficient to trust incoming JSON?
2. Why must useLoad cancel pending reads when navigation changes?
3. What distinguishes a registered service from a healthy service?

Exercise: change the empty registry sentence and verify the relevant screen test.
Learner answers/independent changes are pending.

### Commit summary

feat(P9.1): add authenticated React dashboard and service overview

## P9.2 — Incident list/detail, filtering and status

### Concept → Architecture/data flow → File plan

Filters/pagination are URL state; records remain PostgreSQL state. The Incidents
page reads /incidents?status=&service_id=&cursor= with a bounded page size. Filter
changes clear the cursor. Detail links contain the server ID. Refresh and writes
reload confirmed server state rather than inventing optimistic state.

- src/api/incidents.ts validates incident/page status and fields and describes the
  existing status-transition choices. It does not authorize backend writes.
- src/pages/Incidents.tsx uses URL search parameters, abortable reads and a
  controlled creation form. The service registry supplies human-readable labels.
  A ref blocks duplicate submissions before React's busy state rerenders.
- src/pages/IncidentDetail.tsx loads an incident by route parameter, displays
  dates/severity/status and offers allowed transitions to OPERATOR/ADMIN.
  change(status) awaits PATCH, validates the response and refreshes the read.
- App/Services add navigation and service-filter links. Router links preserve the
  in-memory session, unlike full-page anchor reloads. CSS adds lists/metadata.
- Unit tests validate good/bad record pages, closed transitions, VIEWER controls,
  filter queries, empty results and network failures.

### Approval checkpoint → Implementation → Run/test

Covered by the user's six-task approval. No API/schema change or manual setup.
`npm run build --workspace=@sentinel/web` passed; `npm run test:web` passed 9 tests.
These frontend checks use synthetic mocked API responses; real database contracts
are covered by the cumulative API verifier and final browser verification.

### Walkthrough → Debug

useLoad discards aborted responses after filter/navigation changes. Missing service
names display IDs; service-registry errors are explicit. An empty list is shown only
for a successful empty response, never as a substitute for failed storage. Backend
403/409 messages remain visible. A full browser refresh requires login again, but
URL filters and persisted incident state can then be read from the server.

### Understanding check

1. Why does changing a filter invalidate the old cursor?
2. Why can hidden VIEWER buttons never replace API authorization?
3. Why should a status update await the backend before displaying success?

Exercise: add a clear-filters control using URL search parameters and test it.

### Commit summary

feat(P9.2): add incident workspace with filters and server-confirmed status
