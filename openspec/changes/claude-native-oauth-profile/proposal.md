<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The claude route authenticates only via `ANTHROPIC_API_KEY` (per-token Console billing): the pinned CLI's `--bare` never reads OAuth, and the recorded apiKeyHelper attempt proved the helper is API-key-shaped. But the 2026-08-25 exploration proved a second, fully-recorded profile: the CLI's **native OAuth path** under a neutralized non-bare invocation — one credentialed turn answered `ready` billed against the subscription (`rateLimitType: five_hour`). Teams wanting Pro/Max/Team/Enterprise billing for the agent pipeline currently have no route at all.

## What Changes

- The claude route gains a **second profile selected by credential spelling**: `ANTHROPIC_API_KEY` → today's `--bare` route (byte-identical, untouched); `CLAUDE_CODE_OAUTH_TOKEN` → the **native profile** — no `--bare`, plus `--setting-sources ''`, `--strict-mcp-config`, `--mcp-config <empty json>` carrying the neutralization, with every other flag (`-p`, stream-json, `--verbose`, `--permission-mode default`, `--allowedTools`, `--model`, `--effort`, `--resume`) unchanged.
- `childEnv` re-adds `CLAUDE_CODE_OAUTH_TOKEN` on the native profile — the symmetric mirror of today's API-key rule.
- The recorder gains native legs: the credentialed proof turn (`rate_limit_event`/`five_hour` signature), the dummy-token instant-401 negative (env token authoritative over keychain — recorder-safety), the free census pins (`mcp_servers: []`, skills built-ins-only, no Memory-files row), and the WebFetch adversarial refusal.
- The guard's both-set rule is unchanged; neither-set and single-spelling messages learn the native profile's name.

## Capabilities

### New Capabilities

- `agent-claude-native-oauth-profile`: the credential-spelling-selected second claude profile — its argv neutralization, env injection, confinement parity, and the recorded proof obligations that keep it honest across CLI pin moves.

### Modified Capabilities

None. `agent-claude-oauth-credential` (from the unarchived `claude-apikeyhelper-credential-route` change, currently mid-revision to the helper-removal outcome) owns the guard's spelling rules; this change *re-admits* the OAuth spelling as the native profile's credential on top of that revision's recorded facts, and sequences after both it and `build-claude-code-cli-as-a-selectable-model-backend-in-opencode` being archived — the same layering `opencode-agent-fix-command` used over `agent-ci-repair`.

## Impact

- Code: `opencode-agent/src/claude-argv.ts` (profile-aware composition), `claude-connect.ts` (`childEnv` symmetric re-add), `claude-adapter.ts` (profile crossing from the credential spelling); the guard in `config-backend-values.ts` needs only message wording.
- Recorder/fixtures: `tests/opencode-agent/claude-live.integration.ts` + `fixtures/claude-cli/` (native legs, census pins, `facts.json` entries).
- Workflow: none — the forwarding gates already carry the token on the claude route.
- Docs: `opencode-agent/README.md` backend-selection section (two profiles, billing trade-offs), `CLAUDE.md` module map line.
- No papai platform/task instance, scope-model, or SQLite impact.

## Non-goals

- Touching the `--bare` API-key route — byte-identical by construction (spelling-gated composition).
- Re-introducing `apiKeyHelper` — recorded dead end (API refuses OAuth over the helper; `oauth-helper-init.ndjson` keeps the provenance).
- Retry layers or budget handling for subscription rate limits: a 429 on the five-hour window is a turn failure (`CLAUDE_RESULT`/`CLAUDE_EXIT` families own it), documented as a trade-off, same doctrine as the bare route's "no retry layer".
- Any change above the session seam — phases, budgets, guardrails, state machine stay profile-blind.
