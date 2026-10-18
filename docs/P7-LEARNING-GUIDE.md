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

## P7.2 — Chunking, local embeddings and pgvector

**Concept.** An embedding turns text into 384 numbers that represent learned
similarities in meaning. It is not a diagnosis or a probability. Chunking splits
long documents into passages so a search can return a useful section instead of
an entire manual. pgvector adds a vector column and cosine-distance operator to
PostgreSQL. A plain keyword search is smaller and easier to debug but misses
paraphrases; a hosted embedding service would require a separate data/cost review.
We use a pinned CPU model locally. This small corpus uses exact search; an
approximate HNSW index would add tuning and could miss neighbours unnecessarily.

**Architecture/data flow.** Reviewed files → deterministic H2 sections → at most
1,400 Unicode characters per chunk → local BGE-small ONNX model → normalized
384-dimensional vectors → separate PostgreSQL 17/pgvector database. Each record
keeps document ID/version, source/body hash, section, exact character offsets,
passage hash and embedding-profile identity. The main incident DB is untouched.

**File plan / implementation / walkthrough.**

- `knowledge_chunks.py`: `chunk_document(Document)` returns immutable Chunk
  objects. It preserves exact source substrings, splits long sections near spaces,
  never overlaps passages and rejects more than 40 chunks/document. Ordinals and
  passage hashes produce stable IDs; offsets count Unicode code points.
- `knowledge_embeddings.py`: `LocalEmbedder()` checks all pinned artifact hashes
  before loading FastEmbed/ONNX Runtime. `embed(texts)` returns passage vectors;
  `query(text)` returns one query vector. Inputs must fit 512 tokens; silent model
  truncation is rejected. `vector_values` rejects wrong dimensions, NaN/infinity
  and zero vectors, then normalizes. Two CPU threads and a lock bound inference.
- `knowledge/embedding-model.json`: fixed Hugging Face repository revision,
  individual artifact SHA-256 values, model, MIT licence and dimension. Runtime
  uses `local_files_only`; downloading is a separate explicit setup operation.
  Model weights stay in ignored `.artifacts/knowledge-model`, outside Git.
- `knowledge_database.py`: `connect(dsn, readonly=True)` returns a psycopg
  connection, rejects URL overrides, uses two-second connect/statement/lock
  limits and verified TLS for remote databases. It never logs credentials.
- `knowledge_ingest.py`: `ingest(owner_dsn, embedder, root=None)` validates sources
  and embeds before opening a write transaction. An advisory lock serializes
  publication. Existing versions cannot change body or metadata. Inserts use
  fixed parameterized SQL and conflict-safe IDs; a repeat inserts zero chunks.
  A changed embedding profile requires a separately reviewed index, rather than
  silently mixing incompatible vector spaces. Publication is an owner CLI,
  never an LLM/public tool.
- `database/knowledge-migrations/001_knowledge.sql`: document/version foreign
  keys, vector(384), size checks and append-only UPDATE/DELETE triggers.
- `infrastructure/compose.knowledge.yaml`: digest-pinned pgvector image, separate
  retained volume, loopback port 55436. It does not replace any existing DB image.
- `scripts/knowledge-local.py`: creates ignored random configuration once,
  starts only the knowledge DB, checks migration hashes, provisions a SELECT-only
  reader, verifies/downloads pinned model files and ingests the catalog. Owner
  credentials are used here only; reader credentials go to the engine later.
- `requirements.txt` pins the embedding library and its runtime dependencies.
  The chunk/vector tests cover stable offsets, version changes and invalid vectors.

