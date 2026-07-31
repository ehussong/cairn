# Work-tracking migration manifest

Migration date: 2026-07-31

Repository: <https://github.com/ehussong/cairn>

Project: <https://github.com/users/ehussong/projects/6>
Owner / number: `ehussong` / `6`

## Discovery record

- Git remotes were fetched and pruned. The repository had no commits, remote branches, issues, or pull requests before migration; therefore Phase 0 had no merge or stale-branch action.
- Repository sources inspected: `HANDOFF.md`, `README.md`, `docs/plans/2026-07-01-cairn-design.md`, all source files, and all other tracked-candidate files.
- Code scan found no `TODO`, `FIXME`, or `HACK` work items.
- GitHub discovery found zero open/closed issues and zero open/closed pull requests before migration.
- Chat discovery reviewed the full Cairn conversation `019f1074-f6b9-7b02-bb4b-3091e4807f87`. Later Router decisions supersede the earlier assumption that the full Store should be built immediately. Current boundaries: Router first; direct read-only adapters for file-backed sources; API/MCP wrapping for external systems; future writes influence identity design now but remain deferred.

## Manifest

Every row passed a fresh `gh issue view` and appeared exactly once in a fresh `gh project item-list` read. Priority values are explicitly proposals. The milestone column records migration-time taxonomy; the five epic-mirroring milestones were removed in the subsequent sequencing cleanup because parent links already encode that membership.

