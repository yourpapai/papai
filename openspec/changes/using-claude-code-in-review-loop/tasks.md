<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: using Claude Code in review loop

Order follows design.md's Migration plan (step 1's test order, step 2's landing
order, step 3's recorder legs). Every code task is test-first: the Write/Edit
TDD hook gates `review-loop/src/**` → `tests/review-loop/**`; `opencode-agent/src/`
is not hook-gated, so the apply-stage discipline carries it (parent-change
precedent). Multi-concern units split into a tests task verified `(red)` and an
implementation task that makes exactly those blocks `(green)`; smaller
single-concern edits carry tests and implementation in one task. The default
opencode route stays byte-identical throughout; no new dependencies. `D*`
references point at design.md decisions; scenarios at
`specs/review-loop-agent-backend/spec.md`.

## 1. Backend selection knob (design D1)

- [x] 1.1 Tests first in `tests/review-loop/config.test.ts`: a config naming no backend resolves to the effective backend `opencode`; a config naming different backends for two roles fails validation naming "one backend per run" as the rule; a backend value outside `opencode`/`claude` fails at load naming the selection; all before any subprocess starts.
  Verify: `bun test tests/review-loop/config.test.ts` (red)
- [x] 1.2 Implement in `review-loop/src/config.ts`: `backend: z.enum(['opencode', 'claude']).optional()` on `AgentConfigSchema` (per-role placement, no top-level key), a `superRefine` on `ReviewLoopConfigSchema` refusing per-role disagreement, and the resolved config carrying one effective backend (the single non-`undefined` value, else `'opencode'`).
  Verify: `bun test tests/review-loop/config.test.ts` (green)

## 2. Credential guard and profile resolver (design D4)

- [x] 2.1 Tests first in `tests/review-loop/backend-select.test.ts`: `ANTHROPIC_API_KEY` alone → bare profile; `CLAUDE_CODE_OAUTH_TOKEN` alone → native; both set and neither set → `BackendSelectionError` code `CLAUDE_CREDENTIALS` naming both variables; a set `LLM_API_KEY` → code `LLM_CREDENTIALS`; present-but-empty/whitespace-only names read as unset (an injected env carrying the CI forwarding shape verbatim — `''`-valued `LLM_API_KEY` and `''`-valued non-selected Anthropic spelling — resolves rather than refusing); every refusal's surfaced message carries its code prefix so it cannot read as a config-parse or plan-path failure.
  Verify: `bun test tests/review-loop/backend-select.test.ts` (red)
- [x] 2.2 Implement `review-loop/src/backend-select.ts`: pure `resolveAgentBackend(backend, env): { profile, credentialName, credentialValue } | throws` — never reads ambient `process.env`; the opencode route never calls it.
  Verify: `bun test tests/review-loop/backend-select.test.ts` (green)

## 3. Claude argv doctrine module (design D3, D7, D11)

- [x] 3.1 Tests first in `tests/review-loop/claude-argv.test.ts`: `MAX_ARG_STRLEN` = 131,072; profile blocks (`--bare` vs the native neutralization pair `--setting-sources ''` + `--strict-mcp-config --mcp-config <empty-doc>`, both mandatory on every native invocation); allowlist sets — fixer `Read,Edit,Write,Bash,Glob,Grep`, analysis `Read,Glob,Grep` plus `Write` scoped to the scratch dir as an absolute rule composed from the spawn cwd (`Write(<cwd>/.review-loop/**)`); the label→set mapping across the documented label forms (`reviewer`, `matcher`, `inspector`/`-w<n>`/`-aggregated`, `fixer`/`-w<n>[-retry]`/`-batch-<cluster.id>` — bare pooled-less forms included); an unrecognized label falls to the analysis (weakest) set with the condition logged; the provider-prefix model-id strip (`modelIdForCli` mirror: a slash-bearing value keeps its model id, a bare one passes through).
  Verify: `bun test tests/review-loop/claude-argv.test.ts` (red)
- [x] 3.2 Implement `review-loop/src/claude-argv.ts` — the doctrine duplicated from `opencode-agent/src/claude-argv.ts` across the subprocess boundary, never imported.
  Verify: `bun test tests/review-loop/claude-argv.test.ts` (green)

