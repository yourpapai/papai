<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Claude native OAuth profile on the claude route

Order follows design.md D1–D7. Every code task is test-first (the Write/Edit
hook does not gate `opencode-agent/src/`; apply-stage discipline carries it).
All tests network-free except the credentialed recorder legs, which never run
in CI. **Sequencing gate:** apply only after `claude-apikeyhelper-credential-route`'s
removal revision is merged — this change re-admits the spelling that revision
refuses, and its guard-wording task (2.5) edits text that revision owns.

## 1. Profile-aware argv composition (design D1, D2)

- [x] 1.1 Tests first in `tests/opencode-agent/claude-contract.test.ts` (argv suites): a `ClaudeInvocationProfile` union (`'bare' | 'native'`) on the builder's request — bare keeps today's argv byte-identical including `--bare` and no neutralization; native omits `--bare` and adds `--setting-sources ''`, `--strict-mcp-config`, `--mcp-config <path>`; every shared flag (-p, stream-json, `--verbose`, `--permission-mode default`, `--allowedTools`, `--model`, conditional `--effort`, `--resume`, stdin prompt) identical on both; no argv ever carries a credential value.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 1.2 Implement the profile parameter and native composition in `opencode-agent/src/claude-argv.ts`.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (green)
- [x] 1.3 Tests first in `tests/opencode-agent/claude-connect.test.ts`: the empty-MCP document writer — one JSON file naming zero servers, written into the config dir at boot, inert content, correct path surfaced for the argv.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 1.4 Implement the writer (beside `createClaudeConfigDir`'s lifetime, no env work).
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (green)

## 2. Env injection and adapter crossing (design D1, D3)

- [x] 2.1 Tests first in `tests/opencode-agent/claude-connect.test.ts`: `childEnv` on the native profile re-adds exactly `CLAUDE_CODE_OAUTH_TOKEN` (never the API key, never both); on bare keeps today's API-key shape; the profile rides the spawn request, not the env scrub.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 2.2 Tests first in `tests/opencode-agent/claude-adapter.test.ts`: the adapter derives the profile from the credential spelling (OAuth → native: no `--bare`, neutralization flags present, empty-MCP file written before first spawn, env carries the token; API key → bare: byte-identical to today, nothing materialized; absent credential → bare composition with neither spelling in env, for the recorder's census/negative legs).
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 2.3 Implement: the profile rule in `claude-connect.ts`, the derivation plus boot-time MCP-doc write in `claude-adapter.ts` — making 2.1 and 2.2 green.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 2.4 Tests first in `tests/opencode-agent/config.test.ts`: the guard's single-spelling messages name the native profile for `CLAUDE_CODE_OAUTH_TOKEN`; both-set and neither-set behavior byte-identical to the removal revision's guard.
  Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 2.5 Implement the wording in `config-backend-values.ts` (behavior unchanged).
  Verify: `bun test tests/opencode-agent/config.test.ts` (green)

## 3. Contract: the rate-limit signature (design D4)

- [x] 3.1 Tests first in `tests/opencode-agent/claude-contract.test.ts`: a `rate_limit_event` line decodes to an optional fact (type + window string), absent stays valid, unrecognized subtypes skip; the `<synthetic>` model id in assistant lines lands nowhere (names-only rule holds).
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 3.2 Implement the optional schema in `claude-contract.ts`.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (green)

## 4. Recorder native legs (design D5)

- [x] 4.1 Extend `tests/opencode-agent/claude-live.integration.ts`: when the held credential is the OAuth spelling, run — before any adapter turn — (a) the free census leg: an un-credentialed native invocation through the adapter-composed argv, asserting `mcp_servers: []`, built-ins-only skills, and a `/context` census with no memory-file row; (b) the dummy-token negative: instant `api_error` result shape, stamped as `native-auth-error.ndjson`; (c) after the proof turn, the WebFetch adversarial refusal under the `plan` allowlist. The credentialed proof turn (d) asserts reply text plus the `rate_limit_event` five-hour signature, records both in `facts.json`, and stamps `native-success-turn.ndjson`. API-key spellings run exactly today's legs, unchanged.
  Verify: `bun run typecheck && bun run tests/opencode-agent/claude-live.integration.ts` fails only on credentials

## 5. Credentialed recording (design D5, spec proof requirement)

- [ ] 5.1 Run `CLAUDE_CODE_OAUTH_TOKEN=<token> bun run opencode-agent:test:claude-live`: census ✓, dummy-401 ✓, proof turn with `five_hour` ✓, WebFetch refusal ✓, corpus turns through the adapter, `VERSION`/`facts.json` stamped.
  Verify: the run itself (credentialed; never in CI)
- [ ] 5.2 Re-run `ANTHROPIC_API_KEY=<key> bun run opencode-agent:test:claude-live`: the bare route's legs record green, proving byte-identity survived the split.
  Verify: same command, credentialed

## 6. Documentation

- [ ] 6.1 `opencode-agent/README.md`: the backend-selection section names the two profiles and their selection rule (the spelling, not a knob), the billing trade-offs (Console per-token vs subscription five-hour windows; quota exhaustion is a turn failure with time-based recovery), the built-in-skills residual (~1.5k tokens, CLI-shipped), and the keychain non-interference fact.
  Verify: `bun test tests/opencode-agent/workflow.test.ts && bun run format:check`
- [ ] 6.2 `opencode-agent/CLAUDE.md`: one route-rule line — OAuth spelling = native profile, neutralization flags mandatory, census pins are load-bearing, `apiKeySource` is not the native proof.
  Verify: `bun run format:check`

## 7. Pre-merge verification

- [ ] 7.1 Full sweep green: full suite, lint, typecheck, workflow lint, strict change validation.
  Verify: `bun run test && bun run lint && bun run typecheck && bun workflows:lint && bunx openspec validate claude-native-oauth-profile --strict`
