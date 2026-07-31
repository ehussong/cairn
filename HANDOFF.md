# Session Handoff — cairn

**Written:** 2026-07-05 · **Sessions covered:** 2026-07-01 → 2026-07-02 (design phase)

## What this project is

Cairn is a personal knowledge store: all of the operator's personal data (email via IMAP, Readwise, markdown folders — pluggable) ingested into one self-hosted system, queryable by any LLM assistant through a single MCP endpoint. Two-tier storage: lossless archive (S3-compatible object store) + lossy rebuildable index (Postgres + pgvector, hybrid vector/FTS search). The full brief with settled constraints is embedded in the design doc's margins; treat its "settled decisions" as hard constraints.

## State: design phase COMPLETE, lightweight router prototype migrated

The design deliverable is **`docs/plans/2026-07-01-cairn-design.md`** (Draft v2). It contains all seven required artifacts: schema with full DDL, ingestion pipeline + connector contract with change detection and delete propagation per source, chunking strategy, MCP tool contracts with the hybrid RRF SQL, backup design for both tiers, operational plan, and a 6-phase build sequence. §10 answers the brief's four open questions with recommendations.

A separate lightweight **Cairn Router** prototype has now been migrated from `/Users/ethan/Documents/ethink` into this repo. It is a read-only TypeScript MCP server over existing local sources, currently with Logseq-folder and generic local-text-folder adapters. This prototype tests the "single MCP endpoint over existing sources" idea; it is not the full Cairn Store design from the plan.

How it got here: a research workflow (7 web agents: mid-2026 embedding providers, pgvector practice, MCP spec, chunking evidence, sync mechanics, backup tooling, extraction stacks) → I authored v1 → a 7-lens adversarial review workflow (constraints, schema/SQL, sync, MCP-consumer, ops, web fact-check, completeness) with per-finding skeptic verification → 29 upheld + 21 minor findings applied to produce v2. The review's biggest catches, now fixed in the doc: restic-over-object-store-internals was unrestorable (now: rclone object mirror); rebuild/backfill were truncate-in-place (now: shadow tables + atomic swap); tombstones couldn't self-heal (now: sweep resurrection rule); alert conditions had no evaluator (now: `cairn checkup`); ids weren't rebuild-stable (now: deterministic uuidv5 + sidecar ids).

## Repo state

- Git repo with **zero commits**. Current branch is `master`, but the configured main branch is `main` — rename before the first commit (`git branch -m master main`).
- Untracked: `docs/plans/2026-07-01-cairn-design.md`, `HANDOFF.md` (this file), `.serena/` (tooling cache — gitignore it), plus the migrated router files (`package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `src/`).
- The design doc was **deliberately not committed** — the operator hasn't asked yet. First-commit offer is outstanding.

## Decisions awaiting the operator

1. **Deletion policy confirmation** (design §2.3/§10.4.3): the doc resolves the mirror-vs-archive tension as *index mirrors the source, archive retains forever, purge is manual*. If the operator's mental model is "deleted at source = gone everywhere," that's a policy override to record.
2. **Object store choice** (§3): MinIO community edition is effectively unmaintained as of 2026; doc recommends evaluating Garage or SeaweedFS. Design depends only on the S3 API either way.
3. **Embedding provider** (§10.1): recommendation is Voyage `voyage-4` @ 1024 dims (halfvec), paid tier + zero-retention opt-out; fallback OpenAI `text-embedding-3-small`.

## Verify at build time (load-bearing external claims, flagged in the doc)

- Voyage 4 family sharing one embedding space incl. open-weight `voyage-4-nano` (enables local queries without re-embedding). Convenience-load-bearing only; ordinary re-embed path always works.
- OpenAI connector `search`/`fetch` result field shapes (doc already emits `text`/`url` aliases).
- pgvector ≥ 0.8.4 as the pinned floor (HNSW vacuum-corruption fixes).

## Next step if work continues

For the router prototype: configure `CAIRN_LOGSEQ_DIRS` / `CAIRN_LOCAL_DIRS`, run `npm install && npm run build`, and point an MCP client at `npm start` to test real queries. The router currently exposes `list_sources`, `search_corpus`, `search_by_source`, `get_item`, and `get_related`.

For the full Cairn Store design: Phase 0 of §9 remains repo scaffolding, docker-compose (Postgres+pgvector ≥0.8.4, object store), migration tooling, config/secrets layout, `EmbeddingProvider` abstraction + one hosted implementation, healthchecks wiring. Acceptance: `cairn init` stands up an empty, migrated system. Then Phase 1 is the `fsdir` vertical slice **including backups and `cairn checkup` from day one** — the operational spine is part of the slice by design, don't defer it.

## Conventions this project cares about (from the brief)

Single-operator sustainability; boring, well-supported tech; straightforward over clever; graceful degradation — stale data is acceptable, a broken query surface never is; structural metadata is load-bearing, LLM-generated tagging is optional sugar; every index entry keeps a durable link to its archive original; the index tier must always be rebuildable from the archive alone.
