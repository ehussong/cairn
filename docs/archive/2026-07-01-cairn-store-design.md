# Cairn — Design: Personal Knowledge Store with a Single MCP Query Surface

> Archived 2026-07-31 because the design and invariants remain valuable while delivery work moved to the [Cairn Roadmap](https://github.com/users/ehussong/projects/6). The Store track is gated by [issue #14](https://github.com/ehussong/cairn/issues/14).

**Status:** Draft v2 for review — revised 2026-07-02 after a 7-lens adversarial design review (50 findings triaged, 29 upheld + 21 minor applied) · **Original:** 2026-07-01
**Scope:** Concrete design artifacts per the design brief. Settled decisions from the brief are treated as constraints throughout; §10 flags the places where a constraint carries a genuine risk worth a conscious policy call.

---

## 1. System shape

```
                 ┌────────────────────────── homelab ──────────────────────────┐
 sources         │                                                             │
 ┌─────────┐     │  ┌──────────────┐        ┌────────────────────────────┐     │
 │ IMAP    │──┐  │  │  ingest      │ blobs  │  object store (S3 API)     │     │
 │ Readwise│──┼──┼─▶│  engine      │───────▶│  originals/ (lossless)     │     │
 │ ~/notes │──┘  │  │  + connectors│        │  derived/   (re-derivable) │     │
 └─────────┘     │  └──────┬───────┘        └────────────────────────────┘     │
                 │         │ text + metadata + vectors                         │
                 │         ▼                                                   │
                 │  ┌──────────────┐        ┌──────────────┐                   │
                 │  │ PostgreSQL   │◀───────│ MCP server   │◀━━ Streamable ━━━━┿━━ assistants
                 │  │ + pgvector   │  reads │ (FastMCP)    │      HTTP         │   (swappable)
                 │  └──────────────┘        └──────────────┘                   │
                 │         │                                                   │
                 │         └── cairn backup: pg_dump + rclone bucket mirror    │
                 │                └─▶ restic ─▶ 2nd disk + B2 (independent)    │
                 └─────────────────────────────────────────────────────────────┘
                          embeddings: provider abstraction → hosted API now, local later
```

Three processes, one language (Python), one database:

| Component | Role | Failure isolation |
|---|---|---|
| **Ingest engine** | Runs connectors on a schedule; owns archive writes, normalization, chunking, embedding queue | Can crash/stall freely — queries unaffected |
| **MCP server** | Read-only query surface over Postgres; the single endpoint assistants connect to | Never writes; restarts are stateless |
| **Postgres + object store** | Index tier (lossy, rebuildable) + archive tier (lossless, append-only) | Archive is the sole irreplaceable data |

Three invariants everything else hangs on (the brief's day-one guardrails):

1. **Durable link:** every chunk resolves `chunk → document → version → raw_sha256 → archive object`. Citations survive re-chunking, re-embedding, and full rebuilds.
2. **Rebuildability:** `cairn rebuild` reconstructs the entire index tier from the archive with no network access to sources (embedding calls only). The index is a cache; the archive is truth.
3. **Stable identity:** document ids are deterministic — `uuidv5(cairn_ns, source_key + '/' + external_id)` — and recorded in archive sidecars, so they survive every rebuild *including* the disaster rebuild from the archive alone; a citation an assistant saved last year still resolves. Chunk ids are deterministic per (version, chunker_version, seq) but change when content or chunker changes; the MCP contract treats them as short-lived handles with a graceful fallback (§6.2).

---

## 2. Data model

### 2.1 Schema (DDL)

```sql
-- ===== Registry =====

CREATE TABLE sources (
  id            smallint PRIMARY KEY,
  key           text UNIQUE NOT NULL,      -- 'mail-fastmail', 'readwise', 'notes'
  kind          text NOT NULL,             -- connector type: 'imap' | 'readwise' | 'fsdir' | ...
  display_name  text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}',  -- non-secret config; secrets live in env/secret files
  allow_hosted_processing boolean NOT NULL DEFAULT true,  -- privacy routing (§4.6)
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE embedding_spaces (
  id          smallint PRIMARY KEY,
  provider    text NOT NULL,               -- 'voyage' | 'openai' | 'local-...'
  model       text NOT NULL,
  dim         int  NOT NULL,
  metric      text NOT NULL DEFAULT 'cosine',
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_space ON embedding_spaces ((true)) WHERE is_active;

-- ===== Sync bookkeeping =====

CREATE TABLE sync_state (
  source_id   smallint NOT NULL REFERENCES sources,
  partition   text NOT NULL DEFAULT '',    -- IMAP folder, fs subtree; '' = whole source
  generation  int NOT NULL DEFAULT 0,      -- bumped on UIDVALIDITY-style epoch resets
  cursor      jsonb NOT NULL DEFAULT '{}', -- opaque to the engine, owned by the connector
  last_incremental_at timestamptz,
  last_reconcile_at   timestamptz,
  PRIMARY KEY (source_id, partition)
);

CREATE TABLE ingest_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id   smallint REFERENCES sources,
  kind        text NOT NULL,        -- 'incremental' | 'reconcile' | 'backfill' | 'embed' | 'rebuild'
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running',
                                    -- 'running' | 'success' | 'partial' | 'failed' | 'aborted_guard'
  stats       jsonb NOT NULL DEFAULT '{}',  -- {seen, added, updated, deleted, embed_tokens, errors:[...]}
  error       text
);

-- ===== Documents =====

CREATE TABLE documents (
  id           uuid PRIMARY KEY,           -- deterministic: uuidv5(cairn_ns, source_key+'/'+external_id),
                                           -- app-generated; survives rebuilds (invariant 3)
  source_id    smallint NOT NULL REFERENCES sources,
  external_id  text NOT NULL,              -- connector's stable source-native id
  last_source_version text,                -- latest etag/MODSEQ/mtime seen, incl. metadata-only changes
  current_version_id uuid,                 -- → document_versions (FK added below; NULL only mid-first-ingest)
  doc_type     text NOT NULL,              -- 'email' | 'highlight' | 'article' | 'note' | 'attachment'
  title        text,
  author       text,                       -- deterministic: From: header, book author, frontmatter
  participants jsonb NOT NULL DEFAULT '[]',-- [{name, address, role}] — deterministic, from headers
  thread_id    text,                       -- source-native grouping: email thread id, Readwise book id
  project      text,                       -- from folder path / frontmatter, if derivable
  tags         text[] NOT NULL DEFAULT '{}', -- source-provided tags only (IMAP folders, Readwise tags)
  lang         text,                       -- detected at ingest; drives FTS config
  url          text,                       -- canonical URL at the source, when one exists
  doc_ts       timestamptz,                -- the item's own timestamp (sent / created / highlighted)
  extra        jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,                -- tombstone; non-null ⇒ excluded from search
  delete_reason text,                      -- 'source_delete' | 'sweep' | 'generation_reset'
  UNIQUE (source_id, external_id)
);
CREATE INDEX ON documents (source_id, doc_ts);
CREATE INDEX ON documents (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX ON documents (project) WHERE project IS NOT NULL;
CREATE INDEX ON documents USING gin (tags);

CREATE TABLE document_versions (       -- append-only
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents,
  seq           int NOT NULL,
  raw_sha256    text NOT NULL,         -- content address of the original bytes in the archive
  raw_mime      text,
  raw_size      bigint,
  norm_sha256   text NOT NULL,         -- sha256 of canonical markdown (dedupes re-chunk/re-embed)
  norm_text     text NOT NULL,         -- canonical markdown (serving copy; also written to derived/)
  source_version text,                 -- etag / MODSEQ / mtime as reported by the source
  extractor_version text NOT NULL,     -- pins the extraction code that produced norm_text
  chunker_version   text NOT NULL,     -- pins the chunker that produced this version's chunks
  extraction    jsonb NOT NULL DEFAULT '{}',  -- quality signals: {charset_replacements, strip_ratio,
                                              --   near_empty, warnings:[...]} (§8 quality monitoring)
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, seq)
);

-- circular FK resolved after both tables exist; insertion order: document → version → pointer UPDATE
ALTER TABLE documents ADD FOREIGN KEY (current_version_id) REFERENCES document_versions;
CREATE INDEX ON documents (current_version_id);   -- the hottest join column in the system (§6.3)

-- ===== Index tier (droppable, rebuildable) =====

CREATE TABLE chunks (
  id           uuid PRIMARY KEY,       -- deterministic: uuidv5(version_id, chunker_version + ':' + seq)
  document_id  uuid NOT NULL REFERENCES documents,
  version_id   uuid NOT NULL REFERENCES document_versions,
  representation text NOT NULL DEFAULT 'verbatim',
                                       -- future semantic-shortening proxies land as additional rows
                                       -- ('summary', 'proposition', …); see §5. Verbatim-only day one.
  seq          int NOT NULL,
  text         text NOT NULL,          -- verbatim slice of norm_text (for representation='verbatim')
  context_prefix text NOT NULL DEFAULT '',  -- deterministic breadcrumb, embedded but not FTS'd (§5)
  heading_path text,                   -- 'H1 > H2 > H3'
  span_start   int,                    -- char offsets into norm_text; required for verbatim rows
  span_end     int,
  token_count  int NOT NULL,
  fts          tsvector,               -- written at INSERT: setweight(title,'A') ||
                                       --   setweight(heading_path,'B') || setweight(text,'C'),
                                       --   regconfig chosen from documents.lang ('simple' fallback).
                                       -- Populated ONLY for verbatim rows: generated text must never
                                       -- enter the keyword arm (brief: full-text stays over originals)
  CHECK (representation <> 'verbatim'
         OR (span_start IS NOT NULL AND span_end IS NOT NULL AND fts IS NOT NULL)),
  UNIQUE (version_id, representation, seq)
);
CREATE INDEX ON chunks USING gin (fts);
CREATE INDEX ON chunks (document_id);

CREATE TABLE chunk_embeddings (
  chunk_id    uuid PRIMARY KEY REFERENCES chunks ON DELETE CASCADE,
  space_id    smallint NOT NULL REFERENCES embedding_spaces,
  embedding   halfvec(1024) NOT NULL,  -- dim fixed per deployment; see §2.4 for the swap procedure
  embedded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON chunk_embeddings
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 200);

-- ===== Connector-private state (namespaced conn_*, migrations ship with the connector) =====

CREATE TABLE conn_imap_messages (      -- UID map: applies VANISHED / EXPUNGE to documents
  source_id   smallint NOT NULL REFERENCES sources,
  folder      text NOT NULL,
  uidvalidity bigint NOT NULL,
  uid         bigint NOT NULL,
  document_id uuid NOT NULL REFERENCES documents,
  PRIMARY KEY (source_id, folder, uidvalidity, uid)
);

CREATE TABLE conn_fsdir_files (        -- per-file fast-path change detection
  source_id  smallint NOT NULL REFERENCES sources,
  path       text NOT NULL,            -- relative to the source root
  size       bigint NOT NULL,
  mtime_ns   bigint NOT NULL,
  sha256     text NOT NULL,
  document_id uuid NOT NULL REFERENCES documents,
  PRIMARY KEY (source_id, path)
);
```

Postgres 17+ with pgvector **≥ 0.8.4** (0.8.3/0.8.4 fixed HNSW vacuum-related index corruption; pin the version).

### 2.2 The searchable predicate

A chunk is visible to search iff:

```sql
chunks.version_id = documents.current_version_id
AND documents.deleted_at IS NULL
AND sources.enabled
```

The keyword arm additionally requires `representation = 'verbatim'` (generated proxies never enter full-text search); the vector arm additionally requires a row in `chunk_embeddings`. A freshly ingested or just-updated document is therefore **keyword-searchable immediately and vector-searchable once the async embed worker catches up** — embedding-provider outages degrade recall, never availability (constraint 1). `search(include_deleted: true)` relaxes only the `deleted_at IS NULL` clause (§6.2).

### 2.3 Update, versioning, and deletion semantics

**Metadata-only change** (`raw_sha256` unchanged — e.g. an IMAP flag or Readwise tag edit): update `documents` columns in place and record the new `last_source_version` (so the §4.2 skip check keeps working after metadata churn). No new version, no re-embed — with one exception: if `title` or `lang` changed, rewrite the current chunks' `fts` in the same transaction (title is weighted into every chunk's tsvector; a stale title silently corrupts keyword search). Any change touching a tombstoned document clears `deleted_at` (resurrection, below).

**Content change:** all in **one transaction** — insert the new `document_versions` row and its chunks, repoint `current_version_id`, delete the old version's chunks (cascade drops their embeddings). Old version *rows* are retained (append-only audit of hashes → old archive blobs stay findable). Postgres atomicity means there is no observable partial state; the one accepted degradation is that an updated document is FTS-only until re-embedded (§2.2).

- Optimization: if the new `norm_sha256` equals the old (raw bytes changed but extracted text didn't — common for emails re-fetched with cosmetic header differences), keep the existing chunks and embeddings: `UPDATE chunks SET version_id = <new>` instead of re-chunking. No embedding spend on no-op changes.

**Deletion at source:** set `deleted_at` + `delete_reason` — nothing else. Chunks and embeddings are **retained**, hidden by the searchable predicate (§2.2), so: deleted items vanish from default search instantly; `search(include_deleted: true)` can still find them (the discovery path for "what was in that email I deleted last week?" — §6.2); `fetch` on a tombstoned id still works, flagged `deleted: true`; and resurrection is a single column update. A `tombstone.json` marker is written next to the archive objects so the archive stays self-describing. The residual index weight of tombstoned chunks is noise at this scale; `cairn purge` is what actually removes them.

- **Policy note (explicit, because constraint 3 says "mirror"):** the *index* mirrors the source — deletes propagate and deleted items vanish from search. The *archive* is an archive — it retains originals unless the operator runs `cairn purge <doc_id>`, the single deliberately destructive command (removes blobs, versions, chunks + embeddings, connector state rows, and logs the purge). Default retention-forever is the recommended posture; see §10.

**Resurrection** (item reappears, a false tombstone is corrected, or a rename rebinds): clear `deleted_at` — chunks and embeddings are still in place, so recovery is instant and free. Three paths trigger it: an incremental upsert or metadata-only change for a tombstoned document; the reconcile sweep's resurrection rule (§4.3); a rename rebind (§4.7). **Every tombstone is therefore self-healing within one reconcile cycle** — a transient false delete (flaky listing, connector bug) can never become permanent index divergence.

### 2.4 Embedding spaces and the re-embed swap

Exactly one space is active. `chunk_embeddings` has a fixed `halfvec(DIM)` column matching it — one static schema at any moment, no dynamic SQL in the query path.

**Switch procedure** (provider/model change — a rebuild, not a migration, per the brief):

1. Register the new space (`is_active = false`).
2. `CREATE TABLE chunk_embeddings_next (... halfvec(<new_dim>) ...)` and backfill in batches from `chunks` (text is already in Postgres; the archive is the fallback if extraction also changes). Resumable by `chunk_id` watermark; interruptions lose nothing.
3. Build the HNSW index on the full table (`maintenance_work_mem = 2–4GB`, parallel workers) — bulk-build, never row-by-row inserts through the graph.
4. One transaction: flip `is_active`, rename tables. Queries never see a half-migrated space.
5. Drop the old table after a soak period.

Standardizing on **1024 dims via Matryoshka truncation** (§10.1) makes most future provider switches dim-preserving — the swap reduces to steps 2 and 4 with the same schema.

### 2.5 Capacity check

At the top of the expected range (500k chunks): `halfvec(1024)` = 2 KB/vector → ~1 GB table + ~1.5 GB HNSW index; chunk text ~1–2 GB; FTS GIN ~0.5 GB. Everything fits in RAM on any modern homelab box. No partitioning, no sharding, nothing clever.

---

## 3. Archive tier layout

One bucket, S3-compatible API, versioning enabled:

```
cairn-archive/
  originals/<source_key>/<external_id_safe>/<raw_sha256>.raw       # exact bytes as fetched
  originals/<source_key>/<external_id_safe>/<raw_sha256>.meta.json # sidecar (below)
  originals/<source_key>/<external_id_safe>/tombstone.json         # written on source delete
  derived/<norm_sha256>.md                                         # canonical markdown (re-derivable)
```

`external_id_safe` = the external id sanitized for key use, or `sha1(external_id)` when it isn't key-safe (raw value preserved in the sidecar).

The **sidecar** carries `{document_id, source_key, external_id, fetched_at, mime, size, structural metadata}` — enough that walking `originals/` alone (no database, no source access) reconstructs the full document catalog: group by `external_id`, order by `fetched_at`, latest non-tombstoned wins. Including `document_id` (redundant with the deterministic derivation, invariant 3) means even a disaster rebuild preserves every id an assistant ever cited. This is the disaster-of-last-resort path; the normal rebuild path reads the Postgres catalog.

Content addressing gives idempotent writes (re-fetching unchanged bytes is a no-op) and free dedup across versions. Writes are put-if-absent; **nothing in the pipeline ever deletes or overwrites an archive object** — only `cairn purge` does.

`derived/` satisfies the "smaller, portable extracted files" pain point: every canonical markdown rendering exists as a plain file, portable and greppable without cairn running. It is explicitly re-derivable — losing it costs nothing.

**On MinIO specifically:** as of 2026 the MinIO community edition is effectively unmaintained (admin console stripped 2025, repo archived Feb 2026). The design depends only on the S3 API + bucket versioning, so MinIO still works — but for a new deployment evaluate **Garage** (lightweight, homelab-oriented) or SeaweedFS first, and keep durability in the backup layer (§7), never in store-specific replication features.

---

## 4. Ingestion pipeline

### 4.1 Connector contract

Connectors translate a source into a common vocabulary and never touch the archive, chunker, embedder, or query tables. Extraction is connector-paired (email needs quote-stripping, articles need readability extraction) but its **output is one canonical form**.

```python
@dataclass
class CanonicalDoc:            # the one normalized form, all sources
    external_id: str           # stable source-native identity
    doc_type: str              # 'email' | 'highlight' | 'article' | 'note' | 'attachment'
    title: str | None
    author: str | None
    participants: list[Participant]
    thread_id: str | None
    project: str | None
    tags: list[str]            # deterministic, source-provided only
    url: str | None
    doc_ts: datetime | None
    body_md: str               # canonical markdown, NFC-normalized
    extra: dict

class Connector(Protocol):
    kind: ClassVar[str]

    def probe(self) -> ProbeResult
        # partitions + per-partition generation token (IMAP UIDVALIDITY, etc.)
        # + capabilities (supports_deletes, supports_incremental)

    def changes(self, partition: str, cursor: dict) -> Iterator[ChangeBatch]
        # ChangeBatch: upserts=[(external_id, source_version)], deletes=[external_id],
        #              next_cursor. Engine persists next_cursor transactionally per batch.

    def fetch(self, external_id: str, hint: dict) -> RawItem
        # RawItem: raw_bytes, mime, canonical: CanonicalDoc. Idempotent, retryable.

    def enumerate(self, partition: str) -> Iterator[tuple[str, str]]
        # (external_id, source_version) full listing — cheap, no bodies.
        # Required. Powers mark-and-sweep delete detection and reconciliation.
```

### 4.2 The generic sync loop (engine-owned, identical for every source)

```
for each enabled source, each partition:
  0. pg_advisory_lock(source_id, partition) — held for the whole run; if already held,
     skip this invocation, ping the healthcheck, exit 0.        ← overlap policy (§8)
  1. probe() — if generation token ≠ stored: GENERATION RESET path (§4.4), not deltas.
  2. for each ChangeBatch from changes(partition, cursor):
       for each upsert:
         a. skip if source_version matches documents.last_source_version    ← idempotent
         b. fetch() → sha256(raw_bytes)
         c. raw hash unchanged → metadata-only update (§2.3); else:
         d. archive put (put-if-absent) + sidecar          ← durable BEFORE the index sees it
         e. one txn per document: new version + chunks + current-pointer flip (§2.3)
       explicit deletes → tombstone (deletes exceeding the §4.3 guard threshold abort instead)
       AFTER every item in the batch is committed: commit next_cursor (its own txn)
  3. record ingest_runs row (counts, errors, duration); ping healthcheck (/fail on bad status)
```

**Crash-safety comes from idempotency, not batch atomicity.** Document writes are per-item transactions; the cursor only advances after the whole batch is durably applied. A crash between them means the batch replays on the next run — and steps 2a/2c turn every replayed item into a no-op. The advisory lock makes overlap impossible (a slow sync outlasting its cron interval, or a sync racing a reconcile of the same partition), which is what makes per-document `seq` assignment and the current-pointer flip safe without any cleverness.

Rate limits: connectors raise `Backoff(retry_after)`; the engine persists the cursor, sleeps, resumes mid-partition. Per-item extraction failures are recorded in `ingest_runs.stats.errors` with the raw bytes already safely archived — re-extraction is a local operation, never a re-fetch.

**Embedding is decoupled** (§4.5): the sync loop never calls the embedding provider. A 3am provider outage cannot fail a sync.

### 4.3 Delete propagation: fast path + universal backstop

- **Fast path** (sources that announce deletions): IMAP `VANISHED`/EXPUNGE, Readwise `includeDeleted=true` → tombstone immediately during incremental sync. A fast-path batch whose deletes exceed the guard threshold (below) aborts the same way a sweep does — one buggy `VANISHED` response must not empty a mailbox.
- **Backstop — mark-and-sweep reconciliation** (all sources, scheduled less frequently): `enumerate()` the partition into a staging set, recording the enumeration start time; on **successful completion only**, apply three rules:
  1. *Tombstone* live documents absent from the set (`delete_reason = 'sweep'`) — **except** documents with `first_seen_at` later than the enumeration start (they were ingested mid-enumeration by design or by the fast path and are legitimately absent from the snapshot).
  2. *Upsert* documents whose `source_version` mismatches (this also catches anything a delta API silently dropped — it is the detector for a stuck cursor or silently-authenticated-but-empty sync).
  3. *Resurrect* tombstoned documents that ARE in the set: clear `deleted_at` (§2.3). This closes the loop that makes every false tombstone self-healing.

  An aborted enumeration must never delete anything — stale beats broken.
- **Mass-delete guard:** if a sweep (or fast-path batch) would tombstone more than `max(5, 10% of live docs)` for a source — per-source configurable — abort the *tombstone phase* with `status = 'aborted_guard'` and alert; rules 2 and 3 (upserts, resurrections) still apply, so a pending `--force` decision doesn't also freeze updates. An enumeration returning zero or near-zero items never sweeps at all (an empty NAS mount or truncated listing is an error, not a corpus). Override is a manual `--force`.

### 4.4 Generation resets (the UIDVALIDITY answer)

When a partition's generation token changes (UIDVALIDITY reset, folder recreated, account migrated), every cached sync id for it is invalid — but the *content* is mostly the same. The engine:

1. Bumps `sync_state.generation`, invalidates the cursor; does **not** touch documents.
2. Runs a full `enumerate()` + header-level fetch, **rebinding** source items to existing documents by source-native durable id (Message-ID) — which resolves the overwhelming majority. Only items still unmatched after the header pass get a full body fetch for `raw_sha256` content matching; still unmatched → new document.
3. Only after the enumeration completes do unmatched local documents become tombstone candidates — through the same mass-delete guard.

Result: a UIDVALIDITY reset costs one re-enumeration, preserves document identity/embeddings for unchanged content (content-addressing makes re-fetched bytes free), and cannot mass-delete.

### 4.5 Embedding worker

A separate scheduled job: select chunks lacking a `chunk_embeddings` row for the active space — Postgres is the queue — batch ~128 texts per provider call, embed `context_prefix + "\n" + text`, insert vectors. **No row locks are held across network calls:** the worker reads a candidate batch of chunk ids in a short transaction and releases it, calls the provider (including any 429 backoff sleeps), then inserts with `ON CONFLICT DO NOTHING`, tolerating chunks deleted mid-flight (an update/purge won the race; the vector is simply discarded). Holding `FOR UPDATE` locks through a provider outage would block the sync loop's chunk deletes — the write path stalling the write path. Backlog size is a first-class metric (§8). The provider abstraction is one interface:

```python
class EmbeddingProvider(Protocol):
    space: EmbeddingSpace                      # provider, model, dim, metric
    def embed_documents(self, texts: list[str]) -> list[Vector]
    def embed_query(self, text: str) -> Vector
```

Hosted implementations first (Voyage, OpenAI); a local implementation (e.g. ONNX/llama.cpp serving an open-weight model) is a later drop-in — same interface, new `embedding_spaces` row, swap per §2.4.

### 4.6 Privacy routing (day one, cheap)

`sources.allow_hosted_processing = false` ⇒ the embed worker skips that source's chunks while the active space is hosted; those documents are FTS-searchable only (their text still never leaves the box). When a local space becomes active they embed like everything else. The same flag gates any future hosted enrichment. This makes the brief's privacy boundary an enforced property, not a convention.

### 4.7 Per-source design

**Markdown folder (`fsdir`)** — the vertical-slice source.
- *Identity:* `external_id` = path relative to the source root.
- *Change detection:* periodic scan (15 min default). Fast path: unchanged `(size, mtime_ns)` in `conn_fsdir_files` ⇒ skip; else rehash, compare `sha256`. mtime alone is a liar (sync tools preserve it); the hash is the verdict. A filesystem watcher is an optional scan-trigger optimization, never the mechanism — the folder may be populated by Syncthing/rsync with temp files and partial writes, so scans + ignore patterns (`.stfolder`, `*.tmp`, `.sync-conflict-*`, dotfiles) are the reliable ground truth.
- *Renames:* a rebind (`UPDATE external_id`, same document row) happens **only** when exactly one vanished path and exactly one new path share a `sha256` in the same scan — identical content is common (templates, empty notes), and ambiguous pairings must degrade to plain delete + create (content addressing makes the archive cost zero). A rebind preserves the document's existing uuid (the new sidecar records it, and rebuilds honor sidecar ids over re-derivation — invariant 3 survives renames), **recomputes all path-derived metadata** (project, tags, title fallback), updates the `conn_fsdir_files` row, and writes an `alias.json` marker under the old archive prefix pointing at the new `external_id`.
- *Deletes:* absent from a **completed** scan ⇒ tombstone (through the guard). `enumerate()` = the scan itself.
- *Extraction:* body passes through (it's already markdown); parse frontmatter → title/tags/project; NFC-normalize; directory components → `project`/`tags`.
- *`doc_ts`:* frontmatter date if present, else `first_seen_at` (stable). Never bare mtime — the same reason it isn't trusted for change detection.

**Readwise** — the API-cursor source.
- *Highlights (v2):* `GET /api/v2/export/` with `updatedAfter` + `includeDeleted=true`; paginate `pageCursor`. Deletions are cursor-visible — the fast path covers them. One **highlight = one document** (`doc_type='highlight'`, `external_id='hl:<id>'`, one chunk); the book/article groups them via `thread_id='book:<book_id>'`, with title/author as metadata. Highlight-level identity makes highlight-level deletes and edits trivial.
- *Reader articles (v3):* `GET /api/v3/list/` with `updatedAfter`, `withHtmlContent=true` for changed docs → trafilatura → markdown. Reader exposes **no deletion signal**, so the mark-and-sweep backstop is mandatory here: weekly `enumerate()` = paging id-only listings.
- *Scope:* Reader's `location=feed` (RSS items) is **excluded by default**, per-source configurable — and whatever the scope is, `changes()` and `enumerate()` must apply the *identical* filter, or the sweep tombstones everything the incremental path ingests. This symmetry rule holds for every connector.
- *Cursor & rate budget:* `{highlights_updated_after, reader_updated_after}`; 20 req/min on export/list, honor `Retry-After`. The weekly id-only enumeration is ~100 ids/request — minutes for a curated library, and the §4.3 enumeration-start exemption makes even a long sweep window harmless against concurrent incrementals (which the advisory lock serializes anyway).

**IMAP** — the hardest source; done last deliberately.
- *Identity:* `external_id` = Message-ID when present, else `sha256` of canonical headers+body. **UIDs are never identity** — they are sync bookkeeping in `conn_imap_messages`. A message in multiple folders is one document; folders land in `tags`. *Message-ID collisions* (buggy bulk senders reusing ids across distinct messages) are detected at upsert time: known `external_id` + different `raw_sha256` + different immutable identity headers (Date/From/Subject) ⇒ not a content update but a collision — the newcomer gets the content-hash `external_id` instead of versioning the incumbent, with the shared Message-ID recorded in `extra` so thread grouping still works.
- *Multi-folder deletes:* a `VANISHED`/EXPUNGE in one folder removes that `(folder, uid)` row from `conn_imap_messages` and drops the folder from `tags`; the connector emits a document **delete only when the document's last UID row is gone**. A move (delete in one folder, appear in another) thus never tombstones — and since the content is unchanged (`norm_sha256` match), it costs nothing.
- *Cursor per folder:* `{uidvalidity, uidnext, highestmodseq}`.
- *Incremental:* new mail via `UID FETCH <last_uidnext>:*`; flag changes via CONDSTORE `CHANGEDSINCE`; deletions via QRESYNC `VANISHED` where supported (Fastmail/Cyrus: yes; Gmail: CONDSTORE only, no QRESYNC — deletions come from the sweep). Server capabilities from `probe()` decide the mode.
- *UIDVALIDITY reset:* exactly the §4.4 generation path — Message-ID/content-hash rebinding makes it an enumeration, not a re-download.
- *Gmail quirk:* if Gmail is ever a source, sync only `[Gmail]/All Mail` and use `X-GM-MSGID` as identity; labels → tags.
- *Extraction:* stdlib `email` with `policy.default`; charset fallback chain (declared → charset-normalizer → `errors='replace'`) — ingest degraded rather than crash. Prefer text/plain for human-written mail; HTML-only mail (newsletters) → DOM → markdownify. Strip quoted history (`blockquote`/`gmail_quote` DOM rules + a maintained reply-parser lib; **not** talon, unmaintained since 2016) — only new content is indexed; the full original including quotes is in the archive, so a bad strip is always recoverable. `thread_id` from References/In-Reply-To chain. Attachments: archived + recorded as `doc_type='attachment'` rows (filename/mime/size/hash), **no text extraction day one**.
- *Library:* Python `imapclient` (mature; raw commands available for QRESYNC).

### 4.8 Full rebuild

`cairn rebuild [--from-archive]` uses the same shadow-and-swap pattern as the §2.4 space swap — **never** truncate-and-refill, which would empty both search arms for the hours the re-embed takes (a broken query surface caused by routine maintenance, the exact thing constraint 1 forbids):

1. Take the exclusive writer lock (§8) — scheduled syncs no-op until the swap completes.
2. `CREATE TABLE chunks_next / chunk_embeddings_next`; walk every document's current version — **including tombstoned documents**, whose chunks must survive rebuilds for `include_deleted` search to keep working — re-chunking from `norm_text` (or re-extracting from archive blobs with `--from-archive`, e.g. after an extractor fix) into the shadow tables. Resumable by document-id watermark.
3. Build the GIN and HNSW indexes on the full shadow tables (bulk build, big `maintenance_work_mem`).
4. One transaction: rename-swap both tables (with their FKs); drop the old pair after soak.

Queries serve the old index until the instant of the swap — a mid-rebuild crash leaves yesterday's working index, not an empty one. `overview()` reports `rebuild_in_progress` while step 2–3 run so assistants can caveat freshness. Deterministic given pinned `extractor_version`/`chunker_version` and the archive; chunk ids are uuidv5 so an identical rebuild reproduces identical ids (invariant 3). One code path serves the §2.4 space swap, this rebuild, and the future semantic-shortening swap — it gets exercised routinely, not discovered broken in a disaster.

### 4.9 Initial backfill

First ingest of a large source (a 50k-message mailbox ≈ 500k chunks) is its own mode, `cairn backfill <source>`, because the steady-state path is wrong for it in three ways:

- **Order:** enumerate and ingest **newest-first** per partition — recent mail is searchable within minutes of day one; 2011's archive fills in behind it.
- **Index build:** the §2.1 HNSW index must not exist yet (or is dropped for the duration): 500k row-by-row inserts through an HNSW graph is the pattern §2.4 forbids, an order of magnitude slower than bulk-build-at-the-end. Backfill embeds into the bare table and builds HNSW once, exactly like §4.8 step 3. (Phase-1-sized sources won't notice; a Phase 3 mailbox will.)
- **Overlap:** backfill holds the source's advisory lock for its whole (possibly multi-day) run, so the 15-minute scheduled syncs no-op harmlessly until it finishes; its resumable cursor means a crash loses only the in-flight batch.

Throughput is provider-bound, not corpus-bound: at paid-tier embedding rate limits, a full 250–500M-token corpus embeds in hours, not days; IMAP fetch at typical server throttles is the long pole for mail.

---

## 5. Chunking strategy

**Targets: ~400 tokens per chunk, hard cap 512, no overlap, never split items under 512 tokens.** Boundaries are structure-aware and deterministic: markdown headings → paragraphs → sentences → (only if a single sentence exceeds the cap) tokens.

Reasoning, from the empirical record:

- Chunk-size evals (Chroma's chunking study; multi-dataset academic follow-ups) put recursive structure-aware splitting at **200–512 tokens** at or near the recall frontier; quality degrades well before embedding-model context limits. 400 sits in the band that serves both fact-lookup and narrative queries for a mixed personal corpus.
- **No overlap:** systematic analysis shows 10–20% overlap adds no measurable retrieval gain once boundaries respect sentences/structure — it just inflates the index with near-duplicates. Overlap compensates for dumb boundaries; we're paying for smart ones instead.
- **No semantic/LLM chunking:** embedding-based boundary detection loses to recursive splitting on real (non-synthetic) corpora in published evals, costs extra embedding passes, and — decisive here — is **non-deterministic**, which would break reproducible rebuilds. Deterministic chunking is what makes "the index is a pure function of the archive" true.
- **Context prefix instead of contextual retrieval:** each chunk's *embedded* text is prefixed with a deterministic breadcrumb — `source / title / heading_path / date / author`. This recovers much of the measured benefit of Anthropic-style contextual retrieval (which prepends LLM-generated context) at zero cost, zero rot, and full determinism — aligned with the brief's metadata philosophy. The prefix is stored separately (`context_prefix`) and excluded from FTS so keyword search stays verbatim. True LLM contextualization remains a possible later enrichment: regenerable from the archive, behind the provider abstraction.

Per-source shapes:

| Source | Chunk unit | Notes |
|---|---|---|
| Email | Per message, quotes stripped | `From/Date/Subject` in the breadcrumb; thread = parent via `thread_id` |
| Highlight | Whole item (highlight + note) | Book/article title + author in breadcrumb; never split |
| Markdown / article | Heading-first recursive | `H1 > H2 > H3` breadcrumb per chunk |

**Small-to-big retrieval is structural from day one:** chunks carry `span_start/span_end` into `norm_text`, so search matches small and precise while `fetch`/`get_context` rehydrate the parent section, full document, or archive original. This is exactly the multi-representation pattern the future semantic-shortening work needs, and the schema already carries its seam: `chunks.representation` (default `'verbatim'`). A shortened proxy later lands as additional `representation='summary'` rows over the same parent links — eligible for the vector arm, **excluded from the keyword arm by the §2.2 predicate** (the brief requires full-text precision to stay over original text) — introduced by re-derive (§4.8), not migration.

---

## 6. The MCP query surface

### 6.1 Server

Python **FastMCP**, **Streamable HTTP** transport, stateless. Read-only Postgres role — the query surface physically cannot write (constraint 3 enforced at the grant level). Runs on the tailnet/VPN: network access *is* the baseline auth for local agents and Codex. If ChatGPT or a hosted Codex environment must reach it later, expose one public hostname behind the reverse proxy and enable FastMCP's OAuth 2.1 resource-server support — hosted clients only speak OAuth; do not build static-bearer-token auth expecting them to use it. Tool results use `structuredContent` with declared `outputSchema`.

### 6.2 Tools (4)

Tool names `search` and `fetch` are kept *exactly*, and their result fields carry the `text`/`url` aliases hosted connectors expect — the OpenAI connector contract constrains field shapes, not just names (verify against the current spec at build time, like the §10.1 Voyage caveat). That cross-assistant compatibility is the whole point of the one-endpoint design.

**Id-stability contract:** `id` (document) is permanent — deterministic, recorded in sidecars, survives every rebuild (invariant 3); safe for assistants to cite and remember. `chunk_id` is a short-lived handle: valid until the document's content changes or the index is rebuilt. Consumers that held a stale `chunk_id` fall back to `get_context(id, seq)`, which re-resolves against the current chunking.

**`search`** — the workhorse. Hybrid by default.

```jsonc
// input
{
  "query": "contract renewal",        // optional; omitted ⇒ structural browse (below)
  "sources": ["mail-fastmail"],       // enum, values from overview()
  "doc_type": ["email"],              // enum: email | highlight | article | note | attachment
  "date_from": "2026-03-01",          // ISO 8601 date, interpreted in the configured home
  "date_to":   "2026-04-01",          //   timezone; resolved instants echoed in applied_filters
  "thread_id": null,
  "project": null,                    // enum, values from overview()
  "tags": [],                         // match any
  "author": null,                     // who *wrote* it: documents.author / participants role='from'
  "participant": null,                // who was *involved*: any participants entry, any role
                                      // both: case-insensitive substring over name and address
  "include_deleted": false,           // true ⇒ tombstoned docs included, marked deleted:true
  "mode": "hybrid",                   // hybrid | keyword | semantic (default hybrid)
  "limit": 10,                        // documents per page; max 50
  "cursor": null                      // opaque, from a previous response
}
// output (structuredContent)
{
  "results": [{
    "id": "d3f1…",                    // document id — permanent; the input to fetch()
    "chunk_id": "9a2c…",              // best-matching chunk — short-lived; input to get_context()
    "title": "Re: Contract renewal timeline",
    "doc_type": "email", "source": "mail-fastmail", "project": null,
    "date": "2026-03-14T09:22:00Z",
    "author": "Sarah Kim <sarah@acme.com>",
    "thread_id": "t:CAF3…",
    "url": "cairn://doc/d3f1…",       // synthesized stable URI when no source URL exists —
                                      //   hosted clients use url for citation identity
    "source_url": null,               // the real URL at the source, when there is one
    "snippet": "…the **renewal** clause runs to *March 31*, and Sarah proposed…",  // ≤ ~300 chars
    "text": "…same as snippet…",      // alias for hosted-connector compatibility
    "matched_chunks": 3,              // this doc had 3 chunks in the fused pool (collapsed)
    "score": 0.83,                    // ordinal (RRF-derived), not calibrated — for ranking only
    "deleted": false,                 // only with include_deleted
    "stale": false                    // true if this source's last successful sync is overdue
  }],
  "next_cursor": "eyJv…",             // null when exhausted
  "freshness": { "mail-fastmail": "2026-07-01T05:00:12Z" },
  "applied_filters": { "sources": ["mail-fastmail"],
                       "date_from": "2026-03-01T00:00:00-05:00" },
  "hint": null                        // e.g. "0 results; try dropping doc_type or widening dates"
}
```

**Modes.** `hybrid` fuses both arms (§6.3); `keyword` runs the FTS arm only (also the automatic degradation when the embedding provider is unreachable — flagged in `hint`); `semantic` runs the vector arm only. **Browse** (query omitted): a pure structural listing — `ORDER BY doc_ts DESC NULLS LAST, id`, one row per document, `snippet` = leading ~300 chars, `score` null; with a `thread_id` or single-document filter, rows come back per-chunk in `seq` order so threads read in order. Browse is how thread expansion and "latest notes in project X" work.

**Grouping.** Hybrid/keyword/semantic results are collapsed to the **best chunk per document** after fusion (`matched_chunks` counts the siblings; `get_context`/`fetch` recover them), and `limit` counts documents — one long note can't monopolize a page. Near-duplicates across sources (the same newsletter in IMAP and Reader) sharing a `norm_sha256` or `source_url` collapse into one row with the twins listed under `duplicates: [{id, source}]`.

**Pagination.** Browse and keyword modes use keyset cursors (`(doc_ts, id)` / `(rank, chunk_id)`) — stable, unbounded; exhaustive enumeration ("all 300 highlights on sleep") belongs there, and the server says so in `hint` when a hybrid result set truncates. Hybrid cursors deepen the fusion pool geometrically per page (per-arm 40 → 120 → 360, ceiling 1,000) with `ORDER BY rrf DESC, chunk_id` as the deterministic tiebreak; beyond the ceiling `next_cursor: null` plus a narrowing `hint`. Cursors encode the mode + a filter hash; reuse with different parameters returns a structured `CURSOR_MISMATCH` error.

**`fetch`** — rehydration.

```jsonc
// input:  { "id": "d3f1…", "offset": 0, "max_chars": 20000 }
// output: full metadata + canonical markdown, paged by char offset:
{
  "id": "d3f1…", "title": "…", "url": "cairn://doc/d3f1…",
  "text": "…canonical markdown…",     // primary content field (hosted-connector shape)
  "metadata": {
    "doc_type": "email", "source": "mail-fastmail", "project": null,
    "author": "…", "participants": [...], "thread_id": "…", "tags": [...],
    "date": "…", "source_url": null,
    "deleted": false,                 // tombstoned docs still fetch, flagged
    "version": 3,
    "archive_ref": "originals/mail-fastmail/…/ab12….raw"  // the durable original pointer
  },
  "offset": 0, "remaining_chars": 0
}
```

**`get_context`** — cheap expansion around a hit without fetching the whole document.

```jsonc
// input:  { "chunk_id": "9a2c…", "before": 2, "after": 2 }
//   — or, when a held chunk_id has gone stale (content changed, index rebuilt):
//          { "id": "d3f1…", "seq": 4, "before": 2, "after": 2 }
// output: { "id": "d3f1…", "title": "…",
//           "chunks": [{ "seq": 4, "heading_path": "…", "text": "…" }, …] }
```

**`overview`** — teaches the assistant the filter vocabulary and the corpus's health. Called once per session by a well-prompted client; makes hallucinated filter values structurally unlikely.

```jsonc
// output
{
  "sources": [{ "key": "mail-fastmail", "kind": "imap", "doc_count": 48210,
                "date_range": ["2011-04-02", "2026-06-30"],
                "last_sync": "2026-07-01T05:00:12Z", "status": "ok" }],
  "doc_types": [{ "type": "email", "count": 48210 }, { "type": "highlight", "count": 9120 }],
  "projects": ["cairn", "house", …],
  "top_tags": ["newsletters", "projects/cairn", …],
  "embedding": { "provider": "voyage", "model": "voyage-4", "backlog_chunks": 0 },
  "rebuild_in_progress": false,
  "notices": []      // e.g. "source readwise: last sync failed 2026-06-30 (auth); data stale"
}
```

**Result-contract rules:** every result row ≤ ~120 tokens; default `limit` 10; snippets carry `**term**` highlighting; empty result sets return a populated `hint` (suggested filter relaxations) instead of a bare empty array so the model self-corrects; errors are structured (`{"error": "NOT_FOUND" | "PURGED" | "CURSOR_MISMATCH" | …, "hint": …}`), never protocol faults. Staleness is surfaced (`stale`, `freshness`, `notices`, `rebuild_in_progress`) so the assistant can caveat answers — graceful degradation made visible at the query surface.

### 6.3 Hybrid search internals

```sql
-- per connection: SET hnsw.ef_search = 80; SET hnsw.iterative_scan = 'relaxed_order';
-- NOTE: the structural filter block (identical in both arms) is duplicated on purpose.
-- A shared `filtered` CTE would be referenced twice, so Postgres would materialize it
-- and neither the HNSW nor the GIN index would be used. Generate both arms from one
-- filter fragment in code; don't refactor the SQL into a common CTE.
WITH vec AS (
  SELECT ce.chunk_id AS id, ROW_NUMBER() OVER (ORDER BY ce.embedding <=> $qvec) AS r
  FROM chunk_embeddings ce
  JOIN chunks c    ON c.id = ce.chunk_id
  JOIN documents d ON d.current_version_id = c.version_id AND d.deleted_at IS NULL
  JOIN sources s   ON s.id = d.source_id AND s.enabled
  WHERE ($sources IS NULL OR s.key = ANY($sources))
    AND ($doc_type IS NULL OR d.doc_type = ANY($doc_type))
    AND ($from IS NULL OR d.doc_ts >= $from) AND ($to IS NULL OR d.doc_ts < $to)
    AND ($thread IS NULL OR d.thread_id = $thread)
    AND ($projects IS NULL OR d.project = ANY($projects))
    AND ($tags IS NULL OR d.tags && $tags)
    -- + author/participant predicates (documents.author ILIKE / participants jsonb scan)
  ORDER BY ce.embedding <=> $qvec LIMIT 40      -- per-arm depth deepens per page (§6.2)
),
kw AS (
  SELECT c.id, ROW_NUMBER() OVER
         (ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', $qtext)) DESC) AS r
  FROM chunks c
  JOIN documents d ON d.current_version_id = c.version_id AND d.deleted_at IS NULL
  JOIN sources s   ON s.id = d.source_id AND s.enabled
  WHERE c.fts @@ websearch_to_tsquery('english', $qtext)
    AND c.representation = 'verbatim'           -- generated proxies never match keywords (§2.2)
    AND ($sources IS NULL OR s.key = ANY($sources))
    AND ($doc_type IS NULL OR d.doc_type = ANY($doc_type))
    AND ($from IS NULL OR d.doc_ts >= $from) AND ($to IS NULL OR d.doc_ts < $to)
    AND ($thread IS NULL OR d.thread_id = $thread)
    AND ($projects IS NULL OR d.project = ANY($projects))
    AND ($tags IS NULL OR d.tags && $tags)
  ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', $qtext)) DESC
  LIMIT 40           -- the ORDER BY is load-bearing: a bare LIMIT returns arbitrary rows,
)                    -- not the top-ranked ones — the window ORDER BY alone does not sort output
SELECT COALESCE(vec.id, kw.id) AS chunk_id,
       COALESCE(1.0/(60+vec.r), 0) + COALESCE(1.0/(60+kw.r), 0) AS rrf
FROM vec FULL OUTER JOIN kw USING (id)
ORDER BY rrf DESC, chunk_id LIMIT $pool;   -- deterministic tiebreak; RRF ties are common.
-- $pool > page size: the app then collapses to best-chunk-per-document and applies
-- duplicate folding (§6.2 grouping) before cutting to `limit` documents.
```

- RRF with k=60, fetching 40 per arm and fusing down — measured to beat fetching `limit` per arm. RRF consumes ranks only, which also blunts `ts_rank_cd`'s known scoring weaknesses; BM25 extensions (VectorChord-BM25 et al.) are deliberately **not** used unless evals show the keyword arm failing — stock first.
- `websearch_to_tsquery` is safe on raw user query text. The regconfig is passed **explicitly** (never the session default) and pinned to `'english'` day one. Known gap, accepted deliberately: chunks of non-English documents are indexed with their own language's stemmer (§10.4.5), so English-stemmed queries can miss them. If mixed-language recall ever matters, the documented insurance is to concatenate a `'simple'`-config vector into `fts` and OR a `websearch_to_tsquery('simple', $q)` term into the match — exact word forms then always hit, no query-language detection needed.
- The query embedding requires one hosted call at query time (~100 ms). **If the embedding provider is unreachable, `search` degrades to keyword-only and says so in `hint`** — the corpus never becomes unqueryable because a third party is down.
- Highly selective filters (single thread/day) let the planner skip HNSW for an exact scan; pgvector 0.8's cost estimation plus `iterative_scan` handle the middle ground.

---

## 7. Backup and redundancy

Proportionality rule: **the archive is irreplaceable; the index is a convenience to restore** (worst case it's re-derived from the archive for the cost of re-embedding, ~$15–30 + hours).

**The cardinal rule: back up objects, never store internals.** The object store's data directory (Garage's LMDB/block store, MinIO's `xl.meta` layout, SeaweedFS volume files) is **never a backup source** — a live file-level copy of a store's internals is a crash-inconsistent snapshot of somebody else's database, restorable only by the same store version, if at all. Instead, `cairn backup` exports through the S3 API: `rclone sync s3:cairn-archive /backup/archive-mirror`, producing a **plain file tree of the objects under their keys**. This is trivially consistent on a live bucket precisely because archive writes are immutable put-if-absent (§3) — and it is what makes both the disaster path and the drill real: the walk-`originals/` catalog reconstruction and the per-object hash check operate on plain files with no object store running at all.

**One serialized entrypoint.** All backup steps run inside a single `cairn backup` invocation, in this order (at most one restic process ever touches a repo; stale locks from a crashed run are detected and cleared with `restic unlock` before starting):

1. `pg_dump -Fc` to the staging dir — **dump before mirror**: the catalog only references blobs written before it (§4.2 archives before indexing), so mirroring *after* the dump guarantees every hash in the restored catalog exists in the same night's backup set.
2. `rclone sync` bucket → local archive mirror.
3. `restic backup` of {archive mirror + dump + deployment dir (compose files, env/secrets, connector configs)} → **local repo on the second disk**.
4. `restic backup` of the same set → **B2 as a second, independent repo** — *not* a blind replication of the local repo. Independence is the point of 3-2-1: local repo corruption, deletion, or ransomware must not propagate offsite. The B2 application key has **no delete capability**, and the bucket uses object lock with a retention window; restic's AES-256 means everything off-box is ciphertext (the locality constraint's "cloud is backup only" clause). The repo password lives in the password manager **and** printed offline; an unreadable backup is not a backup.
5. `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --keep-yearly unlimited` + `prune` — when due (weekly), inside the same serialized run, never racing a backup.

**Index tier (rebuildable):** the nightly `pg_dump -Fc` above is the whole story. **No WAL archiving, no PITR** — a 24h RPO is proportionate when the true fallback is a rebuild from the archive. (pgBackRest was briefly archived in April 2026 but was revived on 2026-05-18 under multi-vendor sponsorship — the no-PITR decision rests **solely** on proportionality, and pgBackRest is the known upgrade path if RPO requirements ever tighten.) Restore = one `pg_restore`; the dump includes the full catalog and sync state, so a restore avoids re-embedding entirely.

**Verification (scripted, zero manual steps):**
- Weekly `restic check` on the local repo; monthly `restic check --read-data-subset=5%` (rotating full-data verification) **and** a monthly `restic check` against the B2 repo — an unverified offsite copy is a hope, not a backup.
- Quarterly automated **restore drill**: `pg_restore` into a scratch container → smoke queries (row counts per source, one hybrid search that **asserts the vector arm executed**) → **completeness pass**: set-difference the restored catalog's distinct `raw_sha256` values against a listing of the restored archive mirror — any missing hash fails the drill (random sampling can't catch a systematically excluded prefix; a set-diff over hashes is cheap and catches it immediately) → random-sample content verification (restore N objects, sha256-compare) on top.
- Annually, one drill runs the full disaster path: fetch the **B2** repo using only the printed password, restore onto a scratch box, `docker compose up` the whole stack from the restored deployment dir, and hit the MCP `search` endpoint. "Re-creatable from B2 + one password" is a claim the calendar tests, not the disaster.
- Every step pings its own healthcheck; a drill that doesn't run is an alert, same as one that fails.

**Secrets runbook (small, but written down):** an inventory of every secret (B2 keys, embedding API key, IMAP/Readwise credentials, restic password) with its rotation procedure; the restic password is **never rotated** — rotating it means a new repo and a full re-upload, so treat it as a birth certificate, not a password (migrate repos deliberately if ever compromised); offline printed copies are reprinted on any change; the connector contract reserves an optional `refresh_credentials()` hook so OAuth-based sources aren't foreclosed.

---

## 8. Operations

**Scheduling contract (tool-agnostic):** every operation is an idempotent CLI command — `cairn sync <source>`, `cairn reconcile <source>`, `cairn embed`, `cairn backup`, `cairn checkup`, `cairn drill`, `cairn backfill`, `cairn rebuild`. Anything that can run commands on a schedule (cron, systemd timers, a container scheduler) drives them; nothing in the design knows which. Suggested cadence: sync 15–60 min per source (`fsdir` 15m, Readwise 1h, IMAP 15m), reconcile nightly (fsdir/IMAP-QRESYNC) to weekly (Readwise Reader), embed every 5 min (no-op when caught up), backup nightly, checkup every 15 min, drill quarterly.

**Concurrency contract — idempotent is not the same as concurrent-safe, so overlap is simply forbidden:** sync/reconcile/backfill take a Postgres advisory lock per `(source_id, partition)` (§4.2 step 0); `rebuild` and the §2.4 space swap take an exclusive engine-wide writer lock. A job that finds its lock held skips, pings its healthcheck, and exits 0 — a slow sync outlasting its cron interval produces harmless no-ops, not interleaved cursors.

**Observability:**
- Every run writes an `ingest_runs` row (counts, duration, errors) — the ops dashboard is a SQL query before it's anything fancier.
- Structured JSON logs to stdout; journald/container logs collect them.
- **Dead-man switch:** every scheduled job pings a per-job healthchecks.io check (hosted — a self-hosted monitor dies with the homelab it watches), using the **`/fail` endpoint when its own run ended badly** — so a job alerts both by absence (didn't run) and by content (ran and failed). Healthchecks.io supports real cron expressions and grace periods.
- **`cairn checkup` — the alert evaluator.** Alert *conditions* are mostly database states; something has to evaluate them, and that something must itself be dead-man monitored. Checkup runs the condition SQL below every 15 minutes and pings its healthcheck's `/fail` endpoint when any condition trips (with the offending conditions in the ping body). If checkup stops running, its own check goes stale — the watcher is watched.
- **Read-path probe:** the design's highest-ranked property is query availability, so it gets the most direct monitor: a scheduled probe performs a real MCP `search` call (keyword mode, canned query) and pings its healthcheck only on success. MCP process down, Postgres down, or host down ⇒ absent ping ⇒ alert.

**Alert conditions evaluated by `cairn checkup` (each also visible in `overview()` notices):**
| Condition | Meaning |
|---|---|
| `ingest_runs.status = 'failed'` streak ≥ 3 for a source | Auth expiry, API change — that source is stale, everything else fine |
| Any `aborted_guard` run unresolved | Sweep wanted a mass delete — human decision required |
| Embed backlog > N for > 1h | Provider outage/quota — corpus is FTS-only for new docs |
| Last successful drill older than its cadence | Backups are fiction until proven otherwise |
| **Disk usage > 80% (warn) / 90% (fail)** on data, Postgres, or backup volumes | The one failure that breaks the read path: Postgres PANICs on full WAL disk. Prefer separate volumes so archive growth can't starve Postgres; the ingest engine refuses to start a backfill below a free-space floor — gracefully stale, never a crashed database |
| Extraction quality regression (below) | Garbage indexed silently |

**Extraction quality (liveness isn't enough — a sync that "succeeds" can index garbage):** every version records quality signals in `document_versions.extraction` — charset replacement count, strip ratio (`len(norm_text)/len(raw)`), near-empty flag. Checkup alerts on aggregates: >5% of a run's items near-empty, or a strip-ratio collapse for a sender/domain (the newsletter-template-change failure mode). Two human affordances: `cairn inspect --sample N <source>` renders raw-vs-normalized side by side, and a checked-in **golden corpus** of raw→expected-`norm_text` pairs gates every `extractor_version` bump.

**Time:** one configured home timezone interprets bare-date search filters (§6.2 echoes resolved instants in `applied_filters`); `doc_ts` is always stored as the source's absolute timestamp.

**Environments:** a deployment has an *environment identity* (e.g. `prod`, `dev`) that prefixes bucket names, restic repos, and healthcheck slugs — a dev instance can never pollute prod's archive or mask prod's dead-man alerts. The dev profile defaults to the null/local embedding stub and a capped ingest window (e.g. last 30 days), so developing a connector against live sources is cheap and doesn't ship the mailbox to a hosted provider a second time.

**Failure containment recap:** ingest failures mark sources stale and alert — the MCP server keeps serving the last committed state, and surfaces staleness to the assistant rather than hiding it. Write-path processes cannot take down the read path (separate processes, read-only DB role, shadow-table rebuilds); the shared-resource exceptions — disk and the database itself — are exactly what checkup's disk thresholds and the read-path probe watch.

---

## 9. Phased build sequence

Each phase lands working software behind an acceptance test; the vertical slice comes first, on the lowest-risk connector, while the core is still churning.

**Phase 0 — Foundations (small).** Repo, `docker-compose` (Postgres+pgvector ≥0.8.4, object store), migration tooling, config/secrets layout, `EmbeddingProvider` abstraction + one hosted implementation, healthchecks wiring. *Accept:* `cairn init` stands up an empty, migrated system.

**Phase 1 — Vertical slice: `fsdir` end-to-end.** Scanner connector → archive writes + sidecars → normalize → chunk → embed worker → hybrid SQL → MCP server with all four tools → **backups and `cairn checkup` running from day one** (rclone mirror + restic + pg_dump + drill script — the operational spine is part of the slice, not an afterthought). *Accept:* from a fresh assistant connected to the MCP endpoint, "find that markdown note about X" returns the right note with a citation; kill the embed provider key and search still answers keyword-only with a hint; restore drill — including the catalog-vs-mirror completeness pass — passes on a scratch box.

**Phase 2 — Readwise.** First API-cursor connector; exercises `updatedAfter` cursors, `includeDeleted` fast-path tombstones, Reader mark-and-sweep, rate-limit backoff, highlight-as-document modeling. Connector tests run against **recorded HTTP cassettes**, including chaos cases (truncated listings, 429s). *Accept:* delete a highlight in Readwise → gone from search after next sync; still fetchable with `search(include_deleted)` + `fetch`, flagged `deleted: true`.

**Phase 3 — IMAP.** The hard one, on a mature core: QRESYNC/CONDSTORE modes, UIDVALIDITY generation reset, quote-stripping extraction, threads, multi-folder refcounting, attachments-as-archive-rows, first real `cairn backfill` (§4.9). Integration tests run against a **containerized IMAP server (Dovecot/GreenMail)** with scripted UIDVALIDITY resets and VANISHED responses — the risky paths are exactly the ones never to exercise first against the live mailbox. *Accept:* full mailbox backfill newest-first; simulated UIDVALIDITY reset re-binds without re-downloading or mass-deleting; "what did <person> say about <topic> in <month>" answers in ≤2 tool calls.

**Phase 4 — Hardening.** Reconciliation sweeps on by default everywhere, mass-delete guard chaos tests (truncated listings, flaky enumerations, empty mounts), `cairn rebuild` (shadow-swap) timed end-to-end from archive, the golden extraction corpus in CI, runbook (restore, provider switch, generation reset, secrets) written down.

**Phase 5 — Deferred tracks (any order, all non-foreclosing):** local embedding provider + per-source privacy routing exercised for real; semantic shortening as an additional representation over the same parent links (§5); OAuth exposure for hosted assistants; attachment/PDF text extraction (Docling); person-entity resolution if `author` substring filtering proves insufficient.

---

## 10. Recommendations on the open questions (and flagged risks)

### 10.1 Hosted embedding model

**Recommendation: Voyage `voyage-4` at 1024 dims (Matryoshka-truncated), paid tier with the zero-retention opt-out enabled.** Stored as `halfvec(1024)`, HNSW-indexed (m=16, ef_construction=200).

- **Cost is a non-issue:** a 1–2 GB text corpus ≈ 250–500M tokens → **$15–30 for a full (re-)embed** at $0.06/M. The "switching means re-embedding everything" tradeoff the brief accepts turns out to cost less than a takeout dinner — re-embedding is an *operational routine*, not a migration event.
- **Quality:** current retrieval-benchmark leader by a clear margin over OpenAI text-embedding-3 and Gemini embedding.
- **The roadmap fit:** the Voyage 4 family shares one embedding space across sizes, including **voyage-4-nano — open weights, Apache 2.0**. "Hosted now, local later" can mean *swapping the provider adapter without re-embedding the corpus* — no other provider offers this today. (Verify this space-compatibility claim against current Voyage docs at build time; it's load-bearing for the no-re-embed local path, though never for correctness — the ordinary re-embed path always works.)
- **Privacy:** paid-tier zero-day-retention is self-serve. Never use Voyage's or Gemini's free tiers — both train on submitted data.
- **1024 via MRL as the standard:** most serious providers (Voyage, Cohere, Gemini, OpenAI via `dimensions`) can emit 1024-dim vectors, so future provider switches usually preserve the schema (§2.4).
- *Fallback:* OpenAI `text-embedding-3-small` @1024, batch API (~$3–5 per full corpus) — maximally boring, measurably weaker retrieval, no open-weight analog.

### 10.2 Incremental vs. full rebuild

**Incremental sync + scheduled mark-and-sweep reconciliation; full rebuilds only for code/model changes, and from the archive, never from sources.** Cheap change detection per source: `(external_id, source_version)` comparison first (etag/MODSEQ/mtime — free), `raw_sha256` second (definitive), `norm_sha256` third (suppresses no-op re-embeds). Periodic *source* re-crawls are pointless: reconciliation catches silent gaps at enumeration cost, and the archive already holds everything else.

### 10.3 Unified vs. source-specific text handling

**Unify the representation, not the extractors.** Extraction is necessarily source-aware (quote-stripping is meaningless for markdown; readability extraction is meaningless for email), but every extractor emits the same `CanonicalDoc` (markdown body + structural metadata), and everything downstream — chunking, FTS, embedding, MCP `fetch` — is written once against that form. One chunker, one search pipeline, one result contract; per-source code confined to `fetch/extract`.

### 10.4 Genuine risks in the settled decisions

1. **"MinIO" in constraint 2 is now a soft spot** — community MinIO is effectively unmaintained (2025–26). Not a correctness problem (the constraint says "or S3-compatible") but a concrete recommendation change: default to Garage or SeaweedFS for new deployments; regardless, the design's durability never leans on store-specific features (§3, §7).
2. **Hosted embedding vs. the locality value (constraint 8, acknowledged in the brief — made concrete):** every document body except `allow_hosted_processing=false` sources transits the provider at ingest, and **every query string does too** (query embedding). If query privacy matters, that's an argument for prioritizing the local provider track in Phase 5. The per-source flag exists from day one; use it for anything sensitive *before* first sync, since retention opt-outs govern the future, not the past.
3. **"Mirror" semantics vs. lossless archive (constraints 2 & 3) genuinely conflict on deletion**, and the design resolves it by fiat: index mirrors, archive retains, purge is manual (§2.3). If the operator's mental model is "deleted at source = gone", that's a policy override to state now — the default here says an archive's job is to remember.
4. **pgvector operational sharp edge:** HNSW + heavy delete/update cycles had real corruption bugs before 0.8.3/0.8.4. Pin ≥0.8.4, prefer `REINDEX CONCURRENTLY` after bulk churn (rebuilds, space swaps), and keep `maintenance_work_mem` sized for index builds. None of this threatens data (the index is derived); it threatens quiet recall degradation — which the quarterly drill's smoke search also guards.
5. **Mixed-language corpora vs. Postgres FTS:** wrong-language stemming silently costs keyword recall. Cheap insurance is in the schema (per-document `lang` via fast-langdetect, per-language regconfig with `simple` fallback); flagging so it isn't dropped as an "optimization."

---

## Appendix: primary sources consulted

Embedding landscape & pricing: Voyage 4 announcement/pricing, OpenAI/Cohere/Gemini docs · pgvector: 0.8.x changelog, HNSW/iterative-scan guidance (Crunchy, Neon, AWS) · Hybrid RRF: Supabase-pattern SQL walkthroughs · MCP: 2025-11-25 spec + 2026-07 RC notes, Anthropic tool-writing guidance, OpenAI search/fetch connector requirements · Chunking: Chroma chunking eval, arXiv 2505.21700, NAACL-2025 semantic-chunking cost study, Anthropic contextual retrieval · Sync: RFC 7162 (CONDSTORE/QRESYNC), RFC 8474 (MAILBOXID), Gmail IMAP extensions, Readwise v2/v3 API docs, Syncthing scan model · Backup: PostgreSQL backup-tooling landscape 2026 (incl. pgBackRest's April archive / May revival), restic/rclone/B2 practice, healthchecks.io.
