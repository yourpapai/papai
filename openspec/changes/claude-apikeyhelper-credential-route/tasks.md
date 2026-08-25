<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Claude OAuth credential via apiKeyHelper on the claude route

Order follows design.md D1–D6. Every code task is test-first (apply-stage
discipline; the Write/Edit hook does not gate `opencode-agent/src/`). All tests
network-free except the credentialed recorder legs, which never run in CI.
Tasks in section 5 gate the route's ship decision (design D5): if the recording
proves the helper is not consulted under `--bare`, stop and revise the change
through the update workflow to the removal outcome instead of continuing.

## 1. Helper materialization (design D1, D2)

- [x] 1.1 Tests first in `tests/opencode-agent/claude-connect.test.ts`: a `writeClaudeCredentialFiles(configDir, credential)` — OAuth spelling writes `credential.sh` (shebang, `printf '%s' '<token>'`, mode 0700) and `settings.json` (exactly `{"apiKeyHelper": "<configDir>/credential.sh"}`, mode 0600) into the given dir, nothing else; API-key spelling writes nothing; absent credential writes nothing; a token containing a single quote or newline fails with a named error naming the variable, never the value.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 1.2 Implement the writer in `opencode-agent/src/claude-connect.ts` — one pure file-state step, no env work — making 1.1 green.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (green)

## 2. Spelling-dependent env injection (design D3)

- [x] 2.1 Tests first in `tests/opencode-agent/claude-connect.test.ts`: `childEnv` on the OAuth spelling carries neither Anthropic spelling; on the API-key spelling re-adds exactly it (today's shape); with no credential carries neither and fails nowhere.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts` (red)
- [x] 2.2 Tests first in `tests/opencode-agent/claude-adapter.test.ts`: booting with the OAuth credential materializes the helper into the config dir once before any spawn (asserted against the injected spawn/files seam); booting with the API key or no credential materializes nothing; `ClaudeAgentOptions.credential` is optional and absent spawns carry no credential anywhere.
  Verify: `bun test tests/opencode-agent/claude-adapter.test.ts` (red)
- [x] 2.3 Implement: the env rule in `claude-connect.ts`, the optional credential plus boot-time materialization in `claude-adapter.ts` (design D1) — making 2.1 and 2.2 green.
  Verify: `bun test tests/opencode-agent/claude-connect.test.ts tests/opencode-agent/claude-adapter.test.ts` (green)
- [x] 2.4 Tests first, then implement: the OAuth spelling's settings file rides every invocation as `--settings <file>` — the pinned CLI's own `--bare` help reads "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings", so the materialized pair alone (config-dir auto-discovery) authenticates nothing under `--bare`. Found by the first 5.1 run: `CLAUDE_RESULT` on the opening turn with the pair present but unnamed; the recorder also learns to run its proof legs ahead of the corpus so the decision facts land even when a corpus turn rejects.

## 3. Contract: init-line credential source (design D4)

- [x] 3.1 Tests first in `tests/opencode-agent/claude-contract.test.ts`: the init-line schema decodes an optional `apiKeySource` string (absent stays valid); no other decoder changes.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (red)
- [x] 3.2 Implement the optional field in `claude-contract.ts`.
  Verify: `bun test tests/opencode-agent/claude-contract.test.ts` (green)

## 4. Recorder OAuth leg (design D4)

- [x] 4.1 Extend `tests/opencode-agent/claude-live.integration.ts` for the OAuth spelling as the held credential: the recording spawn seam asserts every spawned env carries no Anthropic spelling and the config dir held both files (modes included) before the first spawn; one raw leg reuses the materialized config dir, parses the init line's `apiKeySource`, and records it plus the helper stdout shape into `facts.json`; the corpus gains the OAuth init-line fixture. The un-credentialed auth-error leg boots the adapter with no credential (design D3) so no helper exists to consult.
  Verify: `bun run typecheck && bun run opencode-agent:test:claude-live` fails only on credentials (structure compiles; legs are credentialed)

## 5. Credentialed recording — the ship gate (design D5)

- [ ] 5.1 Run `CLAUDE_CODE_OAUTH_TOKEN=<token> bun run opencode-agent:test:claude-live` on the pinned CLI: adapter-driven turns succeed through the helper (success, resume, adversarial, accounting), the raw leg's init line reports a non-`none` `apiKeySource`, `VERSION`/`facts.json` stamp. **Decision point:** green → continue to 6; red on helper-ignored → stop applying, revise this change via the update workflow to the guard-removal outcome (design D5), and re-plan.
  Verify: `bun run opencode-agent:test:claude-live` (credentialed; never in CI)
- [ ] 5.2 Re-run the API-key recording (`ANTHROPIC_API_KEY=<key> bun run opencode-agent:test:claude-live`) to prove the untouched spelling still records green — both spellings' corpus facts coexist under the one `VERSION` stamp.
  Verify: same command, credentialed

## 6. Documentation

- [ ] 6.1 `opencode-agent/README.md`: resolve the "caveat pending the credentialed recording" paragraphs to the recorded outcome — OAuth via the job-scoped helper (or the removal, per 5.1); state the trade-off that the token leaves the env for a 0700/0600 file pair the CLI's own same-user children can still read (residual stands), and that the API-key spelling is unchanged.
  Verify: `bun test tests/opencode-agent/workflow.test.ts && bun run format:check`
- [ ] 6.2 `opencode-agent/CLAUDE.md`: one route-rule line for contributors — OAuth spelling means helper-carried credential, no Anthropic value in any env, writer refusal rules.
  Verify: `bun run format:check`

## 7. Pre-merge verification

- [ ] 7.1 Full sweep green: full suite, lint, typecheck, workflow lint, strict change validation.
  Verify: `bun run test && bun run lint && bun run typecheck && bun workflows:lint && bunx openspec validate claude-apikeyhelper-credential-route --strict`
