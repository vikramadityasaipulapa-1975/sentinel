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
