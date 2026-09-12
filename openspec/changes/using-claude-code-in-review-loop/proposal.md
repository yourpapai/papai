<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: using Claude Code in review loop

## Why

`opencode-agent` gained `AGENT_BACKEND=claude` for its own model turns, but its
`/review` phase drives the `review-loop/` workspace, which still shells out to
`opencode run` reviewer/fixer/matcher/inspector subprocesses. On the claude
route there is no provider proxy, so those children have no model to talk to
and `/review` fails at its own boundary — the residual the parent change
(`build-claude-code-cli-as-a-selectable-model-backend-in-opencode`) recorded
and deferred. Closing it now makes a claude-route job fully functional instead
of failing one phase in.

## What Changes

- review-loop gains a selectable agent backend (config knob, default
  `opencode`): new claude subprocess modules mirroring opencode-agent's
  recorded claude-CLI doctrine — argv/profile/allowlists, credential guard,
  event decode, config-dir isolation, duplicated across the workspace
  boundary rather than imported:
  `--permission-mode default` with per-role `--allowedTools` allowlists,
  `MAX_ARG_STRLEN` refusal, prompt on stdin (new `SpawnFn` stdin/env seams), native
  profile flags mandatory per invocation.
- Credential profile selected by spelling (`ANTHROPIC_API_KEY` → bare,
  `CLAUDE_CODE_OAUTH_TOKEN` → native) with the exclusivity guard; a set
  `LLM_API_KEY` on the claude route is refused.
- A claude NDJSON event parser mapped into the existing line-handler/usage
  accounting: usage once per turn from the `result` line (tokens, cache
  read/write, `costUsd`), session id from `init`.
- Run-scoped `CLAUDE_CONFIG_DIR` outside the worktrees (never staged),
  removed at teardown.
- opencode-agent's review runner passes the backend through: env branch in
  `makeReviewRunner` (claude credentials instead of `OPENCODE_CONFIG_CONTENT`)
  and per-backend agent blocks in the generated review-loop config; the
  workflow's route-gated CLI install covers the loop.

## Capabilities

### New Capabilities

- `review-loop-agent-backend`: backend selection in the review-loop config, the
  claude CLI subprocess contract for the four loop roles (argv composition,
  credentials/profile guard, event decode, usage accounting, config-dir
  isolation), and the opencode-agent review-runner hand-off. Without it,
  claude-route jobs cannot run `/review` at all and the loop is permanently
  single-backend. No existing spec covers agent invocation — the
  `review-loop-*` specs govern findings and fix quality; and review-loop cannot
  import opencode-agent's claude modules (documented subprocess boundary, same
  as the pinned-equal `MINIMALITY_RULE` duplication), so a separate capability
  is needed.

### Modified Capabilities

None — `review-loop-fix-quality`, `review-loop-deletion-findings` and
`review-loop-issue-exposure` govern finding/fix semantics, which are
backend-agnostic and unchanged; the default opencode route stays byte-identical.

## Non-goals

- Direct Anthropic API/SDK for loop agents — OAuth is sanctioned only via the
  official CLI binary.
- Mixed backends or per-role backend overrides within one run (one backend per
  run).
- Retry layer for claude turns, stall-watchdog changes, or the killed-turn
  token under-count — opencode-agent route trade-offs carried over unchanged.
- Prompt/fix-quality contract changes (`MINIMALITY_LADDER`,
  `CHECK_BEHIND_RULE`, `NO_PROSE_RULE` untouched); papai runtime integration.

## Impact

- **Code:** `review-loop/src/agent-runner.ts`, `spawn.ts`, `line-handler.ts`,
  `config.ts`, `cli.ts`, `build-checker.ts` (credential-scrubbed
  build-check result), the role modules threading the backend into their
  `runAgent` calls (`review-round.ts`, `issue-matcher.ts`,
  `issue-inspector.ts`, `issue-processor-attempts.ts`,
  `issue-processor-batch.ts`) + new claude modules;
  `opencode-agent/src/review-runner.ts`, `deps.ts`, and `claude-argv.ts`
  (additive `ALLOWLISTS` export — the pin-test prerequisite);
  `.github/workflows/agent-pipeline.yml` (route-gated install already
  present); `review-loop/config.example.json`, workspace `CLAUDE.md`/`README.md`.
- **Scope:** no platform or task instances, no config-context impact —
  standalone CI tooling configured by file + env; no papai runtime, SQLite, or
  scope-model change.
- **Tests:** `tests/review-loop/**` (TDD-mapped), `tests/opencode-agent/`
  reviewing the runner hand-off; claude fixtures reused from
  `tests/opencode-agent/fixtures/claude-cli/`.
