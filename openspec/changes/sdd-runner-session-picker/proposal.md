# Proposal: sdd-runner-session-picker

## Why

Operating concurrent sdd-runner sessions requires copy-pasting opaque datetime
run ids and knowing hidden verbs (`stop`, `--reopen`, prefix rules). Recovering
one aborted run took a three-command incantation (incident 2026-08-22: stray
intake run, aborted gate, reopen). The readable identity (`changeName`) already
exists; the command surface just speaks the storage key instead.

## What Changes

- Bare `sdd` on a terminal opens an **interactive session screen** listing every
  run — name, stage/round progress, token/cost totals, last activity, pending
  decision — where selecting a row routes by the existing state logic
  (gate-pending → gate screen, stopped/interrupted → resume, completed →
  report). Non-TTY invocations keep today's loud list-and-exit behavior.
- Row actions expose recovery verbs contextually instead of flags-on-id:
  reopen a settled or abort-settled gate, calm-stop an active run.
- **Inline session start**: a "new session" entry accepts a task title and
  description; the pipeline starts from that text with no task `.md` file. The
  description persists inside the run dir (`task.md`) for provenance. The first
  line names the session via the existing heading-derived change name.
- **Task-name session ids**: newly created runs use the slugified task name as
  their id/run-dir (`runs/<slug>/`), collision-suffixed (`-2`) while a
  non-terminal twin exists; datetime-named legacy dirs remain resolvable by
  prefix.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdd-runner-cli`: this capability already owns routing, run-id ergonomics,
  and pending-run discovery ("bare gate command lists pending runs … as an
  interactive picker on a terminal"); these changes extend it rather than
  create a parallel one. Requirement-level deltas:
  - *No-target routing*: on a terminal, ambiguity becomes selection instead of
    exit-with-candidate-list; zero runs goes straight to inline creation.
  - *Run-id ergonomics*: new sessions are addressable by task-name id;
    datetime ids remain valid for pre-existing runs.
  - *Session creation*: starting requires no task file — typed text is the
    source, persisted in the run dir.

Without these, multi-session operation stays script-shaped (humans must
memorize ids and verbs), aborted/reopened runs remain undiscoverable, and
starting work demands managing repo files the runner never needed.

No platform instances, task instances, or config-context scopes are affected:
all state stays runner-local under `.sdd-runner/` and is keyed by run id, not
by user/group/thread context.

## Impact

- `sdd-runner/src/cli-routing.ts`, `index.ts` (picker front-end over
  `resolveTarget`), `orchestrator.ts` (`runStart` accepts text), `run-state.ts`
  (id generation, listing), new session-screen Ink component alongside
  `tui-gate-session.ts`.
- Specs modified: `openspec/specs/sdd-runner-cli/spec.md`. Docs affected:
  `docs/architecture/sdd-pipeline.md` (routing verb, runner commands sections).

## Non-goals

- Renaming existing sessions or OpenSpec change dirs post-creation (identity is
  immutable; declined).
- Deleting/pruning sessions, favorites/pinning, fuzzy filtering — not needed to
  make selection usable; declined.
- Liveness detection (PID/heartbeat) for zombie rows — rows render persisted
  status only; attach follows whatever claim discipline exists at
  implementation time; declined until proven necessary.
- Batch/multi-select operations; chat-side session management surfaces —
  declined (anticipated needs).
