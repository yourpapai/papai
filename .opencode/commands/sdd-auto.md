---
description: Run the autonomous SDD pipeline on a task file
---

Run the autonomous spec-driven development pipeline:

```
bun run sdd-runner:start -- $ARGUMENTS
```

Pass a task file path and optional flags: `--depth S|M|L` (skip scope estimation), `--wait` (block on stdin instead of exiting at the gate), `--verbosity brief|normal|debug`.
