# Proposal: sdd-create-prompt-stdin-fix

## Why

The live-terminal path of inline session start is broken: after picking `(n)`
on the Ink session screen, the readline title prompt resolves immediately as
empty/EOF and the process exits — the operator cannot type anything (incident
2026-08-23: "Session title:" printed, app quit, no input accepted). Hermetic
tests inject streams and script keys, so the Ink-unmount→readline handoff over
one real stdin has zero coverage; the shipped requirement is unexercisable on
a terminal.

## What Changes

- Fix the stdin handoff when the session screen unmounts and the creation
  prompt opens: stdin is restored to a state readline can serve (raw-mode
  restoration and pause/resume ordering across Ink's unmount) before the
  first question is issued.
- Add a seam-level regression test that drives one shared stream through
  Ink-mount → key → unmount → readline prompt, asserting typed input is
  received and empty input abandons without exit-by-surprise.
- No user-visible behavior changes beyond the prompt becoming usable; empty
  title still abandons creation exactly as specced.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdd-runner-cli`: the "Inline session start without a task file"
  requirement (delta added by `sdd-runner-session-picker`, not yet archived)
  gains a scenario pinning live-terminal usability — the prompt SHALL accept
  typed input when opened from the session screen. Without this delta the
  requirement holds only under injected streams; on the only surface it
  exists for (a terminal) it cannot be satisfied.

No platform instances, task instances, or config-context scopes are affected;
all state is runner-local under `.sdd-runner/`.

## Impact

- Code: `sdd-runner/src/tui-session-picker.ts` (unmount path),
  `sdd-runner/src/session-create.ts`, `sdd-runner/src/index.ts`
  (harness seam).
- Specs: delta on `sdd-runner-cli` stacking above the pending
  `sdd-runner-session-picker` delta. Docs:
  `docs/architecture/sdd-pipeline.md` (runner commands section) needs no
  change — the documented behavior is what this restores.
- Tests: `tests/sdd-runner/session-create.test.ts`,
  `tests/sdd-runner/tui-session-picker.test.ts` plus a new seam test.

## Non-goals

- Returning to the session screen after abandon/start (loops, Esc-cancel,
  in-TUI creation form) — owned by `sdd-runner-session-manager`; this fix is
  a stopgap whose seam code that change will replace, accepted deliberately.
- Any non-TTY behavior change; non-terminal invocations keep today's
  list-and-exit contract byte-for-byte.
- Touching the gate TUI or run screen stdin handling — they never hand off to
  readline and are unaffected.
