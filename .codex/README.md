# Codex/ChatGPT repository conventions

Codex/ChatGPT is Cairn's assumed development agent. The root
[`AGENTS.md`](../AGENTS.md) file is the authoritative instruction entry point.
Do not create parallel `CLAUDE.md` or `.claude/` instruction trees.

## Continuation notes

When a durable implementation handoff is genuinely useful, write it under
[`.codex/handoffs/`](./handoffs/) as `YYYY-MM-DD-topic.md`. A handoff may record
verified implementation context, exact reproduction commands, and links to the
canonical GitHub issues. It must not contain an independent backlog, priority,
or status system; those remain on the
[Cairn Roadmap](https://github.com/users/ehussong/projects/6).

Historical Codex handoffs from before work tracking moved to GitHub are
preserved under
[`docs/archive/codex-handoffs/`](../docs/archive/codex-handoffs/).
