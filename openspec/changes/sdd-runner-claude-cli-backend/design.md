## Context

See `proposal.md` for motivation. What the design has to work with:

- `sdd-runner/src/agent-layer.ts` already spawns every stage through review-loop's `runAgent` (imported across the established intra-repo seam at `../../review-loop/src/agent-runner.js`). `runAgent` accepts `backend`, `claude` and `createClaudeSpawnDir`; sdd-runner passes none, so every spawn takes the `opencode` default. The claude route is therefore a wiring change, not a new subprocess implementation.
- `AgentLayerDeps` is `{ spawn, config, execGit, emit }`, rebuilt identically at four sites (`pipeline-env.ts:44`, `extend-round.ts:267`, `gate-resume-tail.ts:145`, `plan-resume.ts:150`). It already carries `config`, so the *route* needs no threading once `backend` is a config key — only the credential-bearing `ClaudeRunContext` does.
- `buildHarness` (`sdd-runner/src/index.ts:141`) builds one `OrchestratorDeps` per process. The session screen starts several runs from that one harness, and plan children run **in-process** (`plan-resume.ts:279` → `startChildRun(resolved, …)`), so anything hung off `OrchestratorDeps` is process-scoped and reaches child runs for free.
- Stage spawn `cwd` is `config.repoRoot` — the live checkout, not a worktree (the review loop's fixer runs in a worktree; sdd-runner's writers do not). Scratch exchange still goes through the same `agentWritePath(cwd, …)` helper, i.e. `<repoRoot>/.review-loop/<name>`, which the runner copies into `<runDir>/sidecars/`.
- Reviewer and skeptic spawn concurrently (`review-agents.ts:128`, `Promise.all`).
- `usage-aggregate.repriceEvent` reprices only when `usage.costUsd === 0`, and marks `costKnown = false` when a model id cannot be priced — the ladder already reads that as unknown spend.

## Goals / Non-Goals

**Goals:**

- Wire the existing review-loop composition seam into sdd-runner's four `AgentLayerDeps` construction sites through exactly one carrier, so no future site can silently miss the route.
- Decide the resume-continuation behaviour on the claude route on evidence, and pin it by a test.
- Extend the role→allowlist mapping so the runner's artifact-writing roles can actually write, without changing any answer the review loop already gets.
- Keep the `opencode` route byte-identical by construction rather than by inspection.

**Non-Goals:**

- Re-implementing argv composition, credential resolution, stream decoding or config-dir isolation in sdd-runner — all four live in review-loop and are consumed, not copied.
- Narrowing or restating which credential spellings are accepted; the shared guard owns that, and the successor credential changes retune it once for every consumer.
- A retry layer, a session-continuation mechanism, or a CI install step for the claude route.

## Decisions

### D1 — `backend` is a config key, not a flag or an environment variable

`RunnerConfigSchema` gains `backend: z.enum(['opencode', 'claude']).default('opencode')` inside the existing `z.strictObject`. The runner's CLI spec pins start-time flags to the depth override, and an environment-variable route would be invisible in the run record. A config key is also what the sibling workspaces chose, so one mental model covers all three.

*Alternative:* an `SDD_RUNNER_BACKEND` env var — rejected: it would be the only run-shaping input not visible in the config file the gate digest quotes.

`config.example.json` documents the key plus a `_backend` prose line beside the existing `_budget`/`_metered` prose keys. Note that those `_`-prefixed keys are illustrative only — the strict schema would reject them if the example were loaded verbatim. That is pre-existing and deliberately not fixed here.

### D2 — One carrier, one construction helper

Only `claude?: ClaudeRunContext` is threaded: `OrchestratorDeps` (`gate-digest.ts`) gains it, `AgentLayerDeps` (`agent-layer.ts`) gains it, and `runSpawn` passes `backend: deps.config.backend`, `claude: deps.claude` and the optional injected `createClaudeSpawnDir` into `runAgent`. The route itself is read off `deps.config.backend`, which `AgentLayerDeps` already holds — nothing to thread.

The four duplicated `AgentLayerDeps` literals collapse into one exported `agentDepsOf(deps, emit)` helper (in `pipeline-env.ts`, which already owns that shape). No new module: `pipeline-env.ts` is the existing home for "turn `OrchestratorDeps` into the per-stage environment".

