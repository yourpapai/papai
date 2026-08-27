---
description: Run the autonomous SDD pipeline on a task file
---

Run the autonomous spec-driven development pipeline:

```
bun run sdd-runner:start -- $ARGUMENTS
```

Pass a task file path to start a run, or a run id (exact or an unambiguous prefix) to route by that run's state — a pending gate opens its decision flow, an interrupted run resumes, a completed run prints its report. With no argument on a terminal, the session screen opens.

Flags: `--depth S|M|L` (skip scope estimation and force the profile — note this also skips the oversize verdict, so the run will not be decomposed into child runs), `--config <path>` (override the config file; `SDD_RUNNER_CONFIG` is used when absent), `--pr` (PR-flavored report for a completed run), `--reopen [<n>]` (re-present a settled auto-decided gate; latest when `n` is omitted).

`bun run sdd-runner:start -- stop [<run-id>]` requests a calm stop, honored at the next stage or round boundary.

After `bun link` inside `sdd-runner/`, the same surface is available as `sdd <target>` — the form the runner prints in its own next-step hints.
