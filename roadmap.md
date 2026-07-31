# Cairn roadmap

> Generated from the [Cairn Roadmap GitHub Project](https://github.com/users/ehussong/projects/6). The Project is authoritative.

## Vision

Cairn gives an external LLM one provenance-rich query surface over a personal corpus. The current product is a read-only Router over existing sources; a full corpus Store remains gated by evidence that routing alone cannot solve custody, duplication, portability, or platform lock.

## Now / Next / Later

This is the proposed execution order. Within each bucket, top is next up; blocked-by dependencies are hard constraints.

### Now

1. [#6 Validate canonical cross-source Router queries](https://github.com/ehussong/cairn/issues/6)
2. [#7 Harden normalized ranking, grouping, deduplication, and query fanout](https://github.com/ehussong/cairn/issues/7)

Only two items are currently unblocked, so the Now bucket is intentionally below the usual 3–5 items.

### Next

1. [#8 Define Router performance threshold and optional local index trigger](https://github.com/ehussong/cairn/issues/8)
2. [#9 Integrate DEVONthink with Cairn Router](https://github.com/ehussong/cairn/issues/9)
3. [#10 Add a read-only Fastmail connector](https://github.com/ehussong/cairn/issues/10)
4. [#11 Add a native read-only Readwise connector](https://github.com/ehussong/cairn/issues/11)
5. [#12 Finalize stable mutation targeting and capability boundaries](https://github.com/ehussong/cairn/issues/12)
6. [#13 Implement previewable, auditable Logseq write tools](https://github.com/ehussong/cairn/issues/13)
7. [#14 Decide whether Router evidence justifies building Cairn Store](https://github.com/ehussong/cairn/issues/14)
8. [#15 Decide source deletion versus archive retention policy](https://github.com/ehussong/cairn/issues/15)
9. [#16 Select the S3-compatible object store](https://github.com/ehussong/cairn/issues/16)
10. [#17 Select embedding provider and verify load-bearing external claims](https://github.com/ehussong/cairn/issues/17)

### Later

1. [#18 Store Phase 0: foundations](https://github.com/ehussong/cairn/issues/18)
2. [#19 Store Phase 1: fsdir vertical slice with operational spine](https://github.com/ehussong/cairn/issues/19)
3. [#20 Store Phase 2: Readwise ingestion](https://github.com/ehussong/cairn/issues/20)
4. [#21 Store Phase 3: IMAP ingestion](https://github.com/ehussong/cairn/issues/21)
5. [#22 Store Phase 4: reconciliation and recovery hardening](https://github.com/ehussong/cairn/issues/22)
6. [#23 Store Phase 5: deferred non-foreclosing tracks](https://github.com/ehussong/cairn/issues/23)

Adjust the proposal by reordering items on the [live Project](https://github.com/users/ehussong/projects/6); the board remains authoritative.
