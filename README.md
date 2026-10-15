# Sentinel

Sentinel is a learning-first AI-assisted incident response and reliability project.
The planned system will observe demo checkout/payment services, gather telemetry,
rank evidence-linked incident hypotheses, retrieve runbooks, and support explicitly
approved sandbox remediation. These capabilities are not implemented yet.

## Current scope

P1.1 establishes Git, documentation, ignore rules, and npm configuration.
P1.2 adds a local Express + TypeScript checkout service with a health endpoint.
There is no payment service, database, AI integration, or deployment yet.

## Prerequisites

- Git (verified locally with 2.51.0.windows.1)
- Node.js 24.x (verified locally with 24.11.1)
- npm 11.x (verified locally with 11.6.2)
- PowerShell and a text editor

The engines field documents the supported tool versions; npm may warn rather
than reject other versions. Python and Docker are introduced in later tasks.

## Local setup

The existing local repository root is `V:\sentinel\sentinel`.

```powershell
Set-Location 'V:\sentinel\sentinel'
git --version
node --version
npm --version
npm ci
git status --short
```

`npm ci` installs the dependency tree described by `package-lock.json`, including
the checkout npm workspace. It should exit successfully without
changing the manifest or lockfile. A committed, unchanged checkout should produce
no output from `git status --short`.

When intentionally changing dependencies, use `npm install`, review the manifest
and lockfile changes, and commit both. Use `npm ci` to reproduce an existing setup.
There is no lint configuration yet. TypeScript strict checking and Git whitespace
checks provide the current static checks.

## Checkout service (P1.2)

```powershell
npm run build
npm test
npm run start:checkout
```

Build compiles TypeScript into ignored `services/checkout-service/dist` output.
Tests build first, then use Node's test runner and real local HTTP requests on an
automatically assigned port. The test server is closed afterward. Start runs the
compiled JavaScript and should print:

```text
Checkout service listening at http://127.0.0.1:3001
```

In a second PowerShell terminal:

```powershell
curl.exe -i http://127.0.0.1:3001/health
curl.exe -i http://127.0.0.1:3001/unknown
curl.exe -i -X POST http://127.0.0.1:3001/health
```

Expected: GET /health returns 200 and
`{"status":"ok","service":"checkout-service"}`. The other requests return 404
and `{"error":{"code":"NOT_FOUND","message":"Route not found"}}`.
Responses have JSON content type. Express also provides its usual HEAD behavior
for GET routes; the tests above exercise the task's GET and unmatched contracts.

Stop with Ctrl+C. Rebuild and restart after editing source. The service binds only
to loopback at port 3001. An occupied port reports EADDRINUSE and exits with a
nonzero code. A 200 health response confirms HTTP responsiveness only; no payment
or database health checks are performed. Request IDs and centralized application
error handling are planned for P1.6.

The root package delegates commands to `@sentinel/checkout-service`. Express is a
runtime dependency; TypeScript and Node/Express type declarations are development
dependencies. The service uses ES modules. Relative `.js` import paths in `.ts`
source refer to the JavaScript files produced by compilation.

## Foundation checks

```powershell
git rev-parse --show-toplevel
git remote -v
npm ci
git diff --exit-code -- package.json package-lock.json
git check-ignore --no-index .env
git check-ignore --no-index .env.example
git diff --check
```

Expected: the repository root and configured GitHub origin are shown; installation
and diff checks succeed; `.env` is ignored. The `.env.example` check deliberately
returns exit code 1 with no output, meaning an example file would not be ignored.
These ignore checks do not create files. Never put real secrets in examples.
Ignore rules do not remove files already tracked by Git.

## Learning workflow

Read [AGENTS.md](AGENTS.md) and the [master plan](SENTINEL_CODEX_MASTER_PLAN.md).
Each task requires explanation and approval before implementation, followed by
verification, a walkthrough, understanding questions, and an independent exercise.
Measured results and pending learning checkpoints live in
[docs/PROGRESS.md](docs/PROGRESS.md).

Git commits record local snapshots; pushing publishes commits to the configured
remote. P1.1 does not require publishing or deploying anything.

## Troubleshooting

- If Git reports no repository, verify the current directory with `Get-Location`.
- If `npm ci` reports a lock mismatch, inspect intentional manifest changes;
  regenerate the lock with `npm install` only when those changes are intended.
- If npm cannot download a future dependency, inspect registry/proxy/network errors.
- If workspace installation reports EPERM while creating a link, check Windows
  permissions for workspace links rather than changing application code.
- If HTTP requests report connection refused, check startup output and port 3001.
- If startup reports EADDRINUSE, stop the process you started on that port before
  restarting. Do not terminate an unfamiliar process blindly.
- If a commit reports missing identity, inspect `git config user.name` and
  `git config user.email`, then set the intended identity.

## Independent exercise

Add one sentence describing Sentinel in your own words. Run `git diff -- README.md`
and explain the added line before committing your exercise.

For P1.2, add a fixed `"component":"demo"` field to the health response, update
its expected test body, and run `npm test`. Explain why the old test would fail.
