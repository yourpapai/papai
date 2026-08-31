## 1. Config surface (design D1)

- [x] 1.1 Extend `tests/sdd-runner/config.test.ts`: a config with no `backend` key loads as `opencode`, `"backend": "claude"` loads as `claude`, and the `model` value keeps its `provider/model` prefix on both. Verify: `bun test tests/sdd-runner/config.test.ts`
- [x] 1.2 Extend `tests/sdd-runner/config-strict.test.ts`: a `backend` value outside `opencode|claude` fails load naming the key and its accepted values, and the removed-key pointers (`autonomy`, `models`, `timeouts`, `budgetUsd`) still fail as before. Verify: `bun test tests/sdd-runner/config-strict.test.ts`
- [x] 1.3 Add `backend: z.enum(['opencode','claude']).default('opencode')` to `RunnerConfigSchema` and the field to `RunnerConfig` in `sdd-runner/src/config.ts`. Verify: `bun test tests/sdd-runner/config.test.ts tests/sdd-runner/config-strict.test.ts && bun run typecheck`
- [x] 1.4 Document the key in `sdd-runner/config.example.json`: a real `"backend": "opencode"` entry plus a `_backend` prose line beside `_budget`/`_metered`, naming the two credential spellings and their profiles. Verify: `bun run lint`

## 2. Role → allowlist mapping (design D6)

- [x] 2.1 Extend `tests/review-loop/claude-argv.test.ts`: `drafter-<artifact>`, `resolver-r<n>`, `decomposer` and `atomicity` resolve to the artifact-writing set; `reviewer-r<n>`, `skeptic-r<n>`, `estimator` and `planner` resolve to the analysis set with its `Write(<cwd>/.review-loop/**)` scratch rule and log no unmapped-label warning; no runner label's set contains `Bash` or a wildcard entry; `fixer*`, `matcher*` and `inspector*` keep byte-identical answers. Verify: `bun test tests/review-loop/claude-argv.test.ts`
- [x] 2.2 Add the third per-key doctrine pin in `tests/opencode-agent/claude-doctrine.test.ts`: review-loop's `ALLOWLISTS.author` equals `opencode-agent`'s `ALLOWLISTS.propose`. Verify: `bun test tests/opencode-agent/claude-doctrine.test.ts`
- [x] 2.3 Add `ALLOWLISTS.author = 'Read,Edit,Write,Glob,Grep'` and the runner's label prefixes to `allowlistForLabel` in `review-loop/src/claude-argv.ts`. Verify: `bun test tests/review-loop/claude-argv.test.ts tests/opencode-agent/claude-doctrine.test.ts`

## 3. Run-context seam (design D4)

- [x] 3.1 Extend `tests/review-loop/backend-select.test.ts`: `openClaudeContext` accepts a structural `{ claude?: ClaudeRunContext }` holder, honours an optional tmp-prefix argument, defaults to today's prefix, and creates the parent under the OS tmp root. Verify: `bun test tests/review-loop/backend-select.test.ts`
- [x] 3.2 Widen `openClaudeContext`'s first parameter and add the optional prefix argument in `review-loop/src/backend-select.ts`, leaving the loop's own call site unchanged. Verify: `bun test tests/review-loop/backend-select.test.ts && bun run typecheck`

## 4. Threading the route to the agent layer (design D2)

- [x] 4.1 Extend `tests/sdd-runner/pipeline-env.test.ts`: `agentDepsOf(deps, emit)` returns the per-stage deps carrying `config`, `execGit`, `spawn`, `emit` and the optional `claude` context, and is what `buildPipelineEnv` uses. Verify: `bun test tests/sdd-runner/pipeline-env.test.ts`
- [ ] 4.2 Add `claude?: ClaudeRunContext` to `OrchestratorDeps` (`sdd-runner/src/gate-digest.ts`) and `AgentLayerDeps` (`sdd-runner/src/agent-layer.ts`), export `agentDepsOf` from `sdd-runner/src/pipeline-env.ts`, and replace the four hand-built literals (`pipeline-env.ts`, `extend-round.ts`, `gate-resume-tail.ts`, `plan-resume.ts`) with it. Verify: `bun test tests/sdd-runner/pipeline-env.test.ts && bun run typecheck`
- [ ] 4.3 Extend `tests/sdd-runner/agent-layer.test.ts` with the composition assertions: on the default route the spawned argv array is byte-identical to today's by full-array equality with no `stdin`/`env` fields; on the claude route each role spawns `claude` with its profile block, the streaming tail, `--permission-mode default`, its role allowlist, the prefix-stripped model id, the prompt on stdin and the stripped-then-added child env. Verify: `bun test tests/sdd-runner/agent-layer.test.ts`
- [ ] 4.4 Pass `backend: deps.config.backend`, `claude: deps.claude` and the injected `createClaudeSpawnDir` through `runSpawn` into `runAgent` in `sdd-runner/src/agent-layer.ts`. Verify: `bun test tests/sdd-runner/agent-layer.test.ts && bun run typecheck`