*Alternative:* thread `backend` and `claude` separately through all four sites — rejected: four hand-copied literals is exactly how a route gets dropped on one path (`extend-round`'s verification round is the easiest to miss).

### D3 — Resolve credentials and open the config-dir parent at run entry, memoized per process

`buildHarness` runs for *every* verb, including `sdd stop`, `sdd analyze` and report printing. Resolving the credential guard there would make a missing `ANTHROPIC_API_KEY` fail read-only verbs on a claude-route config. Instead `index.ts` wraps the run-driving harness members (`runStart`, `runResume`, `runContinue`, `runGateResume`, and the session loop's start path) in a memoized `withClaude(orchestratorDeps)`: on first call it runs `resolveAgentBackend(config.backend, process.env)` and opens the config-dir parent, then returns `{ ...orchestratorDeps, claude }`. On the opencode route it returns the deps object untouched — no guard, no temp dir, no `process.env` read.

This satisfies "before any run directory and before any spend": the wrapper runs before `runStart` creates the run directory, and the guard throws a `BackendSelectionError` whose message is already code-prefixed for the top-level catch.

The parent is process-scoped, not run-scoped, because one harness serves the session loop and in-process child runs. Isolation is still per **spawn**: review-loop's `defaultCreateClaudeSpawnDir` `mkdtemp`s a child under the parent for every attempt — required anyway, since reviewer and skeptic run concurrently and shared CLI state files were never recorded under that. Removal is best-effort in `runEntry`'s `finally`; a failed removal never changes the exit status, and the parent is under `os.tmpdir()`, so no commit can stage it and a SIGKILL leak is left to OS tmp reaping.

*Alternative:* resolve eagerly in `buildHarness` — rejected for breaking read-only verbs. *Alternative:* resolve lazily at first spawn — rejected: the spec (and the sibling routes) require the refusal to precede the run directory, and a first-spawn guard would refuse after prompts were built.

### D4 — `openClaudeContext` is generalized in place, not copied

Its first parameter widens from `ReviewLoopConfig` to the structural `{ claude?: ClaudeRunContext }`, plus an optional tmp-prefix argument defaulting to today's `review-loop-claude-`; sdd-runner passes `sdd-runner-claude-` and a small holder object. `ReviewLoopConfig` stays assignable, so the loop's call site and tests are untouched.

*Alternative:* build the context locally in sdd-runner — rejected: the "`mkdtemp` under the OS tmp root, never inside the checkout, envSource read exactly once" doctrine would then exist in two places with no test pinning them equal. The workspaces already share this module by import, so this is not new coupling.

### D5 — Continuation is **not** carried on the claude route; the rebuild path is taken deliberately

`agent-layer.ts` passes `extraArgs: ['--session', id]` for a resume continuation, which `buildAgentCommand` refuses on the claude route. The fix is not to translate it to `--resume <id>`: the claude CLI can only resume a session whose transcript is under its `CLAUDE_CONFIG_DIR`, and by D3 that directory is a fresh `mkdtemp` per spawn, removed with the process. A resume after a crash is by definition a *new process*, so the recorded session is unaddressable — `--resume` would fail on every real continuation, converting a working fallback into a wasted spawn plus an error.

So `runStageAgent` skips the continuation attempt when `config.backend === 'claude'` and goes straight to the prompt-rebuild spawn, emitting the same fallback signal a pruned session emits today. `extraArgs` is then empty on that route by construction, and the composition refusal at `agent-command.ts:190` becomes unreachable rather than load-bearing. The session id is still recorded in the ledger on both routes. This is exactly the third rung of the archived durability spec — "stage-boundary re-spawn from rebuilt prompts when no session is usable" — not a new degradation.

*Alternative:* a stable per-run config dir plus the spawn dir recorded in the ledger, so `--resume` could find the transcript after a crash — rejected: it introduces persistent CLI state that outlives the run, contradicts the per-spawn isolation the concurrent reviewer/skeptic pair requires, and cannot be exercised in CI. Worth revisiting only if continuation on the claude route is ever shown to be worth a session-store doctrine. *Alternative:* leave the refusal to fire and let the caller's `.catch(() => null)` swallow it — rejected by the proposal: the behaviour must be chosen, not inherited from an error message.

### D6 — The allowlist mapping is extended in review-loop, keyed by the runner's real labels

`review-loop/src/claude-argv.ts` gains one set, `ALLOWLISTS.author = 'Read,Edit,Write,Glob,Grep'`, and `allowlistForLabel` gains the runner's prefixes:

- `drafter*`, `resolver*`, `decomposer*`, `atomicity*` → `author` (they materialize or rewrite files under `openspec/changes/<name>/`).
- `skeptic*`, `estimator*`, `planner*` → the analysis set, named explicitly so they stop tripping the unmapped-label warning. `reviewer*` already matches the loop's own prefix and needs nothing.
- No runner label collides with a loop prefix (`resolver` does not start with `reviewer`), so every existing answer is unchanged.

No runner role gets `Bash`: strict validation after decomposition and atomicity is run by the runner through `deps.driver.validateStrict`, never by the agent. The analysis roles need no extra scratch rule either — `analysisAllowlist(cwd)` already scopes `Write` to `${cwd}/.review-loop/**`, which is precisely where sdd-runner's prompts send JSON output, because both sides call the same `agentWritePath` helper and the spawn cwd is `repoRoot`.

`author` is deliberately byte-equal to `opencode-agent`'s `ALLOWLISTS.propose`, the parent route's proposal-writing set. `tests/opencode-agent/claude-doctrine.test.ts` pins the duplicated constants **per key** (`fixer` ↔ `build`, `analysis` ↔ `plan`), so adding a key breaks nothing; the change adds a third pin (`author` ↔ `propose`) rather than leaving the new set unpinned.

*Alternative:* keep the runner's labels unmapped and let them inherit the weakest set — rejected: the drafter could not write the artifact and every claude-route run would fail at the first stage. *Alternative:* pass an allowlist through the seam from sdd-runner — rejected: `buildAgentCommand` owns argv composition, and a second mapping would drift from the loop's doctrine.

### D7 — Cost accounting needs tests, not code

`claude-stream` maps the turn's `result` line to the four token buckets plus `total_cost_usd`, and `line-handler` adds that cost into the spawn's `AgentUsage`, which becomes the `done` event the runner aggregates. `repriceEvent` returns early when `costUsd > 0`, so a CLI-reported cost is preserved verbatim; when the CLI reports `0` (possible on the native/subscription profile) the existing models.dev lookup reprices from the token buckets, keyed by the model recorded on the `spawned` event — which is `modelFor(config, role)`, i.e. the **provider-prefixed** config value. `modelIdForCli` strips the prefix for argv only. An unresolvable model id already sets `costKnown = false`, which the ladder treats as unknown spend and gates on.

So the ledger, the budget ceiling and the gate cost digest work unchanged; the work here is a test that pins the chain end to end (decoded `result` line → `done` event → budget guard), and a note in the docs that the config keeps the prefix on purpose.

### Dependencies and scope model

- **No new npm dependency.** `claude` is an operator-installed binary invoked as a subprocess; Zod covers the config key; the AI SDK, Grammy, discord.js and drizzle are not involved.
- **No new module in either workspace.** Config → `config.ts`; harness wiring → `index.ts`; per-stage deps → `pipeline-env.ts`; argv/allowlists → `review-loop/src/claude-argv.ts`; credential guard and run context → `review-loop/src/backend-select.ts`.
- **No new tool surface in papai.** `--allowedTools` is a subprocess argument, not a papai chat tool: there is no capability to gate, no `tool_prefs` entry, and no `ask` confirmation flow — sdd-runner is a local maintainer CLI with no platform-instance binding.
- **No scope-model impact.** Nothing new is persisted against a storage context, config context, platform instance, task instance or user id. The only new state is a temporary directory keyed by nothing but the process, outside the checkout, and one JSON key in the operator's local `config.json`.
- **No database change.** No drizzle migration, no backfill.

## Risks / Trade-offs

- **Writer roles get repo-wide `Write`/`Edit`, and the spawn cwd is the live checkout, not a worktree** → the existing post-spawn `guardWorkingTree` check is the real fence and is unchanged; it fails a stage that touched files outside the change directory. The allowlist is the second, weaker fence, and no writer gets `Bash`, so the review loop's fixer residual (command execution plus a credential in the child env) has no counterpart here.
- **Continuation is lost on the claude route (D5)** → an interrupted stage costs one rebuilt-prompt spawn instead of a cheap continuation. Bounded, reported, and identical to the runner's pre-continuation behaviour; the budget guard sees the extra spend like any other round.
- **Killed turns under-count tokens** → carried over from the shared route: a spawn killed before its `result` line contributes no usage, and the ledger records it as `killed`. Under-count, never over-count, so the budget ceiling stays conservative in the operator's favour.
- **The temp parent can leak on SIGKILL** → removal is best-effort by design; the parent is under `os.tmpdir()`, so a leak is never inside the repository and can never be staged by a commit.
- **A `total_cost_usd` of `0` from the native profile would read as free** → it does not: `repriceEvent` reprices any zero-cost turn from its token buckets, and an unpriceable model degrades to `costKnown = false`, which gates.
- **Generalizing `openClaudeContext` touches a module of a change that has not landed** → the widening is a parameter type plus an optional argument, with `ReviewLoopConfig` still assignable; the loop's own tests cover the existing call unchanged.
- **Nothing about the claude route is exercised in CI** (no credential, no pinned CLI install) → composition, guard, allowlist and decode are all pinned by unit tests over injected seams; end-to-end proof is the single credentialed manual run the proposal records, never CI.

## Migration Plan

Additive and defaulted: an existing `config.json` with no `backend` key loads unchanged and every spawn keeps today's argv and environment. No run-state migration — nothing new is written into `state.json`, `sessions.jsonl` or the gate files, so pre-change runs resume untouched.

Rollback is deleting the key (or setting `"backend": "opencode"`); nothing persisted by a claude-route run needs undoing, since its only route-specific state lived under the OS temp root and is already gone.

Operators adopting the route: install the pinned `claude` CLI, export exactly one of `ANTHROPIC_API_KEY` (bare profile) or `CLAUDE_CODE_OAUTH_TOKEN` (native profile), unset `LLM_API_KEY`, set the key, start a run. A wrong credential environment fails at run entry with a code-prefixed message before any spend.

## Hook / TDD interactions

Every file this change edits is under `sdd-runner/src/` or `review-loop/src/`, both of which `isGateableImplFile` covers — so the Write/Edit hook blocks each edit until a test that **imports that module** exists, and `verify-no-new-surface` blocks new exports that no test covers. No new source file is introduced, and every target already has its test: `tests/sdd-runner/{config,config-strict,agent-layer,pipeline-env,gate-digest,index}.test.ts` and `tests/review-loop/{claude-argv,agent-command,backend-select}.test.ts`.

Test-first order (each step's assertions land before its edit):

1. `config.test.ts` / `config-strict.test.ts` — default `opencode`, `claude` accepted, out-of-enum value named at load → then D1.
2. `claude-argv.test.ts` + the third doctrine pin in `tests/opencode-agent/claude-doctrine.test.ts` — the runner's labels and their suffixed forms, no `Bash` in `author`, loop labels unchanged → then D6.
3. `backend-select.test.ts` — the widened `openClaudeContext` holder and tmp prefix → then D4.
4. `pipeline-env.test.ts` — `agentDepsOf` carries the context to all four sites (new export, so the coverage gate needs the test first) → then D2.
5. `agent-layer.test.ts` — full-array argv equality on the default route; claude-route argv/env per role; `extraArgs` empty on the claude route; continuation skipped and the rebuild reported → then D5 and the `runSpawn` wiring.
6. `index.test.ts` — the guard refuses by code before any run directory, read-only verbs need no credential, the parent is created outside `repoRoot`/`workDir` and removed at teardown → then D3.
7. Cost chain test (D7), then the docs edits — `config.example.json` and `docs/architecture/sdd-pipeline.md` are not TDD-gated, but the doc-review Stop hook watches the changed source files, so they land in the same change.

Finally `bun run sdd-runner:test && bun run review-loop:test && bun run lint && bun run typecheck`, plus `bunx openspec validate sdd-runner-claude-cli-backend --strict`.