**Approval checkpoint.** Covered by the user's P7.1–P7.4 approval. No external
hosting, paid service, remote inference or operational remediation is included.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
.venv\Scripts\python.exe -m pip install -r apps/ai-engine/requirements.txt
.venv\Scripts\python.exe scripts/knowledge-local.py
.venv\Scripts\python.exe scripts/verify-p7.py
npm run test:engine
```

Expected: twelve documents and 72 passages, then zero new passages on a repeat.
The real verifier creates an isolated, uniquely named verification DB; its cleanup
removes only that owned temporary DB. It checks real CPU embeddings, SELECT-only
access, same-version rejection and publication of version 2 while retaining
version 1. The development knowledge volume is preserved. Fixture/unit checks and
live embedding measurements are labelled separately in the final phase record.

**Debug.** Missing/changed cache artifacts fail closed; rerun the setup downloader,
not runtime inference with remote downloading enabled. Do not edit applied SQL;
add a new migration. Change a source's manifest version when publishing edits.
A rejected reader write is expected. Never replace the reader URL with an owner
URL to work around a permission error. A model/profile change needs reindexing in
a separate reviewed index. Download progress is not evidence of a working DB.

**Understanding check.** Why must query and document vectors use the same model?
Why retain the exact passage as well as its vector? Why does repeating ingestion
insert no new chunks? Exercise: add a unit test that a 513-token input is rejected.

**Manual setup.** The local helper performs the approved development setup. On a
fresh machine install requirements, start Docker Desktop with Linux containers,
then run the commands above. The first setup needs registry/model download access;
runtime embedding stays local. No cloud account is needed yet. Never publish
55436 or commit `.env.knowledge`. Hosted steps are in MANUAL-SETUP/HOSTED-SETUP.

**Commit summary.** `feat(P7.2): ingest versioned passages with pinned local embeddings`.

## P7.3 — Retrieval and exact report citations

**Concept.** Top-k means “at most k nearest passages,” not “k relevant answers.”
Cosine similarity compares vectors; it does not establish truth, confidence or
causation. We cap context at three passages, filter service/category and latest
published version, require two incident-domain terms and similarity >= 0.65, and
return EMPTY when nothing qualifies. This conservative filter can miss relevant
paraphrases: retrieval quality needs measured examples, not a universal claim.

**Architecture/data flow.** P6 reads sources and builds its unchanged hypothesis
report → backend-selected category produces a fixed query → local embedding →
parameterized SELECT in the separate knowledge DB → bounded passages → API
compares every citation with reviewed repository text → evidence/report/context
commit together under the existing lease fence → authenticated GET report.
Knowledge is supplemental guidance. It never becomes a numeric telemetry fact or
proof that a current cause is confirmed. An empty hypothesis list searches for
telemetry-coverage guidance rather than inventing a cause.

**File plan / implementation / walkthrough.**

- `knowledge_retrieval.py`: `search(dsn, embedder, query, service, category)`
  validates scope/query, embeds locally and executes exact cosine search. SQL
  filters by service/category/model and excludes superseded versions. It returns
  at most three exact passages with document/chunk IDs, version, title/kind/path,
  section, character range, source/passage hashes and measured similarity.
  `context(status, citations)` labels all output UNTRUSTED_GUIDANCE_ONLY.
- `knowledge_service.py`: async `retrieve(env, service, report)` chooses a fixed
  query from the first eligible hypothesis or telemetry. The blocking helper
  uses `asyncio.to_thread` and a killable eight-second subprocess, bounded to two
  concurrent processes. The semaphore is held until actual completion even if
  its waiting coroutine is cancelled. `subprocess.run` kills/reaps on timeout;
  SELECT deadlines also bound DB work. Only reader/system settings reach the
  child; owner, main DB, JWT and webhook credentials do not. This costs model
  cold-start CPU per request but gives a firm native-work termination boundary
  and works with Windows' selector loop. A warm service can be considered later
  after measuring load; no unbounded thread/child accumulation is accepted.
- `engine.py` adds a separate `knowledge` response after synthesis. DISABLED,
  UNAVAILABLE, EMPTY and OK are explicit. Retrieval failure does not erase P6
  telemetry or rewrite its hypotheses. Embeddings are real model inference;
  report `ai_performed` continues to mean validated chat-model assistance.
- `knowledge-context.ts`: independent backend validation checks exact keys,
  size/count/score bounds, manifest service/category/version, model identity,
  normalized source hash, title, section, stable chunk ID, exact split algorithm,
  Unicode code-point range and passage hash. Forged/subset/unknown passages fail.
  API/worker package deployment must include the reviewed `knowledge/` directory.
- `008_investigation_knowledge.sql`: new append-only table with report foreign key,
  canonical context JSON and SHA-256; previous migrations are unchanged.
- `investigation-report.ts` validates knowledge before persisting it in the same
  transaction as snapshots/report/terminal history. `readReport` verifies stored
  hashes, returns `knowledge` beside operational `report`, and returns null for
  older reports. It verifies the saved copy rather than replacing old citations
  with a newly published source version.
- `evidence.ts`, `investigation-queue.ts`, `investigations.ts` carry context through
  the existing fenced completion. Collector deadline 24 seconds, work 27 seconds
  and lease 30 seconds cover graph (12) + retrieval (8) with transport headroom.
- `scripts/api-local.py` passes only the reader URL from ignored `.env.knowledge`
  to the engine. No config means explicit DISABLED. Setup is not silently invoked.
- `auth-test.html` labels the existing report button; the existing JS uses
  `textContent` for JSON, so a passage cannot inject HTML/script. Authenticated
  read permissions remain unchanged. No anonymous source-upload endpoint exists.

**Approval checkpoint.** Included in the approved P7 plan. No tool execution or
new write capability is granted to retrieved content.

**Run/test.** Prepare knowledge using P7.2 commands, then stop the owned local API
supervisor with Ctrl+C and restart:

```powershell
.venv\Scripts\python.exe scripts/api-local.py
$env:TEST_KNOWLEDGE_REQUIRED="1"
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
```

Open `http://localhost:3000/auth-test`, sign in with your existing local account,
create/select an incident, enqueue a new investigation, wait for PARTIAL/COMPLETED,
and use **Hypothesis report and knowledge citations**. Expect `knowledge.status`
OK with exact citations, or a truthful EMPTY/UNAVAILABLE status. Old reports stay
unchanged. A controlled test fixture checks a saved real-source passage, atomic
rollback on fabricated text, immutable context and replay after store/API rebuild.
The main API verifier uses disposable databases and real PostgreSQL/Redis.