## 5. Resume continuation on the claude route (design D5)

- [ ] 5.1 Extend `tests/sdd-runner/agent-layer.test.ts`: with `continueSessionId` set on the claude route, no continuation spawn is attempted, `extraArgs` is empty, the stage re-spawns from the rebuilt prompt, the fallback is reported, and no argument-composition error surfaces; the opencode route still composes `['--session', id]` and reports the continuation path. Verify: `bun test tests/sdd-runner/agent-layer.test.ts`
- [ ] 5.2 Skip the continuation attempt in `runStageAgent` when the resolved route is `claude`, emitting the existing fallback signal before the rebuild spawn. Verify: `bun test tests/sdd-runner/agent-layer.test.ts && bun run sdd-runner:test`

## 6. Harness wiring and credential guard (design D3)

- [ ] 6.1 Extend `tests/sdd-runner/index.test.ts`: on the claude route a bad credential environment (both spellings set, neither set, a set `LLM_API_KEY`) fails a run-driving verb with the code-prefixed `BackendSelectionError` before any run directory is created and before any spawn; `ANTHROPIC_API_KEY` alone resolves the bare profile and `CLAUDE_CODE_OAUTH_TOKEN` alone the native one. Verify: `bun test tests/sdd-runner/index.test.ts`
- [ ] 6.2 Extend `tests/sdd-runner/index.test.ts`: read-only verbs (`stop`, `analyze`, report) run on a claude-route config with no credential set; the opencode route never reads a credential nor creates a config-dir parent; the parent is created under the OS tmp root and inside neither `repoRoot` nor `workDir`, is removed at teardown, and a removal failure changes neither the outcome nor the exit status. Verify: `bun test tests/sdd-runner/index.test.ts`
- [ ] 6.3 Add the memoized `withClaude` wrapper around the run-driving harness members in `sdd-runner/src/index.ts` (guard + `openClaudeContext` on first use) and the best-effort teardown in `runEntry`'s `finally`. Verify: `bun test tests/sdd-runner/index.test.ts && bun run typecheck`

## 7. Cost and usage accounting (design D7)

- [ ] 7.1 Add a test covering the claude-route cost chain: a decoded `result` line's four token buckets and `total_cost_usd` reach the `done` event once with cache counters unfolded, a CLI-reported cost survives repricing untouched, a zero-cost turn reprices from the provider-prefixed config model id, and an unpriceable model yields `costKnown: false` so the ladder reads unknown spend. Verify: `bun test tests/sdd-runner/usage-aggregate.test.ts tests/sdd-runner/pricing.test.ts`
- [ ] 7.2 Make the chain pass without changing pricing semantics — expected to be test-only; if any wiring gap appears, fix it in `sdd-runner/src/usage-aggregate.ts` without touching the opencode route's numbers. Verify: `bun run sdd-runner:test`

## 8. Docs, proof and full verification

- [ ] 8.1 Update `docs/architecture/sdd-pipeline.md`: the `backend` key, the two credential spellings and their invocation profiles, per-role allowlists, the operator-installed CLI (no CI step), and the route's carried-over trade-offs — no retry layer, killed-turn token under-count, no session continuation. Verify: `bun run lint`
- [ ] 8.2 Record one credentialed manual run (`bun run sdd-runner:start` against a small task with `"backend": "claude"`) reaching the gate, noting argv, spend and gate digest in the change folder — never in CI. Verify: the run reaches its gate and the notes land in `openspec/changes/sdd-runner-claude-cli-backend/`
- [ ] 8.3 Validate the change artifacts. Verify: `bunx openspec validate sdd-runner-claude-cli-backend --strict`
- [ ] 8.4 Run the full suite and refresh any other affected `docs/architecture/*.md` page. Verify: `bun test && bun run typecheck && bun run lint`
