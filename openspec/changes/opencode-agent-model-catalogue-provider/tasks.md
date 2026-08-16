<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Catalogue provider id for the agent's model

## 1. Config loading and validation

- [x] 1.1 Failing test: `loadOpenAiSettings` defaults `provider` to `openai`
      when `LLM_PROVIDER` is unset, and reads it when set —
      `bun test tests/opencode-agent/config.test.ts`
- [x] 1.2 Failing test: a provider id containing `/`, whitespace, uppercase, or
      exceeding the length bound raises `ConfigError` naming `LLM_PROVIDER` —
      `bun test tests/opencode-agent/config.test.ts`
- [x] 1.3 Add `provider` to `OpenAiSettings` (`openai-config.ts`) and the
      loader + validator (`config.ts`, `config-values.ts`); watch 1.1-1.2 pass —
      `bun test tests/opencode-agent/config.test.ts`
- [x] 1.4 `bun run typecheck` and `bun run lint` clean after the shape change —
      `cd opencode-agent && bun run typecheck && bun run lint`

## 2. Emitted config and model reference

- [x] 2.1 Failing test: `modelRef` emits `<provider>/<model>`, and
      `parseModelRef(modelRef(s))` round-trips a model id containing slashes —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.2 Failing test: `buildOpencodeConfig` keys `provider` by the configured
      id, keeps `npm: "@ai-sdk/openai-compatible"`, keeps
      `options.{apiKey,baseURL}`, and leaves the three agent permission
      profiles untouched —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.3 Regression test: with `LLM_PROVIDER` unset the emitted config is
      byte-identical to the recorded pre-change fixture (D2) —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.4 Implement `modelRef` and `buildOpencodeConfig`; watch 2.1-2.3 pass —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.5 Update the `provider-proxy` inlined-config fixture and the adapter's
      `parseModelRef(modelRef(...))` call site —
      `bun test tests/opencode-agent/provider-proxy.test.ts tests/opencode-agent/adapters.test.ts`

## 3. Observability of the resolved row

- [ ] 3.1 Failing test: boot logs the resolved provider id and model ref at
      `debug`, and never the key or base URL —
      `bun test tests/opencode-agent/adapters.test.ts`
- [ ] 3.2 Implement the debug log in `connectSdk`; watch 3.1 pass —
      `bun test tests/opencode-agent/adapters.test.ts`

## 4. Manual verification against a live server

Automated coverage stops at the emitted config; what OpenCode *resolves* from it
is only observable against a running server, and this change is verified by hand
rather than by adding to the live integration suite.

- [ ] 4.1 Run the pipeline locally with `LLM_PROVIDER` unset and confirm from
      the run log that behavior is unchanged —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 4.2 Run with `LLM_PROVIDER` set to a catalogue provider whose model is
      **not** an OpenAI id; confirm the debug line reports a non-zero
      `limit.context` and `reasoning: true`, and that the turn still completes
      through the proxy with the swapped-in `Authorization` —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 4.3 Record what was observed in `opencode-agent/ROADMAP.md` under a new
      entry, per the workspace rule that SDK behavior is recorded rather than
      assumed — no command; review the diff

## 5. Workflow, docs and full gates

- [ ] 5.1 Pass `vars.LLM_PROVIDER` through in `.github/workflows/agent-pipeline.yml`
      and confirm the workflow still parses — `bun workflows:lint`
- [ ] 5.2 Update the env table in `opencode-agent/README.md` and the config note
      in `opencode-agent/CLAUDE.md` to say the id selects the **catalogue** row,
      not the transport — no command; review the diff
- [ ] 5.3 Full gates: `bun test`, `bun run typecheck`, `bun run lint`
