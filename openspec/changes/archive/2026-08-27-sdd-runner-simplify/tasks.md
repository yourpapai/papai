# Tasks — sdd-runner-simplify

Ordered per design.md Migration Plan: every step is shippable alone, steps 1–2 are additive, step 3 coexists with old verbs, step 4 is the breaking cutover. TDD: each task writes its failing test in `tests/sdd-runner/` (or `tests/review-loop/` for the shared seam) first.

## 1. Session capture (additive)

- [x] 1.1 Failing tests for the session-ledger schema and appender: one `sessions.jsonl` line per spawn attempt (`label`, `role`, `round`, `attempt`, `model`, `opencodeSessionId`, `status`), id written the moment a session-bearing line arrives, `done`/`killed` status transitions. Verify: `bun test tests/sdd-runner/session-ledger.test.ts`
- [x] 1.2 Implement the ledger appender and lift `sessionID` from the event stream in the shared line handler (`review-loop/src/line-handler.ts` + `agent-runner.ts` seam — the handler already parses every line; add the field accessor and a ledger-append callback). Verify: `bun test tests/review-loop/ tests/sdd-runner/session-ledger.test.ts`
- [x] 1.3 Failing tests + implementation for transcript relocation: per-attempt raw streams land at `runs/<id>/transcripts/<label>-r<round>-a<attempt>.jsonl`, correlating with the ledger key; old `logs/` destination gone. Verify: `bun test tests/sdd-runner/transcripts.test.ts`
- [x] 1.4 Update `config.example.json` with a transcript/session-ledger comment pointer. Verify: `bun run sdd-runner:format:check`

## 2. Session resume behind existing verbs (additive)

- [x] 2.1 Failing tests for the resume decision table: artifact-complete → skip agent; in-flight session recorded → continuation path; no session (pre-change run) or continuation failure → stage-boundary rebuild; each path reports which was taken. Verify: `bun test tests/sdd-runner/resume-decision.test.ts`
- [x] 2.2 Implement: `deriveResumePoint` consults the session ledger; the agent seam gains the `--session <id>` continuation spawn with fallback to prompt-rebuild on any continuation failure; resume path recorded into `events.ndjson` (L2). Verify: `bun test tests/sdd-runner/resume-decision.test.ts`
- [x] 2.3 Failing tests + implementation that continued-session usage flows through the existing usage accounting and `budget` guard identically to fresh spawns. Verify: `bun test tests/sdd-runner/resume-budget.test.ts`
- [x] 2.4 Failing tests + implementation for run status `stopped` (state schema additive, parsing lenient) and routing of stopped runs through the interrupted path. Verify: `bun test tests/sdd-runner/run-state-stopped.test.ts`

## 3. Calm stop seam (coexists)

- [x] 3.1 Failing tests for the boundary-honoring stop controller: stop request honored between rounds/stages, in-flight agents complete, artifacts and event log consistent, status `stopped`. Verify: `bun test tests/sdd-runner/stop-controller.test.ts`
- [x] 3.2 Implement the stop seam (review-loop `stop-controller` shape) wired into the orchestrator's round/stage boundaries. Verify: `bun test tests/sdd-runner/stop-controller.test.ts`
- [x] 3.3 Failing tests + implementation for the cross-process marker file (`stop-requested`) the seam checks at boundaries. Verify: `bun test tests/sdd-runner/stop-marker.test.ts`

## 4. Ink TUI (coexists until cutover)

