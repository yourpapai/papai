# Claude Code CLI backend for sdd-runner

## Goal

Let an sdd-runner run drive the official `claude` CLI instead of `opencode run`, so repos whose model budget lives in Anthropic credentials can run the SDD pipeline. `opencode-agent` (`build-claude-code-cli-as-a-selectable-model-backend-in-opencode`) and `review-loop` (`using-claude-code-in-review-loop`, 44/46 tasks landed) already carry the claude route; sdd-runner is the last workspace still hard-bound to the opencode subprocess. It is also the cheapest to convert: `sdd-runner/src/agent-layer.ts` already spawns every stage agent through review-loop's `runAgent`, which now accepts `backend` / `claude` / `createClaudeSpawnDir` options — sdd-runner simply never sets them, so every spawn silently takes the `opencode` default.

The default route must stay byte-identical.

## Files to touch

- `sdd-runner/src/config.ts` — the strict five-key `RunnerConfigSchema` gains a `backend: z.enum(['opencode','claude']).default('opencode')` key (`z.strictObject` rejects it today); `RunnerConfig` gains the field. `sdd-runner/config.example.json` documents it beside the existing `_budget`/`_metered` prose keys.
- `sdd-runner/src/index.ts` — `buildHarness` resolves the backend after config load and before any spend: call review-loop's `resolveAgentBackend(backend, process.env)` (`review-loop/src/backend-select.ts`) for the credential-exclusivity guard, and open a run-scoped `CLAUDE_CONFIG_DIR` parent under `os.tmpdir()` (mirroring `openClaudeContext`, which is typed against `ReviewLoopConfig` and so cannot be reused as-is — either generalize it there or build the `ClaudeRunContext` locally). The parent is removed best-effort at run teardown; it must never live inside `repoRoot` or `workDir`, so no fixer commit can stage it.
- `sdd-runner/src/gate-digest.ts` (`OrchestratorDeps`) and `sdd-runner/src/pipeline-env.ts` (`AgentLayerDeps`) — carry the resolved backend and the optional `ClaudeRunContext` from the harness down to the agent layer.
- `sdd-runner/src/agent-layer.ts` — `runSpawn` passes `backend`, `claude`, and (if injected for tests) `createClaudeSpawnDir` into `runAgent`.
- The resume-continuation path in `agent-layer.ts` — `extraArgs: ['--session', <id>]` is opencode-argv-shaped, and review-loop's `buildAgentCommand` refuses a non-empty `extraArgs` on the claude route with a named composition error (`review-loop/src/agent-command.ts:190`). Map the continuation to the claude CLI's `--resume <session-id>` (preferred: sdd-runner's `session-ledger.ts` already records the id from the `init` line the claude decoder emits), or, if the composition seam cannot carry it, disable continuation on the claude route and fall back to the prompt-rebuild spawn that `runStageAgent` already treats as the safe path. Either way the behaviour must be chosen deliberately and pinned by a test, not left to the refusal error.
- Role→allowlist mapping — `review-loop/src/claude-argv.ts` `allowlistForLabel` recognizes only the loop's own label forms (`reviewer`, `matcher`, `inspector*`, `fixer*`) and falls unrecognized labels to the weakest analysis set (`Read,Glob,Grep` plus a scratch-scoped `Write`). sdd-runner's roles are `drafter`, `reviewer`, `skeptic`, `resolver`, `estimator`, `decomposer`, `atomicity`, `planner`; several must write OpenSpec artifacts under `openspec/changes/<name>/`. Extend the mapping to cover sdd-runner's labels with per-role allowlists (writers get `Write`/`Edit`; analysis-only roles keep the weak set), keeping review-loop's existing label answers unchanged.
- `sdd-runner/src/usage-aggregate.ts` / `pricing.ts` — confirm the claude `result`-line usage buckets and `total_cost_usd` land in the runner's cost ledger, budget ceiling and gate cost digest; today cost is resolved from the models.dev table keyed by the `provider/model` id, and `claude-argv`'s `modelIdForCli` strips the `provider/` prefix only for argv. Config keeps the prefixed id so pricing lookups stay intact; state this explicitly.
- Docs — `sdd-runner/config.example.json` and `docs/architecture/sdd-pipeline.md`: the `backend` key, the two credential spellings and their invocation profiles (`ANTHROPIC_API_KEY` → bare, `CLAUDE_CODE_OAUTH_TOKEN` → native), and the route's carried-over trade-offs (no retry layer, killed-turn token under-count).

## Behaviour change

- A runner config with no `backend` key, or `"backend": "opencode"`, behaves exactly as today — same argv, same env, no credential guard, no temp config dir.
- `"backend": "claude"` makes every stage agent spawn the pinned `claude` CLI through review-loop's composition seam: profile block by credential spelling, per-role `--allowedTools`, `--permission-mode default`, prompt on stdin, NDJSON `stream-json` decode into the runner's existing event/usage/session-ledger plumbing.
- A bad credential environment on the claude route (both Anthropic spellings set, neither set, or a set `LLM_API_KEY`) fails the run at startup with the code-prefixed `BackendSelectionError` message, before any run directory or model spend.
- A value outside `opencode|claude` fails config load naming the key, alongside the existing removed-key pointers.
- Session continuity, working-tree guarding, validation retries, the gate, the budget ceiling and the TUI are unchanged on both routes.

## Assumptions

- `using-claude-code-in-review-loop` lands (or is treated as landed) first — this change consumes its `backend-select.ts`, `claude-argv.ts`, `agent-command.ts` and `claude-stream.ts` across the existing intra-repo import that `agent-layer.ts` already uses; it does not duplicate them. The successor credential changes (`claude-apikeyhelper-credential-route`, `claude-native-oauth-profile`) may narrow the accepted spellings; sdd-runner inherits whatever the guard decides rather than restating it.
- sdd-runner is a local/maintainer tool with no GitHub Actions workflow of its own (no `.github/workflows/*` references it), so unlike the two sibling changes there is no pinned-CLI install step or route-gated secret forwarding to add. Operators install the CLI themselves; the docs say so.

## Verification

- New/extended tests under `tests/sdd-runner/` (`config.test.ts`, `config-strict.test.ts`, `agent-layer.test.ts`, plus the harness wiring) and `tests/review-loop/claude-argv.test.ts` for the extended label mapping: default-route argv byte-identical asserted by full-array equality; claude-route argv/env composition per role; credential-guard refusals by code; continuation behaviour on the claude route; temp config dir created outside the repo and removed at teardown.
- `bun run sdd-runner:test && bun run review-loop:test && bun run lint && bun run typecheck`, plus `bunx openspec validate sdd-runner-claude-cli-backend --strict`.
- One credentialed manual run (`bun run sdd-runner:start` against a small task with `backend: "claude"`) reaching the gate — recorded in the change as the live proof, never in CI.