**Debug.** If knowledge is DISABLED, prepare knowledge and restart the supervisor;
an already-running process does not reread environment. UNAVAILABLE can mean DB
unreachable, missing/changed model files or eight-second cold-start expiry. Run
`verify-p7.py` directly to distinguish model/DB failures. A citation mismatch can
mean engine/index and API source versions differ: publish matching reviewed
artifacts and ingest before accepting new reports. Never disable citation checks.
A report may legitimately remain PARTIAL because telemetry/model coverage is
limited even when knowledge retrieval succeeds.

**Understanding check.** Why is a nearest neighbour not automatically relevant?
Why validate citations again in the API? Why retain old cited text when a new
source version is published? Exercise: add a rejected wrong-service citation test.

**Manual setup.** No new account needed locally. Restart after preparing the
knowledge DB. For hosting, package sources/model artifacts, give the engine only
a SELECT identity, apply migration 008 with the migration identity and grant the
API runtime SELECT/INSERT on `sentinel_api.investigation_knowledge`. Keep the DB
private and use verified TLS. Cloud provisioning can wait; it is not completed.

**Commit summary.** `feat(P7.3): retrieve and persist independently validated knowledge citations`.

## P7.4 — Irrelevant documents and prompt-injection boundaries

**Concept.** Prompt injection is text that tries to impersonate instructions,
request secrets or authorize actions from inside retrieved data. A relevant
passage can still be malicious. Similarity, an approved filename and a valid hash
are not security approvals. Our strongest boundary is structural: retrieved text
arrives after all P6 tool/model work and is never fed into a tool dispatcher,
command interpreter or chat-model instruction stream.

**Architecture/data flow.** Operational evidence → hypotheses first; retrieval
then produces a separate untrusted context → backend source validation → stored
read-only report → escaped text display. No code path maps a passage to an action.
P8 remediation is not implemented or authorized here. Future use of retrieved
text in model prompts must preserve data/instruction separation and repeat these
adversarial checks; today's tests do not guarantee a future changed architecture.

**File plan / implementation / walkthrough.**
`test_knowledge_retrieval.py` supplies synthetic irrelevant queries, a fake
subprocess timeout and malicious retrieval text (“ignore rules,” rollback,
secret requests, script markup). It checks that irrelevant text does not reach
embedding/DB calls, bad scope/query size is rejected, child settings exclude
owner/JWT secrets, timeout is exactly eight seconds, and malicious context cannot
change hypotheses or become executable report fields. These are boundary tests,
not a test of an actual attack against a chat model. No chat model is called.
`knowledge.test.ts` checks valid real-source citations and rejects forged source,
version, body, section/range, scope, model, low score, fake ordinal and added action
fields. `report-database-checks.ts` exercises invalid-context rollback and immutable
real-source context through real PostgreSQL; old report behaviour stays covered.
`scripts/verify-p7.py` uses actual pinned CPU embeddings and real pgvector in an
owned disposable DB. It checks five fixed query categories, two irrelevant
queries, first publication/replay, version immutability, retained old versions,
latest-version retrieval and reader write denial. Its measured top results and
scores are saved in ignored `.artifacts/p7-knowledge-verification.json`.

**Approval checkpoint.** Included in the approved P7 plan. Test attack strings are
synthetic data, not instructions; no rollback, external call or secret disclosure
is performed.

**Run/test.**

```powershell
npm run test:engine
npm run verify:p7
$env:TEST_KNOWLEDGE_REQUIRED="1"
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
npm run test:payment
npm run test --workspace=@sentinel/checkout-service
npm run format:check
.venv\Scripts\python.exe -m ruff check apps/ai-engine scripts/knowledge-local.py scripts/verify-p7.py scripts/api-local.py
.venv\Scripts\python.exe -m pip check
```

