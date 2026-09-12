# Design — sdd-runner-tui-wiring

## Context

See proposal.md — Why. The component layer exists and is tested: `createRunView` + `foldRunView` (`run-view.ts`), replay restore (`tui-restore.ts`), key reducer (`reduceStopKey`, `tui-signals.ts`), mode selection (`renderModeFor`). The gate session (`tui-gate-session.ts`) demonstrates the production Ink mount pattern (`exitOnCtrlC: false`, scripted-key seam for tests). What does not exist anywhere is a caller that mounts the running screen: `buildHarness` (`index.ts`) unconditionally hands a `LineRenderer` to `buildBus` as `deps.render`, so every route scrolls lines regardless of terminal. No existing module covers "live run-screen session"; one small module is needed.

Constraints carried over from `sdd-runner-simplify`: `events.ndjson` is replay-sufficient; the non-TTY line byte contract is frozen; the TUI holds no decision-relevant state (disposable view).

## Goals / Non-Goals

**Goals:**

- One run-screen session module that mounts the existing view over the bus, wired to the calm-stop seam, usable from every route that drives stages.
- Mode-dependent bus wiring decided once, with line/TUI exclusivity pinned by test.
- Cutover leftovers cleaned: dead legacy scripts, removed-verb hints.

**Non-Goals:**

- Any change to the gate screen's own mechanics (decision logic, settle race, TextInput) — it works.
- Deadline countdown on the *running* screen (the gate screen owns deadline display).
- Mid-run steering keys, new visual regions, layout changes beyond what `createRunView` already renders.
- Review-loop internals, event grammar, sidecar formats.

## Decisions

### D1 — One `tui-run-session` module mirroring the gate session's shape

New `sdd-runner/src/tui-run-session.ts`: constructor takes the fold bag (optionally pre-built by `restoreRunFold`), the run dir (for the stop marker), and an optional key script (test seam, same pattern as `gateKeyScript`); it mounts Ink with `exitOnCtrlC: false`, exposes `onEvent(event)` (fold + rerender) as a bus subscriber, and returns/unmounts cleanly. Alternatives: folding this into `orchestrator.ts` (rejected — orchestrator already near max-lines; the session is a distinct concern) or into `run-view.ts` (rejected — that file is the pure component layer the tests treat as such).

### D2 — Mode decided once in `buildHarness`; bus wiring follows it

`buildHarness` computes `renderModeFor(process.stdout, process.stdin, process.env)`:

- `line` / `line-debug`: exactly today's wiring (`deps.render` = LineRenderer). Byte contract untouched.
- `tui`: `deps.render` stays undefined (no line subscription — exclusivity), and the harness gains a `mountRunScreen(runDir, logPath)` dep that verbs call when they begin driving stages. The session self-subscribes to the verb's bus; on attach it seeds state via `restoreRunFold(logPath)` so re-entered runs open at current state.

Routes: `runStart`, `runResume`, `runContinue`, and the post-decision tail of `runGateResume` all mount it. Sequencing rule: the gate session unmounts before the run screen mounts — never two Ink instances in one process at once.

### D3 — Stop keys ride the existing marker seam

`reduceStopKey`'s `calm-stop` writes the same `stop-requested` marker `sdd stop` uses (`requestCalmStop(runDir)`); `exit-130` exits 130 immediately. No new signal plumbing — the boundary seam already honors the marker in-process and cross-process.

### D4 — Cutover leftovers fixed inline

Delete `sdd-runner:resume|gate|report` scripts (they invoke removed subcommands and can only error). Replace the two removed-verb hints (`gate-digest.ts` "Next: sdd-runner gate resume …", `orchestrator.ts` gate-pending notice) with the `sdd <run-id>` routing form. `sdd-runner:start` keeps its name (pass-through already matches the routing surface).

## Risks / Trade-offs

- [Sustained Ink rendering under Bun across a whole run] → the walking skeleton proves a full fixture sequence in-process; the gate session has rendered live since the cutover; the line path remains the instant fallback by reverting one mode decision.
- [TUI crashes mid-run] → files are the only truth (disposable view): the run continues, artifacts and `events.ndjson` stay consistent, and re-running the routing verb rebuilds the screen from the log. A session failure degrades to silent running, never to lost state.
- [Both renderers active after a wiring mistake] → exclusivity is a pinned test: in TUI mode the bus has exactly one render subscriber and no byte reaches stdout outside Ink frames.
- [Scripted-key seam divergence from the gate session] → reuse the same option name and feed mechanism so test tooling stays uniform.

## Migration Plan

One branch, ordered test-first: (1) mode/exclusivity tests + harness wiring, (2) run-screen session behind tests, (3) verb mounts incl. gate-resume tail, (4) hint/script cleanup, (5) docs check. Rollback is a single revert — the line path is never deleted.

## Hook / TDD interactions

The Write/Edit TDD hook gates `sdd-runner/src/**` against `tests/sdd-runner/**`: the new `tui-run-session.ts` lands only after `tests/sdd-runner/tui-run-session.test.ts` fails first; harness/verb edits extend `cli-routing`/orchestrator suites; hint-string changes pin through existing orchestrator/output tests updated first. Final task runs the full gate (`bun test`, typecheck, lint, format, security where touched).

## Scope model impact

None — local developer tooling outside the papai runtime: no platform/task instances, no storage/config-context ids, no DB rows. All state remains files under `<workDir>/runs/<id>/`.
