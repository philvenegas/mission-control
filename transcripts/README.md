# Transcripts

The unedited AI transcripts of the design and the build, a first-class part of the submission alongside `DESIGN.md` and the code.

- `claude-code/`: every Claude Code session run in this repository, as Claude Code saved it. Each `<session>.jsonl` is one conversation, one JSON event per line: the prompts, the replies, every tool call and its result. A session's sub-agents, such as the two reviewers each code review runs, are in `<session>/subagents/`, and tool output too long to keep inline is in `<session>/tool-results/`.

The design was discussed and settled on the planning map, GitHub issue 1 and its closed sub-issues, before the build began; the sessions show it being written and each build step being implemented and reviewed against it.

The sessions are copied whole, nothing removed, from Claude Code's project folder once the last one has ended:

```sh
rsync -a --exclude memory ~/.claude/projects/-Users-fvenegas-code-mutinex-code-mission-control/ transcripts/claude-code/
```

`memory` holds the notes Claude Code keeps between sessions, not conversations, so it is left out.
