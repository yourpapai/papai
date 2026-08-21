## Why

`sdd-runner-simplify` shipped every Ink TUI component behind passing tests, but never wired the running screen into the live CLI path: `buildHarness` unconditionally subscribes the append-only `LineRenderer` to the event bus, so an interactive terminal still scrolls raw lines (`[intake] entered`, `estimator spawned …`) and the TUI only ever appears at a gate resume. The merged PR's own spec scenario — "Interactive terminal renders the TUI … no scrolling line output is produced" — is unobservable on a real run.

## What Changes

- Add a run-screen session that mounts the existing `createRunView` Ink component when `renderModeFor` selects `tui`: bus events fold through `foldRunView`, keys route through `reduceStopKey` to the calm-stop seam (`q` / first Ctrl-C stop, second exits 130), clean unmount at run end.
- Suppress the `LineRenderer` bus subscription in TUI mode only; pipes/CI/log output stays byte-identical, and `events.ndjson` appending is unaffected.
- Mount the same screen on the routing verbs that continue a run (`sdd <run-id>` resume/continue), rebuilding initial state from `events.ndjson` via the existing `restoreRunFold`.
- Remove the leftover legacy package scripts (`sdd-runner:resume|gate|report`) that now invoke removed subcommands and fail loudly.
- Replace operator-facing hints that name the removed verb (`Next: sdd-runner gate resume <id>`) with the current routing form (`sdd <run-id>`).

## Capabilities

### New Capabilities

None — everything here extends capabilities the pending `sdd-runner-simplify` change already declares.

### Modified Capabilities

- `sdd-runner-tui`: make the mode-selection and running-screen requirements bind to the live run path (start/resume/continue), add line-renderer exclusivity in TUI mode, and pin replay-restore on re-attach. Without this the capability's headline scenario cannot be observed on any run — the components exist but nothing mounts them.
- `sdd-runner-cli`: operator guidance printed by the runner must name the current routing surface. Without this, a run halting at its gate tells the operator to run a subcommand that errors by design.

Both deltas modify requirements **introduced by the unarchived `sdd-runner-simplify` change** (its `specs/sdd-runner-tui/` and `specs/sdd-runner-cli/`); that change must archive first, then these apply against the resulting main specs.

## Impact

- Code: `sdd-runner/src/index.ts` (harness/bus wiring), new run-screen session module beside `tui-gate-session.ts`, `package.json` scripts, two stale hint strings. No changes to review-loop internals, gate-session mechanics, or event grammar.
- Docs: `docs/architecture/sdd-pipeline.md` live-rendering section already describes the intended behavior; corrected only if wording diverges after wiring.
- Dependencies: none added — `ink`/`react` are already deps.
- Scope-model impact: none — local developer tooling outside the papai runtime; no platform/task instances, no persisted papai state.
