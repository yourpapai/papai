## Why

The session screen's `(s)top` key and `sdd stop <id>` only write a `stop-requested`
marker that a **live** run process consumes at its next boundary. When the run's
process already died (crash, killed terminal, reboot), nothing ever consumes the
marker: the run stays `status: running` forever, shows as `▶` active in the
session screen, and hijacks every bare `sdd` invocation into an unsupported
resume ("resume from stage 'intake' (depth not classified) is not supported
yet"). Today the only recovery is hand-editing or deleting `.sdd-runner/runs/<id>/state.json`.

## What Changes

- Runs record process ownership: the orchestrator writes a holder file
  (`holder.json`, pid + start time) into the run dir while a process is driving
  the run, and removes it on clean exit.
- Stop becomes liveness-aware — one seam shared by the session screen `s` key
  and the `sdd stop [<id>]` verb:
  - live process → today's calm-stop marker (honored at the next boundary, unchanged);
  - dead process (no holder, or holder pid not alive) → the run settles
    **immediately**: a stale `stop-requested` marker is consumed and state moves
    to the honest terminal/interrupted state.
- Honest per-stage settle for dead runs: a run that died before intake
  classification (`stage: intake`, `depth: null` — no artifacts exist) settles
    to `aborted`; a run that died mid-pipeline settles to `stopped`
    (resumable, matching live calm-stop semantics).
- Settle feedback names the outcome and the next step (`resumable` vs
  `nothing to resume — start fresh with a task file`).

No chat-platform, task-instance, or config-context surface is touched; all state
is runner-local under `.sdd-runner/runs/<id>/`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdd-runner-cli`: the stop verb and the session screen's stop key gain
  liveness-aware semantics — dead runs settle immediately instead of writing a
  marker nobody consumes, with per-stage settle states and concrete next-step
  output. Without this, stopping a dead run from the menu or CLI is a no-op and
  the zombie run keeps capturing routing.

## Impact

- Code: `sdd-runner/src/stop-controller.ts` (holder + liveness seam),
  `orchestrator.ts` (holder write/remove lifecycle), `index.ts` (harness stop
  wiring), `tui-session-screen.ts` footer wording if needed, `session-flow.ts`
  unchanged (already routes `stop`).
- Specs: delta to `openspec/specs/sdd-runner-cli/spec.md`.
- Docs: `docs/architecture/sdd-pipeline.md` runner-commands section (stop
  semantics paragraph).
- Existing zombie runs (no holder file) are treated as dead by definition —
  the first stop settles them; this is the migration path, no backfill needed.

## Non-goals

- Making `resume` support intake-stage runs (re-running intake on resume) —
  declined: intake husks have no artifacts; settling them `aborted` removes the
  crash path instead.
- Heartbeat/timeout-based liveness, cross-host or container-namespace pid
  validation — declined: single-host local tool; pid check on the holder file is
  sufficient.
- Stopping runs from another machine or via signals (SIGTERM handling).
- New event-log entries for the settle (state.json is the source of truth for
  routing; the report does not read stop state).
- Deleting or archiving run dirs on settle.
