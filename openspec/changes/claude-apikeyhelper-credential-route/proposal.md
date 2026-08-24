<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The claude route's guard accepts `CLAUDE_CODE_OAUTH_TOKEN` as the subscription-billing spelling, but the live recording on the pinned CLI 2.1.239 proved the env token is never consulted under `--bare` (`apiKeySource: "none"`): an OAuth-credentialed job fails its first turn `CLAUDE_RESULT` at real recording cost. The guard currently admits a credential that cannot authenticate a single turn.

## What Changes

- When the chosen credential is `CLAUDE_CODE_OAUTH_TOKEN`, the adapter materializes the CLI's sanctioned `apiKeyHelper` mechanism into the job-scoped `CLAUDE_CONFIG_DIR` (a `settings.json` naming a 0600 helper script that echoes the token) instead of injecting the token into the child env.
- The `ANTHROPIC_API_KEY` spelling keeps today's env injection — each spelling uses its proven mechanism; the spawn env carries no Anthropic credential on the OAuth spelling.
- The credential value still joins `pipelineSecrets` (scrub/redaction by value) regardless of spelling.
- The recorder gains an OAuth leg: driven under the OAuth token, it pins by recording that the helper authenticates under `--bare` (init-line `apiKeySource` non-`none`), that the token is absent from env and argv, and the corpus gains the fixture.
- `opencode-agent/README.md` / `CLAUDE.md`: the "caveat pending the credentialed recording" paragraphs resolve to the recorded outcome.

## Capabilities

### New Capabilities

- `agent-claude-oauth-credential`: OAuth credential delivery for the claude backend — the job-scoped apiKeyHelper materialization, its exclusivity with the API-key env spelling, its secret-handling rules, and its recorded proof obligation.

### Modified Capabilities

None. `opencode-agent-claude-cli-backend` (the unarchived `build-claude-code-cli-as-a-selectable-model-backend-in-opencode` change) owns the route; it has no spec under `openspec/specs/` to modify. This change requires that change archived first and layers on its seam — the same layering `opencode-agent-fix-command` used over `agent-ci-repair`.

## Impact

- Code: `opencode-agent/src/claude-connect.ts` (helper materialization, env shape), `claude-adapter.ts` (credential crossing); the guard in `config.ts` is unchanged.
- Recorder/fixtures: `tests/opencode-agent/claude-live.integration.ts` + `fixtures/claude-cli/` (OAuth leg, version-stamped).
- Workflow: none — forwarding gates already carry the token.
- Docs: `opencode-agent/README.md`, `opencode-agent/CLAUDE.md`.
- No papai platform/task instance, scope-model, or SQLite impact (repository-scoped Actions configuration only).

## Non-goals

- Unifying both spellings through the helper (the API key works via env today; moving it changes a proven path for no functional gain).
- Revoking the recorded Bash-children residual: same-user CLI children can read the helper file as easily as an env var — mechanism change, not a security boundary.
- Any retry layer, budget, or billing change beyond the credential carrier.
- Renaming or renumbering the parent change's pending credentialed tasks (1.2/10.1 stay with it, under the API key).