- [x] 4.1 Walking skeleton test: Ink renders under the orchestrator's event loop in-process for a full fixture event sequence and unmounts cleanly (the design's stated unproven path — prove it before polish). Verify: `bun test tests/sdd-runner/tui-skeleton.test.ts`
- [x] 4.2 Failing component tests (ink-testing-library, folded-event fixtures) for the running screen: pipeline map, per-agent slots with tool calls, burndown rows, status line (round/cap, tokens, cost marker, elapsed), stop affordance. Verify: `bun test tests/sdd-runner/tui-running.test.ts`
- [x] 4.3 Implement the running screen over the existing fold layer (`foldSlots`/`foldFindings`/`ReplayFolder`); no new state in components. Verify: `bun test tests/sdd-runner/tui-running.test.ts`
- [x] 4.4 Failing tests for the gate screen: item list with evidence, checkbox toggles, TextInput redirects/answers, approve gated on ack + blockers answered, consequences rendered beside `(a)pprove/(e)xtend/(x)abort`, policy-prechecked items read-only. Verify: `bun test tests/sdd-runner/tui-gate.test.ts`
- [x] 4.5 Implement the gate screen calling the decision logic extracted from `gate-session.ts`, persisting through `gate-answers.ts` (write-then-parse self-check guards every write); delete `clack-prompter.ts`/`composition-prompter.ts`/readline path. Verify: `bun test tests/sdd-runner/tui-gate.test.ts && bun test tests/sdd-runner/gate-answers.test.ts`
- [x] 4.6 Failing tests + implementation for calm-stop keys (`q`/first Ctrl-C → calm stop; second → exit 130; `exitOnCtrlC: false`) and the deadline countdown display with first-writer-wins race vs the expiry claim (D10). Verify: `bun test tests/sdd-runner/tui-signals.test.ts`
- [x] 4.7 Failing tests + implementation for the disposable-view restore: unmount, re-mount from `events.ndjson` replay alone, including partially-answered gate state. Verify: `bun test tests/sdd-runner/tui-restore.test.ts`
- [x] 4.8 Failing tests + implementation for narrow-terminal degradation (stacked regions under 60 cols, no truncated decision lines). Verify: `bun test tests/sdd-runner/tui-narrow.test.ts`
- [x] 4.9 TTY/CI detection matrix tests (stdout TTY × stdin TTY × `CI` × `TERM=dumb` → TUI or LineRenderer; `SDD_DEBUG=1` raises line altitude). Verify: `bun test tests/sdd-runner/render-mode.test.ts`

## 5. Config: five keys, single autonomy mode (coexists)

- [x] 5.1 Failing tests for the strict schema: exactly `repoRoot`/`workDir`/`model`/`budget`(default 5)/`deadline`(optional); each removed key (`autonomy`, `models`, `timeouts`, `budgetUsd`) rejected by name with replacement pointer. Verify: `bun test tests/sdd-runner/config-strict.test.ts`
- [x] 5.2 Implement the strict schema; compile timeout constants; fold `deadline` into the existing waiter arming (derived wait: deadline set + non-TTY ⇒ wait). Verify: `bun test tests/sdd-runner/config-strict.test.ts && bun test tests/sdd-runner/`
- [x] 5.3 Failing tests + implementation for single-mode autonomy: ladder always evaluates and settles what it can (assist semantics per D7), audit records unconditional, level conditionals removed from the gate prelude, `autoExtendsUsed` and the count bound removed from R2 (trajectory window + R4 budget guard remain the sole extension eligibility). Verify: `bun test tests/sdd-runner/auto-policy.test.ts && bun test tests/sdd-runner/gate-prelude.test.ts`

## 6. CLI cutover (BREAKING — one revertible commit)

- [x] 6.1 Failing tests for the `sdd [<target>]` routing table: task-file → start; exact id/prefix → state-routed; single gate-pending/interrupted/completed → route; ambiguous/no-target-multi → list candidates + exit; legacy subcommand shapes and removed flags fail naming the replacement. Verify: `bun test tests/sdd-runner/cli-routing.test.ts`
- [x] 6.2 Implement the routing verb + `sdd stop [id]` + `--config`/`--depth`/`--pr`/`--reopen [<n>]`; delete `start`/`resume`/`gate`/`continue`/`report`/`audit`/`watch` subcommands, `cli-flags.ts` decision flags, `watch` verb files, and `DynamicRenderer`; update `sdd-runner:start` script and `USAGE`. Verify: `bun test tests/sdd-runner/cli-routing.test.ts && bun run sdd-runner:typecheck`
- [x] 6.3 Failing tests + implementation for completed-run report footer naming `transcripts/` and `sessions.jsonl` paths. Verify: `bun test tests/sdd-runner/report-footer.test.ts`
- [x] 6.4 Drop `@clack/prompts` from `sdd-runner/package.json`; confirm `ink`/`react`/`ink-testing-library` are the only interactive-surface deps. Verify: `bun install && bun run sdd-runner:typecheck && bun run sdd-runner:lint`

## 7. Docs and final verification

- [x] 7.1 Rewrite `docs/architecture/sdd-pipeline.md`: Commands (new surface), Live rendering (TUI + LineRenderer fallback), Autonomy (single mode, assist semantics, unconditional audit), deadline section (config key + D10 race), watch section deleted; transcripts/session ledger documented. Verify: manual read against `sdd --help` output
- [x] 7.2 Note the `shared-tui-renderer` pending change re-scope (sdd-runner consumes format helpers only — `DynamicRenderer` deleted) in that change's proposal. Verify: `openspec show shared-tui-renderer --json`
- [x] 7.3 Run full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run sdd-runner:format:check`, `bun security`; `openspec validate sdd-runner-simplify --strict`. Verify: all green, no new baseline entries needed for changed files under `scripts/mutation/baseline.json` (check `bun run test:mutate:changed` on the branch)
