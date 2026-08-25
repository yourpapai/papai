<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Claude Code CLI as a selectable model backend in opencode-agent

## Why

The pipeline is bound to one model backend — the headless OpenCode server — so
every job's spend crosses the OpenAI-compatible gateway, and repos whose model
budget lives in Anthropic credentials (Console API key or a Claude subscription)
cannot run the agent. The seam was built for this — `sdk-contract.ts` /
`opencode-connect.ts` / `opencode-adapter.ts` behind the injected `OpenCodeAgent`
interface — so a second adapter arrives without phases, budgets, guardrails or
feedback learning anything. Why now: since the Feb 19 2026 enforcement,
subscription OAuth is sanctioned only when consumed by the official `claude`
binary.

## What Changes

- New `claude-*.ts` modules mirroring the OpenCode connect/contract/session
  split behind the same agent interface, spawning the official `claude` CLI
  per turn (`--resume` continuity, stream-json decode, exit-code discipline).
- Knob **`AGENT_BACKEND=opencode|claude`** (default `opencode`); model knobs →
  `--model` / `--effort`; profiles → pinned `--allowedTools` allowlists
  with `--permission-mode default`; `--bare` every run; no `~/.claude` state
  across jobs.
- Startup **credential guard**: exactly one of `ANTHROPIC_API_KEY` (documented
  default) or `CLAUDE_CODE_OAUTH_TOKEN`; both or neither → loud failure before
  any model spend. Only the chosen credential is injected after the `secrets.ts`
  scrub.
- `abort()` kills the CLI **process group**; `close()` reaps, terminating
  anything abandoned; token totals are read from `result` lines before teardown
  for the per-issue budget.
- Workflow: install a pinned `claude` CLI version and forward the Anthropic
  credential only when selected. Nothing else changes.

## Capabilities

### New Capabilities

- `opencode-agent-claude-cli-backend`: backend selection, the CLI session
  contract (spawn / decode / resume / exit / stop semantics),
  the credential exclusivity guard, profile→allowlist mapping, and the pinned
  workflow install. Without it the agent is permanently single-backend:
  Anthropic-credentialed repos cannot run it, and a both-credentials-set mistake
  silently bills per-token instead of failing the job — new behavior behind the
  existing OpenCode seam (`opencode-adapter.ts` et al.), covered by no existing
  spec.

### Modified Capabilities

None — `openspec/specs/` carries no model-backend spec, and the default
`opencode` route is byte-identical; no existing requirement changes.

## Non-goals

- **Agent SDK / direct Anthropic API** — prohibited; OAuth is sanctioned only via
  the official CLI binary.
- **review-loop backend** — keeps shelling out to `opencode run`; recorded
  residual, untouched.
- Multi-agent orchestration, MCP beyond `--bare`, phase/state-machine changes,
  self-hosted runner images.
- OAuth token rotation automation (rotate by regenerating — documented, not
  built).

## Impact

- **Code:** new `opencode-agent/src/claude-contract.ts` / `claude-connect.ts` /
  `claude-adapter.ts`, plus `agent-session.ts` extracted from
  `opencode-adapter.ts` (re-exported alias; no existing import changes); small
  route-gated edits to config, secrets, contain, turn-run and error modules
  (per-decision detail in design.md);
  `.github/workflows/agent-pipeline.yml` (protected path — pinned install,
  route-gated credential forwarding); `opencode-agent/README.md` and `CLAUDE.md`.
- No papai runtime, SQLite, or scope-model impact: repository-scoped Actions
  config, maintainers-only.
- **Tests:** `tests/opencode-agent/`, fixtures recorded from the live CLI, no
  network; DI over `mock.module`.