| ID | Summary | Source | Parent | Milestone | Proposed priority | Issue | Project item ID | Verification |
|---|---|---|---|---|---|---|---|---|
| C-001 | Roadmap and delivery governance root epic | Migration taxonomy; Cairn chat | — | Roadmap governance | Now | [#1](https://github.com/ehussong/cairn/issues/1) | `PVTI_lAHOAF9BvM4BfAWjzg00Gng` | VERIFIED |
| C-002 | Reliable Router retrieval epic | `README.md:3-14,36-65`; Cairn chat | C-001 | Router v0.2 | Now | [#2](https://github.com/ehussong/cairn/issues/2) | `PVTI_lAHOAF9BvM4BfAWjzg00GoE` | VERIFIED |
| C-003 | Connected Router sources epic | `HANDOFF.md:5-13`; Cairn chat | C-001 | Router v0.3 | Next | [#3](https://github.com/ehussong/cairn/issues/3) | `PVTI_lAHOAF9BvM4BfAWjzg00GpI` | VERIFIED |
| C-004 | Safe Router writes epic | Cairn chat turns `019fb452…`, `019fb453…` | C-001 | Router v0.4 | Later | [#4](https://github.com/ehussong/cairn/issues/4) | `PVTI_lAHOAF9BvM4BfAWjzg00Gps` | VERIFIED |
| C-005 | Gated Cairn Store epic | Store design `§9`; Cairn chat | C-001 | Cairn Store | Later | [#5](https://github.com/ehussong/cairn/issues/5) | `PVTI_lAHOAF9BvM4BfAWjzg00Gq8` | VERIFIED |
| C-006 | Validate canonical cross-source queries | `README.md:36-50`; Cairn chat | C-002 | Router v0.2 | Now | [#6](https://github.com/ehussong/cairn/issues/6) | `PVTI_lAHOAF9BvM4BfAWjzg00Grg` | VERIFIED |
| C-007 | Harden ranking, grouping, deduplication, and fanout | Cairn chat turns `019fb3b8…`, `019fb4aa…` | C-002 | Router v0.2 | Now | [#7](https://github.com/ehussong/cairn/issues/7) | `PVTI_lAHOAF9BvM4BfAWjzg00Gsg` | VERIFIED |
| C-008 | Define performance threshold and index trigger | Cairn chat turn `019fb3b8…` | C-002 | Router v0.2 | Next | [#8](https://github.com/ehussong/cairn/issues/8) | `PVTI_lAHOAF9BvM4BfAWjzg00Gsw` | VERIFIED |
| C-009 | Integrate DEVONthink | Cairn chat turns `019fb558…`, `019fb559…` | C-003 | Router v0.3 | Next | [#9](https://github.com/ehussong/cairn/issues/9) | `PVTI_lAHOAF9BvM4BfAWjzg00GuA` | VERIFIED |
| C-010 | Add read-only Fastmail connector | `HANDOFF.md:5-7`; Cairn chat | C-003 | Router v0.3 | Next | [#10](https://github.com/ehussong/cairn/issues/10) | `PVTI_lAHOAF9BvM4BfAWjzg00GuY` | VERIFIED |
| C-011 | Add native read-only Readwise connector | `HANDOFF.md:5-7`; Store design Phase 2; Cairn chat | C-003 | Router v0.3 | Next | [#11](https://github.com/ehussong/cairn/issues/11) | `PVTI_lAHOAF9BvM4BfAWjzg00GvQ` | VERIFIED |
| C-012 | Finalize stable mutation targeting and boundaries | `README.md:67-84`; Cairn chat | C-004 | Router v0.4 | Next | [#12](https://github.com/ehussong/cairn/issues/12) | `PVTI_lAHOAF9BvM4BfAWjzg00Gvs` | VERIFIED |
| C-013 | Implement previewable, auditable Logseq writes | Cairn chat turn `019fb452…` | C-004 | Router v0.4 | Later | [#13](https://github.com/ehussong/cairn/issues/13) | `PVTI_lAHOAF9BvM4BfAWjzg00GwU` | VERIFIED |
| C-014 | Decide whether Router evidence justifies Store | `HANDOFF.md:9-15,35-39`; Cairn chat | C-005 | Cairn Store | Later | [#14](https://github.com/ehussong/cairn/issues/14) | `PVTI_lAHOAF9BvM4BfAWjzg00GxE` | VERIFIED |
| C-015 | Decide source deletion versus archive retention | `HANDOFF.md:23-27`; Store design `§10.4.3` | C-005 | Cairn Store | Later | [#15](https://github.com/ehussong/cairn/issues/15) | `PVTI_lAHOAF9BvM4BfAWjzg00Gxw` | VERIFIED |
| C-016 | Select S3-compatible object store | `HANDOFF.md:23-27`; Store design `§10.4.1` | C-005 | Cairn Store | Later | [#16](https://github.com/ehussong/cairn/issues/16) | `PVTI_lAHOAF9BvM4BfAWjzg00GyM` | VERIFIED |
| C-017 | Select embeddings and verify external claims | `HANDOFF.md:23-33`; Store design `§10.1` | C-005 | Cairn Store | Later | [#17](https://github.com/ehussong/cairn/issues/17) | `PVTI_lAHOAF9BvM4BfAWjzg00Gy4` | VERIFIED |
| C-018 | Store Phase 0 foundations | `HANDOFF.md:35-39`; Store design Phase 0 | C-005 | Cairn Store | Later | [#18](https://github.com/ehussong/cairn/issues/18) | `PVTI_lAHOAF9BvM4BfAWjzg00Gz0` | VERIFIED |
| C-019 | Store Phase 1 fsdir and operational spine | `HANDOFF.md:35-39`; Store design Phase 1 | C-005 | Cairn Store | Later | [#19](https://github.com/ehussong/cairn/issues/19) | `PVTI_lAHOAF9BvM4BfAWjzg00G00` | VERIFIED |
| C-020 | Store Phase 2 Readwise ingestion | Store design Phase 2 | C-005 | Cairn Store | Later | [#20](https://github.com/ehussong/cairn/issues/20) | `PVTI_lAHOAF9BvM4BfAWjzg00G1Y` | VERIFIED |
| C-021 | Store Phase 3 IMAP ingestion | Store design Phase 3 | C-005 | Cairn Store | Later | [#21](https://github.com/ehussong/cairn/issues/21) | `PVTI_lAHOAF9BvM4BfAWjzg00G18` | VERIFIED |
| C-022 | Store Phase 4 hardening | Store design Phase 4 | C-005 | Cairn Store | Later | [#22](https://github.com/ehussong/cairn/issues/22) | `PVTI_lAHOAF9BvM4BfAWjzg00G2s` | VERIFIED |
| C-023 | Store Phase 5 deferred tracks | Store design Phase 5 | C-005 | Cairn Store | Later | [#23](https://github.com/ehussong/cairn/issues/23) | `PVTI_lAHOAF9BvM4BfAWjzg00G28` | VERIFIED |

## Taxonomy and dependencies

- Root epic C-001 owns delivery epics C-002 through C-005 through native GitHub sub-issue links.
- Each concrete issue is a native sub-issue of its delivery epic.
- Native `blocked by` relationships encode the sequence: reliable retrieval → connectors/write contract → Store go/no-go → Store policy decisions → Store Phases 0–5.
- Milestones represent release targets. Project `Status` is `Todo` for every migrated item. No dates were present in the source evidence, so none were invented.

## Source disposition

| Source | Result | Reason |
|---|---|---|
| `HANDOFF.md` | Archived as `docs/archive/HANDOFF-2026-07-05.md` | Contains durable historical and architectural context in addition to migrated work items. |
| `docs/plans/2026-07-01-cairn-design.md` | Archived as `docs/archive/2026-07-01-cairn-store-design.md` | Contains substantial design prose and accepted invariants; Store delivery is now gated and tracked in issues. |
| `README.md` | Retained and linked to the Project | Operational documentation, not a backlog. |
| Cairn chat history | Referenced by manifest and issues | Current decisions were reconciled against later turns; no repository file existed to delete or archive. |

## Open questions

- The human owner must accept or replace every proposed priority; migration proposals are not approvals.
- No target dates were discoverable. Add dates only when the owner or delivery evidence establishes them.
- C-001 is the one structural exception to “every issue has a parent epic”: a finite hierarchy requires one root.
- The repository was empty, so the pre-migration source state was published as the initial `main` commit before this migration branch could be opened as a PR.

## Verification result

**23/23 VERIFIED; 0 FAILED.** No duplicate or stale issues existed, so none were closed. Phase 5 proceeded only after this result.

## Sequencing cleanup addendum — 2026-07-31

- Literal escape audit: zero issue bodies contained a literal `\\n`; no body edits were required.
- Deleted redundant milestones: Roadmap governance; Router v0.2 — Reliable retrieval; Router v0.3 — Connected sources; Router v0.4 — Safe writes; Cairn Store — Gated future.
- Release milestones were not replaced; defining them is a human decision.
- Project scheduling uses `Priority`, `Start date`, and `Target date`. The earlier `Priority (proposed)` migration field was retired after values were written and verified.
- The proposed dependency-respecting schedule and provisional availability assumptions are generated into `roadmap.md`.
