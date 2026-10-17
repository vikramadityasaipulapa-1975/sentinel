# P7: retrieved incident knowledge

The user approved P7.1-P7.4, including a local embedding-model download, separate
pgvector development database and additive report persistence. Cloud setup remains
deferred. Retrieved documents are untrusted guidance, never permission to execute
an action or proof of a current incident's cause.

## P7.1 — Curated runbooks and fictional postmortems

**Concept.** A runbook describes checks and possible responses. A postmortem
records lessons from an incident; our two examples are explicitly fictional and
must not be presented as operational history. A manifest lists the sources we
intend to publish. Source versions and hashes let citations identify exact text.

**Architecture/data flow.** Reviewed manifest → bounded safe source paths → UTF-8
and newline normalization → metadata/section validation → Document objects with
SHA-256. No database write, embedding or model call occurs in this task.

**File plan / implementation / walkthrough.** `knowledge/runbooks/` contains ten
individual runbooks: timeouts, upstream errors, checkout errors, load, deployment
correlation, PostgreSQL pressure, queue backlog, missing metrics/logs and trace
gaps. `knowledge/postmortems/` contains two fictional scenarios demonstrating late
payment success and coincident release/dependency failure. Each has Scope,
Symptoms, Possible causes, Checks, Remediation guidance and Limitations.
`knowledge/manifest.json` assigns unique IDs, versions, kinds, service applicability
and categories. `apps/ai-engine/knowledge_catalog.py` defines immutable Document,
normalizes line endings and computes hashes. `load_catalog(root)` rejects unknown
metadata, invalid versions, unsafe/duplicate paths, oversized files, missing
sections and examples without a fictional declaration. The source selection is
an on-disk allowlist, not an HTTP upload or caller-provided URL.

**Approval checkpoint.** The user's “continue” approved the preceding complete
P7 task plan. This covers all four tasks without repeated approval prompts.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
npm run test:engine
.venv\Scripts\python.exe -m ruff check apps/ai-engine
```

40 cumulative engine tests passed. Positive: twelve distinct complete documents,
including exactly two labelled fictional postmortems. Negative: duplicate ID,
path traversal, missing section and unlabelled example fail before ingestion.
The previous P5/P6 fixture tests passed in the same run. Markdown/manifest formatted.

**Debug.** A changed body needs a new version once ingested. Do not weaken path or
section validation to publish an invalid source. A source hash identifies bytes,
not the correctness of the advice. Manifests never authorize commands in bodies.

**Understanding check.** Why label example postmortems fictional? Why keep both a
version and a content hash? Why can a valid document still contain bad advice?
Exercise: add a rejected-manifest test for an unknown service name.

**Manual setup.** No manual setup required. Publishing later versions requires
reviewing text and incrementing the manifest version before ingestion. No model,
cloud account or database is required for this task's checks.

**Commit summary.** `docs(P7.1): author and validate versioned incident knowledge`.