## 4. Command composition seam (design D2, D3, D5, D7)

- [x] 4.1 Tests first in `tests/review-loop/agent-command.test.ts` (opencode branch): `buildAgentCommand` returns exactly today's argv — `opencode run --auto --format json --model <model> --dir <cwd> …extraArgs <prompt>` — asserted by full-array equality, not `toContain` membership, with no stdin and no env.
  Verify: `bun test tests/review-loop/agent-command.test.ts` (red)
- [x] 4.2 Implement `review-loop/src/agent-command.ts` opencode branch: `buildAgentCommand(options): { command, args, stdin?, env? }`, the opencode branch returning none of the optional fields so `realSpawn` inherits `process.env` (today's behavior).
  Verify: `bun test tests/review-loop/agent-command.test.ts` (green)
- [x] 4.3 Tests first (claude argv branch): profile block per resolved profile; `--allowedTools` from the label→allowlist mapping; `--model <id>` with any `provider/` prefix stripped; the streaming tail (`-p`, `--output-format stream-json`, `--verbose`, `--permission-mode default`); the whole composed role prompt returned as `stdin`, never an argv entry; an optional system prompt emitted via `--append-system-prompt` as a single argv entry, refused with a named composition error naming the byte cap and the system-prompt component when over `MAX_ARG_STRLEN`; a non-empty `extraArgs` refused with a named composition error naming the knob; `backend === 'claude'` without the `claude` context refused with a named composition error.
  Verify: `bun test tests/review-loop/agent-command.test.ts` (red)
- [x] 4.4 Implement the claude argv branch, composing task 3's doctrine; the builder stays pure (no filesystem I/O, no ambient env read).
  Verify: `bun test tests/review-loop/agent-command.test.ts` (green)
- [x] 4.5 Tests first (claude env branch): over an injected `envSource` carrying the CI forwarding shape — every D5-stripped name absent from the composed env (`LLM_API_KEY`, `LLM_BASE_URL`, `OPENCODE_CONFIG_CONTENT`, `AGENT_MCP_SERVERS`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`, `CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_VERTEX_BASE_URL`, the non-selected Anthropic spelling); exactly the selected credential, `CLAUDE_CONFIG_DIR` and `DISABLE_AUTOUPDATER=1` added; an inherited non-stripped name (a `GIT_AUTHOR_*` identity name) present, pinning D4's try-side `process.env` read; standard proxy variables (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`) stay inherited; a credential spelling not matching the profile injects nothing.
  Verify: `bun test tests/review-loop/agent-command.test.ts` (red)
- [x] 4.6 Implement the claude env branch (strip-then-add over `envSource` only).
  Verify: `bun test tests/review-loop/agent-command.test.ts` (green)

## 5. Claude NDJSON decoder (design D6)

- [x] 5.1 Tests first in `tests/review-loop/claude-stream.test.ts` over the existing fixture corpus at `tests/opencode-agent/fixtures/claude-cli/*.ndjson` (relative-path test-time read, no runtime import) plus a synthetic multi-block leg — one assistant line carrying two `tool_use` blocks and one user line carrying two `tool_result` blocks, asserting both calls counted/rendered and both results paired (the corpus carries at most one block per line, census-verified): `system/init` → `step_start` (`timestamp` filled with `Date.now()` at decode) and the session-id source (`session_id`); assistant `tool_use` blocks → `tool_use` running (`callId` = block id, `input` passthrough) with the same line's `text` blocks deliberately dropped; `user` `tool_result` blocks → `tool_use` `completed`/`error` paired by `tool_use_id`, `tool`/`input` carried from the paired assistant block, unpaired skipped; `result` → one synthetic `step_finish` (`reason: stop_reason ?? ''`; tokens `{input: input_tokens, output: output_tokens, reasoning: thinking_tokens ?? 0, cacheRead: cache_read_input_tokens, cacheWrite: cache_creation_input_tokens}`; `cost: total_cost_usd`); an unrecognized line → empty list, role proceeds.
  Verify: `bun test tests/review-loop/claude-stream.test.ts` (red)
- [x] 5.2 Implement `review-loop/src/claude-stream.ts`: a decoder factory with `parseLine(line): OpencodeEvent[]` (list-valued), `sessionIdOf(line)` and `resultOutcome(): { seen, isError }`, mapping into the existing `OpencodeEvent` union so `LiveCtx`, `run-stats`, the live renderer and `metrics.json` stay untouched.
  Verify: `bun test tests/review-loop/claude-stream.test.ts` (green)

## 6. Spawn seams: stdin and env (design D3, D5)

- [x] 6.1 Tests first in `tests/review-loop/spawn.test.ts` (stdin seam): `SpawnFn` options gain `stdin?: string`; the stdin stream is half-closed (`end`) after the write; an error-swallowing handler sits on the stdin pipe **before** the first write, so a mid-flush `EPIPE` from a watchdog group-kill fails the attempt through the exit/`AttemptError` path and never kills the loop process.
  Verify: `bun test tests/review-loop/spawn.test.ts` (red)
- [x] 6.2 Implement the stdin seam in `realSpawn` (`review-loop/src/spawn.ts`); the watchdog functions (`setupKillTimers`/`resetInactivityTimer`/`terminate`) change not at all.
  Verify: `bun test tests/review-loop/spawn.test.ts` (green)
- [x] 6.3 Tests first (env seam): `SpawnFn` options gain `env?: Record<string, string>`; a passed `env` is the child's entire replacement environment (a D5-stripped name absent from the captured child env — the merge-over-`process.env` shape cannot pass); `realSpawn` inherits `process.env` when no env is given (today's behavior).
  Verify: `bun test tests/review-loop/spawn.test.ts` (red)
