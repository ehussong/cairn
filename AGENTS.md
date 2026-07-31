# Work tracking

- All work items are GitHub issues, and no work item exists off the [Cairn Roadmap](https://github.com/users/ehussong/projects/6).
- Every new non-root issue gets a parent epic when it is created and is added to the Project immediately. Assign a milestone only when the human owner has created or selected a release milestone. The single roadmap root epic is the structural exception because it has no possible parent.
- Status changes happen through Project fields, never through prose in repository documents.
- `roadmap.md` is generated from the Project board and must never be hand-grown into a parallel backlog.
- Agents propose Priority and ordering for new items and during an explicit replan; they never silently reshuffle values or positions the human has adjusted, and treat every proposal as subordinate to the human's edits on the board.
- **REPLAN:** when the human says “replan,” rebuild the ordered open-leaf list from current Project truth using blocked-by dependencies as hard constraints and epic progression plus judgment within that constraint; leave In Progress items and anything labeled `pinned` untouched; never move items the human has manually reordered above or below the proposed position without flagging it; apply item positions and Priority buckets; regenerate the Now / Next / Later section in `roadmap.md`; and report exactly what moved and why.
