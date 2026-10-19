# P10.4 — Configuration, redaction and audit review

Reviewed on 2026-10-20 IST. Scope: local source/reachable history, configuration
boundaries, HTTP/log canaries, authentication/roles and existing immutable audit
behavior. This is not a penetration test, dependency vulnerability audit, hosted
security certification or proof that no unknown secret format exists.

## Secret scanning and tool integrity

scripts/security_scan.py pins Gitleaks 8.30.1 for Windows/Linux x64. Official release
archive SHA256 digests are embedded; bytes are verified before reading only the exact
binary member. No archive paths are extracted. Cached executable bytes are checked
against the verified archive each time. Cache/executable symlinks and out-of-workspace
paths are refused. Download/archive/member sizes and subprocess duration are bounded.
Only GitHub's official release assets are downloaded; project source is never uploaded.

The helper exports tracked and nonignored worktree files to an owned temporary folder,
refuses worktree symlinks and tracked .env configuration (except .env.example), then
scans all locally reachable Git refs. Shallow clones are refused; CI fetches full
history. Deleted/unreachable Git objects, ignored local .env, private provider state,
and unknown credential formats are outside this scan. Worktree export is removed
through its own temporary-directory context; unrelated files are not deleted.

The scanner's native stdout/stderr is captured, fully redacted JSON reports stay in
ignored .artifacts, and the user/CI summary includes only rule/file/line/commit metadata.
CI uploads only security-summary.json, not source, environment or raw findings. Source
inline allow comments and .gitleaksignore files cannot silently bypass this wrapper;
its explicit configuration extends default rules and uses an empty ignore file.

Controls: a runtime-generated, never-issued token-shaped value must trigger github-pat;
a harmless fixture must pass. A provider-shaped value placed inside the reviewed
model-manifest path must still be detected. Tests reject corrupt archives before
execution and prove only the expected binary member is read, not traversal entries.

Initial incomplete AWS-shaped control was not detected by the pinned rules; that
control failure correctly stopped the scan. The final control uses the exact pinned
GitHub-PAT syntax/rule and passes. This is not a weakened rule or a real provider token.

Initial scan found ten metadata findings: five current plus five historical matches.
Review identified only public model-file SHA256 digests, a documented source digest
(with trailing prose punctuation) and the literal 002_incidents.sql filename. The
.gitleaks.toml exceptions are exact reviewed values AND exact file paths for only the
generic-api-key rule. No directory, commit or provider-key rule is excluded. Current
controls additionally prove a provider key remains detectable at an excepted path.

Measured scan before final documentation/commit: no unreviewed findings across 59
reachable commits and 281 worktree files. Final pre-commit scan also passed: 59 reachable commits and 282 worktree files,
with controls passing and zero remaining findings. No credential rotation or history rewrite was performed.

## Configuration and browser boundaries

- Database URL parsing rejects URL TLS overrides and remote plaintext; hosted DB
  connections default to verified TLS. Main API/queue/webhook/collector/model secrets
  are separate process configuration. .env.example contains fake placeholders only.
- API logs allowlist route templates and generated/validated request IDs. Headers,
  cookies, bearer tokens, query parameters, password/body text and dependency exception
  details are not emitted. Existing checkout/payment log tests remain in the suite.
- Dashboard and diagnostic pages use CSP; tokens are memory-only. Backend responses
  carry no-store/nosniff. HTTP canary tests exercise malformed JSON, oversized bodies,
  forged request IDs, query tokens, cookies, unknown bearer values and internal errors.
- Same-origin browser access remains the intended deployment. No allow-origin or
  allow-credentials response headers are emitted, including for preflight attempts.
  CORS is browser behavior, not authorization: a CLI with a valid token can call the
  backend irrespective of Origin. Tokens remain required for protected endpoints.
- Real JWT verification reads live account/role/token version from the user-store
  boundary. Anonymous/invalid/disabled accounts fail. VIEWER cannot approve. ADMIN
  input with an extra command is rejected before action storage is reached.

No production config/response vulnerability requiring a new implementation was found
in these tests, so existing production behavior is retained. The new HTTP regression
uses a user/action-store double plus actual signing/verification, Express and HTTP.
The separate cumulative suite verifies real PostgreSQL authorization and audit writes.
No cloud endpoint, current user's account or production action is exercised.

