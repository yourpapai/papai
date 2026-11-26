<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Custom Claude environment variables for the opencode agent

Design has no open questions (`design.md` — Open Questions: None). Test-first order
follows `design.md` — Capability gating, scope model, dependencies, hooks.

## 1. Knob parser (`claude-env-knob.ts`, test-first)

- [x] 1.1 Write failing tests in `tests/opencode-agent/claude-env-knob.test.ts`, mirroring the `mcp-servers.test.ts` shape: unset/blank → `undefined`; invalid JSON refused naming `AGENT_CLAUDE_ENV`; non-object refused; non-string entry value refused; every refused name refused with the rule-naming error (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, `LLM_BASE_URL`, `AGENT_MCP_SERVERS`), including a pin that every `STRIPPED_NAMES` member from `claude-connect.ts` is in the refused set; a valid object parses; empty-string values are accepted. Verify: `bun test tests/opencode-agent/claude-env-knob.test.ts` (red)
- [x] 1.2 Create `opencode-agent/src/claude-env-knob.ts`: `parseClaudeEnv` (blank → `undefined`, `safeJson` naming the syntax error, rule-first refusal pass naming the route-ownership rule, then `z.record(z.string(), z.string())`), the exported refused-set constant, `ConfigError` failures — re-exported through `config-values.ts` like `parseMcpServers`. Verify: `bun test tests/opencode-agent/claude-env-knob.test.ts` (green) && `bun run typecheck`
- [x] 1.3 Lint and format the new module. Verify: `bun run lint` && `bun run format:check`

## 2. Config plumbing (`config-shape.ts` / `config.ts`, test-first)

- [x] 2.1 Write failing tests in `tests/opencode-agent/config.test.ts`: `loadConfig` carries `claudeEnv` parsed from `AGENT_CLAUDE_ENV` on the claude route; `null` when unset or blank; malformed value fails at load on the **opencode** route too. Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 2.2 Add `claudeEnv: Record<string, string> | null` to `PipelineConfig` in `config-shape.ts` (with the field's why-prose) and read it in `loadConfig`'s backend block in `config.ts`; `config-backend-values.ts` needs no edit. Verify: `bun test tests/opencode-agent/config.test.ts` (green) && `bun run typecheck`

## 3. Child-environment merge (`claude-connect.ts`, test-first)

- [x] 3.1 Write failing tests in `tests/opencode-agent/claude-connect.test.ts`: a `ClaudeSpawnRequest` with `customEnv` produces a child env carrying the entries; the route's own values win for `DISABLE_AUTOUPDATER`, `CLAUDE_CONFIG_DIR` and the profile credential (merge order proven); a request without `customEnv` yields an env byte-identical to the pre-change build. Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 3.2 Implement in `claude-connect.ts`: optional `customEnv: Record<string, string>` on `ClaudeSpawnRequest`, folded in `childEnv` after the `STRIPPED_NAMES` strip and before the profile credential re-add. Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (green) && `bun run typecheck`

## 4. Adapter and containment plumbing (test-first)

- [x] 4.1 Write failing tests: in `tests/opencode-agent/claude-adapter.test.ts`, the spawn seam records the merged env arriving through `ClaudeSpawnRequest` (adapter passes the knob to every turn's spawn); in `tests/opencode-agent/contain.test.ts` coverage of `claudeSessionOptions` (or the existing `contain` suite), `contained.claudeEnv` crosses as a plain value and `null` crosses as absent — never the config object. Verify: `bun test tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/contain.test.ts` (red)
- [x] 4.2 Plumb in `contain.ts` (`claudeSessionOptions` gains the field) and `claude-adapter.ts` (`ClaudeAgentOptions` gains it; `spawnTurn` forwards it on each request). Verify: same command (green) && `bun run typecheck`

## 5. Credential wiring (`secrets.ts` + adapter redaction, test-first)

- [x] 5.1 Write failing tests: in `tests/opencode-agent/config.test.ts`, `pipelineSecrets` includes every knob value (the `mcpSecrets` collection case beside it); in `tests/opencode-agent/claude-adapter.test.ts`, transcript lines and stderr are redacted by a knob value, not only by the credential value. Verify: `bun test tests/opencode-agent/config.test.ts tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 5.2 Implement: `claudeEnvSecrets` collector in `secrets.ts` appended in `pipelineSecrets` (the `MIN_SECRET_LENGTH` filter keeps governing); the claude session's redaction list (`credentialValues` site) gains the knob values. Verify: same command (green) && `bun run typecheck`

## 6. Documentation and the maintainer hand-edit

- [x] 6.1 Document the knob in `opencode-agent/README.md`'s claude-route section: route-scoped, JSON shape, refused names, values readable by the CLI's `Bash` children (the documented residual), secrets do not belong in a repository variable, review-loop claude subprocesses excluded, inert until the workflow forwarding line lands. Verify: `bun run format:check` && `bun run lint`
- [x] 6.2 Surface the maintainer hand-edit — do **not** edit `.github/workflows/` (protected path; the agent's token cannot push one): the phase report must carry the exact line `AGENT_CLAUDE_ENV: ${{ vars.AGENT_CLAUDE_ENV }}` for the pipeline step's `env:` block, beside `AGENT_EFFORT_PLAN`, with the note that `tests/opencode-agent/workflow.test.ts` and `bun run workflows:lint` must stay green across it. Verify: report contains the line; `bun run workflows:lint` passes (no workflow change made by the agent)

## 7. Full verification

- [x] 7.1 Run the mutation ratchet over the touched files. Verify: `bun run test:mutate:changed --base=HEAD~1` passes the per-file floor
- [x] 7.2 Run the full suite, typecheck and lint; confirm affected docs: `docs/architecture/*.md` pages describe no claude-route child-env composition (grep verifies — none name it), so `opencode-agent/README.md` is the only doc change. Verify: `bun test` && `bun run typecheck` && `bun run lint` && `bun run format:check`
