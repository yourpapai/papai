# Proposal: sdd-runner-session-manager

## Why

The session screen (shipped by `sdd-runner-session-picker`) is a one-shot
menu: after any action the process exits, creation drops out of the TUI into
a bare readline prompt (the seam that broke in the 2026-08-23 incident), and
an abandoned creation exits the whole program. Operating several sessions
means re-invoking `sdd` between every action. Comfortable multi-session
operation needs the screen to be the home surface, not a launcher.

## What Changes

- The session screen becomes a **loop**: after every completed action (gate
  settled, run ended, report shown, stop confirmed, creation finished or
  cancelled) it re-presents the refreshed run list; only an explicit quit
  exits. Action failures surface as a notice and return to the list instead
  of killing the process.
- **Creation moves inside the screen**: an interactive form (title, optional
  description) replaces the readline prompt; submitting starts the run as
  today (typed text persisted as the task record); cancelling returns to the
  list; an empty title is inline validation, never an exit. The readline
  creation path and the handoff seam repaired by `sdd-create-prompt-stdin-fix`
  are deleted here — that change is deliberately superseded.
- Non-terminal invocations keep today's list-and-exit contract byte-for-byte.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdd-runner-cli` (delta stacks above the unarchived
  `sdd-runner-session-picker` delta):
  - *Interactive session screen*: gains loop-back semantics — actions return
    to a refreshed list, quitting is explicit, errors don't exit. Without it,
    every action is a process death and multi-session work stays
    invoke-per-verb.
  - *Inline session start*: the entry becomes an in-screen form with cancel
    and empty-title validation. Without it, creation keeps the
    detached-prompt seam and its quit-on-abandon behavior.

No platform instances, task instances, or config-context scopes are affected;
all state stays runner-local under `.sdd-runner/`.

## Impact

- Code: `sdd-runner/src/tui-session-screen.ts` (screen-switch + form state;
  form reducer extracted to its own module), `tui-session-picker.ts` (loop
  driver), `session-create.ts` (retired from the TTY path), `cli.ts`
  (`runInteractive` loop), `index.ts` (harness seam).
- Specs: `openspec/specs/sdd-runner-cli/spec.md` via delta. Docs:
  `docs/architecture/sdd-pipeline.md` (runner commands, session screen
  section). Tests: `tests/sdd-runner/tui-session-*.test.ts`,
  `session-flow.test.ts`.

## Non-goals

- Live-updating rows while a run progresses, scrollable report panes, session
  detail views — declined; the loop returns to a freshly-read list instead.
- Row deletion — owned by `sdd-runner-session-removal` (follow-up).
- Parent/child tree rows for composite runs — owned by
  `sdd-runner-decomposition`; this change reshapes the shell, not row
  semantics.
- New TUI dependencies (e.g. `ink-text-input`) — the gate screen's
  text-input reducer generalizes; declined.
- ANSI-primitives consolidation — owned by `shared-tui-renderer`.
