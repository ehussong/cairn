# Work tracking

- All work items are GitHub issues, and no work item exists off the [Cairn Roadmap](https://github.com/users/ehussong/projects/6).
- Every new non-root issue gets a parent epic when it is created and is added to the Project immediately. Assign a milestone only when the human owner has created or selected a release milestone. The single roadmap root epic is the structural exception because it has no possible parent.
- Status changes happen through Project fields, never through prose in repository documents.
- `roadmap.md` is generated from the Project board and must never be hand-grown into a parallel backlog.
- Agents propose Priority and dates for new items and during an explicit replan; they never reshuffle values the human has adjusted, and treat everything as proposals the human overrides by editing the board.
- **REPLAN:** when the human says “replan,” re-read Planning assumptions in `roadmap.md`; rebuild the sequence from current Project truth using blocked-by dependencies as hard constraints, inferred epic order, cadence, availability, and WIP limit; leave In Progress items and anything labeled `pinned` untouched; apply updated Priority and dates; regenerate the Now / Next / Later section; and report exactly what moved and why.
