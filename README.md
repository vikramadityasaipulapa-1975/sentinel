# Sentinel

Sentinel is a learning-first AI-assisted incident response and reliability project.
The planned system will observe demo checkout/payment services, gather telemetry,
rank evidence-linked incident hypotheses, retrieve runbooks, and support explicitly
approved sandbox remediation. These capabilities are not implemented yet.

## Current scope

P1.1 establishes Git, documentation, ignore rules, and a minimal npm manifest and
lockfile. There is no application server, database, AI integration, or deployment.
TypeScript and the checkout HTTP server are planned for P1.2, which requires
separate approval. No runtime or development dependencies are declared yet.

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

`npm ci` installs the dependency tree described by `package-lock.json`. At P1.1
there are no external packages to install. It should exit successfully without
changing the manifest or lockfile. A committed, unchanged checkout should produce
no output from `git status --short`.

When intentionally changing dependencies, use `npm install`, review the manifest
and lockfile changes, and commit both. Use `npm ci` to reproduce an existing setup.
There are no application start, build, lint, or automated test scripts yet.

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
- If a commit reports missing identity, inspect `git config user.name` and
  `git config user.email`, then set the intended identity.

## Independent exercise

Add one sentence describing Sentinel in your own words. Run `git diff -- README.md`
and explain the added line before committing your exercise.
