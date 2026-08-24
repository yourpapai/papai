<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Claude Code CLI as a selectable model backend in opencode-agent

Order follows design.md Decision 12 (build order). Every code task is test-first
(the Write/Edit TDD hook does not gate `opencode-agent/src/` — gateable roots are
`src/`, `client/`, `plugins/`, `review-loop/src/`, `sdd-runner/src/` — so the
apply-stage discipline carries it). One concern per task: where the tests are a
separate task it verifies `(red)`, and the paired implementation task makes
exactly that block `(green)`; smaller single-concern edits carry their tests and
implementation in one task. All tests network-free except the recorder, which is
the only credentialed artifact and never runs in CI.

## 1. Recorder and recorded fixtures (design D7, D9, D12 step 1)

- [x] 1.1 Create `tests/opencode-agent/claude-live.integration.ts` (deliberately not `*.test.ts` so discovery skips it) plus `test:claude-live` in `opencode-agent/package.json` and `opencode-agent:test:claude-live` in the root `package.json`, following the `live-sdk.integration.ts` recorder doctrine — the file without the scripts is an unrunnable artifact, the scripts without the file a broken command, so they land together.
  Verify: `bun run typecheck && bun run | rg 'opencode-agent:test:claude-live'`
- [ ] 1.2 Choose the pinned CLI version (then-current stable) and record the whole fixture corpus from the live pinned CLI in one credentialed recorder run — the success turn (init `system` line, `assistant`/`user`/`stream_event` activity, `result` line), error-signalling `result`, non-zero exit, and resume flow; the adversarial `plan`-profile fixture whose prompt attempts a `Bash` call and must come back refused under `--permission-mode default` (the permission-effect pin, not assumed from docs); and the determinism facts — `--output-format stream-json` needs `--verbose` on this CLI, `CLAUDE_CONFIG_DIR` is honored (if not, take the D9 job-scoped `HOME` fallback), `DISABLE_AUTOUPDATER=1` keeps `--version` unchanged after a turn (else `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`), `result`-line usage is per-invocation or session-cumulative (decides the adapter's sum-vs-last, Open Question 2) — stamping the recorded CLI's exact version into the fixture directory. One recorder invocation produces and asserts the whole corpus; the scenarios share that run and cannot be recorded or verified apart.
  Verify: `bun run opencode-agent:test:claude-live` (credentialed; never runs in CI)

## 2. Contract: decoders and argv builder (design D2, D3, D12 step 2)

- [x] 2.1 Tests first in `tests/opencode-agent/claude-contract.test.ts`: Zod line decoders against the recorded fixtures — `system`/`assistant`/`user`/`result`/`stream_event` shapes recorded from the live CLI; unrecognized non-result lines skip via safeParse without failing; `result` facts (final text, token usage, `is_error`, `total_cost_usd` decoded but never read as a budget); init-line session id.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 2.2 Implement the line-decoder half of `opencode-agent/src/claude-contract.ts` (the line schemas).
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (green)
- [x] 2.3 Tests first: argv builder — `--bare`, `-p`, `--output-format stream-json --verbose`, prompt on stdin (never argv), `--append-system-prompt`, profile → `--allowedTools` (`plan`→`Read,Glob,Grep`; `propose`→`Read,Edit,Write,Glob,Grep`; `build`→`Read,Edit,Write,Bash,Glob,Grep`; unknown/absent → `plan` allowlist + `warn`), `--permission-mode default`, `--model` (profile model, `parseModelRef` strips any `provider/` prefix), `--effort` (`AGENT_EFFORT_PLAN`/`AGENT_EFFORT_BUILD` when set; omitted when unset; `propose` gets none), `--resume <id>` only when an id is memoized, and never `--dangerously-skip-permissions`.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 2.4 Tests first: the builder refuses a composed `--append-system-prompt` exceeding MAX_ARG_STRLEN (131,072 bytes) with its own named adapter-level error carrying the composed size, the cap, and the remedy (shrink the inlined skill set).
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 2.5 Implement the argv-builder half of `claude-contract.ts` — composition plus the oversize refusal, one function's contract — making 2.3 and 2.4 green.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (green)

## 3. Backend knob, route-scoped config, credential guard (design D4, D5, D12 step 3)

- [x] 3.1 Tests first in `tests/opencode-agent/config-values.test.ts` / `tests/opencode-agent/config.test.ts`: `AGENT_BACKEND` enum read — `opencode|claude`, default `opencode`, unset-or-empty keeps the default, any other non-empty value fails with a `ConfigError` naming `AGENT_BACKEND`; read before the gateway block.
  Verify: `bun test tests/opencode-agent/config-values.test.ts tests/opencode-agent/config.test.ts` (red)
- [x] 3.2 Implement the enum read in `config-values.ts` / `config.ts`, the opencode route byte-identical (except the D6 wording delta).
  Verify: `bun test tests/opencode-agent/config-values.test.ts tests/opencode-agent/config.test.ts` (green)
- [x] 3.3 Tests first: credential exclusivity guard fires in `loadConfig` on the claude route — both-set fails naming both variables and the API-key-wins-billing consequence, neither-set fails naming both accepted spellings, failure code `CLAUDE_CREDENTIALS`; set `LLM_API_KEY` on the claude route fails with code `LLM_CREDENTIALS`; guard never fires on the opencode route; messages name variables, never values.
  Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 3.4 Implement the guard in `loadConfig`.
  Verify: `bun test tests/opencode-agent/config.test.ts` (green)
- [x] 3.5 Tests first: claude-route gateway reads become optional-empty — `config.openai` keeps its type with empty `apiKey`/`baseUrl`, `pipelineSecrets`/`mcpSecrets` skip empty values, `AGENT_MCP_SERVERS` still parsed for the secrets list on this route, and the model/profile knobs cross to the claude adapter as plain values on its options (model id + per-profile effort tiers), never the `OpenAiSettings` object.
  Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 3.6 Implement the route-scoped reads and the knob crossing.
  Verify: `bun test tests/opencode-agent/config.test.ts` (green)
- [x] 3.7 Tests first: the chosen Anthropic credential joins `pipelineSecrets` in `secrets.ts` (scrub/redaction/diff-guard see it by value).
  Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 3.8 Implement the `secrets.ts` join.
  Verify: `bun test tests/opencode-agent/config.test.ts` (green)

## 4. Turn errors and connect layer (design D6, D8, D9)

- [x] 4.1 Tests first in `tests/opencode-agent/errors.test.ts`, then implement: `turn-errors.ts` gains the `CLAUDE_EXIT` and `CLAUDE_RESULT` turn-family codes (`errors.ts` re-exports), distinguishable from deadline/stall/dead-server codes.
  Verify: `bun test tests/opencode-agent/errors.test.ts` (green)
- [x] 4.2 Tests first in `tests/opencode-agent/claude-connect.test.ts` (injected spawn seam, no `mock.module`): the spawn contract — detached `node:child_process` spawn (own process group, `shell: false`, argv vector); child env = post-scrub `process.env` + exactly the chosen credential + `DISABLE_AUTOUPDATER=1`, name-stripped of `LLM_BASE_URL` and `AGENT_MCP_SERVERS`; `CLAUDE_CONFIG_DIR` at a fresh job-scoped temp dir under `os.tmpdir()` outside the checkout workspace; determinism knobs are constants, not env-tunable.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 4.3 Tests first: kill reporting — no live group (gone or refused) reports `false`; close-path escalation is fire-and-forget (grace timer never blocks teardown), then reaps and best-effort removes the config dir.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 4.4 Implement `opencode-agent/src/claude-connect.ts` — spawn, env, config dir, constants, and the SIGTERM → named grace → SIGKILL group-kill helper reporting whether it landed, reused by abort and teardown — making 4.2 and 4.3 green.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (green)

## 5. Adapter: session over the seam (design D1, D2, D7, D8, D10, D12 step 4)

- [x] 5.1 Tests first in `tests/opencode-agent/claude-adapter.test.ts` over an injected `options.spawn` seam: successful turn resolves with `result`-line text/usage and the init-line `sessionId`; exit 0 with missing/undecodable `result`, error-signalling `result` (`is_error` or recorded equivalent), or empty final text fails `CLAUDE_RESULT` regardless of exit code; exit 0 with decodable `result` but no session id anywhere fails `CLAUDE_RESULT`; non-zero exit fails `CLAUDE_EXIT` carrying the code and a redacted stderr tail; stderr/stdout tails never carry credential values.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.2 Implement the turn-outcome half of `opencode-agent/src/claude-adapter.ts`: the `TurnConnection` shim (`sendPrompt` = spawn-and-collect promise, `alive` = spawn-transport probe; the `tools` field of `AgentPromptRequest` accepted and ignored) and the resolution/failure contract.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 5.3 Tests first: session continuity — memoized init id chains into the next turn's `--resume` regardless of how the previous turn ended (including killed turns); a kill before any line arrived leaves nothing memoized, so the next turn spawns without `--resume` into a fresh session; boot-time `sessionId` is a synthetic job-local id until the first init lands, and `AgentPromptResult.sessionId` always returns the CLI's.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.4 Implement continuity (memoized id → the next turn's `--resume`).
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 5.5 Tests first: stop and teardown semantics — `abort()` kills the group and reports landed/not; `close()` is never a stop, reports nothing, and terminates a still-live group fire-and-forget before reaping.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.6 Implement stop/teardown over the connect layer's kill helper.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 5.7 Tests first: token accounting — totals captured from `result` lines as they arrive (sum or last per the recorded usage shape from task 1.2), read before any teardown; `tokensUsed()` degrades to `0` with a `warn` when no recognizable usage.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.8 Implement token accounting.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 5.9 Tests first: progress translation — public log rows carry line types, tool names, statuses, counts only (scalar-only schemas); content-bearing lines reach the encrypted `TranscriptSink` unabridged, redacted by credential value first.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.10 Implement progress translation.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (green)

## 6. Turn-run integration (design D6)

- [x] 6.1 Tests first in `tests/opencode-agent/turn-run.test.ts`, then implement: the bypass list gains `CLAUDE_EXIT`/`CLAUDE_RESULT` beside `isTurnDeadline`/`isTurnStall`; the stall watcher stays wired but no-op on this route (whole-turn `AGENT_TIMEOUT_MS` deadline stays the bound; no synthesized retry evidence).
  Verify: `bun test tests/opencode-agent/turn-run.test.ts` (green)
- [x] 6.2 Tests first, then implement: backend-neutral `serverGoneError` rewording — thrown message and the adjacent `bounds.log.error` line say "the model backend process this job spawned / stopped answering", keep the post-mortem step pointer (still true on both routes), pinned by a test on both routes' dead-server/ENOENT shape.
  Verify: `bun test tests/opencode-agent/turn-run.test.ts tests/opencode-agent/adapters.test.ts` (green)

## 7. Seam extraction and wiring (design D2, D4, D12 step 5)

- [x] 7.1 Extract the seam interface into `opencode-agent/src/agent-session.ts` as `AgentSession`; `opencode-adapter.ts` re-exports `OpenCodeAgent` as an alias so no existing import changes; new modules and tests use the neutral name.
  Verify: `bun run opencode-agent:test && bun run typecheck` (existing suites green untouched)
- [x] 7.2 Tests first, then implement: `contain.ts` wiring — `createClaudeAgent` selected when `AGENT_BACKEND=claude` (test seam like `OpenCodeAgentOptions.connect`), `Contained.proxy` nullable with no provider proxy started on the claude route.
  Verify: `bun test tests/opencode-agent/adapters.test.ts` (green)
- [x] 7.3 Tests first, then implement: `index.ts` — `runCli` skips `describeModel` on the claude route, and the one teardown call site gates on the nullable proxy.
  Verify: `bun test tests/opencode-agent/index.test.ts` (green)

## 8. Workflow and workflow pins (design D11, D12 step 6 — protected path)

- [x] 8.1 Maintainer commit (the agent can never land `agent-pipeline.yml` — `stageAllowed` drops and reverts it): job-level `env:` gains `AGENT_BACKEND: ${{ vars.AGENT_BACKEND }}`; a new step before the pipeline step runs `bun add --global @anthropic-ai/claude-code@<exact-version-from-task-1.2>` plus the `$HOME/.bun/bin` PATH line, gated on `env.AGENT_BACKEND == 'claude'`; the pipeline step gains `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` lines gated on the claude route and inverse gates on `LLM_API_KEY`/`LLM_BASE_URL` (model knobs stay forwarded on both routes) — landed on the change branch before task 8.2.
  Verify: `bun workflows:lint`
- [x] 8.2 Tests first in `tests/opencode-agent/workflow.test.ts`, green against the on-branch workflow 8.1 landed: pin the install gate, the version's exactness (no floating tag), and the forwarding gates; rewrite the superseded "passes only the single LLM endpoint credentials" pin (it asserts no `ANTHROPIC*` in the step env, which 8.1's gated lines fail); add the `DELIBERATELY_ABSENT` entry for `AGENT_BACKEND` carrying the job-level-declaration reason so the README-knob harvest stays green; assert the fixture-directory version stamp (task 1.2) equals the workflow's pin.
  Verify: `bun test tests/opencode-agent/workflow.test.ts` (green)

## 9. Documentation

- [x] 9.1 `opencode-agent/README.md`: `AGENT_BACKEND` environment-table row (plus the claude credentials rows), the pinned CLI version, backend-selection notes naming the route's trade-offs — no retry layer (transient waves fail turns), `AGENT_STALL_TIMEOUT_MS` inert, killed-turn token under-count, review-loop `/review` residual, chosen credential readable by the CLI's own `Bash` children (prefer the revocable Console API key on threat-model-sensitive repos), OAuth rotation = regeneration, unrecognized `LLM_MODEL` values fail the first turn loudly.
  Verify: `bun test tests/opencode-agent/workflow.test.ts && bun run format:check` (the knob harvest resolves the new README row)
- [x] 9.2 `opencode-agent/CLAUDE.md`: backend selection, the `claude-contract.ts`/`claude-connect.ts`/`claude-adapter.ts`/`agent-session.ts` module map, route rules for contributors.
  Verify: `bun run format:check`

## 10. Pre-merge verification (design D12 step 7)

- [ ] 10.1 Re-run the recorder end-to-end through the finished `claude-adapter.ts`: the recorder drives the adapter's own argv composition (a flag the pinned CLI no longer accepts fails at recording cost), a live turn running a long `Bash` child is `abort()`ed with no group member surviving, and a follow-up prompt `--resume`s the memoized session after a `SIGKILL`ed turn and answers.
  Verify: `bun run opencode-agent:test:claude-live` (credentialed)
- [ ] 10.2 Full verification sweep green: full suite (workflow pins reading the on-branch workflow file), lint, typecheck, workflow lint, strict change validation.
  Verify: `bun run test && bun run lint && bun run typecheck && bun workflows:lint && bunx openspec validate build-claude-code-cli-as-a-selectable-model-backend-in-opencode --strict`
