# sdd-runner-fancy-ui Proposal

## Why

The sdd-runner Ink TUI is functionally complete but presentationally bare: all three screens (running, gate, session) render monochrome plain text — `## Agents`-style headers, one `q to stop` affordance — severity and cost markers carry no color, key bindings are scattered across `docs/architecture/sdd-pipeline.md` and one-off inline affordances with no complete per-screen surface, and the whole view re-renders every frame, so long review loops redraw full finding history at each event. Attention concentrates at the gate; the screen must be readable at a glance.

## What Changes

- Shared presentation layer for the Ink screens — semantic color tokens (severity, stage status, cost tristate, retry badges), framed and column-aligned panels — applied uniformly to the running screen (`run-view.ts`), the gate screen (`tui-gate.ts`), and the session screens (`tui-session-*`).
- Persistent key-hints footer on every screen plus a `?` help overlay listing that screen's keys; existing bindings and their semantics are unchanged.
- Width-aware, resize-safe layout: panels reflow joined → stacked on resize; wide-char alignment preserved.
- Ink render split: append-only history (burndown, findings, done rows) in a `Static` region; live slots/status stay dynamic.
- `NO_COLOR` / `TERM=dumb` degrade to today's monochrome; the non-TTY LineRenderer byte stream is untouched.

## Capabilities

### New Capabilities

- `sdd-runner-tui-presentation`: the presentation contract shared by all sdd-runner Ink screens — severity/status color semantics, panel layout with resize reflow, key-hints footer + help overlay, Static/dynamic render split, and the invariant that presentation never alters decision semantics, key semantics, or the frozen non-TTY byte contract. Without it the TUI stays monochrome and key-undiscoverable, and severity/state must be parsed character-by-character at the exact moment attention concentrates. Separate from the unarchived `sdd-runner-tui` capability (declared by `sdd-runner-simplify`, modified by `sdd-runner-tui-wiring`): that capability owns screen semantics and is not yet a main spec — a third stacked delta would serialize three changes in the archive queue — and presentation equally spans the session screens spec'd under `sdd-runner-cli` deltas. `sdd-runner-output`'s dynamic-renderer content requirements (slot/status/stage details) stay behaviorally true — not modified; its frozen non-TTY contract binds this change.

### Modified Capabilities

- _None._

## Impact

- **Code:** `sdd-runner/src/` TUI modules (`run-view.ts`, `tui-gate.ts`, `tui-gate-session.ts`, `tui-session-*.ts`, `tui-ack-screen.ts`, `tui-run-session.ts`, `watch-view.ts`) plus five new presentation modules (`tui-tokens`, `tui-panels`, `tui-chrome`, `tui-width`, `tui-history`). No pipeline, gate-semantics, replay, or event-grammar changes.
- **Dependencies:** `string-width` and `cli-truncate` become direct `sdd-runner` deps for display-width alignment (already locked transitively through `ink`, so the lockfile is unchanged); `ink`/`react` are already deps.
- **Docs:** `docs/architecture/sdd-pipeline.md` Live rendering / Gate decisions / `## Commands` (session-screen paragraphs) describe today's plain rendering and must track the presentation layer.
- **Instances/scope:** no platform or task instances; no per-user, group-shared, or thread-isolated config-context impact — sdd-runner is local developer tooling outside the papai runtime.
- **Tests:** sdd-runner TUI suites extended (footer/help, reflow, color degradation, Static split).

## Non-goals

- No new decision verbs, gate-file grammar changes, or key rebinding — presentation only.
- Non-TTY output (`renderer.ts`), `events.ndjson` grammar, replay/fold semantics unchanged.
- No mouse support, theme configuration, or screenshot/export surfaces — anticipated needs, declined.
- No papai runtime (`src/`, `client/`) changes; `review-loop`/`mutation-improve` TUIs (non-Ink, shared block engine) untouched.
