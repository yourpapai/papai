## 1. Live renderer estimation (test-first)

- [x] 1.1 Add failing tests to `tests/sdd-runner/live-renderer.test.ts`: (a) `step_finish` with `costUsd: 0` and tokens > 0 resolves the agent's model from the prior `spawned` event and adds the estimated cost to the footer with a `~$` prefix; (b) metered `step_finish` (`costUsd > 0`) renders `$` without `~`; (c) resolver returning `null` hides the cost segment (current behavior); (d) mixed metered + estimated steps render `~$`; (e) no resolver passed → byte-identical footer to today. Verify: `bun test tests/sdd-runner/live-renderer.test.ts` (new cases fail)
- [x] 1.2 Add failing double-count regression test to `tests/sdd-runner/live-renderer.test.ts`: a `step_finish` sequence followed by `done` (whose `usage` equals the sum of the step deltas) leaves footer tokens/cost equal to the step sum, not twice it. Verify: `bun test tests/sdd-runner/live-renderer.test.ts` (fails)
- [x] 1.3 Implement in `sdd-runner/src/live-renderer.ts`: optional `ResolveCostFn` constructor dep, `agentModels` map fed by `spawned` events, per-`step_finish` estimate using the `repriceEvent` formula `((input + reasoning) * cost.input + output * cost.output) / 1_000_000`, sticky `costEstimated` flag, `~$` marker in `statusLine()`, and removal of the `done` branch's totals accumulation (slot delete stays). Verify: `bun test tests/sdd-runner/live-renderer.test.ts` (all pass)

## 2. Wiring

- [x] 2.1 Add failing tests to `tests/sdd-runner/renderer.test.ts`: `createRenderer` forwards `opts.resolveCost` to `DynamicRenderer` (observable via an estimated-cost footer on a TTY fake stream) and ignores it for `LineRenderer`. Verify: `bun test tests/sdd-runner/renderer.test.ts` (fails)
- [x] 2.2 Extend `RendererOptions` with `resolveCost?: ResolveCostFn` in `sdd-runner/src/renderer.ts` and thread it into the `DynamicRenderer` constructor in `createRenderer`. Verify: `bun test tests/sdd-runner/renderer.test.ts tests/sdd-runner/live-renderer.test.ts`
- [x] 2.3 In `sdd-runner/src/index.ts` `buildHarness`, call `await buildResolveCost()` once and pass the resolver via `createRenderer(process.stdout, verbosity, { resolveCost })`. Verify: `bun run sdd-runner:typecheck` and `bun test tests/sdd-runner/index.test.ts`

## 3. Full verification and docs

- [ ] 3.1 Update `docs/architecture/sdd-pipeline.md`: note the live footer's estimated-cost segment (`~$` marker, display-time only, events stay raw). Verify: `openspec validate sdd-runner-live-cost-estimate --strict`
- [ ] 3.2 Run full gates: `bun run test`, `bun run typecheck`, `bun run sdd-runner:lint`, `bun run sdd-runner:format:check`. Verify: all green