## Audit review

Migration 009 stores action identity/binding/expiry/actor/decision and append-only
audit events. Migration 010 freezes decision identity and execution identity while
allowing only explicit status transitions. Existing integration checks already cover
concurrent duplicate decisions, revoked roles, expiry and rollback on audit failure.
New assertions also reject event UPDATE, event DELETE, action DELETE and changing a
decided actor during an otherwise allowed transition. These run only in the guarded
disposable database. No executor/remediation is invoked by those SQL policy tests.

Review access matrix: anonymous has no protected reads/writes; authenticated VIEWER
has permitted reads; OPERATOR/ADMIN can propose permitted incident work; only ADMIN
can decide an action. Backend authorization and the executor's fresh identity/binding
checks remain authoritative. Human-facing UI labels do not grant permission.

Important limit: these are normal-SQL trigger protections, not a cryptographic audit
chain or defense against a privileged database administrator altering schema/triggers.
Hosted setup still needs separate migration/runtime identities, private database
networking, controlled backups and an external audit retention policy. This task does
not claim those provider settings exist. No audit rows or user actions were rewritten.

## Commands and acceptance

```powershell
.venv\Scripts\python.exe scripts/security_scan.py
.venv\Scripts\python.exe -m pytest scripts/tests/test_security_scan.py -q
npm run build --workspace=@sentinel/api
node --test apps/api/dist/test/security.test.js
$env:TEST_KNOWLEDGE_REQUIRED='1'
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
.venv\Scripts\python.exe scripts/check.py fast
```

Expected scanner status PASSED, controls_passed true and findings empty; three tool
integrity/redaction tests pass. The HTTP policy test must pass without reaching action storage.
Local fast tier passed: checkout 25, API non-DB 44, React 20, payment 32, engine 51,
scripts 23, plus lint/format/controls/builds. Local cumulative required-knowledge run
completed with 98 passing and two reported failures: the live knowledge assertion
and its parent suite. All new audit mutation/access/redaction assertions passed.
Required knowledge intermittently returned UNAVAILABLE at its unchanged eight-second
child budget. A standalone diagnostic returned three citations in 8.875 seconds;
a subsequent normal eight-second path completed in 7.296 seconds. These timings do
not establish a universal cause or production performance. No assertion was skipped
or application deadline increased to obtain green.

An earlier cumulative attempt also hit the verifier's old 120-second combined
compile/test budget; fixture cleanup caused secondary connection failures. The
entire build/test command now has a bounded 300 seconds. This is a test-harness
budget, not a relaxed application or individual-test deadline. The later completed
run isolates the remaining local knowledge limitation. Temporary test containers
were removed and their volumes retained on every attempt. Remote CI conclusion
is verified separately; no full local cumulative pass is claimed. The new Secret scan CI job gates integration along with both fast OS jobs.
It downloads its own pinned scanner, uses a full checkout and needs no repository
secret or Gitleaks Action license. GitHub Actions account policy/allowance can still
block a job; no capacity is purchased automatically.

## Manual actions and remaining limits

No new manual cloud setup, scanner installation, account or secret is required;
the helper downloads a verified tool into ignored .tools. Internet to official GitHub
release assets is needed on first use; intact pinned archives are reusable offline.
If a future scan finds a real secret, stop publishing it, review metadata privately,
rotate/revoke at its provider and update only the appropriate ignored/deployment
secret. Never paste the value into chat. History rewriting requires separate approval
and does not substitute for credential revocation.

No provider rotation is currently required by these findings. Public deployment,
least-privilege hosted roles, HTTPS/private ingress, Redis/worker hosting, backups and
retention remain the separate hosted checklist. Public exposure is not authorized by
this review. Dependency CVEs, third-party penetration testing and production monitoring
are not covered by this narrow source/access/audit review.

Sources: [official Gitleaks CLI/configuration](https://github.com/gitleaks/gitleaks),
[pinned release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
[pinned default rules](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml).

Local operational limit: the current Windows environment may return PARTIAL reports
when cold retrieval exceeds its deadline. The startup/reproducibility phase should
address/document resource readiness separately. This does not invalidate the new
SQL/access checks, but a passing fast/security tier must not be advertised as a
complete local knowledge-readiness result.