Positive: retrieved passages match exact reviewed source text and persist with a
hash. Negative: forged text causes a full transaction rollback; irrelevant input
returns no passages; reader writes fail. The small curated relevance checks are
smoke tests, not general retrieval accuracy or real incident diagnosis quality.
See the final measured record below for actual run outcomes.

**Debug.** Never fix a failed injection test by filtering a few magic phrases.
Keep the architectural boundary: no tool/model execution from document content.
A relevance false positive needs labelled evaluation and reviewed filter/query
changes. A high cosine score is not a reason to remove backend source checks.
Inspect the saved score/category/section and source text when debugging retrieval.

**Understanding check.** Can malicious text have a correct hash? Why is escaping
HTML separate from prompt-injection protection? What would need retesting if
retrieved passages were later sent to a chat model? Exercise: add a synthetic
passage that asks to bypass ADMIN approval and assert it cannot add an action.

**Manual setup.** No extra manual setup required beyond P7.2's local preparation.
Public deployment, cloud database creation, hosted compute/model packaging and
backup/restore validation remain deferred. No local test establishes those.

**Commit summary.** `test(P7.4): verify retrieval relevance and untrusted-content boundaries`.

## P7 final verification record

- Real pinned CPU embeddings and pgvector: 12 documents/72 chunks; repeat zero;
  five curated category queries returned expected top documents. Top similarities:
  dependency/payment-timeout 0.853829; deployment/deployment-correlation 0.833579;
  load/load-surge 0.824427; application/checkout-errors 0.799907;
  telemetry/incomplete-traces 0.755457. These are similarities, not probabilities.
- Two irrelevant-query checks returned empty. The domain-term filter intentionally
  abstains before model/DB calls; these do not prove universal irrelevant-document
  detection. Token overflow and mixed model profiles are rejected. Source version
  history is retained; latest-version filtering is verified.
- Real reader writes are denied even after disabling its read-only transaction
  setting: permissions, not that setting alone, protect the index.
- API: 90 passed, zero skips/failures, actual PostgreSQL/Redis and live P7 context
  required. Includes migration upgrade/replay/checksum/rollback, invalid citation
  atomic rollback, append-only context, replay, existing auth/SSE/queue/outages.
- Engine: 46 tests passed, including synthetic malicious context and timeout
  boundaries. Payment: 32 passed. Checkout: 17 passed. Dependency compatibility,
  formatter and Ruff checks are recorded in the final progress record.
- Live collector: actual local telemetry plus three retrieved passages in 4.67s;
  independently accepted by backend citation validation. No chat model was run.
- Knowledge image transfer needed a local workaround: Desktop stalled while direct
  registry reads worked. OCI index/manifest/config/every layer hashes were verified
  and imported; Docker retained the pinned repository digest. Existing service
  images and persistent data were preserved. The normal setup helper still uses
  Compose; it does not alter Docker proxy settings or embed a custom downloader.
- Main local app is available at `http://localhost:3000/auth-test`. Existing account
  credentials were not read or changed. New investigations show knowledge; old
  saved reports are not retroactively rewritten. Cloud deployment remains open.

P7.4 relevance calibration found a limitation in the initial 0.5 threshold: two
off-topic queries containing incidental domain words returned passages scoring
0.543–0.598. Raising the shared engine/backend minimum to 0.65 rejects these
examples while retaining all five curated expected-top-source queries. This is
small-set calibration, not a held-out accuracy result or universal guarantee.
The verifier now checks these actual embedding-based abstentions as well as the
two queries rejected by the lexical guard.

The real disposable-DB verifier also ingests a synthetic malicious version and
retrieves its attack text verbatim as data; the separate engine-boundary test
checks that such content cannot change hypotheses or authorize actions. The
malicious version is never published to the development catalog. A real
unreachable knowledge DB returned UNAVAILABLE in 4.86 seconds, with no primary
DB change. One intermediate verifier run failed because its new attack fixture
variable was missing; the fixture was corrected and rerun before acceptance.

P8 regression follow-up: after host/runtime restart, the exact engine-style local
child succeeded in 5.58 seconds, exceeding the initial five-second deadline. The
child budget is now eight seconds, collector 24 seconds and worker 27 seconds,
inside the existing 30-second DB lease. Two-child concurrency, kill/reap behaviour,
read-only access and no retries remain unchanged. Live-required regressions must
be run serially to avoid treating deliberate resource-limit degradation as a
successful retrieval measurement. No chat model or remote service was enabled.
