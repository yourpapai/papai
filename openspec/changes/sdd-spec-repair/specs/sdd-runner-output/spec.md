## REMOVED Requirements

### Requirement: Quiet verbosity

**Reason:** `--verbosity` was removed with the decision flags and now fails with an error naming its replacement; no per-invocation verbosity surface exists.

**Migration:** Line-renderer altitude is the remaining control: `SDD_DEBUG=1` raises the append-only line renderer to L0 detail and never forces the TUI; the TTY check stays hard-gated so redirected output never gains ANSI escapes.

### Requirement: Watch verb

**Reason:** The `watch` subcommand was removed with the subcommand cutover and fails with an error naming its replacement.

**Migration:** Live visibility is the TUI running screen and the session screen: re-entering a run through the routing verb re-folds `events.ndjson` and re-attaches at current state — the read-only attach behavior watch provided. The fold machinery (`foldSlots`/`foldFindings`) lives on inside the TUI render layer.
