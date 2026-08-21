# Tasks — sdd-runner-tui-wiring

Test-first per design.md Migration Plan; each step shippable alone. TDD: failing test in `tests/sdd-runner/` before the gated `sdd-runner/src/**` edit.

## 1. Mode-dependent harness wiring

- [x] 1.1 Failing tests: with TTY streams and no CI/dumb env, a started run produces no line-renderer bytes on stdout (bus has no LineRenderer subscriber); with piped/CI/dumb output stays byte-identical lines; `SDD_DEBUG=1` only raises line altitude. Verify: `bun test tests/sdd-runner/render-mode.test.ts tests/sdd-runner/tui-exclusivity.test.ts`
- [x] 1.2 Implement: `buildHarness` computes `renderModeFor` once; `line*` keeps today's wiring; `tui` leaves `deps.render` undefined and adds the `mountRunScreen(runDir, logPath)` dep. Verify: `bun test tests/sdd-runner/tui-exclusivity.test.ts && bun run sdd-runner:typecheck`

## 2. Run-screen session

- [x] 2.1 Failing tests (walking skeleton through the session, not the bare component): mounting the session over a fixture event sequence renders pipeline map, agent slots, burndown, status line; unmount is clean; events arriving after mount update the frame. Verify: `bun test tests/sdd-runner/tui-run-session.test.ts`
- [x] 2.2 Implement `sdd-runner/src/tui-run-session.ts`: Ink mount (`exitOnCtrlC: false`), `onEvent` fold+rerender via `foldRunView`, scripted-key seam named like the gate session's. Verify: `bun test tests/sdd-runner/tui-run-session.test.ts`
- [x] 2.3 Failing tests: attach to an existing log seeds the first frame from `restoreRunFold` replay alone; `q` and first Ctrl-C write the run's `stop-requested` marker (same seam as `sdd stop`); second Ctrl-C exits 130. Verify: `bun test tests/sdd-runner/tui-run-session.test.ts tests/sdd-runner/tui-signals.test.ts`
- [x] 2.4 Implement restore seeding and key→seam wiring. Verify: `bun test tests/sdd-runner/tui-run-session.test.ts`

## 3. Verb mounts

- [x] 3.1 Failing tests: start, resume, continue, and gate-resume's post-decision tail each mount the run screen in `tui` mode and never subscribe the line renderer; gate session unmounts before the run screen mounts (no two live Ink instances). Verify: `bun test tests/sdd-runner/cli-routing.test.ts tests/sdd-runner/tui-run-session.test.ts`
- [x] 3.2 Implement the mounts at the four routes. Verify: `bun test tests/sdd-runner/ && bun run sdd-runner:typecheck`

## 4. Cutover leftovers

- [x] 4.1 Failing tests: runner hints after a gate halt and after an interrupted stop name `sdd <run-id>` and contain no removed subcommand form. Verify: `bun test tests/sdd-runner/` (orchestrator/output hint suites)
- [x] 4.2 Replace the removed-verb hints in `gate-digest.ts` and `orchestrator.ts`; delete `sdd-runner:resume|gate|report` from `package.json`. Verify: `bun test tests/sdd-runner/ && bun run sdd-runner:lint`

## 5. Docs and final verification

- [ ] 5.1 Check `docs/architecture/sdd-pipeline.md` live-rendering section against actual behavior; correct any wording that diverges (mount points, exclusivity). Verify: manual read against `sdd --help` and a TTY smoke run
- [ ] 5.2 Full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run sdd-runner:format:check`; `openspec validate sdd-runner-tui-wiring --strict`. Verify: all green
