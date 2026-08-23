# Design: sdd-runner-session-manager

## Context

See proposal.md — Why. Current surfaces: the picker (reducer
`reduceSessionScreen` + Ink driver `runSessionPicker`) resolves one decision
and exits; creation (`runSessionCreate`) is a readline prompt over the same
stdin the Ink app just released — the seam `sdd-create-prompt-stdin-fix`
stopgaps. The gate screen already demonstrates the in-TUI text-input pattern
(`gate-session-state.ts` input reducer). Non-TTY output is byte-frozen by
`sdd-runner-output`.

## Goals / Non-Goals

Goals: one long-lived interactive surface owning the whole TTY session; every
action funnels back to a refreshed list; creation is a form inside that
surface; failures are notices, not exits.

Non-Goals (design-level): new dependencies; changing row derivation
(`session-list.ts` projection stays as-is); report pagination or scrolling;
touching gate/run-screen internals beyond mount/unmount sequencing.

## Decisions

- **Reuse the reducer + Ink + KeyFeed pattern; extract a form reducer.**
  Creation form state (field focus, text buffers, validation notice) is a
  pure reducer in its own module (generalizing the gate input reducer's
  char/backspace/escape handling), scripted-key testable exactly like
  `reduceSessionScreen`. Alternative rejected: `ink-text-input` dependency —
  the repo's rule is to justify new deps, and the needed subset already
  exists as a proven pattern.
- **Loop lives in the picker driver, not in `cli.ts`.** `runSessionPicker`
  becomes: re-read rows → render → settle decision → execute through
  `executeSessionTarget` (unchanged) or the creation starter → loop. `main`
  calls it once; exit is a picker outcome. Actions keep mounting their own
  surfaces (gate session, run screen) exactly as today — the manager shell
  remounts after each completes. Alternative rejected: a single persistent
  Ink app hosting all screens — gate/run screens already own their
  mount/unmount lifecycle and stdin discipline; absorbing them is a larger,
  riskier rework with no behavioral payoff.
- **Report display inside the shell.** A completed run's report renders as a
  static block followed by "any key returns to the session screen". No
  pager, no truncation — terminals scroll. Alternative rejected: printing
  the report to stdout between unmount/remount — reintroduces the
  unmount-then-write seam class this change exists to remove.
- **Creation form replaces the readline path entirely on TTY.**
  `runSessionCreate`'s readline implementation is deleted (its non-TTY use
  does not exist: bare non-TTY never creates). The stdin-fix seam from
  `sdd-create-prompt-stdin-fix` is deleted with it; that change remains
  valuable only as the stopgap until this lands.
- **Error funneling.** Action execution wraps in try/catch at the loop
  boundary; failures render as a notice line in the shell with any-key
  return. The orchestrator's error messages are already
  `Error.message`-shaped per repo convention.
- **Module shape.** The screen reducer gains a screen-switch dimension
  (`list ⇄ create`), and the form reducer is a separate file — keeps both
  under the `max-lines` design signal rather than compressing
  `tui-session-screen.ts`.

## Risks / Trade-offs

- [Mount/unmount churn across loop iterations leaks terminal state] → each
  iteration re-uses the existing mount/unmount discipline the gate flow
  already exercises; the loop adds no new stdin mechanics (form is Ink-only).
- [Long reports push the list far up the scrollback] → accepted; a pager is
  a Non-goal. Revisit only if it hurts in practice.
- [Stale rows during a long action] → rows are re-read at every loop
  boundary; no live updates promised (Non-goal), so staleness is bounded by
  one action.
- [Mutation gate on branchy reducers] → both reducers get scenario-per-branch
  scripted tests from the start (the established suite shape for
  `tui-session-screen`).
- [Interplay with `sdd-runner-decomposition` tree rows] → row rendering is
  untouched; when decomposition lands its tree projection, the shell does not
  need rework — only `session-list.ts` and the row component change.

## Migration Plan

Single PR after `sdd-create-prompt-stdin-fix`. No persisted-state or config
migration; the readline create path and stdin-fix seam are removed in the same
PR. Rollback is revert.

## Open Questions

- Exact footer copy for the create form (labels, key hints) — settle during
  implementation; no spec impact.
