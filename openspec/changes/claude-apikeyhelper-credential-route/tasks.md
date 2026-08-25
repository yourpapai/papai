<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Claude OAuth spelling refusal — the recorded no-carrier outcome

Revised 2026-08-25 after the credentialed recording fired the original
design's D5 inversion (with the sharper recorded verdict: the helper loads,
the API refuses OAuth over it). The original plan's sections 1–4 were
executed on this branch (commits `a8c66…`, `879932256`, `e3e74e3aa`,
`08a3c631a`, `92312e5e0`, `acc3a0a05`, `3d3e2fdc8`) and are **retired** by
section 2 below, not silently kept: what stays is exactly the seams design
D2 names. Every code task is test-first. All tests network-free except the
recorder's dummy-token legs, which are zero-spend by construction (invalid
token, recorded fast-fail) and never run in CI.

**Sequencing**: `claude-native-oauth-profile` applies only after this
revision's tasks are merged (its gate names this change).

## 1. The guard refusal (design D1)

- [x] 1.1 Tests first in `tests/opencode-agent/config.test.ts`: on the claude route, `CLAUDE_CODE_OAUTH_TOKEN` set alone fails startup under the `CLAUDE_CREDENTIALS` code naming the variable and the no-carrier reason (naming `--bare`, never the value); both-set keeps failing (message now led by the OAuth refusal); neither-set keeps failing, naming the API key as the accepted spelling; the opencode route and `LLM_API_KEY` refusal unchanged.
  Verify: `bun test tests/opencode-agent/config.test.ts` (red)
- [x] 1.2 Implement the refusal in `opencode-agent/src/config-backend-values.ts` (`claudeCredential`), messages naming variables and the recorded mechanism, never values.
  Verify: `bun test tests/opencode-agent/config.test.ts` (green)

## 2. Helper retirement, seams kept (design D2)

- [x] 2.1 Tests first: no invocation composes `--settings` — the `credentialSettingsFile` request field and its argv slot are gone from `claude-argv.ts`, bare argv byte-identical to the parent change's shape; `claude-credential.ts` is deleted and no module imports a credential-file writer.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red — the retirement assertions), then green with 2.2
- [x] 2.2 Implement the retirement: delete `opencode-agent/src/claude-credential.ts`, drop the `--settings` composition from `claude-argv.ts`, drop the boot-time materialization from `claude-adapter.ts`; the optional `credential` and the credentialless boot stay (assert: OAuth-credential boots are now unreachable from config — the guard refuses the spelling — while direct adapter tests may still pass either spelling to pin env behavior).
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/claude-connect.test.ts` (green)
- [x] 2.3 Rework the OAuth-carrier adapter/connect tests to the retired truth: the API-key spelling env-injects exactly the key; an OAuth-credential direct boot (test-only reachability) injects neither spelling and materializes nothing; the config-dir-at-first-spawn assertions now verify the dir stays credential-file-free.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/claude-connect.test.ts` (green)

## 3. Recorder negative pins (design D3)

- [ ] 3.1 Rework `tests/opencode-agent/claude-live.integration.ts`: the OAuth proof legs become a self-contained zero-spend negative — the leg materializes its own dummy token behind an `apiKeyHelper` shape in a throwaway config dir, drives a `--bare --settings` invocation, and asserts the two recorded observations (init line reports the helper as credential source; the turn ends in the recorded API-refusal shape), stamping facts into `facts.json`; `oauth-helper-init.ndjson` and the corpus README keep the provenance (loaded by the CLI, refused by the API, version-stamped). The credentialed OAuth corpus legs are removed — that spelling no longer boots from config.
  Verify: `bun run typecheck && CLAUDE_CODE_OAUTH_TOKEN=sk-invalid-dummy bun run tests/opencode-agent/claude-live.integration.ts` runs the negative legs to their recorded red conclusion without model spend
- [ ] 3.2 Re-run the API-key recording end-to-end to prove the retired route is byte-identical where it matters.
  Verify: `ANTHROPIC_API_KEY=<key> bun run tests/opencode-agent/claude-live.integration.ts` (credentialed)

## 4. Documentation

- [ ] 4.1 `opencode-agent/README.md`: resolve the parent's "caveat pending the credentialed recording" to the recorded outcome — OAuth has no carrier on `--bare` (env never read; helper loads but the API refuses OAuth), the guard refuses the spelling at startup, and the API key is the accepted credential; keep the fixture-provenance pointer.
  Verify: `bun test tests/opencode-agent/workflow.test.ts && bun run format:check`
- [ ] 4.2 `opencode-agent/CLAUDE.md`: one route-rule line — the OAuth spelling is refused with the recorded reason; no credential files are ever materialized; the recorder's dummy-helper leg is the standing pin.
  Verify: `bun run format:check`

## 5. Pre-merge verification

- [ ] 5.1 Full sweep green: full suite, lint, typecheck, workflow lint, strict change validation.
  Verify: `bun run test && bun run lint && bun run typecheck && bun workflows:lint && bunx openspec validate claude-apikeyhelper-credential-route --strict`