- [x] 6.4 Implement the env seam in `realSpawn`.
  Verify: `bun test tests/review-loop/spawn.test.ts` (green)

## 7. Decoder injection and credential scrub at the sinks (design D5, D6)

- [x] 7.1 Tests first in `tests/review-loop/line-handler.test.ts` (decoder injection): `createLineHandler` takes the decoder as an option defaulting to the opencode adapter (the list-wrapped `parseEventLine`/`sessionIdOfLine`).
  Verify: `bun test tests/review-loop/line-handler.test.ts` (red)
- [x] 7.2 Implement the decoder option in `review-loop/src/line-handler.ts`.
  Verify: `bun test tests/review-loop/line-handler.test.ts` (green)
- [x] 7.3 Tests first (credential scrub): the selected credential's value is scrubbed inside `enqueueLog` itself — the single sink both callers write through (raw NDJSON lines and the stderr line), threaded from the `claude` context onto `LiveCtx` — with fixture lines embedding the value on both caller paths coming out scrubbed, and a sub-floor (<12-char) fixture value surviving the scrub unscrubbed (the mirrored `MIN_SECRET_LENGTH = 12` floor).
  Verify: `bun test tests/review-loop/line-handler.test.ts` (red)
- [x] 7.4 Implement the `enqueueLog` scrub in `review-loop/src/line-handler.ts`.
  Verify: `bun test tests/review-loop/line-handler.test.ts` (green)
- [x] 7.5 Tests first, then implement, in one task (`tests/review-loop/agent-runner.test.ts` + `review-loop/src/agent-runner.ts`): the child stderr capture in `runAttempt` is scrubbed once before it is embedded anywhere — the enqueued stderr line and the `` `${label} exited with code …: ${stderr}` `` `AttemptError` message both flow from the one scrubbed copy.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (green)
- [x] 7.6 Tests first, then implement, in one task (`tests/review-loop/build-checker.test.ts` + `review-loop/src/build-checker.ts`): the same value-substring scrub applied inside `runBuildCheck` — the single producer of `BuildCheckResult`, via an optional `BuildCheckDeps` field (absent on the opencode route) — so `build-check.log`, the needs-human reasoning, the retry `buildError` prompt and the thrown build error's output tail all read one scrubbed copy.
  Verify: `bun test tests/review-loop/build-checker.test.ts` (green)

## 8. Agent runner integration (design D2, D6, D8)

- [x] 8.1 Tests first in `tests/review-loop/agent-runner.test.ts`: `RunAgentOptions` gains additively-optional `backend?: 'opencode' | 'claude'` (default `'opencode'`) and `claude?: { profile, credentialName, credentialValue, configDirRoot, envSource }`; `attemptRun` stops naming a binary and delegates to `buildAgentCommand`; both fields absent (mutation-improve's bare `runAgent` calls) is the opencode default, argv byte-identical to today.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (red)
- [x] 8.2 Implement the options extension and the delegation in `review-loop/src/agent-runner.ts`.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (green)
- [x] 8.3 Tests first (decoder lifecycle): on the claude route the decoder is selected and created/re-armed per attempt beside `handler.ctx.sessionId` (a retry after a stalled first attempt never reads the stalled attempt's result line).
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (red)
- [x] 8.4 Implement the per-attempt decoder wiring.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (green)
- [x] 8.5 Tests first (result-outcome gate): after an exit-0 spawn, `resultOutcome()` is consulted and a missing or error-signalling result line fails the attempt through the existing `AttemptError` path **before** the output file is accepted — never an empty success.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (red)
- [x] 8.6 Implement the result-outcome gate.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (green)
- [x] 8.7 Tests first: each spawn gets its own config-dir child created by the attempt layer through an injectable dir-creation seam (default `mkdtemp`) under the run parent — never created inside the builder — stamped as that spawn's `CLAUDE_CONFIG_DIR`, with the native profile's empty-MCP JSON document written into it by the same seam when the profile is `native`.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (red)
- [x] 8.8 Implement the per-spawn config-dir child seam.
  Verify: `bun test tests/review-loop/agent-runner.test.ts` (green)

## 9. Role threading and run assembly (design D4, D8, D11)

- [x] 9.1 Tests first across `tests/review-loop/review-round.test.ts`, `issue-matcher.test.ts`, `issue-inspector.test.ts`, `issue-processor-attempts.test.ts`, `issue-processor-batch.test.ts`: every `runAgent` call site (or the deps plumbing feeding it) passes the resolved backend/`claude` context into its spawn options.
  Verify: `bun test tests/review-loop/review-round.test.ts tests/review-loop/issue-matcher.test.ts tests/review-loop/issue-inspector.test.ts tests/review-loop/issue-processor-attempts.test.ts tests/review-loop/issue-processor-batch.test.ts` (red)
- [x] 9.2 Implement the threading in `review-round.ts`, `issue-matcher.ts`, `issue-inspector.ts`, `issue-processor-attempts.ts`, `issue-processor-batch.ts`.
  Verify: same five files (green)
- [x] 9.3 Tests first in `tests/review-loop/cli.test.ts`: on the claude route `runCli` calls `resolveAgentBackend` once after config load, before `applyCommitIdentity` and `openRun` (ahead of `createWorktree`'s `bun install` spend); the run-scoped config-dir parent (`mkdtemp(path.join(os.tmpdir(), 'review-loop-claude-'))`) is created as the first statement of the existing `try` — inside the finally-protected region, never between `mkdtemp` and coverage; the `claude` context is assembled there with `envSource` read from `process.env` at that one point (after `applyCommitIdentity` stamped `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, so commit identity rides into every claude child env); the existing `finally` removes the parent best-effort (`rmSync` recursive force); the opencode route calls none of it.
  Verify: `bun test tests/review-loop/cli.test.ts` (red)
- [x] 9.4 Implement the resolver call, context assembly and config-dir lifecycle in `review-loop/src/cli.ts`.
  Verify: `bun test tests/review-loop/cli.test.ts` (green)

## 10. Pipeline hand-off (design D9, D10)

- [x] 10.1 Tests first under `tests/opencode-agent/` (review hand-off): `makeReviewRunner` branches on `config.backend` — the claude route builds the loop's env from `config.claudeCredential` (the one spelling, name and value) with no `OPENCODE_CONFIG_CONTENT` and no gateway settings; the opencode route is byte-identical to today's `opencodeConfigEnv(config.openai)`.
  Verify: `bun test tests/opencode-agent/review-runner.test.ts` (red)
- [x] 10.2 Implement the env branch in `opencode-agent/src/deps.ts`.
  Verify: `bun test tests/opencode-agent/review-runner.test.ts` (green)
- [x] 10.3 Tests first: `buildReviewLoopConfig` gains the backend on `ReviewLoopSettings`, stamps `backend: 'claude'` into every per-role agent block on that route with the model crossed as the plain model id (provider prefix stripped — never the `OpenAiSettings` object), and keeps `extraArgs: []` so the CI route never hits the refusal.
  Verify: `bun test tests/opencode-agent/review-runner.test.ts` (red)
- [x] 10.4 Implement the backend-aware agent blocks in `opencode-agent/src/review-runner.ts`.
  Verify: `bun test tests/opencode-agent/review-runner.test.ts` (green)
- [x] 10.5 Add the pin-equal test (sibling of `tests/opencode-agent/minimality-rule.test.ts`, test-time import across the workspace boundary) reading the newly-exported `ALLOWLISTS` of `opencode-agent/src/claude-argv.ts` (additive export — module-private today, the pin-test prerequisite, landed with this test): `MAX_ARG_STRLEN` equal; the review-loop fixer allowlist string equal to `ALLOWLISTS.build` and the analysis set ⊇ its `plan` set plus the scoped `Write`; the streaming argv tail (`-p`, `--output-format stream-json`, `--verbose`, `--permission-mode default`) equal to `buildClaudeArgv`'s composition. The child-env doctrine is deliberately not pinned (D5 is a recorded superset by design).
  Verify: `bun test tests/opencode-agent/minimality-rule.test.ts` + the new pin test file (green)

## 11. Docs and example config (design Migration step 2)

- [x] 11.1 One coupled docs pass (the artifacts share this single available verification — no test loads the example, and the format gate covers only `review-loop/src` + `tests/review-loop`): `review-loop/config.example.json` gains the `backend` field **inside the agent blocks** (the per-role placement D1 defines — no top-level key exists; strict JSON carries no comments); `review-loop/CLAUDE.md` + `AGENTS.md` document the backend field's per-role placement and omit-or-agree semantics, the claude route's operator trade-offs (Bash-less analysis roles with the prompt's refused git/rg calls, killed-turn usage under-count, no retry layer, OAuth window), and the pinned-CLI requirement (`@anthropic-ai/claude-code@2.1.239`) with both failure shapes — a drifted CLI presents as the missing-`result`-line attempt failure, an absent binary as `spawn claude ENOENT` → retried once → `AgentRunError` naming the label; `opencode-agent/README.md`'s _Backend selection_ section retires the `/review` residual bullet and documents the claude-route review hand-off.
  Verify: `bun run review-loop:typecheck && bun run review-loop:format:check`

## 12. Zero-spend recorder legs (design D10, Migration step 3 — gate the credentialed merge)

- [ ] 12.1 Add and run the absolute-form scoped `Write` rule leg of the existing recorder (`tests/opencode-agent/claude-live.integration.ts`): the analysis allowlist under headless `-p` with `--permission-mode default`, the `Write(<cwd>/.review-loop/**)` absolute rule approving the scratch write on the pinned CLI.
  Verify: `bun run opencode-agent:test:claude-live` (credentialed recorder, never in CI)
- [ ] 12.2 Add and run the bare-`Read` outside-cwd leg (analysis allowlist, `-p`, `--permission-mode default`, an absolute path outside the spawn cwd — the reviewer's plan read); if the leg refuses, apply the recorded remedy ladder (a scoped `Read` rule, an `--add-dir` composition, or the loop copying the plan into the role's worktree — the last needs no unrecorded CLI behavior) before any credentialed turn, as a spec-visible change.
  Verify: `bun run opencode-agent:test:claude-live`
- [x] 12.3 Add and run the AGENTS.md-in-context leg under **both** profiles (the design's deferred Open Question): verify whether the pinned CLI auto-loads `AGENTS.md`/`CLAUDE.md` project memory in headless `-p` mode; if not loaded under a profile, apply the D3 system-prompt seam remedy (append the conventions via the shipped `--append-system-prompt` guard) for that profile before any credentialed reviewer turn — no spec, approach or ordering change.
  Verify: `bun run opencode-agent:test:claude-live`

## 13. Full verification

- [x] 13.1 Full gate from the repo root: `bun run test` (review-loop, opencode-agent and mutation-improve suites together — mutation-improve's bare `runAgent` calls gate the additive-optional seams) and `bun check:full` (typecheck/lint/knip/format land in `reports/checks/`); resolve every regression before finishing.
  Verify: `bun run test && bun check:full`
